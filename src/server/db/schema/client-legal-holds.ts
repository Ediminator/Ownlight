import { pgTable, uuid, varchar, date, timestamp, check, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '@/lib/id';
import { clients } from './clients';
import type { ActorType } from './audit';
import { getTodayDateString } from '@/server/consents/schema';

export const CLIENT_LEGAL_HOLD_REASONS = ['dispute', 'statutory', 'other'] as const;
export type ClientLegalHoldReason = (typeof CLIENT_LEGAL_HOLD_REASONS)[number];

/**
 * Client legal holds table (TASK-0019 / ADR-0012 §4.3).
 * Represents a manual per-client legal hold that pauses automatic retention
 * and prevents manual erasure while active.
 */
export const clientLegalHolds = pgTable(
  'client_legal_holds',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' })
      .unique(),
    reason: varchar('reason', { length: 50 }).notNull().$type<ClientLegalHoldReason>(),
    note: varchar('note', { length: 500 }),
    until: date('until', { mode: 'string' }),
    setByActorType: varchar('set_by_actor_type', { length: 20 }).notNull().$type<ActorType>(),
    setByActorId: varchar('set_by_actor_id', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('client_legal_holds_reason_check', sql`reason IN ('dispute', 'statutory', 'other')`),
    check(
      'client_legal_holds_actor_type_check',
      sql`set_by_actor_type IN ('owner', 'client', 'system', 'agent', 'token')`,
    ),
    uniqueIndex('client_legal_holds_client_id_idx').on(table.clientId),
  ],
);

export type ClientLegalHold = typeof clientLegalHolds.$inferSelect;
export type NewClientLegalHold = typeof clientLegalHolds.$inferInsert;

/**
 * Determines whether a legal hold is currently active.
 * A hold is active if `until` is NULL (indefinite) or `until >= CURRENT_DATE` in the studio timezone.
 */
export function isHoldActive(
  until: string | null | undefined,
  studioTimezone = 'UTC',
  now = new Date(),
): boolean {
  if (until === null || until === undefined || until === '') {
    return true;
  }
  const today = getTodayDateString(studioTimezone, now);
  return until >= today;
}
