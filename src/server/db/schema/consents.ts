import { pgTable, uuid, varchar, date, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '@/lib/id';
import { clientContacts } from './clients';
import type { ActorType } from './audit';

export const CONSENT_PURPOSES = ['marketing', 'image_usage'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const CONSENT_STATUSES = ['granted', 'withdrawn'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const CONSENT_METHODS = ['in_person', 'paper_form', 'email', 'phone', 'other'] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

/**
 * Consent records table (TASK-0014 / GDPR Art. 7(1) / KUG §22).
 * Stores immutable history of consent permissions per contact.
 * Corrections and withdrawals are recorded as new append-only rows.
 */
export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => clientContacts.id, { onDelete: 'cascade' }),
    purpose: varchar('purpose', { length: 50 }).notNull().$type<ConsentPurpose>(),
    status: varchar('status', { length: 20 }).notNull().$type<ConsentStatus>(),
    effectiveOn: date('effective_on', { mode: 'string' }).notNull(),
    method: varchar('method', { length: 20 }).notNull().$type<ConsentMethod>(),
    scope: varchar('scope', { length: 500 }),
    evidenceNote: varchar('evidence_note', { length: 500 }),
    recordedByActorType: varchar('recorded_by_actor_type', { length: 20 })
      .notNull()
      .$type<ActorType>(),
    recordedByActorId: varchar('recorded_by_actor_id', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('consent_records_purpose_check', sql`purpose IN ('marketing', 'image_usage')`),
    check('consent_records_status_check', sql`status IN ('granted', 'withdrawn')`),
    check(
      'consent_records_method_check',
      sql`method IN ('in_person', 'paper_form', 'email', 'phone', 'other')`,
    ),
    check(
      'consent_records_actor_type_check',
      sql`recorded_by_actor_type IN ('owner', 'client', 'system', 'agent', 'token')`,
    ),
    index('consent_records_contact_purpose_idx').on(
      table.contactId,
      table.purpose,
      table.effectiveOn.desc(),
      table.createdAt.desc(),
    ),
  ],
);

export const consent_records = consentRecords;
export type ConsentRecord = typeof consentRecords.$inferSelect;
export type NewConsentRecord = typeof consentRecords.$inferInsert;
