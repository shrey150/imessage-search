/**
 * Tests for Chat Graph
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'crypto';
import * as schema from '../db/schema.js';

describe('Chat Graph Database Operations', () => {
  let db: ReturnType<typeof drizzle>;
  let sqlite: Database.Database;

  beforeEach(() => {
    // Create in-memory SQLite database for each test
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema });

    // Create tables manually for in-memory DB
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
      
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        imessage_id TEXT NOT NULL,
        display_name TEXT,
        is_group_chat INTEGER DEFAULT 0,
        notes TEXT,
        auto_created INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS chats_imessage_idx ON chats(imessage_id);
      
      CREATE TABLE IF NOT EXISTS chat_aliases (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        alias TEXT NOT NULL,
        alias_lower TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chat_aliases_chat_idx ON chat_aliases(chat_id);
      CREATE INDEX IF NOT EXISTS chat_aliases_alias_lower_idx ON chat_aliases(alias_lower);
      
      CREATE TABLE IF NOT EXISTS chat_participants (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        joined_at TEXT,
        left_at TEXT
      );
      CREATE INDEX IF NOT EXISTS chat_parts_chat_idx ON chat_participants(chat_id);
      CREATE INDEX IF NOT EXISTS chat_parts_person_idx ON chat_participants(person_id);
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('Chat CRUD', () => {
    it('should create a DM chat', () => {
      const id = randomUUID();
      const now = new Date().toISOString();
      
      sqlite.prepare(`
        INSERT INTO chats (id, imessage_id, display_name, is_group_chat, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, 'chat123456', null, 0, 1, now, now);
      
      const chat = sqlite.prepare('SELECT * FROM chats WHERE id = ?').get(id) as any;
      
      expect(chat).toBeDefined();
      expect(chat.imessage_id).toBe('chat123456');
      expect(chat.is_group_chat).toBe(0);
      expect(chat.display_name).toBeNull();
    });

    it('should create a group chat with display name', () => {
      const id = randomUUID();
      const now = new Date().toISOString();
      
      sqlite.prepare(`
        INSERT INTO chats (id, imessage_id, display_name, is_group_chat, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, 'chat789', 'DDS Crew', 1, 1, now, now);
      
      const chat = sqlite.prepare('SELECT * FROM chats WHERE id = ?').get(id) as any;
      
      expect(chat).toBeDefined();
      expect(chat.display_name).toBe('DDS Crew');
      expect(chat.is_group_chat).toBe(1);
    });

    it('should enforce unique imessage_id', () => {
      const now = new Date().toISOString();
      
      sqlite.prepare(`
        INSERT INTO chats (id, imessage_id, display_name, is_group_chat, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), 'chat123', null, 0, 1, now, now);
      
      // Should fail - same imessage_id
      expect(() => {
        sqlite.prepare(`
          INSERT INTO chats (id, imessage_id, display_name, is_group_chat, auto_created, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), 'chat123', null, 0, 1, now, now);
      }).toThrow();
    });

    it('should find chat by imessage_id', () => {
      const chatId = randomUUID();
      const now = new Date().toISOString();
      
      sqlite.prepare(`
        INSERT INTO chats (id, imessage_id, display_name, is_group_chat, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(chatId, 'iMessage;+;chat;guid123', 'My Group', 1, 1, now, now);
      
      const found = sqlite.prepare('SELECT * FROM chats WHERE imessage_id = ?').get('iMessage;+;chat;guid123') as any;
      
      expect(found).toBeDefined();
      expect(found.id).toBe(chatId);
      expect(found.display_name).toBe('My Group');
    });
  });

  describe('Chat Alias Operations', () => {
    it('should add alias to chat', () => {
      const chatId = randomUUID();
      const aliasId = randomUUID();
      const now = new Date().toISOString();
      
      sqlite.prepare(`
        INSERT INTO chats (id, imessage_id, display_name, is_group_chat, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(chatId, 'chat123', 'Data Driven Squad', 1, 1, now, now);
      
      sqlite.prepare(`
        INSERT INTO chat_aliases (id, chat_id, alias, alias_lower)
        VALUES (?, ?, ?, ?)
      `).run(aliasId, chatId, 'DDS', 'dds');
      
      const aliases = sqlite.prepare('SELECT * FROM chat_aliases WHERE chat_id = ?').all(chatId) as any[];
      
      expect(aliases.length).toBe(1);
      expect(aliases[0].alias).toBe('DDS');
      expect(aliases[0].alias_lower).toBe('dds');
    });

    it('should find chat by alias (case-insensitive)', () => {
      const chatId = randomUUID();
      const now = new Date().toISOString();
      
      sqlite.prepare(`
        INSERT INTO chats (id, imessage_id, display_name, is_group_chat, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(chatId, 'chat123', 'Data Driven Squad', 1, 1, now, now);
      
      sqlite.prepare(`
        INSERT INTO chat_aliases (id, chat_id, alias, alias_lower)
        VALUES (?, ?, ?, ?)
      `).run(randomUUID(), chatId, 'DDS', 'dds');
      
      // Should find with different case
      const found = sqlite.prepare(`
        SELECT c.* FROM chats c
        JOIN chat_aliases ca ON ca.chat_id = c.id
        WHERE ca.alias_lower = ?
      `).get('dds') as any;
      
      expect(found).toBeDefined();
      expect(found.id).toBe(chatId);
      expect(found.display_name).toBe('Data Driven Squad');
    });
  });

  describe('Chat Participant Operations', () => {
    it('should add participants to chat', () => {
      const chatId = randomUUID();
      const person1Id = randomUUID();
      const person2Id = randomUUID();
      const now = new Date().toISOString();
      
      // Create chat
      sqlite.prepare(`
        INSERT INTO chats (id, imessage_id, display_name, is_group_chat, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(chatId, 'chat123', 'Group Chat', 1, 1, now, now);
      
      // Create people
      sqlite.prepare(`
        INSERT INTO people (id, name, is_owner, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(person1Id, 'Me', 1, 0, now, now);
      
      sqlite.prepare(`
        INSERT INTO people (id, name, is_owner, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(person2Id, 'John', 0, 1, now, now);
      
      // Add participants
      sqlite.prepare(`
        INSERT INTO chat_participants (id, chat_id, person_id, joined_at, left_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), chatId, person1Id, null, null);
      
      sqlite.prepare(`
        INSERT INTO chat_participants (id, chat_id, person_id, joined_at, left_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), chatId, person2Id, null, null);
      
      const participants = sqlite.prepare(`
        SELECT p.name, cp.joined_at, cp.left_at
        FROM chat_participants cp
        JOIN people p ON p.id = cp.person_id
        WHERE cp.chat_id = ?
      `).all(chatId) as any[];
      
      expect(participants.length).toBe(2);
      expect(participants.map(p => p.name).sort()).toEqual(['John', 'Me']);
    });

    it('should find chats by person', () => {
      const chat1Id = randomUUID();
      const chat2Id = randomUUID();
      const personId = randomUUID();
      const now = new Date().toISOString();
      
      // Create person
      sqlite.prepare(`
        INSERT INTO people (id, name, is_owner, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(personId, 'John', 0, 1, now, now);
      
      // Create chats
      sqlite.prepare(`
        INSERT INTO chats (id, imessage_id, display_name, is_group_chat, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(chat1Id, 'chat1', 'Group A', 1, 1, now, now);
      
      sqlite.prepare(`
        INSERT INTO chats (id, imessage_id, display_name, is_group_chat, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(chat2Id, 'chat2', 'Group B', 1, 1, now, now);
      
      // Add person to both chats
      sqlite.prepare(`
        INSERT INTO chat_participants (id, chat_id, person_id, joined_at, left_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), chat1Id, personId, null, null);
      
      sqlite.prepare(`
        INSERT INTO chat_participants (id, chat_id, person_id, joined_at, left_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), chat2Id, personId, null, null);
      
      // Find chats for person
      const chats = sqlite.prepare(`
        SELECT c.* FROM chats c
        JOIN chat_participants cp ON cp.chat_id = c.id
        WHERE cp.person_id = ?
      `).all(personId) as any[];
      
      expect(chats.length).toBe(2);
      expect(chats.map(c => c.display_name).sort()).toEqual(['Group A', 'Group B']);
    });

    it('should track when participant left', () => {
      const chatId = randomUUID();
      const personId = randomUUID();
      const now = new Date().toISOString();
      const leftAt = new Date(Date.now() + 86400000).toISOString(); // Tomorrow
      
      // Create chat and person
      sqlite.prepare(`
        INSERT INTO chats (id, imessage_id, display_name, is_group_chat, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(chatId, 'chat123', 'Group', 1, 1, now, now);
      
      sqlite.prepare(`
        INSERT INTO people (id, name, is_owner, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(personId, 'John', 0, 1, now, now);
      
      // Add participant with left_at
      sqlite.prepare(`
        INSERT INTO chat_participants (id, chat_id, person_id, joined_at, left_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), chatId, personId, now, leftAt);
      
      const participant = sqlite.prepare(`
        SELECT * FROM chat_participants
        WHERE chat_id = ? AND person_id = ?
      `).get(chatId, personId) as any;
      
      expect(participant.left_at).toBe(leftAt);
    });
  });

  describe('Group vs DM Classification', () => {
    it('should correctly identify group chats', () => {
      const now = new Date().toISOString();
      
      // Create a group chat (3+ participants)
      const groupId = randomUUID();
      sqlite.prepare(`
        INSERT INTO chats (id, imessage_id, display_name, is_group_chat, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(groupId, 'group1', 'Friends', 1, 1, now, now);
      
      // Create a DM (2 participants)
      const dmId = randomUUID();
      sqlite.prepare(`
        INSERT INTO chats (id, imessage_id, display_name, is_group_chat, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(dmId, 'dm1', null, 0, 1, now, now);
      
      // Query group chats
      const groups = sqlite.prepare('SELECT * FROM chats WHERE is_group_chat = 1').all() as any[];
      expect(groups.length).toBe(1);
      expect(groups[0].display_name).toBe('Friends');
      
      // Query DMs
      const dms = sqlite.prepare('SELECT * FROM chats WHERE is_group_chat = 0').all() as any[];
      expect(dms.length).toBe(1);
      expect(dms[0].display_name).toBeNull();
    });
  });
});

