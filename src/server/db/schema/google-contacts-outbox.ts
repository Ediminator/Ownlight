import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '@/lib/id';
import { clientContacts } from './clients';

export const OUTBOX_ACTIONS = ['UPSERT', 'DELETE'] as const;
export type OutboxAction = (typeof OUTBOX_ACTIONS)[number];

export const OUTBOX_STATUSES = ['PENDING', 'PROCESSING', 'FAILED'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export interface OutboxPayload {
  resourceName?: string;
  contactId?: string;
}

/**
 * Google Contacts Outbox table (TASK-0021).
 * Transactional outbox queue for asynchronous People API synchronisation.
 */
export const googleContactsOutbox = pgTable(
  'google_contacts_outbox',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    contactId: uuid('contact_id').references(() => clientContacts.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 16 }).notNull().$type<OutboxAction>(),
    payload: jsonb('payload').$type<OutboxPayload | null>(),
    status: varchar('status', { length: 16 }).notNull().default('PENDING').$type<OutboxStatus>(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('google_contacts_outbox_action_check', sql`action IN ('UPSERT', 'DELETE')`),
    check(
      'google_contacts_outbox_status_check',
      sql`status IN ('PENDING', 'PROCESSING', 'FAILED')`,
    ),
    index('google_contacts_outbox_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
  ],
);

export type GoogleContactsOutboxItem = typeof googleContactsOutbox.$inferSelect;
export type NewGoogleContactsOutboxItem = typeof googleContactsOutbox.$inferInsert;
