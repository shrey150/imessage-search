/**
 * Find and explore contacts databases
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { existsSync, readdirSync } from 'fs';

const POTENTIAL_PATHS = [
  `${homedir()}/Library/Contacts/accounts.accountdb`,
  `${homedir()}/Library/Application Support/AddressBook/AddressBook-v22.abcddb`,
  `${homedir()}/Library/Application Support/AddressBook/Sources`,
];

console.log('=== Finding Contacts Databases ===\n');

// Check each path
for (const path of POTENTIAL_PATHS) {
  console.log(`\n--- Checking: ${path} ---`);
  if (existsSync(path)) {
    console.log('✓ EXISTS');
    
    // If it's a file, try to open it as SQLite
    if (path.endsWith('.db') || path.endsWith('.abcddb') || path.endsWith('.accountdb')) {
      try {
        const db = Database(path, { readonly: true });
        const tables = db.prepare(`
          SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
        `).all() as { name: string }[];
        console.log(`Tables: ${tables.map(t => t.name).join(', ')}`);
        
        // Look for contact-like tables
        for (const table of tables) {
          if (table.name.toLowerCase().includes('contact') || 
              table.name.toLowerCase().includes('phone') ||
              table.name.toLowerCase().includes('person') ||
              table.name.toLowerCase().includes('record')) {
            const count = db.prepare(`SELECT COUNT(*) as c FROM "${table.name}"`).get() as { c: number };
            console.log(`  ${table.name}: ${count.c} rows`);
          }
        }
        db.close();
      } catch (e) {
        console.log(`Error opening: ${e}`);
      }
    }
  } else {
    console.log('✗ NOT FOUND');
  }
}

// Check for Sources subdirectory
const sourcesPath = `${homedir()}/Library/Application Support/AddressBook/Sources`;
if (existsSync(sourcesPath)) {
  console.log('\n--- AddressBook Sources ---');
  try {
    const sources = readdirSync(sourcesPath);
    for (const source of sources) {
      const dbPath = `${sourcesPath}/${source}/AddressBook-v22.abcddb`;
      if (existsSync(dbPath)) {
        console.log(`\nFound: ${dbPath}`);
        try {
          const db = Database(dbPath, { readonly: true });
          const phoneCount = db.prepare('SELECT COUNT(*) as c FROM ZABCDPHONENUMBER').get() as { c: number };
          const recordCount = db.prepare('SELECT COUNT(*) as c FROM ZABCDRECORD').get() as { c: number };
          console.log(`  ZABCDRECORD: ${recordCount.c}, ZABCDPHONENUMBER: ${phoneCount.c}`);
          
          // Get a sample
          if (phoneCount.c > 0) {
            const sample = db.prepare(`
              SELECT p.ZFULLNUMBER, r.ZFIRSTNAME, r.ZLASTNAME
              FROM ZABCDPHONENUMBER p
              JOIN ZABCDRECORD r ON p.ZOWNER = r.Z_PK
              LIMIT 3
            `).all();
            console.log('  Sample:', JSON.stringify(sample));
          }
          db.close();
        } catch (e) {
          console.log(`  Error: ${e}`);
        }
      }
    }
  } catch (e) {
    console.log(`Error reading sources: ${e}`);
  }
}

// Also check the Contacts directory
const contactsPath = `${homedir()}/Library/Contacts`;
if (existsSync(contactsPath)) {
  console.log('\n--- ~/Library/Contacts ---');
  try {
    const files = readdirSync(contactsPath);
    console.log(`Files: ${files.join(', ')}`);
    
    // Check accounts.accountdb
    const accountsDb = `${contactsPath}/accounts.accountdb`;
    if (existsSync(accountsDb)) {
      const db = Database(accountsDb, { readonly: true });
      const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[];
      console.log(`\naccounts.accountdb tables: ${tables.map(t => t.name).join(', ')}`);
      db.close();
    }
  } catch (e) {
    console.log(`Error: ${e}`);
  }
}

