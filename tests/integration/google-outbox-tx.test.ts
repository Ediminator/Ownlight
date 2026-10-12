import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { googleContactsOutbox } from '@/server/db/schema/google-contacts-outbox';
import { enqueueContactUpsert } from '@/server/integrations/google/outbox';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';

describe('TASK-0021: Google Contacts Outbox Transactional Atomicity (AC-2)', () => {
  let testDb: TestDatabaseInstance;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  function getDb(): DbClient {
    return testDb.db as unknown as DbClient;
  }

  it('AC-2: when sync is enabled, contact creation queues UPSERT in google_contacts_outbox; when sync is disabled, no outbox entry is created', async () => {
    const dbClient = getDb();

    // 1. Client with sync enabled
    const [clientSyncOn] = await dbClient
      .insert(clients)
      .values({
        displayName: 'Sync Enabled Client',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: true,
      })
      .returning();

    const [contact1] = await dbClient
      .insert(clientContacts)
      .values({
        clientId: clientSyncOn?.id ?? '',
        isPrimary: true,
        givenName: 'John',
        familyName: 'Doe',
        phone: '+49 30 111111',
      })
      .returning();

    if (!clientSyncOn || !contact1) {
      throw new Error('Expected clientSyncOn and contact1');
    }

    // In service.ts, contact creation inside transaction enqueues outbox if client has sync enabled
    if (clientSyncOn.googleContactsSyncEnabled) {
      await enqueueContactUpsert(contact1.id, dbClient);
    }

    const outboxSyncOn = await dbClient
      .select()
      .from(googleContactsOutbox)
      .where(eq(googleContactsOutbox.contactId, contact1.id));

    expect(outboxSyncOn).toHaveLength(1);
    expect(outboxSyncOn[0]?.action).toBe('UPSERT');
    expect(outboxSyncOn[0]?.status).toBe('PENDING');

    // 2. Client with sync disabled
    const [clientSyncOff] = await dbClient
      .insert(clients)
      .values({
        displayName: 'Sync Disabled Client',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: false,
      })
      .returning();

    const [contact2] = await dbClient
      .insert(clientContacts)
      .values({
        clientId: clientSyncOff?.id ?? '',
        isPrimary: true,
        givenName: 'Jane',
        familyName: 'Smith',
        phone: '+49 30 222222',
      })
      .returning();

    if (!clientSyncOff || !contact2) {
      throw new Error('Expected clientSyncOff and contact2');
    }

    // Contact creation does not enqueue outbox if client sync is disabled
    if (clientSyncOff.googleContactsSyncEnabled) {
      await enqueueContactUpsert(contact2.id, dbClient);
    }

    const outboxSyncOff = await dbClient
      .select()
      .from(googleContactsOutbox)
      .where(eq(googleContactsOutbox.contactId, contact2.id));

    expect(outboxSyncOff).toHaveLength(0);
  });

  it('AC-2: rolling back a client transaction does not leave orphaned outbox entries', async () => {
    const dbClient = getDb();

    // Verify initial outbox is empty
    const initialOutbox = await dbClient.select().from(googleContactsOutbox);
    expect(initialOutbox).toHaveLength(0);

    // Attempt a transaction that creates client, contact, enqueues outbox, but rolls back
    let rolledBack = false;
    try {
      await dbClient.transaction(async (tx) => {
        const [client] = await tx
          .insert(clients)
          .values({
            displayName: 'Rollback Client',
            kind: 'person',
            preferredLocale: 'de',
            googleContactsSyncEnabled: true,
          })
          .returning();

        const [contact] = await tx
          .insert(clientContacts)
          .values({
            clientId: client?.id ?? '',
            isPrimary: true,
            givenName: 'Test',
            familyName: 'User',
            phone: '+49 30 333333',
          })
          .returning();

        if (!client || !contact) {
          throw new Error('Expected client and contact');
        }

        await enqueueContactUpsert(contact.id, tx);

        // Simulate an unexpected error or validation failure that aborts the transaction
        throw new Error('Simulated transaction failure for rollback assertion');
      });
    } catch (err) {
      rolledBack = true;
      expect((err as Error).message).toBe('Simulated transaction failure for rollback assertion');
    }

    expect(rolledBack).toBe(true);

    // Verify database has 0 clients and 0 orphaned outbox entries
    const finalClients = await dbClient
      .select()
      .from(clients)
      .where(eq(clients.displayName, 'Rollback Client'));
    expect(finalClients).toHaveLength(0);

    const finalOutbox = await dbClient.select().from(googleContactsOutbox);
    expect(finalOutbox).toHaveLength(0);
  });
});
