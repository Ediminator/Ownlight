import { pgTable, uuid, varchar, timestamp, boolean, text } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '@/lib/id';

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
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type StudioSettings = typeof studioSettings.$inferSelect;
export type NewStudioSettings = typeof studioSettings.$inferInsert;
