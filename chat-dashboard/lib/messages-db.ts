/**
 * iMessage SQLite database reader for the chat dashboard
 * Reads messages directly from ~/Library/Messages/chat.db
 * Adapted from src/indexer/messages.ts for dashboard use
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { existsSync } from 'fs';

// Default path to Messages database
const DEFAULT_MESSAGES_PATH = `${homedir()}/Library/Messages/chat.db`;

// Mac epoch starts at Jan 1, 2001 00:00:00 UTC
// Unix epoch starts at Jan 1, 1970 00:00:00 UTC
const MAC_EPOCH_OFFSET = 978307200;
const NANOSECOND_FACTOR = 1_000_000_000;

/**
 * Convert Mac absolute timestamp (nanoseconds since 2001) to Unix timestamp (seconds since 1970)
 */
function macToUnix(macTimestamp: number | bigint): number {
  const ts = typeof macTimestamp === 'bigint' ? Number(macTimestamp) : macTimestamp;
  return Math.floor(ts / NANOSECOND_FACTOR) + MAC_EPOCH_OFFSET;
}

/**
 * Convert Unix timestamp to Mac absolute timestamp
 */
function unixToMac(unixTimestamp: number): number {
  return (unixTimestamp - MAC_EPOCH_OFFSET) * NANOSECOND_FACTOR;
}

export interface Attachment {
  rowid: number;
  filename: string; // Full resolved path
  mimeType: string;
  transferName: string | null; // Original filename
  totalBytes: number;
  isImage: boolean;
  isVideo: boolean;
}

export interface Message {
  rowid: number;
  text: string;
  date: number; // Unix timestamp in seconds
  dateMs: number; // Unix timestamp in milliseconds for JS Date
  isFromMe: boolean;
  handleId: string | null;
  chatIdentifier: string;
  groupName: string | null;
  service: string;
  isDelivered: boolean;
  isRead: boolean;
  associatedMessageGuid: string | null;
  associatedMessageType: number;
  attachments: Attachment[];
}

export interface ChatInfo {
  chatIdentifier: string;
  displayName: string | null;
  participants: string[];
  isGroupChat: boolean;
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
  is_delivered: number;
  is_read: number;
  associated_message_guid: string | null;
  associated_message_type: number;
}

/**
 * Extract plain text from attributedBody blob
 * attributedBody is an archived NSAttributedString (bplist format)
 * Starting in macOS ~2024, many messages store text here instead of the 'text' column
 */
function extractTextFromAttributedBody(body: Buffer | null): string | null {
  if (!body || body.length < 10) return null;

  try {
    // Find "NSString" marker in the blob
    const nsStringMarker = Buffer.from('NSString');
    const markerIndex = body.indexOf(nsStringMarker);
    if (markerIndex === -1) return null;

    // Search for the pattern 0x01 0x2B (ASCII: \x01+) followed by length byte
    const searchStart = markerIndex + nsStringMarker.length;
    const searchBuf = body.slice(searchStart);

    for (let i = 0; i < Math.min(100, searchBuf.length - 3); i++) {
      if (searchBuf[i] === 0x01 && searchBuf[i + 1] === 0x2b) {
        let textLength: number;
        let textStart: number;

        const lengthByte = searchBuf[i + 2];

        if (lengthByte < 0x80) {
          textLength = lengthByte;
          textStart = i + 3;
        } else {
          textLength = lengthByte & 0x7f;
          textStart = i + 3;
        }

        if (textLength > 0 && textLength < 50000 && textStart + textLength <= searchBuf.length) {
          let text = searchBuf.slice(textStart, textStart + textLength).toString('utf-8');
          text = text.replace(/^[\x00-\x1F\x7F-\x9F]+/, '');

          if (text.length > 1 && /^[0-9A-Z]/.test(text[0]) && /^[a-zA-Z\s]/.test(text[1])) {
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

    // Fallback: try to extract readable text
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

// Image MIME types
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

// Video MIME types
const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime', // .mov files
  'video/x-m4v',
  'video/mpeg',
  'video/webm',
  'video/3gpp',
  'video/3gpp2',
];

/**
 * Resolve attachment path (replace ~ with home directory)
 */
function resolveAttachmentPath(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('~')) {
    return path.replace('~', homedir());
  }
  return path;
}

interface AttachmentRow {
  ROWID: number;
  filename: string | null;
  mime_type: string | null;
  transfer_name: string | null;
  total_bytes: number;
}

/**
 * Message database reader for the dashboard
 */
export class MessagesDB {
  private db: Database.Database | null = null;

  constructor(private dbPath: string = DEFAULT_MESSAGES_PATH) {}

  /**
   * Open the database connection
   */
  open(): boolean {
    if (this.db) return true;

    if (!existsSync(this.dbPath)) {
      console.error(`Messages database not found at ${this.dbPath}`);
      return false;
    }

    try {
      this.db = new Database(this.dbPath, { readonly: true });
      return true;
    } catch (err) {
      console.error(`Failed to open database: ${err}`);
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
   * Convert a row to a Message object
   */
  private rowToMessage(row: MessageRow, attachments: Attachment[] = []): Message | null {
    let text = row.text;
    if (!text || text.trim() === '') {
      text = extractTextFromAttributedBody(row.attributedBody);
    }

    // Allow messages with attachments even if no text
    const hasAttachments = attachments.length > 0;
    if ((!text || text.trim() === '') && !hasAttachments) return null;

    const unixDate = macToUnix(row.date);

    return {
      rowid: row.ROWID,
      text: text || '',
      date: unixDate,
      dateMs: unixDate * 1000,
      isFromMe: row.is_from_me === 1,
      handleId: row.handle_id,
      chatIdentifier: row.chat_identifier || 'unknown',
      groupName: row.group_name,
      service: row.service || 'iMessage',
      isDelivered: row.is_delivered === 1,
      isRead: row.is_read === 1,
      associatedMessageGuid: row.associated_message_guid,
      associatedMessageType: row.associated_message_type,
      attachments,
    };
  }

  /**
   * Get attachments for a list of message rowids
   */
  getAttachmentsForMessages(messageRowids: number[]): Map<number, Attachment[]> {
    if (!this.db && !this.open()) return new Map();
    if (messageRowids.length === 0) return new Map();

    const placeholders = messageRowids.map(() => '?').join(',');
    const query = `
      SELECT 
        a.ROWID,
        a.filename,
        a.mime_type,
        a.transfer_name,
        a.total_bytes,
        maj.message_id
      FROM attachment a
      JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
      WHERE maj.message_id IN (${placeholders})
        AND a.filename IS NOT NULL
    `;

    const rows = this.db!.prepare(query).all(...messageRowids) as (AttachmentRow & { message_id: number })[];
    
    const result = new Map<number, Attachment[]>();
    
    for (const row of rows) {
      const resolvedPath = resolveAttachmentPath(row.filename);
      if (!resolvedPath) continue;
      
      // Check if file exists
      if (!existsSync(resolvedPath)) continue;
      
      const mimeType = row.mime_type || '';
      const isImage = IMAGE_MIME_TYPES.includes(mimeType) || 
        /\.(jpg|jpeg|png|gif|heic|webp|tiff|bmp)$/i.test(resolvedPath);
      const isVideo = VIDEO_MIME_TYPES.includes(mimeType) || 
        /\.(mp4|mov|m4v|mpeg|mpg|webm|3gp|3g2)$/i.test(resolvedPath);
      
      const attachment: Attachment = {
        rowid: row.ROWID,
        filename: resolvedPath,
        mimeType: mimeType || 'application/octet-stream',
        transferName: row.transfer_name,
        totalBytes: row.total_bytes,
        isImage,
        isVideo,
      };
      
      if (!result.has(row.message_id)) {
        result.set(row.message_id, []);
      }
      result.get(row.message_id)!.push(attachment);
    }
    
    return result;
  }

  /**
   * Get messages for a chat, centered around a specific timestamp
   * Returns messages before and after the anchor point
   */
  getMessagesAround(
    chatIdentifier: string,
    anchorTimestamp: number, // Unix timestamp in seconds
    limit: number = 50
  ): { messages: Message[]; hasMore: { before: boolean; after: boolean } } {
    if (!this.db && !this.open()) {
      return { messages: [], hasMore: { before: false, after: false } };
    }

    const macTimestamp = unixToMac(anchorTimestamp);
    const halfLimit = Math.floor(limit / 2);

    // Get messages before anchor
    const beforeQuery = `
      SELECT 
        m.ROWID,
        m.text,
        m.attributedBody,
        m.date,
        m.is_from_me,
        m.is_delivered,
        m.is_read,
        m.associated_message_guid,
        m.associated_message_type,
        m.service,
        h.id as handle_id,
        c.chat_identifier,
        c.display_name as group_name
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE c.chat_identifier = ?
        AND m.date < ?
      ORDER BY m.date DESC
      LIMIT ?
    `;

    // Get messages after anchor (including anchor)
    const afterQuery = `
      SELECT 
        m.ROWID,
        m.text,
        m.attributedBody,
        m.date,
        m.is_from_me,
        m.is_delivered,
        m.is_read,
        m.associated_message_guid,
        m.associated_message_type,
        m.service,
        h.id as handle_id,
        c.chat_identifier,
        c.display_name as group_name
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE c.chat_identifier = ?
        AND m.date >= ?
      ORDER BY m.date ASC
      LIMIT ?
    `;

    const beforeRows = this.db!.prepare(beforeQuery).all(
      chatIdentifier,
      macTimestamp,
      halfLimit + 1
    ) as MessageRow[];

    const afterRows = this.db!.prepare(afterQuery).all(
      chatIdentifier,
      macTimestamp,
      halfLimit + 1
    ) as MessageRow[];

    const hasMoreBefore = beforeRows.length > halfLimit;
    const hasMoreAfter = afterRows.length > halfLimit;

    // Trim to limit
    const trimmedBefore = beforeRows.slice(0, halfLimit);
    const trimmedAfter = afterRows.slice(0, halfLimit);
    
    // Get all message rowids for attachment fetching
    const allRowids = [...trimmedBefore, ...trimmedAfter].map(r => r.ROWID);
    const attachmentsMap = this.getAttachmentsForMessages(allRowids);

    // Convert rows to messages with attachments
    const beforeMessages = trimmedBefore
      .map((r) => this.rowToMessage(r, attachmentsMap.get(r.ROWID) || []))
      .filter((m): m is Message => m !== null)
      .reverse();

    const afterMessages = trimmedAfter
      .map((r) => this.rowToMessage(r, attachmentsMap.get(r.ROWID) || []))
      .filter((m): m is Message => m !== null);

    return {
      messages: [...beforeMessages, ...afterMessages],
      hasMore: { before: hasMoreBefore, after: hasMoreAfter },
    };
  }

  /**
   * Get messages before a specific timestamp (for scrolling up)
   */
  getMessagesBefore(
    chatIdentifier: string,
    beforeTimestamp: number, // Unix timestamp in seconds
    limit: number = 30
  ): { messages: Message[]; hasMore: boolean } {
    if (!this.db && !this.open()) {
      return { messages: [], hasMore: false };
    }

    const macTimestamp = unixToMac(beforeTimestamp);

    const query = `
      SELECT 
        m.ROWID,
        m.text,
        m.attributedBody,
        m.date,
        m.is_from_me,
        m.is_delivered,
        m.is_read,
        m.associated_message_guid,
        m.associated_message_type,
        m.service,
        h.id as handle_id,
        c.chat_identifier,
        c.display_name as group_name
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE c.chat_identifier = ?
        AND m.date < ?
      ORDER BY m.date DESC
      LIMIT ?
    `;

    const rows = this.db!.prepare(query).all(
      chatIdentifier,
      macTimestamp,
      limit + 1
    ) as MessageRow[];

    const hasMore = rows.length > limit;
    const trimmedRows = rows.slice(0, limit);
    
    // Fetch attachments
    const rowids = trimmedRows.map(r => r.ROWID);
    const attachmentsMap = this.getAttachmentsForMessages(rowids);
    
    const messages = trimmedRows
      .map((r) => this.rowToMessage(r, attachmentsMap.get(r.ROWID) || []))
      .filter((m): m is Message => m !== null)
      .reverse();

    return { messages, hasMore };
  }

  /**
   * Get messages after a specific timestamp (for scrolling down)
   */
  getMessagesAfter(
    chatIdentifier: string,
    afterTimestamp: number, // Unix timestamp in seconds
    limit: number = 30
  ): { messages: Message[]; hasMore: boolean } {
    if (!this.db && !this.open()) {
      return { messages: [], hasMore: false };
    }

    const macTimestamp = unixToMac(afterTimestamp);

    const query = `
      SELECT 
        m.ROWID,
        m.text,
        m.attributedBody,
        m.date,
        m.is_from_me,
        m.is_delivered,
        m.is_read,
        m.associated_message_guid,
        m.associated_message_type,
        m.service,
        h.id as handle_id,
        c.chat_identifier,
        c.display_name as group_name
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE c.chat_identifier = ?
        AND m.date > ?
      ORDER BY m.date ASC
      LIMIT ?
    `;

    const rows = this.db!.prepare(query).all(
      chatIdentifier,
      macTimestamp,
      limit + 1
    ) as MessageRow[];

    const hasMore = rows.length > limit;
    const trimmedRows = rows.slice(0, limit);
    
    // Fetch attachments
    const rowids = trimmedRows.map(r => r.ROWID);
    const attachmentsMap = this.getAttachmentsForMessages(rowids);
    
    const messages = trimmedRows
      .map((r) => this.rowToMessage(r, attachmentsMap.get(r.ROWID) || []))
      .filter((m): m is Message => m !== null);

    return { messages, hasMore };
  }

  /**
   * Get the most recent messages for a chat
   */
  getRecentMessages(chatIdentifier: string, limit: number = 50): Message[] {
    if (!this.db && !this.open()) return [];

    const query = `
      SELECT 
        m.ROWID,
        m.text,
        m.attributedBody,
        m.date,
        m.is_from_me,
        m.is_delivered,
        m.is_read,
        m.associated_message_guid,
        m.associated_message_type,
        m.service,
        h.id as handle_id,
        c.chat_identifier,
        c.display_name as group_name
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE c.chat_identifier = ?
      ORDER BY m.date DESC
      LIMIT ?
    `;

    const rows = this.db!.prepare(query).all(chatIdentifier, limit) as MessageRow[];
    
    // Fetch attachments
    const rowids = rows.map(r => r.ROWID);
    const attachmentsMap = this.getAttachmentsForMessages(rowids);

    return rows
      .map((r) => this.rowToMessage(r, attachmentsMap.get(r.ROWID) || []))
      .filter((m): m is Message => m !== null)
      .reverse();
  }

  /**
   * Get chat info by identifier
   */
  getChatInfo(chatIdentifier: string): ChatInfo | null {
    if (!this.db && !this.open()) return null;

    // Get chat display name
    const chatQuery = `
      SELECT chat_identifier, display_name
      FROM chat
      WHERE chat_identifier = ?
    `;

    const chatRow = this.db!.prepare(chatQuery).get(chatIdentifier) as {
      chat_identifier: string;
      display_name: string | null;
    } | undefined;

    if (!chatRow) return null;

    // Get participants
    const participantsQuery = `
      SELECT DISTINCT h.id as handle_id
      FROM message m
      JOIN handle h ON m.handle_id = h.ROWID
      JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE c.chat_identifier = ?
        AND h.id IS NOT NULL
    `;

    const participantRows = this.db!.prepare(participantsQuery).all(chatIdentifier) as {
      handle_id: string;
    }[];

    const participants = participantRows.map((r) => r.handle_id);
    const isGroupChat = chatRow.display_name !== null || participants.length > 1;

    return {
      chatIdentifier: chatRow.chat_identifier,
      displayName: chatRow.display_name,
      participants,
      isGroupChat,
    };
  }

  /**
   * Get reactions (tapbacks) for messages in a chat
   * Returns a map of message GUID -> reactions
   */
  getReactionsForMessages(messageRowids: number[]): Map<number, { emoji: string; sender: string; isMe: boolean }[]> {
    if (!this.db && !this.open() || messageRowids.length === 0) {
      return new Map();
    }

    // In iMessage, reactions are stored as separate messages with associated_message_type
    // Type 2000-2005 are tapback reactions:
    // 2000 = love, 2001 = like, 2002 = dislike, 2003 = laugh, 2004 = emphasize, 2005 = question
    // Type 3000-3005 are the removal of those tapbacks
    const reactionTypeToEmoji: Record<number, string> = {
      2000: '❤️',
      2001: '👍',
      2002: '👎',
      2003: '😂',
      2004: '‼️',
      2005: '❓',
    };

    const placeholders = messageRowids.map(() => '?').join(',');
    
    // Get message GUIDs first
    const guidQuery = `
      SELECT ROWID, guid FROM message WHERE ROWID IN (${placeholders})
    `;
    
    const guidRows = this.db!.prepare(guidQuery).all(...messageRowids) as { ROWID: number; guid: string }[];
    const rowidToGuid = new Map(guidRows.map(r => [r.ROWID, r.guid]));
    const guidToRowid = new Map(guidRows.map(r => [r.guid, r.ROWID]));

    // Now get reactions that reference these GUIDs
    const guids = Array.from(rowidToGuid.values());
    if (guids.length === 0) return new Map();

    const guidPlaceholders = guids.map(() => '?').join(',');
    
    const reactionsQuery = `
      SELECT 
        m.associated_message_guid,
        m.associated_message_type,
        m.is_from_me,
        h.id as handle_id
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE m.associated_message_guid IN (${guidPlaceholders})
        AND m.associated_message_type BETWEEN 2000 AND 2005
    `;

    const reactionRows = this.db!.prepare(reactionsQuery).all(...guids) as {
      associated_message_guid: string;
      associated_message_type: number;
      is_from_me: number;
      handle_id: string | null;
    }[];

    const result = new Map<number, { emoji: string; sender: string; isMe: boolean }[]>();

    for (const row of reactionRows) {
      // The associated_message_guid format is "p:X/GUID" where X is the part index
      // We need to extract just the GUID part
      const guidMatch = row.associated_message_guid.match(/p:\d+\/(.+)/) || 
                        row.associated_message_guid.match(/bp:(.+)/);
      const actualGuid = guidMatch ? guidMatch[1] : row.associated_message_guid;
      
      const messageRowid = guidToRowid.get(actualGuid);
      if (!messageRowid) continue;

      const emoji = reactionTypeToEmoji[row.associated_message_type];
      if (!emoji) continue;

      if (!result.has(messageRowid)) {
        result.set(messageRowid, []);
      }

      result.get(messageRowid)!.push({
        emoji,
        sender: row.handle_id || 'Me',
        isMe: row.is_from_me === 1,
      });
    }

    return result;
  }
}

// Singleton instance
let dbInstance: MessagesDB | null = null;

export function getMessagesDB(dbPath?: string): MessagesDB {
  if (!dbInstance) {
    dbInstance = new MessagesDB(dbPath);
  }
  return dbInstance;
}

