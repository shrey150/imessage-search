/**
 * Filtered search MCP tool
 * Searches iMessages with structured filters for person, chat, and date range
 */

import { z } from 'zod';
import { getEmbeddingsClient } from '../embeddings/openai.js';
import { getQdrantDB, SearchResult, SearchFilters } from '../db/qdrant.js';
import { formatDate, formatTime, formatRelative, parseISO } from '../utils/timestamp.js';

// Input schema for the tool
export const filteredSearchSchema = z.object({
  query: z.string().optional().describe('Optional semantic query to combine with filters'),
  person: z.string().optional().describe('Filter by contact name (e.g., "John Smith")'),
  chatName: z.string().optional().describe('Filter by group chat name'),
  startDate: z.string().optional().describe('Start of date range (ISO format, e.g., "2024-01-01")'),
  endDate: z.string().optional().describe('End of date range (ISO format, e.g., "2024-12-31")'),
  limit: z.number().min(1).max(50).default(10).describe('Maximum number of results to return'),
});

export type FilteredSearchInput = z.infer<typeof filteredSearchSchema>;

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
 * Execute filtered search
 */
export async function filteredSearch(input: FilteredSearchInput): Promise<FormattedSearchResult[]> {
  const { query, person, chatName, startDate, endDate, limit } = input;
  
  // Build filters
  const filters: SearchFilters = {};
  
  if (person) {
    filters.person = person;
  }
  
  if (chatName) {
    filters.chatName = chatName;
  }
  
  if (startDate) {
    filters.startDate = parseISO(startDate);
  }
  
  if (endDate) {
    // End of day for the end date
    filters.endDate = parseISO(endDate) + 86400; // Add 24 hours
  }
  
  // Generate query embedding if query is provided
  let queryEmbedding: number[];
  
  if (query) {
    const embeddingsClient = getEmbeddingsClient();
    queryEmbedding = await embeddingsClient.embed(query);
  } else {
    // If no query, use a zero vector (will rely purely on filters)
    // Actually, we need a real query for vector search
    // Use a generic query if none provided
    const embeddingsClient = getEmbeddingsClient();
    queryEmbedding = await embeddingsClient.embed('conversation messages');
  }
  
  // Search Qdrant with filters
  const qdrant = getQdrantDB();
  const results = await qdrant.search(queryEmbedding, limit, filters);
  
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
export const filteredSearchTool = {
  name: 'filtered_search',
  description: 'Search iMessages with structured filters. Filter by person, group chat, and date range, optionally combined with a semantic query.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Optional semantic query to combine with filters (e.g., "dinner plans")',
      },
      person: {
        type: 'string',
        description: 'Filter by contact name (e.g., "John Smith", "Mom")',
      },
      chatName: {
        type: 'string',
        description: 'Filter by group chat name (e.g., "Family Group", "Work Team")',
      },
      startDate: {
        type: 'string',
        description: 'Start of date range in ISO format (e.g., "2024-01-01")',
      },
      endDate: {
        type: 'string',
        description: 'End of date range in ISO format (e.g., "2024-12-31")',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10, max: 50)',
        default: 10,
      },
    },
    required: [],
  },
};

