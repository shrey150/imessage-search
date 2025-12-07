/**
 * People Graph Tools
 * 
 * MCP tools for interacting with the People Graph.
 * Provides resolution, context retrieval, and enrichment capabilities.
 */

import { z } from 'zod';
import { getPeopleGraph, PersonWithDetails } from '../db/people-graph.js';
import { getChatGraph } from '../db/chat-graph.js';
import { getMemoriesDB, Memory } from '../db/memories.js';
import { getElasticsearchDB } from '../db/elasticsearch.js';
import { RELATIONSHIP_TYPES, RelationshipType } from '../db/schema.js';

// ============================================================
// SCHEMAS
// ============================================================

export const resolvePersonSchema = z.object({
  query: z.string().describe('Name, alias, phone number, or email to look up'),
});

export const getPersonContextSchema = z.object({
  person_id: z.string().describe('Person UUID'),
});

export const updatePersonSchema = z.object({
  person_id: z.string().describe('Person UUID'),
  add_alias: z.string().optional().describe('Alias to add'),
  add_relationship: z.object({
    to_person_id: z.string(),
    type: z.enum(RELATIONSHIP_TYPES as unknown as [string, ...string[]]),
    description: z.string().optional(),
  }).optional().describe('Relationship to add'),
  set_attribute: z.object({
    key: z.string(),
    value: z.string(),
  }).optional().describe('Attribute to set'),
  set_notes: z.string().optional().describe('Notes to set'),
  set_name: z.string().optional().describe('New display name'),
});

export const mergePeopleSchema = z.object({
  keep_id: z.string().describe('Person UUID to keep'),
  merge_id: z.string().describe('Person UUID to merge and delete'),
});

export const listPeopleSchema = z.object({
  auto_created_only: z.boolean().optional().describe('Only show auto-created people'),
  limit: z.number().optional().describe('Max results to return'),
});

// ============================================================
// TOOL IMPLEMENTATIONS
// ============================================================

/**
 * Resolve a person by name, alias, or handle
 */
export async function resolvePerson(input: z.infer<typeof resolvePersonSchema>) {
  const peopleGraph = getPeopleGraph();
  const result = await peopleGraph.resolvePerson(input.query);
  
  if (result.found && result.person) {
    return {
      found: true,
      person: formatPersonForDisplay(result.person),
    };
  }
  
  return {
    found: false,
    suggestions: result.suggestions || [],
    message: result.suggestions?.length 
      ? `Did you mean: ${result.suggestions.join(', ')}?`
      : `No person found matching "${input.query}"`,
  };
}

/**
 * Get full context about a person including chats, memories, and message stats
 */
export async function getPersonContext(input: z.infer<typeof getPersonContextSchema>) {
  const peopleGraph = getPeopleGraph();
  const chatGraph = getChatGraph();
  const memoriesDb = getMemoriesDB();
  const es = getElasticsearchDB();
  
  const person = await peopleGraph.getPersonWithDetails(input.person_id);
  if (!person) {
    return { found: false, error: 'Person not found' };
  }
  
  // Get chats this person participates in
  const chats = await chatGraph.getChatsForPerson(input.person_id);
  
  // Get memories about this person
  const memories = await memoriesDb.getMemoriesForPerson(input.person_id, 10);
  
  // Get message stats
  let messageStats = null;
  try {
    const statsResponse = await es.hybridSearch({
      filters: { sender_id: input.person_id },
      limit: 1,
    });
    
    if (statsResponse.length > 0) {
      // Get total count
      const countResponse = await es.hybridSearch({
        filters: { participant_ids: [input.person_id] },
        limit: 10000, // This will be capped but gives us an idea
      });
      
      messageStats = {
        approximate_messages: countResponse.length,
        last_message: statsResponse[0].document.timestamp,
      };
    }
  } catch {
    // Stats are optional, don't fail if ES isn't available
  }
  
  return {
    found: true,
    person: formatPersonForDisplay(person),
    chats: chats.map(c => ({
      id: c.id,
      display_name: c.display_name || 'Unnamed Chat',
      is_group_chat: c.is_group_chat,
      participant_count: c.participants.length,
    })),
    memories: memories.map(m => ({
      id: m.id,
      content: m.content,
      importance: m.importance,
      category: m.category,
      created_at: m.created_at,
    })),
    message_stats: messageStats,
  };
}

/**
 * Update a person with aliases, relationships, attributes, or notes
 */
export async function updatePerson(input: z.infer<typeof updatePersonSchema>) {
  const peopleGraph = getPeopleGraph();
  
  // Verify person exists
  const person = await peopleGraph.getPerson(input.person_id);
  if (!person) {
    return { success: false, error: 'Person not found' };
  }
  
  // Apply updates
  const updates: string[] = [];
  
  if (input.add_alias) {
    await peopleGraph.addAlias(input.person_id, input.add_alias);
    updates.push(`Added alias: ${input.add_alias}`);
  }
  
  if (input.add_relationship) {
    await peopleGraph.addRelationship(
      input.person_id,
      input.add_relationship.to_person_id,
      input.add_relationship.type as RelationshipType,
      input.add_relationship.description
    );
    updates.push(`Added relationship: ${input.add_relationship.type}`);
  }
  
  if (input.set_attribute) {
    await peopleGraph.setAttribute(
      input.person_id,
      input.set_attribute.key,
      input.set_attribute.value
    );
    updates.push(`Set attribute: ${input.set_attribute.key} = ${input.set_attribute.value}`);
  }
  
  if (input.set_notes) {
    await peopleGraph.updatePersonNotes(input.person_id, input.set_notes);
    updates.push('Updated notes');
  }
  
  if (input.set_name) {
    await peopleGraph.updatePersonName(input.person_id, input.set_name);
    updates.push(`Updated name to: ${input.set_name}`);
  }
  
  // Get updated person
  const updatedPerson = await peopleGraph.getPersonWithDetails(input.person_id);
  
  return {
    success: true,
    updates,
    person: updatedPerson ? formatPersonForDisplay(updatedPerson) : null,
  };
}

/**
 * Merge two people (keep one, merge the other into it)
 */
export async function mergePeople(input: z.infer<typeof mergePeopleSchema>) {
  const peopleGraph = getPeopleGraph();
  const es = getElasticsearchDB();
  
  // Verify both people exist
  const keepPerson = await peopleGraph.getPerson(input.keep_id);
  const mergePerson = await peopleGraph.getPerson(input.merge_id);
  
  if (!keepPerson) {
    return { success: false, error: 'Keep person not found' };
  }
  if (!mergePerson) {
    return { success: false, error: 'Merge person not found' };
  }
  
  // Merge in SQLite
  const result = await peopleGraph.mergePeople(input.keep_id, input.merge_id);
  
  // Update ES documents (change sender_id and participant_ids)
  try {
    const docIds = await es.getAllDocumentIds();
    const updates: Array<{ id: string; doc: Record<string, unknown> }> = [];
    
    for (const docId of docIds) {
      const doc = await es.getDocument(docId);
      if (!doc) continue;
      
      let needsUpdate = false;
      const update: Record<string, unknown> = {};
      
      // Update sender_id
      if (doc.sender_id === input.merge_id) {
        update.sender_id = input.keep_id;
        needsUpdate = true;
      }
      
      // Update participant_ids
      if (doc.participant_ids?.includes(input.merge_id)) {
        update.participant_ids = doc.participant_ids.map(id => 
          id === input.merge_id ? input.keep_id : id
        );
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        updates.push({ id: docId, doc: update });
      }
    }
    
    if (updates.length > 0) {
      await es.batchUpdateDocuments(updates);
    }
  } catch {
    // ES update is best-effort
  }
  
  return {
    success: true,
    merged_handles: result.mergedHandles,
    merged_aliases: result.mergedAliases,
    merged_relationships: result.mergedRelationships,
    message: `Merged "${mergePerson.name}" into "${keepPerson.name}"`,
  };
}

/**
 * List people in the graph
 */
export async function listPeople(input: z.infer<typeof listPeopleSchema>) {
  const peopleGraph = getPeopleGraph();
  
  const people = await peopleGraph.listPeople({
    autoCreatedOnly: input.auto_created_only,
    limit: input.limit || 50,
  });
  
  return {
    count: people.length,
    people: people.map(p => ({
      id: p.id,
      name: p.name,
      is_owner: p.is_owner,
      auto_created: p.auto_created,
      created_at: p.created_at,
    })),
  };
}

// ============================================================
// HELPERS
// ============================================================

function formatPersonForDisplay(person: PersonWithDetails) {
  return {
    id: person.id,
    name: person.name,
    is_owner: person.is_owner,
    notes: person.notes,
    auto_created: person.auto_created,
    handles: person.handles.map(h => ({
      handle: h.handle,
      type: h.type,
    })),
    aliases: person.aliases.map(a => a.alias),
    relationships: person.relationships.map(r => ({
      person_name: r.other_person_name,
      type: r.type,
      description: r.description,
    })),
    attributes: Object.fromEntries(
      person.attributes.map(a => [a.key, a.value])
    ),
  };
}

// ============================================================
// TOOL DEFINITIONS (for MCP registration)
// ============================================================

export const peopleTools = {
  resolve_person: {
    name: 'resolve_person',
    description: 'Look up a person by name, alias, phone number, or email. Returns their unique ID for use in other queries.',
    schema: resolvePersonSchema,
    handler: resolvePerson,
  },
  
  get_person_context: {
    name: 'get_person_context',
    description: 'Get full context about a person including their relationships, chats, memories, and message statistics.',
    schema: getPersonContextSchema,
    handler: getPersonContext,
  },
  
  update_person: {
    name: 'update_person',
    description: 'Update a person with new information: add aliases, relationships, attributes, or notes.',
    schema: updatePersonSchema,
    handler: updatePerson,
  },
  
  merge_people: {
    name: 'merge_people',
    description: 'Merge two people who are actually the same person. Keeps one record and merges the other into it.',
    schema: mergePeopleSchema,
    handler: mergePeople,
  },
  
  list_people: {
    name: 'list_people',
    description: 'List people in the knowledge graph.',
    schema: listPeopleSchema,
    handler: listPeople,
  },
};

