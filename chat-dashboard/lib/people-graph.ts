/**
 * People Graph Client for Dashboard
 * 
 * Wraps the People Graph for use in the Next.js dashboard.
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';

// Configuration
const PEOPLE_DB_PATH = process.env.PEOPLE_DB_PATH || '../data/people.db';

// Types
interface Person {
  id: string;
  name: string;
  notes: string | null;
  is_owner: boolean;
  auto_created: boolean;
  created_at: string;
  updated_at: string;
}

interface Handle {
  id: string;
  person_id: string;
  handle: string;
  handle_normalized: string;
  type: string;
}

interface Alias {
  id: string;
  person_id: string;
  alias: string;
  alias_lower: string;
  is_primary: boolean;
}

interface Relationship {
  id: string;
  from_person_id: string;
  to_person_id: string;
  type: string;
  description: string | null;
  created_at: string;
}

interface PersonAttribute {
  id: string;
  person_id: string;
  key: string;
  value: string;
}

export interface PersonWithDetails extends Person {
  handles: Handle[];
  aliases: Alias[];
  relationships: Array<Relationship & { other_person_name: string }>;
  attributes: PersonAttribute[];
}

export interface ResolveResult {
  found: boolean;
  person?: PersonWithDetails;
  suggestions?: string[];
}

// Database singleton
let db: Database.Database | null = null;

function getDb(): Database.Database | null {
  if (db) return db;
  
  if (!existsSync(PEOPLE_DB_PATH)) {
    console.warn(`People Graph database not found at ${PEOPLE_DB_PATH}`);
    return null;
  }
  
  try {
    db = new Database(PEOPLE_DB_PATH, { readonly: true });
    return db;
  } catch (err) {
    console.error('Failed to open People Graph database:', err);
    return null;
  }
}

/**
 * Normalize a handle for consistent lookups
 */
function normalizeHandle(handle: string): string {
  if (handle.includes('@')) {
    return handle.toLowerCase().trim();
  }
  // Phone: Strip all non-digits
  const digits = handle.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Get person by ID with all details
 */
export function getPersonWithDetails(personId: string): PersonWithDetails | null {
  const database = getDb();
  if (!database) return null;
  
  const person = database.prepare('SELECT * FROM people WHERE id = ?').get(personId) as Person | undefined;
  if (!person) return null;
  
  const handles = database.prepare('SELECT * FROM handles WHERE person_id = ?').all(personId) as Handle[];
  const aliases = database.prepare('SELECT * FROM aliases WHERE person_id = ?').all(personId) as Alias[];
  const attributes = database.prepare('SELECT * FROM person_attributes WHERE person_id = ?').all(personId) as PersonAttribute[];
  
  // Get relationships with other person names
  const relationships = database.prepare(`
    SELECT r.*, p.name as other_person_name
    FROM relationships r
    LEFT JOIN people p ON r.to_person_id = p.id
    WHERE r.from_person_id = ?
  `).all(personId) as Array<Relationship & { other_person_name: string }>;
  
  return {
    ...person,
    handles,
    aliases,
    relationships,
    attributes,
  };
}

/**
 * Resolve a query (name, alias, or handle) to a person
 */
export function resolvePerson(query: string): ResolveResult {
  const database = getDb();
  if (!database) return { found: false };
  
  const queryLower = query.toLowerCase().trim();
  const queryNormalized = normalizeHandle(query);
  
  // 1. Try exact handle match
  const handleMatch = database.prepare(
    'SELECT person_id FROM handles WHERE handle_normalized = ?'
  ).get(queryNormalized) as { person_id: string } | undefined;
  
  if (handleMatch) {
    const person = getPersonWithDetails(handleMatch.person_id);
    if (person) return { found: true, person };
  }
  
  // 2. Try exact alias match
  const aliasMatch = database.prepare(
    'SELECT person_id FROM aliases WHERE alias_lower = ?'
  ).get(queryLower) as { person_id: string } | undefined;
  
  if (aliasMatch) {
    const person = getPersonWithDetails(aliasMatch.person_id);
    if (person) return { found: true, person };
  }
  
  // 3. Try fuzzy name match
  const fuzzyMatches = database.prepare(
    'SELECT id, name FROM people WHERE name LIKE ? LIMIT 5'
  ).all(`%${query}%`) as { id: string; name: string }[];
  
  if (fuzzyMatches.length === 1) {
    const person = getPersonWithDetails(fuzzyMatches[0].id);
    if (person) return { found: true, person };
  }
  
  if (fuzzyMatches.length > 1) {
    return { found: false, suggestions: fuzzyMatches.map(p => p.name) };
  }
  
  // 4. Try fuzzy alias match
  const fuzzyAliasMatches = database.prepare(
    'SELECT DISTINCT person_id FROM aliases WHERE alias_lower LIKE ? LIMIT 5'
  ).all(`%${queryLower}%`) as { person_id: string }[];
  
  if (fuzzyAliasMatches.length === 1) {
    const person = getPersonWithDetails(fuzzyAliasMatches[0].person_id);
    if (person) return { found: true, person };
  }
  
  if (fuzzyAliasMatches.length > 1) {
    const suggestions = fuzzyAliasMatches.map(a => {
      const p = database.prepare('SELECT name FROM people WHERE id = ?').get(a.person_id) as { name: string } | undefined;
      return p?.name || '';
    }).filter(Boolean);
    return { found: false, suggestions };
  }
  
  return { found: false };
}

/**
 * List all people
 */
export function listPeople(options?: {
  autoCreatedOnly?: boolean;
  limit?: number;
}): Person[] {
  const database = getDb();
  if (!database) return [];
  
  let query = 'SELECT * FROM people';
  const params: unknown[] = [];
  
  if (options?.autoCreatedOnly) {
    query += ' WHERE auto_created = 1';
  }
  
  query += ' ORDER BY name ASC';
  
  if (options?.limit) {
    query += ' LIMIT ?';
    params.push(options.limit);
  }
  
  return database.prepare(query).all(...params) as Person[];
}

/**
 * Get the owner person
 */
export function getOwner(): Person | null {
  const database = getDb();
  if (!database) return null;
  
  return database.prepare('SELECT * FROM people WHERE is_owner = 1').get() as Person | undefined || null;
}

/**
 * Get count of people
 */
export function getPeopleCount(): number {
  const database = getDb();
  if (!database) return 0;
  
  const result = database.prepare('SELECT COUNT(*) as count FROM people').get() as { count: number };
  return result.count;
}

/**
 * Check if database is available
 */
export function isAvailable(): boolean {
  return existsSync(PEOPLE_DB_PATH);
}

