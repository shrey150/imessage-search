/**
 * Chat Graph Tools
 * 
 * MCP tools for interacting with the Chat Graph.
 * Provides resolution, context retrieval, and management capabilities.
 */

import { z } from 'zod';
import { getChatGraph, ChatWithDetails } from '../db/chat-graph.js';
import { getPeopleGraph } from '../db/people-graph.js';
import { getMemoriesDB } from '../db/memories.js';
import { getElasticsearchDB } from '../db/elasticsearch.js';

// ============================================================
// SCHEMAS
// ============================================================

export const resolveChatSchema = z.object({
  query: z.string().describe('Chat name or alias to look up'),
});

export const getChatContextSchema = z.object({
  chat_id: z.string().describe('Chat UUID'),
});

export const updateChatSchema = z.object({
  chat_id: z.string().describe('Chat UUID'),
  set_name: z.string().optional().describe('New display name'),
  add_alias: z.string().optional().describe('Alias to add'),
  set_notes: z.string().optional().describe('Notes to set'),
});

export const listChatsSchema = z.object({
  person_id: z.string().optional().describe('Filter to chats this person is in'),
  is_group_chat: z.boolean().optional().describe('Filter by group chat status'),
  limit: z.number().optional().describe('Max results to return'),
});

export const getChatParticipantsSchema = z.object({
  chat_id: z.string().describe('Chat UUID'),
});

// ============================================================
// TOOL IMPLEMENTATIONS
// ============================================================

/**
 * Resolve a chat by name or alias
 */
export async function resolveChat(input: z.infer<typeof resolveChatSchema>) {
  const chatGraph = getChatGraph();
  const result = await chatGraph.resolveChat(input.query);
  
  if (result.found && result.chat) {
    return {
      found: true,
      chat: formatChatForDisplay(result.chat),
    };
  }
  
  return {
    found: false,
    suggestions: result.suggestions || [],
    message: result.suggestions?.length 
      ? `Did you mean: ${result.suggestions.join(', ')}?`
      : `No chat found matching "${input.query}"`,
  };
}

/**
 * Get full context about a chat including participants, memories, and activity
 */
export async function getChatContext(input: z.infer<typeof getChatContextSchema>) {
  const chatGraph = getChatGraph();
  const memoriesDb = getMemoriesDB();
  const es = getElasticsearchDB();
  
  const chat = await chatGraph.getChatWithDetails(input.chat_id);
  if (!chat) {
    return { found: false, error: 'Chat not found' };
  }
  
  // Get memories about this chat
  const memories = await memoriesDb.getMemoriesForChat(input.chat_id, 10);
  
  // Get recent message stats
  let messageStats = null;
  try {
    const recentMessages = await es.hybridSearch({
      filters: { graph_chat_id: input.chat_id },
      limit: 100,
    });
    
    if (recentMessages.length > 0) {
      const timestamps = recentMessages.map(m => new Date(m.document.timestamp).getTime());
      messageStats = {
        recent_message_count: recentMessages.length,
        first_in_results: new Date(Math.min(...timestamps)),
        last_in_results: new Date(Math.max(...timestamps)),
      };
    }
  } catch {
    // Stats are optional
  }
  
  return {
    found: true,
    chat: formatChatForDisplay(chat),
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
 * Update a chat with name, alias, or notes
 */
export async function updateChat(input: z.infer<typeof updateChatSchema>) {
  const chatGraph = getChatGraph();
  
  // Verify chat exists
  const chat = await chatGraph.getChat(input.chat_id);
  if (!chat) {
    return { success: false, error: 'Chat not found' };
  }
  
  // Apply updates
  const updates: string[] = [];
  
  if (input.set_name) {
    await chatGraph.updateChatName(input.chat_id, input.set_name);
    updates.push(`Updated name to: ${input.set_name}`);
  }
  
  if (input.add_alias) {
    await chatGraph.addAlias(input.chat_id, input.add_alias);
    updates.push(`Added alias: ${input.add_alias}`);
  }
  
  if (input.set_notes) {
    await chatGraph.updateChatNotes(input.chat_id, input.set_notes);
    updates.push('Updated notes');
  }
  
  // Get updated chat
  const updatedChat = await chatGraph.getChatWithDetails(input.chat_id);
  
  return {
    success: true,
    updates,
    chat: updatedChat ? formatChatForDisplay(updatedChat) : null,
  };
}

/**
 * List chats with optional filters
 */
export async function listChats(input: z.infer<typeof listChatsSchema>) {
  const chatGraph = getChatGraph();
  
  const chats = await chatGraph.listChats({
    personId: input.person_id,
    isGroupChat: input.is_group_chat,
    limit: input.limit || 50,
  });
  
  return {
    count: chats.length,
    chats: chats.map(c => ({
      id: c.id,
      display_name: c.display_name || 'Unnamed',
      is_group_chat: c.is_group_chat,
      imessage_id: c.imessage_id,
      auto_created: c.auto_created,
    })),
  };
}

/**
 * Get participants for a chat with their details
 */
export async function getChatParticipants(input: z.infer<typeof getChatParticipantsSchema>) {
  const chatGraph = getChatGraph();
  const peopleGraph = getPeopleGraph();
  
  const chat = await chatGraph.getChatWithDetails(input.chat_id);
  if (!chat) {
    return { found: false, error: 'Chat not found' };
  }
  
  // Get full details for each participant
  const participants = await Promise.all(
    chat.participants.map(async (p) => {
      const person = await peopleGraph.getPersonWithDetails(p.person_id);
      return {
        id: p.person_id,
        name: p.person_name,
        is_owner: person?.is_owner || false,
        handles: person?.handles.map(h => h.handle) || [],
        joined_at: p.joined_at,
        left_at: p.left_at,
      };
    })
  );
  
  return {
    found: true,
    chat_name: chat.display_name || 'Unnamed',
    is_group_chat: chat.is_group_chat,
    participant_count: participants.length,
    participants,
  };
}

// ============================================================
// HELPERS
// ============================================================

function formatChatForDisplay(chat: ChatWithDetails) {
  return {
    id: chat.id,
    display_name: chat.display_name || 'Unnamed Chat',
    imessage_id: chat.imessage_id,
    is_group_chat: chat.is_group_chat,
    notes: chat.notes,
    auto_created: chat.auto_created,
    aliases: chat.aliases.map(a => a.alias),
    participants: chat.participants.map(p => ({
      id: p.person_id,
      name: p.person_name,
      joined_at: p.joined_at,
      left_at: p.left_at,
    })),
  };
}

// ============================================================
// TOOL DEFINITIONS (for MCP registration)
// ============================================================

export const chatTools = {
  resolve_chat: {
    name: 'resolve_chat',
    description: 'Look up a chat by name or alias. Returns the unique ID for use in other queries.',
    schema: resolveChatSchema,
    handler: resolveChat,
  },
  
  get_chat_context: {
    name: 'get_chat_context',
    description: 'Get full context about a chat including participants, memories, and message statistics.',
    schema: getChatContextSchema,
    handler: getChatContext,
  },
  
  update_chat: {
    name: 'update_chat',
    description: 'Update a chat with a new name, alias, or notes.',
    schema: updateChatSchema,
    handler: updateChat,
  },
  
  list_chats: {
    name: 'list_chats',
    description: 'List chats with optional filters by person or group status.',
    schema: listChatsSchema,
    handler: listChats,
  },
  
  get_chat_participants: {
    name: 'get_chat_participants',
    description: 'Get detailed information about all participants in a chat.',
    schema: getChatParticipantsSchema,
    handler: getChatParticipants,
  },
};

