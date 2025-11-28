/**
 * Deep verification of ES <-> State DB consistency
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { getElasticsearchDB } from '../db/elasticsearch.js';

const STATE_DB = `${homedir()}/.imessage-mcp/state.db`;

async function deepVerify() {
  console.log('╔═══════════════════════════════════════╗');
  console.log('║     Deep Verification Check           ║');
  console.log('╚═══════════════════════════════════════╝\n');

  // Open state DB
  const stateDb = Database(STATE_DB, { readonly: true });
  
  // Get counts
  const stateChunks = stateDb.prepare('SELECT COUNT(*) as count FROM indexed_chunks').get() as { count: number };
  
  // Get sample chunk hashes
  const sampleHashes = stateDb.prepare('SELECT chunk_hash FROM indexed_chunks ORDER BY RANDOM() LIMIT 10').all() as { chunk_hash: string }[];
  
  // Get first and last chunks
  const firstChunk = stateDb.prepare('SELECT chunk_hash, created_at FROM indexed_chunks ORDER BY created_at ASC LIMIT 1').get() as { chunk_hash: string; created_at: number } | undefined;
  const lastChunk = stateDb.prepare('SELECT chunk_hash, created_at FROM indexed_chunks ORDER BY created_at DESC LIMIT 1').get() as { chunk_hash: string; created_at: number } | undefined;
  
  stateDb.close();

  // Get ES stats
  const es = getElasticsearchDB();
  const stats = await es.getStats();
  
  console.log('📊 Count Comparison');
  console.log('─'.repeat(40));
  console.log(`  State DB chunks:     ${stateChunks.count.toLocaleString()}`);
  console.log(`  ES documents:        ${stats?.documentCount.toLocaleString()}`);
  console.log(`  Match:               ${stateChunks.count === stats?.documentCount ? '✅ YES' : '❌ NO'}`);
  console.log('');

  // Spot check random documents
  console.log('🔍 Spot Check: 10 Random Chunks');
  console.log('─'.repeat(40));
  
  let foundCount = 0;
  for (const { chunk_hash } of sampleHashes) {
    const exists = await es.documentExists(chunk_hash);
    if (exists) foundCount++;
    const shortHash = chunk_hash.slice(0, 24);
    console.log(`  ${shortHash}...  ${exists ? '✅' : '❌'}`);
  }
  console.log(`  Result: ${foundCount}/10 found in ES`);
  console.log('');

  // Check first and last chunks exist
  console.log('🔖 Boundary Check (First & Last)');
  console.log('─'.repeat(40));
  
  if (firstChunk) {
    const firstExists = await es.documentExists(firstChunk.chunk_hash);
    const firstDate = new Date(firstChunk.created_at * 1000).toISOString();
    console.log(`  First: ${firstChunk.chunk_hash.slice(0, 24)}...  ${firstExists ? '✅' : '❌'}  (${firstDate})`);
  }
  
  if (lastChunk) {
    const lastExists = await es.documentExists(lastChunk.chunk_hash);
    const lastDate = new Date(lastChunk.created_at * 1000).toISOString();
    console.log(`  Last:  ${lastChunk.chunk_hash.slice(0, 24)}...  ${lastExists ? '✅' : '❌'}  (${lastDate})`);
  }
  console.log('');

  // Get a sample document content to verify data integrity
  console.log('📄 Sample Document Content');
  console.log('─'.repeat(40));
  
  if (sampleHashes[0]) {
    const doc = await es.getDocument(sampleHashes[0].chunk_hash);
    if (doc) {
      console.log(`  Chunk ID:       ${doc.chunk_id?.slice(0, 24)}...`);
      console.log(`  Text preview:   "${doc.text?.slice(0, 60)}..."`);
      console.log(`  Sender:         ${doc.sender}`);
      console.log(`  Chat:           ${doc.chat_name || doc.chat_id?.slice(0, 24)}`);
      console.log(`  Is DM:          ${doc.is_dm}`);
      console.log(`  Timestamp:      ${doc.timestamp}`);
      console.log(`  Has embedding:  ${doc.text_embedding ? 'YES (excluded from query)' : 'NO'}`);
    } else {
      console.log('  Could not fetch sample document');
    }
  }
  console.log('');

  // Summary
  const allGood = stateChunks.count === stats?.documentCount && foundCount === 10;
  console.log('─'.repeat(40));
  console.log(allGood ? '✅ Everything looks 1:1' : '⚠️  Some discrepancies found');
}

deepVerify().catch(console.error);

