/**
 * Memory Tools
 * 
 * MCP tools for the Memories API.
 * Allows the agent to save and retrieve learned facts and preferences.
 */

import { z } from 'zod';
import { getMemoriesDB, Memory, MemoryCategory } from '../db/memories.js';
import { getPeopleGraph } from '../db/people-graph.js';
import { getChatGraph } from '../db/chat-graph.js';
import { generateEmbedding } from '../embeddings/openai.js';

// ============================================================
// SCHEMAS
// ============================================================

export const searchMemoriesSchema = z.object({
  query: z.string().optional().describe('Semantic search query'),
  person_id: z.string().optional().describe('Filter to memories about this person'),
  chat_id: z.string().optional().describe('Filter to memories about this chat'),
  category: z.enum(['fact', 'preference', 'event', 'relationship']).optional().describe('Filter by category'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  limit: z.number().optional().describe('Max results to return'),
});

export const saveMemorySchema = z.object({
  content: z.string().describe('The memory content to save'),
  related_people: z.array(z.string()).optional().describe('Person UUIDs this memory relates to'),
  related_chats: z.array(z.string()).optional().describe('Chat UUIDs this memory relates to'),
  category: z.enum(['fact', 'preference', 'event', 'relationship']).optional().describe('Memory category'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  importance: z.number().min(1).max(5).optional().describe('Importance level 1-5'),
  source: z.string().optional().describe('How this was learned'),
  expires_at: z.string().optional().describe('ISO date when this memory expires'),
});

export const updateMemorySchema = z.object({
  memory_id: z.string().describe('Memory UUID'),
  content: z.string().optional().describe('New content'),
  add_tags: z.array(z.string()).optional().describe('Tags to add'),
  remove_tags: z.array(z.string()).optional().describe('Tags to remove'),
  importance: z.number().min(1).max(5).optional().describe('New importance level'),
  expires_at: z.string().optional().describe('ISO date when this memory expires'),
});

export const deleteMemorySchema = z.object({
  memory_id: z.string().describe('Memory UUID to delete'),
});

export const getRecentMemoriesSchema = z.object({
  limit: z.number().optional().describe('Max results to return'),
});

// ============================================================
// TOOL IMPLEMENTATIONS
// ============================================================

/**
 * Search memories with semantic and/or filter-based queries
 */
export async function searchMemories(input: z.infer<typeof searchMemoriesSchema>) {
  const memoriesDb = getMemoriesDB();
  
  // Generate embedding if query provided
  let queryEmbedding: number[] | undefined;
  if (input.query) {
    try {
      queryEmbedding = await generateEmbedding(input.query);
    } catch {
      // Fall back to text search only
    }
  }
  
  const results = await memoriesDb.searchMemories({
    query: input.query,
    queryEmbedding,
    person_id: input.person_id,
    chat_id: input.chat_id,
    category: input.category as MemoryCategory,
    tags: input.tags,
    limit: input.limit || 10,
  });
  
  return {
    count: results.length,
    memories: results.map(r => ({
      id: r.memory.id,
      content: r.memory.content,
      score: r.score,
      category: r.memory.category,
      importance: r.memory.importance,
      tags: r.memory.tags,
      related_people_names: r.memory.related_people_names,
      related_chat_names: r.memory.related_chat_names,
      created_at: r.memory.created_at,
    })),
  };
}

/**
 * Save a new memory
 */
export async function saveMemory(input: z.infer<typeof saveMemorySchema>) {
  const memoriesDb = getMemoriesDB();
  const peopleGraph = getPeopleGraph();
  const chatGraph = getChatGraph();
  
  // Resolve person names for denormalization
  const relatedPeopleNames: string[] = [];
  if (input.related_people) {
    for (const personId of input.related_people) {
      const person = await peopleGraph.getPerson(personId);
      if (person) {
        relatedPeopleNames.push(person.name);
      }
    }
  }
  
  // Resolve chat names for denormalization
  const relatedChatNames: string[] = [];
  if (input.related_chats) {
    for (const chatId of input.related_chats) {
      const chat = await chatGraph.getChat(chatId);
      if (chat) {
        relatedChatNames.push(chat.display_name || 'Unnamed');
      }
    }
  }
  
  // Generate embedding
  let embedding: number[] | undefined;
  try {
    embedding = await generateEmbedding(input.content);
  } catch {
    // Embedding is optional, continue without it
  }
  
  const memory = await memoriesDb.createMemory({
    content: input.content,
    related_people: input.related_people,
    related_people_names: relatedPeopleNames,
    related_chats: input.related_chats,
    related_chat_names: relatedChatNames,
    category: input.category as MemoryCategory,
    tags: input.tags,
    importance: input.importance,
    source: input.source,
    embedding,
    expires_at: input.expires_at ? new Date(input.expires_at) : undefined,
    created_by: 'agent',
  });
  
  return {
    success: true,
    memory: {
      id: memory.id,
      content: memory.content,
      category: memory.category,
      importance: memory.importance,
      tags: memory.tags,
      related_people_names: memory.related_people_names,
      related_chat_names: memory.related_chat_names,
      created_at: memory.created_at,
    },
  };
}

/**
 * Update an existing memory
 */
export async function updateMemory(input: z.infer<typeof updateMemorySchema>) {
  const memoriesDb = getMemoriesDB();
  
  // Get existing memory
  const existing = await memoriesDb.getMemory(input.memory_id);
  if (!existing) {
    return { success: false, error: 'Memory not found' };
  }
  
  // Build updates
  const updates: Record<string, unknown> = {};
  
  if (input.content) {
    updates.content = input.content;
    // Re-generate embedding for new content
    try {
      updates.embedding = await generateEmbedding(input.content);
    } catch {
      // Keep old embedding if generation fails
    }
  }
  
  if (input.importance) {
    updates.importance = input.importance;
  }
  
  if (input.expires_at) {
    updates.expires_at = new Date(input.expires_at);
  }
  
  // Handle tag updates
  let tags = [...existing.tags];
  if (input.add_tags) {
    tags = [...new Set([...tags, ...input.add_tags])];
  }
  if (input.remove_tags) {
    tags = tags.filter(t => !input.remove_tags?.includes(t));
  }
  if (input.add_tags || input.remove_tags) {
    updates.tags = tags;
  }
  
  const updated = await memoriesDb.updateMemory(input.memory_id, updates);
  
  return {
    success: true,
    memory: updated ? {
      id: updated.id,
      content: updated.content,
      category: updated.category,
      importance: updated.importance,
      tags: updated.tags,
      updated_at: updated.updated_at,
    } : null,
  };
}

/**
 * Delete a memory
 */
export async function deleteMemory(input: z.infer<typeof deleteMemorySchema>) {
  const memoriesDb = getMemoriesDB();
  
  const success = await memoriesDb.deleteMemory(input.memory_id);
  
  return {
    success,
    message: success ? 'Memory deleted' : 'Memory not found',
  };
}

/**
 * Get recent memories
 */
export async function getRecentMemories(input: z.infer<typeof getRecentMemoriesSchema>) {
  const memoriesDb = getMemoriesDB();
  
  const memories = await memoriesDb.getRecentMemories(input.limit || 10);
  
  return {
    count: memories.length,
    memories: memories.map(m => ({
      id: m.id,
      content: m.content,
      category: m.category,
      importance: m.importance,
      tags: m.tags,
      related_people_names: m.related_people_names,
      related_chat_names: m.related_chat_names,
      created_at: m.created_at,
    })),
  };
}

// ============================================================
// TOOL DEFINITIONS (for MCP registration)
// ============================================================

export const memoryTools = {
  search_memories: {
    name: 'search_memories',
    description: 'Search memories using semantic search and/or filters. Use this to find previously saved facts, preferences, events, or relationship information.',
    schema: searchMemoriesSchema,
    handler: searchMemories,
  },
  
  save_memory: {
    name: 'save_memory',
    description: 'Save a new memory. Use this when you learn something important about a person, chat, or relationship that should be remembered for future conversations.',
    schema: saveMemorySchema,
    handler: saveMemory,
  },
  
  update_memory: {
    name: 'update_memory',
    description: 'Update an existing memory with new content, tags, or importance.',
    schema: updateMemorySchema,
    handler: updateMemory,
  },
  
  delete_memory: {
    name: 'delete_memory',
    description: 'Delete a memory that is no longer relevant or accurate.',
    schema: deleteMemorySchema,
    handler: deleteMemory,
  },
  
  get_recent_memories: {
    name: 'get_recent_memories',
    description: 'Get the most recently created memories.',
    schema: getRecentMemoriesSchema,
    handler: getRecentMemories,
  },
};

