/**
 * Debug script for People Graph
 */

import { PeopleGraph } from '../db/people-graph.js';

async function main() {
  const pg = new PeopleGraph('./data/people.db');
  await pg.initialize();
  
  console.log('Testing resolvePerson("Me")...');
  const result = await pg.resolvePerson('Me');
  console.log('Result:', JSON.stringify(result, null, 2));
  
  console.log('\nTesting getOwner()...');
  const owner = await pg.getOwner();
  console.log('Owner:', owner?.name, owner?.id);
  
  console.log('\nTesting count()...');
  const count = await pg.count();
  console.log('People count:', count);
  
  console.log('\nTesting listPeople()...');
  const people = await pg.listPeople({ limit: 3 });
  console.log('Sample:', people.map(p => p.name));
}

main().catch(console.error);

