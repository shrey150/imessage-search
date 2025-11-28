/**
 * Hashing utilities for chunk deduplication
 */

import { createHash } from 'crypto';
import { v5 as uuidv5 } from 'uuid';

// Namespace UUID for generating deterministic UUIDs from chunk hashes
const NAMESPACE_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace

/**
 * Generate a SHA256 hash of a string
 */
export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Generate a deterministic UUID v5 from a chunk's content
 * This ensures the same chunk always gets the same Qdrant point ID
 */
export function chunkToUUID(chunkText: string): string {
  return uuidv5(sha256(chunkText), NAMESPACE_UUID);
}

