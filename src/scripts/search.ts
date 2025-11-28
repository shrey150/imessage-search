#!/usr/bin/env node
/**
 * CLI script for searching messages
 * Usage: pnpm search "your query here"
 */

import 'dotenv/config';
import { semanticSearch } from '../tools/semantic-search.js';

async function main() {
  const query = process.argv.slice(2).join(' ');
  
  if (!query) {
    console.log('Usage: pnpm query "your query here"');
    console.log('');
    console.log('Examples:');
    console.log('  pnpm query "dinner plans"');
    console.log('  pnpm query "what did we talk about last week"');
    process.exit(1);
  }
  
  console.log('');
  console.log(`🔍 Searching for: "${query}"`);
  console.log('─'.repeat(50));
  console.log('');
  
  try {
    const results = await semanticSearch({ query, limit: 5 });
    
    if (results.length === 0) {
      console.log('No results found.');
      return;
    }
    
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const header = r.groupName 
        ? `${r.groupName}` 
        : r.participants.filter(p => p !== 'Me').join(', ') || 'Unknown';
      
      console.log(`┌─ Result ${i + 1} ─────────────────────────────────────`);
      console.log(`│ 📱 ${header}`);
      console.log(`│ 🕐 ${r.startTime} (${r.relativeTime})`);
      console.log(`│ 📊 Score: ${r.score}`);
      console.log('│');
      
      // Format the message text with proper indentation
      const lines = r.text.split('\n');
      for (const line of lines) {
        console.log(`│  ${line}`);
      }
      
      console.log('└' + '─'.repeat(48));
      console.log('');
    }
    
  } catch (err) {
    console.error('Error:', (err as Error).message);
    process.exit(1);
  }
}

main();

