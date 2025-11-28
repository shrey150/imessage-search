/**
 * AddressBook database reader
 * Resolves phone numbers and email addresses to contact names
 * 
 * On macOS, contacts are stored in multiple "Sources" subdirectories,
 * each representing a different account (iCloud, Gmail, etc.)
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { existsSync, readdirSync } from 'fs';
import { log } from '../utils/progress.js';

// Paths to check for contacts
const ADDRESSBOOK_BASE = `${homedir()}/Library/Application Support/AddressBook`;
const SOURCES_PATH = `${ADDRESSBOOK_BASE}/Sources`;

export interface Contact {
  firstName: string | null;
  lastName: string | null;
  fullName: string;
}

interface PhoneRow {
  ZFULLNUMBER: string;
  ZFIRSTNAME: string | null;
  ZLASTNAME: string | null;
}

interface EmailRow {
  ZADDRESS: string;
  ZFIRSTNAME: string | null;
  ZLASTNAME: string | null;
}

/**
 * Contact resolver - loads contacts from all AddressBook sources and provides lookup by phone/email
 */
export class ContactResolver {
  private phoneMap: Map<string, Contact> = new Map();
  private emailMap: Map<string, Contact> = new Map();
  private loaded = false;
  
  /**
   * Normalize a phone number for consistent lookups
   * Removes all non-digit characters and handles country codes
   */
  private normalizePhone(phone: string): string {
    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '');
    
    // If it starts with 1 and has 11 digits, it's a US number with country code
    if (digits.length === 11 && digits.startsWith('1')) {
      return digits.slice(1); // Remove the leading 1
    }
    
    // Return last 10 digits for US numbers, or full number for international
    return digits.length >= 10 ? digits.slice(-10) : digits;
  }
  
  /**
   * Normalize an email for consistent lookups
   */
  private normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }
  
  /**
   * Build a full name from first and last name parts
   */
  private buildFullName(firstName: string | null, lastName: string | null): string {
    const parts = [firstName, lastName].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : 'Unknown';
  }
  
  /**
   * Load contacts from a single AddressBook database
   */
  private loadFromDatabase(dbPath: string): { phones: number; emails: number } {
    let phones = 0;
    let emails = 0;
    
    try {
      const db = Database(dbPath, { readonly: true });
      
      // Load phone numbers with contact names
      try {
        const phoneQuery = db.prepare(`
          SELECT 
            p.ZFULLNUMBER,
            r.ZFIRSTNAME,
            r.ZLASTNAME
          FROM ZABCDPHONENUMBER p
          JOIN ZABCDRECORD r ON p.ZOWNER = r.Z_PK
          WHERE p.ZFULLNUMBER IS NOT NULL
        `);
        
        const phoneRows = phoneQuery.all() as PhoneRow[];
        for (const row of phoneRows) {
          if (row.ZFULLNUMBER) {
            const normalized = this.normalizePhone(row.ZFULLNUMBER);
            // Don't overwrite if already exists (first source wins)
            if (!this.phoneMap.has(normalized)) {
              this.phoneMap.set(normalized, {
                firstName: row.ZFIRSTNAME,
                lastName: row.ZLASTNAME,
                fullName: this.buildFullName(row.ZFIRSTNAME, row.ZLASTNAME),
              });
              phones++;
            }
          }
        }
      } catch {
        // Table might not exist in this database
      }
      
      // Load email addresses with contact names
      try {
        const emailQuery = db.prepare(`
          SELECT 
            e.ZADDRESS,
            r.ZFIRSTNAME,
            r.ZLASTNAME
          FROM ZABCDEMAILADDRESS e
          JOIN ZABCDRECORD r ON e.ZOWNER = r.Z_PK
          WHERE e.ZADDRESS IS NOT NULL
        `);
        
        const emailRows = emailQuery.all() as EmailRow[];
        for (const row of emailRows) {
          if (row.ZADDRESS) {
            const normalized = this.normalizeEmail(row.ZADDRESS);
            if (!this.emailMap.has(normalized)) {
              this.emailMap.set(normalized, {
                firstName: row.ZFIRSTNAME,
                lastName: row.ZLASTNAME,
                fullName: this.buildFullName(row.ZFIRSTNAME, row.ZLASTNAME),
              });
              emails++;
            }
          }
        }
      } catch {
        // Table might not exist in this database
      }
      
      db.close();
    } catch (err) {
      // Silently skip databases that can't be opened
    }
    
    return { phones, emails };
  }
  
  /**
   * Load contacts from all AddressBook databases (all account sources)
   */
  load(): boolean {
    if (this.loaded) return true;
    
    let totalPhones = 0;
    let totalEmails = 0;
    let sourcesLoaded = 0;
    
    // First, try to load from the Sources subdirectory (where actual contacts live)
    if (existsSync(SOURCES_PATH)) {
      try {
        const sources = readdirSync(SOURCES_PATH);
        for (const source of sources) {
          const dbPath = `${SOURCES_PATH}/${source}/AddressBook-v22.abcddb`;
          if (existsSync(dbPath)) {
            const { phones, emails } = this.loadFromDatabase(dbPath);
            totalPhones += phones;
            totalEmails += emails;
            if (phones > 0 || emails > 0) {
              sourcesLoaded++;
            }
          }
        }
      } catch (err) {
        log('Contacts', `Error reading Sources directory: ${err}`, 'warn');
      }
    }
    
    // Also try the main AddressBook database as fallback
    const mainDbPath = `${ADDRESSBOOK_BASE}/AddressBook-v22.abcddb`;
    if (existsSync(mainDbPath)) {
      const { phones, emails } = this.loadFromDatabase(mainDbPath);
      totalPhones += phones;
      totalEmails += emails;
    }
    
    this.loaded = true;
    
    if (totalPhones > 0 || totalEmails > 0) {
      log('Contacts', `Loaded ${totalPhones} phone numbers, ${totalEmails} emails from ${sourcesLoaded} sources`, 'success');
      return true;
    } else {
      log('Contacts', 'No contacts found in AddressBook', 'warn');
      return false;
    }
  }
  
  /**
   * Resolve a handle ID (phone number or email) to a contact name
   * Returns the handle ID itself if no contact is found
   */
  resolve(handleId: string): string {
    if (!this.loaded) {
      this.load();
    }
    
    // Check if it looks like an email
    if (handleId.includes('@')) {
      const contact = this.emailMap.get(this.normalizeEmail(handleId));
      return contact?.fullName ?? handleId;
    }
    
    // Otherwise treat as phone number
    const contact = this.phoneMap.get(this.normalizePhone(handleId));
    return contact?.fullName ?? handleId;
  }
  
  /**
   * Get contact details for a handle ID
   */
  getContact(handleId: string): Contact | null {
    if (!this.loaded) {
      this.load();
    }
    
    if (handleId.includes('@')) {
      return this.emailMap.get(this.normalizeEmail(handleId)) ?? null;
    }
    
    return this.phoneMap.get(this.normalizePhone(handleId)) ?? null;
  }
  
  /**
   * Get all loaded contacts count
   */
  get count(): number {
    return this.phoneMap.size + this.emailMap.size;
  }
}

// Singleton instance
let resolverInstance: ContactResolver | null = null;

export function getContactResolver(): ContactResolver {
  if (!resolverInstance) {
    resolverInstance = new ContactResolver();
  }
  return resolverInstance;
}
