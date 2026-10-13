import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  text,
  index,
  unique,
  check,
  char,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '@/lib/id';

export const INQUIRY_FORM_STATUSES = ['draft', 'published', 'archived'] as const;
export type InquiryFormStatus = (typeof INQUIRY_FORM_STATUSES)[number];

export const INQUIRY_FORM_LOCALES = ['en', 'de'] as const;
export type InquiryFormLocale = (typeof INQUIRY_FORM_LOCALES)[number];

export interface InquiryFormFieldConfig {
  key: string;
  enabled: boolean;
  required: boolean;
  order: number;
}

export interface InquiryFormEventType {
  key: string;
  label_en: string;
  label_de: string;
}

/**
 * Inquiry forms table (TASK-0024 / ADR-0015 §5).
 * Studio inquiry forms configurable with fixed field catalogue and event types.
 */
export const inquiryForms = pgTable(
  'inquiry_forms',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    slug: varchar('slug', { length: 16 }).notNull().unique(),
    name: varchar('name', { length: 100 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('draft').$type<InquiryFormStatus>(),
    defaultLocale: varchar('default_locale', { length: 8 })
      .notNull()
      .default('en')
      .$type<InquiryFormLocale>(),
    fields: jsonb('fields').notNull().$type<InquiryFormFieldConfig[]>(),
    eventTypes: jsonb('event_types').notNull().$type<InquiryFormEventType[]>(),
    currentNoticeVersionId: uuid('current_notice_version_id').references(
      (): AnyPgColumn => inquiryFormNoticeVersions.id,
      { onDelete: 'restrict' },
    ),
    autoReplyEnabled: boolean('auto_reply_enabled').notNull().default(true),
    acceptUnverified: boolean('accept_unverified').notNull().default(false),
    successRedirectUrl: varchar('success_redirect_url', { length: 2048 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  () => [
    check('inquiry_forms_status_check', sql`status IN ('draft', 'published', 'archived')`),
    check('inquiry_forms_default_locale_check', sql`default_locale IN ('en', 'de')`),
  ],
);

export const inquiry_forms = inquiryForms;
export type InquiryForm = typeof inquiryForms.$inferSelect;
export type NewInquiryForm = typeof inquiryForms.$inferInsert;

/**
 * Inquiry form notice versions table (TASK-0024 / ADR-0015 §5).
 * Append-only immutable history of privacy notice text and policy URLs.
 */
export const inquiryFormNoticeVersions = pgTable(
  'inquiry_form_notice_versions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    formId: uuid('form_id')
      .notNull()
      .references((): AnyPgColumn => inquiryForms.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    acknowledgementTextEn: varchar('acknowledgement_text_en', { length: 500 }).notNull(),
    acknowledgementTextDe: varchar('acknowledgement_text_de', { length: 500 }).notNull(),
    privacyPolicyUrl: varchar('privacy_policy_url', { length: 2048 }).notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdByActorId: text('created_by_actor_id').notNull(),
  },
  (table) => [
    unique('inquiry_form_notice_versions_form_id_version_unique').on(table.formId, table.version),
    index('inquiry_form_notice_versions_form_id_idx').on(table.formId),
  ],
);

export const inquiry_form_notice_versions = inquiryFormNoticeVersions;
export type InquiryFormNoticeVersion = typeof inquiryFormNoticeVersions.$inferSelect;
export type NewInquiryFormNoticeVersion = typeof inquiryFormNoticeVersions.$inferInsert;

/**
 * Proof-of-work challenge replay table (TASK-0029 / ADR-0015 §4, §9).
 * Stores SHA-256 hashes of challenge signatures until expiration to prevent replay attacks.
 */
export const inquiryPowReplays = pgTable('inquiry_pow_replays', {
  signatureHash: char('signature_hash', { length: 64 }).primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const inquiry_pow_replays = inquiryPowReplays;
export type InquiryPowReplay = typeof inquiryPowReplays.$inferSelect;
export type NewInquiryPowReplay = typeof inquiryPowReplays.$inferInsert;
