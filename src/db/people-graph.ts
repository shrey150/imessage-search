/**
 * People Graph Client
 * 
 * Provides CRUD operations and resolution for the People Graph.
 * Handles mapping of raw iMessage handles to stable Person UUIDs.
 */

import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, or, like, and, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import * as schema from './schema.js';
import {
  people,
  handles,
  aliases,
  relationships,
  person_attributes,
  Person,
  Handle,
  Alias,
  Relationship,
  PersonAttribute,
  NewPerson,
  RELATIONSHIP_TYPES,
  RelationshipType,
} from './schema.js';

// ============================================================
// TYPES
// ============================================================

export interface PersonWithDetails extends Person {
  handles: Handle[];
  aliases: Alias[];
  relationships: Array<Relationship & { other_person_name: string }>;
  attributes: PersonAttribute[];
}

export interface PersonContext extends PersonWithDetails {
  chats: Array<{
    id: string;
    display_name: string | null;
    is_group_chat: boolean;
    participant_count: number;
  }>;
  memories: Array<{
    id: string;
    content: string;
    importance: number;
  }>;
  message_stats?: {
    total_messages: number;
    first_message: string;
    last_message: string;
  };
}

export interface ResolveResult {
  found: boolean;
  person?: PersonWithDetails;
  suggestions?: string[];
}

// ============================================================
// HANDLE NORMALIZATION
// ============================================================

/**
 * Normalize a handle for consistent lookups.
 * - Phone: Strip all non-digits, remove leading 1 for US numbers
 * - Email: Lowercase and trim
 */
export function normalizeHandle(handle: string, type?: string): string {
  // Strip tel: prefix first (common in iMessage)
  const cleanHandle = handle.replace(/^tel:/i, '');
  
  // Detect type if not provided
  const detectedType = type || inferHandleType(cleanHandle);
  
  if (detectedType === 'phone') {
    // Strip all non-digits
    const digits = cleanHandle.replace(/\D/g, '');
    // Remove leading 1 for US numbers (11 digits starting with 1)
    if (digits.length === 11 && digits.startsWith('1')) {
      return digits.slice(1);
    }
    return digits;
  }
  
  // Email/AppleID: lowercase and trim
  return cleanHandle.toLowerCase().trim();
}

/**
 * Infer the handle type from its format
 */
export function inferHandleType(handle: string): 'phone' | 'email' | 'appleid' {
  if (handle.includes('@')) {
    // Could be email or AppleID - we'll treat them the same for now
    return handle.toLowerCase().includes('icloud') ? 'appleid' : 'email';
  }
  return 'phone';
}

// ============================================================
// PEOPLE GRAPH CLIENT
// ============================================================

export class PeopleGraph {
  private db: BetterSQLite3Database<typeof schema>;
  private sqlite: Database.Database;
  
  // In-memory cache for hot path (handle lookups during indexing)
  private handleCache = new Map<string, string>(); // normalized handle → person_id
  private ownerIdCache: string | null = null;
  
  constructor(dbPath: string = './data/people.db') {
    this.sqlite = new Database(dbPath);
    this.db = drizzle(this.sqlite, { schema });
    
    // Enable foreign keys
    this.sqlite.pragma('foreign_keys = ON');
  }
  
  /**
   * Initialize the database (create tables if they don't exist)
   */
  async initialize(): Promise<void> {
    // Tables are created via Drizzle migrations
    // This method is for any runtime initialization
    await this.loadHandleCache();
  }
  
  /**
   * Load handle cache for fast lookups
   */
  private async loadHandleCache(): Promise<void> {
    const allHandles = this.db.select({
      handle_normalized: handles.handle_normalized,
      person_id: handles.person_id,
    }).from(handles).all();
    
    this.handleCache.clear();
    for (const h of allHandles) {
      this.handleCache.set(h.handle_normalized, h.person_id);
    }
  }
  
  /**
   * Get the owner (the iMessage archive owner)
   */
  async getOwner(): Promise<Person | null> {
    if (this.ownerIdCache) {
      const owner = this.db.select().from(people).where(eq(people.id, this.ownerIdCache)).get();
      return owner || null;
    }
    
    const owner = this.db.select().from(people).where(eq(people.is_owner, true)).get();
    if (owner) {
      this.ownerIdCache = owner.id;
    }
    return owner || null;
  }
  
  /**
   * Get the owner's ID
   */
  async getOwnerId(): Promise<string | null> {
    const owner = await this.getOwner();
    return owner?.id || null;
  }
  
  /**
   * Create the owner person (should only be called once during migration)
   */
  async createOwner(ownerHandles: string[], name: string = 'Me'): Promise<string> {
    // Check if owner already exists
    const existing = await this.getOwner();
    if (existing) {
      return existing.id;
    }
    
    const personId = randomUUID();
    
    // Deduplicate handles by normalized value (keep first original)
    const seenNormalized = new Map<string, { handle: string; type: 'phone' | 'email' | 'appleid' }>();
    for (const handle of ownerHandles) {
      const type = inferHandleType(handle);
      const normalized = normalizeHandle(handle, type);
      if (!seenNormalized.has(normalized)) {
        seenNormalized.set(normalized, { handle, type });
      }
    }
    
    this.db.transaction((tx) => {
      // Create person
      tx.insert(people).values({
        id: personId,
        name,
        is_owner: true,
        auto_created: false,
      }).run();
      
      // Add deduplicated handles
      for (const [normalized, { handle, type }] of seenNormalized) {
        tx.insert(handles).values({
          id: randomUUID(),
          person_id: personId,
          handle,
          handle_normalized: normalized,
          type,
        }).run();
        
        this.handleCache.set(normalized, personId);
      }
      
      // Add name as alias
      tx.insert(aliases).values({
        id: randomUUID(),
        person_id: personId,
        alias: name,
        alias_lower: name.toLowerCase(),
        is_primary: true,
      }).run();
    });
    
    this.ownerIdCache = personId;
    return personId;
  }
  
  /**
   * Resolve a handle to a person ID, or create a new person if not found.
   * This is the main method used during indexing.
   */
  async resolveOrCreate(handle: string, displayName?: string): Promise<string> {
    const type = inferHandleType(handle);
    const normalized = normalizeHandle(handle, type);
    
    // Check cache first (hot path)
    const cached = this.handleCache.get(normalized);
    if (cached) {
      return cached;
    }
    
    // Check database
    const existing = this.db.select()
      .from(handles)
      .where(eq(handles.handle_normalized, normalized))
      .get();
    
    if (existing) {
      this.handleCache.set(normalized, existing.person_id);
      return existing.person_id;
    }
    
    // Create new person
    const personId = randomUUID();
    const name = displayName || handle;
    
    this.db.transaction((tx) => {
      // Create person
      tx.insert(people).values({
        id: personId,
        name,
        auto_created: true,
      }).run();
      
      // Add handle
      tx.insert(handles).values({
        id: randomUUID(),
        person_id: personId,
        handle,
        handle_normalized: normalized,
        type,
      }).run();
      
      // Add name as alias
      tx.insert(aliases).values({
        id: randomUUID(),
        person_id: personId,
        alias: name,
        alias_lower: name.toLowerCase(),
        is_primary: true,
      }).run();
    });
    
    this.handleCache.set(normalized, personId);
    return personId;
  }
  
  /**
   * Resolve a query (name, alias, or handle) to a person.
   * Used by the agent for lookups.
   */
  async resolvePerson(query: string): Promise<ResolveResult> {
    const queryLower = query.toLowerCase().trim();
    const queryNormalized = normalizeHandle(query);
    
    // 1. Try exact handle match first
    const handleMatch = this.db.select()
      .from(handles)
      .where(eq(handles.handle_normalized, queryNormalized))
      .get();
    
    if (handleMatch) {
      const person = await this.getPersonWithDetails(handleMatch.person_id);
      if (person) {
        return { found: true, person };
      }
    }
    
    // 2. Try exact alias match (case-insensitive)
    const aliasMatch = this.db.select()
      .from(aliases)
      .where(eq(aliases.alias_lower, queryLower))
      .get();
    
    if (aliasMatch) {
      const person = await this.getPersonWithDetails(aliasMatch.person_id);
      if (person) {
        return { found: true, person };
      }
    }
    
    // 3. Try fuzzy name match
    const fuzzyMatches = this.db.select()
      .from(people)
      .where(like(people.name, `%${query}%`))
      .limit(5)
      .all();
    
    if (fuzzyMatches.length === 1) {
      const person = await this.getPersonWithDetails(fuzzyMatches[0].id);
      if (person) {
        return { found: true, person };
      }
    }
    
    if (fuzzyMatches.length > 1) {
      return {
        found: false,
        suggestions: fuzzyMatches.map(p => p.name),
      };
    }
    
    // 4. Try fuzzy alias match
    const fuzzyAliasMatches = this.db.select({
      person_id: aliases.person_id,
      alias: aliases.alias,
    })
      .from(aliases)
      .where(like(aliases.alias_lower, `%${queryLower}%`))
      .limit(5)
      .all();
    
    if (fuzzyAliasMatches.length > 0) {
      const uniquePersonIds = [...new Set(fuzzyAliasMatches.map(a => a.person_id))];
      
      if (uniquePersonIds.length === 1) {
        const person = await this.getPersonWithDetails(uniquePersonIds[0]);
        if (person) {
          return { found: true, person };
        }
      }
      
      // Return suggestions
      const suggestions = await Promise.all(
        uniquePersonIds.slice(0, 5).map(async (id) => {
          const p = this.db.select().from(people).where(eq(people.id, id)).get();
          return p?.name || '';
        })
      );
      
      return {
        found: false,
        suggestions: suggestions.filter(Boolean),
      };
    }
    
    return { found: false };
  }
  
  /**
   * Get a person with all their details
   */
  async getPersonWithDetails(personId: string): Promise<PersonWithDetails | null> {
    const person = this.db.select().from(people).where(eq(people.id, personId)).get();
    if (!person) return null;
    
    const personHandles = this.db.select().from(handles).where(eq(handles.person_id, personId)).all();
    const personAliases = this.db.select().from(aliases).where(eq(aliases.person_id, personId)).all();
    const personAttrs = this.db.select().from(person_attributes).where(eq(person_attributes.person_id, personId)).all();
    
    // Get relationships with other person names
    const personRels = this.db.select({
      rel: relationships,
      other_name: people.name,
    })
      .from(relationships)
      .leftJoin(people, eq(relationships.to_person_id, people.id))
      .where(eq(relationships.from_person_id, personId))
      .all();
    
    const relsWithNames = personRels.map(r => ({
      ...r.rel,
      other_person_name: r.other_name || 'Unknown',
    }));
    
    return {
      ...person,
      handles: personHandles,
      aliases: personAliases,
      relationships: relsWithNames,
      attributes: personAttrs,
    };
  }
  
  /**
   * Get person by ID
   */
  async getPerson(personId: string): Promise<Person | null> {
    return this.db.select().from(people).where(eq(people.id, personId)).get() || null;
  }
  
  /**
   * List all people
   */
  async listPeople(options?: {
    autoCreatedOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<Person[]> {
    let query = this.db.select().from(people);
    
    if (options?.autoCreatedOnly) {
      query = query.where(eq(people.auto_created, true)) as typeof query;
    }
    
    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    
    if (options?.offset) {
      query = query.offset(options.offset) as typeof query;
    }
    
    return query.all();
  }
  
  /**
   * Update a person's name
   */
  async updatePersonName(personId: string, name: string): Promise<void> {
    this.db.update(people)
      .set({ name, updated_at: new Date().toISOString(), auto_created: false })
      .where(eq(people.id, personId))
      .run();
  }
  
  /**
   * Update a person's notes
   */
  async updatePersonNotes(personId: string, notes: string): Promise<void> {
    this.db.update(people)
      .set({ notes, updated_at: new Date().toISOString(), auto_created: false })
      .where(eq(people.id, personId))
      .run();
  }
  
  /**
   * Add an alias to a person
   */
  async addAlias(personId: string, alias: string, isPrimary: boolean = false): Promise<void> {
    // Check if alias already exists for this person
    const existing = this.db.select()
      .from(aliases)
      .where(and(
        eq(aliases.person_id, personId),
        eq(aliases.alias_lower, alias.toLowerCase())
      ))
      .get();
    
    if (existing) return;
    
    this.db.insert(aliases).values({
      id: randomUUID(),
      person_id: personId,
      alias,
      alias_lower: alias.toLowerCase(),
      is_primary: isPrimary,
    }).run();
    
    // Mark person as enriched
    this.db.update(people)
      .set({ auto_created: false, updated_at: new Date().toISOString() })
      .where(eq(people.id, personId))
      .run();
  }
  
  /**
   * Add a handle to a person
   */
  async addHandle(personId: string, handle: string): Promise<void> {
    const type = inferHandleType(handle);
    const normalized = normalizeHandle(handle, type);
    
    // Check if handle already exists (globally unique)
    const existing = this.db.select()
      .from(handles)
      .where(eq(handles.handle_normalized, normalized))
      .get();
    
    if (existing) {
      if (existing.person_id !== personId) {
        throw new Error(`Handle ${handle} already belongs to another person`);
      }
      return; // Already exists for this person
    }
    
    this.db.insert(handles).values({
      id: randomUUID(),
      person_id: personId,
      handle,
      handle_normalized: normalized,
      type,
    }).run();
    
    this.handleCache.set(normalized, personId);
  }
  
  /**
   * Add a relationship between two people (adds to both sides)
   */
  async addRelationship(
    fromPersonId: string,
    toPersonId: string,
    type: RelationshipType,
    description?: string
  ): Promise<void> {
    // Validate relationship type
    if (!RELATIONSHIP_TYPES.includes(type)) {
      throw new Error(`Invalid relationship type: ${type}`);
    }
    
    this.db.transaction((tx) => {
      // Add forward relationship
      tx.insert(relationships)
        .values({
          id: randomUUID(),
          from_person_id: fromPersonId,
          to_person_id: toPersonId,
          type,
          description,
        })
        .onConflictDoNothing()
        .run();
      
      // Add reverse relationship
      tx.insert(relationships)
        .values({
          id: randomUUID(),
          from_person_id: toPersonId,
          to_person_id: fromPersonId,
          type,
          description,
        })
        .onConflictDoNothing()
        .run();
      
      // Mark both as enriched
      const now = new Date().toISOString();
      tx.update(people)
        .set({ auto_created: false, updated_at: now })
        .where(eq(people.id, fromPersonId))
        .run();
      tx.update(people)
        .set({ auto_created: false, updated_at: now })
        .where(eq(people.id, toPersonId))
        .run();
    });
  }
  
  /**
   * Set a person attribute (upsert)
   */
  async setAttribute(personId: string, key: string, value: string): Promise<void> {
    // Check if attribute exists
    const existing = this.db.select()
      .from(person_attributes)
      .where(and(
        eq(person_attributes.person_id, personId),
        eq(person_attributes.key, key)
      ))
      .get();
    
    if (existing) {
      this.db.update(person_attributes)
        .set({ value })
        .where(eq(person_attributes.id, existing.id))
        .run();
    } else {
      this.db.insert(person_attributes).values({
        id: randomUUID(),
        person_id: personId,
        key,
        value,
      }).run();
    }
    
    // Mark person as enriched
    this.db.update(people)
      .set({ auto_created: false, updated_at: new Date().toISOString() })
      .where(eq(people.id, personId))
      .run();
  }
  
  /**
   * Merge two people (keep one, merge the other into it)
   */
  async mergePeople(keepId: string, mergeId: string): Promise<{
    mergedHandles: number;
    mergedAliases: number;
    mergedRelationships: number;
  }> {
    let mergedHandles = 0;
    let mergedAliases = 0;
    let mergedRelationships = 0;
    
    this.db.transaction((tx) => {
      // Move handles
      const handleResults = tx.update(handles)
        .set({ person_id: keepId })
        .where(eq(handles.person_id, mergeId))
        .run();
      mergedHandles = handleResults.changes;
      
      // Move aliases (skip duplicates)
      const mergeAliases = tx.select().from(aliases).where(eq(aliases.person_id, mergeId)).all();
      for (const a of mergeAliases) {
        const exists = tx.select()
          .from(aliases)
          .where(and(
            eq(aliases.person_id, keepId),
            eq(aliases.alias_lower, a.alias_lower)
          ))
          .get();
        
        if (!exists) {
          tx.update(aliases)
            .set({ person_id: keepId })
            .where(eq(aliases.id, a.id))
            .run();
          mergedAliases++;
        }
      }
      
      // Move relationships (update references)
      const relResults1 = tx.update(relationships)
        .set({ from_person_id: keepId })
        .where(eq(relationships.from_person_id, mergeId))
        .run();
      const relResults2 = tx.update(relationships)
        .set({ to_person_id: keepId })
        .where(eq(relationships.to_person_id, mergeId))
        .run();
      mergedRelationships = relResults1.changes + relResults2.changes;
      
      // Move attributes (skip duplicates)
      const mergeAttrs = tx.select().from(person_attributes).where(eq(person_attributes.person_id, mergeId)).all();
      for (const a of mergeAttrs) {
        const exists = tx.select()
          .from(person_attributes)
          .where(and(
            eq(person_attributes.person_id, keepId),
            eq(person_attributes.key, a.key)
          ))
          .get();
        
        if (!exists) {
          tx.update(person_attributes)
            .set({ person_id: keepId })
            .where(eq(person_attributes.id, a.id))
            .run();
        }
      }
      
      // Delete merged person (cascades to remaining handles, aliases, etc.)
      tx.delete(people).where(eq(people.id, mergeId)).run();
    });
    
    // Update cache
    for (const [handle, personId] of this.handleCache.entries()) {
      if (personId === mergeId) {
        this.handleCache.set(handle, keepId);
      }
    }
    
    return { mergedHandles, mergedAliases, mergedRelationships };
  }
  
  /**
   * Get count of people
   */
  async count(): Promise<number> {
    const result = this.db.select({ count: sql<number>`count(*)` }).from(people).get();
    return result?.count || 0;
  }
  
  /**
   * Close the database connection
   */
  close(): void {
    this.sqlite.close();
  }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

let instance: PeopleGraph | null = null;

export function getPeopleGraph(dbPath?: string): PeopleGraph {
  if (!instance) {
    instance = new PeopleGraph(dbPath);
  }
  return instance;
}

export function closePeopleGraph(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

