import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { googleContactsLinks } from '@/server/db/schema/google-contacts-links';
import { generateExport } from '@/server/privacy/export/service';
import type { DbClient } from '@/server/db/client';

describe('TASK-0021: Google Contacts DSAR Export Integration (AC-8)', () => {
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

  it('AC-8: when contact has active Google sync, DSAR JSON and HTML export lists Google LLC as recipient with safeguards, lawful basis, and transmitted categories', async () => {
    const dbClient = getDb();

    // 1. Create client and contact
    const [client] = await dbClient
      .insert(clients)
      .values({
        displayName: 'DSAR Subject Client',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: true,
      })
      .returning();

    const [contact] = await dbClient
      .insert(clientContacts)
      .values({
        clientId: client?.id ?? '',
        isPrimary: true,
        givenName: 'Daniel',
        familyName: 'Craig',
        phone: '+49 30 555123',
      })
      .returning();

    if (!client || !contact) {
      throw new Error('Expected client and contact to be defined');
    }

    // 2. Link contact in googleContactsLinks (representing active sync)
    await dbClient.insert(googleContactsLinks).values({
      contactId: contact.id,
      googleResourceName: 'people/c9999',
      googleEtag: '%9999ETAG=',
      lastSyncedAt: new Date(),
    });

    // 3. Generate JSON export
    const jsonResult = await generateExport({
      contactId: contact.id,
      format: 'json',
      locale: 'en',
      actorId: 'test-owner-actor',
      client: dbClient,
    });

    expect(jsonResult).not.toBeNull();
    if (!jsonResult) {
      throw new Error('Expected jsonResult to be defined');
    }

    const categories = jsonResult.exportData.categories;
    const googleCategory = categories.google_contacts as Record<string, unknown>[] | undefined;
    expect(googleCategory).toBeDefined();
    expect(googleCategory).toHaveLength(1);

    const record = googleCategory?.[0];
    if (!record) {
      throw new Error('Expected record to be defined');
    }
    expect(record.recipient).toBe('Google LLC');
    expect(record.lawful_basis).toContain('Art. 6(1)(f)');
    expect(record.transfer_safeguards).toContain('EU-US Data Privacy Framework');
    expect(record.transfer_safeguards).toContain('Standard Contractual Clauses');
    expect(record.categories_transmitted).toContain('given name');
    expect(record.categories_transmitted).toContain('family name');
    expect(record.categories_transmitted).toContain('phone number');

    // 4. Generate HTML export
    const htmlResult = await generateExport({
      contactId: contact.id,
      format: 'html',
      locale: 'en',
      actorId: 'test-owner-actor',
      client: dbClient,
    });

    expect(htmlResult).not.toBeNull();
    if (!htmlResult) {
      throw new Error('Expected htmlResult to be defined');
    }
    const html = htmlResult.content;

    expect(html).toContain('Google LLC');
    expect(html).toContain('Art. 6(1)(f)');
    expect(html).toContain('EU-U.S. Data Privacy Framework');
    expect(html).toContain('Standard Contractual Clauses');
    expect(html).toContain('Given name, family name, phone number(s)');
  });

  it('AC-8: when contact does not have active Google sync, google_contacts category in DSAR export is empty', async () => {
    const dbClient = getDb();

    const [client] = await dbClient
      .insert(clients)
      .values({
        displayName: 'No Sync Client',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: false,
      })
      .returning();

    const [contact] = await dbClient
      .insert(clientContacts)
      .values({
        clientId: client?.id ?? '',
        isPrimary: true,
        givenName: 'Sam',
        familyName: 'NoSync',
        phone: '+49 30 000000',
      })
      .returning();

    if (!client || !contact) {
      throw new Error('Expected client and contact to be defined');
    }

    const jsonResult = await generateExport({
      contactId: contact.id,
      format: 'json',
      locale: 'en',
      actorId: 'test-owner-actor',
      client: dbClient,
    });

    expect(jsonResult).not.toBeNull();
    if (!jsonResult) {
      throw new Error('Expected jsonResult to be defined');
    }
    const categories = jsonResult.exportData.categories;
    const googleCategory = categories.google_contacts as Record<string, unknown>[] | undefined;
    expect(googleCategory).toBeDefined();
    expect(googleCategory).toHaveLength(0);
  });
});
