/**
 * Image Search MCP Tool
 * Search for images using text descriptions (via CLIP embeddings)
 */

import { z } from 'zod';
import { getElasticsearchDB, SearchResult } from '../db/elasticsearch.js';
import { getCLIPClient } from '../embeddings/clip.js';

// Input schema for text-to-image search
export const imageSearchSchema = z.object({
  query: z.string().describe('Text description of the image to find (e.g., "photo of a dog", "screenshot of a recipe")'),
  sender: z.string().optional().describe('Filter by sender name'),
  chatName: z.string().optional().describe('Filter by group chat name'),
  startDate: z.string().optional().describe('Start date (ISO format)'),
  endDate: z.string().optional().describe('End date (ISO format)'),
  limit: z.number().min(1).max(50).default(10).describe('Maximum number of results to return'),
});

export type ImageSearchInput = z.infer<typeof imageSearchSchema>;

/**
 * Execute image search using CLIP text-to-image embeddings
 */
export async function imageSearch(input: ImageSearchInput): Promise<SearchResult[]> {
  const { query, sender, chatName, startDate, endDate, limit } = input;
  
  // Generate CLIP text embedding for the query
  const clipClient = getCLIPClient();
  const imageEmbedding = await clipClient.embedText(query);
  
  if (!imageEmbedding) {
    // Fallback: If CLIP embedding fails, use keyword search on image descriptions
    const esDB = getElasticsearchDB();
    return esDB.hybridSearch({
      keywordQuery: query,
      filters: {
        has_image: true,
        sender,
        chat_name: chatName,
        timestamp_gte: startDate,
        timestamp_lte: endDate,
      },
      limit,
    });
  }
  
  // Execute image search with CLIP embedding
  const esDB = getElasticsearchDB();
  return esDB.imageSearch(imageEmbedding, limit, {
    sender,
    chat_name: chatName,
    timestamp_gte: startDate,
    timestamp_lte: endDate,
    has_image: true,
  });
}

/**
 * Format image search results for display
 */
export function formatImageSearchResults(results: SearchResult[], query: string): string {
  if (results.length === 0) {
    return `No images found matching "${query}"`;
  }
  
  const lines = [
    `Found ${results.length} image${results.length === 1 ? '' : 's'} matching "${query}":`,
    '',
  ];
  
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const timestamp = typeof r.document.timestamp === 'string' 
      ? new Date(r.document.timestamp) 
      : r.document.timestamp;
    
    const header = r.document.chat_name 
      ? `${r.document.chat_name} (${r.document.participants.join(', ')})` 
      : r.document.participants.join(', ');
    
    lines.push(`--- Image ${i + 1} (score: ${Math.round(r.score * 100) / 100}) ---`);
    lines.push(`Chat: ${header}`);
    lines.push(`Time: ${timestamp.toLocaleString()}`);
    lines.push('');
    lines.push(r.document.text);
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Tool definition for MCP
 */
export const imageSearchTool = {
  name: 'image_search',
  description: `Search for images in iMessages using natural language descriptions.

Uses CLIP (Contrastive Language-Image Pre-training) to find images that match your text description.

Examples:
- "photo of a dog"
- "screenshot of a recipe"
- "picture of us at the beach"
- "menu from the restaurant"
- "selfie with friends"

You can also filter by:
- Sender (who sent the image)
- Chat name (which group chat)
- Date range (when it was sent)`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Text description of the image to find',
      },
      sender: {
        type: 'string',
        description: 'Filter by sender name',
      },
      chatName: {
        type: 'string',
        description: 'Filter by group chat name',
      },
      startDate: {
        type: 'string',
        description: 'Start date filter (ISO format, e.g., "2024-01-01")',
      },
      endDate: {
        type: 'string',
        description: 'End date filter (ISO format, e.g., "2024-12-31")',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 10, max: 50)',
        default: 10,
      },
    },
    required: ['query'],
  },
};
