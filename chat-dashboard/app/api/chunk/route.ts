/**
 * Chunk API Route
 * Fetches a single message chunk by its Elasticsearch document ID
 */

import { getElasticsearchClient } from '@/lib/elasticsearch';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return Response.json({ error: 'Missing chunk ID' }, { status: 400 });
  }

  try {
    const es = getElasticsearchClient();
    const result = await es.getChunkById(id);

    if (!result) {
      return Response.json({ error: 'Chunk not found' }, { status: 404 });
    }

    return Response.json(result);
  } catch (error) {
    console.error('Error fetching chunk:', error);
    return Response.json(
      { error: 'Failed to fetch chunk' },
      { status: 500 }
    );
  }
}

