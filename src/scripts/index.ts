#!/usr/bin/env node
/**
 * CLI script for indexing messages
 * Usage: pnpm index [--full] [--limit N]
 */

import 'dotenv/config';
import { getIndexer } from '../indexer/index.js';

function parseArgs(args: string[]): { fullReindex: boolean; limit?: number } {
  const fullReindex = args.includes('--full') || args.includes('-f');
  let limit: number | undefined;
  
  const limitIndex = args.findIndex(a => a === '--limit' || a === '-l');
  if (limitIndex !== -1 && args[limitIndex + 1]) {
    limit = parseInt(args[limitIndex + 1], 10);
    if (isNaN(limit) || limit <= 0) {
      console.error('Error: --limit must be a positive number');
      process.exit(1);
    }
  }
  
  return { fullReindex, limit };
}

async function main() {
  const args = process.argv.slice(2);
  const { fullReindex, limit } = parseArgs(args);
  
  console.log('');
  console.log('╔═══════════════════════════════════════╗');
  console.log('║      iMessage MCP - Indexer           ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log('');
  
  if (fullReindex) {
    console.log('⚠️  Full reindex mode - this will clear existing index\n');
  }
  
  if (limit) {
    console.log(`📊 Limiting to ${limit.toLocaleString()} messages\n`);
  }
  
  try {
    const indexer = getIndexer();
    const stats = await indexer.run({ fullReindex, maxMessages: limit });
    
    console.log('');
    console.log('╔═══════════════════════════════════════╗');
    console.log('║              Summary                  ║');
    console.log('╠═══════════════════════════════════════╣');
    console.log(`║  Messages processed: ${stats.messagesProcessed.toLocaleString().padStart(15)} ║`);
    console.log(`║  Chunks created:     ${stats.chunksCreated.toLocaleString().padStart(15)} ║`);
    console.log(`║  Chunks indexed:     ${stats.chunksIndexed.toLocaleString().padStart(15)} ║`);
    console.log(`║  Duration:           ${(stats.duration / 1000).toFixed(1).padStart(13)}s ║`);
    console.log('╚═══════════════════════════════════════╝');
    console.log('');
    
  } catch (err) {
    console.error('');
    console.error('❌ Indexing failed:', (err as Error).message);
    console.error('');
    process.exit(1);
  }
}

main();

