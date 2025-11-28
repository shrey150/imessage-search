/**
 * Indexing state management
 * Tracks progress for incremental indexing and deduplication
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';
import { log } from '../utils/progress.js';

// State database location
const STATE_DIR = `${homedir()}/.imessage-mcp`;
const STATE_DB_PATH = `${STATE_DIR}/state.db`;

export interface IndexingState {
  lastMessageRowid: number;
  lastIndexedAt: number | null;
  totalMessagesIndexed: number;
  totalChunksCreated: number;
}

export interface IndexedChunk {
  chunkHash: string;
  messageRowids: number[];
  documentId: string;  // ES document ID (legacy: was qdrantPointId)
  createdAt: number;
}

/**
 * State manager for tracking indexing progress
 */
export class StateManager {
  private db: Database.Database | null = null;
  
  constructor(private dbPath: string = STATE_DB_PATH) {
    // Ensure state directory exists
    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }
  }
  
  /**
   * Open the state database and create tables if needed
   */
  open(): void {
    if (this.db) return;
    
    this.db = Database(this.dbPath);
    
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS indexing_state (
        id INTEGER PRIMARY KEY DEFAULT 1,
        last_message_rowid INTEGER DEFAULT 0,
        last_indexed_at INTEGER,
        total_messages_indexed INTEGER DEFAULT 0,
        total_chunks_created INTEGER DEFAULT 0
      );
      
      CREATE TABLE IF NOT EXISTS indexed_chunks (
        chunk_hash TEXT PRIMARY KEY,
        message_rowids TEXT,
        qdrant_point_id TEXT,
        created_at INTEGER
      );
      
      -- Ensure we have a state row
      INSERT OR IGNORE INTO indexing_state (id) VALUES (1);
    `);
    
    log('State', `Opened state database at ${this.dbPath}`, 'success');
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
   * Get current indexing state
   */
  getState(): IndexingState {
    if (!this.db) this.open();
    
    const row = this.db!.prepare(`
      SELECT last_message_rowid, last_indexed_at, total_messages_indexed, total_chunks_created
      FROM indexing_state WHERE id = 1
    `).get() as {
      last_message_rowid: number;
      last_indexed_at: number | null;
      total_messages_indexed: number;
      total_chunks_created: number;
    };
    
    return {
      lastMessageRowid: row.last_message_rowid,
      lastIndexedAt: row.last_indexed_at,
      totalMessagesIndexed: row.total_messages_indexed,
      totalChunksCreated: row.total_chunks_created,
    };
  }
  
  /**
   * Update indexing state
   */
  updateState(updates: Partial<IndexingState>): void {
    if (!this.db) this.open();
    
    const sets: string[] = [];
    const values: (number | null)[] = [];
    
    if (updates.lastMessageRowid !== undefined) {
      sets.push('last_message_rowid = ?');
      values.push(updates.lastMessageRowid);
    }
    if (updates.lastIndexedAt !== undefined) {
      sets.push('last_indexed_at = ?');
      values.push(updates.lastIndexedAt);
    }
    if (updates.totalMessagesIndexed !== undefined) {
      sets.push('total_messages_indexed = ?');
      values.push(updates.totalMessagesIndexed);
    }
    if (updates.totalChunksCreated !== undefined) {
      sets.push('total_chunks_created = ?');
      values.push(updates.totalChunksCreated);
    }
    
    if (sets.length > 0) {
      this.db!.prepare(`UPDATE indexing_state SET ${sets.join(', ')} WHERE id = 1`).run(...values);
    }
  }
  
  /**
   * Check if a chunk hash has already been indexed
   */
  isChunkIndexed(chunkHash: string): boolean {
    if (!this.db) this.open();
    
    const row = this.db!.prepare(`
      SELECT 1 FROM indexed_chunks WHERE chunk_hash = ?
    `).get(chunkHash);
    
    return !!row;
  }
  
  /**
   * Get all indexed chunk hashes
   */
  getIndexedChunkHashes(): Set<string> {
    if (!this.db) this.open();
    
    const rows = this.db!.prepare(`
      SELECT chunk_hash FROM indexed_chunks
    `).all() as { chunk_hash: string }[];
    
    return new Set(rows.map(r => r.chunk_hash));
  }
  
  /**
   * Record an indexed chunk
   */
  recordChunk(chunk: IndexedChunk): void {
    if (!this.db) this.open();
    
    this.db!.prepare(`
      INSERT OR REPLACE INTO indexed_chunks (chunk_hash, message_rowids, qdrant_point_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      chunk.chunkHash,
      JSON.stringify(chunk.messageRowids),
      chunk.documentId,
      chunk.createdAt
    );
  }
  
  /**
   * Record multiple chunks in a transaction
   */
  recordChunks(chunks: IndexedChunk[]): void {
    if (!this.db) this.open();
    
    const insert = this.db!.prepare(`
      INSERT OR REPLACE INTO indexed_chunks (chunk_hash, message_rowids, qdrant_point_id, created_at)
      VALUES (?, ?, ?, ?)
    `);
    
    const transaction = this.db!.transaction((chunks: IndexedChunk[]) => {
      for (const chunk of chunks) {
        insert.run(
          chunk.chunkHash,
          JSON.stringify(chunk.messageRowids),
          chunk.documentId,
          chunk.createdAt
        );
      }
    });
    
    transaction(chunks);
  }
  
  /**
   * Reset all state (for full reindex)
   */
  reset(): void {
    if (!this.db) this.open();
    
    this.db!.exec(`
      DELETE FROM indexed_chunks;
      UPDATE indexing_state SET 
        last_message_rowid = 0,
        last_indexed_at = NULL,
        total_messages_indexed = 0,
        total_chunks_created = 0
      WHERE id = 1;
    `);
    
    log('State', 'State reset complete', 'success');
  }
  
  /**
   * Get count of indexed chunks
   */
  getChunkCount(): number {
    if (!this.db) this.open();
    
    const row = this.db!.prepare(`SELECT COUNT(*) as count FROM indexed_chunks`).get() as { count: number };
    return row.count;
  }
}

// Singleton instance
let stateInstance: StateManager | null = null;

export function getStateManager(): StateManager {
  if (!stateInstance) {
    stateInstance = new StateManager();
  }
  return stateInstance;
}

