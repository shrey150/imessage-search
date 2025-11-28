# iMessage MCP Server

A Model Context Protocol (MCP) server that enables semantic search over your iMessage history on macOS.

## Features

- **Semantic Search**: Search your messages using natural language queries
- **Filtered Search**: Filter by person, group chat, and date range
- **Contact Resolution**: Automatically maps phone numbers to contact names
- **Incremental Indexing**: Only processes new messages, tracks progress
- **Vector Database**: Uses Qdrant for fast similarity search

## Prerequisites

- **macOS** (for access to Messages.db)
- **Node.js 20+**
- **pnpm** (`npm install -g pnpm`)
- **Docker** (for Qdrant)
- **OpenAI API key** (for embeddings)
- **Full Disk Access** granted to your terminal (System Preferences > Privacy & Security)

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp env.example .env
# Edit .env and add your OPENAI_API_KEY
```

### 3. Start Qdrant

```bash
pnpm qdrant:start
```

Or manually:

```bash
docker run -d --name imessage-mcp-qdrant \
  -p 6333:6333 -p 6334:6334 \
  -v imessage_mcp_qdrant:/qdrant/storage \
  qdrant/qdrant
```

### 4. Index your messages

```bash
# Check status first
pnpm index:status

# Index a small batch first to test (recommended!)
pnpm index --limit 100

# Index all new messages (incremental)
pnpm index

# Or do a full reindex
pnpm index:full
```

### 5. Start the MCP server

```bash
pnpm start
```

## Available Commands

| Command | Description |
|---------|-------------|
| `pnpm start` | Start the MCP server (stdio transport) |
| `pnpm dev` | Start with hot reload for development |
| `pnpm build` | Compile TypeScript to JavaScript |
| `pnpm index` | Index new messages (incremental) |
| `pnpm index --limit N` | Index only N messages (for testing) |
| `pnpm index:full` | Full reindex of all messages |
| `pnpm index:status` | Check indexing status |
| `pnpm query "text"` | Quick CLI search |
| `pnpm dashboard` | Launch Streamlit dashboard |
| `pnpm qdrant:start` | Start Qdrant container |
| `pnpm qdrant:stop` | Stop Qdrant container |
| `pnpm qdrant:reset` | Delete Qdrant data and restart |

## MCP Tools

### `semantic_search`

Search messages using natural language.

```json
{
  "query": "conversations about dinner plans",
  "limit": 10
}
```

### `filtered_search`

Search with structured filters.

```json
{
  "query": "dinner",
  "person": "John Smith",
  "chatName": "Family Group",
  "startDate": "2024-01-01",
  "endDate": "2024-12-31",
  "limit": 10
}
```

## Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "imessage": {
      "command": "node",
      "args": ["/path/to/imessage-mcp/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│  messages.db    │────▶│   Indexer    │────▶│   Qdrant    │
│  (SQLite)       │     │  (chunking)  │     │  (vectors)  │
└─────────────────┘     └──────────────┘     └─────────────┘
                              │
┌─────────────────┐           │
│  AddressBook.db │───────────┘
│  (Contacts)     │
└─────────────────┘
                        ┌──────────────┐
                        │  MCP Server  │
                        │  (stdio)     │
                        └──────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ semantic_search │             │ filtered_search │
    └─────────────────┘             └─────────────────┘
```

## How It Works

1. **Message Chunking**: Messages are grouped into conversation segments based on 5-minute gaps. Each chunk contains 3-10 messages (~1000 characters max).

2. **Embeddings**: Chunks are embedded using OpenAI's `text-embedding-3-small` model (1536 dimensions).

3. **Vector Storage**: Embeddings are stored in Qdrant with metadata (participants, timestamps, chat info).

4. **Contact Resolution**: Phone numbers are resolved to contact names by reading macOS AddressBook.

5. **Search**: Queries are embedded and matched against stored chunks using cosine similarity.

## File Locations

- **Messages DB**: `~/Library/Messages/chat.db`
- **AddressBook**: `~/Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb`
- **Index State**: `~/.imessage-mcp/state.db`

## Troubleshooting

### "Cannot read Messages database"

Grant Full Disk Access to your terminal in System Preferences > Privacy & Security > Full Disk Access.

### "Qdrant not connected"

Make sure Qdrant is running:

```bash
pnpm qdrant:start
# or
docker ps | grep qdrant
```

### "better-sqlite3 version mismatch"

Rebuild native modules:

```bash
pnpm rebuild better-sqlite3
```

## License

MIT

