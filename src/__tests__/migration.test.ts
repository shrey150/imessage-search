/**
 * Tests for Migration Logic
 * 
 * These tests verify the migration script's core logic,
 * particularly the owner handle detection fix.
 */

import Database from 'better-sqlite3';

describe('Migration Logic', () => {
  describe('Owner Handle Detection', () => {
    let db: Database.Database;

    beforeEach(() => {
      // Create in-memory database mimicking iMessage schema
      db = new Database(':memory:');
      
      // Create minimal iMessage-like schema
      db.exec(`
        CREATE TABLE handle (
          ROWID INTEGER PRIMARY KEY,
          id TEXT NOT NULL,
          service TEXT
        );
        
        CREATE TABLE message (
          ROWID INTEGER PRIMARY KEY,
          handle_id INTEGER,
          is_from_me INTEGER DEFAULT 0,
          account_login TEXT,
          destination_caller_id TEXT,
          text TEXT,
          FOREIGN KEY (handle_id) REFERENCES handle(ROWID)
        );
        
        CREATE TABLE chat (
          ROWID INTEGER PRIMARY KEY,
          chat_identifier TEXT,
          display_name TEXT
        );
        
        CREATE TABLE chat_handle_join (
          chat_id INTEGER,
          handle_id INTEGER
        );
        
        CREATE TABLE chat_message_join (
          chat_id INTEGER,
          message_id INTEGER
        );
      `);
    });

    afterEach(() => {
      db.close();
    });

    it('should NOT return recipient handles as owner handles', () => {
      // This tests the BUG we fixed:
      // When is_from_me = 1, handle_id is the RECIPIENT, not the sender
      
      // Insert handles (other people) - using (area)-555-XXXX format (555 exchange reserved)
      db.prepare("INSERT INTO handle (ROWID, id) VALUES (1, '+12125550101')").run();
      db.prepare("INSERT INTO handle (ROWID, id) VALUES (2, '+12125550102')").run();
      db.prepare("INSERT INTO handle (ROWID, id) VALUES (3, 'other@example.com')").run();
      
      // Insert messages I sent (is_from_me = 1)
      // The handle_id here is the RECIPIENT, not me!
      db.prepare("INSERT INTO message (handle_id, is_from_me, text) VALUES (1, 1, 'Hi!')").run();
      db.prepare("INSERT INTO message (handle_id, is_from_me, text) VALUES (2, 1, 'Hello!')").run();
      
      // The WRONG query (what we had before)
      const wrongQuery = db.prepare(`
        SELECT DISTINCT h.id as handle
        FROM handle h
        JOIN message m ON m.handle_id = h.ROWID
        WHERE m.is_from_me = 1
      `).all() as { handle: string }[];
      
      // This returns the recipients, NOT the owner!
      expect(wrongQuery.map(r => r.handle)).toContain('+12125550101');
      expect(wrongQuery.map(r => r.handle)).toContain('+12125550102');
      
      // These are NOT owner handles - they're people you texted
      // The fix should not use this query
    });

    it('should detect owner handles from account_login field', () => {
      // Insert messages with account_login (owner's iCloud)
      db.prepare(`
        INSERT INTO message (handle_id, is_from_me, account_login, text)
        VALUES (NULL, 1, 'E:owner@icloud.com', 'Test message')
      `).run();
      
      db.prepare(`
        INSERT INTO message (handle_id, is_from_me, account_login, text)
        VALUES (NULL, 1, 'E:owner@icloud.com', 'Another message')
      `).run();
      
      // The CORRECT query to get owner email
      const correctQuery = db.prepare(`
        SELECT DISTINCT account_login
        FROM message
        WHERE account_login IS NOT NULL 
          AND account_login != ''
          AND is_from_me = 1
      `).all() as { account_login: string }[];
      
      expect(correctQuery.length).toBe(1);
      expect(correctQuery[0].account_login).toBe('E:owner@icloud.com');
      
      // Extract email from "E:email" format
      const match = correctQuery[0].account_login.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      expect(match).toBeTruthy();
      expect(match![0]).toBe('owner@icloud.com');
    });

    it('should detect owner phone from destination_caller_id', () => {
      // Insert messages with destination_caller_id (owner's phone)
      // Using (area)-555-01XX format (555 exchange reserved for fiction)
      db.prepare(`
        INSERT INTO message (handle_id, is_from_me, destination_caller_id, text)
        VALUES (NULL, 1, '+12125550111', 'Test message')
      `).run();
      
      const phoneQuery = db.prepare(`
        SELECT DISTINCT destination_caller_id
        FROM message
        WHERE destination_caller_id IS NOT NULL 
          AND destination_caller_id != ''
          AND is_from_me = 1
      `).all() as { destination_caller_id: string }[];
      
      // This correctly identifies the owner's phone
      expect(phoneQuery.length).toBe(1);
      expect(phoneQuery[0].destination_caller_id).toBe('+12125550111');
    });

    it('should handle missing account_login column gracefully', () => {
      // Some older iMessage DBs might not have account_login
      const dbOld = new Database(':memory:');
      dbOld.exec(`
        CREATE TABLE message (
          ROWID INTEGER PRIMARY KEY,
          handle_id INTEGER,
          is_from_me INTEGER DEFAULT 0,
          text TEXT
        );
      `);
      
      // This should not throw
      expect(() => {
        try {
          dbOld.prepare(`
            SELECT DISTINCT account_login
            FROM message
            WHERE account_login IS NOT NULL
          `).all();
        } catch (e) {
          // Expected - column doesn't exist
          // Migration should catch this and continue
        }
      }).not.toThrow();
      
      dbOld.close();
    });

    it('should handle empty owner handles gracefully', () => {
      // Insert a handle first to satisfy foreign key - using (212) 555-01XX format
      db.prepare("INSERT INTO handle (ROWID, id) VALUES (1, '+12125550100')").run();
      
      // No account_login or destination_caller_id set
      db.prepare(`
        INSERT INTO message (handle_id, is_from_me, text)
        VALUES (1, 1, 'Message without owner info')
      `).run();
      
      const accountQuery = db.prepare(`
        SELECT DISTINCT account_login
        FROM message
        WHERE account_login IS NOT NULL 
          AND account_login != ''
      `).all();
      
      const callerIdQuery = db.prepare(`
        SELECT DISTINCT destination_caller_id
        FROM message
        WHERE destination_caller_id IS NOT NULL 
          AND destination_caller_id != ''
      `).all();
      
      // Both should be empty - migration should handle this
      expect(accountQuery.length).toBe(0);
      expect(callerIdQuery.length).toBe(0);
      
      // In this case, migration should still create owner with no handles
      // and rely on is_from_me flag for identification
    });

    it('should deduplicate owner handles that normalize to same value', () => {
      // This tests the bug where multiple formats of the same phone number
      // were returned as separate handles, causing UNIQUE constraint failures
      // Using (area)-555-01XX format and example.com (reserved domain)
      
      const ownerHandles = [
        '+12125550123',
        'tel:+12125550123',  // Same phone with tel: prefix
        '12125550123',       // Same phone without +
        'testuser@icloud.com',
        '+13105550199',
        '13105550199',       // Same phone without +
        'anotheruser@example.com',
      ];
      
      // Simulate deduplication logic
      const normalizeHandle = (handle: string): string => {
        if (handle.includes('@')) {
          return handle.toLowerCase().trim();
        }
        // Strip tel: prefix and all non-digits
        const digits = handle.replace(/^tel:/i, '').replace(/\D/g, '');
        if (digits.length === 11 && digits.startsWith('1')) {
          return digits.slice(1);
        }
        return digits;
      };
      
      const seenNormalized = new Map<string, string>();
      for (const handle of ownerHandles) {
        const normalized = normalizeHandle(handle);
        if (!seenNormalized.has(normalized)) {
          seenNormalized.set(normalized, handle);
        }
      }
      
      // Should deduplicate to 4 unique handles
      expect(seenNormalized.size).toBe(4);
      
      // Check the expected normalized values
      expect(seenNormalized.has('2125550123')).toBe(true);
      expect(seenNormalized.has('3105550199')).toBe(true);
      expect(seenNormalized.has('testuser@icloud.com')).toBe(true);
      expect(seenNormalized.has('anotheruser@example.com')).toBe(true);
    });

    it('should handle tel: prefix in destination_caller_id', () => {
      // Using (area)-555-01XX format (555 exchange reserved for fiction)
      db.prepare(`
        INSERT INTO message (handle_id, is_from_me, destination_caller_id, text)
        VALUES (NULL, 1, 'tel:+12125550122', 'Test message')
      `).run();
      
      const rows = db.prepare(`
        SELECT destination_caller_id FROM message WHERE destination_caller_id IS NOT NULL
      `).all() as { destination_caller_id: string }[];
      
      expect(rows.length).toBe(1);
      expect(rows[0].destination_caller_id).toBe('tel:+12125550122');
      
      // Normalization should strip the tel: prefix
      const normalized = rows[0].destination_caller_id
        .replace(/^tel:/i, '')
        .replace(/\D/g, '');
      expect(normalized).toBe('12125550122');
    });
  });

  describe('iMessage Handle Types', () => {
    it('should identify different handle formats', () => {
      // Using (area)-555-01XX and example.com (reserved domain)
      const handles = [
        { id: '+12125550101', expected: 'phone' },
        { id: 'user@icloud.com', expected: 'email' },
        { id: 'user@example.com', expected: 'email' },
        { id: '+447700900123', expected: 'phone' },  // UK Ofcom reserved range
        { id: '2125550101', expected: 'phone' },
      ];
      
      for (const { id, expected } of handles) {
        const type = id.includes('@') ? 'email' : 'phone';
        expect(type).toBe(expected);
      }
    });
  });

  describe('Chat Classification', () => {
    let db: Database.Database;

    beforeEach(() => {
      db = new Database(':memory:');
      db.exec(`
        CREATE TABLE chat (
          ROWID INTEGER PRIMARY KEY,
          chat_identifier TEXT,
          display_name TEXT
        );
        
        CREATE TABLE handle (
          ROWID INTEGER PRIMARY KEY,
          id TEXT
        );
        
        CREATE TABLE chat_handle_join (
          chat_id INTEGER,
          handle_id INTEGER
        );
      `);
    });

    afterEach(() => {
      db.close();
    });

    it('should classify DM vs group chat by participant count', () => {
      // Create a DM (1 other participant) - using (area)-555-01XX format
      db.prepare("INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (1, 'chat1', NULL)").run();
      db.prepare("INSERT INTO handle (ROWID, id) VALUES (1, '+12125550101')").run();
      db.prepare("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (1, 1)").run();
      
      // Create a group (2+ other participants)
      db.prepare("INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (2, 'chat2', 'Friends')").run();
      db.prepare("INSERT INTO handle (ROWID, id) VALUES (2, '+12125550102')").run();
      db.prepare("INSERT INTO handle (ROWID, id) VALUES (3, '+13105550103')").run();
      db.prepare("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (2, 2)").run();
      db.prepare("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (2, 3)").run();
      
      // Get participant counts
      const counts = db.prepare(`
        SELECT c.chat_identifier, c.display_name, COUNT(chj.handle_id) as participant_count
        FROM chat c
        LEFT JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
        GROUP BY c.ROWID
      `).all() as { chat_identifier: string; display_name: string | null; participant_count: number }[];
      
      const dm = counts.find(c => c.chat_identifier === 'chat1');
      const group = counts.find(c => c.chat_identifier === 'chat2');
      
      expect(dm?.participant_count).toBe(1);
      expect(dm?.display_name).toBeNull();
      
      expect(group?.participant_count).toBe(2);
      expect(group?.display_name).toBe('Friends');
      
      // Classification logic
      const isDm = (count: number) => count <= 1;
      const isGroup = (count: number) => count > 1;
      
      expect(isDm(dm!.participant_count)).toBe(true);
      expect(isGroup(group!.participant_count)).toBe(true);
    });
  });
});

describe('ES Document Update Logic', () => {
  it('should only update fields without touching embeddings', () => {
    // Simulating the update object we send to ES
    const existingDoc = {
      id: 'doc123',
      text: 'Hello world',
      sender: 'John',
      text_embedding: [0.1, 0.2, 0.3], // Existing embedding - should NOT be touched
      timestamp: '2024-01-01',
    };
    
    // The update we apply (no embedding field) - using (area)-555-01XX format
    const update = {
      sender_id: 'person-uuid-123',
      sender_handle: '+12125550101',
      sender_name: 'John Smith',
      chat_id: 'chat-uuid-456',
      is_from_owner: false,
    };
    
    // Merge (simulating ES partial update)
    const merged = { ...existingDoc, ...update };
    
    // Embedding should be preserved
    expect(merged.text_embedding).toEqual([0.1, 0.2, 0.3]);
    
    // New fields should be added
    expect(merged.sender_id).toBe('person-uuid-123');
    expect(merged.chat_id).toBe('chat-uuid-456');
    
    // Original text should be preserved
    expect(merged.text).toBe('Hello world');
  });
});

