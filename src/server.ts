/**
 * MCP Server with Express and SSE transport
 * Updated to use Elasticsearch with smart search capabilities
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
import { log } from './utils/progress.js';

/**
 * Create and configure the MCP server
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: 'imessage-mcp',
      version: '2.0.0',  // Bumped version for ES migration
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
        smartSearchTool,
        hybridSearchTool,
        imageSearchTool,
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
  log('Server', 'iMessage MCP server v2.0 started (Elasticsearch backend)', 'success');
}
