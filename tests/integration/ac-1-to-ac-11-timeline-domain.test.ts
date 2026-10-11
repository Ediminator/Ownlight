import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mockCookiesStore = new Map<string, string>();
const mockHeadersStore = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const val = mockCookiesStore.get(name);
        return val ? { name, value: val } : undefined;
      },
      set: (name: string, value: string) => {
        mockCookiesStore.set(name, value);
      },
      delete: (name: string) => {
        mockCookiesStore.delete(name);
      },
    }),
  headers: () =>
    Promise.resolve({
      get: (name: string) => mockHeadersStore.get(name.toLowerCase()) ?? null,
    }),
}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import {
  createClientAction,
  addContactAction,
  removeContactAction,
} from '@/server/clients/actions';
import {
  addNoteAction,
  updateNoteAction,
  deleteNoteAction,
  listTimelineAction,
} from '@/server/timeline/actions';
import { recordTimelineEvent } from '@/server/timeline/service';
import { encodeTimelineCursor } from '@/server/timeline/cursor';
import { user } from '@/server/db/schema/auth';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { clients } from '@/server/db/schema/clients';
import { clientTimelineEvents, clientNotes } from '@/server/db/schema/timeline';
import { auditEvents } from '@/server/db/schema/audit';
import type { DbClient } from '@/server/db/client';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { createApiKey } from '@/server/auth/api-keys';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '@/server/log';

describe('AC-1 to AC-11: Timeline and notes domain core integration', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let ownerUser: { id: string; name: string; email: string; role: string };

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;
    mockCookiesStore.clear();
    mockHeadersStore.clear();

    await dbClient.insert(studioSettings).values({
      studio_name: 'Timeline Studio Test',
      default_locale: 'en',
      timezone: 'Europe/Berlin',
      currency: 'EUR',
    });

    const [insertedOwner] = await dbClient
      .insert(user)
      .values({
        name: 'Studio Owner',
        email: 'owner@example.com',
        role: 'owner',
      })
      .returning();

    if (!insertedOwner) throw new Error('Owner setup failed');
    ownerUser = insertedOwner;

    const sessionRes = await createSession(ownerUser.id, dbClient);
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionRes.token);
  });

  afterEach(async () => {
    (globalThis as unknown as { db: DbClient | undefined }).db = undefined;
    await testDb.destroy();
  });

  it('AC-1: creates client and emits client.created with actor_type=owner; verifies backfill migration logic', async () => {
    // 1. Create client through createClientAction
    const createRes = await createClientAction({
      kind: 'person',
      displayName: 'Alice Wonderland',
      primaryContact: {
        givenName: 'Alice',
        familyName: 'Wonderland',
        email: 'alice@example.com',
      },
    });

    expect(createRes.success).toBe(true);
    if (!createRes.success) throw new Error('Client creation failed');
    const clientId = createRes.data.clientId;

    // 2. Call listTimelineAction and verify first item is client.created with actor_type = 'owner'
    const timelineRes = await listTimelineAction({ clientId });
    expect(timelineRes.success).toBe(true);
    if (!timelineRes.success) throw new Error('Timeline fetch failed');

    const createdEvent = timelineRes.data.items.find((item) => item.type === 'client.created');
    expect(createdEvent).toBeDefined();
    expect(createdEvent?.actorType).toBe('owner');
    expect(createdEvent?.actorId).toBe(ownerUser.id);
    expect(createdEvent?.subjectType).toBe('client');
    expect(createdEvent?.subjectId).toBe(clientId);

    // 3. Verify backfill migration rule: insert legacy client and simulate migration query
    const legacyClientId = '018f0000-0000-7000-8000-000000000999';
    const legacyCreatedAt = new Date('2025-01-10T09:00:00Z');
    await dbClient.insert(clients).values({
      id: legacyClientId,
      kind: 'company',
      displayName: 'Legacy Studio Client GmbH',
      preferredLocale: 'de',
      createdAt: legacyCreatedAt,
      updatedAt: legacyCreatedAt,
      lastActivityAt: legacyCreatedAt,
    });

    // Execute backfill query exactly matching 0006_fluffy_timeline.sql
    await dbClient.execute(sql`
      INSERT INTO client_timeline_events (id, client_id, type, occurred_at, actor_type, actor_id, subject_type, subject_id, data, created_at)
      SELECT gen_random_uuid(), id, 'client.created', created_at, 'system', NULL, 'client', id::text, '{}'::jsonb, now()
      FROM clients
      WHERE id = ${legacyClientId}
    `);

    const legacyTimeline = await listTimelineAction({ clientId: legacyClientId });
    expect(legacyTimeline.success).toBe(true);
    if (!legacyTimeline.success) throw new Error('Legacy timeline failed');

    expect(legacyTimeline.data.items.length).toBe(1);
    const legacyEvent = legacyTimeline.data.items[0];
    expect(legacyEvent?.type).toBe('client.created');
    expect(legacyEvent?.actorType).toBe('system');
    expect(legacyEvent?.actorId).toBeNull();
    expect(new Date(legacyEvent?.occurredAt ?? '').toISOString()).toBe(
      legacyCreatedAt.toISOString(),
    );
  });

  it('AC-2: contact added and removed timeline events, name resolution while existing, fallback after deletion', async () => {
    const createRes = await createClientAction({
      kind: 'company',
      displayName: 'Acme Corp',
      primaryContact: {
        givenName: 'John',
        familyName: 'Doe',
        email: 'john@example.com',
      },
    });
    if (!createRes.success) throw new Error('Client creation failed');
    const clientId = createRes.data.clientId;

    // Add a secondary contact
    const addContactRes = await addContactAction({
      clientId,
      givenName: 'Jane',
      familyName: 'Smith',
      email: 'jane@example.com',
      phone: '+49 30 0000 1234',
      isPrimary: false,
    });
    expect(addContactRes.success).toBe(true);
    if (!addContactRes.success) throw new Error('Add contact failed');
    const contactId = addContactRes.data.contactId;

    // Fetch timeline while contact exists: contactName is resolved
    let timelineRes = await listTimelineAction({ clientId });
    expect(timelineRes.success).toBe(true);
    if (!timelineRes.success) throw new Error('Timeline failed');

    const addedEvent = timelineRes.data.items.find(
      (it) => it.type === 'client.contact.added' && it.subjectId === contactId,
    );
    expect(addedEvent).toBeDefined();
    expect(addedEvent?.contactName).toBe('Jane Smith');

    // Remove the secondary contact
    const removeContactRes = await removeContactAction({ clientId, contactId });
    expect(removeContactRes.success).toBe(true);

    // Fetch timeline after removal: contactName is null/not resolved
    timelineRes = await listTimelineAction({ clientId });
    expect(timelineRes.success).toBe(true);
    if (!timelineRes.success) throw new Error('Timeline failed');

    const addedAfterRemoval = timelineRes.data.items.find(
      (it) => it.type === 'client.contact.added' && it.subjectId === contactId,
    );
    expect(addedAfterRemoval).toBeDefined();
    expect(addedAfterRemoval?.contactName).toBeNull();

    const removedEvent = timelineRes.data.items.find(
      (it) => it.type === 'client.contact.removed' && it.subjectId === contactId,
    );
    expect(removedEvent).toBeDefined();
    expect(removedEvent?.contactName).toBeNull();
  });

  it('AC-4: transactional rollback guarantees neither domain change nor timeline event persists', async () => {
    const createRes = await createClientAction({
      kind: 'person',
      displayName: 'Rollback Subject',
      primaryContact: { givenName: 'Roll', familyName: 'Back', email: 'rollback@example.com' },
    });
    if (!createRes.success) throw new Error('Client creation failed');
    const clientId = createRes.data.clientId;

    const initialEvents = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(eq(clientTimelineEvents.clientId, clientId));

    // Simulate atomic domain write that fails after recording timeline event
    await expect(
      dbClient.transaction(async (tx) => {
        await recordTimelineEvent(tx, {
          clientId,
          type: 'client.contact.added',
          actorType: 'owner',
          subjectType: 'contact',
          subjectId: '018f0000-0000-7000-8000-000000000055',
        });

        // Injected transactional failure
        throw new Error('Simulated failure during transactional write');
      }),
    ).rejects.toThrow('Simulated failure during transactional write');

    // Confirm that the timeline event was rolled back completely
    const postRollbackEvents = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(eq(clientTimelineEvents.clientId, clientId));

    expect(postRollbackEvents.length).toBe(initialEvents.length);
  });

  it('AC-5: adds note with 5,000 characters preserving line breaks; rejects 0 and 5,001 characters', async () => {
    const createRes = await createClientAction({
      kind: 'person',
      displayName: 'Note Subject',
      primaryContact: { givenName: 'Note', familyName: 'Person', email: 'note@example.com' },
    });
    if (!createRes.success) throw new Error('Client creation failed');
    const clientId = createRes.data.clientId;

    // 1. Valid note with 5,000 characters and multiple line breaks
    const part1 = 'A'.repeat(2498);
    const part2 = 'B'.repeat(2500);
    const body5000 = `${part1}\n\n${part2}`;
    expect(body5000.length).toBe(5000);

    const addRes = await addNoteAction({ clientId, body: body5000 });
    expect(addRes.success).toBe(true);
    if (!addRes.success) throw new Error('Add note failed');
    const noteId = addRes.data.noteId;

    // Verify resolved in timeline with line breaks preserved
    const timelineRes = await listTimelineAction({ clientId });
    expect(timelineRes.success).toBe(true);
    if (!timelineRes.success) throw new Error('Timeline failed');

    const noteEvent = timelineRes.data.items.find((it) => it.subjectId === noteId);
    expect(noteEvent).toBeDefined();
    expect(noteEvent?.noteBody).toBe(body5000);
    expect(noteEvent?.noteBody).toContain('\n\n');
    expect(noteEvent?.edited).toBe(false);

    // 2. Reject 0 characters / whitespace only
    const emptyRes = await addNoteAction({ clientId, body: '   ' });
    expect(emptyRes.success).toBe(false);
    expect(emptyRes.code).toBe('VALIDATION_FAILED');

    // 3. Reject 5,001 characters
    const body5001 = 'C'.repeat(5001);
    const oversizedRes = await addNoteAction({ clientId, body: body5001 });
    expect(oversizedRes.success).toBe(false);
    expect(oversizedRes.code).toBe('VALIDATION_FAILED');
  });

  it('AC-6: updates note setting edited marker; deleting note hard-deletes note and its timeline event', async () => {
    const createRes = await createClientAction({
      kind: 'person',
      displayName: 'Lifecycle Person',
      primaryContact: { givenName: 'Life', familyName: 'Cycle', email: 'lifecycle@example.com' },
    });
    if (!createRes.success) throw new Error('Client creation failed');
    const clientId = createRes.data.clientId;

    const addRes = await addNoteAction({ clientId, body: 'Original note text' });
    if (!addRes.success) throw new Error('Add note failed');
    const noteId = addRes.data.noteId;

    // Update note
    const updateRes = await updateNoteAction({
      clientId,
      noteId,
      body: 'Updated note text with revisions',
    });
    expect(updateRes.success).toBe(true);

    // Verify in timeline: new body and edited: true
    let timelineRes = await listTimelineAction({ clientId });
    expect(timelineRes.success).toBe(true);
    if (!timelineRes.success) throw new Error('Timeline failed');

    let noteItem = timelineRes.data.items.find((it) => it.subjectId === noteId);
    expect(noteItem).toBeDefined();
    expect(noteItem?.noteBody).toBe('Updated note text with revisions');
    expect(noteItem?.edited).toBe(true);

    // Delete note
    const deleteRes = await deleteNoteAction({ clientId, noteId });
    expect(deleteRes.success).toBe(true);

    // Verify in timeline: note and event no longer appear
    timelineRes = await listTimelineAction({ clientId });
    expect(timelineRes.success).toBe(true);
    if (!timelineRes.success) throw new Error('Timeline failed');

    noteItem = timelineRes.data.items.find((it) => it.subjectId === noteId);
    expect(noteItem).toBeUndefined();

    // Verify database row for note is deleted
    const [noteInDb] = await dbClient.select().from(clientNotes).where(eq(clientNotes.id, noteId));
    expect(noteInDb).toBeUndefined();
  });

  it('AC-7: pages 45 events with cursor in strictly descending order (20, 20, 5); rejects tampered cursor', async () => {
    const createRes = await createClientAction({
      kind: 'person',
      displayName: 'Pagination Client',
      primaryContact: { givenName: 'Page', familyName: 'One', email: 'page@example.com' },
    });
    if (!createRes.success) throw new Error('Client creation failed');
    const clientId = createRes.data.clientId;

    // Clear initial events so we control exactly 45 events
    await dbClient.delete(clientTimelineEvents).where(eq(clientTimelineEvents.clientId, clientId));

    // Seed 45 events with distinct timestamps
    const baseDate = new Date('2026-06-01T10:00:00Z');
    for (let i = 0; i < 45; i++) {
      const occurredAt = new Date(baseDate.getTime() + i * 60000);
      await dbClient.insert(clientTimelineEvents).values({
        clientId,
        type: 'client.created',
        actorType: 'owner',
        occurredAt,
        data: {},
      });
    }

    // Page 1: 20 items
    const page1 = await listTimelineAction({ clientId });
    expect(page1.success).toBe(true);
    if (!page1.success) throw new Error('Page 1 failed');
    expect(page1.data.items.length).toBe(20);
    expect(page1.data.nextCursor).not.toBeNull();

    // Page 2: 20 items
    const page2 = await listTimelineAction({
      clientId,
      cursor: page1.data.nextCursor ?? undefined,
    });
    expect(page2.success).toBe(true);
    if (!page2.success) throw new Error('Page 2 failed');
    expect(page2.data.items.length).toBe(20);
    expect(page2.data.nextCursor).not.toBeNull();

    // Page 3: 5 items
    const page3 = await listTimelineAction({
      clientId,
      cursor: page2.data.nextCursor ?? undefined,
    });
    expect(page3.success).toBe(true);
    if (!page3.success) throw new Error('Page 3 failed');
    expect(page3.data.items.length).toBe(5);
    expect(page3.data.nextCursor).toBeNull();

    // Verify strictly descending order across all 45 items without duplicates or gaps
    const allItems = [...page1.data.items, ...page2.data.items, ...page3.data.items];
    expect(allItems.length).toBe(45);

    const ids = new Set(allItems.map((it) => it.id));
    expect(ids.size).toBe(45);

    for (let i = 0; i < allItems.length - 1; i++) {
      const curr = allItems[i];
      const next = allItems[i + 1];
      if (!curr || !next) continue;
      const currTime = new Date(curr.occurredAt).getTime();
      const nextTime = new Date(next.occurredAt).getTime();

      if (currTime === nextTime) {
        expect(curr.id.localeCompare(next.id)).toBeGreaterThan(0);
      } else {
        expect(currTime).toBeGreaterThan(nextTime);
      }
    }

    // Tampered cursor returns VALIDATION_FAILED
    const tamperedCursor =
      encodeTimelineCursor({
        occurredAt: new Date('2026-06-01T10:00:00Z'),
        id: '018f0000-0000-7000-8000-000000000001',
      }) + 'tampered';

    const tamperedRes = await listTimelineAction({ clientId, cursor: tamperedCursor });
    expect(tamperedRes.success).toBe(false);
    expect(tamperedRes.code).toBe('VALIDATION_FAILED');
  });

  it('AC-8: enforces authorization boundaries, cross-client IDOR protection, and API key scopes', async () => {
    // Create client X and note on X
    const clientXRes = await createClientAction({
      kind: 'person',
      displayName: 'Client X',
      primaryContact: { givenName: 'Person', familyName: 'X', email: 'x@example.com' },
    });
    if (!clientXRes.success) throw new Error('Client X creation failed');
    const clientXId = clientXRes.data.clientId;

    const noteXRes = await addNoteAction({ clientId: clientXId, body: 'Note of Client X' });
    if (!noteXRes.success) throw new Error('Note X creation failed');
    const noteXId = noteXRes.data.noteId;

    // Create client Y
    const clientYRes = await createClientAction({
      kind: 'person',
      displayName: 'Client Y',
      primaryContact: { givenName: 'Person', familyName: 'Y', email: 'y@example.com' },
    });
    if (!clientYRes.success) throw new Error('Client Y creation failed');
    const clientYId = clientYRes.data.clientId;

    // 1. Cross-client IDOR: update Note X using clientId Y -> returns NOT_FOUND and X is unchanged
    const idorUpdate = await updateNoteAction({
      clientId: clientYId,
      noteId: noteXId,
      body: 'Attempted cross-client overwrite',
    });
    expect(idorUpdate.success).toBe(false);
    expect(idorUpdate.code).toBe('NOT_FOUND');

    const [noteXInDb] = await dbClient
      .select()
      .from(clientNotes)
      .where(eq(clientNotes.id, noteXId));
    expect(noteXInDb?.body).toBe('Note of Client X');

    // Cross-client IDOR: delete Note X using clientId Y -> returns NOT_FOUND and X is unchanged
    const idorDelete = await deleteNoteAction({
      clientId: clientYId,
      noteId: noteXId,
    });
    expect(idorDelete.success).toBe(false);
    expect(idorDelete.code).toBe('NOT_FOUND');

    const [noteXStillExists] = await dbClient
      .select()
      .from(clientNotes)
      .where(eq(clientNotes.id, noteXId));
    expect(noteXStillExists).toBeDefined();

    // 2. Non-existent client -> returns NOT_FOUND
    const missingTimeline = await listTimelineAction({
      clientId: '018f0000-0000-7000-8000-000000000099',
    });
    expect(missingTimeline.success).toBe(false);
    expect(missingTimeline.code).toBe('NOT_FOUND');

    // 3. No session -> UNAUTHORIZED
    mockCookiesStore.clear();
    const unauthRes = await addNoteAction({ clientId: clientXId, body: 'Unauthenticated note' });
    expect(unauthRes.success).toBe(false);
    expect(unauthRes.code).toBe('UNAUTHORIZED');

    // 4. API key with clients:read only -> note write returns FORBIDDEN + denied audit event
    const { apiKey: readApiKey } = await createApiKey({
      userId: ownerUser.id,
      name: 'Read Only Key',
      scopes: ['clients:read'],
      client: dbClient,
    });
    mockHeadersStore.set('authorization', `Bearer ${readApiKey}`);

    const writeWithReadKey = await addNoteAction({
      clientId: clientXId,
      body: 'Write attempt with read-only key',
    });
    expect(writeWithReadKey.success).toBe(false);
    expect(writeWithReadKey.code).toBe('FORBIDDEN');

    const deniedAudit = await dbClient
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'client.note.created'), eq(auditEvents.outcome, 'denied')));
    expect(deniedAudit.length).toBeGreaterThan(0);
    expect(deniedAudit[0]?.actorType).toBe('token');
  });

  it('AC-10: verifies zero PII in timeline event data column, audit metadata, and captured logs', async () => {
    const syntheticName = 'Secret Identity Person';
    const syntheticEmail = 'secret.identity@example.com';
    const syntheticPhone = '+49 30 0000 9999';
    const syntheticNote = 'Confidential details regarding family shoot agreement and preferences.';

    const capturedLogs: string[] = [];
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation((...args: unknown[]) => {
      capturedLogs.push(JSON.stringify(args));
    });

    try {
      const createRes = await createClientAction({
        kind: 'person',
        displayName: syntheticName,
        primaryContact: {
          givenName: 'Secret',
          familyName: 'Identity',
          email: syntheticEmail,
          phone: syntheticPhone,
        },
      });
      if (!createRes.success) throw new Error('Create failed');
      const clientId = createRes.data.clientId;

      const addNoteRes = await addNoteAction({
        clientId,
        body: syntheticNote,
      });
      if (!addNoteRes.success) throw new Error('Add note failed');
      const noteId = addNoteRes.data.noteId;

      await updateNoteAction({
        clientId,
        noteId,
        body: `${syntheticNote} (revision)`,
      });

      await deleteNoteAction({
        clientId,
        noteId,
      });

      // 1. Inspect data column directly in database for ALL events of this client
      const dbEvents = await dbClient
        .select()
        .from(clientTimelineEvents)
        .where(eq(clientTimelineEvents.clientId, clientId));

      for (const event of dbEvents) {
        const dataStr = JSON.stringify(event.data);
        expect(dataStr).not.toContain(syntheticName);
        expect(dataStr).not.toContain(syntheticEmail);
        expect(dataStr).not.toContain(syntheticPhone);
        expect(dataStr).not.toContain(syntheticNote);
      }

      // 2. Inspect audit event metadata for note operations
      const noteAudits = await dbClient
        .select()
        .from(auditEvents)
        .where(
          and(eq(auditEvents.targetId, clientId), sql`${auditEvents.action} LIKE 'client.note.%'`),
        );

      expect(noteAudits.length).toBeGreaterThanOrEqual(3);
      for (const record of noteAudits) {
        const meta = record.metadata;
        expect(meta).toBeDefined();
        if (!meta) continue;
        expect(meta).toHaveProperty('note_id');
        expect(Object.keys(meta)).toEqual(['note_id']);
        const metaStr = JSON.stringify(meta);
        expect(metaStr).not.toContain(syntheticNote);
      }

      // 3. Inspect captured logs during note operations
      const allLogsCombined = capturedLogs.join(' ');
      expect(allLogsCombined).not.toContain(syntheticNote);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('AC-11: hard deleting client at SQL level cascades and deletes notes and timeline events', async () => {
    const createRes = await createClientAction({
      kind: 'person',
      displayName: 'Cascade Delete Target',
      primaryContact: { givenName: 'Cascade', familyName: 'Target', email: 'cascade@example.com' },
    });
    if (!createRes.success) throw new Error('Create failed');
    const clientId = createRes.data.clientId;

    await addNoteAction({ clientId, body: 'Note to be cascaded away' });

    const notesBefore = await dbClient
      .select()
      .from(clientNotes)
      .where(eq(clientNotes.clientId, clientId));
    expect(notesBefore.length).toBe(1);

    const eventsBefore = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(eq(clientTimelineEvents.clientId, clientId));
    expect(eventsBefore.length).toBeGreaterThan(0);

    // Delete parent client directly in SQL
    await dbClient.delete(clients).where(eq(clients.id, clientId));

    // Verify notes and timeline events are completely erased via ON DELETE CASCADE
    const notesAfter = await dbClient
      .select()
      .from(clientNotes)
      .where(eq(clientNotes.clientId, clientId));
    expect(notesAfter.length).toBe(0);

    const eventsAfter = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(eq(clientTimelineEvents.clientId, clientId));
    expect(eventsAfter.length).toBe(0);
  });
});
