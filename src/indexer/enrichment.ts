/**
 * Enrichment module for message chunks
 * Adds derived fields for enhanced search capabilities
 */

import { MessageChunk } from './chunker.js';
import { MessageDocument } from '../db/elasticsearch.js';

const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Enriched chunk with all fields needed for Elasticsearch
 */
export interface EnrichedChunk {
  id: string;
  text: string;
  text_embedding?: number[];
  
  // Sender / Recipient
  sender: string;
  sender_is_me: boolean;
  participants: string[];
  participant_count: number;
  
  // Chat metadata
  chat_id: string;
  chat_name: string | null;
  is_dm: boolean;
  is_group_chat: boolean;
  
  // Temporal fields
  timestamp: Date;
  year: number;
  month: number;
  day_of_week: string;
  hour_of_day: number;
  
  // Attachments / Images
  has_attachment: boolean;
  has_image: boolean;
  image_embedding?: number[];
  
  // Chunk metadata
  chunk_id: string;
  message_count: number;
  start_timestamp: Date;
  end_timestamp: Date;
}

/**
 * Extract the primary sender from chunk text
 * The chunk format is: [Sender HH:MM] message
 */
function extractPrimarySender(text: string): string {
  const lines = text.split('\n');
  
  // Count messages by sender
  const senderCounts = new Map<string, number>();
  
  for (const line of lines) {
    const match = line.match(/^\[([^\]]+)\s+\d{1,2}:\d{2}(?:\s*[AP]M)?\]/i);
    if (match) {
      const sender = match[1].trim();
      senderCounts.set(sender, (senderCounts.get(sender) || 0) + 1);
    }
  }
  
  // Return the most frequent sender (excluding "Me")
  let maxCount = 0;
  let primarySender = 'Unknown';
  
  for (const [sender, count] of senderCounts) {
    if (sender !== 'Me' && count > maxCount) {
      maxCount = count;
      primarySender = sender;
    }
  }
  
  // If all messages are from "Me", return "Me"
  if (primarySender === 'Unknown' && senderCounts.has('Me')) {
    return 'Me';
  }
  
  return primarySender;
}

/**
 * Check if the primary sender is "Me"
 */
function isPrimarySenderMe(text: string): boolean {
  const lines = text.split('\n');
  
  // Count messages by sender
  let meCount = 0;
  let otherCount = 0;
  
  for (const line of lines) {
    const match = line.match(/^\[([^\]]+)\s+\d{1,2}:\d{2}(?:\s*[AP]M)?\]/i);
    if (match) {
      const sender = match[1].trim();
      if (sender === 'Me') {
        meCount++;
      } else {
        otherCount++;
      }
    }
  }
  
  // Consider "Me" as primary if majority of messages are from me
  return meCount > otherCount;
}

/**
 * Determine if this is a DM (direct message) vs group chat
 */
function isDM(participants: string[], groupName: string | null): boolean {
  // If there's a group name, it's definitely a group chat
  if (groupName) return false;
  
  // DMs have exactly 2 participants (Me + 1 other person)
  // But participants array only includes resolved names, so we check if <= 2
  return participants.length <= 2;
}

/**
 * Options for enriching a chunk with additional data
 */
export interface EnrichmentOptions {
  hasImage?: boolean;
  imageEmbedding?: number[];
}

/**
 * Enrich a message chunk with derived fields
 */
export function enrichChunk(chunk: MessageChunk, options: EnrichmentOptions = {}): EnrichedChunk {
  const startDate = new Date(chunk.startTs * 1000);
  const endDate = new Date(chunk.endTs * 1000);
  
  const sender = extractPrimarySender(chunk.text);
  const senderIsMe = isPrimarySenderMe(chunk.text);
  const isDirectMessage = isDM(chunk.participants, chunk.groupName);
  
  return {
    id: chunk.id,
    text: chunk.text,
    
    // Sender / Recipient
    sender,
    sender_is_me: senderIsMe,
    participants: chunk.participants,
    participant_count: chunk.participants.length,
    
    // Chat metadata
    chat_id: chunk.chatIdentifier,
    chat_name: chunk.groupName,
    is_dm: isDirectMessage,
    is_group_chat: !isDirectMessage,
    
    // Temporal fields
    timestamp: startDate,
    year: startDate.getFullYear(),
    month: startDate.getMonth() + 1, // 1-indexed
    day_of_week: DAYS_OF_WEEK[startDate.getDay()],
    hour_of_day: startDate.getHours(),
    
    // Attachments / Images
    has_attachment: options.hasImage || false,
    has_image: options.hasImage || false,
    image_embedding: options.imageEmbedding,
    
    // Chunk metadata
    chunk_id: chunk.id,
    message_count: chunk.messageCount,
    start_timestamp: startDate,
    end_timestamp: endDate,
  };
}

/**
 * Convert enriched chunk to Elasticsearch document
 */
export function toESDocument(
  enriched: EnrichedChunk, 
  embedding?: number[]
): { id: string } & MessageDocument {
  return {
    id: enriched.id,
    text: enriched.text,
    text_embedding: embedding,
    sender: enriched.sender,
    sender_is_me: enriched.sender_is_me,
    participants: enriched.participants,
    participant_count: enriched.participant_count,
    chat_id: enriched.chat_id,
    chat_name: enriched.chat_name,
    is_dm: enriched.is_dm,
    is_group_chat: enriched.is_group_chat,
    timestamp: enriched.timestamp,
    year: enriched.year,
    month: enriched.month,
    day_of_week: enriched.day_of_week,
    hour_of_day: enriched.hour_of_day,
    has_attachment: enriched.has_attachment,
    has_image: enriched.has_image,
    image_embedding: enriched.image_embedding,
    chunk_id: enriched.chunk_id,
    message_count: enriched.message_count,
    start_timestamp: enriched.start_timestamp,
    end_timestamp: enriched.end_timestamp,
  };
}

/**
 * Batch enrich multiple chunks
 */
export function enrichChunks(chunks: MessageChunk[], optionsArray?: EnrichmentOptions[]): EnrichedChunk[] {
  return chunks.map((chunk, i) => enrichChunk(chunk, optionsArray?.[i]));
}

