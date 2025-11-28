#!/usr/bin/env node
/**
 * Debug script to find the indexer bug
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import { homedir } from 'os';

const MESSAGES_DB = `${homedir()}/Library/Messages/chat.db`;

console.log('🔍 Debugging Indexer Logic\n');

const db = Database(MESSAGES_DB, { readonly: true });

// Test 1: Check if rowids are sequential or have gaps
console.log('Test 1: Rowid distribution');
console.log('─'.repeat(50));

const rowidStats = db.prepare(`
  SELECT 
    MIN(ROWID) as min_rowid,
    MAX(ROWID) as max_rowid,
    COUNT(*) as count
  FROM message 
  WHERE text IS NOT NULL AND text != ''
`).get() as { min_rowid: number; max_rowid: number; count: number };

console.log(`  Min rowid: ${rowidStats.min_rowid}`);
console.log(`  Max rowid: ${rowidStats.max_rowid}`);
console.log(`  Count: ${rowidStats.count}`);
console.log(`  Expected if sequential: ${rowidStats.max_rowid - rowidStats.min_rowid + 1}`);
console.log(`  Gaps exist: ${rowidStats.count < (rowidStats.max_rowid - rowidStats.min_rowid + 1) ? 'YES' : 'NO'}`);

// Test 2: Check ordering - are rowids and dates correlated?
console.log('\nTest 2: Rowid vs Date ordering');
console.log('─'.repeat(50));

// Get first batch ordered by date
const firstBatchByDate = db.prepare(`
  SELECT ROWID, date FROM message 
  WHERE text IS NOT NULL AND text != '' AND ROWID > 0
  ORDER BY date ASC
  LIMIT 10000
`).all() as { ROWID: number; date: number }[];

const minRowidInBatch = Math.min(...firstBatchByDate.map(r => r.ROWID));
const maxRowidInBatch = Math.max(...firstBatchByDate.map(r => r.ROWID));
const lastRowidByDate = firstBatchByDate[firstBatchByDate.length - 1].ROWID;

console.log(`  First 10K messages (ordered by DATE):`);
console.log(`    Min rowid in batch: ${minRowidInBatch}`);
console.log(`    Max rowid in batch: ${maxRowidInBatch}`);
console.log(`    Last rowid (by date): ${lastRowidByDate}`);
console.log(`    Rowid range span: ${maxRowidInBatch - minRowidInBatch}`);

// This is the BUG: if we use lastRowidByDate as the cutoff, we skip everything with ROWID < lastRowidByDate
const messagesSkipped = db.prepare(`
  SELECT COUNT(*) as count FROM message 
  WHERE text IS NOT NULL AND text != '' 
    AND ROWID > 10000 AND ROWID <= ?
`).get(lastRowidByDate) as { count: number };

console.log(`\n  ⚠️  BUG ANALYSIS:`);
console.log(`    If we set lastRowid = ${lastRowidByDate} after first batch...`);
console.log(`    Messages that would be SKIPPED: ${messagesSkipped.count.toLocaleString()}`);

// Test 3: Compare ordering by ROWID vs DATE
console.log('\nTest 3: Compare ROWID order vs DATE order');
console.log('─'.repeat(50));

const firstBatchByRowid = db.prepare(`
  SELECT ROWID, date FROM message 
  WHERE text IS NOT NULL AND text != '' AND ROWID > 0
  ORDER BY ROWID ASC
  LIMIT 10000
`).all() as { ROWID: number; date: number }[];

const lastRowidByRowid = firstBatchByRowid[firstBatchByRowid.length - 1].ROWID;

console.log(`  First 10K messages (ordered by ROWID):`);
console.log(`    Last rowid: ${lastRowidByRowid}`);
console.log(`    This would correctly get next batch starting at ${lastRowidByRowid + 1}`);

// Conclusion
console.log('\n📋 CONCLUSION');
console.log('─'.repeat(50));
console.log(`  The bug is in messages.ts SQL query.`);
console.log(`  Currently: ORDER BY m.date ASC`);
console.log(`  Should be: ORDER BY m.ROWID ASC`);
console.log(`  `);
console.log(`  When ordered by date, the last message in a batch can have a`);
console.log(`  rowid much higher than most messages, causing the next batch`);
console.log(`  to skip all messages with lower rowids.`);

db.close();

