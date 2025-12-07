/**
 * Chat Graph Client
 * 
 * Provides CRUD operations and resolution for the Chat Graph.
 * Handles mapping of iMessage chat GUIDs to stable Chat UUIDs.
 */

import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, like, and, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import * as schema from './schema.js';
import {
  chats,
  chat_aliases,
  chat_participants,
  people,
  Chat,
  ChatAlias,
  ChatParticipant,
} from './schema.js';

// ============================================================
// TYPES
// ============================================================

export interface ChatWithDetails extends Chat {
  aliases: ChatAlias[];
  participants: Array<{
    person_id: string;
    person_name: string;
    joined_at: string | null;
    left_at: string | null;
  }>;
}

export interface ChatContext extends ChatWithDetails {
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

export interface ResolveChatResult {
  found: boolean;
  chat?: ChatWithDetails;
  suggestions?: string[];
}

// ============================================================
// CHAT GRAPH CLIENT
// ============================================================

export class ChatGraph {
  private db: BetterSQLite3Database<typeof schema>;
  private sqlite: Database.Database;
  
  // In-memory cache for hot path (chat lookups during indexing)
  private imessageIdCache = new Map<string, string>(); // imessage_id → chat_id
  
  constructor(dbPath: string = './data/people.db') {
    this.sqlite = new Database(dbPath);
    this.db = drizzle(this.sqlite, { schema });
    
    // Enable foreign keys
    this.sqlite.pragma('foreign_keys = ON');
  }
  
  /**
   * Initialize the database and load cache
   */
  async initialize(): Promise<void> {
    await this.loadCache();
  }
  
  /**
   * Load cache for fast lookups
   */
  private async loadCache(): Promise<void> {
    const allChats = this.db.select({
      imessage_id: chats.imessage_id,
      id: chats.id,
    }).from(chats).all();
    
    this.imessageIdCache.clear();
    for (const c of allChats) {
      this.imessageIdCache.set(c.imessage_id, c.id);
    }
  }
  
  /**
   * Resolve an iMessage chat GUID to a chat ID, or create a new chat if not found.
   * This is the main method used during indexing.
   */
  async resolveOrCreate(
    imessageId: string,
    displayName?: string | null,
    isGroupChat?: boolean
  ): Promise<string> {
    // Check cache first (hot path)
    const cached = this.imessageIdCache.get(imessageId);
    if (cached) {
      return cached;
    }
    
    // Check database
    const existing = this.db.select()
      .from(chats)
      .where(eq(chats.imessage_id, imessageId))
      .get();
    
    if (existing) {
      this.imessageIdCache.set(imessageId, existing.id);
      return existing.id;
    }
    
    // Create new chat
    const chatId = randomUUID();
    
    this.db.transaction((tx) => {
      // Create chat
      tx.insert(chats).values({
        id: chatId,
        imessage_id: imessageId,
        display_name: displayName,
        is_group_chat: isGroupChat ?? false,
        auto_created: true,
      }).run();
      
      // If there's a display name, add it as an alias
      if (displayName) {
        tx.insert(chat_aliases).values({
          id: randomUUID(),
          chat_id: chatId,
          alias: displayName,
          alias_lower: displayName.toLowerCase(),
        }).run();
      }
    });
    
    this.imessageIdCache.set(imessageId, chatId);
    return chatId;
  }
  
  /**
   * Ensure participants are linked to a chat
   */
  async ensureParticipants(chatId: string, participantIds: string[]): Promise<void> {
    for (const personId of participantIds) {
      // Check if already exists
      const existing = this.db.select()
        .from(chat_participants)
        .where(and(
          eq(chat_participants.chat_id, chatId),
          eq(chat_participants.person_id, personId)
        ))
        .get();
      
      if (!existing) {
        this.db.insert(chat_participants).values({
          id: randomUUID(),
          chat_id: chatId,
          person_id: personId,
        }).onConflictDoNothing().run();
      }
    }
  }
  
  /**
   * Resolve a query (name or alias) to a chat.
   * Used by the agent for lookups.
   */
  async resolveChat(query: string): Promise<ResolveChatResult> {
    const queryLower = query.toLowerCase().trim();
    
    // 1. Try exact display name match
    const nameMatch = this.db.select()
      .from(chats)
      .where(eq(sql`lower(${chats.display_name})`, queryLower))
      .get();
    
    if (nameMatch) {
      const chat = await this.getChatWithDetails(nameMatch.id);
      if (chat) {
        return { found: true, chat };
      }
    }
    
    // 2. Try exact alias match
    const aliasMatch = this.db.select()
      .from(chat_aliases)
      .where(eq(chat_aliases.alias_lower, queryLower))
      .get();
    
    if (aliasMatch) {
      const chat = await this.getChatWithDetails(aliasMatch.chat_id);
      if (chat) {
        return { found: true, chat };
      }
    }
    
    // 3. Try fuzzy name match
    const fuzzyMatches = this.db.select()
      .from(chats)
      .where(like(chats.display_name, `%${query}%`))
      .limit(5)
      .all();
    
    if (fuzzyMatches.length === 1) {
      const chat = await this.getChatWithDetails(fuzzyMatches[0].id);
      if (chat) {
        return { found: true, chat };
      }
    }
    
    if (fuzzyMatches.length > 1) {
      return {
        found: false,
        suggestions: fuzzyMatches.map(c => c.display_name || c.imessage_id),
      };
    }
    
    // 4. Try fuzzy alias match
    const fuzzyAliasMatches = this.db.select({
      chat_id: chat_aliases.chat_id,
      alias: chat_aliases.alias,
    })
      .from(chat_aliases)
      .where(like(chat_aliases.alias_lower, `%${queryLower}%`))
      .limit(5)
      .all();
    
    if (fuzzyAliasMatches.length > 0) {
      const uniqueChatIds = [...new Set(fuzzyAliasMatches.map(a => a.chat_id))];
      
      if (uniqueChatIds.length === 1) {
        const chat = await this.getChatWithDetails(uniqueChatIds[0]);
        if (chat) {
          return { found: true, chat };
        }
      }
      
      // Return suggestions
      const suggestions = await Promise.all(
        uniqueChatIds.slice(0, 5).map(async (id) => {
          const c = this.db.select().from(chats).where(eq(chats.id, id)).get();
          return c?.display_name || c?.imessage_id || '';
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
   * Get a chat with all its details
   */
  async getChatWithDetails(chatId: string): Promise<ChatWithDetails | null> {
    const chat = this.db.select().from(chats).where(eq(chats.id, chatId)).get();
    if (!chat) return null;
    
    const chatAliases = this.db.select().from(chat_aliases).where(eq(chat_aliases.chat_id, chatId)).all();
    
    // Get participants with person names
    const participants = this.db.select({
      person_id: chat_participants.person_id,
      person_name: people.name,
      joined_at: chat_participants.joined_at,
      left_at: chat_participants.left_at,
    })
      .from(chat_participants)
      .leftJoin(people, eq(chat_participants.person_id, people.id))
      .where(eq(chat_participants.chat_id, chatId))
      .all();
    
    return {
      ...chat,
      aliases: chatAliases,
      participants: participants.map(p => ({
        person_id: p.person_id,
        person_name: p.person_name || 'Unknown',
        joined_at: p.joined_at,
        left_at: p.left_at,
      })),
    };
  }
  
  /**
   * Get chat by ID
   */
  async getChat(chatId: string): Promise<Chat | null> {
    return this.db.select().from(chats).where(eq(chats.id, chatId)).get() || null;
  }
  
  /**
   * List all chats
   */
  async listChats(options?: {
    personId?: string;
    isGroupChat?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<Chat[]> {
    if (options?.personId) {
      // Get chats for a specific person
      const participantChats = this.db.select({
        chat: chats,
      })
        .from(chat_participants)
        .innerJoin(chats, eq(chat_participants.chat_id, chats.id))
        .where(eq(chat_participants.person_id, options.personId))
        .all();
      
      let result = participantChats.map(pc => pc.chat);
      
      if (options.isGroupChat !== undefined) {
        result = result.filter(c => c.is_group_chat === options.isGroupChat);
      }
      
      if (options.limit) {
        result = result.slice(0, options.limit);
      }
      
      return result;
    }
    
    let query = this.db.select().from(chats);
    
    if (options?.isGroupChat !== undefined) {
      query = query.where(eq(chats.is_group_chat, options.isGroupChat)) as typeof query;
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
   * Get chats for a person
   */
  async getChatsForPerson(personId: string): Promise<ChatWithDetails[]> {
    const participantChats = this.db.select({
      chat_id: chat_participants.chat_id,
    })
      .from(chat_participants)
      .where(eq(chat_participants.person_id, personId))
      .all();
    
    const chatDetails = await Promise.all(
      participantChats.map(pc => this.getChatWithDetails(pc.chat_id))
    );
    
    return chatDetails.filter((c): c is ChatWithDetails => c !== null);
  }
  
  /**
   * Update a chat's display name
   */
  async updateChatName(chatId: string, displayName: string): Promise<void> {
    this.db.update(chats)
      .set({ display_name: displayName, updated_at: new Date().toISOString(), auto_created: false })
      .where(eq(chats.id, chatId))
      .run();
  }
  
  /**
   * Update a chat's notes
   */
  async updateChatNotes(chatId: string, notes: string): Promise<void> {
    this.db.update(chats)
      .set({ notes, updated_at: new Date().toISOString(), auto_created: false })
      .where(eq(chats.id, chatId))
      .run();
  }
  
  /**
   * Add an alias to a chat
   */
  async addAlias(chatId: string, alias: string): Promise<void> {
    // Check if alias already exists for this chat
    const existing = this.db.select()
      .from(chat_aliases)
      .where(and(
        eq(chat_aliases.chat_id, chatId),
        eq(chat_aliases.alias_lower, alias.toLowerCase())
      ))
      .get();
    
    if (existing) return;
    
    this.db.insert(chat_aliases).values({
      id: randomUUID(),
      chat_id: chatId,
      alias,
      alias_lower: alias.toLowerCase(),
    }).run();
    
    // Mark chat as enriched
    this.db.update(chats)
      .set({ auto_created: false, updated_at: new Date().toISOString() })
      .where(eq(chats.id, chatId))
      .run();
  }
  
  /**
   * Add a participant to a chat
   */
  async addParticipant(chatId: string, personId: string): Promise<void> {
    // Check if already exists
    const existing = this.db.select()
      .from(chat_participants)
      .where(and(
        eq(chat_participants.chat_id, chatId),
        eq(chat_participants.person_id, personId)
      ))
      .get();
    
    if (existing) {
      // If they left and are rejoining, clear left_at
      if (existing.left_at) {
        this.db.update(chat_participants)
          .set({ left_at: null })
          .where(eq(chat_participants.id, existing.id))
          .run();
      }
      return;
    }
    
    this.db.insert(chat_participants).values({
      id: randomUUID(),
      chat_id: chatId,
      person_id: personId,
      joined_at: new Date().toISOString(),
    }).run();
  }
  
  /**
   * Remove a participant from a chat (marks as left, doesn't delete)
   */
  async removeParticipant(chatId: string, personId: string): Promise<void> {
    this.db.update(chat_participants)
      .set({ left_at: new Date().toISOString() })
      .where(and(
        eq(chat_participants.chat_id, chatId),
        eq(chat_participants.person_id, personId)
      ))
      .run();
  }
  
  /**
   * Get count of chats
   */
  async count(): Promise<{ total: number; group: number; dm: number }> {
    const total = this.db.select({ count: sql<number>`count(*)` }).from(chats).get();
    const group = this.db.select({ count: sql<number>`count(*)` })
      .from(chats)
      .where(eq(chats.is_group_chat, true))
      .get();
    
    const totalCount = total?.count || 0;
    const groupCount = group?.count || 0;
    
    return {
      total: totalCount,
      group: groupCount,
      dm: totalCount - groupCount,
    };
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

let instance: ChatGraph | null = null;

export function getChatGraph(dbPath?: string): ChatGraph {
  if (!instance) {
    instance = new ChatGraph(dbPath);
  }
  return instance;
}

export function closeChatGraph(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

