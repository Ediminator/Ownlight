import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '@/lib/id';
import { leads } from './leads';
import { appointments } from './calendar';
import { proposals } from './proposals';

export const EMAIL_OUTBOX_KINDS = [
  'lead_auto_reply',
  'appointment_confirmation',
  'appointment_cancellation',
  'proposal_sent',
  'proposal_accepted_client',
  'proposal_accepted_owner',
] as const;
export type EmailOutboxKind = (typeof EMAIL_OUTBOX_KINDS)[number];

export const EMAIL_OUTBOX_STATUSES = ['PENDING', 'PROCESSING', 'FAILED'] as const;
export type EmailOutboxStatus = (typeof EMAIL_OUTBOX_STATUSES)[number];

/**
 * Transactional Email Outbox table (TASK-0030 / TASK-0041 / TASK-0060 / ADR-0015 §7 / ADR-0018 §5).
 * Ephemeral queue for transactional email dispatch with zero copied PII.
 */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    kind: varchar('kind', { length: 32 }).notNull().$type<EmailOutboxKind>(),
    leadId: uuid('lead_id').references((): AnyPgColumn => leads.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id').references((): AnyPgColumn => appointments.id, {
      onDelete: 'cascade',
    }),
    proposalId: uuid('proposal_id').references((): AnyPgColumn => proposals.id, {
      onDelete: 'cascade',
    }),
    recipient: varchar('recipient', { length: 255 }),
    payload: jsonb('payload').$type<Record<string, unknown> | null>(),
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
    check(
      'email_outbox_kind_check',
      sql`kind IN ('lead_auto_reply', 'appointment_confirmation', 'appointment_cancellation', 'proposal_sent', 'proposal_accepted_client', 'proposal_accepted_owner')`,
    ),
    check('email_outbox_status_check', sql`status IN ('PENDING', 'PROCESSING', 'FAILED')`),
    index('email_outbox_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
    index('email_outbox_appointment_id_idx').on(table.appointmentId),
    index('email_outbox_proposal_id_idx').on(table.proposalId),
  ],
);

export const email_outbox = emailOutbox;
export type EmailOutboxItem = typeof emailOutbox.$inferSelect;
export type NewEmailOutboxItem = typeof emailOutbox.$inferInsert;
