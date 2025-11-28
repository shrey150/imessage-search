/**
 * Tests for Elasticsearch Query Builder
 * Tests filter building, result formatting, and query type detection
 */

import {
  buildSearchOptions,
  getQueryTextForEmbedding,
  needsVectorSearch,
  needsKeywordSearch,
  needsImageSearch,
  formatResult,
  formatResults,
} from '../tools/es-query-builder.js';
import { ParsedQuery, QueryParser } from '../tools/query-parser.js';

describe('ES Query Builder', () => {
  // Create a mock QueryParser for testing
  const mockQueryParser = {
    resolveTemporalFilter: (temporal: ParsedQuery['temporal']) => {
      // Simple mock that passes through values
      if (!temporal) return {};
      return {
        timestamp_gte: temporal.date_gte,
        timestamp_lte: temporal.date_lte,
        year: temporal.year,
        month: temporal.month || temporal.months,
        day_of_week: temporal.day_of_week?.toLowerCase(),
        hour_of_day_gte: temporal.hour_gte,
        hour_of_day_lte: temporal.hour_lte,
      };
    }
  } as QueryParser;

  describe('getQueryTextForEmbedding', () => {
    it('should prefer semantic_query', () => {
      const parsed: ParsedQuery = {
        query_type: 'hybrid',
        semantic_query: 'semantic search text',
        keyword_query: 'keyword text',
        reasoning: 'test',
      };
      
      expect(getQueryTextForEmbedding(parsed)).toBe('semantic search text');
    });

    it('should fallback to keyword_query', () => {
      const parsed: ParsedQuery = {
        query_type: 'keyword',
        keyword_query: 'keyword text',
        reasoning: 'test',
      };
      
      expect(getQueryTextForEmbedding(parsed)).toBe('keyword text');
    });

    it('should fallback to image_query', () => {
      const parsed: ParsedQuery = {
        query_type: 'image_search',
        image_query: 'photo of a dog',
        reasoning: 'test',
      };
      
      expect(getQueryTextForEmbedding(parsed)).toBe('photo of a dog');
    });

    it('should return empty string if no query', () => {
      const parsed: ParsedQuery = {
        query_type: 'temporal',
        reasoning: 'test',
      };
      
      expect(getQueryTextForEmbedding(parsed)).toBe('');
    });
  });

  describe('needsVectorSearch', () => {
    it('should return true for semantic_query', () => {
      const parsed: ParsedQuery = {
        query_type: 'keyword',
        semantic_query: 'some semantic query',
        reasoning: 'test',
      };
      
      expect(needsVectorSearch(parsed)).toBe(true);
    });

    it('should return true for about_person query type', () => {
      const parsed: ParsedQuery = {
        query_type: 'about_person',
        reasoning: 'test',
      };
      
      expect(needsVectorSearch(parsed)).toBe(true);
    });

    it('should return true for hybrid query type', () => {
      const parsed: ParsedQuery = {
        query_type: 'hybrid',
        reasoning: 'test',
      };
      
      expect(needsVectorSearch(parsed)).toBe(true);
    });

    it('should return false for keyword-only query', () => {
      const parsed: ParsedQuery = {
        query_type: 'keyword',
        keyword_query: 'exact text',
        reasoning: 'test',
      };
      
      expect(needsVectorSearch(parsed)).toBe(false);
    });
  });

  describe('needsKeywordSearch', () => {
    it('should return true for keyword_query', () => {
      const parsed: ParsedQuery = {
        query_type: 'hybrid',
        keyword_query: 'some keywords',
        reasoning: 'test',
      };
      
      expect(needsKeywordSearch(parsed)).toBe(true);
    });

    it('should return true for keyword query type', () => {
      const parsed: ParsedQuery = {
        query_type: 'keyword',
        reasoning: 'test',
      };
      
      expect(needsKeywordSearch(parsed)).toBe(true);
    });

    it('should return true for hybrid query type', () => {
      const parsed: ParsedQuery = {
        query_type: 'hybrid',
        reasoning: 'test',
      };
      
      expect(needsKeywordSearch(parsed)).toBe(true);
    });

    it('should return false for semantic-only query', () => {
      const parsed: ParsedQuery = {
        query_type: 'about_person',
        semantic_query: 'semantic only',
        reasoning: 'test',
      };
      
      expect(needsKeywordSearch(parsed)).toBe(false);
    });
  });

  describe('needsImageSearch', () => {
    it('should return true for image_search with image_query', () => {
      const parsed: ParsedQuery = {
        query_type: 'image_search',
        image_query: 'photo of a dog',
        reasoning: 'test',
      };
      
      expect(needsImageSearch(parsed)).toBe(true);
    });

    it('should return false for image_search without image_query', () => {
      const parsed: ParsedQuery = {
        query_type: 'image_search',
        reasoning: 'test',
      };
      
      expect(needsImageSearch(parsed)).toBe(false);
    });

    it('should return false for non-image query type with image_query', () => {
      const parsed: ParsedQuery = {
        query_type: 'hybrid',
        image_query: 'photo of a dog',
        reasoning: 'test',
      };
      
      expect(needsImageSearch(parsed)).toBe(false);
    });
  });

  describe('buildSearchOptions', () => {
    it('should build basic options with queries', () => {
      const parsed: ParsedQuery = {
        query_type: 'hybrid',
        semantic_query: 'semantic text',
        keyword_query: 'keyword text',
        reasoning: 'test',
      };
      
      const options = buildSearchOptions(parsed, mockQueryParser, { limit: 20 });
      
      expect(options.semanticQuery).toBe('semantic text');
      expect(options.keywordQuery).toBe('keyword text');
      expect(options.limit).toBe(20);
    });

    it('should include query embedding when provided', () => {
      const parsed: ParsedQuery = {
        query_type: 'hybrid',
        semantic_query: 'test',
        reasoning: 'test',
      };
      
      const embedding = [0.1, 0.2, 0.3];
      const options = buildSearchOptions(parsed, mockQueryParser, { queryEmbedding: embedding });
      
      expect(options.queryEmbedding).toEqual(embedding);
    });

    it('should build filters from parsed query', () => {
      const parsed: ParsedQuery = {
        query_type: 'from_person',
        semantic_query: 'test',
        filters: {
          sender: 'John',
          is_dm: true,
        },
        reasoning: 'test',
      };
      
      const options = buildSearchOptions(parsed, mockQueryParser);
      
      expect(options.filters?.sender).toBe('John');
      expect(options.filters?.is_dm).toBe(true);
    });

    it('should build exclude filters', () => {
      const parsed: ParsedQuery = {
        query_type: 'about_person',
        semantic_query: 'test',
        exclude: {
          is_dm_with: 'Mark',
        },
        reasoning: 'test',
      };
      
      const options = buildSearchOptions(parsed, mockQueryParser);
      
      expect(options.exclude?.is_dm_with).toBe('Mark');
    });

    it('should build boost config', () => {
      const parsed: ParsedQuery = {
        query_type: 'about_person',
        semantic_query: 'test',
        boost: {
          sender_is_me: 2.0,
          is_group_chat: 1.5,
        },
        reasoning: 'test',
      };
      
      const options = buildSearchOptions(parsed, mockQueryParser);
      
      expect(options.boost?.sender_is_me).toBe(2.0);
      expect(options.boost?.is_group_chat).toBe(1.5);
    });

    it('should set has_image filter for image_search', () => {
      const parsed: ParsedQuery = {
        query_type: 'image_search',
        image_query: 'photo of dog',
        reasoning: 'test',
      };
      
      const options = buildSearchOptions(parsed, mockQueryParser);
      
      expect(options.filters?.has_image).toBe(true);
    });

    it('should handle all filter types', () => {
      const parsed: ParsedQuery = {
        query_type: 'hybrid',
        semantic_query: 'test',
        filters: {
          sender: 'Alice',
          sender_is_me: false,
          participants: ['Alice', 'Bob'],
          chat_name: 'Test Group',
          is_group_chat: true,
          has_image: true,
        },
        reasoning: 'test',
      };
      
      const options = buildSearchOptions(parsed, mockQueryParser);
      
      expect(options.filters?.sender).toBe('Alice');
      expect(options.filters?.sender_is_me).toBe(false);
      expect(options.filters?.participants).toEqual(['Alice', 'Bob']);
      expect(options.filters?.chat_name).toBe('Test Group');
      expect(options.filters?.is_group_chat).toBe(true);
      expect(options.filters?.has_image).toBe(true);
    });
  });

  describe('formatResult', () => {
    it('should format a search result', () => {
      const result = {
        id: 'test-id',
        score: 0.95432,
        document: {
          text: 'Hello world',
          participants: ['Alice', 'Bob'],
          chat_name: 'Test Chat',
          timestamp: new Date('2025-01-15T14:30:00Z'),
          has_image: false,
        },
      };
      
      const formatted = formatResult(result);
      
      expect(formatted.text).toBe('Hello world');
      expect(formatted.participants).toEqual(['Alice', 'Bob']);
      expect(formatted.chatName).toBe('Test Chat');
      expect(formatted.score).toBe(0.95);
      expect(formatted.hasImage).toBe(false);
      expect(formatted.timestamp).toContain('2025');
    });

    it('should handle string timestamp', () => {
      const result = {
        id: 'test-id',
        score: 0.8,
        document: {
          text: 'Test message',
          participants: ['User'],
          chat_name: null,
          timestamp: '2025-06-15T10:00:00Z',
          has_image: true,
        },
      };
      
      const formatted = formatResult(result);
      
      expect(formatted.timestamp).toContain('2025');
      expect(formatted.hasImage).toBe(true);
    });
  });

  describe('formatResults', () => {
    it('should format empty results', () => {
      const formatted = formatResults([], 'test query');
      
      expect(formatted).toContain('No messages found');
      expect(formatted).toContain('test query');
    });

    it('should format single result', () => {
      const results = [{
        id: 'test-id',
        score: 0.9,
        document: {
          text: 'Hello there',
          participants: ['Alice'],
          chat_name: null,
          timestamp: new Date('2025-01-15T14:30:00Z'),
          has_image: false,
        },
      }];
      
      const formatted = formatResults(results, 'greeting');
      
      expect(formatted).toContain('Found 1 result');
      expect(formatted).toContain('greeting');
      expect(formatted).toContain('Hello there');
      expect(formatted).toContain('Alice');
    });

    it('should format multiple results', () => {
      const results = [
        {
          id: 'id1',
          score: 0.95,
          document: {
            text: 'First message',
            participants: ['Alice', 'Bob'],
            chat_name: 'Group Chat',
            timestamp: new Date('2025-01-15'),
            has_image: false,
          },
        },
        {
          id: 'id2',
          score: 0.85,
          document: {
            text: 'Second message',
            participants: ['Charlie'],
            chat_name: null,
            timestamp: new Date('2025-01-14'),
            has_image: true,
          },
        },
      ];
      
      const formatted = formatResults(results, 'test');
      
      expect(formatted).toContain('Found 2 results');
      expect(formatted).toContain('Result 1');
      expect(formatted).toContain('Result 2');
      expect(formatted).toContain('First message');
      expect(formatted).toContain('Second message');
      expect(formatted).toContain('📷 Contains image');
    });

    it('should include reasoning if provided', () => {
      const results = [{
        id: 'id1',
        score: 0.9,
        document: {
          text: 'Test',
          participants: ['User'],
          chat_name: null,
          timestamp: new Date(),
          has_image: false,
        },
      }];
      
      const formatted = formatResults(results, 'test', 'Looking for semantic matches');
      
      expect(formatted).toContain('Query interpretation: Looking for semantic matches');
    });
  });
});

