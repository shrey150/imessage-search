/**
 * MCP Server with Express and SSE transport
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { semanticSearch, semanticSearchSchema, semanticSearchTool } from './tools/semantic-search.js';
import { filteredSearch, filteredSearchSchema, filteredSearchTool } from './tools/filtered-search.js';
import { log } from './utils/progress.js';

/**
 * Create and configure the MCP server
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: 'imessage-mcp',
      version: '1.0.0',
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
      tools: [semanticSearchTool, filteredSearchTool],
    };
  });
  
  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    try {
      switch (name) {
        case 'semantic_search': {
          const input = semanticSearchSchema.parse(args);
          const results = await semanticSearch(input);
          
          return {
            content: [
              {
                type: 'text',
                text: formatSearchResults(results, input.query),
              },
            ],
          };
        }
        
        case 'filtered_search': {
          const input = filteredSearchSchema.parse(args);
          const results = await filteredSearch(input);
          
          return {
            content: [
              {
                type: 'text',
                text: formatFilteredResults(results, input),
              },
            ],
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
 * Format semantic search results for display
 */
function formatSearchResults(
  results: Awaited<ReturnType<typeof semanticSearch>>,
  query: string
): string {
  if (results.length === 0) {
    return `No messages found matching "${query}"`;
  }
  
  const lines = [
    `Found ${results.length} message${results.length === 1 ? '' : 's'} matching "${query}":`,
    '',
  ];
  
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const header = r.groupName 
      ? `${r.groupName} (${r.participants.join(', ')})` 
      : r.participants.join(', ');
    
    lines.push(`--- Result ${i + 1} (score: ${r.score}) ---`);
    lines.push(`Chat: ${header}`);
    lines.push(`Time: ${r.startTime} (${r.relativeTime})`);
    lines.push('');
    lines.push(r.text);
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Format filtered search results for display
 */
function formatFilteredResults(
  results: Awaited<ReturnType<typeof filteredSearch>>,
  input: { query?: string; person?: string; chatName?: string; startDate?: string; endDate?: string }
): string {
  const filters: string[] = [];
  if (input.query) filters.push(`query: "${input.query}"`);
  if (input.person) filters.push(`person: ${input.person}`);
  if (input.chatName) filters.push(`chat: ${input.chatName}`);
  if (input.startDate) filters.push(`from: ${input.startDate}`);
  if (input.endDate) filters.push(`to: ${input.endDate}`);
  
  const filterStr = filters.length > 0 ? filters.join(', ') : 'none';
  
  if (results.length === 0) {
    return `No messages found with filters: ${filterStr}`;
  }
  
  const lines = [
    `Found ${results.length} message${results.length === 1 ? '' : 's'} (filters: ${filterStr}):`,
    '',
  ];
  
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const header = r.groupName 
      ? `${r.groupName} (${r.participants.join(', ')})` 
      : r.participants.join(', ');
    
    lines.push(`--- Result ${i + 1} ---`);
    lines.push(`Chat: ${header}`);
    lines.push(`Time: ${r.startTime} (${r.relativeTime})`);
    lines.push('');
    lines.push(r.text);
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Start the MCP server with stdio transport
 */
export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  
  await server.connect(transport);
  log('Server', 'iMessage MCP server started', 'success');
}

