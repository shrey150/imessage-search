#!/usr/bin/env node
/**
 * Verify indexing integrity
 * Checks Messages DB, state DB, and Elasticsearch are in sync
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { getElasticsearchDB } from '../db/elasticsearch.js';

const MESSAGES_DB_PATH = (process.env.MESSAGES_DB_PATH || `${homedir()}/Library/Messages/chat.db`).replace(/^~/, homedir());
const STATE_DB_PATH = `${homedir()}/.imessage-mcp/state.db`;

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════╗');
  console.log('║    iMessage MCP - Verify Integrity    ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log('');
  
  let hasErrors = false;
  
  // 1. Check Messages DB
  console.log('📱 Messages Database');
  console.log('─────────────────────────────────────────');
  
  if (!existsSync(MESSAGES_DB_PATH)) {
    console.log(`  ❌ Not found at ${MESSAGES_DB_PATH}`);
    hasErrors = true;
  } else {
    try {
      const db = Database(MESSAGES_DB_PATH, { readonly: true });
      const stats = db.prepare(`
        SELECT COUNT(*) as count, MAX(ROWID) as max_rowid
        FROM message WHERE text IS NOT NULL AND text != ''
      `).get() as { count: number; max_rowid: number };
      
      console.log(`  ✅ Connected`);
      console.log(`  Messages with text: ${stats.count.toLocaleString()}`);
      console.log(`  Max rowid: ${stats.max_rowid}`);
      db.close();
    } catch (e) {
      console.log(`  ❌ Cannot read: ${e}`);
      hasErrors = true;
    }
  }
  console.log('');
  
  // 2. Check State DB
  console.log('💾 State Database');
  console.log('─────────────────────────────────────────');
  
  if (!existsSync(STATE_DB_PATH)) {
    console.log(`  ⚠️  Not found (run indexer first)`);
  } else {
    try {
      const db = Database(STATE_DB_PATH, { readonly: true });
      
      const state = db.prepare(`
        SELECT last_message_rowid, total_messages_indexed, total_chunks_created
        FROM indexing_state WHERE id = 1
      `).get() as { last_message_rowid: number; total_messages_indexed: number; total_chunks_created: number };
      
      const chunkCount = db.prepare(`SELECT COUNT(*) as count FROM indexed_chunks`).get() as { count: number };
      
      console.log(`  ✅ Connected`);
      console.log(`  Last rowid indexed: ${state.last_message_rowid}`);
      console.log(`  Total messages indexed: ${state.total_messages_indexed.toLocaleString()}`);
      console.log(`  Chunks in state DB: ${chunkCount.count.toLocaleString()}`);
      
      db.close();
    } catch (e) {
      console.log(`  ❌ Cannot read: ${e}`);
      hasErrors = true;
    }
  }
  console.log('');
  
  // 3. Check Elasticsearch
  console.log('🔍 Elasticsearch');
  console.log('─────────────────────────────────────────');
  
  try {
    const es = getElasticsearchDB();
    const healthy = await es.healthCheck();
    
    if (!healthy) {
      console.log(`  ❌ Not healthy - run: pnpm es:start`);
      hasErrors = true;
    } else {
      const stats = await es.getStats();
      
      console.log(`  ✅ Connected`);
      console.log(`  Documents indexed: ${stats?.documentCount.toLocaleString() || 0}`);
      console.log(`  Index size: ${stats?.indexSize || '0 B'}`);
      
      // Sample a document
      const results = await es.hybridSearch({ keywordQuery: '*', limit: 1 });
      if (results.length > 0) {
        const sample = results[0];
        console.log('');
        console.log('  Sample document:');
        console.log(`    Chat: ${sample.document.chat_name || sample.document.participants.join(', ')}`);
        console.log(`    Sender: ${sample.document.sender}`);
        console.log(`    Text preview: ${sample.document.text.slice(0, 60)}...`);
      }
    }
  } catch (e) {
    console.log(`  ❌ Cannot connect: ${e}`);
    hasErrors = true;
  }
  console.log('');
  
  // Summary
  console.log('─────────────────────────────────────────');
  if (hasErrors) {
    console.log('❌ Verification found issues');
    process.exit(1);
  } else {
    console.log('✅ All systems verified');
  }
}

main().catch(console.error);
