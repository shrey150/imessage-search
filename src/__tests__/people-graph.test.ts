/**
 * Tests for People Graph
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'crypto';
import * as schema from '../db/schema.js';
import { normalizeHandle, inferHandleType } from '../db/people-graph.js';

// ============================================================
// HANDLE NORMALIZATION TESTS
// ============================================================

describe('Handle Normalization', () => {
  describe('normalizeHandle', () => {
    it('should normalize US phone numbers with country code', () => {
      expect(normalizeHandle('+1 (415) 555-1234')).toBe('4155551234');
      expect(normalizeHandle('+14155551234')).toBe('4155551234');
      expect(normalizeHandle('1-415-555-1234')).toBe('4155551234');
    });

    it('should normalize phone numbers without country code', () => {
      expect(normalizeHandle('(415) 555-1234')).toBe('4155551234');
      expect(normalizeHandle('415-555-1234')).toBe('4155551234');
      expect(normalizeHandle('4155551234')).toBe('4155551234');
    });

    it('should handle international phone numbers', () => {
      expect(normalizeHandle('+44 20 7946 0958')).toBe('442079460958');
      expect(normalizeHandle('+86 10 1234 5678')).toBe('861012345678');
    });

    it('should normalize email addresses to lowercase', () => {
      expect(normalizeHandle('User@Example.COM')).toBe('user@example.com');
      expect(normalizeHandle('JOHN.DOE@gmail.com')).toBe('john.doe@gmail.com');
    });

    it('should trim whitespace from emails', () => {
      expect(normalizeHandle('  user@example.com  ')).toBe('user@example.com');
    });

    it('should handle Apple IDs (emails)', () => {
      expect(normalizeHandle('user@icloud.com')).toBe('user@icloud.com');
      expect(normalizeHandle('user@me.com')).toBe('user@me.com');
    });

    it('should strip tel: prefix from phone numbers', () => {
      // Using (area code)-555-XXXX format (555 exchange is reserved for fiction)
      expect(normalizeHandle('tel:+12125550101')).toBe('2125550101');
      expect(normalizeHandle('tel:+13105550199')).toBe('3105550199');
    });

    it('should normalize multiple formats of same number to same value', () => {
      // These should ALL normalize to the same value
      // Using (212) 555-0123 format (555 exchange is reserved for fiction)
      const formats = [
        '+12125550123',
        'tel:+12125550123',
        '12125550123',
        '(212) 555-0123',
        '212-555-0123',
        '2125550123',
      ];
      
      const normalized = formats.map(f => normalizeHandle(f));
      const unique = new Set(normalized);
      
      // All should normalize to same value
      expect(unique.size).toBe(1);
      expect(normalized[0]).toBe('2125550123');
    });
  });

  describe('inferHandleType', () => {
    it('should detect email addresses', () => {
      expect(inferHandleType('user@example.com')).toBe('email');
      expect(inferHandleType('john.doe+tag@gmail.com')).toBe('email');
    });

    it('should detect iCloud addresses as appleid', () => {
      // icloud.com addresses are classified as 'appleid'
      expect(inferHandleType('user@icloud.com')).toBe('appleid');
      expect(inferHandleType('user@me.com')).toBe('email'); // me.com is email
    });

    it('should detect phone numbers', () => {
      expect(inferHandleType('+14155551234')).toBe('phone');
      expect(inferHandleType('4155551234')).toBe('phone');
      expect(inferHandleType('(415) 555-1234')).toBe('phone');
    });

    it('should classify short strings as phone', () => {
      // Could be short codes or partial numbers
      expect(inferHandleType('12345')).toBe('phone');
    });
  });

  describe('edge cases', () => {
    it('should return empty string for non-phone non-email (e.g. "Me")', () => {
      // "Me" has no digits and no @, so normalizes to empty
      // This is expected - resolution should skip empty handle lookups
      const normalized = normalizeHandle('Me');
      expect(normalized).toBe('');
    });
  });
});

// ============================================================
// PEOPLE GRAPH DATABASE TESTS
// ============================================================

describe('People Graph Database Operations', () => {
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
      
      CREATE TABLE IF NOT EXISTS handles (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        handle TEXT NOT NULL,
        handle_normalized TEXT NOT NULL,
        type TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS handles_normalized_idx ON handles(handle_normalized);
      CREATE INDEX IF NOT EXISTS handles_person_idx ON handles(person_id);
      
      CREATE TABLE IF NOT EXISTS aliases (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        alias TEXT NOT NULL,
        alias_lower TEXT NOT NULL,
        is_primary INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS aliases_person_idx ON aliases(person_id);
      CREATE INDEX IF NOT EXISTS aliases_alias_lower_idx ON aliases(alias_lower);
      
      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        from_person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        to_person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rel_from_idx ON relationships(from_person_id);
      CREATE INDEX IF NOT EXISTS rel_to_idx ON relationships(to_person_id);
      
      CREATE TABLE IF NOT EXISTS person_attributes (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS attrs_person_idx ON person_attributes(person_id);
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('Person CRUD', () => {
    it('should create a person', () => {
      const id = randomUUID();
      const now = new Date().toISOString();
      
      sqlite.prepare(`
        INSERT INTO people (id, name, notes, is_owner, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, 'John Doe', null, 0, 1, now, now);
      
      const person = sqlite.prepare('SELECT * FROM people WHERE id = ?').get(id) as any;
      
      expect(person).toBeDefined();
      expect(person.name).toBe('John Doe');
      expect(person.is_owner).toBe(0);
      expect(person.auto_created).toBe(1);
    });

    it('should create owner person with is_owner flag', () => {
      const id = randomUUID();
      const now = new Date().toISOString();
      
      sqlite.prepare(`
        INSERT INTO people (id, name, notes, is_owner, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, 'Me', null, 1, 0, now, now);
      
      const owner = sqlite.prepare('SELECT * FROM people WHERE is_owner = 1').get() as any;
      
      expect(owner).toBeDefined();
      expect(owner.name).toBe('Me');
      expect(owner.is_owner).toBe(1);
    });

    it('should update person notes', () => {
      const id = randomUUID();
      const now = new Date().toISOString();
      
      sqlite.prepare(`
        INSERT INTO people (id, name, notes, is_owner, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, 'John Doe', null, 0, 1, now, now);
      
      sqlite.prepare('UPDATE people SET notes = ? WHERE id = ?').run('Works at Stripe', id);
      
      const person = sqlite.prepare('SELECT * FROM people WHERE id = ?').get(id) as any;
      expect(person.notes).toBe('Works at Stripe');
    });
  });

  describe('Handle Operations', () => {
    it('should add handle to person', () => {
      const personId = randomUUID();
      const handleId = randomUUID();
      const now = new Date().toISOString();
      
      sqlite.prepare(`
        INSERT INTO people (id, name, is_owner, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(personId, 'John Doe', 0, 1, now, now);
      
      sqlite.prepare(`
        INSERT INTO handles (id, person_id, handle, handle_normalized, type)
        VALUES (?, ?, ?, ?, ?)
      `).run(handleId, personId, '+1 (415) 555-1234', '4155551234', 'phone');
      
      const handles = sqlite.prepare('SELECT * FROM handles WHERE person_id = ?').all(personId) as any[];
      
      expect(handles.length).toBe(1);
      expect(handles[0].handle).toBe('+1 (415) 555-1234');
      expect(handles[0].handle_normalized).toBe('4155551234');
      expect(handles[0].type).toBe('phone');
    });

    it('should find person by normalized handle', () => {
      const personId = randomUUID();
      const handleId = randomUUID();
      const now = new Date().toISOString();
      
      sqlite.prepare(`
        INSERT INTO people (id, name, is_owner, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(personId, 'John Doe', 0, 1, now, now);
      
      sqlite.prepare(`
        INSERT INTO handles (id, person_id, handle, handle_normalized, type)
        VALUES (?, ?, ?, ?, ?)
      `).run(handleId, personId, '+1 (415) 555-1234', '4155551234', 'phone');
      
      // Should find with different formatting
      const found = sqlite.prepare(`
        SELECT p.* FROM people p
        JOIN handles h ON h.person_id = p.id
        WHERE h.handle_normalized = ?
      `).get('4155551234') as any;
      
      expect(found).toBeDefined();
      expect(found.id).toBe(personId);
      expect(found.name).toBe('John Doe');
    });

    it('should enforce unique normalized handles', () => {
      const person1Id = randomUUID();
      const person2Id = randomUUID();
      const now = new Date().toISOString();
      
      sqlite.prepare(`
        INSERT INTO people (id, name, is_owner, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(person1Id, 'John', 0, 1, now, now);
      
      sqlite.prepare(`
        INSERT INTO people (id, name, is_owner, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(person2Id, 'Jane', 0, 1, now, now);
      
      sqlite.prepare(`
        INSERT INTO handles (id, person_id, handle, handle_normalized, type)
        VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), person1Id, '+14155551234', '4155551234', 'phone');
      
      // Should fail - same normalized handle
      expect(() => {
        sqlite.prepare(`
          INSERT INTO handles (id, person_id, handle, handle_normalized, type)
          VALUES (?, ?, ?, ?, ?)
        `).run(randomUUID(), person2Id, '(415) 555-1234', '4155551234', 'phone');
      }).toThrow();
    });
  });

  describe('Alias Operations', () => {
    it('should add alias to person', () => {
      const personId = randomUUID();
      const aliasId = randomUUID();
      const now = new Date().toISOString();
      
      sqlite.prepare(`
        INSERT INTO people (id, name, is_owner, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(personId, 'John Doe', 0, 1, now, now);
      
      sqlite.prepare(`
        INSERT INTO aliases (id, person_id, alias, alias_lower, is_primary)
        VALUES (?, ?, ?, ?, ?)
      `).run(aliasId, personId, 'JD', 'jd', 0);
      
      const aliases = sqlite.prepare('SELECT * FROM aliases WHERE person_id = ?').all(personId) as any[];
      
      expect(aliases.length).toBe(1);
      expect(aliases[0].alias).toBe('JD');
      expect(aliases[0].alias_lower).toBe('jd');
    });

    it('should find person by alias (case-insensitive)', () => {
      const personId = randomUUID();
      const now = new Date().toISOString();
      
      sqlite.prepare(`
        INSERT INTO people (id, name, is_owner, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(personId, 'John Doe', 0, 1, now, now);
      
      sqlite.prepare(`
        INSERT INTO aliases (id, person_id, alias, alias_lower, is_primary)
        VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), personId, 'Johnny', 'johnny', 0);
      
      // Should find with different case
      const found = sqlite.prepare(`
        SELECT p.* FROM people p
        JOIN aliases a ON a.person_id = p.id
        WHERE a.alias_lower = ?
      `).get('johnny') as any;
      
      expect(found).toBeDefined();
      expect(found.id).toBe(personId);
    });
  });

  describe('Relationship Operations', () => {
    it('should create relationship between people', () => {
      const person1Id = randomUUID();
      const person2Id = randomUUID();
      const now = new Date().toISOString();
      
      sqlite.prepare(`
        INSERT INTO people (id, name, is_owner, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(person1Id, 'Me', 1, 0, now, now);
      
      sqlite.prepare(`
        INSERT INTO people (id, name, is_owner, auto_created, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(person2Id, 'John', 0, 1, now, now);
      
      sqlite.prepare(`
        INSERT INTO relationships (id, from_person_id, to_person_id, type, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), person1Id, person2Id, 'friend', 'Met at college', now);
      
      const rels = sqlite.prepare('SELECT * FROM relationships WHERE from_person_id = ?').all(person1Id) as any[];
      
      expect(rels.length).toBe(1);
      expect(rels[0].to_person_id).toBe(person2Id);
      expect(rels[0].type).toBe('friend');
      expect(rels[0].description).toBe('Met at college');
    });
  });
});

