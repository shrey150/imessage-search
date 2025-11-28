/**
 * Tests for message chunk enrichment
 * Verifies derived field extraction and document conversion
 */

import { enrichChunk, enrichChunks, toESDocument } from '../indexer/enrichment.js';
import { MessageChunk } from '../indexer/chunker.js';

describe('Enrichment', () => {
  const createMockChunk = (overrides: Partial<MessageChunk> = {}): MessageChunk => ({
    id: 'test-chunk-id',
    text: '[Alice 2:30 PM] Hello there!\n[Me 2:31 PM] Hi Alice!',
    startTs: 1700000000,  // Unix timestamp
    endTs: 1700000060,
    participants: ['Alice', 'Me'],
    chatIdentifier: 'chat123',
    groupName: null,
    isGroupChat: false,
    messageRowids: [100, 101],
    messageCount: 2,
    ...overrides,
  });

  describe('enrichChunk', () => {
    describe('sender extraction', () => {
      it('should extract primary sender (non-Me) from chunk text', () => {
        const chunk = createMockChunk({
          text: '[Alice 2:30 PM] Message 1\n[Alice 2:31 PM] Message 2\n[Me 2:32 PM] Reply',
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.sender).toBe('Alice');
      });

      it('should return Me as sender if all messages from Me', () => {
        const chunk = createMockChunk({
          text: '[Me 2:30 PM] Hello\n[Me 2:31 PM] Anyone there?',
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.sender).toBe('Me');
      });

      it('should identify most frequent sender excluding Me', () => {
        const chunk = createMockChunk({
          text: '[Alice 2:30 PM] Hi\n[Bob 2:31 PM] Hello\n[Alice 2:32 PM] How are you?\n[Me 2:33 PM] Good',
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.sender).toBe('Alice');
      });

      it('should handle 12-hour time format', () => {
        const chunk = createMockChunk({
          text: '[Alice 2:30 PM] Afternoon message\n[Alice 10:30 AM] Morning message',
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.sender).toBe('Alice');
      });

      it('should handle 24-hour time format', () => {
        const chunk = createMockChunk({
          text: '[Alice 14:30] Message 1\n[Bob 14:31] Message 2',
        });
        
        const enriched = enrichChunk(chunk);
        
        // Should extract Alice or Bob based on count
        expect(['Alice', 'Bob']).toContain(enriched.sender);
      });
    });

    describe('sender_is_me detection', () => {
      it('should return true when majority of messages are from Me', () => {
        const chunk = createMockChunk({
          text: '[Me 2:30 PM] Hi\n[Me 2:31 PM] How are you?\n[Alice 2:32 PM] Good',
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.sender_is_me).toBe(true);
      });

      it('should return false when minority of messages are from Me', () => {
        const chunk = createMockChunk({
          text: '[Alice 2:30 PM] Hi\n[Alice 2:31 PM] How are you?\n[Me 2:32 PM] Good',
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.sender_is_me).toBe(false);
      });
    });

    describe('DM vs group chat detection', () => {
      it('should identify DM (2 participants, no group name)', () => {
        const chunk = createMockChunk({
          participants: ['Alice', 'Me'],
          groupName: null,
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.is_dm).toBe(true);
        expect(enriched.is_group_chat).toBe(false);
      });

      it('should identify group chat by group name', () => {
        const chunk = createMockChunk({
          participants: ['Alice', 'Me'],
          groupName: 'Family Chat',
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.is_dm).toBe(false);
        expect(enriched.is_group_chat).toBe(true);
      });

      it('should identify group chat by participant count > 2', () => {
        const chunk = createMockChunk({
          participants: ['Alice', 'Bob', 'Charlie', 'Me'],
          groupName: null,
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.is_dm).toBe(false);
        expect(enriched.is_group_chat).toBe(true);
      });

      it('should identify single-participant as DM', () => {
        const chunk = createMockChunk({
          participants: ['Me'],
          groupName: null,
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.is_dm).toBe(true);
      });
    });

    describe('temporal field extraction', () => {
      it('should extract year from timestamp', () => {
        // Unix timestamp for Nov 14, 2023
        const chunk = createMockChunk({
          startTs: 1700000000,
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.year).toBe(2023);
      });

      it('should extract month (1-indexed) from timestamp', () => {
        // Unix timestamp for Nov 14, 2023
        const chunk = createMockChunk({
          startTs: 1700000000,
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.month).toBe(11); // November
      });

      it('should extract day_of_week from timestamp', () => {
        // Unix timestamp for Nov 14, 2023 (Tuesday)
        const chunk = createMockChunk({
          startTs: 1700000000,
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.day_of_week).toBe('tuesday');
      });

      it('should extract hour_of_day from timestamp', () => {
        const chunk = createMockChunk({
          startTs: 1700000000,
        });
        
        const enriched = enrichChunk(chunk);
        
        // Hour will depend on timezone, just verify it's a valid hour
        expect(enriched.hour_of_day).toBeGreaterThanOrEqual(0);
        expect(enriched.hour_of_day).toBeLessThanOrEqual(23);
      });

      it('should create Date objects for timestamp fields', () => {
        const chunk = createMockChunk({
          startTs: 1700000000,
          endTs: 1700000060,
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.timestamp).toBeInstanceOf(Date);
        expect(enriched.start_timestamp).toBeInstanceOf(Date);
        expect(enriched.end_timestamp).toBeInstanceOf(Date);
      });
    });

    describe('metadata fields', () => {
      it('should copy participants array', () => {
        const chunk = createMockChunk({
          participants: ['Alice', 'Bob', 'Charlie'],
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.participants).toEqual(['Alice', 'Bob', 'Charlie']);
        expect(enriched.participant_count).toBe(3);
      });

      it('should copy chat_id from chatIdentifier', () => {
        const chunk = createMockChunk({
          chatIdentifier: 'chat-identifier-123',
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.chat_id).toBe('chat-identifier-123');
      });

      it('should copy chat_name from groupName', () => {
        const chunk = createMockChunk({
          groupName: 'My Group Chat',
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.chat_name).toBe('My Group Chat');
      });

      it('should copy chunk metadata', () => {
        const chunk = createMockChunk({
          id: 'chunk-id-abc',
          messageCount: 5,
        });
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.id).toBe('chunk-id-abc');
        expect(enriched.chunk_id).toBe('chunk-id-abc');
        expect(enriched.message_count).toBe(5);
      });

      it('should default has_attachment and has_image to false', () => {
        const chunk = createMockChunk();
        
        const enriched = enrichChunk(chunk);
        
        expect(enriched.has_attachment).toBe(false);
        expect(enriched.has_image).toBe(false);
      });
    });
  });

  describe('enrichChunks', () => {
    it('should enrich multiple chunks', () => {
      const chunks = [
        createMockChunk({ id: 'chunk1' }),
        createMockChunk({ id: 'chunk2', groupName: 'Test Group' }),
      ];
      
      const enriched = enrichChunks(chunks);
      
      expect(enriched.length).toBe(2);
      expect(enriched[0].id).toBe('chunk1');
      expect(enriched[1].id).toBe('chunk2');
      expect(enriched[0].is_dm).toBe(true);
      expect(enriched[1].is_group_chat).toBe(true);
    });

    it('should handle empty array', () => {
      const enriched = enrichChunks([]);
      expect(enriched).toEqual([]);
    });
  });

  describe('toESDocument', () => {
    it('should convert enriched chunk to ES document format', () => {
      const chunk = createMockChunk();
      const enriched = enrichChunk(chunk);
      
      const doc = toESDocument(enriched);
      
      expect(doc.id).toBe(enriched.id);
      expect(doc.text).toBe(enriched.text);
      expect(doc.sender).toBe(enriched.sender);
      expect(doc.participants).toEqual(enriched.participants);
      expect(doc.is_dm).toBe(enriched.is_dm);
      expect(doc.timestamp).toEqual(enriched.timestamp);
    });

    it('should include embedding when provided', () => {
      const chunk = createMockChunk();
      const enriched = enrichChunk(chunk);
      const embedding = [0.1, 0.2, 0.3, 0.4];
      
      const doc = toESDocument(enriched, embedding);
      
      expect(doc.text_embedding).toEqual(embedding);
    });

    it('should not include embedding when not provided', () => {
      const chunk = createMockChunk();
      const enriched = enrichChunk(chunk);
      
      const doc = toESDocument(enriched);
      
      expect(doc.text_embedding).toBeUndefined();
    });
  });
});

