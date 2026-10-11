import { pgTable, uuid, varchar, text, timestamp, jsonb, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '@/lib/id';
import { clients } from './clients';
import type { ActorType } from './audit';

/**
 * Client timeline events table (ADR-0011 / TASK-0013).
 * Records lifecycle and relationship history events for a client.
 * Content is resolved at read time; the data column contains only non-identifying metadata.
 */
export const clientTimelineEvents = pgTable(
  'client_timeline_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 100 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    actorType: varchar('actor_type', { length: 20 }).notNull().$type<ActorType>(),
    actorId: varchar('actor_id', { length: 100 }),
    subjectType: varchar('subject_type', { length: 50 }),
    subjectId: varchar('subject_id', { length: 100 }),
    data: jsonb('data')
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'client_timeline_events_actor_type_check',
      sql`actor_type IN ('owner', 'client', 'system', 'agent', 'token')`,
    ),
    index('client_timeline_events_client_occurred_idx').on(
      table.clientId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const client_timeline_events = clientTimelineEvents;
export type ClientTimelineEvent = typeof clientTimelineEvents.$inferSelect;
export type NewClientTimelineEvent = typeof clientTimelineEvents.$inferInsert;

/**
 * Client notes table (TASK-0013).
 * Free text notes recorded by studio owners about a client.
 */
export const clientNotes = pgTable(
  'client_notes',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('client_notes_body_len_check', sql`char_length(body) >= 1 AND char_length(body) <= 5000`),
    index('client_notes_client_id_idx').on(table.clientId),
  ],
);

export const client_notes = clientNotes;
export type ClientNote = typeof clientNotes.$inferSelect;
export type NewClientNote = typeof clientNotes.$inferInsert;
