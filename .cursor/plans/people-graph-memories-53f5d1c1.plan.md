<!-- 53f5d1c1-7599-4bf5-a40a-477ce3429951 7120cae7-00e6-4660-99ff-8cbda55866b4 -->
# People Graph, Chat Graph & Memories System

## Design Document v1.0

---

# 1. Executive Summary

We're building three interconnected systems to give the iMessage agent **persistent memory and relationship awareness**:

1. **People Graph** - A SQLite database mapping raw iMessage handles to stable Person entities with relationships
2. **Chat Graph** - A SQLite database mapping iMessage chat GUIDs to stable Chat entities with participants
3. **Memories API** - An Elasticsearch index for semantic search over learned facts and preferences

**Key Outcome:** When a user asks "What has Faye been texting about in DDS?", the agent can:

1. Resolve "Faye" → Person UUID (even if her phone number changes)
2. Resolve "DDS" → Chat UUID (even if the group name changes)
3. Search with stable IDs instead of fragile name strings
4. Access prior context: "Faye is your coworker, you met at Stripe in 2022"

---

# 2. Problem Statement

### Current Pain Points

**2.1 No Entity Resolution**

The current system stores sender names as strings in Elasticsearch:

```json
{ "sender": "Faye Smith", "participants": ["Faye Smith", "You"] }
```

Problems:

- If ContactResolver returns "Faye" on one run and "Faye Smith" on another, searches break
- No way to link messages to a canonical person entity
- Can't answer: "Who is Faye? What's my relationship with her?"

**2.2 No Relationship Context**

The agent has no knowledge of:

- Who people are to the user (friend, coworker, family)
- What group chats people share
- Historical context about relationships

Every conversation starts from zero, requiring many searches to build context.

**2.3 No Persistent Learning**

When the agent discovers "Faye's birthday is March 15" from messages, it can't save this for future use. Next session, it must rediscover the same facts.

### Why Now?

As the message archive grows, the lack of entity resolution becomes more painful:

- 1M+ messages = more opportunities for name inconsistencies
- Complex queries require understanding relationships
- Users expect the agent to "remember" what it learned

---

# 3. Goals and Non-Goals

### Goals

| Goal | Success Criteria |

|------|------------------|

| Stable entity references | Every ES document has `sender_id` and `chat_id` UUIDs |

| Person resolution | `resolve_person("faye")` returns canonical Person in <10ms |

| Relationship tracking | Can query "Who is X to me?" and get relationship type |

| Chat resolution | `resolve_chat("DDS")` returns canonical Chat with participants |

| Memory persistence | Agent can save and retrieve facts across sessions |

| Zero-cost migration | Preserve existing embeddings, no OpenAI API spend |

### Non-Goals (Out of Scope)

| Non-Goal | Rationale |

|----------|-----------|

| Graph traversal (friends of friends) | Simple 1-hop queries sufficient; add Neo4j later if needed |

| Automatic relationship inference | Manual enrichment preferred for accuracy |

| Real-time sync with Contacts.app | One-time import during indexing is sufficient |

| Multi-user support | Single-owner archive; can extend later |

| UI for editing People/Chats | CLI + agent tools first; dashboard UI later |

---

# 4. Glossary

### Core Vocabulary

| Term | Definition | Example |

|------|------------|---------|

| **Handle** | Raw identifier from iMessage. Phone number, email, or Apple ID. One person can have multiple handles. | `+14155551234`, `faye@gmail.com` |

| **Person** | A unique individual with a stable UUID. Has name, handles, aliases, relationships. | Faye Smith (UUID: `abc-123`) |

| **Chat** | A conversation thread with a stable UUID. Can be DM (2 people) or group (3+). | "DDS" group (UUID: `gc-456`) |

| **Owner** | The iMessage archive owner (you). A Person with `is_owner: true`. | Your UUID: `owner-789` |

| **Alias** | Alternate name for Person or Chat. Used for fuzzy resolution. | "FS" → Faye Smith |

| **Relationship** | Labeled edge between two people. | Faye → Sarah: "coworker" |

| **Memory** | A learned fact stored for future retrieval. Linked to people/chats. | "Faye's birthday is March 15" |

| **auto_created** | Flag indicating entity was created during indexing vs manually enriched. | `true` = needs enrichment |

| **handle_normalized** | Standardized form of handle for reliable lookup. | `+1 (415) 555-1234` → `4155551234` |

### Field Reference

| Field | Table | Type | Required | Description |

|-------|-------|------|----------|-------------|

| `id` | all | UUID | Yes | Auto-generated UUIDv4. Never changes. |

| `name` | people | text | Yes | Primary display name |

| `is_owner` | people | boolean | No | `true` only for archive owner |

| `auto_created` | people, chats | boolean | No | `true` if created by indexer |

| `notes` | people, chats | text | No | Free-form context notes |

| `handle` | handles | text | Yes | Original iMessage identifier |

| `handle_normalized` | handles | text | Yes | Normalized for lookup |

| `type` | handles | text | Yes | `phone`, `email`, or `appleid` |

| `alias` | aliases | text | Yes | Alternate name (original case) |

| `alias_lower` | aliases | text | Yes | Lowercase for case-insensitive search |

| `is_primary` | aliases | boolean | No | Preferred alias for display |

| `from_person_id` | relationships | UUID | Yes | Source person |

| `to_person_id` | relationships | UUID | Yes | Target person |

| `type` | relationships | text | Yes | Relationship type: `friend`, `family`, `coworker`, `dating`, `roommate` |

| `description` | relationships | text | No | Context: "Met at Stanford 2019" |

| `imessage_id` | chats | text | Yes | Original `chat_guid` from iMessage |

| `display_name` | chats | text | No | Group chat name (null for DMs) |

| `is_group_chat` | chats | boolean | No | `true` if 3+ participants |

| `joined_at` | chat_participants | datetime | No | When person joined (null = original) |

| `left_at` | chat_participants | datetime | No | When person left (null = still in) |

---

# 5. Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SYSTEM ARCHITECTURE                            │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                         INDEXING PIPELINE                               ││
│  │                                                                         ││
│  │   iMessage DB          People Graph           Elasticsearch            ││
│  │  ┌───────────┐        ┌─────────────┐        ┌─────────────┐          ││
│  │  │           │        │             │        │             │          ││
│  │  │  handle:  │───────>│ resolveOr   │───────>│ sender_id:  │          ││
│  │  │  +1415... │        │ Create()    │        │ abc-123     │          ││
│  │  │           │        │             │        │             │          ││
│  │  │  chat_id: │───────>│ → Person    │        │ chat_id:    │          ││
│  │  │  guid123  │        │ → Chat      │        │ gc-456      │          ││
│  │  │           │        │   UUIDs     │        │             │          ││
│  │  └───────────┘        └─────────────┘        └─────────────┘          ││
│  │                              │                                         ││
│  │                              ▼                                         ││
│  │                       ┌─────────────┐                                  ││
│  │                       │ SQLite DB   │                                  ││
│  │                       │ people.db   │                                  ││
│  │                       └─────────────┘                                  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                           QUERY FLOW                                    ││
│  │                                                                         ││
│  │   User: "What has Faye said in DDS this week?"                         ││
│  │                        │                                                ││
│  │                        ▼                                                ││
│  │   ┌────────────────────────────────────────────────────────────────┐   ││
│  │   │ 1. resolve_person("Faye")                                       │   ││
│  │   │    → Search aliases WHERE alias_lower = 'faye'                  │   ││
│  │   │    → Return Person { id: "abc-123", name: "Faye Smith", ... }   │   ││
│  │   └────────────────────────────────────────────────────────────────┘   ││
│  │                        │                                                ││
│  │                        ▼                                                ││
│  │   ┌────────────────────────────────────────────────────────────────┐   ││
│  │   │ 2. resolve_chat("DDS")                                          │   ││
│  │   │    → Search chat_aliases WHERE alias_lower = 'dds'              │   ││
│  │   │    → Return Chat { id: "gc-456", display_name: "DDS", ... }     │   ││
│  │   └────────────────────────────────────────────────────────────────┘   ││
│  │                        │                                                ││
│  │                        ▼                                                ││
│  │   ┌────────────────────────────────────────────────────────────────┐   ││
│  │   │ 3. Search Elasticsearch                                         │   ││
│  │   │    {                                                            │   ││
│  │   │      "query": {                                                 │   ││
│  │   │        "bool": {                                                │   ││
│  │   │          "filter": [                                            │   ││
│  │   │            { "term": { "sender_id": "abc-123" }},              │   ││
│  │   │            { "term": { "chat_id": "gc-456" }},                 │   ││
│  │   │            { "range": { "timestamp": { "gte": "now-7d" }}}     │   ││
│  │   │          ]                                                      │   ││
│  │   │        }                                                        │   ││
│  │   │      }                                                          │   ││
│  │   │    }                                                            │   ││
│  │   └────────────────────────────────────────────────────────────────┘   ││
│  │                        │                                                ││
│  │                        ▼                                                ││
│  │   Results with stable person references                                 ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

# 6. Data Model

## 6.1 SQLite Schema (Drizzle ORM)

### Why SQLite + Drizzle?

| Consideration | SQLite | Postgres | Decision |

|---------------|--------|----------|----------|

| Setup complexity | Zero (file-based) | Requires server | SQLite for now |

| Performance | Fast for <100K rows | Better at scale | SQLite sufficient |

| Portability | Single file, easy backup | Requires dump | SQLite wins |

| Migration to Postgres | Trivial with Drizzle | N/A | Safe choice |

| ORM | Drizzle (type-safe, lightweight) | Same | Drizzle |

### Full Schema

```typescript
// src/db/schema.ts

import { sqliteTable, text, integer, index, uniqueIndex, unique } from 'drizzle-orm/sqlite-core';
import { randomUUID } from 'crypto';

// ============================================================
// HELPERS
// ============================================================

// Auto-generate UUIDv4 on insert - no manual ID creation needed
const uuid = () => text('id').primaryKey().$defaultFn(() => randomUUID());

const timestamps = {
  created_at: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updated_at: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
};

// ============================================================
// PEOPLE TABLE
// Purpose: Canonical person entities with stable UUIDs
// ============================================================

export const people = sqliteTable('people', {
  id: uuid(),
  name: text('name').notNull(),                // Primary display name
  notes: text('notes'),                        // Free-form context: "Works at Stripe, night owl"
  is_owner: integer('is_owner', { mode: 'boolean' }).default(false),  // TRUE only for "me"
  auto_created: integer('auto_created', { mode: 'boolean' }).default(true),  // FALSE when enriched
  ...timestamps,
}, (table) => ({
  ownerIdx: index('people_owner_idx').on(table.is_owner),  // Fast owner lookup
}));

// ============================================================
// HANDLES TABLE
// Purpose: Map raw iMessage identifiers (phone/email) to Person UUIDs
// Why separate table: One person can have multiple handles
// ============================================================

export const handles = sqliteTable('handles', {
  id: uuid(),
  person_id: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  handle: text('handle').notNull(),                        // Original: "+1 (415) 555-1234"
  handle_normalized: text('handle_normalized').notNull(),  // Normalized: "4155551234"
  type: text('type').notNull(),                            // "phone" | "email" | "appleid"
}, (table) => ({
  personIdx: index('handles_person_idx').on(table.person_id),
  // UNIQUE on normalized - prevents same handle assigned to multiple people
  handleIdx: uniqueIndex('handles_normalized_idx').on(table.handle_normalized),
}));

// ============================================================
// ALIASES TABLE
// Purpose: Alternate names for fuzzy person resolution
// Why separate table: One person can have many aliases
// ============================================================

export const aliases = sqliteTable('aliases', {
  id: uuid(),
  person_id: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),                          // Original case: "Faye"
  alias_lower: text('alias_lower').notNull(),              // Lowercase: "faye" (for search)
  is_primary: integer('is_primary', { mode: 'boolean' }).default(false),  // Preferred for display
}, (table) => ({
  personIdx: index('aliases_person_idx').on(table.person_id),
  aliasLowerIdx: index('aliases_alias_lower_idx').on(table.alias_lower),  // Fast case-insensitive search
}));

// ============================================================
// RELATIONSHIPS TABLE
// Purpose: Labeled connections between people (friend, family, etc.)
// Design: Bidirectional relationships stored on BOTH sides
//         (simpler queries, acceptable duplication for <10K people)
// ============================================================

export const relationships = sqliteTable('relationships', {
  id: uuid(),
  from_person_id: text('from_person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  to_person_id: text('to_person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),         // "friend" | "family" | "coworker" | "dating" | "roommate"
  description: text('description'),      // "Met at Stanford in 2019"
  created_at: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  fromIdx: index('rel_from_idx').on(table.from_person_id),
  toIdx: index('rel_to_idx').on(table.to_person_id),
  // Prevent duplicate: can't have two "friend" relationships between same people
  uniqueRel: unique('rel_unique').on(table.from_person_id, table.to_person_id, table.type),
}));

// ============================================================
// PERSON ATTRIBUTES TABLE
// Purpose: Extensible key-value metadata (birthday, location, etc.)
// Why separate table: Flexible schema without migrations
// ============================================================

export const person_attributes = sqliteTable('person_attributes', {
  id: uuid(),
  person_id: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),            // "birthday" | "location" | "occupation" | custom
  value: text('value').notNull(),        // "1995-03-15" | "San Francisco" | "Engineer"
}, (table) => ({
  personIdx: index('attrs_person_idx').on(table.person_id),
  // Prevent duplicate keys per person
  uniqueAttr: unique('attrs_unique').on(table.person_id, table.key),
}));

// ============================================================
// CHATS TABLE
// Purpose: Canonical chat entities with stable UUIDs
// ============================================================

export const chats = sqliteTable('chats', {
  id: uuid(),
  imessage_id: text('imessage_id').notNull(),  // Original chat_guid from iMessage
  display_name: text('display_name'),           // Group name: "DDS" (null for DMs)
  is_group_chat: integer('is_group_chat', { mode: 'boolean' }).default(false),
  notes: text('notes'),                         // "Ski trip planning chat"
  auto_created: integer('auto_created', { mode: 'boolean' }).default(true),
  ...timestamps,
}, (table) => ({
  imessageIdx: uniqueIndex('chats_imessage_idx').on(table.imessage_id),
}));

// ============================================================
// CHAT ALIASES TABLE
// Purpose: Alternate names for fuzzy chat resolution
// ============================================================

export const chat_aliases = sqliteTable('chat_aliases', {
  id: uuid(),
  chat_id: text('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
  alias_lower: text('alias_lower').notNull(),
}, (table) => ({
  chatIdx: index('chat_aliases_chat_idx').on(table.chat_id),
  aliasLowerIdx: index('chat_aliases_alias_lower_idx').on(table.alias_lower),
}));

// ============================================================
// CHAT PARTICIPANTS TABLE
// Purpose: Link people to chats (many-to-many)
// Tracks join/leave for participant history
// ============================================================

export const chat_participants = sqliteTable('chat_participants', {
  id: uuid(),
  chat_id: text('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  person_id: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  joined_at: text('joined_at'),          // null = original member
  left_at: text('left_at'),              // null = still in chat
}, (table) => ({
  chatIdx: index('chat_parts_chat_idx').on(table.chat_id),
  personIdx: index('chat_parts_person_idx').on(table.person_id),
  // Prevent duplicate: person can only be in a chat once (use left_at for rejoin)
  uniquePart: unique('chat_parts_unique').on(table.chat_id, table.person_id),
}));
```

## 6.2 Elasticsearch Schema Changes

Add these fields to `MessageDocument` in [src/db/elasticsearch.ts](src/db/elasticsearch.ts):

```typescript
// NEW FIELDS (add to existing MessageDocument interface)
interface MessageDocument {
  // ... existing fields ...
  
  // Person references (UUIDs from People Graph)
  sender_id: string;                    // Person UUID who sent message
  sender_handle: string;                // Original handle (for debugging)
  sender_name: string;                  // Denormalized display name
  is_from_owner: boolean;               // true if sender_id === owner's UUID
  
  // Chat reference (UUID from Chat Graph)
  chat_id: string;                      // Chat UUID
  chat_imessage_id: string;             // Original chat_guid (for debugging)
  chat_name: string | null;             // Denormalized display name
  
  // Participant references
  participant_ids: string[];            // All Person UUIDs in chat
  participant_handles: string[];        // Original handles (for debugging)
  participant_names: string[];          // Denormalized display names
}

// Add to INDEX_MAPPING
const NEW_MAPPINGS = {
  sender_id: { type: 'keyword' },
  sender_handle: { type: 'keyword' },
  sender_name: { type: 'keyword' },
  is_from_owner: { type: 'boolean' },
  chat_id: { type: 'keyword' },
  chat_imessage_id: { type: 'keyword' },
  chat_name: { type: 'keyword' },
  participant_ids: { type: 'keyword' },
  participant_handles: { type: 'keyword' },
  participant_names: { type: 'keyword' },
};
```

### Why Denormalize Names?

ES doesn't support joins. When displaying results, we need names without round-trips to SQLite.

| Field | Stored | Retrieved From | Purpose |

|-------|--------|----------------|---------|

| `sender_id` | UUID | - | Filtering, aggregations |

| `sender_name` | String | People Graph at index time | Display |

| `sender_handle` | String | iMessage DB | Debugging |

If a person's name changes, we can run `updateByQuery` to update `sender_name` across all their messages.

## 6.3 Memories Schema (Elasticsearch)

```typescript
// ES index: imessage_memories

interface Memory {
  id: string;                            // UUIDv4
  content: string;                       // "Faye's birthday is March 15"
  
  // Person/Chat links
  related_people: string[];              // Person UUIDs
  related_people_names: string[];        // Denormalized for display
  related_chats: string[];               // Chat UUIDs
  related_chat_names: string[];          // Denormalized for display
  
  // Categorization
  tags: string[];                        // ["birthday", "important-dates"]
  category: string;                      // "fact" | "preference" | "event" | "relationship"
  
  // Provenance
  source?: string;                       // "Learned from conversation on 2024-11-15"
  created_by: string;                    // "agent" | "user"
  
  // Retrieval
  embedding: number[];                   // 1536-dim for semantic search
  importance: number;                    // 1-5 (5 = highest)
  
  // Lifecycle
  expires_at?: Date;                     // For time-limited facts
  created_at: Date;
  updated_at: Date;
}

const MEMORIES_INDEX_MAPPING = {
  mappings: {
    properties: {
      content: { type: 'text', analyzer: 'english' },
      related_people: { type: 'keyword' },
      related_people_names: { type: 'keyword' },
      related_chats: { type: 'keyword' },
      related_chat_names: { type: 'keyword' },
      tags: { type: 'keyword' },
      category: { type: 'keyword' },
      source: { type: 'text' },
      created_by: { type: 'keyword' },
      embedding: { type: 'dense_vector', dims: 1536, index: true, similarity: 'cosine' },
      importance: { type: 'integer' },
      expires_at: { type: 'date' },
      created_at: { type: 'date' },
      updated_at: { type: 'date' },
    }
  },
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
  }
};
```

---

# 7. Tools / API Design

## 7.1 People Tools

### `resolve_person`

**Purpose:** Find a person by name, alias, or handle. Returns their UUID for use in ES queries.

```typescript
// Input
{ query: string }  // "Faye", "faye@gmail.com", "+14155551234"

// Output
{
  found: true,
  person: {
    id: "abc-123",
    name: "Faye Smith",
    handles: ["+14155551234", "faye@gmail.com"],
    aliases: ["Faye", "FS"],
    relationships: [{ person_name: "You", type: "coworker" }],
    notes: "Works at Stripe"
  }
}

// Or if not found
{ found: false, suggestions: ["Faye Smith", "Fay Johnson"] }
```

**Resolution Order:**

1. Exact handle match (normalized)
2. Exact alias match (case-insensitive)
3. Name contains query (fuzzy)

### `get_person_context`

**Purpose:** Get full context about a person, including relationships, chats, and memories.

```typescript
// Input
{ person_id: "abc-123" }

// Output
{
  person: { /* full person object */ },
  relationships: [
    { person: { id: "owner-789", name: "You" }, type: "coworker", description: "Met at Stripe" },
    { person: { id: "def-456", name: "Sarah" }, type: "friend" }
  ],
  chats: [
    { id: "gc-001", name: "DDS", participant_count: 5 },
    { id: "gc-002", name: "Stripe Eng", participant_count: 12 }
  ],
  memories: [
    { content: "Faye's birthday is March 15", importance: 4 },
    { content: "Faye prefers morning meetings", importance: 2 }
  ],
  message_stats: {
    total_messages: 1234,
    first_message: "2022-03-15",
    last_message: "2024-11-20"
  }
}
```

### `update_person`

**Purpose:** Enrich a person with aliases, relationships, attributes, or notes.

```typescript
// Input examples
{ person_id: "abc-123", add_alias: "FS" }
{ person_id: "abc-123", add_relationship: { to_person_id: "def-456", type: "friend" }}
{ person_id: "abc-123", set_attribute: { key: "birthday", value: "1995-03-15" }}
{ person_id: "abc-123", set_notes: "Works at Stripe, prefers Slack over text" }

// Output
{ success: true, person: { /* updated person */ }}
```

### `merge_people`

**Purpose:** Merge duplicate person entries (e.g., same person with two phone numbers created separately).

```typescript
// Input
{ keep_id: "abc-123", merge_id: "xyz-789" }

// What happens:
// 1. Move all handles from merge_id to keep_id
// 2. Move all aliases from merge_id to keep_id
// 3. Move all relationships from merge_id to keep_id
// 4. Update all ES documents where sender_id = merge_id
// 5. Delete merge_id person

// Output
{ success: true, merged_handles: 2, updated_messages: 1523 }
```

## 7.2 Chat Tools

### `resolve_chat`

```typescript
// Input
{ query: "DDS" }

// Output
{
  found: true,
  chat: {
    id: "gc-456",
    display_name: "DDS",
    aliases: ["Data Driven Squad", "the squad"],
    is_group_chat: true,
    participants: [
      { id: "abc-123", name: "Faye" },
      { id: "def-456", name: "Sarah" },
      { id: "owner-789", name: "You" }
    ],
    notes: "College friends group"
  }
}
```

### `get_chat_context`

Returns chat details, participants, and recent activity.

### `list_chats`

```typescript
// Input
{ person_id?: "abc-123", is_group?: true }

// Output: All chats matching filters
```

## 7.3 Memory Tools

### `search_memories`

```typescript
// Input
{
  query: "birthdays",          // Semantic search
  person_id?: "abc-123",       // Filter to memories about this person
  category?: "fact",           // Filter by category
  limit?: 10
}

// Output
{
  memories: [
    { id: "mem-1", content: "Faye's birthday is March 15", importance: 4, ... },
    { id: "mem-2", content: "Sarah's birthday is December 25", importance: 3, ... }
  ]
}
```

### `save_memory`

```typescript
// Input
{
  content: "Faye's birthday is March 15",
  related_people: ["abc-123"],
  category: "fact",
  importance: 4,
  confirm: true  // If true, agent asks user for confirmation before saving
}

// Output (if confirm: true)
{
  pending: true,
  confirmation_prompt: "Save this memory? 'Faye's birthday is March 15'",
  pending_id: "pending-xyz"
}

// After user confirms
{ success: true, memory_id: "mem-123" }
```

---

# 8. Migration Strategy

## Overview

**Goal:** Add People Graph + Chat Graph without losing existing embeddings.

**Key Insight:** We can UPDATE existing ES documents to add new fields. Embeddings are preserved. No OpenAI API cost.

## Step-by-Step Process

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: SETUP (< 1 minute)                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  $ pnpm install drizzle-orm drizzle-kit better-sqlite3                     │
│                                                                             │
│  Creates:                                                                   │
│  - data/people.db (SQLite database)                                        │
│  - Tables: people, handles, aliases, relationships, chats, etc.            │
│                                                                             │
│  Updates ES mapping (non-breaking, adds new fields):                        │
│  PUT /imessage_chunks/_mapping                                              │
│  { "properties": { "sender_id": { "type": "keyword" }, ... }}              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: DETECT OWNER (< 5 seconds)                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Query iMessage DB for all handles that sent messages with is_from_me=1:   │
│                                                                             │
│  SELECT DISTINCT h.id                                                       │
│  FROM handle h                                                              │
│  JOIN message m ON m.handle_id = h.ROWID                                   │
│  WHERE m.is_from_me = 1                                                     │
│                                                                             │
│  Create Person:                                                             │
│  {                                                                          │
│    id: "owner-abc-123",                                                     │
│    name: "Me",                                                              │
│    is_owner: true,                                                          │
│    handles: ["+14155551234", "me@icloud.com"]                              │
│  }                                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: BUILD GRAPHS (15-25 minutes for 1M messages)                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  For each message chunk in iMessage DB:                                     │
│                                                                             │
│  1. RESOLVE SENDER                                                          │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │ sender_handle: "+14155559999"                                   │    │
│     │              │                                                  │    │
│     │              ▼                                                  │    │
│     │ peopleGraph.resolveOrCreate(handle, displayName)               │    │
│     │              │                                                  │    │
│     │              ├── Found in handles table? → Return existing UUID │    │
│     │              │                                                  │    │
│     │              └── Not found? → Create new Person with UUID       │    │
│     │                               Insert into handles table         │    │
│     │                               Return new UUID                   │    │
│     │                                                                 │    │
│     │ Result: sender_id = "person-xyz-789"                           │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  2. RESOLVE ALL PARTICIPANTS (same process for each)                       │
│     participant_handles: ["+1415...", "+1650...", "me@..."]                │
│     → participant_ids: ["person-xyz", "person-abc", "owner-123"]           │
│                                                                             │
│  3. RESOLVE CHAT                                                            │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │ chat_guid: "chat123456789"                                      │    │
│     │              │                                                  │    │
│     │              ▼                                                  │    │
│     │ chatGraph.resolveOrCreate(imessage_id, displayName, isGroup)   │    │
│     │              │                                                  │    │
│     │              ├── Found? → Return existing UUID                  │    │
│     │              └── Not found? → Create new Chat, return UUID      │    │
│     │                                                                 │    │
│     │ Result: chat_id = "chat-gc-456"                                │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  4. LINK PARTICIPANTS TO CHAT                                               │
│     INSERT OR IGNORE INTO chat_participants (chat_id, person_id)           │
│     VALUES ("chat-gc-456", "person-xyz-789"), ...                          │
│                                                                             │
│  5. UPDATE ES DOCUMENT (preserve embedding!)                                │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │ Check: Does doc have text_embedding?                            │    │
│     │                                                                 │    │
│     │ YES → UPDATE only (no embedding cost!)                          │    │
│     │       POST /imessage_chunks/_update/doc123                      │    │
│     │       { "doc": { "sender_id": "...", "chat_id": "...", ... }}  │    │
│     │                                                                 │    │
│     │ NO → Full re-index (rare, only for missing docs)                │    │
│     │      Generate embedding, index complete document                │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: FINALIZE (< 1 minute)                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Create imessage_memories index (empty, ready for use)                  │
│                                                                             │
│  2. Log statistics:                                                         │
│     Migration complete!                                                     │
│     - People: 347 (1 owner + 346 contacts)                                 │
│     - Chats: 89 (52 group + 37 DM)                                         │
│     - Messages updated: 1,234,567                                           │
│     - New embeddings generated: 0 (all preserved!)                         │
│     - Cost: $0.00                                                           │
│                                                                             │
│  3. Verify with status command:                                             │
│     $ pnpm run status                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Commands Reference

```bash
# ============================================================
# INSTALLATION
# ============================================================

# Install new dependencies
pnpm install drizzle-orm drizzle-kit better-sqlite3

# ============================================================
# DATABASE SETUP
# ============================================================

# Generate migration from schema (creates SQL files)
pnpm drizzle-kit generate

# Apply migration to SQLite
pnpm drizzle-kit migrate

# Or for dev: apply schema directly (no migration files)
pnpm drizzle-kit push

# Open SQLite browser (if installed)
sqlite3 data/people.db

# ============================================================
# MIGRATION
# ============================================================

# Backup ES index first (recommended)
curl -X PUT "localhost:9200/imessage_chunks/_settings" \
  -H "Content-Type: application/json" \
  -d '{"index.blocks.write": true}'
curl -X POST "localhost:9200/imessage_chunks/_clone/imessage_chunks_backup"
curl -X PUT "localhost:9200/imessage_chunks/_settings" \
  -H "Content-Type: application/json" \
  -d '{"index.blocks.write": false}'

# Run migration
pnpm run migrate

# Check status
pnpm run status

# ============================================================
# ROLLBACK (if needed)
# ============================================================

# Restore ES from backup
curl -X DELETE "localhost:9200/imessage_chunks"
curl -X POST "localhost:9200/imessage_chunks_backup/_clone/imessage_chunks"

# Delete SQLite database
rm data/people.db

# ============================================================
# ONGOING USAGE
# ============================================================

# Re-index new messages (uses People/Chat Graph)
pnpm run index

# Open Drizzle Studio (visual DB browser)
pnpm drizzle-kit studio
```

---

# 9. Tradeoffs & Alternatives Considered

## Storage Choice

| Option | Pros | Cons | Decision |

|--------|------|------|----------|

| **SQLite + Drizzle** | Zero setup, portable, type-safe ORM, trivial Postgres migration | Single-writer, no network access | **Chosen** |

| Postgres (Neon) | Production-ready, multi-client | Requires network, setup complexity | Later migration path |

| JSON file | Simplest possible | No queries, no indexes, manual parsing | Too limited |

| Neo4j | Native graph queries | Another system to maintain, overkill for 1-hop queries | Not needed |

## Relationship Storage

| Option | Pros | Cons | Decision |

|--------|------|------|----------|

| **Store on both sides** | Simple queries, no joins | Duplication, sync risk | **Chosen** (manageable at <10K people) |

| Store once with direction | No duplication | Complex queries, need to check both directions | Rejected |

| Separate edges table | Graph-like | Over-engineered for our use case | Rejected |

## Handle Normalization

| Option | Pros | Cons | Decision |

|--------|------|------|----------|

| **Store both original + normalized** | Display original, query normalized | Slight duplication | **Chosen** |

| Normalize only | Smaller storage | Lose original formatting | Rejected |

| Original only | No processing | Inconsistent lookups | Rejected |

## ES Field Strategy

| Option | Pros | Cons | Decision |

|--------|------|------|----------|

| **Add new fields, keep old** | Backwards compatible, gradual migration | Some redundancy | **Chosen** |

| Replace old fields | Clean schema | Breaking change, requires full reindex | Rejected |

| Use aliases | Dynamic field names | Complex, error-prone | Rejected |

---

# 10. Future Considerations

### Potential Enhancements (Not in Scope Now)

| Feature | Effort | Value | When to Consider |

|---------|--------|-------|------------------|

| Dashboard UI for People/Chats | Medium | High | After core is stable |

| Auto-suggest relationships from messages | High | Medium | Lots of labeled data needed |

| Contact sync from Apple Contacts | Medium | Medium | If users request |

| Relationship strength scoring | Low | Medium | After usage patterns emerge |

| Graph visualization | Medium | Low | Nice to have |

| Multi-user support | High | Low | Enterprise use case |

### Migration to Postgres

When SQLite limits are hit (unlikely for personal use):

```bash
# 1. Install Neon driver
pnpm add @neondatabase/serverless

# 2. Update drizzle.config.ts
export default {
  driver: 'neon-http',
  dbCredentials: { connectionString: process.env.DATABASE_URL }
};

# 3. Push schema
pnpm drizzle-kit push

# 4. Migrate data (one-time script)
pnpm run migrate:postgres
```

---

# 11. Implementation Plan

### Phase 1: Foundation (This PR)

1. Install Drizzle, create schema
2. Implement People Graph client
3. Implement Chat Graph client
4. Update ES schema
5. Create migration script
6. Run migration

### Phase 2: Tools

1. Implement MCP tools (resolve_person, etc.)
2. Register in server.ts
3. Test with MCP client

### Phase 3: Dashboard Integration

1. Add tools to chat API
2. Inject context into system prompt
3. Test end-to-end

### Phase 4: Memories

1. Create memories ES index
2. Implement memory tools
3. Add confirmation flow

---

# 12. Files to Create/Modify

### New Files

| File | Purpose |

|------|---------|

| `src/db/schema.ts` | Drizzle schema definitions |

| `src/db/people-graph.ts` | People Graph client (CRUD, resolution, caching) |

| `src/db/chat-graph.ts` | Chat Graph client (CRUD, resolution) |

| `src/db/memories.ts` | Memories ES client |

| `src/tools/people-tools.ts` | MCP tools for people |

| `src/tools/chat-tools.ts` | MCP tools for chats |

| `src/tools/memory-tools.ts` | MCP tools for memories |

| `src/scripts/migrate.ts` | One-time migration script |

| `drizzle.config.ts` | Drizzle configuration |

### Modified Files

| File | Changes |

|------|---------|

| `package.json` | Add drizzle-orm, drizzle-kit, better-sqlite3 |

| `src/db/elasticsearch.ts` | Add new fields, updateMapping method |

| `src/indexer/messages.ts` | Integrate People/Chat Graph |

| `src/server.ts` | Register new MCP tools |

| `chat-dashboard/app/api/chat/route.ts` | Add tools, inject system prompt context |

| `.gitignore` | Add `data/people.db`, `drizzle/` |

### To-dos

- [ ] Install drizzle-orm, drizzle-kit, better-sqlite3; create drizzle.config.ts
- [ ] Create src/db/schema.ts with full production schema
- [ ] Create src/db/people-graph.ts with caching and normalization
- [ ] Create src/db/chat-graph.ts
- [ ] Add new fields to ES schema and INDEX_MAPPING
- [ ] Create src/scripts/migrate.ts with full migration logic
- [ ] Create imessage_memories ES index schema
- [ ] Modify indexer to use People/Chat Graph
- [ ] Create src/tools/people-tools.ts with all tools
- [ ] Create src/tools/chat-tools.ts
- [ ] Create src/tools/memory-tools.ts
- [ ] Register all tools in src/server.ts
- [ ] Add tools + system prompt injection to chat/route.ts