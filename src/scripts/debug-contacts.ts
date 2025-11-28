/**
 * Debug contacts database
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { existsSync } from 'fs';

const ADDRESSBOOK_DB_PATH = `${homedir()}/Library/Application Support/AddressBook/AddressBook-v22.abcddb`;

console.log('=== Debugging Contacts Database ===\n');
console.log(`Path: ${ADDRESSBOOK_DB_PATH}`);
console.log(`Exists: ${existsSync(ADDRESSBOOK_DB_PATH)}`);

if (existsSync(ADDRESSBOOK_DB_PATH)) {
  const db = Database(ADDRESSBOOK_DB_PATH, { readonly: true });
  
  // Count records in each table
  console.log('\n--- Table Counts ---');
  const recordCount = db.prepare('SELECT COUNT(*) as c FROM ZABCDRECORD').get() as { c: number };
  const phoneCount = db.prepare('SELECT COUNT(*) as c FROM ZABCDPHONENUMBER').get() as { c: number };
  const emailCount = db.prepare('SELECT COUNT(*) as c FROM ZABCDEMAILADDRESS').get() as { c: number };
  
  console.log(`ZABCDRECORD: ${recordCount.c}`);
  console.log(`ZABCDPHONENUMBER: ${phoneCount.c}`);
  console.log(`ZABCDEMAILADDRESS: ${emailCount.c}`);
  
  // Sample phone numbers
  console.log('\n--- Sample Phone Numbers ---');
  const phones = db.prepare(`
    SELECT p.*, r.ZFIRSTNAME, r.ZLASTNAME 
    FROM ZABCDPHONENUMBER p
    LEFT JOIN ZABCDRECORD r ON p.ZOWNER = r.Z_PK
    LIMIT 5
  `).all();
  console.log(JSON.stringify(phones, null, 2));
  
  // Check what ZOWNER values look like
  console.log('\n--- ZOWNER values in ZABCDPHONENUMBER ---');
  const owners = db.prepare(`
    SELECT DISTINCT ZOWNER FROM ZABCDPHONENUMBER LIMIT 10
  `).all();
  console.log(owners);
  
  // Check what Z_PK values look like in ZABCDRECORD
  console.log('\n--- Z_PK values in ZABCDRECORD ---');
  const pks = db.prepare(`
    SELECT Z_PK, ZFIRSTNAME, ZLASTNAME FROM ZABCDRECORD LIMIT 10
  `).all();
  console.log(pks);
  
  db.close();
}

