import 'server-only';
import { eq } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { audit } from '@/server/audit';
import { logger } from '@/server/log';
import { generateUuidV7 } from '@/lib/id';
import { clientContacts, clients } from '@/server/db/schema/clients';
import { googleContactsLinks } from '@/server/db/schema/google-contacts-links';
import {
  fetchPendingOutboxBatch,
  markOutboxItemProcessing,
  deleteOutboxItem,
  updateOutboxItemRetry,
} from './outbox';
import { GooglePeopleClient, PeopleApiError } from './people-client';
import { calculateNextAttemptDate, isTerminalRetry, type BackoffOptions } from './backoff';

export interface SyncBatchOptions {
  batchSize?: number;
  dbClient?: DbClient;
  fetchFn?: typeof fetch;
  backoffOptions?: BackoffOptions;
  timeoutMs?: number;
}

export interface SyncBatchResult {
  batchSize: number;
  syncedCount: number;
  failedCount: number;
}

/**
 * Sync Outbox Worker (TASK-0021).
 * Processes batches of PENDING outbox items, executing People API calls
 * and updating the links table with optimistic concurrency control.
 */
export async function processOutboxBatch(options: SyncBatchOptions = {}): Promise<SyncBatchResult> {
  const dbClient = options.dbClient ?? defaultDb;
  const batchSize = options.batchSize ?? 20;
  const peopleClient = new GooglePeopleClient({
    fetchFn: options.fetchFn,
    dbClient,
    timeoutMs: options.timeoutMs ?? 10_000,
  });

  const batch = await fetchPendingOutboxBatch(batchSize, dbClient);
  if (batch.length === 0) {
    return { batchSize: 0, syncedCount: 0, failedCount: 0 };
  }

  let syncedCount = 0;
  let failedCount = 0;

  for (const item of batch) {
    try {
      await markOutboxItemProcessing(item.id, dbClient);

      if (item.action === 'UPSERT') {
        if (!item.contactId) {
          // Contact ID missing on UPSERT: discard invalid item
          await deleteOutboxItem(item.id, dbClient);
          continue;
        }

        // Fetch contact and client sync status
        const [contact] = await dbClient
          .select({
            id: clientContacts.id,
            clientId: clientContacts.clientId,
            givenName: clientContacts.givenName,
            familyName: clientContacts.familyName,
            phone: clientContacts.phone,
            syncEnabled: clients.googleContactsSyncEnabled,
          })
          .from(clientContacts)
          .innerJoin(clients, eq(clientContacts.clientId, clients.id))
          .where(eq(clientContacts.id, item.contactId))
          .limit(1);

        if (!contact) {
          // Contact or client was deleted: discard
          await deleteOutboxItem(item.id, dbClient);
          continue;
        }

        if (!contact.syncEnabled) {
          // Client has disabled sync: discard UPSERT
          await deleteOutboxItem(item.id, dbClient);
          continue;
        }

        // Check if contact already has a Google link
        const [existingLink] = await dbClient
          .select()
          .from(googleContactsLinks)
          .where(eq(googleContactsLinks.contactId, contact.id))
          .limit(1);

        const now = new Date();

        if (!existingLink) {
          // Create upstream contact
          const created = await peopleClient.createContact({
            givenName: contact.givenName,
            familyName: contact.familyName,
            phone: contact.phone,
          });

          await dbClient.insert(googleContactsLinks).values({
            id: generateUuidV7(),
            contactId: contact.id,
            googleResourceName: created.resourceName,
            googleEtag: created.etag,
            lastSyncedAt: now,
            createdAt: now,
            updatedAt: now,
          });
        } else {
          // Update upstream contact with optimistic concurrency (etag)
          let updated: { resourceName: string; etag: string };
          try {
            updated = await peopleClient.updateContact(
              existingLink.googleResourceName,
              {
                givenName: contact.givenName,
                familyName: contact.familyName,
                phone: contact.phone,
              },
              existingLink.googleEtag,
            );
          } catch (err) {
            // If contact was deleted upstream (404), recreate it
            if (err instanceof PeopleApiError && err.statusCode === 404) {
              updated = await peopleClient.createContact({
                givenName: contact.givenName,
                familyName: contact.familyName,
                phone: contact.phone,
              });
            } else {
              throw err;
            }
          }

          await dbClient
            .update(googleContactsLinks)
            .set({
              googleResourceName: updated.resourceName,
              googleEtag: updated.etag,
              lastSyncedAt: now,
              updatedAt: now,
            })
            .where(eq(googleContactsLinks.id, existingLink.id));
        }

        await deleteOutboxItem(item.id, dbClient);
        syncedCount += 1;
      } else {
        let resourceName: string | undefined = item.payload?.resourceName;

        if (!resourceName && item.contactId) {
          const [link] = await dbClient
            .select({ googleResourceName: googleContactsLinks.googleResourceName })
            .from(googleContactsLinks)
            .where(eq(googleContactsLinks.contactId, item.contactId))
            .limit(1);
          resourceName = link?.googleResourceName;
        }

        if (resourceName) {
          await peopleClient.deleteContact(resourceName);
        }

        // Remove link table row if contactId is known or by resourceName
        if (item.contactId) {
          await dbClient
            .delete(googleContactsLinks)
            .where(eq(googleContactsLinks.contactId, item.contactId));
        } else if (resourceName) {
          await dbClient
            .delete(googleContactsLinks)
            .where(eq(googleContactsLinks.googleResourceName, resourceName));
        }

        await deleteOutboxItem(item.id, dbClient);
        syncedCount += 1;
      }
    } catch (err) {
      failedCount += 1;
      const newAttempts = item.attempts + 1;
      const isTerminal = isTerminalRetry(newAttempts);
      const nextAttemptAt = calculateNextAttemptDate(newAttempts, options.backoffOptions);
      const errorMessage = err instanceof Error ? err.message : String(err);

      logger.warn(
        {
          outboxId: item.id,
          action: item.action,
          attempts: newAttempts,
          isTerminal,
        },
        'Outbox worker task failed',
      );

      await updateOutboxItemRetry(
        item.id,
        newAttempts,
        nextAttemptAt,
        errorMessage,
        isTerminal,
        dbClient,
      );
    }
  }

  // Audit event with counts ONLY (never PII)
  await audit(
    {
      actorType: 'system',
      actorId: 'google-contacts-sync-worker',
      action: 'integration.google.contacts_synced',
      targetType: 'integration',
      targetId: 'google',
      outcome: failedCount === 0 ? 'success' : 'failure',
      metadata: {
        batchSize: batch.length,
        syncedCount,
        failedCount,
      },
    },
    dbClient,
  );

  return {
    batchSize: batch.length,
    syncedCount,
    failedCount,
  };
}

export const runGoogleContactsSyncWorker = processOutboxBatch;
