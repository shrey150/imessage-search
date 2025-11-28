/**
 * Tests for hashing utilities
 */

import { sha256, chunkToUUID } from '../utils/hash.js';

describe('Hash utilities', () => {
  describe('sha256', () => {
    it('should produce consistent hash for same input', () => {
      const hash1 = sha256('hello world');
      const hash2 = sha256('hello world');
      
      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different input', () => {
      const hash1 = sha256('hello world');
      const hash2 = sha256('hello world!');
      
      expect(hash1).not.toBe(hash2);
    });

    it('should produce 64 character hex string', () => {
      const hash = sha256('test');
      
      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('should match known SHA256 value', () => {
      // Known SHA256 of "hello"
      const hash = sha256('hello');
      
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });
  });

  describe('chunkToUUID', () => {
    it('should produce valid UUID format', () => {
      const uuid = chunkToUUID('test chunk content');
      
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      expect(uuid).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    });

    it('should produce consistent UUID for same content', () => {
      const uuid1 = chunkToUUID('same content');
      const uuid2 = chunkToUUID('same content');
      
      expect(uuid1).toBe(uuid2);
    });

    it('should produce different UUID for different content', () => {
      const uuid1 = chunkToUUID('content A');
      const uuid2 = chunkToUUID('content B');
      
      expect(uuid1).not.toBe(uuid2);
    });
  });
});

