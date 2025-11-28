/**
 * OpenAI embeddings client for semantic search
 */

import OpenAI from 'openai';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMS = 1536;

class EmbeddingsClient {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMS,
    });

    return response.data[0].embedding;
  }
}

// Singleton
let client: EmbeddingsClient | null = null;

export function getEmbeddingsClient(): EmbeddingsClient {
  if (!client) {
    client = new EmbeddingsClient();
  }
  return client;
}

