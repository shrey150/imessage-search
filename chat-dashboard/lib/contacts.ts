/**
 * Contact resolver for the chat dashboard
 * Reads from macOS AddressBook to resolve phone numbers and emails to names
 * Adapted from src/indexer/contacts.ts
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { existsSync, readdirSync } from 'fs';

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
 * Contact resolver - loads contacts from all AddressBook sources
 */
export class ContactResolver {
  private phoneMap: Map<string, Contact> = new Map();
  private emailMap: Map<string, Contact> = new Map();
  private loaded = false;

  /**
   * Normalize a phone number for consistent lookups
   */
  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');

    // If it starts with 1 and has 11 digits, it's a US number with country code
    if (digits.length === 11 && digits.startsWith('1')) {
      return digits.slice(1);
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
      const db = new Database(dbPath, { readonly: true });

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
        // Table might not exist
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
        // Table might not exist
      }

      db.close();
    } catch {
      // Silently skip databases that can't be opened
    }

    return { phones, emails };
  }

  /**
   * Load contacts from all AddressBook databases
   */
  load(): boolean {
    if (this.loaded) return true;

    let totalPhones = 0;
    let totalEmails = 0;

    // Load from Sources subdirectory
    if (existsSync(SOURCES_PATH)) {
      try {
        const sources = readdirSync(SOURCES_PATH);
        for (const source of sources) {
          const dbPath = `${SOURCES_PATH}/${source}/AddressBook-v22.abcddb`;
          if (existsSync(dbPath)) {
            const { phones, emails } = this.loadFromDatabase(dbPath);
            totalPhones += phones;
            totalEmails += emails;
          }
        }
      } catch (err) {
        console.warn(`Error reading contacts Sources directory: ${err}`);
      }
    }

    // Try the main AddressBook database as fallback
    const mainDbPath = `${ADDRESSBOOK_BASE}/AddressBook-v22.abcddb`;
    if (existsSync(mainDbPath)) {
      const { phones, emails } = this.loadFromDatabase(mainDbPath);
      totalPhones += phones;
      totalEmails += emails;
    }

    this.loaded = true;

    if (totalPhones > 0 || totalEmails > 0) {
      console.log(`Loaded ${totalPhones} phone numbers, ${totalEmails} emails from contacts`);
      return true;
    } else {
      console.warn('No contacts found in AddressBook');
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
   * Format a phone number for display
   */
  formatPhoneNumber(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    
    // US format
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    
    // International or other format
    return phone;
  }

  /**
   * Get display name for a handle - friendly name or formatted phone/email
   */
  getDisplayName(handleId: string | null): string {
    if (!handleId) return 'Unknown';
    
    const resolved = this.resolve(handleId);
    
    // If we got a contact name (not the raw handle), return it
    if (resolved !== handleId) {
      return resolved;
    }
    
    // Otherwise, format the raw handle nicely
    if (handleId.includes('@')) {
      return handleId;
    }
    
    return this.formatPhoneNumber(handleId);
  }

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

