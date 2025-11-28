#!/usr/bin/env node
/**
 * iMessage MCP Server
 * 
 * A Model Context Protocol server for searching iMessage history.
 * 
 * Usage:
 *   pnpm start          - Start the MCP server (stdio transport)
 *   pnpm index          - Index new messages
 *   pnpm index:full     - Full reindex of all messages
 *   pnpm index:status   - Check indexing status
 */

import 'dotenv/config';
import { startServer } from './server.js';

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

// Start the server
startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

