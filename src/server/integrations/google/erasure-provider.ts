import 'server-only';
import { eq, inArray, count } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { clientContacts } from '@/server/db/schema/clients';
import { googleContactsLinks } from '@/server/db/schema/google-contacts-links';
import { googleContactsOutbox } from '@/server/db/schema/google-contacts-outbox';
import { GooglePeopleClient } from './people-client';
import { logger } from '@/server/log';
import type { ErasureProvider, ErasureSubject } from '@/server/privacy/erasure/types';

/**
 * Helper to fetch all contact IDs for a given client.
 */
async function getClientContactIds(clientId: string, tx: DbClient): Promise<string[]> {
  const rows = await tx
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(eq(clientContacts.clientId, clientId));
  return rows.map((r) => r.id);
}

/**
 * Erasure provider for Google Contacts sync (TASK-0016 / TASK-0021 AC-7).
 * Ensures that whenever a client or contact is erased:
 * 1. The remote resource on Google Contacts is deleted via Google People API.
 * 2. The mapping record in google_contacts_links is deleted.
 * 3. Any pending outbox actions in google_contacts_outbox are removed.
 */
export const googleContactsErasureProvider: ErasureProvider = {
  id: 'google_contacts',
  category: 'google_contacts',
  coveredTables: ['google_contacts_links', 'google_contacts_outbox'],
  subjectKinds: ['client', 'contact'] as const,

  plan: async (subject: ErasureSubject, tx: DbClient): Promise<number> => {
    if (subject.kind === 'lead') return 0;
    if (subject.kind === 'client') {
      const contactIds = await getClientContactIds(subject.clientId, tx);
      if (contactIds.length === 0) return 0;
      const [res] = await tx
        .select({ count: count() })
        .from(googleContactsLinks)
        .where(inArray(googleContactsLinks.contactId, contactIds));
      return res?.count ?? 0;
    } else {
      const [res] = await tx
        .select({ count: count() })
        .from(googleContactsLinks)
        .where(eq(googleContactsLinks.contactId, subject.contactId));
      return res?.count ?? 0;
    }
  },

  erase: async (subject: ErasureSubject, tx: DbClient): Promise<number> => {
    if (subject.kind === 'lead') return 0;
    const contactIds: string[] =
      subject.kind === 'client'
        ? await getClientContactIds(subject.clientId, tx)
        : [subject.contactId];

    if (contactIds.length === 0) {
      return 0;
    }

    // 1. Find all active Google contact links for these contacts
    const links = await tx
      .select({
        id: googleContactsLinks.id,
        contactId: googleContactsLinks.contactId,
        googleResourceName: googleContactsLinks.googleResourceName,
      })
      .from(googleContactsLinks)
      .where(inArray(googleContactsLinks.contactId, contactIds));

    // 2. Delete remote contact from Google People API for each link
    const peopleClient = new GooglePeopleClient({ dbClient: tx });
    for (const link of links) {
      try {
        await peopleClient.deleteContact(link.googleResourceName);
      } catch (err) {
        // Log warning; continue with database erasure so local GDPR Art. 17 erasure is not aborted
        logger.warn(
          {
            err,
            resourceName: link.googleResourceName,
            contactId: link.contactId,
          },
          'Failed to delete remote contact from Google during erasure',
        );
      }
    }

    // 3. Delete link table rows
    let deletedCount = 0;
    if (links.length > 0) {
      const deletedLinks = await tx
        .delete(googleContactsLinks)
        .where(inArray(googleContactsLinks.contactId, contactIds))
        .returning({ id: googleContactsLinks.id });
      deletedCount = deletedLinks.length;
    }

    // 4. Remove any pending or failed outbox entries for these contacts
    await tx
      .delete(googleContactsOutbox)
      .where(inArray(googleContactsOutbox.contactId, contactIds));

    return deletedCount;
  },
};
