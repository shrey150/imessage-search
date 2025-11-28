/**
 * Tests for CLIP embeddings client
 * Tests the structure and interface without loading the actual model
 */

import { CLIPClient, getCLIPClient, CLIPEmbeddingResult } from '../embeddings/clip.js';

describe('CLIPClient', () => {
  describe('Interface', () => {
    it('should have correct dimensions', () => {
      const client = new CLIPClient();
      expect(client.dimensions).toBe(512);
    });

    it('should have correct model name', () => {
      const client = new CLIPClient();
      expect(client.model).toBe('Xenova/clip-vit-base-patch32');
    });

    it('should start with model not loaded', () => {
      const client = new CLIPClient();
      expect(client.isLoaded).toBe(false);
    });
  });

  describe('Singleton', () => {
    it('should return same instance from getCLIPClient', () => {
      const client1 = getCLIPClient();
      const client2 = getCLIPClient();
      expect(client1).toBe(client2);
    });
  });

  describe('CLIPEmbeddingResult interface', () => {
    it('should accept valid image result', () => {
      const result: CLIPEmbeddingResult = {
        path: '/path/to/image.jpg',
        embedding: [0.1, 0.2, 0.3],
      };
      
      expect(result.path).toBe('/path/to/image.jpg');
      expect(result.embedding.length).toBe(3);
    });

    it('should accept valid text result', () => {
      const result: CLIPEmbeddingResult = {
        text: 'photo of a dog',
        embedding: [0.1, 0.2, 0.3],
      };
      
      expect(result.text).toBe('photo of a dog');
      expect(result.embedding.length).toBe(3);
    });

    it('should accept result with both path and text', () => {
      const result: CLIPEmbeddingResult = {
        path: '/path/to/image.jpg',
        text: 'description',
        embedding: [0.1, 0.2, 0.3],
      };
      
      expect(result.path).toBeDefined();
      expect(result.text).toBeDefined();
    });
  });

  // Note: We don't test the actual embedding generation here because:
  // 1. It requires downloading the model (~150MB) on first run
  // 2. It's slow (several seconds)
  // 3. It requires GPU/CPU inference
  // 
  // Integration tests with actual embedding generation should be in a separate
  // test file that's excluded from normal test runs (e.g., clip.integration.test.ts)
});

