import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import type { DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { clientNotes, clientTimelineEvents } from '@/server/db/schema/timeline';
import { consentRecords } from '@/server/db/schema/consents';
import {
  getClientTimelineEvents,
  getClientNoteRecord,
  updateClientNoteRecord,
  deleteClientNoteRecord,
} from '@/server/timeline/repo';

describe('Timeline Repo Unit Branch Coverage', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let clientId: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    clientId = generateUuidV7();
    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Timeline Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it('covers getClientNoteRecord returning null for non-existent note', async () => {
    const res = await getClientNoteRecord(clientId, generateUuidV7(), dbClient);
    expect(res).toBeNull();
  });

  it('covers updateClientNoteRecord with explicit now date and non-existent note', async () => {
    const now = new Date('2026-05-01T12:00:00Z');
    const res = await updateClientNoteRecord(dbClient, {
      clientId,
      noteId: generateUuidV7(),
      body: 'Updated body',
      now,
    });
    expect(res).toBeNull();
  });

  it('covers deleteClientNoteRecord returning false for non-existent note', async () => {
    const res = await deleteClientNoteRecord(dbClient, {
      clientId,
      noteId: generateUuidV7(),
    });
    expect(res).toBe(false);
  });

  it('covers getClientTimelineEvents note resolution: edited vs unedited vs missing note', async () => {
    const noteId1 = generateUuidV7();
    const noteId2 = generateUuidV7();
    const missingNoteId = generateUuidV7();
    const t0 = new Date('2026-06-01T10:00:00Z');
    const t1 = new Date('2026-06-01T11:00:00Z');

    // Note 1: unedited (createdAt == updatedAt)
    await dbClient.insert(clientNotes).values({
      id: noteId1,
      clientId,
      body: 'Unedited note',
      createdAt: t0,
      updatedAt: t0,
    });

    // Note 2: edited (updatedAt > createdAt)
    await dbClient.insert(clientNotes).values({
      id: noteId2,
      clientId,
      body: 'Edited note',
      createdAt: t0,
      updatedAt: t1,
    });

    // Events for notes
    await dbClient.insert(clientTimelineEvents).values([
      {
        id: generateUuidV7(),
        clientId,
        type: 'note.created',
        occurredAt: t0,
        actorType: 'owner',
        actorId: 'user-1',
        subjectType: 'note',
        subjectId: noteId1,
        data: {},
        createdAt: t0,
      },
      {
        id: generateUuidV7(),
        clientId,
        type: 'note.created',
        occurredAt: t1,
        actorType: 'owner',
        actorId: 'user-1',
        subjectType: 'note',
        subjectId: noteId2,
        data: {},
        createdAt: t1,
      },
      {
        id: generateUuidV7(),
        clientId,
        type: 'note.created',
        occurredAt: t0,
        actorType: 'owner',
        actorId: 'user-1',
        subjectType: 'note',
        subjectId: missingNoteId,
        data: {},
        createdAt: t0,
      },
    ]);

    const res = await getClientTimelineEvents(clientId, null, 10, dbClient);
    expect(res.items.length).toBe(3);

    const note1Item = res.items.find((i) => i.subjectId === noteId1);
    expect(note1Item?.noteBody).toBe('Unedited note');
    expect(note1Item?.edited).toBe(false);

    const note2Item = res.items.find((i) => i.subjectId === noteId2);
    expect(note2Item?.noteBody).toBe('Edited note');
    expect(note2Item?.edited).toBe(true);

    const missingItem = res.items.find((i) => i.subjectId === missingNoteId);
    expect(missingItem?.noteBody).toBeNull();
    expect(missingItem?.edited).toBe(false);

    // Call with valid cursor to test keyset condition branch
    const pageWithCursor = await getClientTimelineEvents(
      clientId,
      { occurredAt: t1, id: generateUuidV7() },
      10,
      dbClient,
    );
    expect(pageWithCursor.items).toBeDefined();
  });

  it('covers getClientTimelineEvents consent event name resolution and deleted contact fallback', async () => {
    // Contact 1 with name
    const contactId1 = generateUuidV7();
    await dbClient.insert(clientContacts).values({
      id: contactId1,
      clientId,
      givenName: 'Alice',
      familyName: 'Smith',
      email: 'alice@example.com',
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Contact 2 belongs to another client, so it won't resolve under this client
    const otherClientId = generateUuidV7();
    await dbClient.insert(clients).values({
      id: otherClientId,
      displayName: 'Other Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const otherContactId = generateUuidV7();
    await dbClient.insert(clientContacts).values({
      id: otherContactId,
      clientId: otherClientId,
      givenName: 'Bob',
      familyName: 'Jones',
      email: 'bob@example.com',
      isPrimary: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Consent records
    const consentId1 = generateUuidV7();
    await dbClient.insert(consentRecords).values({
      id: consentId1,
      contactId: contactId1,
      purpose: 'marketing',
      status: 'granted',
      effectiveOn: '2026-06-01',
      method: 'email',
      recordedByActorType: 'owner',
      recordedByActorId: 'user-1',
      createdAt: new Date(),
    });

    const consentId2 = generateUuidV7();
    await dbClient.insert(consentRecords).values({
      id: consentId2,
      contactId: otherContactId,
      purpose: 'image_usage',
      status: 'granted',
      effectiveOn: '2026-06-01',
      method: 'email',
      recordedByActorType: 'owner',
      recordedByActorId: 'user-1',
      createdAt: new Date(),
    });

    const missingConsentId = generateUuidV7();

    const t = new Date();
    await dbClient.insert(clientTimelineEvents).values([
      {
        id: generateUuidV7(),
        clientId,
        type: 'consent.granted',
        occurredAt: t,
        actorType: 'owner',
        actorId: 'user-1',
        subjectType: 'consent',
        subjectId: consentId1,
        data: {},
        createdAt: t,
      },
      {
        id: generateUuidV7(),
        clientId,
        type: 'consent.withdrawn',
        occurredAt: t,
        actorType: 'owner',
        actorId: 'user-1',
        subjectType: 'consent',
        subjectId: consentId2,
        data: {},
        createdAt: t,
      },
      {
        id: generateUuidV7(),
        clientId,
        type: 'consent.granted',
        occurredAt: t,
        actorType: 'owner',
        actorId: 'user-1',
        subjectType: 'consent',
        subjectId: missingConsentId,
        data: {},
        createdAt: t,
      },
    ]);

    const res = await getClientTimelineEvents(clientId, null, 10, dbClient);
    const item1 = res.items.find((i) => i.subjectId === consentId1);
    expect(item1?.contactName).toBe('Alice Smith');

    const item2 = res.items.find((i) => i.subjectId === consentId2);
    expect(item2?.contactName).toBeNull();

    const itemMissing = res.items.find((i) => i.subjectId === missingConsentId);
    expect(itemMissing?.contactName).toBeNull();
  });
});
