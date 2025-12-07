/**
 * OpenAI embeddings client
 * Uses text-embedding-3-small model for generating embeddings
 */

import OpenAI from 'openai';
import { log, ProgressBar } from '../utils/progress.js';

// Configuration
const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536; // Default dimensions for text-embedding-3-small
const BATCH_SIZE = 100;  // OpenAI allows up to 2048, but 100 is safer
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
// text-embedding-3-small has 8191 token limit; ~4 chars/token, use 28000 chars for safety
const MAX_TEXT_CHARS = 28000;

export interface EmbeddingResult {
  text: string;
  embedding: number[];
}

/**
 * OpenAI embeddings client with batching and retry logic
 */
export class EmbeddingsClient {
  private client: OpenAI;
  
  constructor(apiKey?: string) {
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
  }
  
  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0].embedding;
  }
  
  /**
   * Generate embeddings for multiple texts with batching
   */
  async embedBatch(texts: string[], showProgress = false): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];
    const batches = this.createBatches(texts, BATCH_SIZE);
    
    const progress = showProgress ? new ProgressBar('Embeddings', texts.length) : null;
    let processed = 0;
    
    for (const batch of batches) {
      const batchResults = await this.processBatchWithRetry(batch);
      results.push(...batchResults);
      
      processed += batch.length;
      progress?.update(processed);
    }
    
    progress?.complete();
    return results;
  }
  
  /**
   * Truncate text to fit within token limits
   */
  private truncateText(text: string): string {
    if (text.length <= MAX_TEXT_CHARS) return text;
    return text.slice(0, MAX_TEXT_CHARS) + '... [truncated]';
  }
  
  /**
   * Process a single batch with retry logic
   */
  private async processBatchWithRetry(texts: string[]): Promise<EmbeddingResult[]> {
    let lastError: Error | null = null;
    
    // Truncate any texts that are too long
    const safeTexts = texts.map(t => this.truncateText(t));
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.embeddings.create({
          model: MODEL,
          input: safeTexts,
          dimensions: DIMENSIONS,
        });
        
        return response.data.map((item, index) => ({
          text: texts[index],
          embedding: item.embedding,
        }));
      } catch (err) {
        lastError = err as Error;
        
        // Check if it's a rate limit error
        if ((err as any)?.status === 429) {
          log('Embeddings', `Rate limited, waiting ${RETRY_DELAY_MS * (attempt + 1)}ms...`, 'warn');
          await this.sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        
        // Check if it's a server error (5xx)
        if ((err as any)?.status >= 500) {
          log('Embeddings', `Server error, retrying in ${RETRY_DELAY_MS}ms...`, 'warn');
          await this.sleep(RETRY_DELAY_MS);
          continue;
        }
        
        // For other errors, don't retry
        throw err;
      }
    }
    
    throw lastError || new Error('Failed to generate embeddings after retries');
  }
  
  /**
   * Split texts into batches
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }
  
  /**
   * Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Get the embedding dimensions
   */
  get dimensions(): number {
    return DIMENSIONS;
  }
  
  /**
   * Get the model name
   */
  get model(): string {
    return MODEL;
  }
}

// Singleton instance
let clientInstance: EmbeddingsClient | null = null;

export function getEmbeddingsClient(apiKey?: string): EmbeddingsClient {
  if (!clientInstance) {
    clientInstance = new EmbeddingsClient(apiKey);
  }
  return clientInstance;
}

/**
 * Convenience function to generate a single embedding
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getEmbeddingsClient();
  return client.embed(text);
}

