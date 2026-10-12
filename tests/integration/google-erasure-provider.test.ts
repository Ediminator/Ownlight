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
import { enqueueContactUpsert } from '@/server/integrations/google/outbox';
import { runGoogleContactsSyncWorker } from '@/server/integrations/google/sync-worker';
import { eraseSubject } from '@/server/privacy/erasure/service';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';

describe('TASK-0021: Google Contacts Erasure Integration (AC-7)', () => {
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

  it('AC-7: erasing a contact with active Google sync calls People API delete, removes link row, and leaves no orphaned remote resource', async () => {
    const dbClient = getDb();

    // 1. Create client with multiple contacts so contact erasure does not cascade to entire client
    const [client] = await dbClient
      .insert(clients)
      .values({
        displayName: 'Erasure Test Family',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: true,
      })
      .returning();

    const [contactToErase] = await dbClient
      .insert(clientContacts)
      .values({
        clientId: client?.id ?? '',
        isPrimary: false,
        givenName: 'EraseMe',
        familyName: 'Person',
        phone: '+49 30 777777',
      })
      .returning();

    const [remainingContact] = await dbClient
      .insert(clientContacts)
      .values({
        clientId: client?.id ?? '',
        isPrimary: true,
        givenName: 'KeepMe',
        familyName: 'Person',
        phone: '+49 30 888888',
      })
      .returning();

    if (!client || !contactToErase || !remainingContact) {
      throw new Error('Expected client and contacts to be defined');
    }

    // 2. Sync contact to fake Google server
    await enqueueContactUpsert(contactToErase.id, dbClient);
    await runGoogleContactsSyncWorker({ dbClient });

    // Verify contact is linked
    const [link] = await dbClient
      .select()
      .from(googleContactsLinks)
      .where(eq(googleContactsLinks.contactId, contactToErase.id));
    expect(link).toBeDefined();
    if (!link) {
      throw new Error('Expected link to be defined');
    }
    const resourceName = link.googleResourceName;

    // Verify contact exists on remote Google fake server
    expect(fakePeople.contacts.has(resourceName)).toBe(true);

    fakePeople.requests.length = 0;

    // 3. Execute erasure via TASK-0016 erasure service
    const erasureResult = await eraseSubject(
      {
        kind: 'contact',
        clientId: client.id,
        contactId: contactToErase.id,
      },
      {
        actor: { actorType: 'owner', actorId: 'test-owner-id' },
      },
      dbClient,
    );

    expect(erasureResult.success).toBe(true);

    // 4. Verify fake People API received DELETE request for resourceName
    expect(fakePeople.requests).toHaveLength(1);
    const deleteReq = fakePeople.requests[0];
    if (!deleteReq) {
      throw new Error('Expected deleteReq to be defined');
    }
    expect(deleteReq.method).toBe('DELETE');
    expect(deleteReq.url).toContain(encodeURIComponent(resourceName).replaceAll('%2F', '/'));

    // 5. Verify remote resource was deleted (no orphan)
    expect(fakePeople.contacts.has(resourceName)).toBe(false);

    // 6. Verify link row removed from database
    const remainingLinks = await dbClient
      .select()
      .from(googleContactsLinks)
      .where(eq(googleContactsLinks.contactId, contactToErase.id));
    expect(remainingLinks).toHaveLength(0);

    // 7. Verify outbox has no orphaned entries for erased contact
    const remainingOutbox = await dbClient
      .select()
      .from(googleContactsOutbox)
      .where(eq(googleContactsOutbox.contactId, contactToErase.id));
    expect(remainingOutbox).toHaveLength(0);

    // 8. Verify the contact itself is erased while other contact remains
    const erasedContactCheck = await dbClient
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.id, contactToErase.id));
    expect(erasedContactCheck).toHaveLength(0);

    const keepContactCheck = await dbClient
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.id, remainingContact.id));
    expect(keepContactCheck).toHaveLength(1);
  });
});
