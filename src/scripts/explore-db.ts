/**
 * Database exploration script to understand the actual schema
 * Run with: pnpm tsx src/scripts/explore-db.ts
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { existsSync } from 'fs';

const MESSAGES_DB_PATH = `${homedir()}/Library/Messages/chat.db`;
const ADDRESSBOOK_DB_PATH = `${homedir()}/Library/Application Support/AddressBook/AddressBook-v22.abcddb`;

console.log('=== iMessage Database Explorer ===\n');

// Check if databases exist
console.log('Checking database access...');
console.log(`Messages DB: ${existsSync(MESSAGES_DB_PATH) ? '✓ exists' : '✗ not found'}`);
console.log(`AddressBook DB: ${existsSync(ADDRESSBOOK_DB_PATH) ? '✓ exists' : '✗ not found'}`);
console.log('');

// Explore Messages DB
if (existsSync(MESSAGES_DB_PATH)) {
  console.log('=== Messages Database ===\n');
  
  try {
    const db = Database(MESSAGES_DB_PATH, { readonly: true });
    
    // List all tables
    const tables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' 
      ORDER BY name
    `).all() as { name: string }[];
    
    console.log('Tables:', tables.map(t => t.name).join(', '));
    console.log('');
    
    // Get message table schema
    console.log('--- message table schema ---');
    const messageSchema = db.prepare(`PRAGMA table_info(message)`).all();
    console.log(messageSchema.map((col: any) => `  ${col.name}: ${col.type}`).join('\n'));
    console.log('');
    
    // Get handle table schema
    console.log('--- handle table schema ---');
    const handleSchema = db.prepare(`PRAGMA table_info(handle)`).all();
    console.log(handleSchema.map((col: any) => `  ${col.name}: ${col.type}`).join('\n'));
    console.log('');
    
    // Get chat table schema
    console.log('--- chat table schema ---');
    const chatSchema = db.prepare(`PRAGMA table_info(chat)`).all();
    console.log(chatSchema.map((col: any) => `  ${col.name}: ${col.type}`).join('\n'));
    console.log('');
    
    // Count messages
    const messageCount = db.prepare('SELECT COUNT(*) as count FROM message').get() as { count: number };
    console.log(`Total messages: ${messageCount.count.toLocaleString()}`);
    
    // Get sample messages with joins
    console.log('\n--- Sample messages (5 most recent) ---');
    const sampleMessages = db.prepare(`
      SELECT 
        m.rowid,
        m.text,
        m.date,
        m.is_from_me,
        m.service,
        h.id as handle_id,
        c.chat_identifier,
        c.display_name as group_name
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.rowid
      LEFT JOIN chat_message_join cmj ON m.rowid = cmj.message_id
      LEFT JOIN chat c ON cmj.chat_id = c.rowid
      WHERE m.text IS NOT NULL AND m.text != ''
      ORDER BY m.date DESC
      LIMIT 5
    `).all();
    
    for (const msg of sampleMessages as any[]) {
      console.log(`\n  rowid: ${msg.rowid}`);
      console.log(`  text: ${msg.text?.substring(0, 100)}${msg.text?.length > 100 ? '...' : ''}`);
      console.log(`  date (raw): ${msg.date}`);
      console.log(`  is_from_me: ${msg.is_from_me}`);
      console.log(`  handle_id: ${msg.handle_id}`);
      console.log(`  chat_identifier: ${msg.chat_identifier}`);
      console.log(`  group_name: ${msg.group_name || '(none)'}`);
    }
    
    // Check timestamp format
    console.log('\n--- Timestamp analysis ---');
    const timestamps = db.prepare(`
      SELECT date FROM message 
      WHERE date > 0 
      ORDER BY date DESC 
      LIMIT 1
    `).get() as { date: number };
    
    const rawTs = timestamps.date;
    console.log(`Raw timestamp: ${rawTs}`);
    
    // Try both timestamp formats
    const MAC_EPOCH = 978307200;
    const asNanoseconds = Math.floor(rawTs / 1_000_000_000) + MAC_EPOCH;
    const asSeconds = rawTs + MAC_EPOCH;
    
    console.log(`If nanoseconds: ${new Date(asNanoseconds * 1000).toISOString()}`);
    console.log(`If seconds: ${new Date(asSeconds * 1000).toISOString()}`);
    
    // Get min/max rowid for incremental indexing
    const rowIdRange = db.prepare(`
      SELECT MIN(rowid) as min_rowid, MAX(rowid) as max_rowid FROM message
    `).get() as { min_rowid: number; max_rowid: number };
    console.log(`\nRowid range: ${rowIdRange.min_rowid} - ${rowIdRange.max_rowid}`);
    
    db.close();
  } catch (err) {
    console.error('Error reading Messages DB:', err);
    console.log('\n⚠️  You may need to grant Full Disk Access to your terminal.');
    console.log('   Go to System Preferences > Privacy & Security > Full Disk Access');
  }
}

// Explore AddressBook DB
if (existsSync(ADDRESSBOOK_DB_PATH)) {
  console.log('\n=== AddressBook Database ===\n');
  
  try {
    const db = Database(ADDRESSBOOK_DB_PATH, { readonly: true });
    
    // List all tables
    const tables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' 
      ORDER BY name
    `).all() as { name: string }[];
    
    console.log('Tables:', tables.map(t => t.name).join(', '));
    
    // Try to find contact-related tables
    const contactTables = tables.filter(t => 
      t.name.includes('RECORD') || 
      t.name.includes('PHONE') || 
      t.name.includes('EMAIL')
    );
    
    if (contactTables.length > 0) {
      console.log('\nContact-related tables:');
      for (const table of contactTables) {
        const schema = db.prepare(`PRAGMA table_info(${table.name})`).all();
        console.log(`\n--- ${table.name} ---`);
        console.log(schema.map((col: any) => `  ${col.name}: ${col.type}`).join('\n'));
      }
      
      // Try to get a sample contact
      console.log('\n--- Sample contact lookup ---');
      try {
        const sampleContact = db.prepare(`
          SELECT * FROM ZABCDRECORD LIMIT 1
        `).get();
        console.log('Sample record:', JSON.stringify(sampleContact, null, 2));
      } catch (e) {
        console.log('Could not query ZABCDRECORD');
      }
    }
    
    db.close();
  } catch (err) {
    console.error('Error reading AddressBook DB:', err);
  }
}

console.log('\n=== Exploration complete ===');

