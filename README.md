# iMessage MCP Server

A Model Context Protocol (MCP) server for intelligent search over your iMessage history on macOS. Features LLM-powered query understanding, hybrid semantic + keyword search, and image search via CLIP embeddings.

## Features

- **Smart Search**: LLM-powered natural language queries — understands temporal expressions, person references, and query intent
- **Hybrid Search**: Combines semantic similarity (OpenAI embeddings + kNN) with keyword matching (BM25) for best results
- **Image Search**: Find images by text description using CLIP embeddings
- **Contact Resolution**: Automatically maps phone numbers to contact names during indexing
- **Incremental Indexing**: Only processes new messages; tracks state between runs
- **Web Chat Interface**: Next.js dashboard for chatting with your message history

## Prerequisites

- **macOS** (for access to `~/Library/Messages/chat.db`)
- **Node.js 20+**
- **pnpm** (`npm install -g pnpm`)
- **Docker** (for Elasticsearch)
- **OpenAI API key** (for embeddings and query parsing)
- **Python 3.8+** with PyTorch (optional, for image search)
- **Full Disk Access** granted to your terminal (System Preferences → Privacy & Security → Full Disk Access)

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

**Environment variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | Your OpenAI API key (required) | — |
| `ELASTICSEARCH_URL` | Elasticsearch connection URL | `http://localhost:9200` |
| `MESSAGES_DB_PATH` | Path to iMessage database | `~/Library/Messages/chat.db` |
| `ADDRESSBOOK_DB_PATH` | Path to AddressBook database | `~/Library/Application Support/AddressBook/AddressBook-v22.abcddb` |

### 3. Start Elasticsearch

```bash
pnpm es:start
```

To also start Kibana for debugging:

```bash
pnpm es:kibana
```

### 4. Index your messages

```bash
# Check current status
pnpm index:status

# Index new messages (incremental)
pnpm index

# Full reindex (clears existing data)
pnpm index:full
```

### 5. (Optional) Index images

Requires Python with PyTorch and transformers:

```bash
# Install Python dependencies
pip install -r scripts/requirements.txt

# Embed images with CLIP (incremental)
pnpm images:embed

# Full re-embed
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
| `pnpm test` | Run test suite |
| `pnpm index` | Index new messages (incremental) |
| `pnpm index:full` | Full reindex of all messages |
| `pnpm index:status` | Check indexing status |
| `pnpm index:verify` | Verify index integrity |
| `pnpm es:start` | Start Elasticsearch |
| `pnpm es:stop` | Stop Elasticsearch |
| `pnpm es:reset` | Delete all ES data and restart |
| `pnpm es:kibana` | Start ES with Kibana UI (port 5601) |
| `pnpm images:embed` | Embed images with CLIP |
| `pnpm images:embed:full` | Full re-embed all images |
| `pnpm chat` | Start the Next.js chat dashboard |
| `pnpm chat:setup` | Install chat dashboard dependencies |

## MCP Tools

### `smart_search`

Intelligent search that understands natural language queries.

```json
{
  "query": "What do I think about Mark?",
  "limit": 10
}
```

**What it understands:**

- **Temporal expressions**: "last week", "in September", "on Fridays", "late at night"
- **Person references**: "from Alex" (their messages), "about Alex" (mentions), "with Alex" (in their chat)
- **Chat types**: Group chats vs DMs
- **Image queries**: "Find photos from the beach trip"

**Examples:**

| Query | Behavior |
|-------|----------|
| `"What do I think about Mark?"` | Searches group chats for your opinions, excludes DMs with Mark |
| `"Did Sarah tell me about dinner plans?"` | Searches messages FROM Sarah |
| `"Messages about the project last week"` | Combines semantic + temporal |
| `"Late night conversations with Alex"` | Time-of-day + person filter |

### `hybrid_search`

Direct search with explicit control over filters — for power users.

```json
{
  "semanticQuery": "dinner plans",
  "keywordQuery": "restaurant",
  "sender": "John Smith",
  "chatName": "Family Group",
  "startDate": "2024-01-01",
  "endDate": "2024-12-31",
  "isGroupChat": true,
  "isDM": false,
  "hasImage": false,
  "limit": 10
}
```

All parameters are optional. At least one of `semanticQuery` or `keywordQuery` should be provided.

### `image_search`

Find images using text descriptions via CLIP.

```json
{
  "query": "photo of a dog",
  "sender": "Alex",
  "startDate": "2024-01-01",
  "limit": 10
}
```

Requires running `pnpm images:embed` first to generate CLIP embeddings.

## Chat Dashboard

A Next.js web interface for conversational search over your messages.

```bash
# Install dependencies
pnpm chat:setup

# Start the dashboard (port 3000)
pnpm chat
```

Open [http://localhost:3000](http://localhost:3000) to chat with your message history. The dashboard uses GPT-4o with function calling to search your messages naturally.

## Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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
│   chat.db       │────▶│   Indexer    │────▶│ Elasticsearch │
│   (Messages)    │     │  (chunking)  │     │  (ES 8.11)    │
└─────────────────┘     └──────────────┘     └───────────────┘
        │                      │                      │
┌─────────────────┐            │                      │
│  AddressBook.db │────────────┘                      │
│   (Contacts)    │                                   │
└─────────────────┘                                   │
                                                      ▼
┌─────────────────┐     ┌──────────────┐     ┌───────────────┐
│   Attachments   │────▶│ CLIP Embedder│────▶│ Image Vectors │
│    (Images)     │     │   (Python)   │     │  (512 dims)   │
└─────────────────┘     └──────────────┘     └───────────────┘
                                                      │
                        ┌─────────────────────────────┘
                        ▼
              ┌─────────────────┐
              │   MCP Server    │
              │    (stdio)      │
              └────────┬────────┘
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│smart_search │ │hybrid_search│ │image_search │
└─────────────┘ └─────────────┘ └─────────────┘
```

## How It Works

### Message Indexing

1. **Reading**: Messages are read from `~/Library/Messages/chat.db` (SQLite)
2. **Chunking**: Messages are grouped into conversation chunks based on 5-minute gaps
3. **Contact Resolution**: Phone numbers are resolved to names via AddressBook
4. **Enrichment**: Chunks are enriched with metadata (sender_is_me, temporal fields, chat type)
5. **Embedding**: Text is embedded using OpenAI `text-embedding-3-small` (1536 dimensions)
6. **Indexing**: Documents are stored in Elasticsearch with full-text and vector indexes

### Image Indexing

1. **Extraction**: Images are found in the iMessage attachments table
2. **CLIP Embedding**: Images are embedded using OpenAI CLIP ViT-B/32 (512 dimensions)
3. **Storage**: Image embeddings are stored alongside their message chunks

### Query Processing (Smart Search)

1. **LLM Parsing**: GPT-4o-mini parses natural language into structured query intent
2. **Classification**: Query type is identified (about_person, from_person, temporal, hybrid)
3. **Filter Generation**: Appropriate ES filters, boosts, and exclusions are generated
4. **Hybrid Execution**: BM25 keyword + kNN vector search with score fusion

## Data Model

Messages are indexed with rich metadata:

| Field | Type | Purpose |
|-------|------|---------|
| `text` | text | Full-text searchable content (BM25) |
| `text_embedding` | dense_vector | Semantic similarity (1536 dims) |
| `sender` | keyword | Who sent the message |
| `sender_is_me` | boolean | Quick filter for user's messages |
| `participants` | keyword[] | Everyone in the chat |
| `chat_name` | keyword | Group chat name (if any) |
| `is_dm` / `is_group_chat` | boolean | Chat type |
| `timestamp` | date | When the message was sent |
| `year` / `month` / `day_of_week` / `hour_of_day` | int/keyword | Temporal filters |
| `has_image` | boolean | Image presence |
| `image_embedding` | dense_vector | CLIP vector (512 dims) |

## File Locations

| File | Location |
|------|----------|
| Messages DB | `~/Library/Messages/chat.db` |
| Attachments | `~/Library/Messages/Attachments/` |
| AddressBook | `~/Library/Application Support/AddressBook/AddressBook-v22.abcddb` |
| Index State | `~/.imessage-mcp/state.db` |
| Image State | `~/.imessage-mcp/image_state.json` |
| ES Data | Docker volume `elasticsearch-data` |

## Troubleshooting

### "Cannot read Messages database"

Grant Full Disk Access to your terminal:
System Preferences → Privacy & Security → Full Disk Access → Add your terminal app

### "Elasticsearch not connected"

```bash
# Start Elasticsearch
pnpm es:start

# Check health
curl http://localhost:9200/_cluster/health
```

### "better-sqlite3 version mismatch"

```bash
pnpm rebuild better-sqlite3
```

### Image search not working

1. Install Python dependencies: `pip install -r scripts/requirements.txt`
2. Run image embedding: `pnpm images:embed`
3. Verify CLIP can load: `python3 -c "from transformers import CLIPModel; CLIPModel.from_pretrained('openai/clip-vit-base-patch32')"`

### Messages not appearing in search

```bash
# Check indexing status
pnpm index:status

# Verify index
pnpm index:verify

# Full reindex if needed
pnpm index:full
```

## License

MIT
