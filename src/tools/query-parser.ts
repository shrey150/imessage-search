/**
 * LLM Query Parser
 * Uses OpenAI to understand natural language queries and generate structured search plans
 */

import OpenAI from 'openai';
import { z } from 'zod';

// Query types
export type QueryType = 'about_person' | 'from_person' | 'temporal' | 'image_search' | 'keyword' | 'hybrid';

// Structured output schema
export const ParsedQuerySchema = z.object({
  query_type: z.enum(['about_person', 'from_person', 'temporal', 'image_search', 'keyword', 'hybrid']),
  semantic_query: z.string().nullish().describe('Query optimized for vector similarity search'),
  keyword_query: z.string().nullish().describe('Query optimized for BM25 text search'),
  image_query: z.string().nullish().describe('Query for CLIP image search'),
  
  filters: z.object({
    sender: z.string().optional(),
    sender_is_me: z.boolean().optional(),
    participants: z.array(z.string()).optional(),
    chat_name: z.string().optional(),
    is_dm: z.boolean().optional(),
    is_group_chat: z.boolean().optional(),
    has_image: z.boolean().optional(),
  }).optional(),
  
  temporal: z.object({
    year: z.number().optional(),
    month: z.number().optional(),
    months: z.array(z.number()).optional(),
    day_of_week: z.string().optional(),
    hour_gte: z.number().optional(),
    hour_lte: z.number().optional(),
    relative: z.enum(['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year', 'last_year']).optional(),
    date_gte: z.string().optional(),
    date_lte: z.string().optional(),
  }).optional(),
  
  exclude: z.object({
    is_dm_with: z.string().optional().describe('Exclude DMs with this person'),
    sender: z.string().optional(),
    chat_id: z.string().optional(),
  }).optional(),
  
  boost: z.object({
    sender_is_me: z.number().optional(),
    is_group_chat: z.number().optional(),
    is_dm: z.number().optional(),
  }).optional(),
  
  reasoning: z.string().describe('Brief explanation of how the query was interpreted'),
});

export type ParsedQuery = z.infer<typeof ParsedQuerySchema>;

const SYSTEM_PROMPT = `You are a search query analyzer for an iMessage search system. Your job is to understand natural language queries and output structured search plans.

IMPORTANT DISTINCTIONS:
1. "About X" queries (e.g., "What do I think about Mark?", "opinions on Sarah"):
   - User wants to find what they or others have SAID ABOUT a person
   - EXCLUDE DMs with X (you talk TO them, not ABOUT them in their own DM)
   - Search group chats where people discuss others
   - BOOST messages the user sent (their opinions)

2. "From X" queries (e.g., "Did Mark tell me...", "What did Sarah say about..."):
   - User wants messages that X SENT
   - INCLUDE DMs with X
   - Filter by sender = X

3. Temporal expressions - convert to structured filters:
   - "last month" → relative: "last_month"
   - "in September" → month: 9
   - "last semester" (Aug-Dec) → month: [8,9,10,11,12]
   - "on Fridays" → day_of_week: "friday"
   - "late at night" → hour_range: {gte: 22} OR {lte: 3}
   - "this morning" → relative: "today", hour_range: {gte: 6, lte: 12}

4. Image queries (e.g., "photo of dog", "picture from the trip"):
   - Set query_type to "image_search"
   - Set image_query for CLIP text-to-image search
   - Can combine with temporal/person filters

5. Keyword queries (e.g., "messages containing 'restaurant'"):
   - Literal text search, use keyword_query
   - Good for finding specific words/phrases

6. Hybrid queries combine multiple aspects.

Available filters:
- sender: string (contact name who sent the message)
- sender_is_me: boolean (did the user send this?)
- participants: string[] (anyone in the chat)
- chat_name: string (group chat name)
- is_dm: boolean (direct message)
- is_group_chat: boolean
- has_image: boolean

Output a JSON object with these EXACT fields:
{
  "query_type": "about_person" | "from_person" | "temporal" | "image_search" | "keyword" | "hybrid",
  "semantic_query": "optimized query for vector search",
  "keyword_query": "keywords for text search", 
  "image_query": "description for image search (only if image_search)",
  "filters": { "sender": "name", "is_dm": true/false, "is_group_chat": true/false, ... },
  "temporal": { "relative": "last_week", "month": 9, ... },
  "exclude": { "is_dm_with": "name to exclude DMs with" },
  "boost": { "sender_is_me": 2.0, "is_group_chat": 1.5 },
  "reasoning": "brief explanation of interpretation"
}

The query_type MUST be one of: about_person, from_person, temporal, image_search, keyword, hybrid`;

const JSON_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    query_type: {
      type: 'string' as const,
      enum: ['about_person', 'from_person', 'temporal', 'image_search', 'keyword', 'hybrid'],
    },
    semantic_query: { type: 'string' as const },
    keyword_query: { type: 'string' as const },
    image_query: { type: 'string' as const },
    filters: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        sender: { type: 'string' as const },
        sender_is_me: { type: 'boolean' as const },
        participants: { type: 'array' as const, items: { type: 'string' as const } },
        chat_name: { type: 'string' as const },
        is_dm: { type: 'boolean' as const },
        is_group_chat: { type: 'boolean' as const },
        has_image: { type: 'boolean' as const },
      },
    },
    temporal: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        year: { type: 'integer' as const },
        month: { type: 'integer' as const },
        months: { type: 'array' as const, items: { type: 'integer' as const } },
        day_of_week: { type: 'string' as const },
        hour_gte: { type: 'integer' as const },
        hour_lte: { type: 'integer' as const },
        relative: {
          type: 'string' as const,
          enum: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year', 'last_year'],
        },
        date_gte: { type: 'string' as const },
        date_lte: { type: 'string' as const },
      },
    },
    exclude: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        is_dm_with: { type: 'string' as const },
        sender: { type: 'string' as const },
        chat_id: { type: 'string' as const },
      },
    },
    boost: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        sender_is_me: { type: 'number' as const },
        is_group_chat: { type: 'number' as const },
        is_dm: { type: 'number' as const },
      },
    },
    reasoning: { type: 'string' as const },
  },
  required: ['query_type', 'reasoning'],
};

/**
 * Parse a natural language query into a structured search plan
 */
export class QueryParser {
  private client: OpenAI;
  private model: string;
  
  constructor(apiKey?: string, model: string = 'gpt-4o-mini') {
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
    this.model = model;
  }
  
  /**
   * Parse a natural language query
   */
  async parse(query: string): Promise<ParsedQuery> {
    const currentDate = new Date();
    const currentContext = `Current date: ${currentDate.toISOString().split('T')[0]}, Current time: ${currentDate.toTimeString().split(' ')[0]}`;
    
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + '\n\nRespond with a JSON object only, no other text.' },
          { role: 'user', content: `${currentContext}\n\nQuery: "${query}"\n\nParse this query into a structured search plan. Respond with JSON only.` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,  // Low temperature for consistent parsing
      });
      
      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }
      
      const parsed = JSON.parse(content);
      
      // Validate with Zod
      return ParsedQuerySchema.parse(parsed);
    } catch (err) {
      // Fallback to simple semantic search if parsing fails
      console.error('Query parsing error:', err);
      return {
        query_type: 'hybrid',
        semantic_query: query,
        keyword_query: query,
        reasoning: 'Fallback to simple search due to parsing error',
      };
    }
  }
  
  /**
   * Convert relative temporal expressions to absolute date ranges
   */
  resolveTemporalFilter(temporal: ParsedQuery['temporal']): {
    timestamp_gte?: string;
    timestamp_lte?: string;
    year?: number;
    month?: number | number[];
    day_of_week?: string;
    hour_of_day_gte?: number;
    hour_of_day_lte?: number;
  } {
    if (!temporal) return {};
    
    const result: ReturnType<QueryParser['resolveTemporalFilter']> = {};
    const now = new Date();
    
    // Handle relative dates
    if (temporal.relative) {
      switch (temporal.relative) {
        case 'today':
          result.timestamp_gte = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
          break;
        case 'yesterday': {
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          result.timestamp_gte = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()).toISOString();
          result.timestamp_lte = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
          break;
        }
        case 'this_week': {
          const startOfWeek = new Date(now);
          startOfWeek.setDate(now.getDate() - now.getDay());
          result.timestamp_gte = startOfWeek.toISOString();
          break;
        }
        case 'last_week': {
          const startOfLastWeek = new Date(now);
          startOfLastWeek.setDate(now.getDate() - now.getDay() - 7);
          const endOfLastWeek = new Date(now);
          endOfLastWeek.setDate(now.getDate() - now.getDay());
          result.timestamp_gte = startOfLastWeek.toISOString();
          result.timestamp_lte = endOfLastWeek.toISOString();
          break;
        }
        case 'this_month':
          result.timestamp_gte = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
          break;
        case 'last_month': {
          const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
          result.timestamp_gte = startOfLastMonth.toISOString();
          result.timestamp_lte = endOfLastMonth.toISOString();
          break;
        }
        case 'this_year':
          result.timestamp_gte = new Date(now.getFullYear(), 0, 1).toISOString();
          break;
        case 'last_year': {
          result.timestamp_gte = new Date(now.getFullYear() - 1, 0, 1).toISOString();
          result.timestamp_lte = new Date(now.getFullYear() - 1, 11, 31).toISOString();
          break;
        }
      }
    }
    
    // Handle explicit date range
    if (temporal.date_gte) result.timestamp_gte = temporal.date_gte;
    if (temporal.date_lte) result.timestamp_lte = temporal.date_lte;
    
    // Handle specific temporal fields
    if (temporal.year) result.year = temporal.year;
    if (temporal.month) result.month = temporal.month;
    if (temporal.months) result.month = temporal.months;
    if (temporal.day_of_week) result.day_of_week = temporal.day_of_week.toLowerCase();
    if (temporal.hour_gte !== undefined) result.hour_of_day_gte = temporal.hour_gte;
    if (temporal.hour_lte !== undefined) result.hour_of_day_lte = temporal.hour_lte;
    
    return result;
  }
}

// Singleton instance
let parserInstance: QueryParser | null = null;

export function getQueryParser(apiKey?: string): QueryParser {
  if (!parserInstance) {
    parserInstance = new QueryParser(apiKey);
  }
  return parserInstance;
}

