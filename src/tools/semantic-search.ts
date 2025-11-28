/**
 * Semantic search MCP tool
 * Searches iMessages using natural language queries
 */

import { z } from 'zod';
import { getEmbeddingsClient } from '../embeddings/openai.js';
import { getQdrantDB, SearchResult } from '../db/qdrant.js';
import { formatDate, formatTime, formatRelative } from '../utils/timestamp.js';

// Input schema for the tool
export const semanticSearchSchema = z.object({
  query: z.string().describe('Natural language search query'),
  limit: z.number().min(1).max(50).default(10).describe('Maximum number of results to return'),
});

export type SemanticSearchInput = z.infer<typeof semanticSearchSchema>;

export interface FormattedSearchResult {
  text: string;
  participants: string[];
  groupName: string | null;
  startTime: string;
  endTime: string;
  relativeTime: string;
  score: number;
}

/**
 * Execute semantic search
 */
export async function semanticSearch(input: SemanticSearchInput): Promise<FormattedSearchResult[]> {
  const { query, limit } = input;
  
  // Generate embedding for the query
  const embeddingsClient = getEmbeddingsClient();
  const queryEmbedding = await embeddingsClient.embed(query);
  
  // Search Qdrant
  const qdrant = getQdrantDB();
  const results = await qdrant.search(queryEmbedding, limit);
  
  // Format results
  return results.map(result => formatResult(result));
}

/**
 * Format a search result for display
 */
function formatResult(result: SearchResult): FormattedSearchResult {
  return {
    text: result.payload.text,
    participants: result.payload.participants,
    groupName: result.payload.group_name,
    startTime: `${formatDate(result.payload.start_ts)} ${formatTime(result.payload.start_ts)}`,
    endTime: `${formatDate(result.payload.end_ts)} ${formatTime(result.payload.end_ts)}`,
    relativeTime: formatRelative(result.payload.start_ts),
    score: Math.round(result.score * 100) / 100,
  };
}

/**
 * Tool definition for MCP
 */
export const semanticSearchTool = {
  name: 'semantic_search',
  description: 'Search iMessages semantically using natural language. Returns conversation chunks that match the meaning of your query.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query (e.g., "conversations about dinner plans", "when did we discuss the trip")',
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

