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
  text: string | null;
  attributedBody: Buffer | null;
  date: number;
  is_from_me: number;
  handle_id: string | null;
  chat_identifier: string | null;
  group_name: string | null;
  service: string | null;
}

/**
 * Extract plain text from attributedBody blob
 * attributedBody is an archived NSAttributedString (bplist format)
 * Starting in macOS ~2024, many messages store text here instead of the 'text' column
 * 
 * Binary format: ... NSString ... 0x01 0x2B <length> <text> ...
 */
function extractTextFromAttributedBody(body: Buffer | null): string | null {
  if (!body || body.length < 10) return null;
  
  try {
    // Find "NSString" marker in the blob
    const nsStringMarker = Buffer.from('NSString');
    let markerIndex = body.indexOf(nsStringMarker);
    if (markerIndex === -1) return null;
    
    // Search for the pattern 0x01 0x2B (ASCII: \x01+) followed by length byte
    const searchStart = markerIndex + nsStringMarker.length;
    const searchBuf = body.slice(searchStart);
    
    for (let i = 0; i < Math.min(100, searchBuf.length - 3); i++) {
      // Look for 0x01 0x2B pattern (the text marker)
      if (searchBuf[i] === 0x01 && searchBuf[i + 1] === 0x2B) {
        // Next byte(s) indicate length - can be 1 or 2 bytes depending on size
        let textLength: number;
        let textStart: number;
        
        const lengthByte = searchBuf[i + 2];
        
        // If length byte is small, it's a direct length
        // If it's a special marker (like 0x49 = 'I'), length is encoded differently
        if (lengthByte < 0x80) {
          // Simple case: single byte length
          textLength = lengthByte;
          textStart = i + 3;
        } else {
          // Complex encoding - try to extract anyway
          textLength = lengthByte & 0x7F;
          textStart = i + 3;
        }
        
        // Sanity check
        if (textLength > 0 && textLength < 50000 && textStart + textLength <= searchBuf.length) {
          let text = searchBuf.slice(textStart, textStart + textLength).toString('utf-8');
          
          // Clean up any leading length/control characters that leaked through
          // Sometimes there's a leading byte that's part of the encoding
          text = text.replace(/^[\x00-\x1F\x7F-\x9F]+/, '');
          
          // Remove single leading character if it looks like a length indicator
          // (digit or special char followed by actual text)
          if (text.length > 1 && /^[0-9A-Z]/.test(text[0]) && /^[a-zA-Z\s]/.test(text[1])) {
            // Check if first char is likely a length indicator vs. real text
            // "Hey" starts with "H" which is fine, but "1Hey" -> "Hey"
            if (/^\d/.test(text[0])) {
              text = text.slice(1);
            }
          }
          
          text = text.trim();
          
          if (text.length > 0) {
            return text;
          }
        }
      }
    }
    
    // Fallback: try to extract readable text if pattern matching failed
    const decoded = body.toString('utf-8');
    const nsStringIndex = decoded.indexOf('NSString');
    if (nsStringIndex === -1) return null;
    
    const afterMarker = decoded.slice(nsStringIndex + 8);
    let text = '';
    let started = false;
    
    for (let i = 0; i < afterMarker.length && i < 10000; i++) {
      const code = afterMarker.charCodeAt(i);
      
      if (code >= 32 && code < 127) {
        started = true;
        text += afterMarker[i];
      } else if (started && text.length > 2) {
        break;
      }
    }
    
    text = text.trim();
    text = text.replace(/^[+\d]{1,3}(?=[A-Za-z])/, '');
    text = text.replace(/iI.*$/, '').trim();
    
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
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
   * Counts messages that have either text OR attributedBody content
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
      WHERE (text IS NOT NULL AND text != '')
         OR (attributedBody IS NOT NULL AND length(attributedBody) > 10)
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
   * 
   * Reads from both 'text' column and 'attributedBody' blob.
   * Starting in macOS ~2024, many messages store text in attributedBody instead of text column.
   */
  readMessages(sinceRowid: number = 0, limit?: number): RawMessage[] {
    if (!this.db && !this.open()) return [];
    
    const query = `
      SELECT 
        m.ROWID,
        m.text,
        m.attributedBody,
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
      WHERE ((m.text IS NOT NULL AND m.text != '')
         OR (m.attributedBody IS NOT NULL AND length(m.attributedBody) > 10))
        AND m.ROWID > ?
      ORDER BY m.ROWID ASC
      ${limit ? `LIMIT ${limit}` : ''}
    `;
    
    const rows = this.db!.prepare(query).all(sinceRowid) as MessageRow[];
    
    return rows
      .map(row => {
        // Use text field if available, otherwise extract from attributedBody
        let text = row.text;
        if (!text || text.trim() === '') {
          text = extractTextFromAttributedBody(row.attributedBody);
        }
        
        // Skip if we couldn't extract any text
        if (!text || text.trim() === '') return null;
        
        return {
          rowid: row.ROWID,
          text,
          date: macToUnix(row.date),
          isFromMe: row.is_from_me === 1,
          handleId: row.handle_id,
          chatIdentifier: row.chat_identifier || 'unknown',
          groupName: row.group_name,
          service: row.service || 'iMessage',
        };
      })
      .filter((msg): msg is RawMessage => msg !== null);
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
        m.attributedBody,
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
      WHERE ((m.text IS NOT NULL AND m.text != '')
         OR (m.attributedBody IS NOT NULL AND length(m.attributedBody) > 10))
        AND c.chat_identifier = ?
      ORDER BY m.date DESC
      LIMIT ?
    `;
    
    const rows = this.db!.prepare(query).all(chatIdentifier, limit) as MessageRow[];
    
    return rows
      .map(row => {
        // Use text field if available, otherwise extract from attributedBody
        let text = row.text;
        if (!text || text.trim() === '') {
          text = extractTextFromAttributedBody(row.attributedBody);
        }
        
        // Skip if we couldn't extract any text
        if (!text || text.trim() === '') return null;
        
        return {
          rowid: row.ROWID,
          text,
          date: macToUnix(row.date),
          isFromMe: row.is_from_me === 1,
          handleId: row.handle_id,
          chatIdentifier: row.chat_identifier || 'unknown',
          groupName: row.group_name,
          service: row.service || 'iMessage',
        };
      })
      .filter((msg): msg is RawMessage => msg !== null);
  }
  
  /**
   * Get count of messages since a specific rowid
   * Counts messages with either text OR attributedBody content
   */
  getNewMessageCount(sinceRowid: number): number {
    if (!this.db && !this.open()) return 0;
    
    const result = this.db!.prepare(`
      SELECT COUNT(*) as count FROM message
      WHERE ((text IS NOT NULL AND text != '')
         OR (attributedBody IS NOT NULL AND length(attributedBody) > 10))
        AND ROWID > ?
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

