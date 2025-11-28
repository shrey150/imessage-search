/**
 * Tests for Image Search tool
 * Tests the formatting functions and input validation
 */

import { formatImageSearchResults, imageSearchSchema } from '../tools/image-search.js';
import { SearchResult } from '../db/elasticsearch.js';

describe('Image Search', () => {
  describe('imageSearchSchema', () => {
    it('should accept valid minimal input', () => {
      const input = { query: 'photo of a dog' };
      const result = imageSearchSchema.safeParse(input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query).toBe('photo of a dog');
        expect(result.data.limit).toBe(10); // default
      }
    });

    it('should accept valid full input', () => {
      const input = {
        query: 'photo of a dog',
        sender: 'Alice',
        chatName: 'Pet Photos',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        limit: 25,
      };
      const result = imageSearchSchema.safeParse(input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query).toBe('photo of a dog');
        expect(result.data.sender).toBe('Alice');
        expect(result.data.chatName).toBe('Pet Photos');
        expect(result.data.startDate).toBe('2024-01-01');
        expect(result.data.endDate).toBe('2024-12-31');
        expect(result.data.limit).toBe(25);
      }
    });

    it('should reject missing query', () => {
      const input = { sender: 'Alice' };
      const result = imageSearchSchema.safeParse(input);
      
      expect(result.success).toBe(false);
    });

    it('should reject limit below 1', () => {
      const input = { query: 'test', limit: 0 };
      const result = imageSearchSchema.safeParse(input);
      
      expect(result.success).toBe(false);
    });

    it('should reject limit above 50', () => {
      const input = { query: 'test', limit: 100 };
      const result = imageSearchSchema.safeParse(input);
      
      expect(result.success).toBe(false);
    });

    it('should accept limit at boundaries', () => {
      const input1 = { query: 'test', limit: 1 };
      const input50 = { query: 'test', limit: 50 };
      
      expect(imageSearchSchema.safeParse(input1).success).toBe(true);
      expect(imageSearchSchema.safeParse(input50).success).toBe(true);
    });
  });

  describe('formatImageSearchResults', () => {
    const createMockResult = (overrides: Partial<SearchResult> = {}): SearchResult => ({
      id: 'result-id',
      score: 0.95,
      document: {
        text: '[Alice 2:30 PM] Check out this photo!',
        text_embedding: undefined,
        sender: 'Alice',
        sender_is_me: false,
        participants: ['Alice', 'Me'],
        participant_count: 2,
        chat_id: 'chat123',
        chat_name: null,
        is_dm: true,
        is_group_chat: false,
        timestamp: new Date('2025-01-15T14:30:00Z'),
        year: 2025,
        month: 1,
        day_of_week: 'wednesday',
        hour_of_day: 14,
        has_attachment: true,
        has_image: true,
        chunk_id: 'chunk123',
        message_count: 1,
        start_timestamp: new Date('2025-01-15T14:30:00Z'),
        end_timestamp: new Date('2025-01-15T14:30:00Z'),
      },
      ...overrides,
    });

    it('should format empty results', () => {
      const formatted = formatImageSearchResults([], 'photo of a dog');
      
      expect(formatted).toBe('No images found matching "photo of a dog"');
    });

    it('should format single result', () => {
      const results = [createMockResult()];
      const formatted = formatImageSearchResults(results, 'photo');
      
      expect(formatted).toContain('Found 1 image matching "photo"');
      expect(formatted).toContain('Image 1');
      expect(formatted).toContain('score: 0.95');
      expect(formatted).toContain('Alice');
      expect(formatted).toContain('Check out this photo!');
    });

    it('should format multiple results', () => {
      const results = [
        createMockResult({ id: 'id1', score: 0.9 }),
        createMockResult({ 
          id: 'id2', 
          score: 0.8,
          document: {
            ...createMockResult().document,
            text: '[Bob 3:00 PM] Another photo',
            participants: ['Bob', 'Me'],
            chat_name: 'Photo Group',
          }
        }),
      ];
      const formatted = formatImageSearchResults(results, 'photos');
      
      expect(formatted).toContain('Found 2 images matching "photos"');
      expect(formatted).toContain('Image 1');
      expect(formatted).toContain('Image 2');
      expect(formatted).toContain('Check out this photo!');
      expect(formatted).toContain('Another photo');
    });

    it('should display chat name when present', () => {
      const results = [createMockResult({
        document: {
          ...createMockResult().document,
          chat_name: 'Family Photos',
          participants: ['Alice', 'Bob', 'Me'],
        }
      })];
      const formatted = formatImageSearchResults(results, 'test');
      
      expect(formatted).toContain('Family Photos');
      expect(formatted).toContain('Alice, Bob, Me');
    });

    it('should display participants when no chat name', () => {
      const results = [createMockResult({
        document: {
          ...createMockResult().document,
          chat_name: null,
          participants: ['Alice', 'Me'],
        }
      })];
      const formatted = formatImageSearchResults(results, 'test');
      
      expect(formatted).toContain('Alice, Me');
    });

    it('should handle string timestamp', () => {
      const results = [createMockResult({
        document: {
          ...createMockResult().document,
          timestamp: '2025-06-15T10:00:00Z' as unknown as Date,
        }
      })];
      
      // Should not throw
      const formatted = formatImageSearchResults(results, 'test');
      expect(formatted).toContain('Found 1 image');
    });

    it('should round score to 2 decimal places', () => {
      const results = [createMockResult({ score: 0.87654321 })];
      const formatted = formatImageSearchResults(results, 'test');
      
      expect(formatted).toContain('score: 0.88');
    });

    it('should use correct singular form for 1 image', () => {
      const results = [createMockResult()];
      const formatted = formatImageSearchResults(results, 'test');
      
      expect(formatted).toContain('Found 1 image');
      expect(formatted).not.toContain('images');
    });

    it('should use correct plural form for multiple images', () => {
      const results = [
        createMockResult({ id: 'id1' }),
        createMockResult({ id: 'id2' }),
      ];
      const formatted = formatImageSearchResults(results, 'test');
      
      expect(formatted).toContain('Found 2 images');
    });
  });
});

