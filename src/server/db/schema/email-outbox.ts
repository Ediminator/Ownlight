import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '@/lib/id';
import { leads } from './leads';

export const EMAIL_OUTBOX_KINDS = ['lead_auto_reply'] as const;
export type EmailOutboxKind = (typeof EMAIL_OUTBOX_KINDS)[number];

export const EMAIL_OUTBOX_STATUSES = ['PENDING', 'PROCESSING', 'FAILED'] as const;
export type EmailOutboxStatus = (typeof EMAIL_OUTBOX_STATUSES)[number];

/**
 * Transactional Email Outbox table (TASK-0030 / ADR-0015 §7).
 * Ephemeral queue for transactional email dispatch with zero copied PII.
 */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    kind: varchar('kind', { length: 32 }).notNull().$type<EmailOutboxKind>(),
    leadId: uuid('lead_id')
      .notNull()
      .references((): AnyPgColumn => leads.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<EmailOutboxStatus>(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    lastError: varchar('last_error', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('email_outbox_kind_check', sql`kind IN ('lead_auto_reply')`),
    check('email_outbox_status_check', sql`status IN ('PENDING', 'PROCESSING', 'FAILED')`),
    index('email_outbox_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
  ],
);

export const email_outbox = emailOutbox;
export type EmailOutboxItem = typeof emailOutbox.$inferSelect;
export type NewEmailOutboxItem = typeof emailOutbox.$inferInsert;
