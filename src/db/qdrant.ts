/**
 * Qdrant vector database client
 * Handles collection management and vector operations
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { log, ProgressBar } from '../utils/progress.js';
import { chunkToUUID } from '../utils/hash.js';

// Configuration
const COLLECTION_NAME = 'imessage_chunks';
const VECTOR_SIZE = 1536; // text-embedding-3-small dimensions
const DEFAULT_QDRANT_URL = 'http://localhost:6333';

export interface ChunkPayload {
  text: string;
  start_ts: number;
  end_ts: number;
  participants: string[];
  chat_identifier: string;
  group_name: string | null;
  is_group_chat: boolean;
  message_count: number;
}

export interface SearchResult {
  id: string;
  score: number;
  payload: ChunkPayload;
}

export interface SearchFilters {
  person?: string;
  chatName?: string;
  startDate?: number;  // Unix timestamp
  endDate?: number;    // Unix timestamp
}

/**
 * Qdrant client wrapper for iMessage chunks
 */
export class QdrantDB {
  private client: QdrantClient;
  private initialized = false;
  
  constructor(url?: string) {
    this.client = new QdrantClient({
      url: url || process.env.QDRANT_URL || DEFAULT_QDRANT_URL,
    });
  }
  
  /**
   * Initialize the collection (create if not exists)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Check if collection exists
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(c => c.name === COLLECTION_NAME);
      
      if (!exists) {
        log('Qdrant', `Creating collection ${COLLECTION_NAME}...`);
        await this.client.createCollection(COLLECTION_NAME, {
          vectors: {
            size: VECTOR_SIZE,
            distance: 'Cosine',
          },
          // Create payload indexes for filtering
          optimizers_config: {
            indexing_threshold: 0, // Index immediately
          },
        });
        
        // Create payload indexes for efficient filtering
        await this.createPayloadIndexes();
        
        log('Qdrant', `Collection ${COLLECTION_NAME} created`, 'success');
      } else {
        log('Qdrant', `Collection ${COLLECTION_NAME} exists`, 'success');
      }
      
      this.initialized = true;
    } catch (err) {
      log('Qdrant', `Failed to initialize: ${err}`, 'error');
      throw err;
    }
  }
  
  /**
   * Create payload indexes for efficient filtering
   */
  private async createPayloadIndexes(): Promise<void> {
    const indexes = [
      { field: 'start_ts', type: 'integer' as const },
      { field: 'end_ts', type: 'integer' as const },
      { field: 'participants', type: 'keyword' as const },
      { field: 'chat_identifier', type: 'keyword' as const },
      { field: 'group_name', type: 'keyword' as const },
      { field: 'is_group_chat', type: 'bool' as const },
    ];
    
    for (const { field, type } of indexes) {
      try {
        await this.client.createPayloadIndex(COLLECTION_NAME, {
          field_name: field,
          field_schema: type,
        });
      } catch {
        // Index might already exist, ignore
      }
    }
  }
  
  /**
   * Upsert chunks with their embeddings
   */
  async upsertChunks(
    chunks: Array<{ id: string; text: string; embedding: number[]; payload: Omit<ChunkPayload, 'text'> }>,
    showProgress = false
  ): Promise<void> {
    if (chunks.length === 0) return;
    
    await this.initialize();
    
    const batchSize = 100;
    const batches = this.createBatches(chunks, batchSize);
    const progress = showProgress ? new ProgressBar('Qdrant', chunks.length) : null;
    let processed = 0;
    
    for (const batch of batches) {
      const points = batch.map(chunk => ({
        id: chunkToUUID(chunk.text), // Deterministic UUID from content
        vector: chunk.embedding,
        payload: {
          ...chunk.payload,
          text: chunk.text,
        },
      }));
      
      await this.client.upsert(COLLECTION_NAME, {
        wait: true,
        points,
      });
      
      processed += batch.length;
      progress?.update(processed);
    }
    
    progress?.complete();
  }
  
  /**
   * Semantic search for similar chunks
   */
  async search(
    queryEmbedding: number[],
    limit: number = 10,
    filters?: SearchFilters
  ): Promise<SearchResult[]> {
    await this.initialize();
    
    const filter = this.buildFilter(filters);
    
    const results = await this.client.search(COLLECTION_NAME, {
      vector: queryEmbedding,
      limit,
      with_payload: true,
      filter: filter || undefined,
    });
    
    return results.map(result => ({
      id: result.id as string,
      score: result.score,
      payload: result.payload as unknown as ChunkPayload,
    }));
  }
  
  /**
   * Build Qdrant filter from search filters
   */
  private buildFilter(filters?: SearchFilters): Record<string, unknown> | null {
    if (!filters) return null;
    
    const conditions: Array<Record<string, unknown>> = [];
    
    // Filter by participant name (partial match in array)
    if (filters.person) {
      conditions.push({
        key: 'participants',
        match: { value: filters.person },
      });
    }
    
    // Filter by chat/group name
    if (filters.chatName) {
      conditions.push({
        key: 'group_name',
        match: { value: filters.chatName },
      });
    }
    
    // Filter by date range
    if (filters.startDate) {
      conditions.push({
        key: 'start_ts',
        range: { gte: filters.startDate },
      });
    }
    
    if (filters.endDate) {
      conditions.push({
        key: 'end_ts',
        range: { lte: filters.endDate },
      });
    }
    
    if (conditions.length === 0) return null;
    
    return {
      must: conditions,
    };
  }
  
  /**
   * Get collection statistics
   */
  async getStats(): Promise<{ pointCount: number; segmentCount: number } | null> {
    try {
      await this.initialize();
      const info = await this.client.getCollection(COLLECTION_NAME);
      return {
        pointCount: info.points_count || 0,
        segmentCount: info.segments_count || 0,
      };
    } catch {
      return null;
    }
  }
  
  /**
   * Delete all points in the collection
   */
  async clear(): Promise<void> {
    try {
      await this.client.deleteCollection(COLLECTION_NAME);
      this.initialized = false;
      log('Qdrant', 'Collection cleared', 'success');
    } catch {
      // Collection might not exist
    }
  }
  
  /**
   * Check if Qdrant is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Split items into batches
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }
}

// Singleton instance
let dbInstance: QdrantDB | null = null;

export function getQdrantDB(url?: string): QdrantDB {
  if (!dbInstance) {
    dbInstance = new QdrantDB(url);
  }
  return dbInstance;
}

