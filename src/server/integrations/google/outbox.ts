import 'server-only';
import { eq, and, lte, asc, count, inArray } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';
import { logger } from '@/server/log';
import {
  googleContactsOutbox,
  type GoogleContactsOutboxItem,
} from '@/server/db/schema/google-contacts-outbox';
import { googleContactsLinks } from '@/server/db/schema/google-contacts-links';
import { clientContacts, clients } from '@/server/db/schema/clients';
import { GooglePeopleClient } from './people-client';

export type ClientGoogleSyncStatus = 'not_synced' | 'pending' | 'synced' | 'failed';

/**
 * Enqueues an UPSERT outbox entry for an individual contact.
 * Must be called within the same transaction that created or updated the contact.
 */
export async function enqueueContactUpsert(
  contactId: string,
  tx: DbClient = defaultDb,
): Promise<void> {
  const now = new Date();
  await tx.insert(googleContactsOutbox).values({
    id: generateUuidV7(),
    contactId,
    action: 'UPSERT',
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Enqueues a DELETE outbox entry for an individual contact with a known Google resourceName.
 * Must be called within the transaction.
 */
export async function enqueueContactDelete(
  contactId: string | null,
  resourceName: string,
  tx: DbClient = defaultDb,
): Promise<void> {
  const now = new Date();
  await tx.insert(googleContactsOutbox).values({
    id: generateUuidV7(),
    contactId,
    action: 'DELETE',
    payload: { resourceName, contactId: contactId ?? undefined },
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Enqueues UPSERT entries for all contacts of a client.
 * Called when a client opts in (google_contacts_sync_enabled = true).
 */
export async function enqueueClientContactsUpsert(
  clientId: string,
  tx: DbClient = defaultDb,
): Promise<number> {
  const contacts = await tx
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(eq(clientContacts.clientId, clientId));

  if (contacts.length === 0) return 0;

  const now = new Date();
  await tx.insert(googleContactsOutbox).values(
    contacts.map((c) => ({
      id: generateUuidV7(),
      contactId: c.id,
      action: 'UPSERT' as const,
      status: 'PENDING' as const,
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })),
  );

  return contacts.length;
}

/**
 * Enqueues DELETE entries for all linked contacts of a client.
 * Called when client sync is toggled OFF (google_contacts_sync_enabled = false).
 */
export async function enqueueClientContactsDelete(
  clientId: string,
  tx: DbClient = defaultDb,
): Promise<number> {
  const linkedRows = await tx
    .select({
      contactId: clientContacts.id,
      resourceName: googleContactsLinks.googleResourceName,
    })
    .from(clientContacts)
    .innerJoin(googleContactsLinks, eq(clientContacts.id, googleContactsLinks.contactId))
    .where(eq(clientContacts.clientId, clientId));

  if (linkedRows.length === 0) return 0;

  const now = new Date();
  await tx.insert(googleContactsOutbox).values(
    linkedRows.map((row) => ({
      id: generateUuidV7(),
      contactId: row.contactId,
      action: 'DELETE' as const,
      payload: { resourceName: row.resourceName, contactId: row.contactId },
      status: 'PENDING' as const,
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })),
  );

  return linkedRows.length;
}

/**
 * Retrieves a batch of pending outbox items ready for processing.
 */
export async function fetchPendingOutboxBatch(
  batchSize = 20,
  client: DbClient = defaultDb,
): Promise<GoogleContactsOutboxItem[]> {
  const now = new Date();
  return await client
    .select()
    .from(googleContactsOutbox)
    .where(
      and(eq(googleContactsOutbox.status, 'PENDING'), lte(googleContactsOutbox.nextAttemptAt, now)),
    )
    .orderBy(asc(googleContactsOutbox.createdAt), asc(googleContactsOutbox.id))
    .limit(batchSize);
}

/**
 * Marks an outbox item as in-progress.
 */
export async function markOutboxItemProcessing(
  id: string,
  client: DbClient = defaultDb,
): Promise<void> {
  await client
    .update(googleContactsOutbox)
    .set({
      status: 'PROCESSING',
      updatedAt: new Date(),
    })
    .where(eq(googleContactsOutbox.id, id));
}

/**
 * Deletes a successfully processed outbox entry.
 */
export async function deleteOutboxItem(id: string, client: DbClient = defaultDb): Promise<void> {
  await client.delete(googleContactsOutbox).where(eq(googleContactsOutbox.id, id));
}

/**
 * Updates an outbox item after a failure, scheduling retry or marking FAILED.
 */
export async function updateOutboxItemRetry(
  id: string,
  attempts: number,
  nextAttemptAt: Date,
  error: string,
  isTerminal: boolean,
  client: DbClient = defaultDb,
): Promise<void> {
  const now = new Date();
  // Strip any raw personal data or detailed JSON payloads from the error message
  const sanitizedError = error.replace(/https?:\/\/[^\s]+/g, '[REDACTED_URL]').slice(0, 500);

  await client
    .update(googleContactsOutbox)
    .set({
      status: isTerminal ? 'FAILED' : 'PENDING',
      attempts,
      nextAttemptAt,
      lastError: sanitizedError,
      updatedAt: now,
    })
    .where(eq(googleContactsOutbox.id, id));
}

/**
 * Counts failed outbox items across the instance.
 */
export async function getFailedOutboxCount(client: DbClient = defaultDb): Promise<number> {
  const [row] = await client
    .select({ total: count() })
    .from(googleContactsOutbox)
    .where(eq(googleContactsOutbox.status, 'FAILED'));
  return row?.total ?? 0;
}

/**
 * Returns computed Google sync status for a client.
 */
export async function getGoogleContactsSyncStatusForClient(
  clientId: string,
  client: DbClient = defaultDb,
): Promise<ClientGoogleSyncStatus> {
  const [clientRow] = await client
    .select({ syncEnabled: clients.googleContactsSyncEnabled })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!clientRow?.syncEnabled) {
    return 'not_synced';
  }

  // Fetch all contact IDs for this client
  const contacts = await client
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(eq(clientContacts.clientId, clientId));

  if (contacts.length === 0) {
    return 'synced';
  }

  const contactIds = contacts.map((c) => c.id);

  // Check outbox items
  const outboxItems = await client
    .select({ status: googleContactsOutbox.status })
    .from(googleContactsOutbox)
    .where(inArray(googleContactsOutbox.contactId, contactIds));

  if (outboxItems.some((item) => item.status === 'FAILED')) {
    return 'failed';
  }

  if (outboxItems.some((item) => item.status === 'PENDING' || item.status === 'PROCESSING')) {
    return 'pending';
  }

  // Check if all contacts are in links table
  const linkRows = await client
    .select({ id: googleContactsLinks.id })
    .from(googleContactsLinks)
    .where(inArray(googleContactsLinks.contactId, contactIds));

  if (linkRows.length >= contacts.length) {
    return 'synced';
  }

  return 'pending';
}

/**
 * Purges all synced contacts from Google People API and clears links table.
 * Used during owner disconnect when deleteSyncedContacts = true.
 */
export async function purgeAllGoogleContacts(
  client: DbClient = defaultDb,
  fetchFn?: typeof fetch,
): Promise<number> {
  const links = await client.select().from(googleContactsLinks);
  if (links.length === 0) return 0;

  const peopleClient = new GooglePeopleClient({ dbClient: client, fetchFn });

  let deletedCount = 0;
  for (const link of links) {
    try {
      await peopleClient.deleteContact(link.googleResourceName);
      deletedCount += 1;
    } catch (err) {
      logger.warn(
        {
          resourceName: link.googleResourceName,
          error: err instanceof Error ? err.message : String(err),
        },
        'Warning: failed to delete Google contact during disconnect purge',
      );
    }
  }

  // Remove all links
  await client.delete(googleContactsLinks);
  // Remove pending outbox items
  await client.delete(googleContactsOutbox);

  return deletedCount;
}
