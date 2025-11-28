# iMessage MCP Server

A Model Context Protocol (MCP) server that enables intelligent hybrid search over your iMessage history on macOS. Features LLM-powered query understanding, semantic search, keyword search, and image search.

## Features

- **Smart Search**: LLM-powered query understanding that handles complex natural language queries
- **Hybrid Search**: Combines semantic (vector) search with keyword (BM25) search for best results
- **Image Search**: Find images using text descriptions via CLIP embeddings
- **Temporal Reasoning**: Understands "last week", "in September", "late at night", etc.
- **Person-Aware Queries**: Distinguishes "about Mark" (opinions) vs "from Mark" (their messages)
- **Contact Resolution**: Automatically maps phone numbers to contact names at index time
- **Incremental Indexing**: Only processes new messages, tracks progress
- **Elasticsearch Backend**: Fast, durable, production-ready search

## Prerequisites

- **macOS** (for access to Messages.db)
- **Node.js 20+**
- **pnpm** (`npm install -g pnpm`)
- **Docker** (for Elasticsearch)
- **OpenAI API key** (for embeddings and query parsing)
- **Python 3.8+** (optional, for image embeddings)
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

### 3. Start Elasticsearch

```bash
pnpm es:start
```

Or with Kibana for debugging:

```bash
pnpm es:kibana
```

### 4. Index your messages

```bash
# Check status first
pnpm index:status

# Index all new messages (incremental)
pnpm index

# Or do a full reindex
pnpm index:full
```

### 5. (Optional) Index images

Requires Python with PyTorch and transformers:

```bash
# Install Python dependencies
pip install -r scripts/requirements.txt

# Embed images with CLIP
pnpm images:embed

# Or full re-embed
pnpm images:embed:full
```

### 6. Start the MCP server

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
| `pnpm index:full` | Full reindex of all messages |
| `pnpm index:status` | Check indexing status |
| `pnpm es:start` | Start Elasticsearch |
| `pnpm es:stop` | Stop Elasticsearch |
| `pnpm es:reset` | Delete all ES data and restart |
| `pnpm es:kibana` | Start ES with Kibana UI |
| `pnpm images:embed` | Embed images with CLIP |
| `pnpm images:embed:full` | Full re-embed all images |

## MCP Tools

### `smart_search`

Intelligent search that understands natural language queries.

```json
{
  "query": "What do I think about Mark?",
  "limit": 10
}
```

**Examples:**
- `"What do I think about Mark?"` → Searches group chats for opinions, excludes Mark's DMs
- `"Did Sarah tell me about dinner plans?"` → Searches messages FROM Sarah
- `"Messages about the project last week"` → Combines semantic + temporal
- `"Late night conversations with Alex"` → Time-of-day + person filter

### `hybrid_search`

Direct search with explicit filters for power users.

```json
{
  "semanticQuery": "dinner plans",
  "keywordQuery": "restaurant",
  "sender": "John Smith",
  "chatName": "Family Group",
  "startDate": "2024-01-01",
  "endDate": "2024-12-31",
  "isGroupChat": true,
  "limit": 10
}
```

### `image_search`

Find images using text descriptions.

```json
{
  "query": "photo of a dog",
  "sender": "Alex",
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
┌─────────────────┐     ┌──────────────┐     ┌───────────────┐
│  messages.db    │────▶│   Indexer    │────▶│ Elasticsearch │
│  (SQLite)       │     │  (chunking)  │     │  (hybrid)     │
└─────────────────┘     └──────────────┘     └───────────────┘
                              │                      │
┌─────────────────┐           │                      │
│  AddressBook.db │───────────┘                      │
│  (Contacts)     │                                  │
└─────────────────┘                                  │
                                                     ▼
┌─────────────────┐     ┌──────────────┐     ┌───────────────┐
│   Attachments   │────▶│ CLIP (Python)│────▶│ Image Vectors │
│   (Images)      │     │              │     │               │
└─────────────────┘     └──────────────┘     └───────────────┘
                                                     │
                        ┌───────────────────────────┬┘
                        ▼                           ▼
              ┌─────────────────┐         ┌─────────────────┐
              │   LLM Query     │         │   MCP Server    │
              │   Orchestrator  │────────▶│   (stdio)       │
              └─────────────────┘         └─────────────────┘
                                                   │
                      ┌────────────────────────────┼────────────────────────────┐
                      ▼                            ▼                            ▼
            ┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
            │  smart_search   │          │  hybrid_search  │          │  image_search   │
            └─────────────────┘          └─────────────────┘          └─────────────────┘
```

## How It Works

### Text Search

1. **Message Chunking**: Messages are grouped into conversation segments based on 5-minute gaps
2. **Enrichment**: Chunks are enriched with derived fields (sender_is_me, temporal data, etc.)
3. **Embeddings**: Chunks are embedded using OpenAI's `text-embedding-3-small` (1536 dimensions)
4. **Indexing**: Documents are stored in Elasticsearch with full-text and vector indexes

### Image Search

1. **Extraction**: Images are extracted from iMessage attachments table
2. **CLIP Embedding**: Images are embedded using OpenAI CLIP ViT-B/32 (512 dimensions)
3. **Search**: Text queries are embedded and matched against image vectors

### Query Understanding

1. **LLM Parsing**: Natural language queries are parsed by GPT-4o-mini
2. **Classification**: Queries are classified (about_person, from_person, temporal, image, hybrid)
3. **Filter Generation**: Appropriate filters, boosts, and exclusions are generated
4. **Hybrid Execution**: BM25 + kNN search with automatic score fusion

## Data Model

Messages are indexed with rich metadata for nuanced queries:

| Field | Type | Purpose |
|-------|------|---------|
| `text` | text | Full-text searchable content |
| `text_embedding` | dense_vector | Semantic similarity |
| `sender` | keyword | Who sent the message |
| `sender_is_me` | boolean | Quick filter for user's messages |
| `participants` | keyword[] | Everyone in the chat |
| `is_dm` / `is_group_chat` | boolean | Chat type |
| `timestamp` | date | When the message was sent |
| `year` / `month` / `day_of_week` / `hour_of_day` | int/keyword | Temporal filters |
| `has_image` | boolean | Image presence |
| `image_embedding` | dense_vector | CLIP vector for images |

## File Locations

- **Messages DB**: `~/Library/Messages/chat.db`
- **Attachments**: `~/Library/Messages/Attachments/`
- **AddressBook**: `~/Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb`
- **Index State**: `~/.imessage-mcp/state.db`
- **Image State**: `~/.imessage-mcp/image_state.json`
- **ES Data**: Docker volume `elasticsearch-data`

## Troubleshooting

### "Cannot read Messages database"

Grant Full Disk Access to your terminal in System Preferences > Privacy & Security > Full Disk Access.

### "Elasticsearch not connected"

Make sure Elasticsearch is running:

```bash
pnpm es:start
# Check health
curl http://localhost:9200/_cluster/health
```

### "better-sqlite3 version mismatch"

Rebuild native modules:

```bash
pnpm rebuild better-sqlite3
```

### Image embeddings not working

Install Python dependencies:

```bash
pip install -r scripts/requirements.txt
```

## Migration from Qdrant

This version (2.0) uses Elasticsearch instead of Qdrant. If you're upgrading:

1. Start Elasticsearch: `pnpm es:start`
2. Re-index your messages: `pnpm index:full`
3. (Optional) Remove Qdrant: `pnpm qdrant:reset && docker rm imessage-mcp-qdrant`

## License

MIT
