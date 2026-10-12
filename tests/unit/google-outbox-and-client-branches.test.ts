import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import {
  createFakePeopleServer,
  type FakePeopleServerInstance,
} from '../helpers/fake-people-server';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { googleContactsLinks } from '@/server/db/schema/google-contacts-links';
import { googleContactsOutbox } from '@/server/db/schema/google-contacts-outbox';
import { encryptSecret } from '@/server/crypto/vault';
import { GOOGLE_OAUTH_PURPOSE } from '@/server/integrations/google/constants';
import { upsertGoogleOAuthToken } from '@/server/integrations/google/repo';
import { GooglePeopleClient, PeopleApiError } from '@/server/integrations/google/people-client';
import {
  getGoogleContactsSyncStatusForClient,
  purgeAllGoogleContacts,
  getFailedOutboxCount,
  enqueueClientContactsDelete,
  enqueueClientContactsUpsert,
  enqueueContactUpsert,
  enqueueContactDelete,
  updateOutboxItemRetry,
} from '@/server/integrations/google/outbox';
import { processOutboxBatch } from '@/server/integrations/google/sync-worker';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';

describe('TASK-0021: Google Outbox and PeopleClient Branch Coverage', () => {
  let testDb: TestDatabaseInstance;
  let fakePeople: FakePeopleServerInstance;

  const masterKey = '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a';
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    fakePeople = await createFakePeopleServer();

    process.env.ENCRYPTION_KEY = masterKey;
    process.env.GOOGLE_PEOPLE_API_BASE_URL = fakePeople.baseUrl;

    // Seed valid Google OAuth token
    const encryptedRefreshToken = await encryptSecret('refresh-token-xyz', GOOGLE_OAUTH_PURPOSE);
    await upsertGoogleOAuthToken(
      {
        encryptedRefreshToken,
        accessToken: 'valid-test-access-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        scope: 'https://www.googleapis.com/auth/contacts',
      },
      getDb(),
    );
  });

  afterEach(async () => {
    await fakePeople.close();
    process.env = { ...originalEnv };
  });

  function getDb(): DbClient {
    return testDb.db as unknown as DbClient;
  }

  describe('outbox.ts branches', () => {
    it('getGoogleContactsSyncStatusForClient: returns "not_synced" when client row is missing or sync is disabled', async () => {
      const dbClient = getDb();
      const nonExistent = await getGoogleContactsSyncStatusForClient(
        '018f0000-0000-7000-8000-000000000099',
        dbClient,
      );
      expect(nonExistent).toBe('not_synced');

      const clientId = '018f0000-0000-7000-8000-000000000001';
      await dbClient.insert(clients).values({
        id: clientId,
        displayName: 'Test Sync Disabled',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: false,
      });

      const disabledStatus = await getGoogleContactsSyncStatusForClient(clientId, dbClient);
      expect(disabledStatus).toBe('not_synced');
    });

    it('getGoogleContactsSyncStatusForClient: returns "synced" when client has no contacts', async () => {
      const dbClient = getDb();
      const clientId = '018f0000-0000-7000-8000-000000000002';
      await dbClient.insert(clients).values({
        id: clientId,
        displayName: 'Test No Contacts',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: true,
      });

      const status = await getGoogleContactsSyncStatusForClient(clientId, dbClient);
      expect(status).toBe('synced');
    });

    it('getGoogleContactsSyncStatusForClient: returns "failed" when any outbox item is FAILED', async () => {
      const dbClient = getDb();
      const clientId = '018f0000-0000-7000-8000-000000000003';
      const contactId = '018f0000-0000-7000-8000-000000000004';
      await dbClient.insert(clients).values({
        id: clientId,
        displayName: 'Test Failed Outbox',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: true,
      });
      await dbClient.insert(clientContacts).values({
        id: contactId,
        clientId,
        isPrimary: true,
        givenName: 'Fail',
        familyName: 'User',
      });
      await dbClient.insert(googleContactsOutbox).values({
        id: '018f0000-0000-7000-8000-000000000005',
        contactId,
        action: 'UPSERT',
        status: 'FAILED',
        attempts: 5,
        lastError: 'HTTP 429',
        nextAttemptAt: new Date(),
      });

      const status = await getGoogleContactsSyncStatusForClient(clientId, dbClient);
      expect(status).toBe('failed');
    });

    it('getGoogleContactsSyncStatusForClient: returns "pending" when items are PENDING or links are incomplete', async () => {
      const dbClient = getDb();
      const clientId = '018f0000-0000-7000-8000-000000000006';
      const contactId1 = '018f0000-0000-7000-8000-000000000007';
      const contactId2 = '018f0000-0000-7000-8000-000000000008';
      await dbClient.insert(clients).values({
        id: clientId,
        displayName: 'Test Partial Links',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: true,
      });
      await dbClient.insert(clientContacts).values([
        { id: contactId1, clientId, isPrimary: true, givenName: 'C1', familyName: 'User' },
        { id: contactId2, clientId, isPrimary: false, givenName: 'C2', familyName: 'User' },
      ]);

      // Only contactId1 is linked
      await dbClient.insert(googleContactsLinks).values({
        id: '018f0000-0000-7000-8000-000000000009',
        contactId: contactId1,
        googleResourceName: 'people/c1',
        googleEtag: 'etag1',
        lastSyncedAt: new Date(),
      });

      // No outbox items, but only 1 of 2 contacts linked -> pending
      const status = await getGoogleContactsSyncStatusForClient(clientId, dbClient);
      expect(status).toBe('pending');
    });

    it('enqueueClientContactsUpsert & enqueueClientContactsDelete return 0 on empty sets', async () => {
      const dbClient = getDb();
      const emptyClientId = '018f0000-0000-7000-8000-000000000010';
      const upsertCount = await enqueueClientContactsUpsert(emptyClientId, dbClient);
      expect(upsertCount).toBe(0);

      const deleteCount = await enqueueClientContactsDelete(emptyClientId, dbClient);
      expect(deleteCount).toBe(0);
    });

    it('purgeAllGoogleContacts: returns 0 when no links, and cleans up when links exist', async () => {
      const dbClient = getDb();
      const emptyPurge = await purgeAllGoogleContacts(dbClient);
      expect(emptyPurge).toBe(0);

      // Seed contact and link
      const clientId = '018f0000-0000-7000-8000-000000000011';
      const contactId = '018f0000-0000-7000-8000-000000000012';
      await dbClient.insert(clients).values({
        id: clientId,
        displayName: 'Purge Client',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: true,
      });
      await dbClient.insert(clientContacts).values({
        id: contactId,
        clientId,
        isPrimary: true,
        givenName: 'Purge',
        familyName: 'Test',
      });
      await dbClient.insert(googleContactsLinks).values({
        id: '018f0000-0000-7000-8000-000000000013',
        contactId,
        googleResourceName: 'people/purge-me',
        googleEtag: 'etag-purge',
        lastSyncedAt: new Date(),
      });
      await enqueueContactUpsert(contactId, dbClient);

      const count = await purgeAllGoogleContacts(dbClient);
      expect(count).toBe(1);

      const remainingLinks = await dbClient.select().from(googleContactsLinks);
      expect(remainingLinks).toHaveLength(0);

      const remainingOutbox = await dbClient.select().from(googleContactsOutbox);
      expect(remainingOutbox).toHaveLength(0);
    });

    it('getFailedOutboxCount and updateOutboxItemRetry report accurate counts', async () => {
      const dbClient = getDb();
      expect(await getFailedOutboxCount(dbClient)).toBe(0);

      const clientId = '018f0000-0000-7000-8000-000000000014';
      const contactId = '018f0000-0000-7000-8000-000000000015';
      const itemId = '018f0000-0000-7000-8000-000000000016';

      await dbClient.insert(clients).values({
        id: clientId,
        displayName: 'Fail Outbox Client',
        kind: 'person',
        preferredLocale: 'en',
      });
      await dbClient.insert(clientContacts).values({
        id: contactId,
        clientId,
        isPrimary: true,
        givenName: 'Fail',
        familyName: 'Item',
      });
      await dbClient.insert(googleContactsOutbox).values({
        id: itemId,
        contactId,
        action: 'UPSERT',
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(),
      });

      await updateOutboxItemRetry(itemId, 5, new Date(), 'Terminal error message', true, dbClient);
      expect(await getFailedOutboxCount(dbClient)).toBe(1);

      const [updated] = await dbClient
        .select()
        .from(googleContactsOutbox)
        .where(eq(googleContactsOutbox.id, itemId));
      expect(updated?.status).toBe('FAILED');
      expect(updated?.lastError).toBe('Terminal error message');
    });
  });

  describe('people-client.ts branches', () => {
    it('updateContact updates contact and throws PeopleApiError on error', async () => {
      const dbClient = getDb();
      const client = new GooglePeopleClient({ dbClient });

      fakePeople.contacts.set('people/existing-c1', {
        resourceName: 'people/existing-c1',
        etag: 'etag-abc',
        names: [{ givenName: 'Test', familyName: 'Person' }],
      });

      const updated = await client.updateContact(
        'people/existing-c1',
        { givenName: 'Updated', familyName: 'Person' },
        'etag-abc',
      );
      expect(updated.resourceName).toBe('people/existing-c1');

      fakePeople.setResponseOverride('PATCH', 'people/existing-c1', 500, {
        error: { message: 'Internal Server Error' },
      });

      await expect(
        client.updateContact('people/existing-c1', { givenName: 'Updated' }, 'etag-abc'),
      ).rejects.toThrow(PeopleApiError);
    });

    it('deleteContact handles 404 gracefully and throws PeopleApiError on server error', async () => {
      const dbClient = getDb();
      const client = new GooglePeopleClient({ dbClient });

      // Non-existent contact delete should succeed silently
      await expect(client.deleteContact('people/already-gone')).resolves.toBe(true);

      // Configure fake server to return 500 for server-error
      fakePeople.setResponseOverride('DELETE', 'server-error', 500, {
        error: { message: 'Internal Server Error' },
      });

      await expect(client.deleteContact('people/server-error')).rejects.toThrow(PeopleApiError);
    });

    it('throws PeopleApiError when token is missing from DB', async () => {
      const emptyDb = await createIsolatedTestDatabase();
      const client = new GooglePeopleClient({ dbClient: emptyDb.db as unknown as DbClient });

      await expect(
        client.createContact({
          names: [{ givenName: 'No', familyName: 'Token' }],
        }),
      ).rejects.toThrow(PeopleApiError);
    });
  });

  describe('sync-worker.ts branches', () => {
    it('processOutboxBatch: returns zeroes for empty outbox', async () => {
      const dbClient = getDb();
      const result = await processOutboxBatch({ dbClient });
      expect(result).toEqual({ batchSize: 0, syncedCount: 0, failedCount: 0 });
    });

    it('processOutboxBatch: handles UPSERT when contactId is missing by discarding invalid item', async () => {
      const dbClient = getDb();
      const outboxId = '018f0000-0000-7000-8000-000000000020';

      await dbClient.insert(googleContactsOutbox).values({
        id: outboxId,
        contactId: null,
        action: 'UPSERT',
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(),
      });

      const result = await processOutboxBatch({ dbClient });
      expect(result.failedCount).toBe(0);

      const [item] = await dbClient
        .select()
        .from(googleContactsOutbox)
        .where(eq(googleContactsOutbox.id, outboxId));
      expect(item).toBeUndefined();
    });

    it('processOutboxBatch: 5th failure transitions to FAILED status', async () => {
      const dbClient = getDb();
      const clientId = '018f0000-0000-7000-8000-000000000022';
      const contactId = '018f0000-0000-7000-8000-000000000023';

      await dbClient.insert(clients).values({
        id: clientId,
        displayName: 'Terminal Client',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: true,
      });
      await dbClient.insert(clientContacts).values({
        id: contactId,
        clientId,
        isPrimary: true,
        givenName: 'Term',
        familyName: 'User',
      });
      await dbClient.insert(googleContactsOutbox).values({
        id: '018f0000-0000-7000-8000-000000000029',
        contactId,
        action: 'UPSERT',
        status: 'PENDING',
        attempts: 4, // 5th attempt will be terminal
        nextAttemptAt: new Date(),
      });

      // Make next API call fail with 500 Server Error
      fakePeople.setResponseOverride('POST', 'createContact', 500, {
        error: { message: 'Internal Server Error' },
      });

      const result = await processOutboxBatch({ dbClient });
      expect(result.failedCount).toBe(1);

      const [item] = await dbClient
        .select()
        .from(googleContactsOutbox)
        .where(eq(googleContactsOutbox.contactId, contactId));
      expect(item?.status).toBe('FAILED');
      expect(item?.attempts).toBe(5);
    });

    it('processOutboxBatch: processes DELETE with contactId and removes link row', async () => {
      const dbClient = getDb();
      const clientId = '018f0000-0000-7000-8000-000000000024';
      const contactId = '018f0000-0000-7000-8000-000000000025';

      await dbClient.insert(clients).values({
        id: clientId,
        displayName: 'Delete Client',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: false,
      });
      await dbClient.insert(clientContacts).values({
        id: contactId,
        clientId,
        isPrimary: true,
        givenName: 'To Delete',
        familyName: 'User',
      });

      await dbClient.insert(googleContactsLinks).values({
        id: '018f0000-0000-7000-8000-000000000026',
        contactId,
        googleResourceName: 'people/delete-via-worker',
        googleEtag: 'etag-del',
        lastSyncedAt: new Date(),
      });
      fakePeople.contacts.set('people/delete-via-worker', {
        resourceName: 'people/delete-via-worker',
        etag: 'etag-del',
        names: [{ givenName: 'To Delete', familyName: 'User' }],
      });

      await enqueueContactDelete(contactId, 'people/delete-via-worker', dbClient);
      const result = await processOutboxBatch({ dbClient });
      expect(result.syncedCount).toBe(1);

      const remainingLinks = await dbClient
        .select()
        .from(googleContactsLinks)
        .where(eq(googleContactsLinks.contactId, contactId));
      expect(remainingLinks).toHaveLength(0);
    });

    it('processOutboxBatch: updates contact when link exists, and falls back to recreate on 404', async () => {
      const dbClient = getDb();
      const clientId = '018f0000-0000-7000-8000-000000000050';
      const contactId = '018f0000-0000-7000-8000-000000000051';
      const linkId = '018f0000-0000-7000-8000-000000000052';

      await dbClient.insert(clients).values({
        id: clientId,
        displayName: 'Recreate 404 Client',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: true,
      });
      await dbClient.insert(clientContacts).values({
        id: contactId,
        clientId,
        isPrimary: true,
        givenName: 'Recreated',
        familyName: 'User',
      });
      await dbClient.insert(googleContactsLinks).values({
        id: linkId,
        contactId,
        googleResourceName: 'people/missing-upstream-contact',
        googleEtag: 'old-etag',
        lastSyncedAt: new Date(),
      });
      // Notice: fakePeople does NOT have 'people/missing-upstream-contact', so updateContact returns 404!

      await enqueueContactUpsert(contactId, dbClient);
      const result = await processOutboxBatch({ dbClient });

      expect(result.syncedCount).toBe(1);
      const [updatedLink] = await dbClient
        .select()
        .from(googleContactsLinks)
        .where(eq(googleContactsLinks.contactId, contactId));
      expect(updatedLink?.googleResourceName).not.toBe('people/missing-upstream-contact');
      expect(updatedLink?.googleResourceName).toContain('people/');
    });

    it('processOutboxBatch: deletes contact using DB link fallback when DELETE payload has no resourceName', async () => {
      const dbClient = getDb();
      const clientId = '018f0000-0000-7000-8000-000000000059';
      const contactId = '018f0000-0000-7000-8000-000000000060';

      await dbClient.insert(clients).values({
        id: clientId,
        displayName: 'Fallback Delete Client',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: false,
      });
      await dbClient.insert(clientContacts).values({
        id: contactId,
        clientId,
        isPrimary: true,
        givenName: 'Fallback',
        familyName: 'Delete',
      });

      await dbClient.insert(googleContactsLinks).values({
        id: '018f0000-0000-7000-8000-000000000061',
        contactId,
        googleResourceName: 'people/fallback-lookup-delete',
        googleEtag: 'etag-fallback',
        lastSyncedAt: new Date(),
      });
      fakePeople.contacts.set('people/fallback-lookup-delete', {
        resourceName: 'people/fallback-lookup-delete',
        etag: 'etag-fallback',
        names: [{ givenName: 'Fallback', familyName: 'Delete' }],
      });

      // Insert DELETE outbox without payload
      await dbClient.insert(googleContactsOutbox).values({
        id: '018f0000-0000-7000-8000-000000000062',
        contactId,
        action: 'DELETE',
        status: 'PENDING',
        payload: null,
      });

      const result = await processOutboxBatch({ dbClient });
      expect(result.syncedCount).toBe(1);
      expect(fakePeople.contacts.has('people/fallback-lookup-delete')).toBe(false);

      const remainingLinks = await dbClient
        .select()
        .from(googleContactsLinks)
        .where(eq(googleContactsLinks.contactId, contactId));
      expect(remainingLinks).toHaveLength(0);
    });

    it('processOutboxBatch: deletes link by resourceName when contactId is absent', async () => {
      const dbClient = getDb();
      const clientId = '018f0000-0000-7000-8000-000000000069';
      const contactId = '018f0000-0000-7000-8000-000000000071';
      const resourceName = 'people/resource-name-only-delete';

      await dbClient.insert(clients).values({
        id: clientId,
        displayName: 'Resource Only Client',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: false,
      });
      await dbClient.insert(clientContacts).values({
        id: contactId,
        clientId,
        isPrimary: true,
        givenName: 'Resource',
        familyName: 'Only',
      });

      await dbClient.insert(googleContactsLinks).values({
        id: '018f0000-0000-7000-8000-000000000070',
        contactId,
        googleResourceName: resourceName,
        googleEtag: 'etag-res-only',
        lastSyncedAt: new Date(),
      });
      fakePeople.contacts.set(resourceName, {
        resourceName,
        etag: 'etag-res-only',
        names: [{ givenName: 'Resource', familyName: 'Only' }],
      });

      // Insert DELETE outbox without contactId, but with resourceName payload
      await dbClient.insert(googleContactsOutbox).values({
        id: '018f0000-0000-7000-8000-000000000072',
        action: 'DELETE',
        status: 'PENDING',
        payload: { resourceName },
      });

      const result = await processOutboxBatch({ dbClient });
      expect(result.syncedCount).toBe(1);
      expect(fakePeople.contacts.has(resourceName)).toBe(false);

      const remainingLinks = await dbClient
        .select()
        .from(googleContactsLinks)
        .where(eq(googleContactsLinks.googleResourceName, resourceName));
      expect(remainingLinks).toHaveLength(0);
    });

    it('processOutboxBatch: handles non-Error rejection in catch block', async () => {
      const dbClient = getDb();
      const clientId = '018f0000-0000-7000-8000-000000000080';
      const contactId = '018f0000-0000-7000-8000-000000000081';

      await dbClient.insert(clients).values({
        id: clientId,
        displayName: 'Non-Error Client',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: true,
      });
      await dbClient.insert(clientContacts).values({
        id: contactId,
        clientId,
        isPrimary: true,
        givenName: 'Non',
        familyName: 'Error',
      });
      await dbClient.insert(googleContactsOutbox).values({
        id: '018f0000-0000-7000-8000-000000000082',
        contactId,
        action: 'UPSERT',
        status: 'PENDING',
        attempts: 0,
      });

      // Mock dbClient.update chain to reject with Error during markOutboxItemProcessing
      vi.spyOn(dbClient, 'update').mockReturnValueOnce({
        set: () => ({
          where: () => Promise.reject(new Error('db-update-failure')),
        }),
      } as unknown as ReturnType<typeof dbClient.update>);

      const result = await processOutboxBatch({ dbClient });
      expect(result.failedCount).toBe(1);

      const [item] = await dbClient
        .select()
        .from(googleContactsOutbox)
        .where(eq(googleContactsOutbox.contactId, contactId));
      expect(item?.lastError).toContain('db-update-failure');
    });

    it('processOutboxBatch: discards UPSERT item when contact row does not exist', async () => {
      const dbClient = getDb();
      const clientId = '018f0000-0000-7000-8000-000000000090';
      const contactId = '018f0000-0000-7000-8000-000000000091';

      await dbClient.insert(clients).values({
        id: clientId,
        displayName: 'Discard Test Client',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: true,
      });
      await dbClient.insert(clientContacts).values({
        id: contactId,
        clientId,
        isPrimary: true,
        givenName: 'Test',
        familyName: 'User',
      });
      await dbClient.insert(googleContactsOutbox).values({
        id: '018f0000-0000-7000-8000-000000000092',
        contactId,
        action: 'UPSERT',
        status: 'PENDING',
      });

      // Simulate contact query returning empty (e.g. concurrent deletion during processing)
      const originalSelect = dbClient.select.bind(dbClient);
      let callCount = 0;
      vi.spyOn(dbClient, 'select').mockImplementation((...args) => {
        callCount++;
        // The second select in processOutboxBatch is the contact query
        if (callCount === 2) {
          return {
            from: () => ({
              innerJoin: () => ({
                where: () => ({
                  limit: () => Promise.resolve([]),
                }),
              }),
            }),
          } as unknown as ReturnType<typeof dbClient.select>;
        }
        return originalSelect(...args);
      });

      const result = await processOutboxBatch({ dbClient });
      expect(result.syncedCount).toBe(0);
      expect(result.failedCount).toBe(0);

      const [item] = await dbClient
        .select()
        .from(googleContactsOutbox)
        .where(eq(googleContactsOutbox.id, '018f0000-0000-7000-8000-000000000092'));
      expect(item).toBeUndefined();
    });

    it('processOutboxBatch: discards UPSERT item when client sync is disabled', async () => {
      const dbClient = getDb();
      const clientId = '018f0000-0000-7000-8000-000000000093';
      const contactId = '018f0000-0000-7000-8000-000000000094';

      await dbClient.insert(clients).values({
        id: clientId,
        displayName: 'Disabled Client',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: false,
      });
      await dbClient.insert(clientContacts).values({
        id: contactId,
        clientId,
        isPrimary: true,
        givenName: 'Disabled',
        familyName: 'User',
      });
      await dbClient.insert(googleContactsOutbox).values({
        id: '018f0000-0000-7000-8000-000000000095',
        contactId,
        action: 'UPSERT',
        status: 'PENDING',
      });

      const result = await processOutboxBatch({ dbClient });
      expect(result.syncedCount).toBe(0);
      expect(result.failedCount).toBe(0);

      const [item] = await dbClient
        .select()
        .from(googleContactsOutbox)
        .where(eq(googleContactsOutbox.id, '018f0000-0000-7000-8000-000000000095'));
      expect(item).toBeUndefined();
    });

    it('processOutboxBatch: rethrows error when updateContact fails with non-404 error', async () => {
      const dbClient = getDb();
      const clientId = '018f0000-0000-7000-8000-000000000096';
      const contactId = '018f0000-0000-7000-8000-000000000097';

      await dbClient.insert(clients).values({
        id: clientId,
        displayName: '500 Update Client',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: true,
      });
      await dbClient.insert(clientContacts).values({
        id: contactId,
        clientId,
        isPrimary: true,
        givenName: 'Update500',
        familyName: 'User',
      });
      await dbClient.insert(googleContactsLinks).values({
        id: '018f0000-0000-7000-8000-000000000098',
        contactId,
        googleResourceName: 'people/500-update-contact',
        googleEtag: 'etag-500',
        lastSyncedAt: new Date(),
      });
      await dbClient.insert(googleContactsOutbox).values({
        id: '018f0000-0000-7000-8000-000000000099',
        contactId,
        action: 'UPSERT',
        status: 'PENDING',
      });

      fakePeople.setResponseOverride('PATCH', 'updateContact', 500, {
        error: { message: 'Internal Server Error' },
      });

      const result = await processOutboxBatch({ dbClient });
      expect(result.failedCount).toBe(1);

      const [item] = await dbClient
        .select()
        .from(googleContactsOutbox)
        .where(eq(googleContactsOutbox.id, '018f0000-0000-7000-8000-000000000099'));
      expect(item?.attempts).toBe(1);
    });
  });
});
