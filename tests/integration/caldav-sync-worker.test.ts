import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import {
  createFakeCaldavServer,
  type FakeCaldavServerInstance,
} from '../helpers/fake-caldav-server';
import {
  appointments,
  bookingTypes,
  availabilitySchedules,
  calendarSyncOutbox,
  calendarSyncLinks,
  externalCalendarBusyIntervals,
  blockedTime,
  caldavAccounts,
} from '@/server/db/schema/calendar';
import { clients } from '@/server/db/schema/clients';
import { projects, shoots, pipelineStages } from '@/server/db/schema/projects';
import { auditEvents } from '@/server/db/schema/audit';
import { encryptSecret } from '@/server/crypto/vault';
import { saveCaldavAccount } from '@/server/integrations/caldav/repo';
import { runCalendarSyncWorker } from '@/server/worker/calendar-sync-worker';
import { calculateAvailableSlots } from '@/server/calendar/availability';
import { eq, and } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';

describe('TASK-0047: CalDAV Two-Way Sync in Background Worker (AC-3, AC-4)', () => {
  let testDb: TestDatabaseInstance;
  let fakeCaldav: FakeCaldavServerInstance;

  const masterKey = '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a';
  const testUser = 'photographer@example.org';
  const testPassword = 'secret-app-password-xyz';

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    fakeCaldav = await createFakeCaldavServer({
      expectedUser: testUser,
      expectedPass: testPassword,
    });

    process.env.ENCRYPTION_KEY = masterKey;

    const encryptedPassword = await encryptSecret(testPassword, 'ownlight:vault:caldav', masterKey);

    // Save active CalDAV account in database
    await saveCaldavAccount(
      {
        serverUrl: fakeCaldav.baseUrl,
        username: testUser,
        encryptedPassword,
        selectedCalendarUrl: `${fakeCaldav.baseUrl}/calendars/owner/work/`,
        selectedCalendarName: 'Studio Work',
      },
      getDb(),
    );
  });

  afterEach(async () => {
    await fakeCaldav.close();
    await testDb.destroy();
    vi.clearAllMocks();
  });

  function getDb(): DbClient {
    return testDb.db as unknown as DbClient;
  }

  async function createTestProject(): Promise<string> {
    const dbClient = getDb();
    const [client] = await dbClient
      .insert(clients)
      .values({
        displayName: 'Test Client',
        kind: 'person',
        preferredLocale: 'en',
      })
      .returning();

    const [stage] = await dbClient.select().from(pipelineStages).limit(1);
    if (!stage) throw new Error('No pipeline stages found');
    if (!client?.id) throw new Error('Client creation failed');

    const [proj] = await dbClient
      .insert(projects)
      .values({
        clientId: client.id,
        stageId: stage.id,
        title: 'Wedding Shoot Sophie & Marc',
        projectTypeKey: 'wedding',
      })
      .returning();

    if (!proj?.id) throw new Error('Project creation failed');
    return proj.id;
  }

  it('AC-3: outbound sync worker pushes appointment and shoot to CalDAV, creates sync link, and updates outbox to COMPLETED', async () => {
    const dbClient = getDb();
    const projectId = await createTestProject();

    // 1. Create Appointment
    const startsAt = new Date('2026-11-25T10:00:00Z');
    const endsAt = new Date('2026-11-25T11:00:00Z');
    const [appt] = await dbClient
      .insert(appointments)
      .values({
        title: 'Consultation: Clara Schumann',
        attendeeName: 'Clara Schumann',
        attendeeEmail: 'clara@example.org',
        attendeePhone: '+49 170 1112233',
        attendeeNotes: 'Special dietary requirements and wedding moodboard',
        status: 'scheduled',
        startsAt,
        endsAt,
      })
      .returning();

    // 2. Create Shoot
    const shootStart = new Date('2026-11-26T14:00:00Z');
    const shootEnd = new Date('2026-11-26T17:00:00Z');
    const [shoot] = await dbClient
      .insert(shoots)
      .values({
        projectId,
        title: 'Main Ceremony',
        startsAt: shootStart,
        endsAt: shootEnd,
      })
      .returning();

    if (!appt?.id || !shoot?.id) throw new Error('Missing test entities');

    // 3. Enqueue both in calendar_sync_outbox
    const [apptOutbox] = await dbClient
      .insert(calendarSyncOutbox)
      .values({
        entityType: 'appointment',
        entityId: appt.id,
        action: 'create',
        status: 'PENDING',
      })
      .returning();

    const [shootOutbox] = await dbClient
      .insert(calendarSyncOutbox)
      .values({
        entityType: 'shoot',
        entityId: shoot.id,
        action: 'create',
        status: 'PENDING',
      })
      .returning();

    if (!apptOutbox?.id || !shootOutbox?.id) throw new Error('Missing outbox records');

    // 4. Run sync worker
    const batchResult = await runCalendarSyncWorker({ dbClient });

    expect(batchResult.syncedCount).toBe(2);
    expect(batchResult.failedCount).toBe(0);

    // 5. Verify outbox items are marked COMPLETED
    const [updatedApptOutbox] = await dbClient
      .select()
      .from(calendarSyncOutbox)
      .where(eq(calendarSyncOutbox.id, apptOutbox.id));
    expect(updatedApptOutbox?.status).toBe('COMPLETED');

    const [updatedShootOutbox] = await dbClient
      .select()
      .from(calendarSyncOutbox)
      .where(eq(calendarSyncOutbox.id, shootOutbox.id));
    expect(updatedShootOutbox?.status).toBe('COMPLETED');

    // 6. Verify calendar_sync_links entries created for provider = 'caldav'
    const caldavLinks = await dbClient
      .select()
      .from(calendarSyncLinks)
      .where(eq(calendarSyncLinks.provider, 'caldav'));

    expect(caldavLinks).toHaveLength(2);

    const apptLink = caldavLinks.find((l) => l.entityId === appt.id);
    expect(apptLink).toBeDefined();
    expect(apptLink?.externalEventId).toContain('.ics');
    expect(apptLink?.etag).toBeDefined();

    // 7. Verify fake CalDAV server received the PUT requests with VEVENT strings
    expect(fakeCaldav.events.size).toBe(2);

    const storedApptEvent = Array.from(fakeCaldav.events.values()).find((e) =>
      e.icalString.includes('Clara S.'),
    );
    expect(storedApptEvent).toBeDefined();
    expect(storedApptEvent?.icalString).toContain('BEGIN:VEVENT');
    expect(storedApptEvent?.icalString).toContain('SUMMARY:Ownlight - Consultation: Clara S.');
    // PII minimization: internal notes and phone numbers NOT sent to remote server
    expect(storedApptEvent?.icalString).not.toContain('Special dietary requirements');
    expect(storedApptEvent?.icalString).not.toContain('+49 170 1112233');

    // 8. Verify audit event calendar_sync.executed recorded for caldav
    const [syncAudit] = await dbClient
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, 'calendar_sync.executed'), eq(auditEvents.targetId, 'caldav')),
      )
      .limit(1);

    expect(syncAudit).toBeDefined();
    expect(syncAudit?.metadata).toMatchObject({
      provider: 'caldav',
      synced_count: 2,
      failed_count: 0,
    });
  });

  it('AC-3: updates an existing linked event on the CalDAV server when outbox action is update', async () => {
    const dbClient = getDb();

    // 1. Create initial appointment and existing sync link
    const startsAt = new Date('2026-11-28T09:00:00Z');
    const endsAt = new Date('2026-11-28T10:00:00Z');
    const [appt] = await dbClient
      .insert(appointments)
      .values({
        title: 'Consultation: Marc Weber',
        attendeeName: 'Marc Weber',
        attendeeEmail: 'marc@example.org',
        status: 'scheduled',
        startsAt,
        endsAt,
      })
      .returning();

    if (!appt?.id) throw new Error('Missing appointment');

    const externalUrl = `${fakeCaldav.baseUrl}/calendars/owner/work/marc-weber.ics`;
    const initialEtag = '"etag-caldav-initial"';
    fakeCaldav.events.set('/calendars/owner/work/marc-weber.ics', {
      url: '/calendars/owner/work/marc-weber.ics',
      icalString: 'BEGIN:VCALENDAR...SUMMARY:Initial...END:VCALENDAR',
      etag: initialEtag,
    });

    const [syncLink] = await dbClient
      .insert(calendarSyncLinks)
      .values({
        provider: 'caldav',
        entityType: 'appointment',
        entityId: appt.id,
        externalEventId: externalUrl,
        etag: initialEtag,
        syncedAt: new Date(),
      })
      .returning();

    // 2. Enqueue update in outbox
    const [outboxItem] = await dbClient
      .insert(calendarSyncOutbox)
      .values({
        entityType: 'appointment',
        entityId: appt.id,
        action: 'update',
        status: 'PENDING',
      })
      .returning();

    if (!outboxItem?.id || !syncLink?.id) throw new Error('Missing record');

    // 3. Process batch
    const result = await runCalendarSyncWorker({ dbClient });
    expect(result.syncedCount).toBe(1);

    // 4. Verify outbox completed
    const [updatedOutbox] = await dbClient
      .select()
      .from(calendarSyncOutbox)
      .where(eq(calendarSyncOutbox.id, outboxItem.id));
    expect(updatedOutbox?.status).toBe('COMPLETED');

    // 5. Verify server event was updated
    const updatedServerEvent = fakeCaldav.events.get('/calendars/owner/work/marc-weber.ics');
    expect(updatedServerEvent).toBeDefined();
    expect(updatedServerEvent?.icalString).toContain('SUMMARY:Ownlight - Consultation: Marc W.');
    expect(updatedServerEvent?.etag).not.toBe(initialEtag);

    // 6. Verify sync link updated with new etag
    const [updatedLink] = await dbClient
      .select()
      .from(calendarSyncLinks)
      .where(eq(calendarSyncLinks.id, syncLink.id));
    expect(updatedLink?.etag).toBe(updatedServerEvent?.etag);
  });

  it('AC-3: deletes an existing linked event and removes sync link when action is delete', async () => {
    const dbClient = getDb();

    const externalUrl = `${fakeCaldav.baseUrl}/calendars/owner/work/delete-me.ics`;
    fakeCaldav.events.set('/calendars/owner/work/delete-me.ics', {
      url: '/calendars/owner/work/delete-me.ics',
      icalString: 'BEGIN:VCALENDAR...END:VCALENDAR',
      etag: '"etag-del"',
    });

    const entityId = '01920000-0000-7000-8000-000000000077';
    await dbClient.insert(calendarSyncLinks).values({
      provider: 'caldav',
      entityType: 'appointment',
      entityId,
      externalEventId: externalUrl,
      etag: '"etag-del"',
      syncedAt: new Date(),
    });

    const [outboxItem] = await dbClient
      .insert(calendarSyncOutbox)
      .values({
        entityType: 'appointment',
        entityId,
        action: 'delete',
        status: 'PENDING',
      })
      .returning();

    if (!outboxItem?.id) throw new Error('Missing outbox item');

    const result = await runCalendarSyncWorker({ dbClient });
    expect(result.syncedCount).toBe(1);

    // Outbox item COMPLETED
    const [updatedOutbox] = await dbClient
      .select()
      .from(calendarSyncOutbox)
      .where(eq(calendarSyncOutbox.id, outboxItem.id));
    expect(updatedOutbox?.status).toBe('COMPLETED');

    // Remote event deleted
    expect(fakeCaldav.events.has('/calendars/owner/work/delete-me.ics')).toBe(false);

    // Sync link deleted
    const links = await dbClient
      .select()
      .from(calendarSyncLinks)
      .where(eq(calendarSyncLinks.entityId, entityId));
    expect(links).toHaveLength(0);
  });

  it('AC-4: inbound sync imports remote CalDAV busy periods and availability engine subtracts colliding slots', async () => {
    const dbClient = getDb();

    // 1. Seed Booking Type and Availability Schedule
    const [bType] = await dbClient
      .insert(bookingTypes)
      .values({
        slug: 'portrait-consultation',
        title: 'Portrait Consultation',
        durationMinutes: 60,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        minNoticeHours: 0,
        maxFutureDays: 60,
        isActive: true,
      })
      .returning();

    // Tuesday (day 2): 09:00 - 17:00
    await dbClient.insert(availabilitySchedules).values({
      dayOfWeek: 2,
      startTime: '09:00',
      endTime: '17:00',
      isActive: true,
    });

    // 2. Set remote busy event on Tuesday 2026-11-24 between 10:00 and 12:00 UTC
    const remoteBusyIcal = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Apple Inc.//macOS//EN',
      'BEGIN:VEVENT',
      'UID:caldav-busy-evt-1@example.org',
      'DTSTART:20261124T100000Z',
      'DTEND:20261124T120000Z',
      'SUMMARY:Dentist & Surgery',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    fakeCaldav.busyEvents.push(remoteBusyIcal);

    // 3. Run worker with forceInbound
    const syncRes = await runCalendarSyncWorker({ dbClient, forceInbound: true });
    expect(syncRes.inboundBusyCount).toBeGreaterThanOrEqual(1);

    // 4. Verify external_calendar_busy_intervals has the imported interval
    const busyIntervals = await dbClient
      .select()
      .from(externalCalendarBusyIntervals)
      .where(eq(externalCalendarBusyIntervals.provider, 'caldav'));

    expect(busyIntervals.length).toBeGreaterThanOrEqual(1);
    const imported = busyIntervals.find((b) => b.externalId === 'caldav-busy-evt-1@example.org');
    expect(imported).toBeDefined();
    expect(imported?.startsAt.toISOString()).toBe('2026-11-24T10:00:00.000Z');
    expect(imported?.endsAt.toISOString()).toBe('2026-11-24T12:00:00.000Z');

    if (!bType?.id) throw new Error('Missing booking type');

    // 5. Query availability engine for Tuesday 2026-11-24
    const availableSlots = await calculateAvailableSlots({
      bookingTypeId: bType.id,
      startDate: '2026-11-24',
      endDate: '2026-11-24',
      timezone: 'UTC',
      now: new Date('2026-11-24T00:00:00Z'),
      db: dbClient,
      studioTimezone: 'UTC',
    });

    // 6. Slots between 10:00 and 12:00 must be subtracted (AC-4)
    const slotTimes = availableSlots.map((s) => s.startTime);
    expect(slotTimes).toContain('09:00');
    expect(slotTimes).not.toContain('10:00');
    expect(slotTimes).not.toContain('11:00');
    expect(slotTimes).toContain('12:00');
    expect(slotTimes).toContain('13:00');
  });

  it('AC-3: outbound sync worker pushes blocked_time blackout interval to CalDAV', async () => {
    const dbClient = getDb();

    // 1. Create a blocked_time record
    const [bt] = await dbClient
      .insert(blockedTime)
      .values({
        title: 'Studio Floor Renovation',
        startsAt: new Date('2026-11-28T08:00:00Z'),
        endsAt: new Date('2026-11-28T16:00:00Z'),
        allDay: false,
      })
      .returning();

    if (!bt?.id) throw new Error('Failed to create blocked_time');

    // 2. Queue outbox item
    await dbClient.insert(calendarSyncOutbox).values({
      entityType: 'blocked_time',
      entityId: bt.id,
      action: 'create',
      status: 'PENDING',
    });

    // 3. Run worker
    const batchResult = await runCalendarSyncWorker({ dbClient });
    expect(batchResult.syncedCount).toBe(1);

    // 4. Verify sync link created for blocked_time
    const [link] = await dbClient
      .select()
      .from(calendarSyncLinks)
      .where(
        and(
          eq(calendarSyncLinks.provider, 'caldav'),
          eq(calendarSyncLinks.entityType, 'blocked_time'),
          eq(calendarSyncLinks.entityId, bt.id),
        ),
      )
      .limit(1);

    expect(link).toBeDefined();
    expect(link?.externalEventId).toContain(bt.id);
  });

  it('AC-4: handles inbound CalDAV busy sync error gracefully and logs lastSyncError', async () => {
    const dbClient = getDb();

    // 1. Point CalDAV account to an invalid server URL that fails
    await dbClient.update(caldavAccounts).set({
      selectedCalendarUrl: 'http://127.0.0.1:1/nonexistent-calendar/',
    });

    // 2. Run worker with forceInbound
    const result = await runCalendarSyncWorker({ dbClient, forceInbound: true });
    expect(result).toBeDefined();

    // 3. Verify lastSyncError is recorded
    const [account] = await dbClient.select().from(caldavAccounts).limit(1);
    expect(account?.lastSyncError).toBeDefined();
  });
});
