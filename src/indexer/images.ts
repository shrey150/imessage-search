/**
 * iMessage image/attachment extraction
 * Reads attachments from ~/Library/Messages/chat.db and links them to messages
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { log } from '../utils/progress.js';

// Default path to Messages database
const DEFAULT_MESSAGES_PATH = `${homedir()}/Library/Messages/chat.db`;

// Image MIME types we care about
const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/tiff',
  'image/bmp',
];

export interface ImageAttachment {
  rowid: number;
  guid: string;
  filename: string;           // Full path to the file
  mimeType: string;
  messageRowid: number;
  chatIdentifier: string | null;
  createdAt: number;          // Unix timestamp
  transferName: string | null; // Original filename
  totalBytes: number;
}

export interface ImageStats {
  totalAttachments: number;
  imageAttachments: number;
  minRowid: number;
  maxRowid: number;
}

interface AttachmentRow {
  ROWID: number;
  guid: string;
  filename: string | null;
  mime_type: string | null;
  message_rowid: number;
  chat_identifier: string | null;
  created_date: number;
  transfer_name: string | null;
  total_bytes: number;
}

/**
 * Converts macOS attachment path to full filesystem path
 * Attachments use paths like ~/Library/Messages/Attachments/...
 */
function resolveAttachmentPath(path: string | null): string | null {
  if (!path) return null;
  
  // Replace ~ with actual home directory
  if (path.startsWith('~')) {
    return path.replace('~', homedir());
  }
  
  return path;
}

/**
 * Convert Mac absolute time (seconds since 2001-01-01) to Unix timestamp
 */
function macToUnix(macTime: number): number {
  // Mac epoch is January 1, 2001 00:00:00 UTC
  // Unix epoch is January 1, 1970 00:00:00 UTC
  // Difference is 978307200 seconds
  
  // Handle nanosecond timestamps (newer macOS versions)
  if (macTime > 1e12) {
    macTime = macTime / 1e9;
  }
  
  return Math.floor(macTime + 978307200);
}

/**
 * Image attachment reader
 */
export class ImageReader {
  private db: Database.Database | null = null;
  
  constructor(private dbPath: string = DEFAULT_MESSAGES_PATH) {}
  
  /**
   * Open the database connection
   */
  open(): boolean {
    if (this.db) return true;
    
    if (!existsSync(this.dbPath)) {
      log('Images', `Database not found at ${this.dbPath}`, 'error');
      return false;
    }
    
    try {
      this.db = Database(this.dbPath, { readonly: true });
      log('Images', `Opened database at ${this.dbPath}`, 'success');
      return true;
    } catch (err) {
      log('Images', `Failed to open database: ${err}`, 'error');
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
   * Get attachment statistics
   */
  getStats(): ImageStats | null {
    if (!this.db && !this.open()) return null;
    
    try {
      const totalStats = this.db!.prepare(`
        SELECT 
          COUNT(*) as total,
          MIN(ROWID) as min_rowid,
          MAX(ROWID) as max_rowid
        FROM attachment
        WHERE filename IS NOT NULL
      `).get() as {
        total: number;
        min_rowid: number;
        max_rowid: number;
      };
      
      // Count image attachments specifically
      const imageCount = this.db!.prepare(`
        SELECT COUNT(*) as count
        FROM attachment
        WHERE filename IS NOT NULL
          AND (
            mime_type LIKE 'image/%'
            OR filename LIKE '%.jpg'
            OR filename LIKE '%.jpeg'
            OR filename LIKE '%.png'
            OR filename LIKE '%.gif'
            OR filename LIKE '%.heic'
            OR filename LIKE '%.webp'
          )
      `).get() as { count: number };
      
      return {
        totalAttachments: totalStats.total,
        imageAttachments: imageCount.count,
        minRowid: totalStats.min_rowid || 0,
        maxRowid: totalStats.max_rowid || 0,
      };
    } catch (err) {
      log('Images', `Failed to get stats: ${err}`, 'error');
      return null;
    }
  }
  
  /**
   * Read image attachments from the database
   * @param sinceRowid Only return attachments with rowid > sinceRowid (for incremental indexing)
   * @param limit Maximum number of attachments to return (for batching)
   */
  readImages(sinceRowid: number = 0, limit?: number): ImageAttachment[] {
    if (!this.db && !this.open()) return [];
    
    try {
      const query = `
        SELECT 
          a.ROWID,
          a.guid,
          a.filename,
          a.mime_type,
          a.created_date,
          a.transfer_name,
          a.total_bytes,
          maj.message_id as message_rowid,
          c.chat_identifier
        FROM attachment a
        LEFT JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
        LEFT JOIN message m ON maj.message_id = m.ROWID
        LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        LEFT JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE a.filename IS NOT NULL
          AND a.ROWID > ?
          AND (
            a.mime_type LIKE 'image/%'
            OR a.filename LIKE '%.jpg'
            OR a.filename LIKE '%.jpeg'
            OR a.filename LIKE '%.png'
            OR a.filename LIKE '%.gif'
            OR a.filename LIKE '%.heic'
            OR a.filename LIKE '%.heif'
            OR a.filename LIKE '%.webp'
            OR a.filename LIKE '%.tiff'
            OR a.filename LIKE '%.bmp'
          )
        ORDER BY a.ROWID ASC
        ${limit ? `LIMIT ${limit}` : ''}
      `;
      
      const rows = this.db!.prepare(query).all(sinceRowid) as AttachmentRow[];
      
      return rows
        .map(row => {
          const resolvedPath = resolveAttachmentPath(row.filename);
          if (!resolvedPath) return null;
          
          return {
            rowid: row.ROWID,
            guid: row.guid,
            filename: resolvedPath,
            mimeType: row.mime_type || 'image/jpeg',
            messageRowid: row.message_rowid,
            chatIdentifier: row.chat_identifier,
            createdAt: macToUnix(row.created_date),
            transferName: row.transfer_name,
            totalBytes: row.total_bytes,
          };
        })
        .filter((img): img is ImageAttachment => img !== null);
    } catch (err) {
      log('Images', `Failed to read images: ${err}`, 'error');
      return [];
    }
  }
  
  /**
   * Get images for a specific message
   */
  getImagesForMessage(messageRowid: number): ImageAttachment[] {
    if (!this.db && !this.open()) return [];
    
    try {
      const query = `
        SELECT 
          a.ROWID,
          a.guid,
          a.filename,
          a.mime_type,
          a.created_date,
          a.transfer_name,
          a.total_bytes,
          maj.message_id as message_rowid,
          c.chat_identifier
        FROM attachment a
        JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
        JOIN message m ON maj.message_id = m.ROWID
        LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        LEFT JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE maj.message_id = ?
          AND a.filename IS NOT NULL
          AND (
            a.mime_type LIKE 'image/%'
            OR a.filename LIKE '%.jpg'
            OR a.filename LIKE '%.jpeg'
            OR a.filename LIKE '%.png'
            OR a.filename LIKE '%.gif'
            OR a.filename LIKE '%.heic'
            OR a.filename LIKE '%.webp'
          )
      `;
      
      const rows = this.db!.prepare(query).all(messageRowid) as AttachmentRow[];
      
      return rows
        .map(row => {
          const resolvedPath = resolveAttachmentPath(row.filename);
          if (!resolvedPath) return null;
          
          return {
            rowid: row.ROWID,
            guid: row.guid,
            filename: resolvedPath,
            mimeType: row.mime_type || 'image/jpeg',
            messageRowid: row.message_rowid,
            chatIdentifier: row.chat_identifier,
            createdAt: macToUnix(row.created_date),
            transferName: row.transfer_name,
            totalBytes: row.total_bytes,
          };
        })
        .filter((img): img is ImageAttachment => img !== null);
    } catch (err) {
      log('Images', `Failed to get images for message: ${err}`, 'error');
      return [];
    }
  }
  
  /**
   * Get count of new images since a specific rowid
   */
  getNewImageCount(sinceRowid: number): number {
    if (!this.db && !this.open()) return 0;
    
    try {
      const result = this.db!.prepare(`
        SELECT COUNT(*) as count 
        FROM attachment
        WHERE filename IS NOT NULL 
          AND ROWID > ?
          AND (
            mime_type LIKE 'image/%'
            OR filename LIKE '%.jpg'
            OR filename LIKE '%.jpeg'
            OR filename LIKE '%.png'
            OR filename LIKE '%.gif'
            OR filename LIKE '%.heic'
            OR filename LIKE '%.webp'
          )
      `).get(sinceRowid) as { count: number };
      
      return result.count;
    } catch (err) {
      return 0;
    }
  }
  
  /**
   * Check if an image file exists on disk
   */
  imageExists(attachment: ImageAttachment): boolean {
    return existsSync(attachment.filename);
  }
  
  /**
   * Filter attachments to only those that exist on disk
   */
  filterExisting(attachments: ImageAttachment[]): ImageAttachment[] {
    return attachments.filter(a => this.imageExists(a));
  }
}

// Singleton instance
let readerInstance: ImageReader | null = null;

export function getImageReader(dbPath?: string): ImageReader {
  if (!readerInstance) {
    readerInstance = new ImageReader(dbPath);
  }
  return readerInstance;
}

