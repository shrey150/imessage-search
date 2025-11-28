/**
 * Test script to verify messages and contacts readers work
 * Run with: pnpm tsx src/scripts/test-readers.ts
 */

import { MessageReader } from '../indexer/messages.js';
import { ContactResolver } from '../indexer/contacts.js';
import { formatDate, formatTime, formatRelative } from '../utils/timestamp.js';

console.log('=== Testing Message & Contact Readers ===\n');

// Test contacts
console.log('--- Contact Resolution ---');
const contacts = new ContactResolver();
const loaded = contacts.load();
console.log(`Contacts loaded: ${loaded}`);
console.log(`Total contacts: ${contacts.count}`);

// Test messages
console.log('\n--- Message Reader ---');
const messages = new MessageReader();
const opened = messages.open();
console.log(`Database opened: ${opened}`);

if (opened) {
  const stats = messages.getStats();
  if (stats) {
    console.log(`Total messages: ${stats.totalMessages.toLocaleString()}`);
    console.log(`Rowid range: ${stats.minRowid} - ${stats.maxRowid}`);
    console.log(`Date range: ${formatDate(stats.oldestDate)} - ${formatDate(stats.newestDate)}`);
  }
  
  // Get 5 recent messages and try to resolve contacts
  console.log('\n--- Sample Messages (5 most recent with contact resolution) ---');
  const recentMessages = messages.readMessages(stats!.maxRowid - 100, 5);
  
  for (const msg of recentMessages) {
    const sender = msg.isFromMe ? 'Me' : contacts.resolve(msg.handleId || 'Unknown');
    console.log(`\n  [${formatTime(msg.date)}] ${sender}:`);
    console.log(`    "${msg.text.substring(0, 80)}${msg.text.length > 80 ? '...' : ''}"`);
    console.log(`    Chat: ${msg.groupName || msg.chatIdentifier}`);
    console.log(`    ${formatRelative(msg.date)}`);
    if (!msg.isFromMe && msg.handleId) {
      console.log(`    Raw handle: ${msg.handleId} → Resolved: ${contacts.resolve(msg.handleId)}`);
    }
  }
  
  messages.close();
}

console.log('\n=== Test Complete ===');

