#!/usr/bin/env tsx
/**
 * Migration Script: People Graph + Chat Graph
 * 
 * This script migrates existing Elasticsearch data to use the new People Graph and Chat Graph.
 * It preserves existing embeddings (no OpenAI API cost) while adding stable UUID references.
 * 
 * Usage: pnpm run migrate
 * 
 * Phases:
 * 1. Setup - Initialize SQLite DB and update ES mapping
 * 2. Detect Owner - Create "Me" person from owner handles
 * 3. Build Graphs - Resolve all handles and chats to UUIDs
 * 4. Update ES - Add new fields to existing documents
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getElasticsearchDB, PEOPLE_GRAPH_FIELDS_MAPPING } from '../db/elasticsearch.js';
import { getPeopleGraph, normalizeHandle, inferHandleType } from '../db/people-graph.js';
import { getChatGraph } from '../db/chat-graph.js';
import { getContactResolver } from '../indexer/contacts.js';
import { log, ProgressBar } from '../utils/progress.js';
import * as schema from '../db/schema.js';

// Configuration
const IMESSAGE_DB_PATH = `${homedir()}/Library/Messages/chat.db`;
const PEOPLE_DB_PATH = './data/people.db';
const BATCH_SIZE = 100;

// ============================================================
// iMessage DB Reader (with raw handles)
// ============================================================

interface ChatInfo {
  chat_identifier: string;
  display_name: string | null;
  is_group: boolean;
  participant_handles: string[];
}

interface MessageWithHandles {
  rowid: number;
  text: string;
  date: number;
  is_from_me: boolean;
  sender_handle: string | null;
  chat_identifier: string;
  chat_display_name: string | null;
  participant_handles: string[];
}

function readOwnerHandles(imessageDb: Database.Database): string[] {
  // NOTE: The iMessage DB doesn't store your own handles in an easily queryable way.
  // When is_from_me = 1, the handle_id is the RECIPIENT, not the sender.
  // 
  // We can try to detect owner handles from:
  // 1. The account_login field on messages (sometimes contains iCloud email)
  // 2. The destination_caller_id field on messages (sometimes contains phone)
  // 3. Environment variables or config
  
  const allHandles = new Set<string>();
  
  // Try to get account info from messages
  try {
    const accountRows = imessageDb.prepare(`
      SELECT DISTINCT account_login
      FROM message
      WHERE account_login IS NOT NULL 
        AND account_login != ''
        AND is_from_me = 1
      LIMIT 10
    `).all() as { account_login: string }[];
    
    for (const row of accountRows) {
      if (row.account_login && row.account_login.includes('@')) {
        // Extract email from account string like "E:user@icloud.com"
        const match = row.account_login.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
        if (match) {
          allHandles.add(match[0]);
        }
      }
    }
  } catch {
    // account_login column might not exist in older DBs
  }
  
  // Try to get destination_caller_id (your phone number when sending)
  try {
    const callerIdRows = imessageDb.prepare(`
      SELECT DISTINCT destination_caller_id
      FROM message
      WHERE destination_caller_id IS NOT NULL 
        AND destination_caller_id != ''
        AND is_from_me = 1
      LIMIT 10
    `).all() as { destination_caller_id: string }[];
    
    for (const row of callerIdRows) {
      if (row.destination_caller_id) {
        allHandles.add(row.destination_caller_id);
      }
    }
  } catch {
    // Column might not exist
  }
  
  // Check environment variable for manual override
  const envHandles = process.env.OWNER_HANDLES;
  if (envHandles) {
    for (const h of envHandles.split(',')) {
      if (h.trim()) allHandles.add(h.trim());
    }
  }
  
  return Array.from(allHandles);
}

function readAllChats(imessageDb: Database.Database): ChatInfo[] {
  const rows = imessageDb.prepare(`
    SELECT 
      c.chat_identifier,
      c.display_name,
      c.style
    FROM chat c
    WHERE c.chat_identifier IS NOT NULL
  `).all() as { chat_identifier: string; display_name: string | null; style: number }[];
  
  const chats: ChatInfo[] = [];
  
  for (const row of rows) {
    // Get participants for this chat
    const participants = imessageDb.prepare(`
      SELECT DISTINCT h.id as handle
      FROM handle h
      JOIN chat_handle_join chj ON h.ROWID = chj.handle_id
      JOIN chat c ON chj.chat_id = c.ROWID
      WHERE c.chat_identifier = ?
        AND h.id IS NOT NULL
    `).all(row.chat_identifier) as { handle: string }[];
    
    chats.push({
      chat_identifier: row.chat_identifier,
      display_name: row.display_name,
      is_group: row.style === 43 || participants.length > 1, // style 43 = group chat
      participant_handles: participants.map(p => p.handle),
    });
  }
  
  return chats;
}

interface ChunkMapping {
  chunk_id: string;
  chat_identifier: string;
  sender_handle: string | null;
  participant_handles: string[];
  is_from_me: boolean;
}

async function buildChunkMappings(
  imessageDb: Database.Database,
  esDocIds: string[]
): Promise<Map<string, ChunkMapping>> {
  // We need to map ES document IDs back to iMessage data
  // This is tricky because the chunk ID is a hash of the text content
  // We'll need to reconstruct the mapping
  
  // For now, we'll build a lookup by chat_identifier and get the handles from there
  const chatHandles = new Map<string, { participants: string[]; display_name: string | null }>();
  
  const chats = readAllChats(imessageDb);
  for (const chat of chats) {
    chatHandles.set(chat.chat_identifier, {
      participants: chat.participant_handles,
      display_name: chat.display_name,
    });
  }
  
  return new Map(); // We'll populate this from ES + iMessage join
}

// ============================================================
// Migration Logic
// ============================================================

async function main() {
  console.log('\n========================================');
  console.log('  People Graph & Chat Graph Migration');
  console.log('========================================\n');
  
  // Check prerequisites
  if (!existsSync(IMESSAGE_DB_PATH)) {
    log('Migration', `iMessage database not found at ${IMESSAGE_DB_PATH}`, 'error');
    process.exit(1);
  }
  
  // Ensure data directory exists
  if (!existsSync('./data')) {
    mkdirSync('./data', { recursive: true });
  }
  
  // ============================================================
  // PHASE 1: Setup
  // ============================================================
  
  log('Phase 1', 'Setting up databases...', 'info');
  
  // Initialize People Graph SQLite database
  const peopleGraph = getPeopleGraph(PEOPLE_DB_PATH);
  const chatGraph = getChatGraph(PEOPLE_DB_PATH);
  
  // Create tables using Drizzle
  const sqlite = new Database(PEOPLE_DB_PATH);
  const db = drizzle(sqlite, { schema });
  
  // Create tables if they don't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      notes TEXT,
      is_owner INTEGER DEFAULT 0,
      auto_created INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS handles (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      handle TEXT NOT NULL,
      handle_normalized TEXT NOT NULL,
      type TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS aliases (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      alias_lower TEXT NOT NULL,
      is_primary INTEGER DEFAULT 0
    );
    
    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      from_person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      to_person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS person_attributes (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      imessage_id TEXT NOT NULL UNIQUE,
      display_name TEXT,
      is_group_chat INTEGER DEFAULT 0,
      notes TEXT,
      auto_created INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS chat_aliases (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      alias_lower TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS chat_participants (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      joined_at TEXT,
      left_at TEXT
    );
    
    -- Indexes
    CREATE INDEX IF NOT EXISTS people_owner_idx ON people(is_owner);
    CREATE INDEX IF NOT EXISTS handles_person_idx ON handles(person_id);
    CREATE UNIQUE INDEX IF NOT EXISTS handles_normalized_idx ON handles(handle_normalized);
    CREATE INDEX IF NOT EXISTS aliases_person_idx ON aliases(person_id);
    CREATE INDEX IF NOT EXISTS aliases_alias_lower_idx ON aliases(alias_lower);
    CREATE INDEX IF NOT EXISTS rel_from_idx ON relationships(from_person_id);
    CREATE INDEX IF NOT EXISTS rel_to_idx ON relationships(to_person_id);
    CREATE UNIQUE INDEX IF NOT EXISTS rel_unique ON relationships(from_person_id, to_person_id, type);
    CREATE INDEX IF NOT EXISTS attrs_person_idx ON person_attributes(person_id);
    CREATE UNIQUE INDEX IF NOT EXISTS attrs_unique ON person_attributes(person_id, key);
    CREATE UNIQUE INDEX IF NOT EXISTS chats_imessage_idx ON chats(imessage_id);
    CREATE INDEX IF NOT EXISTS chat_aliases_chat_idx ON chat_aliases(chat_id);
    CREATE INDEX IF NOT EXISTS chat_aliases_alias_lower_idx ON chat_aliases(alias_lower);
    CREATE INDEX IF NOT EXISTS chat_parts_chat_idx ON chat_participants(chat_id);
    CREATE INDEX IF NOT EXISTS chat_parts_person_idx ON chat_participants(person_id);
    CREATE UNIQUE INDEX IF NOT EXISTS chat_parts_unique ON chat_participants(chat_id, person_id);
  `);
  
  sqlite.pragma('foreign_keys = ON');
  
  log('Phase 1', 'SQLite database initialized', 'success');
  
  // Update ES mapping
  const es = getElasticsearchDB();
  try {
    await es.updateMapping(PEOPLE_GRAPH_FIELDS_MAPPING);
    log('Phase 1', 'Elasticsearch mapping updated', 'success');
  } catch (err) {
    log('Phase 1', `ES mapping update failed (may already exist): ${err}`, 'warn');
  }
  
  // ============================================================
  // PHASE 2: Detect Owner
  // ============================================================
  
  log('Phase 2', 'Detecting owner handles...', 'info');
  
  const imessageDb = new Database(IMESSAGE_DB_PATH, { readonly: true });
  const ownerHandles = readOwnerHandles(imessageDb);
  
  if (ownerHandles.length === 0) {
    log('Phase 2', 'No owner handles found - cannot determine "Me"', 'error');
    process.exit(1);
  }
  
  log('Phase 2', `Found ${ownerHandles.length} owner handles`, 'info');
  
  // Create owner person
  const ownerId = await peopleGraph.createOwner(ownerHandles, 'Me');
  log('Phase 2', `Created owner person: ${ownerId}`, 'success');
  
  await peopleGraph.initialize();
  await chatGraph.initialize();
  
  // ============================================================
  // PHASE 3: Build People & Chat Graphs
  // ============================================================
  
  log('Phase 3', 'Building People and Chat graphs...', 'info');
  
  // Load contact resolver for display names
  const contactResolver = getContactResolver();
  contactResolver.load();
  
  // Read all chats
  const allChats = readAllChats(imessageDb);
  log('Phase 3', `Found ${allChats.length} chats`, 'info');
  
  const chatProgress = new ProgressBar('Chats', allChats.length);
  let chatCount = 0;
  let peopleCount = 0;
  
  for (const chat of allChats) {
    // Create chat entity
    const chatId = await chatGraph.resolveOrCreate(
      chat.chat_identifier,
      chat.display_name,
      chat.is_group
    );
    
    // Process participants
    const participantIds: string[] = [];
    
    for (const handle of chat.participant_handles) {
      const displayName = contactResolver.resolve(handle);
      const personId = await peopleGraph.resolveOrCreate(handle, displayName);
      participantIds.push(personId);
      
      if ((await peopleGraph.getPerson(personId))?.auto_created) {
        peopleCount++;
      }
    }
    
    // Link participants to chat
    await chatGraph.ensureParticipants(chatId, participantIds);
    
    chatCount++;
    chatProgress.update(chatCount);
  }
  
  chatProgress.complete();
  
  const totalPeople = await peopleGraph.count();
  const chatCounts = await chatGraph.count();
  
  log('Phase 3', `Created ${totalPeople} people, ${chatCounts.total} chats (${chatCounts.group} group, ${chatCounts.dm} DM)`, 'success');
  
  // ============================================================
  // PHASE 4: Update ES Documents
  // ============================================================
  
  log('Phase 4', 'Updating Elasticsearch documents...', 'info');
  
  // Get all document IDs from ES
  const docIds = await es.getAllDocumentIds();
  log('Phase 4', `Found ${docIds.length} documents to update`, 'info');
  
  // Build chat_identifier -> chat_id mapping
  const chatIdMap = new Map<string, string>();
  for (const chat of allChats) {
    const chatId = await chatGraph.resolveOrCreate(chat.chat_identifier, chat.display_name, chat.is_group);
    chatIdMap.set(chat.chat_identifier, chatId);
  }
  
  // Build chat_identifier -> participant_ids mapping
  const chatParticipantsMap = new Map<string, string[]>();
  for (const chat of allChats) {
    const participantIds: string[] = [];
    for (const handle of chat.participant_handles) {
      const personId = await peopleGraph.resolveOrCreate(handle, contactResolver.resolve(handle));
      participantIds.push(personId);
    }
    chatParticipantsMap.set(chat.chat_identifier, participantIds);
  }
  
  // Process documents in batches
  const updateProgress = new ProgressBar('ES Update', docIds.length);
  let updatedCount = 0;
  let skippedCount = 0;
  
  const batches: string[][] = [];
  for (let i = 0; i < docIds.length; i += BATCH_SIZE) {
    batches.push(docIds.slice(i, i + BATCH_SIZE));
  }
  
  for (const batch of batches) {
    const updates: Array<{ id: string; doc: Record<string, unknown> }> = [];
    
    for (const docId of batch) {
      // Get existing document
      const doc = await es.getDocument(docId);
      if (!doc) {
        skippedCount++;
        continue;
      }
      
      // Get chat UUID from chat_identifier (stored as chat_id in legacy)
      const chatUuid = chatIdMap.get(doc.chat_id);
      const participantIds = chatParticipantsMap.get(doc.chat_id) || [];
      
      // Resolve sender
      // The sender field contains the resolved name, we need to find the handle
      // For "Me", we use the owner ID
      let senderId: string;
      let senderHandle: string;
      
      if (doc.sender_is_me) {
        senderId = ownerId;
        senderHandle = ownerHandles[0] || 'me';
      } else {
        // Try to find handle from participants
        // This is imprecise since we only have the resolved name, not the handle
        // We'll match by name in the participants list
        const senderName = doc.sender;
        
        // Find handle that resolves to this name
        let foundHandle: string | null = null;
        const chat = allChats.find(c => c.chat_identifier === doc.chat_id);
        if (chat) {
          for (const h of chat.participant_handles) {
            if (contactResolver.resolve(h) === senderName) {
              foundHandle = h;
              break;
            }
          }
        }
        
        if (foundHandle) {
          senderId = await peopleGraph.resolveOrCreate(foundHandle, senderName);
          senderHandle = foundHandle;
        } else {
          // Fallback: create from name (not ideal but maintains data)
          senderId = await peopleGraph.resolveOrCreate(senderName, senderName);
          senderHandle = senderName;
        }
      }
      
      // Get participant handles from chat
      const chat = allChats.find(c => c.chat_identifier === doc.chat_id);
      const participantHandles = chat?.participant_handles || [];
      
      // Build update
      updates.push({
        id: docId,
        doc: {
          sender_id: senderId,
          sender_handle: senderHandle,
          is_from_owner: senderId === ownerId,
          graph_chat_id: chatUuid || null,
          chat_imessage_id: doc.chat_id,
          participant_ids: participantIds,
          participant_handles: participantHandles,
        },
      });
    }
    
    // Batch update
    if (updates.length > 0) {
      await es.batchUpdateDocuments(updates);
      updatedCount += updates.length;
    }
    
    updateProgress.update(updatedCount + skippedCount);
  }
  
  updateProgress.complete();
  
  log('Phase 4', `Updated ${updatedCount} documents, skipped ${skippedCount}`, 'success');
  
  // ============================================================
  // PHASE 5: Summary
  // ============================================================
  
  console.log('\n========================================');
  console.log('  Migration Complete!');
  console.log('========================================\n');
  console.log(`  People: ${totalPeople} (1 owner + ${totalPeople - 1} contacts)`);
  console.log(`  Chats: ${chatCounts.total} (${chatCounts.group} group + ${chatCounts.dm} DM)`);
  console.log(`  ES Docs Updated: ${updatedCount}`);
  console.log(`  Cost: $0.00 (embeddings preserved)`);
  console.log('\n');
  
  // Cleanup
  imessageDb.close();
  sqlite.close();
}

// Run migration
main().catch(err => {
  log('Migration', `Fatal error: ${err}`, 'error');
  console.error(err);
  process.exit(1);
});

