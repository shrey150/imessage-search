/**
 * Elasticsearch client for the chat dashboard
 * Connects to the same index as the main imessage-mcp project
 */

import { Client } from '@elastic/elasticsearch';

const INDEX_NAME = 'imessage_chunks';
const DEFAULT_ES_URL = 'http://localhost:9200';

export interface MessageDocument {
  text: string;
  sender: string;
  sender_is_me: boolean;
  participants: string[];
  participant_count: number;
  chat_id: string;
  chat_name: string | null;
  is_dm: boolean;
  is_group_chat: boolean;
  timestamp: Date;
  year: number;
  month: number;
  day_of_week: string;
  hour_of_day: number;
  has_attachment: boolean;
  has_image: boolean;
  chunk_id: string;
  message_count: number;
  start_timestamp: Date;
  end_timestamp: Date;
}

export interface SearchResult {
  id: string;
  score: number;
  document: MessageDocument;
}

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

export interface ExcludeFilters {
  is_dm_with?: string;
  sender?: string;
  chat_id?: string;
}

export interface HybridSearchOptions {
  keywordQuery?: string;
  queryEmbedding?: number[];
  filters?: SearchFilters;
  exclude?: ExcludeFilters;
  limit?: number;
}

class ElasticsearchClient {
  private client: Client;

  constructor() {
    this.client = new Client({
      node: process.env.ELASTICSEARCH_URL || DEFAULT_ES_URL,
    });
  }

  async hybridSearch(options: HybridSearchOptions): Promise<SearchResult[]> {
    const { keywordQuery, queryEmbedding, filters, exclude, limit = 10 } = options;

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
            boost: 1.0,
          },
        },
      });
    }

    // Semantic search (kNN)
    if (queryEmbedding) {
      should.push({
        script_score: {
          query: { match_all: {} },
          script: {
            // Guard against documents without embeddings to prevent runtime errors
            source: "doc['text_embedding'].size() != 0 ? cosineSimilarity(params.query_vector, 'text_embedding') + 1.0 : 0",
            params: { query_vector: queryEmbedding },
          },
        },
      });
    }

    // Exclusion filters
    if (exclude) {
      if (exclude.is_dm_with) {
        mustNot.push({
          bool: {
            must: [
              { term: { is_dm: true } },
              { term: { participants: exclude.is_dm_with } },
            ],
          },
        });
      }
      if (exclude.sender) {
        mustNot.push({ term: { sender: exclude.sender } });
      }
    }

    const boolQuery: Record<string, unknown> = {};
    if (must.length > 0) boolQuery.must = must;
    if (should.length > 0) {
      boolQuery.should = should;
      boolQuery.minimum_should_match = keywordQuery || queryEmbedding ? 1 : 0;
    }
    if (mustNot.length > 0) boolQuery.must_not = mustNot;
    if (filterClauses.length > 0) boolQuery.filter = filterClauses;

    const response = await this.client.search({
      index: INDEX_NAME,
      query: { bool: boolQuery },
      size: limit,
      _source: { excludes: ['text_embedding', 'image_embedding'] },
    });

    return response.hits.hits.map((hit) => ({
      id: hit._id!,
      score: hit._score || 0,
      document: hit._source as MessageDocument,
    }));
  }

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
   * Exact/filtered search - no semantic matching, just keyword + filters
   * Use for precise searches when you know exactly what you're looking for
   */
  async exactSearch(options: {
    keyword?: string;
    exactPhrase?: string;
    filters?: SearchFilters;
    exclude?: ExcludeFilters;
    limit?: number;
    sortBy?: 'relevance' | 'newest' | 'oldest';
  }): Promise<SearchResult[]> {
    const { keyword, exactPhrase, filters, exclude, limit = 10, sortBy = 'relevance' } = options;

    const must: Array<Record<string, unknown>> = [];
    const mustNot: Array<Record<string, unknown>> = [];
    const filterClauses = this.buildFilterClauses(filters);

    // Exact phrase match (highest priority)
    if (exactPhrase) {
      must.push({
        match_phrase: {
          text: exactPhrase,
        },
      });
    }
    // Keyword search (BM25)
    else if (keyword) {
      must.push({
        match: {
          text: {
            query: keyword,
            operator: 'and', // All words must be present
          },
        },
      });
    }

    // Exclusion filters
    if (exclude) {
      if (exclude.is_dm_with) {
        mustNot.push({
          bool: {
            must: [
              { term: { is_dm: true } },
              { term: { participants: exclude.is_dm_with } },
            ],
          },
        });
      }
      if (exclude.sender) {
        mustNot.push({ term: { sender: exclude.sender } });
      }
    }

    const boolQuery: Record<string, unknown> = {};
    if (must.length > 0) boolQuery.must = must;
    if (mustNot.length > 0) boolQuery.must_not = mustNot;
    if (filterClauses.length > 0) boolQuery.filter = filterClauses;

    // If no query provided, just use filters with match_all
    const query = Object.keys(boolQuery).length > 0 
      ? { bool: boolQuery }
      : { match_all: {} };

    // Sorting
    const sort: Array<Record<string, unknown>> = [];
    if (sortBy === 'newest') {
      sort.push({ timestamp: { order: 'desc' } });
    } else if (sortBy === 'oldest') {
      sort.push({ timestamp: { order: 'asc' } });
    }
    // For relevance, let ES default scoring work

    const response = await this.client.search({
      index: INDEX_NAME,
      query,
      size: limit,
      sort: sort.length > 0 ? sort : undefined,
      _source: { excludes: ['text_embedding', 'image_embedding'] },
    });

    return response.hits.hits.map((hit) => ({
      id: hit._id!,
      score: hit._score || 0,
      document: hit._source as MessageDocument,
    }));
  }

  /**
   * Spotlight search - optimized for instant search UI
   * 
   * Sorting priority:
   * 1. Exact phrase match (entire query as one string) - highest priority
   * 2. Number of keyword matches (more matching words = higher rank)
   * 3. Timestamp descending (newest first) - as tiebreaker
   * 
   * Uses function_score with multiple tiers:
   * - Tier 1 (1M points): Exact phrase match
   * - Tier 2 (100K points): All keywords match (AND)
   * - Tier 3: BM25 natural scoring for relevance (handles partial matches)
   */
  async spotlightSearch(options: {
    query: string;
    filters?: SearchFilters;
    limit?: number;
    offset?: number;
  }): Promise<{ results: SearchResult[]; total: number }> {
    const { query, filters, limit = 10, offset = 0 } = options;

    const filterClauses = this.buildFilterClauses(filters);
    const words = query.trim().split(/\s+/).filter(w => w.length > 0);

    // Build function_score functions with clear priority tiers:
    // - Exact phrase match: 1,000,000 points (always shows first)
    // - All keywords match (AND): 100,000 points (shows before partial matches)
    // - BM25 scoring adds natural relevance ranking within each tier
    const functions: Array<Record<string, unknown>> = [
      // Tier 1: Exact phrase match gets massive boost
      {
        filter: { match_phrase: { text: query } },
        weight: 1000000,
      },
      // Tier 2: All keywords matching (AND) gets high boost
      {
        filter: { 
          match: { 
            text: {
              query: query,
              operator: 'and',
            }
          } 
        },
        weight: 100000,
      },
    ];

    // Tier 3: Each individual keyword match adds smaller boost
    // This helps differentiate between "2 keywords match" vs "4 keywords match"
    for (const word of words) {
      // Skip very common words (stop words) - they don't add meaning
      if (word.length <= 2 || ['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'was', 'her', 'she', 'his', 'him', 'has', 'had', 'its'].includes(word.toLowerCase())) {
        continue;
      }
      functions.push({
        filter: { match: { text: word } },
        weight: 1000,
      });
    }

    // Base query: match any word (to get candidates)
    // Use should clauses with varying boosts for BM25 scoring
    const baseQueryShould: Array<Record<string, unknown>> = [
      // Exact phrase match - highest BM25 boost
      { 
        match_phrase: { 
          text: {
            query: query,
            boost: 10.0,
          }
        } 
      },
      // All keywords match (AND) - high BM25 boost
      {
        match: {
          text: {
            query: query,
            operator: 'and',
            boost: 5.0,
          },
        },
      },
      // Any keyword match (OR) with 50% minimum - base relevance
      {
        match: {
          text: {
            query: query,
            operator: 'or',
            minimum_should_match: '30%',
            boost: 1.0,
          },
        },
      },
    ];

    // For single words, also add a prefix match for partial typing
    if (words.length === 1 && words[0].length >= 2) {
      baseQueryShould.push({
        prefix: {
          text: {
            value: words[0].toLowerCase(),
            boost: 2.0,
          },
        },
      });
    }

    const baseQuery: Record<string, unknown> = {
      bool: {
        should: baseQueryShould,
        minimum_should_match: 1,
      },
    };

    if (filterClauses.length > 0) {
      (baseQuery.bool as Record<string, unknown>).filter = filterClauses;
    }

    const response = await this.client.search({
      index: INDEX_NAME,
      query: {
        function_score: {
          query: baseQuery,
          functions,
          score_mode: 'sum', // Sum all matching function weights
          boost_mode: 'sum', // Add function score to BM25 score (for tie-breaking)
        },
      },
      size: limit,
      from: offset,
      // Sort by score first (tier + BM25), then timestamp as final tiebreaker
      sort: [
        { _score: { order: 'desc' } },
        { timestamp: { order: 'desc' } },
      ],
      track_total_hits: true,
      _source: { excludes: ['text_embedding', 'image_embedding'] },
    });

    const total = typeof response.hits.total === 'number' 
      ? response.hits.total 
      : response.hits.total?.value || 0;

    return {
      results: response.hits.hits.map((hit) => ({
        id: hit._id!,
        score: hit._score || 0,
        document: hit._source as MessageDocument,
      })),
      total,
    };
  }

  async getStats(): Promise<{ documentCount: number } | null> {
    try {
      const stats = await this.client.indices.stats({ index: INDEX_NAME });
      const indexStats = stats.indices?.[INDEX_NAME];
      return {
        documentCount: indexStats?.primaries?.docs?.count || 0,
      };
    } catch {
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const health = await this.client.cluster.health();
      return health.status === 'green' || health.status === 'yellow';
    } catch {
      return false;
    }
  }

  /**
   * Get a single chunk by its Elasticsearch document ID
   */
  async getChunkById(id: string): Promise<SearchResult | null> {
    try {
      const response = await this.client.get({
        index: INDEX_NAME,
        id,
      });

      if (!response.found) {
        return null;
      }

      return {
        id: response._id,
        score: 1,
        document: response._source as MessageDocument,
      };
    } catch {
      return null;
    }
  }
}

// Singleton
let client: ElasticsearchClient | null = null;

export function getElasticsearchClient(): ElasticsearchClient {
  if (!client) {
    client = new ElasticsearchClient();
  }
  return client;
}

