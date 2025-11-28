#!/usr/bin/env node
/**
 * CLI script for checking indexing status
 * Usage: pnpm index:status
 */

import 'dotenv/config';
import { getIndexer } from '../indexer/index.js';
import { formatDate, formatRelative } from '../utils/timestamp.js';

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════╗');
  console.log('║    iMessage MCP - Index Status        ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log('');
  
  try {
    const indexer = getIndexer();
    const status = await indexer.getStatus();
    
    // Messages DB info
    console.log('📱 Messages Database');
    console.log('─────────────────────────────────────────');
    if (status.messageStats) {
      console.log(`  Total messages:     ${status.messageStats.totalMessages.toLocaleString()}`);
      console.log(`  Date range:         ${formatDate(status.messageStats.oldestDate)} - ${formatDate(status.messageStats.newestDate)}`);
      console.log(`  Rowid range:        ${status.messageStats.minRowid} - ${status.messageStats.maxRowid}`);
    } else {
      console.log('  ⚠️  Cannot read messages database');
    }
    console.log('');
    
    // Indexing state
    console.log('📊 Indexing State');
    console.log('─────────────────────────────────────────');
    console.log(`  Last indexed rowid: ${status.state.lastMessageRowid}`);
    console.log(`  Last indexed at:    ${status.state.lastIndexedAt ? formatDate(status.state.lastIndexedAt) + ' (' + formatRelative(status.state.lastIndexedAt) + ')' : 'Never'}`);
    console.log(`  Messages indexed:   ${status.state.totalMessagesIndexed.toLocaleString()}`);
    console.log(`  Chunks created:     ${status.state.totalChunksCreated.toLocaleString()}`);
    console.log(`  Pending messages:   ${status.pendingMessages.toLocaleString()}`);
    console.log('');
    
    // Qdrant info
    console.log('🔍 Qdrant Vector Database');
    console.log('─────────────────────────────────────────');
    if (status.qdrant) {
      console.log(`  Status:             ✅ Connected`);
      console.log(`  Points (chunks):    ${status.qdrant.pointCount.toLocaleString()}`);
      console.log(`  Segments:           ${status.qdrant.segmentCount}`);
    } else {
      console.log(`  Status:             ❌ Not connected`);
      console.log('  Run: pnpm qdrant:start');
    }
    console.log('');
    
    // Recommendations
    if (status.pendingMessages > 0) {
      console.log('💡 Recommendation');
      console.log('─────────────────────────────────────────');
      console.log(`  Run 'pnpm index' to index ${status.pendingMessages.toLocaleString()} pending messages`);
      console.log('');
    }
    
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  }
}

main();

