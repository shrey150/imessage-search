/**
 * MCP Server with Express and SSE transport
 * Uses Elasticsearch with People Graph and Memories tools
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { 
  smartSearch, 
  smartSearchSchema, 
  smartSearchTool,
  formatSmartSearchResults,
  hybridSearch,
  hybridSearchSchema,
  hybridSearchTool,
} from './tools/smart-search.js';
import {
  imageSearch,
  imageSearchSchema,
  imageSearchTool,
  formatImageSearchResults,
} from './tools/image-search.js';
import {
  peopleTools,
  resolvePerson,
  getPersonContext,
  updatePerson,
  mergePeople,
  listPeople,
} from './tools/people-tools.js';
import {
  chatTools,
  resolveChat,
  getChatContext,
  updateChat,
  listChats,
  getChatParticipants,
} from './tools/chat-tools.js';
import {
  memoryTools,
  searchMemories,
  saveMemory,
  updateMemory,
  deleteMemory,
  getRecentMemories,
} from './tools/memory-tools.js';
import { log } from './utils/progress.js';

// ============================================================
// MCP Tool Definitions
// ============================================================

const resolvePersonTool = {
  name: 'resolve_person',
  description: peopleTools.resolve_person.description,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Name, alias, phone number, or email to look up' },
    },
    required: ['query'],
  },
};

const getPersonContextTool = {
  name: 'get_person_context',
  description: peopleTools.get_person_context.description,
  inputSchema: {
    type: 'object',
    properties: {
      person_id: { type: 'string', description: 'Person UUID' },
    },
    required: ['person_id'],
  },
};

const updatePersonTool = {
  name: 'update_person',
  description: peopleTools.update_person.description,
  inputSchema: {
    type: 'object',
    properties: {
      person_id: { type: 'string', description: 'Person UUID' },
      add_alias: { type: 'string', description: 'Alias to add' },
      add_relationship: {
        type: 'object',
        properties: {
          to_person_id: { type: 'string' },
          type: { type: 'string', enum: ['friend', 'family', 'coworker', 'dating', 'roommate'] },
          description: { type: 'string' },
        },
        required: ['to_person_id', 'type'],
      },
      set_attribute: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
        },
        required: ['key', 'value'],
      },
      set_notes: { type: 'string', description: 'Notes to set' },
      set_name: { type: 'string', description: 'New display name' },
    },
    required: ['person_id'],
  },
};

const listPeopleTool = {
  name: 'list_people',
  description: peopleTools.list_people.description,
  inputSchema: {
    type: 'object',
    properties: {
      auto_created_only: { type: 'boolean', description: 'Only show auto-created people' },
      limit: { type: 'number', description: 'Max results to return' },
    },
    required: [],
  },
};

const resolveChatTool = {
  name: 'resolve_chat',
  description: chatTools.resolve_chat.description,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Chat name or alias to look up' },
    },
    required: ['query'],
  },
};

const getChatContextTool = {
  name: 'get_chat_context',
  description: chatTools.get_chat_context.description,
  inputSchema: {
    type: 'object',
    properties: {
      chat_id: { type: 'string', description: 'Chat UUID' },
    },
    required: ['chat_id'],
  },
};

const listChatsTool = {
  name: 'list_chats',
  description: chatTools.list_chats.description,
  inputSchema: {
    type: 'object',
    properties: {
      person_id: { type: 'string', description: 'Filter to chats this person is in' },
      is_group_chat: { type: 'boolean', description: 'Filter by group chat status' },
      limit: { type: 'number', description: 'Max results to return' },
    },
    required: [],
  },
};

const searchMemoriesTool = {
  name: 'search_memories',
  description: memoryTools.search_memories.description,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Semantic search query' },
      person_id: { type: 'string', description: 'Filter to memories about this person' },
      chat_id: { type: 'string', description: 'Filter to memories about this chat' },
      category: { type: 'string', enum: ['fact', 'preference', 'event', 'relationship'], description: 'Filter by category' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
      limit: { type: 'number', description: 'Max results to return' },
    },
    required: [],
  },
};

const saveMemoryTool = {
  name: 'save_memory',
  description: memoryTools.save_memory.description,
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The memory content to save' },
      related_people: { type: 'array', items: { type: 'string' }, description: 'Person UUIDs this memory relates to' },
      related_chats: { type: 'array', items: { type: 'string' }, description: 'Chat UUIDs this memory relates to' },
      category: { type: 'string', enum: ['fact', 'preference', 'event', 'relationship'], description: 'Memory category' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
      importance: { type: 'number', minimum: 1, maximum: 5, description: 'Importance level 1-5' },
      source: { type: 'string', description: 'How this was learned' },
    },
    required: ['content'],
  },
};

const getRecentMemoriesTool = {
  name: 'get_recent_memories',
  description: memoryTools.get_recent_memories.description,
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max results to return' },
    },
    required: [],
  },
};

/**
 * Create and configure the MCP server
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: 'imessage-mcp',
      version: '3.0.0',  // Bumped version for People Graph + Memories
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  
  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        // Search tools
        smartSearchTool,
        hybridSearchTool,
        imageSearchTool,
        // People Graph tools
        resolvePersonTool,
        getPersonContextTool,
        updatePersonTool,
        listPeopleTool,
        // Chat Graph tools
        resolveChatTool,
        getChatContextTool,
        listChatsTool,
        // Memory tools
        searchMemoriesTool,
        saveMemoryTool,
        getRecentMemoriesTool,
      ],
    };
  });
  
  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    try {
      switch (name) {
        case 'smart_search': {
          const input = smartSearchSchema.parse(args);
          const result = await smartSearch(input);
          
          return {
            content: [
              {
                type: 'text',
                text: formatSmartSearchResults(result, input.query),
              },
            ],
          };
        }
        
        case 'hybrid_search': {
          const input = hybridSearchSchema.parse(args);
          const results = await hybridSearch(input);
          
          // Format results
          const lines = [];
          if (results.length === 0) {
            lines.push('No messages found with the specified filters');
          } else {
            lines.push(`Found ${results.length} result${results.length === 1 ? '' : 's'}:`);
            lines.push('');
            
            for (let i = 0; i < results.length; i++) {
              const r = results[i];
              const timestamp = typeof r.document.timestamp === 'string' 
                ? new Date(r.document.timestamp) 
                : r.document.timestamp;
              
              const header = r.document.chat_name 
                ? `${r.document.chat_name} (${r.document.participants.join(', ')})` 
                : r.document.participants.join(', ');
              
              lines.push(`--- Result ${i + 1} (score: ${Math.round(r.score * 100) / 100}) ---`);
              lines.push(`Chat: ${header}`);
              lines.push(`Time: ${timestamp.toLocaleString()}`);
              if (r.document.has_image) lines.push('📷 Contains image');
              lines.push('');
              lines.push(r.document.text);
              lines.push('');
            }
          }
          
          return {
            content: [
              {
                type: 'text',
                text: lines.join('\n'),
              },
            ],
          };
        }
        
        case 'image_search': {
          const input = imageSearchSchema.parse(args);
          const results = await imageSearch(input);
          
          return {
            content: [
              {
                type: 'text',
                text: formatImageSearchResults(results, input.query),
              },
            ],
          };
        }
        
        // ============================================================
        // People Graph Tools
        // ============================================================
        
        case 'resolve_person': {
          const input = peopleTools.resolve_person.schema.parse(args);
          const result = await resolvePerson(input);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        case 'get_person_context': {
          const input = peopleTools.get_person_context.schema.parse(args);
          const result = await getPersonContext(input);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        case 'update_person': {
          const input = peopleTools.update_person.schema.parse(args);
          const result = await updatePerson(input);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        case 'list_people': {
          const input = peopleTools.list_people.schema.parse(args);
          const result = await listPeople(input);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        // ============================================================
        // Chat Graph Tools
        // ============================================================
        
        case 'resolve_chat': {
          const input = chatTools.resolve_chat.schema.parse(args);
          const result = await resolveChat(input);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        case 'get_chat_context': {
          const input = chatTools.get_chat_context.schema.parse(args);
          const result = await getChatContext(input);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        case 'list_chats': {
          const input = chatTools.list_chats.schema.parse(args);
          const result = await listChats(input);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        // ============================================================
        // Memory Tools
        // ============================================================
        
        case 'search_memories': {
          const input = memoryTools.search_memories.schema.parse(args);
          const result = await searchMemories(input);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        case 'save_memory': {
          const input = memoryTools.save_memory.schema.parse(args);
          const result = await saveMemory(input);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        case 'get_recent_memories': {
          const input = memoryTools.get_recent_memories.schema.parse(args);
          const result = await getRecentMemories(input);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });
  
  return server;
}

/**
 * Start the MCP server with stdio transport
 */
export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  
  await server.connect(transport);
  log('Server', 'iMessage MCP server v3.0 started (People Graph + Memories)', 'success');
}
