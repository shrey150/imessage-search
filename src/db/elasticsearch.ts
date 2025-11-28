/**
 * Elasticsearch client for iMessage hybrid search
 * Supports text search (BM25), semantic search (kNN), and hybrid queries
 */

import { Client } from '@elastic/elasticsearch';
import { log, ProgressBar } from '../utils/progress.js';

// Configuration
const INDEX_NAME = 'imessage_chunks';
const DEFAULT_ES_URL = 'http://localhost:9200';

// Embedding dimensions
const TEXT_EMBEDDING_DIMS = 1536;  // OpenAI text-embedding-3-small
const IMAGE_EMBEDDING_DIMS = 512;  // CLIP ViT-B/32

/**
 * Document structure for indexed message chunks
 */
export interface MessageDocument {
  // Content
  text: string;
  text_embedding?: number[];
  
  // Sender / Recipient
  sender: string;
  sender_is_me: boolean;
  participants: string[];
  participant_count: number;
  
  // Chat metadata
  chat_id: string;
  chat_name: string | null;
  is_dm: boolean;
  is_group_chat: boolean;
  
  // Temporal fields
  timestamp: Date;
  year: number;
  month: number;
  day_of_week: string;
  hour_of_day: number;
  
  // Attachments / Images
  has_attachment: boolean;
  has_image: boolean;
  image_embedding?: number[];
  
  // Chunk metadata
  chunk_id: string;
  message_count: number;
  start_timestamp: Date;
  end_timestamp: Date;
}

/**
 * Search result from Elasticsearch
 */
export interface SearchResult {
  id: string;
  score: number;
  document: MessageDocument;
}

/**
 * Filters for search queries
 */
export interface SearchFilters {
  sender?: string;
  sender_is_me?: boolean;
  participants?: string[];
  chat_id?: string;
  chat_name?: string;
  is_dm?: boolean;
  is_group_chat?: boolean;
  year?: number;
  month?: number | number[];
  day_of_week?: string;
  hour_of_day_gte?: number;
  hour_of_day_lte?: number;
  has_image?: boolean;
  timestamp_gte?: Date | string;
  timestamp_lte?: Date | string;
}

/**
 * Exclusion filters (must_not)
 */
export interface ExcludeFilters {
  is_dm_with?: string;  // Exclude DMs where this person is a participant
  sender?: string;
  chat_id?: string;
}

/**
 * Boost configuration
 */
export interface BoostConfig {
  sender_is_me?: number;
  is_group_chat?: number;
  is_dm?: number;
}

/**
 * Hybrid search options
 */
export interface HybridSearchOptions {
  // Query components
  semanticQuery?: string;
  keywordQuery?: string;
  queryEmbedding?: number[];
  imageEmbedding?: number[];
  
  // Filters
  filters?: SearchFilters;
  exclude?: ExcludeFilters;
  boost?: BoostConfig;
  
  // Pagination
  limit?: number;
  offset?: number;
}

/**
 * Index mapping for Elasticsearch
 */
const INDEX_MAPPING = {
  mappings: {
    properties: {
      // Content
      text: {
        type: 'text' as const,
        analyzer: 'english',
        fields: {
          exact: { type: 'keyword' as const }
        }
      },
      text_embedding: {
        type: 'dense_vector' as const,
        dims: TEXT_EMBEDDING_DIMS,
        index: true,
        similarity: 'cosine' as const
      },
      
      // Sender / Recipient
      sender: { type: 'keyword' as const },
      sender_is_me: { type: 'boolean' as const },
      participants: { type: 'keyword' as const },
      participant_count: { type: 'integer' as const },
      
      // Chat metadata
      chat_id: { type: 'keyword' as const },
      chat_name: { type: 'keyword' as const },
      is_dm: { type: 'boolean' as const },
      is_group_chat: { type: 'boolean' as const },
      
      // Temporal fields
      timestamp: { type: 'date' as const },
      year: { type: 'integer' as const },
      month: { type: 'integer' as const },
      day_of_week: { type: 'keyword' as const },
      hour_of_day: { type: 'integer' as const },
      
      // Attachments / Images
      has_attachment: { type: 'boolean' as const },
      has_image: { type: 'boolean' as const },
      image_embedding: {
        type: 'dense_vector' as const,
        dims: IMAGE_EMBEDDING_DIMS,
        index: true,
        similarity: 'cosine' as const
      },
      
      // Chunk metadata
      chunk_id: { type: 'keyword' as const },
      message_count: { type: 'integer' as const },
      start_timestamp: { type: 'date' as const },
      end_timestamp: { type: 'date' as const },
    }
  },
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    'index.mapping.total_fields.limit': 50
  }
};

/**
 * Elasticsearch client wrapper for iMessage search
 */
export class ElasticsearchDB {
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
      const exists = await this.client.indices.exists({ index: INDEX_NAME });
      
      if (!exists) {
        log('Elasticsearch', `Creating index ${INDEX_NAME}...`);
        await this.client.indices.create({
          index: INDEX_NAME,
          ...INDEX_MAPPING
        });
        log('Elasticsearch', `Index ${INDEX_NAME} created`, 'success');
      } else {
        log('Elasticsearch', `Index ${INDEX_NAME} exists`, 'success');
      }
      
      this.initialized = true;
    } catch (err) {
      log('Elasticsearch', `Failed to initialize: ${err}`, 'error');
      throw err;
    }
  }
  
  /**
   * Index a batch of documents
   */
  async indexDocuments(
    documents: Array<{ id: string } & MessageDocument>,
    showProgress = false
  ): Promise<void> {
    if (documents.length === 0) return;
    
    await this.initialize();
    
    const batchSize = 100;
    const batches = this.createBatches(documents, batchSize);
    const progress = showProgress ? new ProgressBar('Elasticsearch', documents.length) : null;
    let processed = 0;
    
    for (const batch of batches) {
      const operations = batch.flatMap(doc => [
        { index: { _index: INDEX_NAME, _id: doc.id } },
        {
          text: doc.text,
          text_embedding: doc.text_embedding,
          sender: doc.sender,
          sender_is_me: doc.sender_is_me,
          participants: doc.participants,
          participant_count: doc.participant_count,
          chat_id: doc.chat_id,
          chat_name: doc.chat_name,
          is_dm: doc.is_dm,
          is_group_chat: doc.is_group_chat,
          timestamp: doc.timestamp,
          year: doc.year,
          month: doc.month,
          day_of_week: doc.day_of_week,
          hour_of_day: doc.hour_of_day,
          has_attachment: doc.has_attachment,
          has_image: doc.has_image,
          image_embedding: doc.image_embedding,
          chunk_id: doc.chunk_id,
          message_count: doc.message_count,
          start_timestamp: doc.start_timestamp,
          end_timestamp: doc.end_timestamp,
        }
      ]);
      
      const response = await this.client.bulk({ 
        operations,
        refresh: false  // Don't wait for refresh on each batch
      });
      
      if (response.errors) {
        const errorItems = response.items.filter(item => item.index?.error);
        log('Elasticsearch', `Bulk indexing had ${errorItems.length} errors`, 'warn');
        
        // Log first 3 errors for debugging
        const errorsToShow = errorItems.slice(0, 3);
        for (const item of errorsToShow) {
          const error = item.index?.error;
          if (error) {
            log('Elasticsearch', `  Error: ${error.type} - ${error.reason}`, 'error');
          }
        }
      }
      
      processed += batch.length;
      progress?.update(processed);
    }
    
    // Refresh index after all batches
    await this.client.indices.refresh({ index: INDEX_NAME });
    
    progress?.complete();
  }
  
  /**
   * Hybrid search combining BM25 text search and kNN vector search
   */
  async hybridSearch(options: HybridSearchOptions): Promise<SearchResult[]> {
    await this.initialize();
    
    const {
      semanticQuery,
      keywordQuery,
      queryEmbedding,
      imageEmbedding,
      filters,
      exclude,
      boost,
      limit = 10,
      offset = 0
    } = options;
    
    // Build the query
    const query = this.buildHybridQuery({
      keywordQuery,
      queryEmbedding,
      imageEmbedding,
      filters,
      exclude,
      boost
    });
    
    // Execute search
    const response = await this.client.search({
      index: INDEX_NAME,
      query,
      size: limit,
      from: offset,
      _source: { excludes: ['text_embedding', 'image_embedding'] }  // Don't return vectors
    });
    
    return response.hits.hits.map(hit => ({
      id: hit._id!,
      score: hit._score || 0,
      document: hit._source as MessageDocument
    }));
  }
  
  /**
   * Simple semantic search using vector similarity
   */
  async semanticSearch(
    queryEmbedding: number[],
    limit: number = 10,
    filters?: SearchFilters
  ): Promise<SearchResult[]> {
    return this.hybridSearch({
      queryEmbedding,
      filters,
      limit
    });
  }
  
  /**
   * Simple keyword search using BM25
   */
  async keywordSearch(
    query: string,
    limit: number = 10,
    filters?: SearchFilters
  ): Promise<SearchResult[]> {
    return this.hybridSearch({
      keywordQuery: query,
      filters,
      limit
    });
  }
  
  /**
   * Image search using CLIP embeddings
   */
  async imageSearch(
    imageEmbedding: number[],
    limit: number = 10,
    filters?: SearchFilters
  ): Promise<SearchResult[]> {
    await this.initialize();
    
    const filterClauses = this.buildFilterClauses({ ...filters, has_image: true });
    
    const response = await this.client.search({
      index: INDEX_NAME,
      knn: {
        field: 'image_embedding',
        query_vector: imageEmbedding,
        k: limit,
        num_candidates: limit * 10,
        filter: filterClauses.length > 0 ? { bool: { filter: filterClauses } } : undefined
      },
      size: limit,
      _source: { excludes: ['text_embedding', 'image_embedding'] }
    });
    
    return response.hits.hits.map(hit => ({
      id: hit._id!,
      score: hit._score || 0,
      document: hit._source as MessageDocument
    }));
  }
  
  /**
   * Build hybrid query combining BM25, kNN, filters, and boosts
   */
  private buildHybridQuery(options: {
    keywordQuery?: string;
    queryEmbedding?: number[];
    imageEmbedding?: number[];
    filters?: SearchFilters;
    exclude?: ExcludeFilters;
    boost?: BoostConfig;
  }): Record<string, unknown> {
    const { keywordQuery, queryEmbedding, filters, exclude, boost } = options;
    
    const must: Array<Record<string, unknown>> = [];
    const should: Array<Record<string, unknown>> = [];
    const mustNot: Array<Record<string, unknown>> = [];
    const filterClauses = this.buildFilterClauses(filters);
    
    // Keyword search (BM25)
    if (keywordQuery) {
      should.push({
        match: {
          text: {
            query: keywordQuery,
            boost: 1.0
          }
        }
      });
    }
    
    // Semantic search (kNN) - use script_score for combining with BM25
    if (queryEmbedding) {
      should.push({
        script_score: {
          query: { match_all: {} },
          script: {
            source: "cosineSimilarity(params.query_vector, 'text_embedding') + 1.0",
            params: { query_vector: queryEmbedding }
          }
        }
      });
    }
    
    // Build must_not clauses from exclude filters
    if (exclude) {
      if (exclude.is_dm_with) {
        mustNot.push({
          bool: {
            must: [
              { term: { is_dm: true } },
              { term: { participants: exclude.is_dm_with } }
            ]
          }
        });
      }
      if (exclude.sender) {
        mustNot.push({ term: { sender: exclude.sender } });
      }
      if (exclude.chat_id) {
        mustNot.push({ term: { chat_id: exclude.chat_id } });
      }
    }
    
    // Build boost clauses
    if (boost) {
      if (boost.sender_is_me) {
        should.push({
          term: { sender_is_me: { value: true, boost: boost.sender_is_me } }
        });
      }
      if (boost.is_group_chat) {
        should.push({
          term: { is_group_chat: { value: true, boost: boost.is_group_chat } }
        });
      }
      if (boost.is_dm) {
        should.push({
          term: { is_dm: { value: true, boost: boost.is_dm } }
        });
      }
    }
    
    // Construct final query
    const boolQuery: Record<string, unknown> = {};
    
    if (must.length > 0) boolQuery.must = must;
    if (should.length > 0) {
      boolQuery.should = should;
      boolQuery.minimum_should_match = keywordQuery || queryEmbedding ? 1 : 0;
    }
    if (mustNot.length > 0) boolQuery.must_not = mustNot;
    if (filterClauses.length > 0) boolQuery.filter = filterClauses;
    
    return { bool: boolQuery };
  }
  
  /**
   * Build filter clauses from SearchFilters
   */
  private buildFilterClauses(filters?: SearchFilters): Array<Record<string, unknown>> {
    if (!filters) return [];
    
    const clauses: Array<Record<string, unknown>> = [];
    
    if (filters.sender) {
      clauses.push({ term: { sender: filters.sender } });
    }
    if (filters.sender_is_me !== undefined) {
      clauses.push({ term: { sender_is_me: filters.sender_is_me } });
    }
    if (filters.participants && filters.participants.length > 0) {
      clauses.push({ terms: { participants: filters.participants } });
    }
    if (filters.chat_id) {
      clauses.push({ term: { chat_id: filters.chat_id } });
    }
    if (filters.chat_name) {
      clauses.push({ term: { chat_name: filters.chat_name } });
    }
    if (filters.is_dm !== undefined) {
      clauses.push({ term: { is_dm: filters.is_dm } });
    }
    if (filters.is_group_chat !== undefined) {
      clauses.push({ term: { is_group_chat: filters.is_group_chat } });
    }
    if (filters.year) {
      clauses.push({ term: { year: filters.year } });
    }
    if (filters.month) {
      if (Array.isArray(filters.month)) {
        clauses.push({ terms: { month: filters.month } });
      } else {
        clauses.push({ term: { month: filters.month } });
      }
    }
    if (filters.day_of_week) {
      clauses.push({ term: { day_of_week: filters.day_of_week } });
    }
    if (filters.hour_of_day_gte !== undefined || filters.hour_of_day_lte !== undefined) {
      const range: Record<string, number> = {};
      if (filters.hour_of_day_gte !== undefined) range.gte = filters.hour_of_day_gte;
      if (filters.hour_of_day_lte !== undefined) range.lte = filters.hour_of_day_lte;
      clauses.push({ range: { hour_of_day: range } });
    }
    if (filters.has_image !== undefined) {
      clauses.push({ term: { has_image: filters.has_image } });
    }
    if (filters.timestamp_gte || filters.timestamp_lte) {
      const range: Record<string, string | Date> = {};
      if (filters.timestamp_gte) range.gte = filters.timestamp_gte;
      if (filters.timestamp_lte) range.lte = filters.timestamp_lte;
      clauses.push({ range: { timestamp: range } });
    }
    
    return clauses;
  }
  
  /**
   * Get index statistics
   */
  async getStats(): Promise<{ documentCount: number; indexSize: string } | null> {
    try {
      await this.initialize();
      const stats = await this.client.indices.stats({ index: INDEX_NAME });
      const indexStats = stats.indices?.[INDEX_NAME];
      
      return {
        documentCount: indexStats?.primaries?.docs?.count || 0,
        indexSize: this.formatBytes(indexStats?.primaries?.store?.size_in_bytes || 0)
      };
    } catch {
      return null;
    }
  }
  
  /**
   * Delete all documents in the index
   */
  async clear(): Promise<void> {
    try {
      await this.client.indices.delete({ index: INDEX_NAME });
      this.initialized = false;
      log('Elasticsearch', 'Index cleared', 'success');
    } catch {
      // Index might not exist
    }
  }
  
  /**
   * Check if Elasticsearch is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      const health = await this.client.cluster.health();
      return health.status === 'green' || health.status === 'yellow';
    } catch {
      return false;
    }
  }
  
  /**
   * Get document by ID
   */
  async getDocument(id: string): Promise<MessageDocument | null> {
    try {
      const response = await this.client.get({
        index: INDEX_NAME,
        id,
        _source_excludes: ['text_embedding', 'image_embedding']
      });
      return response._source as MessageDocument;
    } catch {
      return null;
    }
  }
  
  /**
   * Check if document exists
   */
  async documentExists(id: string): Promise<boolean> {
    try {
      return await this.client.exists({ index: INDEX_NAME, id });
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
  
  /**
   * Format bytes to human readable
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}

// Singleton instance
let dbInstance: ElasticsearchDB | null = null;

export function getElasticsearchDB(url?: string): ElasticsearchDB {
  if (!dbInstance) {
    dbInstance = new ElasticsearchDB(url);
  }
  return dbInstance;
}

