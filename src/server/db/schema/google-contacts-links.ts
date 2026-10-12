import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '@/lib/id';
import { clientContacts } from './clients';

/**
 * Google Contacts Links table (TASK-0021).
 * Maps Ownlight client contacts to their upstream Google People API resource.
 */
export const googleContactsLinks = pgTable('google_contacts_links', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),
  contactId: uuid('contact_id')
    .notNull()
    .unique()
    .references(() => clientContacts.id, { onDelete: 'cascade' }),
  googleResourceName: text('google_resource_name').notNull(),
  googleEtag: text('google_etag').notNull(),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type GoogleContactsLink = typeof googleContactsLinks.$inferSelect;
export type NewGoogleContactsLink = typeof googleContactsLinks.$inferInsert;
