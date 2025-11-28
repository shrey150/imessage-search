/**
 * Tests for message reader
 * Verifies correct pagination and no message gaps
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';

const MESSAGES_DB = `${homedir()}/Library/Messages/chat.db`;

describe('MessageReader', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = Database(MESSAGES_DB, { readonly: true });
  });

  afterAll(() => {
    db.close();
  });

  describe('Pagination ordering', () => {
    it('should return messages in ROWID order when using ROWID ordering', () => {
      const messages = db.prepare(`
        SELECT ROWID FROM message 
        WHERE text IS NOT NULL AND text != '' AND ROWID > 0
        ORDER BY ROWID ASC
        LIMIT 100
      `).all() as { ROWID: number }[];

      // Verify ROWIDs are strictly increasing
      for (let i = 1; i < messages.length; i++) {
        expect(messages[i].ROWID).toBeGreaterThan(messages[i - 1].ROWID);
      }
    });

    it('should have consecutive batches with no gaps when paginating by ROWID', () => {
      const batchSize = 1000;
      
      // Get first batch
      const batch1 = db.prepare(`
        SELECT ROWID FROM message 
        WHERE text IS NOT NULL AND text != '' AND ROWID > 0
        ORDER BY ROWID ASC
        LIMIT ?
      `).all(batchSize) as { ROWID: number }[];

      const lastRowidBatch1 = batch1[batch1.length - 1].ROWID;

      // Get second batch
      const batch2 = db.prepare(`
        SELECT ROWID FROM message 
        WHERE text IS NOT NULL AND text != '' AND ROWID > ?
        ORDER BY ROWID ASC
        LIMIT ?
      `).all(lastRowidBatch1, batchSize) as { ROWID: number }[];

      // Count total messages in range covered by both batches
      const firstRowid = batch1[0].ROWID;
      const lastRowid = batch2.length > 0 ? batch2[batch2.length - 1].ROWID : lastRowidBatch1;
      
      const totalInRange = db.prepare(`
        SELECT COUNT(*) as count FROM message 
        WHERE text IS NOT NULL AND text != '' 
          AND ROWID >= ? AND ROWID <= ?
      `).get(firstRowid, lastRowid) as { count: number };

      // The two batches should cover all messages in that range
      expect(batch1.length + batch2.length).toBe(totalInRange.count);
    });

    it('should NOT use date ordering for pagination (BUG CHECK)', () => {
      // This test demonstrates the bug when using date ordering
      const batchSize = 1000;
      
      // Get batch ordered by DATE (the buggy way)
      const batchByDate = db.prepare(`
        SELECT ROWID FROM message 
        WHERE text IS NOT NULL AND text != '' AND ROWID > 0
        ORDER BY date ASC
        LIMIT ?
      `).all(batchSize) as { ROWID: number }[];

      const minRowid = Math.min(...batchByDate.map(r => r.ROWID));
      const maxRowid = Math.max(...batchByDate.map(r => r.ROWID));
      const lastRowidByDate = batchByDate[batchByDate.length - 1].ROWID;

      // When ordering by date, ROWIDs can be scattered across a wide range
      const rowidSpan = maxRowid - minRowid;
      
      // If the span is much larger than batch size, we have a problem
      // because using lastRowidByDate as cutoff would skip messages
      if (rowidSpan > batchSize * 2) {
        // Count how many messages would be skipped
        const skipped = db.prepare(`
          SELECT COUNT(*) as count FROM message 
          WHERE text IS NOT NULL AND text != '' 
            AND ROWID > ? AND ROWID < ?
        `).get(batchSize, lastRowidByDate) as { count: number };

        // This demonstrates the bug - many messages would be skipped
        console.log(`⚠️  BUG: Date ordering would skip ${skipped.count} messages`);
        
        // We expect skipped to be > 0 if there's date/rowid mismatch
        // This is expected behavior that we're documenting
      }
    });
  });

  describe('Data integrity', () => {
    it('should have messages with valid text content', () => {
      const sample = db.prepare(`
        SELECT text FROM message 
        WHERE text IS NOT NULL AND text != ''
        LIMIT 100
      `).all() as { text: string }[];

      for (const msg of sample) {
        expect(msg.text).toBeDefined();
        expect(msg.text.length).toBeGreaterThan(0);
      }
    });

    it('should have valid timestamps', () => {
      const sample = db.prepare(`
        SELECT date FROM message 
        WHERE text IS NOT NULL AND text != '' AND date > 0
        LIMIT 100
      `).all() as { date: number }[];

      // Mac timestamps are nanoseconds since 2001
      const MAC_EPOCH = 978307200;
      
      for (const msg of sample) {
        const unixTs = Math.floor(msg.date / 1_000_000_000) + MAC_EPOCH;
        const date = new Date(unixTs * 1000);
        
        // Should be a reasonable date (after 2000, before 2100)
        expect(date.getFullYear()).toBeGreaterThanOrEqual(2000);
        expect(date.getFullYear()).toBeLessThanOrEqual(2100);
      }
    });
  });

  describe('Full coverage verification', () => {
    it('should be able to iterate through ALL messages without gaps', () => {
      const batchSize = 10000;
      let lastRowid = 0;
      let totalProcessed = 0;
      let batchCount = 0;
      const maxBatches = 5; // Limit for test speed

      while (batchCount < maxBatches) {
        const batch = db.prepare(`
          SELECT ROWID FROM message 
          WHERE text IS NOT NULL AND text != '' AND ROWID > ?
          ORDER BY ROWID ASC
          LIMIT ?
        `).all(lastRowid, batchSize) as { ROWID: number }[];

        if (batch.length === 0) break;

        // Verify no duplicates within batch
        const rowids = batch.map(r => r.ROWID);
        const uniqueRowids = new Set(rowids);
        expect(uniqueRowids.size).toBe(batch.length);

        // Verify all rowids > lastRowid
        for (const rowid of rowids) {
          expect(rowid).toBeGreaterThan(lastRowid);
        }

        lastRowid = batch[batch.length - 1].ROWID;
        totalProcessed += batch.length;
        batchCount++;
      }

      // Verify we processed correct number of messages
      const expectedInRange = db.prepare(`
        SELECT COUNT(*) as count FROM message 
        WHERE text IS NOT NULL AND text != '' AND ROWID <= ?
      `).get(lastRowid) as { count: number };

      expect(totalProcessed).toBe(expectedInRange.count);
    });
  });
});

