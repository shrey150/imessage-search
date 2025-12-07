/**
 * Memories Elasticsearch Client
 * 
 * Manages the imessage_memories index for storing persistent learnings.
 * Supports semantic search over memories linked to people and chats.
 */

import { Client } from '@elastic/elasticsearch';
import { randomUUID } from 'crypto';
import { log } from '../utils/progress.js';

// Configuration
const MEMORIES_INDEX_NAME = 'imessage_memories';
const DEFAULT_ES_URL = 'http://localhost:9200';
const EMBEDDING_DIMS = 1536; // OpenAI text-embedding-3-small

// ============================================================
// TYPES
// ============================================================

export interface Memory {
  id: string;
  content: string;
  
  // Person/Chat links
  related_people: string[];       // Person UUIDs
  related_people_names: string[]; // Denormalized for display
  related_chats: string[];        // Chat UUIDs
  related_chat_names: string[];   // Denormalized for display
  
  // Categorization
  tags: string[];
  category: MemoryCategory;
  
  // Provenance
  source?: string;
  created_by: 'agent' | 'user';
  
  // Retrieval
  embedding?: number[];
  importance: number; // 1-5
  
  // Lifecycle
  expires_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export type MemoryCategory = 'fact' | 'preference' | 'event' | 'relationship';

export interface CreateMemoryInput {
  content: string;
  related_people?: string[];
  related_people_names?: string[];
  related_chats?: string[];
  related_chat_names?: string[];
  tags?: string[];
  category?: MemoryCategory;
  source?: string;
  created_by?: 'agent' | 'user';
  embedding?: number[];
  importance?: number;
  expires_at?: Date;
}

export interface SearchMemoriesInput {
  query?: string;
  queryEmbedding?: number[];
  person_id?: string;
  chat_id?: string;
  category?: MemoryCategory;
  tags?: string[];
  limit?: number;
  include_expired?: boolean;
}

export interface MemorySearchResult {
  id: string;
  score: number;
  memory: Memory;
}

// ============================================================
// INDEX MAPPING
// ============================================================

const MEMORIES_INDEX_MAPPING = {
  mappings: {
    properties: {
      content: { 
        type: 'text' as const, 
        analyzer: 'english',
        fields: {
          exact: { type: 'keyword' as const }
        }
      },
      
      // Person/Chat links
      related_people: { type: 'keyword' as const },
      related_people_names: { type: 'keyword' as const },
      related_chats: { type: 'keyword' as const },
      related_chat_names: { type: 'keyword' as const },
      
      // Categorization
      tags: { type: 'keyword' as const },
      category: { type: 'keyword' as const },
      
      // Provenance
      source: { type: 'text' as const },
      created_by: { type: 'keyword' as const },
      
      // Retrieval
      embedding: {
        type: 'dense_vector' as const,
        dims: EMBEDDING_DIMS,
        index: true,
        similarity: 'cosine' as const
      },
      importance: { type: 'integer' as const },
      
      // Lifecycle
      expires_at: { type: 'date' as const },
      created_at: { type: 'date' as const },
      updated_at: { type: 'date' as const },
    }
  },
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
  }
};

// ============================================================
// MEMORIES CLIENT
// ============================================================

export class MemoriesDB {
  private client: Client;
  private initialized = false;
  
  constructor(url?: string) {
    this.client = new Client({
      node: url || process.env.ELASTICSEARCH_URL || DEFAULT_ES_URL,
    });
  }
  
  /**
   * Initialize the index (create if not exists)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      const exists = await this.client.indices.exists({ index: MEMORIES_INDEX_NAME });
      
      if (!exists) {
        log('Memories', `Creating index ${MEMORIES_INDEX_NAME}...`);
        await this.client.indices.create({
          index: MEMORIES_INDEX_NAME,
          ...MEMORIES_INDEX_MAPPING
        });
        log('Memories', `Index ${MEMORIES_INDEX_NAME} created`, 'success');
      }
      
      this.initialized = true;
    } catch (err) {
      log('Memories', `Failed to initialize: ${err}`, 'error');
      throw err;
    }
  }
  
  /**
   * Create a new memory
   */
  async createMemory(input: CreateMemoryInput): Promise<Memory> {
    await this.initialize();
    
    const now = new Date();
    const memory: Memory = {
      id: randomUUID(),
      content: input.content,
      related_people: input.related_people || [],
      related_people_names: input.related_people_names || [],
      related_chats: input.related_chats || [],
      related_chat_names: input.related_chat_names || [],
      tags: input.tags || [],
      category: input.category || 'fact',
      source: input.source,
      created_by: input.created_by || 'agent',
      embedding: input.embedding,
      importance: input.importance || 3,
      expires_at: input.expires_at,
      created_at: now,
      updated_at: now,
    };
    
    await this.client.index({
      index: MEMORIES_INDEX_NAME,
      id: memory.id,
      document: memory,
      refresh: true,
    });
    
    return memory;
  }
  
  /**
   * Get a memory by ID
   */
  async getMemory(id: string): Promise<Memory | null> {
    await this.initialize();
    
    try {
      const response = await this.client.get({
        index: MEMORIES_INDEX_NAME,
        id,
        _source_excludes: ['embedding'],
      });
      return response._source as Memory;
    } catch {
      return null;
    }
  }
  
  /**
   * Update a memory
   */
  async updateMemory(id: string, updates: Partial<CreateMemoryInput>): Promise<Memory | null> {
    await this.initialize();
    
    try {
      await this.client.update({
        index: MEMORIES_INDEX_NAME,
        id,
        doc: {
          ...updates,
          updated_at: new Date(),
        },
        refresh: true,
      });
      
      return this.getMemory(id);
    } catch {
      return null;
    }
  }
  
  /**
   * Delete a memory
   */
  async deleteMemory(id: string): Promise<boolean> {
    await this.initialize();
    
    try {
      await this.client.delete({
        index: MEMORIES_INDEX_NAME,
        id,
        refresh: true,
      });
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Search memories with optional semantic search
   */
  async searchMemories(input: SearchMemoriesInput): Promise<MemorySearchResult[]> {
    await this.initialize();
    
    const {
      query,
      queryEmbedding,
      person_id,
      chat_id,
      category,
      tags,
      limit = 10,
      include_expired = false,
    } = input;
    
    const must: Array<Record<string, unknown>> = [];
    const should: Array<Record<string, unknown>> = [];
    const filter: Array<Record<string, unknown>> = [];
    
    // Text search
    if (query) {
      should.push({
        match: {
          content: {
            query,
            boost: 1.0,
          }
        }
      });
    }
    
    // Semantic search
    if (queryEmbedding) {
      should.push({
        script_score: {
          query: { match_all: {} },
          script: {
            source: "doc['embedding'].size() != 0 ? cosineSimilarity(params.query_vector, 'embedding') + 1.0 : 0",
            params: { query_vector: queryEmbedding }
          }
        }
      });
    }
    
    // Filters
    if (person_id) {
      filter.push({ term: { related_people: person_id } });
    }
    
    if (chat_id) {
      filter.push({ term: { related_chats: chat_id } });
    }
    
    if (category) {
      filter.push({ term: { category } });
    }
    
    if (tags && tags.length > 0) {
      filter.push({ terms: { tags } });
    }
    
    // Exclude expired memories unless requested
    if (!include_expired) {
      filter.push({
        bool: {
          should: [
            { bool: { must_not: { exists: { field: 'expires_at' } } } },
            { range: { expires_at: { gte: 'now' } } },
          ],
          minimum_should_match: 1,
        }
      });
    }
    
    // Build query
    const boolQuery: Record<string, unknown> = {};
    
    if (must.length > 0) boolQuery.must = must;
    if (should.length > 0) {
      boolQuery.should = should;
      boolQuery.minimum_should_match = query || queryEmbedding ? 1 : 0;
    }
    if (filter.length > 0) boolQuery.filter = filter;
    
    // Execute search
    const response = await this.client.search({
      index: MEMORIES_INDEX_NAME,
      query: Object.keys(boolQuery).length > 0 ? { bool: boolQuery } : { match_all: {} },
      size: limit,
      sort: [
        { importance: 'desc' },
        { created_at: 'desc' },
      ],
      _source: { excludes: ['embedding'] },
    });
    
    return response.hits.hits.map(hit => ({
      id: hit._id!,
      score: hit._score || 0,
      memory: hit._source as Memory,
    }));
  }
  
  /**
   * Get memories for a specific person
   */
  async getMemoriesForPerson(personId: string, limit: number = 20): Promise<Memory[]> {
    const results = await this.searchMemories({
      person_id: personId,
      limit,
    });
    return results.map(r => r.memory);
  }
  
  /**
   * Get memories for a specific chat
   */
  async getMemoriesForChat(chatId: string, limit: number = 20): Promise<Memory[]> {
    const results = await this.searchMemories({
      chat_id: chatId,
      limit,
    });
    return results.map(r => r.memory);
  }
  
  /**
   * Get recent memories
   */
  async getRecentMemories(limit: number = 10): Promise<Memory[]> {
    await this.initialize();
    
    const response = await this.client.search({
      index: MEMORIES_INDEX_NAME,
      query: {
        bool: {
          should: [
            { bool: { must_not: { exists: { field: 'expires_at' } } } },
            { range: { expires_at: { gte: 'now' } } },
          ],
          minimum_should_match: 1,
        }
      },
      size: limit,
      sort: [{ created_at: 'desc' }],
      _source: { excludes: ['embedding'] },
    });
    
    return response.hits.hits.map(hit => hit._source as Memory);
  }
  
  /**
   * Get memory count
   */
  async count(): Promise<number> {
    await this.initialize();
    
    const response = await this.client.count({
      index: MEMORIES_INDEX_NAME,
    });
    
    return response.count;
  }
  
  /**
   * Clear all memories (use with caution!)
   */
  async clear(): Promise<void> {
    try {
      await this.client.indices.delete({ index: MEMORIES_INDEX_NAME });
      this.initialized = false;
      log('Memories', 'Index cleared', 'success');
    } catch {
      // Index might not exist
    }
  }
  
  /**
   * Check if index exists
   */
  async indexExists(): Promise<boolean> {
    try {
      return await this.client.indices.exists({ index: MEMORIES_INDEX_NAME });
    } catch {
      return false;
    }
  }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

let instance: MemoriesDB | null = null;

export function getMemoriesDB(url?: string): MemoriesDB {
  if (!instance) {
    instance = new MemoriesDB(url);
  }
  return instance;
}

