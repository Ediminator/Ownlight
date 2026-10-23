import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import {
  createFakeCalendarServer,
  type FakeCalendarServerInstance,
} from '../helpers/fake-calendar-server';
import {
  appointments,
  bookingTypes,
  availabilitySchedules,
  calendarSyncOutbox,
  calendarSyncLinks,
  externalCalendarBusyIntervals,
  blockedTime,
} from '@/server/db/schema/calendar';
import { clients } from '@/server/db/schema/clients';
import { projects, shoots, pipelineStages } from '@/server/db/schema/projects';
import { auditEvents } from '@/server/db/schema/audit';
import { encryptSecret } from '@/server/crypto/vault';
import {
  GOOGLE_OAUTH_PURPOSE,
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_CONTACTS_SCOPE,
} from '@/server/integrations/google/constants';
import { upsertGoogleOAuthToken } from '@/server/integrations/google/repo';
import {
  runCalendarSyncWorker,
  syncGoogleInboundFreeBusy,
} from '@/server/worker/calendar-sync-worker';
import { GoogleCalendarClient } from '@/server/integrations/google/calendar-client';
import { calculateAvailableSlots } from '@/server/calendar/availability';
import {
  startGoogleCalendarAuthAction,
  toggleGoogleCalendarSyncAction,
  selectGoogleCalendarAction,
  triggerManualCalendarSyncAction,
  getGoogleCalendarSettingsAction,
} from '@/server/integrations/google/calendar-actions';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';

describe('TASK-0046: Google Calendar & Meet Sync Integration (AC-2, AC-3, AC-5, AC-6, AC-8)', () => {
  let testDb: TestDatabaseInstance;
  let fakeCalendar: FakeCalendarServerInstance;

  const masterKey = '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a';

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    fakeCalendar = await createFakeCalendarServer();

    process.env.ENCRYPTION_KEY = masterKey;
    process.env.GOOGLE_CALENDAR_API_BASE_URL = fakeCalendar.baseUrl;
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-google-client-secret';

    // Seed Google OAuth token with both contacts and calendar scopes
    const encryptedRefreshToken = await encryptSecret('refresh-token-xyz', GOOGLE_OAUTH_PURPOSE);
    await upsertGoogleOAuthToken(
      {
        encryptedRefreshToken,
        accessToken: 'valid-test-access-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        scope: `${GOOGLE_CONTACTS_SCOPE} ${GOOGLE_CALENDAR_SCOPE}`,
        calendarSyncEnabled: true,
        selectedCalendarId: 'primary',
      },
      getDb(),
    );
  });

  afterEach(async () => {
    await fakeCalendar.close();
    await testDb.destroy();
    delete process.env.GOOGLE_CALENDAR_API_BASE_URL;
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
        title: 'Wedding Photography Session',
        currency: 'EUR',
      })
      .returning();
    if (!proj?.id) throw new Error('Project creation failed');
    return proj.id;
  }

  describe('AC-2: Google Meet Link Generation', () => {
    it('AC-2: requests conferenceData and persists generated Google Meet URL to appointment', async () => {
      const dbClient = getDb();

      // 1. Create appointment with locationType = 'google_meet'
      const startsAt = new Date('2026-11-10T10:00:00Z');
      const endsAt = new Date('2026-11-10T11:00:00Z');

      const [appointment] = await dbClient
        .insert(appointments)
        .values({
          title: 'Discovery Consultation',
          startsAt,
          endsAt,
          locationType: 'google_meet',
          attendeeName: 'Robert Schumann',
          attendeeEmail: 'robert.schumann@example.com',
          status: 'scheduled',
        })
        .returning();
      if (!appointment?.id) throw new Error('Appointment creation failed');

      // 2. Enqueue in calendar_sync_outbox
      const [outboxItem] = await dbClient
        .insert(calendarSyncOutbox)
        .values({
          entityType: 'appointment',
          entityId: appointment.id,
          action: 'create',
          status: 'PENDING',
        })
        .returning();
      if (!outboxItem?.id) throw new Error('Outbox creation failed');

      // 3. Process with calendar sync worker
      const result = await runCalendarSyncWorker({ dbClient });
      expect(result.syncedCount).toBe(1);
      expect(result.failedCount).toBe(0);

      // 4. Verify Google Calendar request was sent with conferenceData.createRequest
      const calendarReq = fakeCalendar.requests.find(
        (r) => r.method === 'POST' && r.url.includes('/events'),
      );
      expect(calendarReq).toBeDefined();
      expect(calendarReq?.parsedBody?.conferenceData).toEqual({
        createRequest: {
          requestId: appointment.id,
          conferenceSolutionKey: {
            type: 'hangoutsMeet',
          },
        },
      });

      // 5. Verify appointment was updated with Google Meet URL
      const [updatedAppointment] = await dbClient
        .select()
        .from(appointments)
        .where(eq(appointments.id, appointment.id));

      expect(updatedAppointment?.meetUrl).toMatch(/^https:\/\/meet\.google\.com\//);

      // 6. Verify outbox completed
      const [completedOutbox] = await dbClient
        .select()
        .from(calendarSyncOutbox)
        .where(eq(calendarSyncOutbox.id, outboxItem.id));
      expect(completedOutbox?.status).toBe('COMPLETED');
    });
  });

  describe('AC-3: Outbound Sync Worker Processing and Audit Logging', () => {
    it('AC-3: inserts shoot and appointment events, stores calendar links, and records calendar_sync.executed audit event', async () => {
      const dbClient = getDb();
      const projectId = await createTestProject();

      // 1. Create a shoot
      const shootStartsAt = new Date('2026-11-12T14:00:00Z');
      const shootEndsAt = new Date('2026-11-12T16:00:00Z');
      const [shoot] = await dbClient
        .insert(shoots)
        .values({
          projectId,
          title: 'Bridal Portrait',
          startsAt: shootStartsAt,
          endsAt: shootEndsAt,
        })
        .returning();
      if (!shoot?.id) throw new Error('Shoot creation failed');

      // Enqueue shoot in outbox
      await dbClient.insert(calendarSyncOutbox).values({
        entityType: 'shoot',
        entityId: shoot.id,
        action: 'create',
        status: 'PENDING',
      });

      // 2. Run sync worker
      const result = await runCalendarSyncWorker({ dbClient });
      expect(result.syncedCount).toBe(1);
      expect(result.failedCount).toBe(0);

      // 3. Verify calendar sync link was created
      const [link] = await dbClient
        .select()
        .from(calendarSyncLinks)
        .where(eq(calendarSyncLinks.entityId, shoot.id));

      expect(link).toBeDefined();
      expect(link?.provider).toBe('google');
      expect(link?.externalEventId).toBeTruthy();

      // 4. Verify audit event was logged
      const [auditEvent] = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'calendar_sync.executed'));

      expect(auditEvent).toBeDefined();
      expect(auditEvent?.action).toBe('calendar_sync.executed');
      expect(auditEvent?.outcome).toBe('success');
    });

    it('AC-3: updates an existing linked event when existingLink is present', async () => {
      const dbClient = getDb();
      const [appointment] = await dbClient
        .insert(appointments)
        .values({
          title: 'Portrait Session Rescheduled',
          status: 'scheduled',
          startsAt: new Date('2026-11-20T14:00:00Z'),
          endsAt: new Date('2026-11-20T15:00:00Z'),
          timezone: 'Europe/Berlin',
          attendeeName: 'Anna Frank',
          attendeeEmail: 'anna@example.org',
          locationType: 'in_person',
          locationDetails: 'Studio Room A',
        })
        .returning();
      if (!appointment?.id) throw new Error('Appointment creation failed');

      // Seed pre-existing sync link
      await dbClient.insert(calendarSyncLinks).values({
        provider: 'google',
        entityType: 'appointment',
        entityId: appointment.id,
        externalEventId: 'existing-google-event-id-123',
        etag: '"initial-etag"',
      });

      // Enqueue update in outbox
      await dbClient.insert(calendarSyncOutbox).values({
        entityType: 'appointment',
        entityId: appointment.id,
        action: 'update',
        status: 'PENDING',
      });

      const result = await runCalendarSyncWorker({ dbClient });
      expect(result.syncedCount).toBe(1);
      expect(result.failedCount).toBe(0);

      // Verify sync link was updated with new timestamp
      const [link] = await dbClient
        .select()
        .from(calendarSyncLinks)
        .where(eq(calendarSyncLinks.entityId, appointment.id));
      expect(link?.externalEventId).toBe('existing-google-event-id-123');
      expect(link?.syncedAt).toBeDefined();
    });

    it('AC-3: deletes an existing linked event and removes sync link when action is delete', async () => {
      const dbClient = getDb();
      const fakeEntityId = '01920000-0000-7000-8000-000000000099';

      await dbClient.insert(calendarSyncLinks).values({
        provider: 'google',
        entityType: 'appointment',
        entityId: fakeEntityId,
        externalEventId: 'google-event-to-delete',
        etag: '"etag-to-delete"',
      });

      await dbClient.insert(calendarSyncOutbox).values({
        entityType: 'appointment',
        entityId: fakeEntityId,
        action: 'delete',
        status: 'PENDING',
      });

      const result = await runCalendarSyncWorker({ dbClient });
      expect(result.syncedCount).toBe(1);

      // Verify sync link was removed
      const remainingLinks = await dbClient
        .select()
        .from(calendarSyncLinks)
        .where(eq(calendarSyncLinks.entityId, fakeEntityId));
      expect(remainingLinks).toHaveLength(0);
    });

    it('AC-3: syncs blocked_time interval and handles cancelled appointments', async () => {
      const dbClient = getDb();

      // Blocked time
      const [bt] = await dbClient
        .insert(blockedTime)
        .values({
          title: 'Studio Maintenance',
          startsAt: new Date('2026-11-25T08:00:00Z'),
          endsAt: new Date('2026-11-25T18:00:00Z'),
          notes: 'Painting and cleaning',
        })
        .returning();
      if (!bt?.id) throw new Error('Blocked time creation failed');

      await dbClient.insert(calendarSyncOutbox).values({
        entityType: 'blocked_time',
        entityId: bt.id,
        action: 'create',
        status: 'PENDING',
      });

      // Cancelled appointment with existing link
      const [cancelledAppt] = await dbClient
        .insert(appointments)
        .values({
          title: 'Cancelled Consultation',
          status: 'cancelled',
          startsAt: new Date('2026-11-26T10:00:00Z'),
          endsAt: new Date('2026-11-26T11:00:00Z'),
          timezone: 'Europe/Berlin',
          attendeeName: 'Tom Riddle',
          attendeeEmail: 'tom@example.org',
          locationType: 'in_person',
        })
        .returning();
      if (!cancelledAppt?.id) throw new Error('Cancelled appointment creation failed');

      await dbClient.insert(calendarSyncLinks).values({
        provider: 'google',
        entityType: 'appointment',
        entityId: cancelledAppt.id,
        externalEventId: 'cancelled-event-google-id',
        etag: '"etag"',
      });

      await dbClient.insert(calendarSyncOutbox).values({
        entityType: 'appointment',
        entityId: cancelledAppt.id,
        action: 'update',
        status: 'PENDING',
      });

      // Missing shoot (deleted before sync)
      await dbClient.insert(calendarSyncOutbox).values({
        entityType: 'shoot',
        entityId: '01920000-0000-7000-8000-000000000888',
        action: 'create',
        status: 'PENDING',
      });

      const result = await runCalendarSyncWorker({ dbClient });
      expect(result.syncedCount).toBe(2); // bt + cancelledAppt
      expect(result.failedCount).toBe(0);

      // Blocked time link created
      const [btLink] = await dbClient
        .select()
        .from(calendarSyncLinks)
        .where(eq(calendarSyncLinks.entityId, bt.id));
      expect(btLink).toBeDefined();

      // Cancelled appointment link removed
      const cancelledLinks = await dbClient
        .select()
        .from(calendarSyncLinks)
        .where(eq(calendarSyncLinks.entityId, cancelledAppt.id));
      expect(cancelledLinks).toHaveLength(0);
    });

    it('AC-3: returns early when calendar sync is disabled or scopes are missing', async () => {
      const dbClient = getDb();
      const { updateGoogleCalendarSettings } = await import('@/server/integrations/google/repo');
      await updateGoogleCalendarSettings({ calendarSyncEnabled: false }, dbClient);

      const result = await runCalendarSyncWorker({ dbClient });
      expect(result.syncedCount).toBe(0);
      expect(result.failedCount).toBe(0);

      // Re-enable
      await updateGoogleCalendarSettings({ calendarSyncEnabled: true }, dbClient);
    });

    it('AC-3: handles missing blocked_time entity gracefully and records inbound free/busy failure', async () => {
      const dbClient = getDb();

      // Enqueue non-existent blocked_time item
      await dbClient.insert(calendarSyncOutbox).values({
        entityType: 'blocked_time',
        entityId: '01920000-0000-7000-8000-000000000777',
        action: 'create',
        status: 'PENDING',
      });

      // Override freeBusy endpoint with 500 error to trigger catch block
      fakeCalendar.setResponseOverride('POST', '/freeBusy', 500, {
        error: { message: 'Internal Server Error' },
      });

      const result = await runCalendarSyncWorker({ dbClient, forceInbound: true });
      expect(result.syncedCount).toBe(0); // missing entity marked completed, not counted as synced
      expect(result.failedCount).toBe(0);

      // Verify token record has lastCalendarSyncError populated
      const { getGoogleOAuthToken } = await import('@/server/integrations/google/repo');
      const token = await getGoogleOAuthToken(dbClient);
      expect(token?.lastCalendarSyncError).toContain('500');

      fakeCalendar.reset();
    });

    it('AC-3: returns early when calendar sync is enabled but calendar.events scope is absent', async () => {
      const dbClient = getDb();
      const { upsertGoogleOAuthToken, getGoogleOAuthToken } =
        await import('@/server/integrations/google/repo');
      const originalToken = await getGoogleOAuthToken(dbClient);
      if (!originalToken) throw new Error('Token missing');

      // Update token with only contacts scope
      await upsertGoogleOAuthToken(
        {
          encryptedRefreshToken: originalToken.encryptedRefreshToken,
          accessToken: originalToken.accessToken,
          accessTokenExpiresAt: originalToken.accessTokenExpiresAt,
          scope: GOOGLE_CONTACTS_SCOPE,
          calendarSyncEnabled: true,
          selectedCalendarId: 'primary',
        },
        dbClient,
      );

      const result = await runCalendarSyncWorker({ dbClient });
      expect(result.syncedCount).toBe(0);
      expect(result.failedCount).toBe(0);

      // Restore original token
      await upsertGoogleOAuthToken(
        {
          encryptedRefreshToken: originalToken.encryptedRefreshToken,
          accessToken: originalToken.accessToken,
          accessTokenExpiresAt: originalToken.accessTokenExpiresAt,
          scope: `${GOOGLE_CONTACTS_SCOPE} ${GOOGLE_CALENDAR_SCOPE}`,
          calendarSyncEnabled: true,
          selectedCalendarId: 'primary',
        },
        dbClient,
      );
    });

    it('AC-3: handles delete action when no existingLink was stored', async () => {
      const dbClient = getDb();
      const unlinkedEntityId = '01920000-0000-7000-8000-000000000444';

      const [outboxItem] = await dbClient
        .insert(calendarSyncOutbox)
        .values({
          entityType: 'shoot',
          entityId: unlinkedEntityId,
          action: 'delete',
          status: 'PENDING',
        })
        .returning();
      if (!outboxItem?.id) throw new Error('Outbox item failed');

      const result = await runCalendarSyncWorker({ dbClient });
      expect(result.syncedCount).toBe(1);
      expect(result.failedCount).toBe(0);

      const [completedOutbox] = await dbClient
        .select()
        .from(calendarSyncOutbox)
        .where(eq(calendarSyncOutbox.id, outboxItem.id));
      expect(completedOutbox?.status).toBe('COMPLETED');
    });

    it('AC-3: retries outbox item when Google Calendar delete returns 500 error', async () => {
      const dbClient = getDb();
      const linkedEntityId = '01920000-0000-7000-8000-000000000333';

      await dbClient.insert(calendarSyncLinks).values({
        provider: 'google',
        entityType: 'appointment',
        entityId: linkedEntityId,
        externalEventId: 'event-delete-failure',
        etag: '"etag"',
      });

      const [outboxItem] = await dbClient
        .insert(calendarSyncOutbox)
        .values({
          entityType: 'appointment',
          entityId: linkedEntityId,
          action: 'delete',
          status: 'PENDING',
          attempts: 0,
        })
        .returning();
      if (!outboxItem?.id) throw new Error('Outbox creation failed');

      fakeCalendar.setResponseOverride('DELETE', '/events', 500, {
        error: { message: 'Internal Server Error' },
      });

      try {
        const result = await runCalendarSyncWorker({ dbClient });
        expect(result.failedCount).toBe(1);
        expect(result.syncedCount).toBe(0);

        const [retryOutbox] = await dbClient
          .select()
          .from(calendarSyncOutbox)
          .where(eq(calendarSyncOutbox.id, outboxItem.id));
        expect(retryOutbox?.status).toBe('PENDING');
        expect(retryOutbox?.attempts).toBe(1);
        expect(retryOutbox?.lastError).toContain('500');
      } finally {
        fakeCalendar.reset();
      }
    });

    it('AC-3: handles missing appointment entity and formats description with meetUrl and locationDetails', async () => {
      const dbClient = getDb();

      // 1. Missing appointment entity
      const [missingOutbox] = await dbClient
        .insert(calendarSyncOutbox)
        .values({
          entityType: 'appointment',
          entityId: '01920000-0000-7000-8000-000000000555',
          action: 'create',
          status: 'PENDING',
        })
        .returning();
      if (!missingOutbox?.id) throw new Error('Outbox item creation failed');

      // 2. Appointment with pre-existing meetUrl
      const [apptWithMeetUrl] = await dbClient
        .insert(appointments)
        .values({
          title: 'Virtual Review',
          status: 'scheduled',
          startsAt: new Date('2026-11-28T14:00:00Z'),
          endsAt: new Date('2026-11-28T15:00:00Z'),
          timezone: 'Europe/Berlin',
          attendeeName: 'Felix Mendelssohn',
          attendeeEmail: 'felix@example.org',
          locationType: 'in_person',
          meetUrl: 'https://meet.google.com/existing-room',
        })
        .returning();
      if (!apptWithMeetUrl?.id) throw new Error('Appt creation failed');

      await dbClient.insert(calendarSyncOutbox).values({
        entityType: 'appointment',
        entityId: apptWithMeetUrl.id,
        action: 'create',
        status: 'PENDING',
      });

      // 3. Cancelled appointment without pre-existing sync link
      const [cancelledWithoutLink] = await dbClient
        .insert(appointments)
        .values({
          title: 'Never Linked Cancelled',
          status: 'cancelled',
          startsAt: new Date('2026-11-29T10:00:00Z'),
          endsAt: new Date('2026-11-29T11:00:00Z'),
          timezone: 'Europe/Berlin',
          attendeeName: 'Fanny Mendelssohn',
          attendeeEmail: 'fanny@example.org',
          locationType: 'in_person',
        })
        .returning();
      if (!cancelledWithoutLink?.id) throw new Error('Appt creation failed');

      await dbClient.insert(calendarSyncOutbox).values({
        entityType: 'appointment',
        entityId: cancelledWithoutLink.id,
        action: 'update',
        status: 'PENDING',
      });

      const result = await runCalendarSyncWorker({ dbClient });
      // apptWithMeetUrl synced (1) + cancelledWithoutLink marked completed/synced (1) = 2
      expect(result.syncedCount).toBe(2);
      expect(result.failedCount).toBe(0);

      // Verify missing entity was marked completed
      const [completedMissing] = await dbClient
        .select()
        .from(calendarSyncOutbox)
        .where(eq(calendarSyncOutbox.id, missingOutbox.id));
      expect(completedMissing?.status).toBe('COMPLETED');

      // Verify description included Google Meet link
      const meetReq = fakeCalendar.requests.find(
        (r) =>
          r.method === 'POST' &&
          r.url.includes('/events') &&
          typeof r.parsedBody?.description === 'string' &&
          r.parsedBody.description.includes('Google Meet: https://meet.google.com/existing-room'),
      );
      expect(meetReq).toBeDefined();
    });

    it('AC-3: handles shoot without endsAt falling back to 1 hour', async () => {
      const dbClient = getDb();
      const projectId = await createTestProject();

      const shootStartsAt = new Date('2026-11-30T10:00:00Z');
      const [shoot] = await dbClient
        .insert(shoots)
        .values({
          projectId,
          title: 'Quick Studio Shoot',
          startsAt: shootStartsAt,
          endsAt: null,
        })
        .returning();
      if (!shoot?.id) throw new Error('Shoot creation failed');

      await dbClient.insert(calendarSyncOutbox).values({
        entityType: 'shoot',
        entityId: shoot.id,
        action: 'create',
        status: 'PENDING',
      });

      const result = await runCalendarSyncWorker({ dbClient });
      expect(result.syncedCount).toBe(1);
      expect(result.failedCount).toBe(0);

      const shootReq = fakeCalendar.requests.find(
        (r) =>
          r.method === 'POST' &&
          r.url.includes('/events') &&
          typeof r.parsedBody?.summary === 'string' &&
          r.parsedBody.summary.includes('Quick Studio Shoot'),
      );
      expect(shootReq).toBeDefined();
      expect((shootReq?.parsedBody?.end as { dateTime?: string } | undefined)?.dateTime).toBe(
        new Date(shootStartsAt.getTime() + 60 * 60 * 1000).toISOString(),
      );
    });
  });

  describe('AC-5: Inbound Free/Busy Query & Availability Engine Integration', () => {
    it('AC-5: fetches external busy intervals and availability engine subtracts them from available slots', async () => {
      const dbClient = getDb();

      // 1. Configure busy intervals in fake Google Calendar
      const busyStart = '2026-11-02T10:00:00Z';
      const busyEnd = '2026-11-02T12:00:00Z';
      fakeCalendar.busyRanges = [{ start: busyStart, end: busyEnd }];

      // 2. Seed a booking type and schedule for Monday (2026-11-02 is a Monday)
      const [bookingType] = await dbClient
        .insert(bookingTypes)
        .values({
          slug: 'portrait-consult',
          title: 'Portrait Consultation',
          durationMinutes: 60,
          isActive: true,
        })
        .returning();
      if (!bookingType?.id) throw new Error('Booking type creation failed');

      // Schedule Monday (dayOfWeek = 1): 09:00 - 17:00 Berlin time
      await dbClient.insert(availabilitySchedules).values({
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '17:00',
        isActive: true,
      });

      // 3. Sync inbound Google free/busy
      const calendarClient = new GoogleCalendarClient({
        dbClient,
      });
      await syncGoogleInboundFreeBusy({
        calendarClient,
        calendarId: 'primary',
        dbClient,
        now: new Date('2026-11-01T00:00:00Z'),
      });

      // 4. Verify external busy intervals table has cached range
      const cachedBusy = await dbClient.select().from(externalCalendarBusyIntervals);
      expect(cachedBusy.length).toBeGreaterThan(0);
      expect(cachedBusy[0]?.provider).toBe('google');

      // 5. Query availability engine for 2026-11-02
      const slots = await calculateAvailableSlots({
        bookingTypeId: bookingType.id,
        startDate: '2026-11-02',
        endDate: '2026-11-02',
        timezone: 'Europe/Berlin',
        db: dbClient,
      });

      // Verify that no available slot overlaps with 10:00 - 12:00 UTC (11:00 - 13:00 Berlin)
      const overlappingSlot = slots.find((slot) => {
        const slotStart = new Date(slot.startsAt).getTime();
        const slotEnd = new Date(slot.endsAt).getTime();
        const bStart = new Date(busyStart).getTime();
        const bEnd = new Date(busyEnd).getTime();
        return slotStart < bEnd && slotEnd > bStart;
      });

      expect(overlappingSlot).toBeUndefined();
      expect(slots.length).toBeGreaterThan(0);
    });
  });

  describe('AC-6: Error Handling & Exponential Backoff on 503 / 429', () => {
    it('AC-6: increments attempts, schedules next_attempt_at with backoff, and keeps status PENDING on 503', async () => {
      const dbClient = getDb();
      const projectId = await createTestProject();

      const [shoot] = await dbClient
        .insert(shoots)
        .values({
          projectId,
          title: 'Fashion Shoot',
          startsAt: new Date('2026-11-15T12:00:00Z'),
          endsAt: new Date('2026-11-15T14:00:00Z'),
        })
        .returning();
      if (!shoot?.id) throw new Error('Shoot creation failed');

      const [outboxItem] = await dbClient
        .insert(calendarSyncOutbox)
        .values({
          entityType: 'shoot',
          entityId: shoot.id,
          action: 'create',
          status: 'PENDING',
          attempts: 0,
        })
        .returning();
      if (!outboxItem?.id) throw new Error('Outbox item creation failed');

      // Inject 503 Service Unavailable override
      fakeCalendar.setResponseOverride('POST', '/events', 503, {
        error: { message: 'Service Unavailable' },
      });

      const beforeRun = Date.now();
      const result = await runCalendarSyncWorker({ dbClient });

      expect(result.failedCount).toBe(1);
      expect(result.syncedCount).toBe(0);

      // Verify outbox item state
      const [updatedOutbox] = await dbClient
        .select()
        .from(calendarSyncOutbox)
        .where(eq(calendarSyncOutbox.id, outboxItem.id));

      expect(updatedOutbox?.attempts).toBe(1);
      expect(updatedOutbox?.status).toBe('PENDING');
      expect(updatedOutbox?.lastError).toContain('503');
      expect(updatedOutbox?.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(beforeRun + 25_000);
    });
  });

  describe('AC-8: Authorization and Rejection for Unauthenticated Callers', () => {
    it('AC-8: rejects startGoogleCalendarAuthAction with UNAUTHENTICATED when unauthenticated', async () => {
      const res = await startGoogleCalendarAuthAction('http://localhost:3000', getDb());
      expect(res.success).toBe(false);
      expect(res.code).toBe('UNAUTHENTICATED');
    });

    it('AC-8: rejects toggleGoogleCalendarSyncAction with UNAUTHENTICATED when unauthenticated', async () => {
      const res = await toggleGoogleCalendarSyncAction({ enabled: true }, getDb());
      expect(res.success).toBe(false);
      expect(res.code).toBe('UNAUTHENTICATED');
    });

    it('AC-8: rejects selectGoogleCalendarAction with UNAUTHENTICATED when unauthenticated', async () => {
      const res = await selectGoogleCalendarAction({ calendarId: 'primary' }, getDb());
      expect(res.success).toBe(false);
      expect(res.code).toBe('UNAUTHENTICATED');
    });

    it('AC-8: rejects triggerManualCalendarSyncAction with UNAUTHENTICATED when unauthenticated', async () => {
      const res = await triggerManualCalendarSyncAction(getDb());
      expect(res.success).toBe(false);
      expect(res.code).toBe('UNAUTHENTICATED');
    });

    it('AC-8: rejects getGoogleCalendarSettingsAction with UNAUTHENTICATED when unauthenticated', async () => {
      const res = await getGoogleCalendarSettingsAction(getDb());
      expect(res.success).toBe(false);
      expect(res.code).toBe('UNAUTHENTICATED');
    });
  });
});
