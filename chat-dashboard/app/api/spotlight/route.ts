/**
 * Spotlight Search API
 * Fast, instant search over messages - no AI, just Elasticsearch
 * Uses combined phrase + keyword search for best exact matching results
 */

import { getElasticsearchClient } from '@/lib/elasticsearch';
import 'dotenv/config';

export async function POST(req: Request) {
  const { query } = await req.json();

  if (!query || typeof query !== 'string') {
    return Response.json({ messages: [], images: [], query: '' });
  }

  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return Response.json({ messages: [], images: [], query: '' });
  }

  try {
    const es = getElasticsearchClient();

    // Use exact search for better keyword matching (phrase + keyword combined)
    // This prioritizes exact phrase matches while still returning keyword matches
    const messageResults = await es.spotlightSearch({
      query: trimmedQuery,
      filters: {},
      limit: 20,
    });

    // Search for messages with images
    const imageResults = await es.spotlightSearch({
      query: trimmedQuery,
      filters: { has_image: true },
      limit: 8,
    });

    return Response.json({
      messages: messageResults.map((r) => ({
        id: r.id,
        score: r.score,
        document: r.document,
      })),
      images: imageResults.map((r) => ({
        id: r.id,
        score: r.score,
        document: r.document,
      })),
      query: trimmedQuery, // Return query for highlighting
    });
  } catch (error) {
    console.error('Spotlight search error:', error);
    return Response.json(
      { error: 'Search failed', messages: [], images: [], query: '' },
      { status: 500 }
    );
  }
}

