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
import { auditEvents } from '@/server/db/schema/audit';
import { encryptSecret } from '@/server/crypto/vault';
import { GOOGLE_OAUTH_PURPOSE } from '@/server/integrations/google/constants';
import { upsertGoogleOAuthToken } from '@/server/integrations/google/repo';
import { runGoogleContactsSyncWorker } from '@/server/integrations/google/sync-worker';
import { enqueueContactUpsert, enqueueContactDelete } from '@/server/integrations/google/outbox';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';

describe('TASK-0021: Google Contacts Outbox Worker Integration (AC-3, AC-4, AC-5, AC-6)', () => {
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
    await testDb.destroy();
    process.env = { ...originalEnv };
  });

  function getDb(): DbClient {
    return testDb.db as unknown as DbClient;
  }

  async function createTestClientAndContact(options: { syncEnabled?: boolean } = {}) {
    const dbClient = getDb();
    const [client] = await dbClient
      .insert(clients)
      .values({
        displayName: 'Alice & Bob Wedding',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: options.syncEnabled ?? true,
      })
      .returning();

    const [contact] = await dbClient
      .insert(clientContacts)
      .values({
        clientId: client?.id ?? '',
        isPrimary: true,
        givenName: 'Alice',
        familyName: 'Smith',
        email: 'alice@example.org',
        phone: '+49 30 123456',
      })
      .returning();

    if (!client || !contact) {
      throw new Error('Expected client and contact to be defined');
    }

    return { client, contact };
  }

  it('AC-3: pending UPSERT creates remote contact, transmits minimized fields, saves link row, and emits audit event with counts only', async () => {
    const dbClient = getDb();
    const { contact } = await createTestClientAndContact();

    // 1. Enqueue UPSERT
    await enqueueContactUpsert(contact.id, dbClient);

    // 2. Run sync worker
    const result = await runGoogleContactsSyncWorker({ dbClient });
    expect(result.syncedCount).toBe(1);
    expect(result.failedCount).toBe(0);

    // 3. Verify Fake People API received correct minimized payload
    expect(fakePeople.requests).toHaveLength(1);
    const req = fakePeople.requests[0];
    if (!req) {
      throw new Error('Expected request to be defined');
    }
    expect(req.method).toBe('POST');
    expect(req.url).toContain('/people:createContact');
    expect(req.parsedBody).toBeDefined();

    // Minimized fields check: givenName, familyName, phoneNumbers present
    expect(req.parsedBody?.names).toEqual([{ givenName: 'Alice', familyName: 'Smith' }]);
    expect(req.parsedBody?.phoneNumbers).toEqual([{ value: '+49 30 123456', type: 'mobile' }]);

    // Sensitive / excessive fields check: email, notes, addresses MUST NOT exist
    expect(req.parsedBody?.emailAddresses).toBeUndefined();
    expect(req.parsedBody?.addresses).toBeUndefined();
    expect(req.parsedBody?.biographies).toBeUndefined();
    expect(req.body).not.toContain('alice@example.org');

    // 4. Verify link row created in google_contacts_links
    const links = await dbClient
      .select()
      .from(googleContactsLinks)
      .where(eq(googleContactsLinks.contactId, contact.id));

    expect(links).toHaveLength(1);
    expect(links[0]?.googleResourceName).toMatch(/^people\/c\d+/);
    expect(links[0]?.googleEtag).toBeTruthy();
    expect(links[0]?.lastSyncedAt).toBeInstanceOf(Date);

    // 5. Verify outbox row was removed after successful processing
    const remainingOutbox = await dbClient.select().from(googleContactsOutbox);
    expect(remainingOutbox).toHaveLength(0);

    // 6. Verify audit event emitted with counts only (no PII)
    const auditRows = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'integration.google.contacts_synced'));

    expect(auditRows).toHaveLength(1);
    const auditRow = auditRows[0];
    if (!auditRow) {
      throw new Error('Expected auditRow to be defined');
    }
    expect(auditRow.actorType).toBe('system');
    expect(auditRow.actorId).toBe('google-contacts-sync-worker');
    expect(auditRow.outcome).toBe('success');

    if (!auditRow.metadata) {
      throw new Error('Expected auditRow.metadata to be defined');
    }
    const metadata = auditRow.metadata;
    expect(metadata.syncedCount).toBe(1);
    expect(metadata.failedCount).toBe(0);
    expect(JSON.stringify(metadata)).not.toContain('Alice');
    expect(JSON.stringify(metadata)).not.toContain('Smith');
    expect(JSON.stringify(metadata)).not.toContain('+49 30 123456');
    expect(JSON.stringify(metadata)).not.toContain('alice@example.org');
  });

  it('AC-4: updates transmit stored etag to updateContact, and update last_synced_at and google_etag', async () => {
    const dbClient = getDb();
    const { contact } = await createTestClientAndContact();

    // 1. Initial create sync
    await enqueueContactUpsert(contact.id, dbClient);
    await runGoogleContactsSyncWorker({ dbClient });

    const [initialLink] = await dbClient
      .select()
      .from(googleContactsLinks)
      .where(eq(googleContactsLinks.contactId, contact.id));
    expect(initialLink).toBeDefined();
    if (!initialLink) {
      throw new Error('Expected initialLink to be defined');
    }
    const initialEtag = initialLink.googleEtag;
    const initialSyncedAt = initialLink.lastSyncedAt;

    fakePeople.requests.length = 0;

    // 2. Modify contact locally
    await dbClient
      .update(clientContacts)
      .set({ givenName: 'Alicia', phone: '+49 30 999999' })
      .where(eq(clientContacts.id, contact.id));

    // 3. Enqueue second UPSERT (update)
    await enqueueContactUpsert(contact.id, dbClient);

    // Wait a brief moment to ensure updated timestamp differs
    await new Promise((r) => setTimeout(r, 10));

    // 4. Run worker
    const updateResult = await runGoogleContactsSyncWorker({ dbClient });
    expect(updateResult.syncedCount).toBe(1);

    // 5. Verify fake people received updateContact with etag
    expect(fakePeople.requests).toHaveLength(1);
    const updateReq = fakePeople.requests[0];
    if (!updateReq) {
      throw new Error('Expected updateReq to be defined');
    }
    expect(updateReq.method).toBe('PATCH');
    expect(updateReq.url).toContain(':updateContact');
    expect(updateReq.parsedBody?.etag).toBe(initialEtag);
    expect(updateReq.parsedBody?.names).toEqual([{ givenName: 'Alicia', familyName: 'Smith' }]);
    expect(updateReq.parsedBody?.phoneNumbers).toEqual([
      { value: '+49 30 999999', type: 'mobile' },
    ]);

    // 6. Verify link row updated with new etag and timestamp
    const [updatedLink] = await dbClient
      .select()
      .from(googleContactsLinks)
      .where(eq(googleContactsLinks.contactId, contact.id));

    if (!updatedLink) {
      throw new Error('Expected updatedLink to be defined');
    }
    expect(updatedLink.googleEtag).not.toBe(initialEtag);
    expect(updatedLink.lastSyncedAt.getTime()).toBeGreaterThanOrEqual(initialSyncedAt.getTime());
  });

  it('AC-5: retryable HTTP 429/500 retried up to 5 attempts, transitioning to FAILED on 5th failure without leaking response bodies', async () => {
    const dbClient = getDb();
    const { contact } = await createTestClientAndContact();

    await enqueueContactUpsert(contact.id, dbClient);

    // Configure fake People API to return 429 Too Many Requests
    fakePeople.setResponseOverride('POST', 'people:createContact', 429, {
      error: { code: 429, message: 'Resource exhausted: rate limit exceeded' },
    });

    // Run attempts 1 to 4: should remain PENDING with incremented attempts
    for (let attempt = 1; attempt <= 4; attempt++) {
      // Force nextAttemptAt to past so worker picks it up
      await dbClient
        .update(googleContactsOutbox)
        .set({ nextAttemptAt: new Date(Date.now() - 1000) });

      const res = await runGoogleContactsSyncWorker({ dbClient });
      expect(res.failedCount).toBe(1);

      const [outboxItem] = await dbClient.select().from(googleContactsOutbox);
      expect(outboxItem?.status).toBe('PENDING');
      expect(outboxItem?.attempts).toBe(attempt);
      expect(outboxItem?.lastError).toContain('429');
    }

    // 5th attempt: should transition to FAILED
    await dbClient.update(googleContactsOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) });

    const finalRes = await runGoogleContactsSyncWorker({ dbClient });
    expect(finalRes.failedCount).toBe(1);

    const [failedItem] = await dbClient.select().from(googleContactsOutbox);
    expect(failedItem?.status).toBe('FAILED');
    expect(failedItem?.attempts).toBe(5);

    // Check that error message is sanitized and does not leak raw body or PII
    expect(failedItem?.lastError).toBeTruthy();
    expect(failedItem?.lastError).not.toContain('Resource exhausted');
    expect(failedItem?.lastError).not.toContain('Alice');
  });

  it('AC-6: DELETE action deletes remote contact and removes link row', async () => {
    const dbClient = getDb();
    const { contact } = await createTestClientAndContact();

    // 1. Initial create sync
    await enqueueContactUpsert(contact.id, dbClient);
    await runGoogleContactsSyncWorker({ dbClient });

    const [link] = await dbClient
      .select()
      .from(googleContactsLinks)
      .where(eq(googleContactsLinks.contactId, contact.id));
    expect(link).toBeDefined();
    if (!link) {
      throw new Error('Expected link to be defined');
    }
    const resourceName = link.googleResourceName;

    // Remote contact exists in fake server
    expect(fakePeople.contacts.has(resourceName)).toBe(true);

    fakePeople.requests.length = 0;

    // 2. Enqueue DELETE
    await enqueueContactDelete(contact.id, resourceName, dbClient);

    // 3. Run worker
    const deleteRes = await runGoogleContactsSyncWorker({ dbClient });
    expect(deleteRes.syncedCount).toBe(1);

    // 4. Verify remote contact was deleted from fake People API
    expect(fakePeople.contacts.has(resourceName)).toBe(false);
    expect(fakePeople.requests).toHaveLength(1);
    const deleteReq = fakePeople.requests[0];
    if (!deleteReq) {
      throw new Error('Expected deleteReq to be defined');
    }
    expect(deleteReq.method).toBe('DELETE');
    expect(deleteReq.url).toContain(':deleteContact');

    // 5. Verify link row removed from database
    const remainingLinks = await dbClient
      .select()
      .from(googleContactsLinks)
      .where(eq(googleContactsLinks.contactId, contact.id));
    expect(remainingLinks).toHaveLength(0);

    // 6. Verify outbox cleared
    const remainingOutbox = await dbClient.select().from(googleContactsOutbox);
    expect(remainingOutbox).toHaveLength(0);
  });
});
