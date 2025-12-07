/**
 * Integration tests for People Graph
 * 
 * These tests run against the REAL SQLite database.
 * Skip if database doesn't exist.
 */

import { existsSync } from 'fs';
import { PeopleGraph } from '../../db/people-graph.js';

const PEOPLE_DB_PATH = './data/people.db';
const DB_EXISTS = existsSync(PEOPLE_DB_PATH);

// Skip all tests if DB doesn't exist
const describeIfDb = DB_EXISTS ? describe : describe.skip;

describeIfDb('People Graph Integration (requires real DB)', () => {
  let peopleGraph: PeopleGraph;

  beforeAll(async () => {
    peopleGraph = new PeopleGraph(PEOPLE_DB_PATH);
    await peopleGraph.initialize();
  });

  describe('Owner', () => {
    it('should have an owner', async () => {
      const owner = await peopleGraph.getOwner();
      
      expect(owner).not.toBeNull();
      expect(owner?.is_owner).toBe(true);
      expect(owner?.name).toBe('Me');
    });

    it('should resolve "Me" to owner', async () => {
      const result = await peopleGraph.resolvePerson('Me');
      
      expect(result.found).toBe(true);
      expect(result.person?.is_owner).toBe(true);
    });

    it('should have owner handles', async () => {
      const owner = await peopleGraph.getOwner();
      const details = await peopleGraph.getPersonWithDetails(owner!.id);
      
      expect(details?.handles.length).toBeGreaterThan(0);
      console.log(`Owner has ${details?.handles.length} handles:`, 
        details?.handles.map(h => `${h.type}: ${h.handle.substring(0, 5)}...`));
    });
  });

  describe('People listing', () => {
    it('should have people indexed', async () => {
      const count = await peopleGraph.count();
      
      expect(count).toBeGreaterThan(0);
      console.log(`Total people in graph: ${count}`);
    });

    it('should list people', async () => {
      const people = await peopleGraph.listPeople({ limit: 5 });
      
      expect(people.length).toBeGreaterThan(0);
      console.log('Sample people:', people.map(p => p.name).join(', '));
    });
  });

  describe('Resolution', () => {
    it('should resolve by phone number', async () => {
      // Get a non-owner person's handle
      const people = await peopleGraph.listPeople({ limit: 10, autoCreatedOnly: true });
      const nonOwner = people.find(p => !p.is_owner);
      
      if (nonOwner) {
        const details = await peopleGraph.getPersonWithDetails(nonOwner.id);
        const phoneHandle = details?.handles.find(h => h.type === 'phone');
        
        if (phoneHandle) {
          const result = await peopleGraph.resolvePerson(phoneHandle.handle);
          expect(result.found).toBe(true);
          expect(result.person?.id).toBe(nonOwner.id);
        }
      }
    });

    it('should return not found for garbage query', async () => {
      const result = await peopleGraph.resolvePerson('xyzgarbage12345nonexistent');
      
      expect(result.found).toBe(false);
    });
  });
});

// Also test when DB is missing
describe('People Graph without DB', () => {
  it('should report database status correctly', () => {
    expect(existsSync(PEOPLE_DB_PATH)).toBe(DB_EXISTS);
    
    if (!DB_EXISTS) {
      console.log('⚠️  People Graph DB not found - run `pnpm run migrate` first');
    }
  });
});
