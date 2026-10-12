import {
  pgTable,
  uuid,
  varchar,
  char,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '@/lib/id';

export const CLIENT_KINDS = ['person', 'company'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

export const CLIENT_LOCALES = ['en', 'de'] as const;
export type ClientLocale = (typeof CLIENT_LOCALES)[number];

export const ADDRESS_TYPES = ['postal', 'billing'] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];

/**
 * Clients table (TASK-0009).
 * Stores natural persons or corporate clients served by the studio.
 */
export const clients = pgTable(
  'clients',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    kind: varchar('kind', { length: 20 }).notNull().$type<ClientKind>(),
    displayName: varchar('display_name', { length: 200 }).notNull(),
    preferredLocale: varchar('preferred_locale', { length: 10 }).notNull().$type<ClientLocale>(),
    googleContactsSyncEnabled: boolean('google_contacts_sync_enabled').notNull().default(false),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  () => [
    check('clients_kind_check', sql`kind IN ('person', 'company')`),
    check('clients_preferred_locale_check', sql`preferred_locale IN ('en', 'de')`),
  ],
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;

/**
 * Client contacts table (TASK-0009).
 * Natural persons belonging to a client (e.g. wedding couple partners, corporate liaisons).
 */
export const clientContacts = pgTable(
  'client_contacts',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    givenName: varchar('given_name', { length: 100 }),
    familyName: varchar('family_name', { length: 100 }),
    email: varchar('email', { length: 254 }),
    emailNormalized: varchar('email_normalized', { length: 254 }),
    phone: varchar('phone', { length: 32 }),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'client_contacts_name_check',
      sql`(given_name IS NOT NULL AND length(trim(given_name)) > 0) OR (family_name IS NOT NULL AND length(trim(family_name)) > 0)`,
    ),
    index('client_contacts_client_id_idx').on(table.clientId),
    index('client_contacts_email_normalized_idx').on(table.emailNormalized),
    uniqueIndex('client_contacts_client_id_primary_idx')
      .on(table.clientId)
      .where(sql`is_primary = true`),
  ],
);

export type ClientContact = typeof clientContacts.$inferSelect;
export type NewClientContact = typeof clientContacts.$inferInsert;

/**
 * Client addresses table (TASK-0009).
 * Physical postal and billing addresses associated with a client.
 */
export const clientAddresses = pgTable(
  'client_addresses',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 20 }).notNull().$type<AddressType>(),
    line1: varchar('line1', { length: 200 }).notNull(),
    line2: varchar('line2', { length: 200 }),
    postalCode: varchar('postal_code', { length: 20 }).notNull(),
    city: varchar('city', { length: 100 }).notNull(),
    region: varchar('region', { length: 100 }),
    countryCode: char('country_code', { length: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('client_addresses_type_check', sql`type IN ('postal', 'billing')`),
    unique('client_addresses_client_id_type_unique').on(table.clientId, table.type),
    index('client_addresses_client_id_idx').on(table.clientId),
  ],
);

export type ClientAddress = typeof clientAddresses.$inferSelect;
export type NewClientAddress = typeof clientAddresses.$inferInsert;
