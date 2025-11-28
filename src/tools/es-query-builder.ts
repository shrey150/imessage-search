/**
 * Elasticsearch Query Builder
 * Converts parsed queries into Elasticsearch query DSL
 */

import { ParsedQuery, QueryParser } from './query-parser.js';
import { SearchFilters, ExcludeFilters, BoostConfig, HybridSearchOptions } from '../db/elasticsearch.js';

/**
 * Build Elasticsearch search options from a parsed query
 */
export function buildSearchOptions(
  parsedQuery: ParsedQuery,
  queryParser: QueryParser,
  options: {
    queryEmbedding?: number[];
    imageEmbedding?: number[];
    limit?: number;
  } = {}
): HybridSearchOptions {
  const { queryEmbedding, imageEmbedding, limit = 10 } = options;
  
  // Build filters
  const filters = buildFilters(parsedQuery, queryParser);
  
  // Build exclusions
  const exclude = buildExclude(parsedQuery);
  
  // Build boosts
  const boost = buildBoost(parsedQuery);
  
  return {
    semanticQuery: parsedQuery.semantic_query ?? undefined,
    keywordQuery: parsedQuery.keyword_query ?? undefined,
    queryEmbedding,
    imageEmbedding,
    filters,
    exclude,
    boost,
    limit,
  };
}

/**
 * Build search filters from parsed query
 */
function buildFilters(parsedQuery: ParsedQuery, queryParser: QueryParser): SearchFilters {
  const filters: SearchFilters = {};
  
  // Copy direct filters
  if (parsedQuery.filters) {
    if (parsedQuery.filters.sender) {
      filters.sender = parsedQuery.filters.sender;
    }
    if (parsedQuery.filters.sender_is_me !== undefined) {
      filters.sender_is_me = parsedQuery.filters.sender_is_me;
    }
    if (parsedQuery.filters.participants && parsedQuery.filters.participants.length > 0) {
      filters.participants = parsedQuery.filters.participants;
    }
    if (parsedQuery.filters.chat_name) {
      filters.chat_name = parsedQuery.filters.chat_name;
    }
    if (parsedQuery.filters.is_dm !== undefined) {
      filters.is_dm = parsedQuery.filters.is_dm;
    }
    if (parsedQuery.filters.is_group_chat !== undefined) {
      filters.is_group_chat = parsedQuery.filters.is_group_chat;
    }
    if (parsedQuery.filters.has_image !== undefined) {
      filters.has_image = parsedQuery.filters.has_image;
    }
  }
  
  // Resolve temporal filters
  if (parsedQuery.temporal) {
    const resolved = queryParser.resolveTemporalFilter(parsedQuery.temporal);
    
    if (resolved.timestamp_gte) {
      filters.timestamp_gte = resolved.timestamp_gte;
    }
    if (resolved.timestamp_lte) {
      filters.timestamp_lte = resolved.timestamp_lte;
    }
    if (resolved.year) {
      filters.year = resolved.year;
    }
    if (resolved.month) {
      filters.month = resolved.month;
    }
    if (resolved.day_of_week) {
      filters.day_of_week = resolved.day_of_week;
    }
    if (resolved.hour_of_day_gte !== undefined) {
      filters.hour_of_day_gte = resolved.hour_of_day_gte;
    }
    if (resolved.hour_of_day_lte !== undefined) {
      filters.hour_of_day_lte = resolved.hour_of_day_lte;
    }
  }
  
  // For image searches, always filter to documents with images
  if (parsedQuery.query_type === 'image_search') {
    filters.has_image = true;
  }
  
  return filters;
}

/**
 * Build exclusion filters from parsed query
 */
function buildExclude(parsedQuery: ParsedQuery): ExcludeFilters | undefined {
  if (!parsedQuery.exclude) return undefined;
  
  const exclude: ExcludeFilters = {};
  
  if (parsedQuery.exclude.is_dm_with) {
    exclude.is_dm_with = parsedQuery.exclude.is_dm_with;
  }
  if (parsedQuery.exclude.sender) {
    exclude.sender = parsedQuery.exclude.sender;
  }
  if (parsedQuery.exclude.chat_id) {
    exclude.chat_id = parsedQuery.exclude.chat_id;
  }
  
  return Object.keys(exclude).length > 0 ? exclude : undefined;
}

/**
 * Build boost configuration from parsed query
 */
function buildBoost(parsedQuery: ParsedQuery): BoostConfig | undefined {
  if (!parsedQuery.boost) return undefined;
  
  const boost: BoostConfig = {};
  
  if (parsedQuery.boost.sender_is_me) {
    boost.sender_is_me = parsedQuery.boost.sender_is_me;
  }
  if (parsedQuery.boost.is_group_chat) {
    boost.is_group_chat = parsedQuery.boost.is_group_chat;
  }
  if (parsedQuery.boost.is_dm) {
    boost.is_dm = parsedQuery.boost.is_dm;
  }
  
  return Object.keys(boost).length > 0 ? boost : undefined;
}

/**
 * Get the best query text for embedding
 * Prefers semantic_query, falls back to keyword_query or image_query
 */
export function getQueryTextForEmbedding(parsedQuery: ParsedQuery): string {
  return parsedQuery.semantic_query || parsedQuery.keyword_query || parsedQuery.image_query || '';
}

/**
 * Determine if this query needs vector search
 */
export function needsVectorSearch(parsedQuery: ParsedQuery): boolean {
  return !!(parsedQuery.semantic_query || parsedQuery.query_type === 'about_person' || parsedQuery.query_type === 'hybrid');
}

/**
 * Determine if this query needs keyword search
 */
export function needsKeywordSearch(parsedQuery: ParsedQuery): boolean {
  return !!(parsedQuery.keyword_query || parsedQuery.query_type === 'keyword' || parsedQuery.query_type === 'hybrid');
}

/**
 * Determine if this query needs image search
 */
export function needsImageSearch(parsedQuery: ParsedQuery): boolean {
  return parsedQuery.query_type === 'image_search' && !!parsedQuery.image_query;
}

/**
 * Format search results for display
 */
export interface FormattedResult {
  text: string;
  participants: string[];
  chatName: string | null;
  timestamp: string;
  relativeTime: string;
  score: number;
  hasImage: boolean;
}

/**
 * Calculate relative time string
 */
function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);
  
  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  if (diffWeeks < 4) return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`;
  if (diffMonths < 12) return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
  return `${diffYears} year${diffYears === 1 ? '' : 's'} ago`;
}

/**
 * Format a search result for display
 */
export function formatResult(result: {
  id: string;
  score: number;
  document: {
    text: string;
    participants: string[];
    chat_name: string | null;
    timestamp: Date | string;
    has_image: boolean;
  };
}): FormattedResult {
  const timestamp = typeof result.document.timestamp === 'string' 
    ? new Date(result.document.timestamp) 
    : result.document.timestamp;
  
  return {
    text: result.document.text,
    participants: result.document.participants,
    chatName: result.document.chat_name,
    timestamp: timestamp.toLocaleString(),
    relativeTime: getRelativeTime(timestamp),
    score: Math.round(result.score * 100) / 100,
    hasImage: result.document.has_image,
  };
}

/**
 * Format multiple search results for display
 */
export function formatResults(
  results: Array<{
    id: string;
    score: number;
    document: {
      text: string;
      participants: string[];
      chat_name: string | null;
      timestamp: Date | string;
      has_image: boolean;
    };
  }>,
  query: string,
  reasoning?: string
): string {
  if (results.length === 0) {
    return `No messages found for "${query}"`;
  }
  
  const lines = [
    `Found ${results.length} result${results.length === 1 ? '' : 's'} for "${query}"`,
  ];
  
  if (reasoning) {
    lines.push(`Query interpretation: ${reasoning}`);
  }
  
  lines.push('');
  
  for (let i = 0; i < results.length; i++) {
    const r = formatResult(results[i]);
    const header = r.chatName 
      ? `${r.chatName} (${r.participants.join(', ')})` 
      : r.participants.join(', ');
    
    lines.push(`--- Result ${i + 1} (score: ${r.score}) ---`);
    lines.push(`Chat: ${header}`);
    lines.push(`Time: ${r.timestamp} (${r.relativeTime})`);
    if (r.hasImage) lines.push('📷 Contains image');
    lines.push('');
    lines.push(r.text);
    lines.push('');
  }
  
  return lines.join('\n');
}

