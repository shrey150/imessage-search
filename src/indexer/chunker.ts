/**
 * Message chunker
 * Groups messages into conversation segments based on time gaps
 */

import { RawMessage } from './messages.js';
import { ContactResolver } from './contacts.js';
import { formatTime } from '../utils/timestamp.js';
import { sha256 } from '../utils/hash.js';

// Chunking configuration
const GAP_THRESHOLD_SECONDS = 300; // 5 minutes
const MIN_MESSAGES_PER_CHUNK = 1;
const MAX_MESSAGES_PER_CHUNK = 10;
const MAX_CHUNK_CHARS = 1000;
const MAX_MESSAGE_CHARS = 2000; // Limit individual message length to prevent token overflow

export interface MessageChunk {
  id: string;              // SHA256 hash of content for deduplication
  text: string;            // Formatted conversation text
  startTs: number;         // Unix timestamp of first message
  endTs: number;           // Unix timestamp of last message
  participants: string[];  // Resolved contact names
  chatIdentifier: string;  // Original chat identifier
  groupName: string | null;// Group chat name if applicable
  isGroupChat: boolean;    // Whether this is a group conversation
  messageRowids: number[]; // Original message rowids for tracking
  messageCount: number;    // Number of messages in chunk
}

/**
 * Chunk messages into conversation segments
 */
export function chunkMessages(
  messages: RawMessage[],
  contactResolver: ContactResolver
): MessageChunk[] {
  if (messages.length === 0) return [];
  
  // Group messages by chat first
  const chatGroups = new Map<string, RawMessage[]>();
  for (const msg of messages) {
    const existing = chatGroups.get(msg.chatIdentifier) || [];
    existing.push(msg);
    chatGroups.set(msg.chatIdentifier, existing);
  }
  
  const chunks: MessageChunk[] = [];
  
  // Process each chat separately
  for (const [chatIdentifier, chatMessages] of chatGroups) {
    // Sort by date ascending
    const sorted = [...chatMessages].sort((a, b) => a.date - b.date);
    
    // Split into chunks based on time gaps
    let currentChunk: RawMessage[] = [];
    let lastTimestamp = 0;
    
    for (const msg of sorted) {
      // Skip empty or trivial messages
      if (!msg.text || msg.text.trim().length === 0) continue;
      
      const gap = lastTimestamp > 0 ? msg.date - lastTimestamp : 0;
      const shouldSplit = 
        gap >= GAP_THRESHOLD_SECONDS ||
        currentChunk.length >= MAX_MESSAGES_PER_CHUNK ||
        getChunkTextLength(currentChunk, contactResolver) >= MAX_CHUNK_CHARS;
      
      if (shouldSplit && currentChunk.length >= MIN_MESSAGES_PER_CHUNK) {
        // Finalize current chunk
        const chunk = createChunk(currentChunk, contactResolver);
        if (chunk) chunks.push(chunk);
        currentChunk = [];
      }
      
      currentChunk.push(msg);
      lastTimestamp = msg.date;
    }
    
    // Don't forget the last chunk
    if (currentChunk.length >= MIN_MESSAGES_PER_CHUNK) {
      const chunk = createChunk(currentChunk, contactResolver);
      if (chunk) chunks.push(chunk);
    }
  }
  
  return chunks;
}

/**
 * Get the approximate text length of a chunk
 */
function getChunkTextLength(messages: RawMessage[], contactResolver: ContactResolver): number {
  return messages.reduce((len, msg) => {
    const sender = msg.isFromMe ? 'Me' : contactResolver.resolve(msg.handleId || 'Unknown');
    return len + sender.length + msg.text.length + 20; // Rough overhead for formatting
  }, 0);
}

/**
 * Create a chunk from a group of messages
 */
function createChunk(
  messages: RawMessage[],
  contactResolver: ContactResolver
): MessageChunk | null {
  if (messages.length === 0) return null;
  
  // Build formatted text
  const lines: string[] = [];
  const participants = new Set<string>();
  
  for (const msg of messages) {
    const sender = msg.isFromMe ? 'Me' : contactResolver.resolve(msg.handleId || 'Unknown');
    participants.add(sender);
    
    const time = formatTime(msg.date);
    const text = cleanMessageText(msg.text);
    
    if (text) {
      lines.push(`[${sender} ${time}] ${text}`);
    }
  }
  
  if (lines.length === 0) return null;
  
  const text = lines.join('\n');
  const firstMsg = messages[0];
  const lastMsg = messages[messages.length - 1];
  
  // Determine if this is a group chat
  // Group chats typically have a display_name or have more than 2 participants
  const isGroupChat = firstMsg.groupName !== null || participants.size > 2;
  
  return {
    id: sha256(text),
    text,
    startTs: firstMsg.date,
    endTs: lastMsg.date,
    participants: Array.from(participants),
    chatIdentifier: firstMsg.chatIdentifier,
    groupName: firstMsg.groupName,
    isGroupChat,
    messageRowids: messages.map(m => m.rowid),
    messageCount: messages.length,
  };
}

/**
 * Clean message text for embedding
 * - Remove null/empty
 * - Strip excessive whitespace
 * - Keep emojis
 * - Remove duplicate consecutive messages (iMessage glitch)
 * - Truncate very long messages to prevent token overflow
 */
function cleanMessageText(text: string): string {
  if (!text) return '';
  
  // Normalize whitespace
  let cleaned = text.replace(/\s+/g, ' ').trim();
  
  // Remove some common reaction prefixes that aren't useful
  if (cleaned.startsWith('Loved "') || 
      cleaned.startsWith('Liked "') ||
      cleaned.startsWith('Laughed at "') ||
      cleaned.startsWith('Emphasized "') ||
      cleaned.startsWith('Questioned "') ||
      cleaned.startsWith('Disliked "')) {
    // These are reactions to other messages - keep them but they're less useful for search
    // We'll keep them for context
  }
  
  // Truncate very long messages to prevent token overflow in embeddings API
  if (cleaned.length > MAX_MESSAGE_CHARS) {
    cleaned = cleaned.slice(0, MAX_MESSAGE_CHARS) + '... [truncated]';
  }
  
  return cleaned;
}

/**
 * Filter chunks to remove low-quality content
 */
export function filterChunks(chunks: MessageChunk[]): MessageChunk[] {
  return chunks.filter(chunk => {
    // Remove very short chunks (just "ok", "k", "lol", etc.)
    if (chunk.text.length < 20) return false;
    
    // Remove chunks with only 1 trivial message
    if (chunk.messageCount === 1 && chunk.text.length < 50) return false;
    
    return true;
  });
}

/**
 * Deduplicate chunks by their hash
 */
export function deduplicateChunks(
  chunks: MessageChunk[],
  existingHashes: Set<string>
): MessageChunk[] {
  const seen = new Set<string>(existingHashes);
  const unique: MessageChunk[] = [];
  
  for (const chunk of chunks) {
    if (!seen.has(chunk.id)) {
      seen.add(chunk.id);
      unique.push(chunk);
    }
  }
  
  return unique;
}

