/**
 * Spotlight Search API
 * Fast, instant search over messages - no AI, just Elasticsearch
 * Uses combined phrase + keyword search for best exact matching results
 * Supports pagination with offset/limit for infinite scroll
 * Results sorted chronologically (newest first)
 */

import { getElasticsearchClient } from '@/lib/elasticsearch';
import 'dotenv/config';

export async function POST(req: Request) {
  const body = await req.json();
  const { query, offset = 0, limit = 20, chatId } = body;

  if (!query || typeof query !== 'string') {
    return Response.json({ messages: [], images: [], query: '', total: 0, hasMore: false });
  }

  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return Response.json({ messages: [], images: [], query: '', total: 0, hasMore: false });
  }

  try {
    const es = getElasticsearchClient();

    // Build filters - optionally scope to a specific chat
    const baseFilters: { chat_id?: string } = {};
    if (chatId && typeof chatId === 'string') {
      baseFilters.chat_id = chatId;
    }

    // Use exact search for better keyword matching (phrase + keyword combined)
    // This prioritizes exact phrase matches while still returning keyword matches
    // Results sorted by timestamp (newest first) for chronological browsing
    const messageResults = await es.spotlightSearch({
      query: trimmedQuery,
      filters: baseFilters,
      limit,
      offset,
    });

    // Search for messages with images (only on first page, and only if not scoped to a chat)
    let imageResults: { results: Array<{ id: string; score: number; document: unknown }>; total: number } = { results: [], total: 0 };
    if (offset === 0 && !chatId) {
      imageResults = await es.spotlightSearch({
        query: trimmedQuery,
        filters: { has_image: true },
        limit: 8,
      });
    }

    const hasMore = offset + messageResults.results.length < messageResults.total;

    return Response.json({
      messages: messageResults.results.map((r) => ({
        id: r.id,
        score: r.score,
        document: r.document,
      })),
      images: imageResults.results.map((r) => ({
        id: r.id,
        score: r.score,
        document: r.document,
      })),
      query: trimmedQuery, // Return query for highlighting
      total: messageResults.total,
      hasMore,
    });
  } catch (error) {
    console.error('Spotlight search error:', error);
    return Response.json(
      { error: 'Search failed', messages: [], images: [], query: '', total: 0, hasMore: false },
      { status: 500 }
    );
  }
}

