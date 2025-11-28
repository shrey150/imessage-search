/**
 * Smart Search MCP Tool
 * LLM-powered intelligent search that understands natural language queries
 */

import { z } from 'zod';
import { getQueryParser, ParsedQuery } from './query-parser.js';
import { buildSearchOptions, formatResults, getQueryTextForEmbedding, needsVectorSearch } from './es-query-builder.js';
import { getElasticsearchDB, SearchResult } from '../db/elasticsearch.js';
import { getEmbeddingsClient } from '../embeddings/openai.js';

// Input schema for the tool
export const smartSearchSchema = z.object({
  query: z.string().describe('Natural language search query'),
  limit: z.number().min(1).max(50).default(10).describe('Maximum number of results to return'),
});

export type SmartSearchInput = z.infer<typeof smartSearchSchema>;

export interface SmartSearchResult {
  results: SearchResult[];
  parsedQuery: ParsedQuery;
  queryTimeMs: number;
}

/**
 * Execute smart search with LLM query understanding
 */
export async function smartSearch(input: SmartSearchInput): Promise<SmartSearchResult> {
  const startTime = Date.now();
  const { query, limit } = input;
  
  // Parse the query using LLM
  const queryParser = getQueryParser();
  const parsedQuery = await queryParser.parse(query);
  
  // Get embedding if needed for semantic search
  let queryEmbedding: number[] | undefined;
  if (needsVectorSearch(parsedQuery)) {
    const queryText = getQueryTextForEmbedding(parsedQuery);
    if (queryText) {
      const embeddingsClient = getEmbeddingsClient();
      queryEmbedding = await embeddingsClient.embed(queryText);
    }
  }
  
  // Build search options
  const searchOptions = buildSearchOptions(parsedQuery, queryParser, {
    queryEmbedding,
    limit,
  });
  
  // Execute search
  const esDB = getElasticsearchDB();
  const results = await esDB.hybridSearch(searchOptions);
  
  const queryTimeMs = Date.now() - startTime;
  
  return {
    results,
    parsedQuery,
    queryTimeMs,
  };
}

/**
 * Format smart search results for MCP response
 */
export function formatSmartSearchResults(result: SmartSearchResult, query: string): string {
  const lines = [
    formatResults(
      result.results.map(r => ({
        id: r.id,
        score: r.score,
        document: {
          text: r.document.text,
          participants: r.document.participants,
          chat_name: r.document.chat_name,
          timestamp: r.document.timestamp,
          has_image: r.document.has_image,
        },
      })),
      query,
      result.parsedQuery.reasoning
    ),
  ];
  
  lines.push('---');
  lines.push(`Query type: ${result.parsedQuery.query_type}`);
  lines.push(`Search time: ${result.queryTimeMs}ms`);
  
  return lines.join('\n');
}

/**
 * Tool definition for MCP
 */
export const smartSearchTool = {
  name: 'smart_search',
  description: `Intelligent iMessage search that understands natural language. 
  
Examples of queries it can handle:
- "What do I think about Mark?" (searches group chats for your opinions, excludes DMs with Mark)
- "Did Sarah tell me about dinner plans?" (searches messages FROM Sarah)
- "Messages about the project last week" (combines semantic + temporal)
- "Find photos from the ski trip" (image search)
- "Late night conversations with Alex" (time-of-day + person filter)
- "What did the team discuss about deadlines in September?" (group chat + temporal)

The search understands:
- Temporal expressions (last week, in September, on Fridays, late at night)
- Person references (from X, about X, with X)
- Chat types (group chats, DMs)
- Image queries`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10, max: 50)',
        default: 10,
      },
    },
    required: ['query'],
  },
};

/**
 * Hybrid Search Tool - Direct Elasticsearch hybrid search without LLM parsing
 * For power users who want more control
 */
export const hybridSearchSchema = z.object({
  semanticQuery: z.string().optional().describe('Query for semantic/vector search'),
  keywordQuery: z.string().optional().describe('Query for keyword/BM25 search'),
  sender: z.string().optional().describe('Filter by sender name'),
  chatName: z.string().optional().describe('Filter by group chat name'),
  isGroupChat: z.boolean().optional().describe('Filter to group chats only'),
  isDM: z.boolean().optional().describe('Filter to DMs only'),
  startDate: z.string().optional().describe('Start date (ISO format)'),
  endDate: z.string().optional().describe('End date (ISO format)'),
  hasImage: z.boolean().optional().describe('Filter to messages with images'),
  limit: z.number().min(1).max(50).default(10).describe('Maximum number of results'),
});

export type HybridSearchInput = z.infer<typeof hybridSearchSchema>;

export async function hybridSearch(input: HybridSearchInput): Promise<SearchResult[]> {
  const {
    semanticQuery,
    keywordQuery,
    sender,
    chatName,
    isGroupChat,
    isDM,
    startDate,
    endDate,
    hasImage,
    limit,
  } = input;
  
  // Generate embedding if semantic query provided
  let queryEmbedding: number[] | undefined;
  if (semanticQuery) {
    const embeddingsClient = getEmbeddingsClient();
    queryEmbedding = await embeddingsClient.embed(semanticQuery);
  }
  
  const esDB = getElasticsearchDB();
  
  return esDB.hybridSearch({
    semanticQuery,
    keywordQuery,
    queryEmbedding,
    filters: {
      sender,
      chat_name: chatName,
      is_group_chat: isGroupChat,
      is_dm: isDM,
      timestamp_gte: startDate,
      timestamp_lte: endDate,
      has_image: hasImage,
    },
    limit,
  });
}

export const hybridSearchTool = {
  name: 'hybrid_search',
  description: 'Direct hybrid search with explicit filters. Use this for precise control over search parameters.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      semanticQuery: {
        type: 'string',
        description: 'Query for semantic/vector search (understands meaning)',
      },
      keywordQuery: {
        type: 'string',
        description: 'Query for keyword/BM25 search (exact text matching)',
      },
      sender: {
        type: 'string',
        description: 'Filter by sender name',
      },
      chatName: {
        type: 'string',
        description: 'Filter by group chat name',
      },
      isGroupChat: {
        type: 'boolean',
        description: 'Filter to group chats only',
      },
      isDM: {
        type: 'boolean',
        description: 'Filter to DMs only',
      },
      startDate: {
        type: 'string',
        description: 'Start date filter (ISO format, e.g., "2024-01-01")',
      },
      endDate: {
        type: 'string',
        description: 'End date filter (ISO format, e.g., "2024-12-31")',
      },
      hasImage: {
        type: 'boolean',
        description: 'Filter to messages with images',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 10, max: 50)',
        default: 10,
      },
    },
    required: [],
  },
};

