import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  index,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '@/lib/id';
import { clients } from './clients';
import { inquiryForms, inquiryFormNoticeVersions } from './inquiry-forms';

export const LEAD_STATUSES = ['new', 'contacted', 'converted', 'archived', 'spam'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_VERIFICATIONS = ['verified', 'unverified'] as const;
export type LeadVerification = (typeof LEAD_VERIFICATIONS)[number];

export const LEAD_DELIVERY_MODES = ['hosted', 'embed', 'script_free'] as const;
export type LeadDeliveryMode = (typeof LEAD_DELIVERY_MODES)[number];

export const LEAD_LOCALES = ['en', 'de'] as const;
export type LeadLocale = (typeof LEAD_LOCALES)[number];

export const LEAD_AUTO_REPLY_STATUSES = [
  'not_applicable',
  'queued',
  'sent',
  'failed',
  'suppressed',
  'disabled',
  'pending',
] as const;
export type LeadAutoReplyStatus = (typeof LEAD_AUTO_REPLY_STATUSES)[number];

/**
 * Leads table (TASK-0026 / ADR-0015 §6).
 * Stores unqualified inquiries from people not yet converted to clients.
 */
export const leads = pgTable(
  'leads',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    clientId: uuid('client_id').references((): AnyPgColumn => clients.id, {
      onDelete: 'cascade',
    }),
    formId: uuid('form_id')
      .notNull()
      .references((): AnyPgColumn => inquiryForms.id, { onDelete: 'restrict' }),
    noticeVersionId: uuid('notice_version_id')
      .notNull()
      .references((): AnyPgColumn => inquiryFormNoticeVersions.id, { onDelete: 'restrict' }),
    noticeAcknowledgedAt: timestamp('notice_acknowledged_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('new').$type<LeadStatus>(),
    verification: varchar('verification', { length: 16 }).notNull().$type<LeadVerification>(),
    deliveryMode: varchar('delivery_mode', { length: 16 }).notNull().$type<LeadDeliveryMode>(),
    locale: varchar('locale', { length: 8 }).notNull().$type<LeadLocale>(),
    givenName: varchar('given_name', { length: 100 }),
    familyName: varchar('family_name', { length: 100 }),
    email: varchar('email', { length: 255 }),
    emailNormalized: varchar('email_normalized', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    eventTypeKey: varchar('event_type_key', { length: 40 }),
    eventDate: varchar('event_date', { length: 100 }),
    eventLocation: varchar('event_location', { length: 200 }),
    message: text('message'),
    autoReplyStatus: varchar('auto_reply_status', { length: 16 })
      .notNull()
      .default('not_applicable')
      .$type<LeadAutoReplyStatus>(),
    convertedAt: timestamp('converted_at', { withTimezone: true, mode: 'date' }),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'leads_status_check',
      sql`status IN ('new', 'contacted', 'converted', 'archived', 'spam')`,
    ),
    check('leads_verification_check', sql`verification IN ('verified', 'unverified')`),
    check('leads_delivery_mode_check', sql`delivery_mode IN ('hosted', 'embed', 'script_free')`),
    check('leads_locale_check', sql`locale IN ('en', 'de')`),
    check(
      'leads_auto_reply_status_check',
      sql`auto_reply_status IN ('not_applicable', 'queued', 'sent', 'failed', 'suppressed', 'disabled', 'pending')`,
    ),
    check('leads_converted_client_id_check', sql`(status = 'converted') = (client_id IS NOT NULL)`),
    check(
      'leads_converted_or_name_email_check',
      sql`status = 'converted' OR (given_name IS NOT NULL AND email IS NOT NULL)`,
    ),
    check('leads_message_length_check', sql`message IS NULL OR length(message) <= 2000`),
    index('leads_status_received_at_idx').on(table.status, table.receivedAt.desc()),
    index('leads_email_normalized_idx').on(table.emailNormalized),
    index('leads_client_id_idx').on(table.clientId),
    index('leads_last_activity_at_idx').on(table.lastActivityAt),
  ],
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
