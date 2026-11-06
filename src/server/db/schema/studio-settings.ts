import {
  pgTable,
  uuid,
  varchar,
  char,
  timestamp,
  boolean,
  text,
  integer,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '@/lib/id';

export const CONTRACT_COUNTERSIGNATURE_MODES = ['pre_signed', 'explicit'] as const;
export type ContractCountersignatureMode = (typeof CONTRACT_COUNTERSIGNATURE_MODES)[number];

/**
 * Studio settings table (singleton row).
 *
 * Stores tenant/instance-wide studio profile and defaults.
 * Personal data: studio_name may identify a sole trader (GDPR Art. 6(1)(b)/(f)).
 */
export const studioSettings = pgTable('studio_settings', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),
  studio_name: varchar('studio_name', { length: 255 }).notNull(),
  default_locale: varchar('default_locale', { length: 10 }).notNull().default('en'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
  currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
  mfa_required: boolean('mfa_required').notNull().default(false),
  mfa_postponed_until: timestamp('mfa_postponed_until', { withTimezone: true, mode: 'date' }),
  forms_pow_hmac_key: text('forms_pow_hmac_key'),
  tax_number: varchar('tax_number', { length: 50 }),
  vat_id: varchar('vat_id', { length: 50 }),
  is_kleinunternehmer: boolean('is_kleinunternehmer').notNull().default(false),
  kleinunternehmer_notice: text('kleinunternehmer_notice'),
  default_tax_rate_basis_points: integer('default_tax_rate_basis_points').notNull().default(1900),
  prices_include_tax: boolean('prices_include_tax').notNull().default(true),
  contract_signatory_name: varchar('contract_signatory_name', { length: 200 }),
  contract_signatory_title: varchar('contract_signatory_title', { length: 100 }),
  contract_countersignature_mode: varchar('contract_countersignature_mode', { length: 32 })
    .notNull()
    .default('pre_signed')
    .$type<ContractCountersignatureMode>(),
  studio_address_line1: varchar('studio_address_line1', { length: 200 }),
  studio_address_line2: varchar('studio_address_line2', { length: 200 }),
  studio_postal_code: varchar('studio_postal_code', { length: 20 }),
  studio_city: varchar('studio_city', { length: 100 }),
  studio_country_code: char('studio_country_code', { length: 2 }).notNull().default('DE'),
  studio_phone: varchar('studio_phone', { length: 50 }),
  studio_email: varchar('studio_email', { length: 255 }),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type StudioSettings = typeof studioSettings.$inferSelect;
export type NewStudioSettings = typeof studioSettings.$inferInsert;
