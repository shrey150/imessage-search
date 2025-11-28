#!/usr/bin/env node
/**
 * CLI script for testing smart search
 * Usage: pnpm search "your query here"
 */

import 'dotenv/config';
import { smartSearch, formatSmartSearchResults } from '../tools/smart-search.js';
import { getElasticsearchDB } from '../db/elasticsearch.js';

async function main() {
  const query = process.argv.slice(2).join(' ');
  
  if (!query) {
    console.log('Usage: pnpm search "your query here"');
    console.log('');
    console.log('Examples:');
    console.log('  pnpm search "What do I think about Mark?"');
    console.log('  pnpm search "dinner plans last week"');
    console.log('  pnpm search "messages from Mom in September"');
    process.exit(1);
  }
  
  console.log('');
  console.log('╔═══════════════════════════════════════╗');
  console.log('║    iMessage Smart Search Test         ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log('');
  
  // Check ES health
  const es = getElasticsearchDB();
  const healthy = await es.healthCheck();
  if (!healthy) {
    console.error('❌ Elasticsearch is not running. Start it with: pnpm es:start');
    process.exit(1);
  }
  
  const stats = await es.getStats();
  console.log(`📊 Index stats: ${stats?.documentCount.toLocaleString() || 0} documents, ${stats?.indexSize || '0 B'}`);
  console.log('');
  
  console.log(`🔍 Query: "${query}"`);
  console.log('');
  console.log('Parsing query with LLM...');
  
  try {
    const result = await smartSearch({ query, limit: 10 });
    
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('PARSED QUERY:');
    console.log('═══════════════════════════════════════');
    console.log(JSON.stringify(result.parsedQuery, null, 2));
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('RESULTS:');
    console.log('═══════════════════════════════════════');
    console.log(formatSmartSearchResults(result, query));
    
  } catch (err) {
    console.error('❌ Search failed:', (err as Error).message);
    process.exit(1);
  }
}

main();

