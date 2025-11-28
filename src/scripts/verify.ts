#!/usr/bin/env node
/**
 * Verify indexing completeness
 * Compares message counts across all data sources
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { QdrantClient } from '@qdrant/js-client-rest';

const MESSAGES_DB = `${homedir()}/Library/Messages/chat.db`;
const STATE_DB = `${homedir()}/.imessage-mcp/state.db`;
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION_NAME = 'imessage_chunks';

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║         iMessage MCP - Index Verification         ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');

  // 1. Check Messages.db
  console.log('📱 Messages Database (chat.db)');
  console.log('─'.repeat(50));
  
  const messagesDb = Database(MESSAGES_DB, { readonly: true });
  
  const totalMessages = messagesDb.prepare(`
    SELECT COUNT(*) as count FROM message 
    WHERE text IS NOT NULL AND text != ''
  `).get() as { count: number };
  
  const maxRowid = messagesDb.prepare(`
    SELECT MAX(ROWID) as max FROM message
  `).get() as { max: number };
  
  const minRowid = messagesDb.prepare(`
    SELECT MIN(ROWID) as min FROM message 
    WHERE text IS NOT NULL AND text != ''
  `).get() as { min: number };
  
  // Get message distribution by year
  const messagesByYear = messagesDb.prepare(`
    SELECT 
      strftime('%Y', datetime(date/1000000000 + 978307200, 'unixepoch')) as year,
      COUNT(*) as count
    FROM message 
    WHERE text IS NOT NULL AND text != ''
    GROUP BY year
    ORDER BY year DESC
  `).all() as { year: string; count: number }[];
  
  console.log(`  Total messages with text:  ${totalMessages.count.toLocaleString()}`);
  console.log(`  Rowid range:               ${minRowid.min} - ${maxRowid.max}`);
  console.log('');
  console.log('  Messages by year:');
  for (const row of messagesByYear.slice(0, 5)) {
    console.log(`    ${row.year}: ${row.count.toLocaleString()}`);
  }
  
  messagesDb.close();
  
  // 2. Check State DB
  console.log('');
  console.log('📊 Indexing State (state.db)');
  console.log('─'.repeat(50));
  
  try {
    const stateDb = Database(STATE_DB, { readonly: true });
    
    const state = stateDb.prepare(`
      SELECT * FROM indexing_state WHERE id = 1
    `).get() as {
      last_message_rowid: number;
      last_indexed_at: number;
      total_messages_indexed: number;
      total_chunks_created: number;
    };
    
    const chunkCount = stateDb.prepare(`
      SELECT COUNT(*) as count FROM indexed_chunks
    `).get() as { count: number };
    
    console.log(`  Last indexed rowid:        ${state.last_message_rowid.toLocaleString()}`);
    console.log(`  Messages indexed (state):  ${state.total_messages_indexed.toLocaleString()}`);
    console.log(`  Chunks in state DB:        ${chunkCount.count.toLocaleString()}`);
    
    // Calculate coverage
    const coverage = (state.last_message_rowid / maxRowid.max * 100).toFixed(1);
    console.log(`  Rowid coverage:            ${coverage}%`);
    
    stateDb.close();
  } catch (e) {
    console.log('  ⚠️  State database not found or empty');
  }
  
  // 3. Check Qdrant
  console.log('');
  console.log('🔍 Qdrant Vector Database');
  console.log('─'.repeat(50));
  
  try {
    const qdrant = new QdrantClient({ url: QDRANT_URL });
    const collection = await qdrant.getCollection(COLLECTION_NAME);
    
    console.log(`  Points (chunks):           ${collection.points_count?.toLocaleString()}`);
    console.log(`  Indexed vectors:           ${collection.indexed_vectors_count?.toLocaleString()}`);
    console.log(`  Segments:                  ${collection.segments_count}`);
    console.log(`  Status:                    ${collection.status}`);
    
    // Sample a few points to verify they have data
    const sample = await qdrant.scroll(COLLECTION_NAME, {
      limit: 5,
      with_payload: true,
      with_vector: false,
    });
    
    console.log('');
    console.log('  Sample chunks:');
    for (const point of sample.points) {
      const payload = point.payload as any;
      const participants = payload.participants?.filter((p: string) => p !== 'Me').join(', ') || 'Unknown';
      const msgCount = payload.message_count || '?';
      console.log(`    - ${participants.substring(0, 30).padEnd(30)} (${msgCount} msgs)`);
    }
    
  } catch (e) {
    console.log(`  ❌ Cannot connect to Qdrant: ${e}`);
  }
  
  // 4. Summary & Analysis
  console.log('');
  console.log('📋 Analysis');
  console.log('─'.repeat(50));
  
  // Re-open state to get numbers for analysis
  try {
    const stateDb = Database(STATE_DB, { readonly: true });
    const state = stateDb.prepare(`SELECT * FROM indexing_state WHERE id = 1`).get() as any;
    const chunkCount = (stateDb.prepare(`SELECT COUNT(*) as count FROM indexed_chunks`).get() as any).count;
    stateDb.close();
    
    const messagesNotIndexed = totalMessages.count - state.total_messages_indexed;
    const avgMessagesPerChunk = state.total_messages_indexed / chunkCount;
    
    console.log(`  Messages in DB:            ${totalMessages.count.toLocaleString()}`);
    console.log(`  Messages indexed:          ${state.total_messages_indexed.toLocaleString()}`);
    console.log(`  Messages NOT indexed:      ${messagesNotIndexed.toLocaleString()}`);
    console.log(`  Avg messages per chunk:    ${avgMessagesPerChunk.toFixed(1)}`);
    
    if (messagesNotIndexed > 0) {
      console.log('');
      console.log(`  ⚠️  ${messagesNotIndexed.toLocaleString()} messages still need indexing!`);
      console.log('     Run: pnpm index');
    } else if (state.last_message_rowid >= maxRowid.max) {
      console.log('');
      console.log('  ✅ All messages have been indexed!');
    }
    
  } catch (e) {
    console.log('  Could not complete analysis');
  }
  
  console.log('');
}

main().catch(console.error);

