/**
 * iMessage database reader
 * Reads messages from ~/Library/Messages/chat.db
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { macToUnix } from '../utils/timestamp.js';
import { log } from '../utils/progress.js';

// Default path to Messages database
const DEFAULT_MESSAGES_PATH = `${homedir()}/Library/Messages/chat.db`;

export interface RawMessage {
  rowid: number;
  text: string;
  date: number;           // Unix timestamp (converted from Mac timestamp)
  isFromMe: boolean;
  handleId: string | null; // Phone number or email
  chatIdentifier: string;
  groupName: string | null;
  service: string;
}

interface MessageRow {
  ROWID: number;
  text: string;
  date: number;
  is_from_me: number;
  handle_id: string | null;
  chat_identifier: string | null;
  group_name: string | null;
  service: string | null;
}

export interface MessageStats {
  totalMessages: number;
  minRowid: number;
  maxRowid: number;
  oldestDate: number;
  newestDate: number;
}

/**
 * Message database reader
 */
export class MessageReader {
  private db: Database.Database | null = null;
  
  constructor(private dbPath: string = DEFAULT_MESSAGES_PATH) {}
  
  /**
   * Open the database connection
   */
  open(): boolean {
    if (this.db) return true;
    
    if (!existsSync(this.dbPath)) {
      log('Messages', `Database not found at ${this.dbPath}`, 'error');
      return false;
    }
    
    try {
      this.db = Database(this.dbPath, { readonly: true });
      log('Messages', `Opened database at ${this.dbPath}`, 'success');
      return true;
    } catch (err) {
      log('Messages', `Failed to open database: ${err}`, 'error');
      return false;
    }
  }
  
  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
  
  /**
   * Get database statistics
   */
  getStats(): MessageStats | null {
    if (!this.db && !this.open()) return null;
    
    const stats = this.db!.prepare(`
      SELECT 
        COUNT(*) as total,
        MIN(ROWID) as min_rowid,
        MAX(ROWID) as max_rowid,
        MIN(date) as min_date,
        MAX(date) as max_date
      FROM message
      WHERE text IS NOT NULL AND text != ''
    `).get() as {
      total: number;
      min_rowid: number;
      max_rowid: number;
      min_date: number;
      max_date: number;
    };
    
    return {
      totalMessages: stats.total,
      minRowid: stats.min_rowid,
      maxRowid: stats.max_rowid,
      oldestDate: macToUnix(stats.min_date),
      newestDate: macToUnix(stats.max_date),
    };
  }
  
  /**
   * Read messages from the database
   * @param sinceRowid Only return messages with rowid > sinceRowid (for incremental indexing)
   * @param limit Maximum number of messages to return (for batching)
   */
  readMessages(sinceRowid: number = 0, limit?: number): RawMessage[] {
    if (!this.db && !this.open()) return [];
    
    const query = `
      SELECT 
        m.ROWID,
        m.text,
        m.date,
        m.is_from_me,
        m.service,
        h.id as handle_id,
        c.chat_identifier,
        c.display_name as group_name
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE m.text IS NOT NULL 
        AND m.text != ''
        AND m.ROWID > ?
      ORDER BY m.ROWID ASC
      ${limit ? `LIMIT ${limit}` : ''}
    `;
    
    const rows = this.db!.prepare(query).all(sinceRowid) as MessageRow[];
    
    return rows.map(row => ({
      rowid: row.ROWID,
      text: row.text,
      date: macToUnix(row.date),
      isFromMe: row.is_from_me === 1,
      handleId: row.handle_id,
      chatIdentifier: row.chat_identifier || 'unknown',
      groupName: row.group_name,
      service: row.service || 'iMessage',
    }));
  }
  
  /**
   * Get messages for a specific chat
   */
  getMessagesForChat(chatIdentifier: string, limit: number = 100): RawMessage[] {
    if (!this.db && !this.open()) return [];
    
    const query = `
      SELECT 
        m.ROWID,
        m.text,
        m.date,
        m.is_from_me,
        m.service,
        h.id as handle_id,
        c.chat_identifier,
        c.display_name as group_name
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE m.text IS NOT NULL 
        AND m.text != ''
        AND c.chat_identifier = ?
      ORDER BY m.date DESC
      LIMIT ?
    `;
    
    const rows = this.db!.prepare(query).all(chatIdentifier, limit) as MessageRow[];
    
    return rows.map(row => ({
      rowid: row.ROWID,
      text: row.text,
      date: macToUnix(row.date),
      isFromMe: row.is_from_me === 1,
      handleId: row.handle_id,
      chatIdentifier: row.chat_identifier || 'unknown',
      groupName: row.group_name,
      service: row.service || 'iMessage',
    }));
  }
  
  /**
   * Get count of messages since a specific rowid
   */
  getNewMessageCount(sinceRowid: number): number {
    if (!this.db && !this.open()) return 0;
    
    const result = this.db!.prepare(`
      SELECT COUNT(*) as count FROM message
      WHERE text IS NOT NULL AND text != '' AND ROWID > ?
    `).get(sinceRowid) as { count: number };
    
    return result.count;
  }
  
  /**
   * Get unique participants in a chat
   */
  getChatParticipants(chatIdentifier: string): string[] {
    if (!this.db && !this.open()) return [];
    
    const rows = this.db!.prepare(`
      SELECT DISTINCT h.id as handle_id
      FROM message m
      JOIN handle h ON m.handle_id = h.ROWID
      JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE c.chat_identifier = ?
        AND h.id IS NOT NULL
    `).all(chatIdentifier) as { handle_id: string }[];
    
    return rows.map(r => r.handle_id);
  }
}

// Singleton instance
let readerInstance: MessageReader | null = null;

export function getMessageReader(dbPath?: string): MessageReader {
  if (!readerInstance) {
    readerInstance = new MessageReader(dbPath);
  }
  return readerInstance;
}

