/**
 * Drizzle ORM Schema for People Graph and Chat Graph
 * 
 * This schema defines the SQLite tables for:
 * - People: Canonical person entities with stable UUIDs
 * - Handles: Maps iMessage identifiers (phone/email) to Person UUIDs
 * - Aliases: Alternate names for fuzzy person resolution
 * - Relationships: Labeled connections between people
 * - Person Attributes: Extensible key-value metadata
 * - Chats: Canonical chat entities with stable UUIDs
 * - Chat Aliases: Alternate names for chat resolution
 * - Chat Participants: Links people to chats (many-to-many)
 */

import { sqliteTable, text, integer, index, uniqueIndex, unique } from 'drizzle-orm/sqlite-core';
import { randomUUID } from 'crypto';

// ============================================================
// HELPERS
// ============================================================

/**
 * Auto-generate UUIDv4 on insert - no manual ID creation needed
 */
const uuid = () => text('id').primaryKey().$defaultFn(() => randomUUID());

/**
 * Standard timestamp fields for created_at and updated_at
 */
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

// ============================================================
// TYPE EXPORTS
// ============================================================

export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;

export type Handle = typeof handles.$inferSelect;
export type NewHandle = typeof handles.$inferInsert;

export type Alias = typeof aliases.$inferSelect;
export type NewAlias = typeof aliases.$inferInsert;

export type Relationship = typeof relationships.$inferSelect;
export type NewRelationship = typeof relationships.$inferInsert;

export type PersonAttribute = typeof person_attributes.$inferSelect;
export type NewPersonAttribute = typeof person_attributes.$inferInsert;

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;

export type ChatAlias = typeof chat_aliases.$inferSelect;
export type NewChatAlias = typeof chat_aliases.$inferInsert;

export type ChatParticipant = typeof chat_participants.$inferSelect;
export type NewChatParticipant = typeof chat_participants.$inferInsert;

// ============================================================
// RELATIONSHIP TYPE ENUM (for reference)
// ============================================================

export const RELATIONSHIP_TYPES = [
  'friend',
  'family',
  'coworker',
  'dating',
  'roommate',
  'acquaintance',
  'other',
] as const;

export type RelationshipType = typeof RELATIONSHIP_TYPES[number];

// ============================================================
// HANDLE TYPE ENUM (for reference)
// ============================================================

export const HANDLE_TYPES = ['phone', 'email', 'appleid'] as const;

export type HandleType = typeof HANDLE_TYPES[number];

// ============================================================
// MEMORY CATEGORY ENUM (for reference - used in ES)
// ============================================================

export const MEMORY_CATEGORIES = [
  'fact',
  'preference', 
  'event',
  'relationship',
] as const;

export type MemoryCategory = typeof MEMORY_CATEGORIES[number];

