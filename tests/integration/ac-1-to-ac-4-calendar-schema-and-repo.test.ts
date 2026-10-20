import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { DbClient } from '@/server/db/client';
import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import {
  bookingTypes,
  appointments,
  blockedTime,
  availabilitySchedules,
  availabilityOverrides,
  calendarFeeds,
  caldavAccounts,
  calendarSyncOutbox,
  calendarSyncLinks,
} from '@/server/db/schema/calendar';
import { clients } from '@/server/db/schema/clients';
import { projects, pipelineStages } from '@/server/db/schema/projects';
import {
  createAppointment,
  cancelAppointment,
  updateAppointment,
  createBlockedTime,
  updateBlockedTime,
  deleteBlockedTime,
  getBlockedTimeById,
} from '@/server/calendar/service';
import * as repo from '@/server/calendar/repo';
import { seedDefaultCalendarData } from '@/server/db/seeds/calendar';
import { seedDefaultPipelineStages } from '@/server/db/seeds/pipeline-stages';

describe('TASK-0040: Calendar Schema, Migrations, Seeds, and Repository CRUD (AC-1 to AC-4)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    await seedDefaultPipelineStages(dbClient);
  }, 30000);

  afterEach(async () => {
    await testDb.destroy();
  });

  // AC-1
  describe('AC-1: Database Schema and 9 Calendar Tables Verification', () => {
    it('AC-1: all 9 calendar tables exist and enforce expected primary keys, foreign keys, and constraints', async () => {
      // 1. booking_types
      const [bType] = await dbClient
        .insert(bookingTypes)
        .values({
          slug: 'mini-session',
          title: 'Mini Session',
          durationMinutes: 20,
          bufferBeforeMinutes: 5,
          bufferAfterMinutes: 10,
          minNoticeHours: 12,
          maxFutureDays: 30,
          locationType: 'in_person',
          color: 'purple',
          isActive: true,
        })
        .returning();

      expect(bType).toBeDefined();
      expect(bType?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(bType?.slug).toBe('mini-session');

      // Unique constraint on booking_types.slug
      await expect(
        dbClient.insert(bookingTypes).values({
          slug: 'mini-session',
          title: 'Duplicate Slug',
        }),
      ).rejects.toThrow();

      // Check constraint on booking_types.location_type
      await expect(
        dbClient.insert(bookingTypes).values({
          slug: 'invalid-loc',
          title: 'Invalid Loc',
          locationType: 'invalid_location' as unknown as 'in_person',
        }),
      ).rejects.toThrow();

      // Setup client, lead, project for foreign keys
      const [client] = await dbClient
        .insert(clients)
        .values({
          kind: 'person',
          displayName: 'Test Client',
          preferredLocale: 'en',
          lastActivityAt: new Date(),
        })
        .returning();

      const [stage] = await dbClient.select().from(pipelineStages).limit(1);

      const [project] = await dbClient
        .insert(projects)
        .values({
          clientId: client?.id ?? '',
          stageId: stage?.id ?? '',
          title: 'Project for Appointment',
          lastActivityAt: new Date(),
        })
        .returning();

      // 2. appointments
      const [app] = await dbClient
        .insert(appointments)
        .values({
          bookingTypeId: bType?.id ?? '',
          clientId: client?.id ?? '',
          projectId: project?.id ?? '',
          leadId: null,
          title: 'Consultation with Alice',
          status: 'scheduled',
          startsAt: new Date('2026-10-26T10:00:00.000Z'),
          endsAt: new Date('2026-10-26T10:20:00.000Z'),
          timezone: 'Europe/Berlin',
          attendeeName: 'Alice Smith',
          attendeeEmail: 'alice@example.com',
          locationType: 'in_person',
        })
        .returning();

      expect(app).toBeDefined();
      expect(app?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(app?.status).toBe('scheduled');

      // Check constraint on appointments.status
      await expect(
        dbClient.insert(appointments).values({
          title: 'Invalid Status App',
          status: 'invalid_status' as unknown as 'scheduled',
          startsAt: new Date(),
          endsAt: new Date(),
          attendeeName: 'Test',
          attendeeEmail: 'test@example.com',
        }),
      ).rejects.toThrow();

      // 3. blocked_time
      const [bt] = await dbClient
        .insert(blockedTime)
        .values({
          title: 'Studio Closed',
          startsAt: new Date('2026-10-27T08:00:00.000Z'),
          endsAt: new Date('2026-10-27T18:00:00.000Z'),
          allDay: true,
          notes: 'Studio floor refinishing',
        })
        .returning();

      expect(bt).toBeDefined();
      expect(bt?.allDay).toBe(true);

      // 4. availability_schedules
      const [sc] = await dbClient
        .insert(availabilitySchedules)
        .values({
          dayOfWeek: 1,
          startTime: '08:30',
          endTime: '16:30',
          isActive: true,
        })
        .returning();

      expect(sc).toBeDefined();
      expect(sc?.startTime).toBe('08:30');

      // Check constraint on availability_schedules.day_of_week
      await expect(
        dbClient.insert(availabilitySchedules).values({
          dayOfWeek: 7, // Invalid! Only 0-6
          startTime: '09:00',
          endTime: '17:00',
        }),
      ).rejects.toThrow();

      // 5. availability_overrides
      const [ov] = await dbClient
        .insert(availabilityOverrides)
        .values({
          date: '2026-12-25',
          startTime: '09:00',
          endTime: '12:00',
          isUnavailable: true,
          reason: 'Christmas Holiday',
        })
        .returning();

      expect(ov).toBeDefined();
      expect(ov?.isUnavailable).toBe(true);

      // Unique constraint on (date, start_time)
      await expect(
        dbClient.insert(availabilityOverrides).values({
          date: '2026-12-25',
          startTime: '09:00',
          isUnavailable: true,
        }),
      ).rejects.toThrow();

      // 6. calendar_feeds
      const [feed] = await dbClient
        .insert(calendarFeeds)
        .values({
          tokenHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          name: 'Main Feed',
          summaryLevel: 'standard',
          isActive: true,
        })
        .returning();

      expect(feed).toBeDefined();

      // Unique constraint on calendar_feeds.token_hash
      await expect(
        dbClient.insert(calendarFeeds).values({
          tokenHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          name: 'Second Feed',
        }),
      ).rejects.toThrow();

      // Check constraint on calendar_feeds.summary_level
      await expect(
        dbClient.insert(calendarFeeds).values({
          tokenHash: 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce',
          name: 'Feed',
          summaryLevel: 'invalid_level' as unknown as 'standard',
        }),
      ).rejects.toThrow();

      // 7. caldav_accounts
      const [caldav] = await dbClient
        .insert(caldavAccounts)
        .values({
          serverUrl: 'https://caldav.example.com',
          username: 'photographer@example.com',
          encryptedPassword: 'vault-encrypted-ciphertext',
          selectedCalendarName: 'Work',
          isActive: true,
        })
        .returning();

      expect(caldav).toBeDefined();
      expect(caldav?.serverUrl).toBe('https://caldav.example.com');

      // 8. calendar_sync_outbox
      const [outbox] = await dbClient
        .insert(calendarSyncOutbox)
        .values({
          entityType: 'appointment',
          entityId: app?.id ?? '',
          action: 'create',
          status: 'PENDING',
        })
        .returning();

      expect(outbox).toBeDefined();
      expect(outbox?.status).toBe('PENDING');

      // Check constraint on calendar_sync_outbox.status
      await expect(
        dbClient.insert(calendarSyncOutbox).values({
          entityType: 'appointment',
          entityId: app?.id ?? '',
          action: 'create',
          status: 'INVALID_STATUS' as unknown as 'PENDING',
        }),
      ).rejects.toThrow();

      // 9. calendar_sync_links
      const [link] = await dbClient
        .insert(calendarSyncLinks)
        .values({
          provider: 'google',
          entityType: 'appointment',
          entityId: app?.id ?? '',
          externalEventId: 'google-event-id-12345',
        })
        .returning();

      expect(link).toBeDefined();

      // Unique constraint on (provider, entity_type, entity_id)
      await expect(
        dbClient.insert(calendarSyncLinks).values({
          provider: 'google',
          entityType: 'appointment',
          entityId: app?.id ?? '',
          externalEventId: 'conflicting-google-id',
        }),
      ).rejects.toThrow();
    });
  });

  // AC-2
  describe('AC-2: Calendar Seeds Verification and Idempotency', () => {
    it('AC-2: seedDefaultCalendarData creates default weekly schedules and booking types idempotently', async () => {
      const firstRun = await seedDefaultCalendarData(dbClient);

      // Verify schedules: 7 days total (Mon-Fri active 09:00-17:00, Sat/Sun inactive)
      expect(firstRun.schedules).toHaveLength(7);

      const monToFri = firstRun.schedules.filter((s) => s.dayOfWeek >= 1 && s.dayOfWeek <= 5);
      expect(monToFri).toHaveLength(5);
      for (const s of monToFri) {
        expect(s.isActive).toBe(true);
        expect(s.startTime).toBe('09:00');
        expect(s.endTime).toBe('17:00');
      }

      const weekend = firstRun.schedules.filter((s) => s.dayOfWeek === 0 || s.dayOfWeek === 6);
      expect(weekend).toHaveLength(2);
      for (const s of weekend) {
        expect(s.isActive).toBe(false);
        expect(s.startTime).toBe('09:00');
        expect(s.endTime).toBe('17:00');
      }

      // Verify booking types: discovery-call (30m) and consultation (60m)
      expect(firstRun.bookingTypes).toHaveLength(2);

      const discovery = firstRun.bookingTypes.find((b) => b.slug === 'discovery-call');
      expect(discovery).toBeDefined();
      expect(discovery?.title).toBe('Discovery Call');
      expect(discovery?.durationMinutes).toBe(30);
      expect(discovery?.bufferAfterMinutes).toBe(15);
      expect(discovery?.minNoticeHours).toBe(24);
      expect(discovery?.locationType).toBe('google_meet');
      expect(discovery?.isActive).toBe(true);

      const consultation = firstRun.bookingTypes.find((b) => b.slug === 'consultation');
      expect(consultation).toBeDefined();
      expect(consultation?.title).toBe('Consultation');
      expect(consultation?.durationMinutes).toBe(60);
      expect(consultation?.bufferAfterMinutes).toBe(15);
      expect(consultation?.minNoticeHours).toBe(24);
      expect(consultation?.locationType).toBe('google_meet');
      expect(consultation?.isActive).toBe(true);

      // Idempotency: execute seed again
      const secondRun = await seedDefaultCalendarData(dbClient);
      expect(secondRun.schedules).toHaveLength(7);
      expect(secondRun.bookingTypes).toHaveLength(2);

      // Verify database total rows
      const allSchedules = await dbClient.select().from(availabilitySchedules);
      const allBookingTypes = await dbClient.select().from(bookingTypes);
      expect(allSchedules).toHaveLength(7);
      expect(allBookingTypes).toHaveLength(2);
    });
  });

  // AC-3
  describe('AC-3: Appointment CRUD and Range Queries (R-A)', () => {
    it('AC-3: creates appointment in status scheduled, links to client/project/lead, and queries by range', async () => {
      const [client] = await dbClient
        .insert(clients)
        .values({
          kind: 'person',
          displayName: 'Jane Doe',
          preferredLocale: 'en',
          lastActivityAt: new Date(),
        })
        .returning();

      const [stage] = await dbClient.select().from(pipelineStages).limit(1);

      const [project] = await dbClient
        .insert(projects)
        .values({
          clientId: client?.id ?? '',
          stageId: stage?.id ?? '',
          title: 'Jane Wedding Planning',
          lastActivityAt: new Date(),
        })
        .returning();

      const createResult = await createAppointment(
        {
          clientId: client?.id ?? '',
          projectId: project?.id ?? '',
          title: 'Concept & Moodboard Review',
          startsAt: new Date('2026-10-28T14:00:00.000Z'),
          endsAt: new Date('2026-10-28T15:00:00.000Z'),
          timezone: 'Europe/Berlin',
          attendeeName: 'Jane Doe',
          attendeeEmail: 'jane@example.com',
          attendeePhone: '+49 30 123456',
          locationType: 'google_meet',
        },
        'owner-user-id',
        dbClient,
      );

      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const app = createResult.data;
      expect(app.id).toBeDefined();
      expect(app.status).toBe('scheduled');
      expect(app.clientId).toBe(client?.id);
      expect(app.projectId).toBe(project?.id);
      expect(app.attendeeName).toBe('Jane Doe');

      // Range query
      const rangeResults = await repo.listAppointmentsInRange(
        {
          startDate: new Date('2026-10-28T00:00:00.000Z'),
          endDate: new Date('2026-10-28T23:59:59.000Z'),
        },
        dbClient,
      );

      expect(rangeResults).toHaveLength(1);
      expect(rangeResults[0]?.id).toBe(app.id);

      // Range query outside interval
      const outsideResults = await repo.listAppointmentsInRange(
        {
          startDate: new Date('2026-10-29T00:00:00.000Z'),
          endDate: new Date('2026-10-29T23:59:59.000Z'),
        },
        dbClient,
      );
      expect(outsideResults).toHaveLength(0);

      // Update appointment
      const updateResult = await updateAppointment(
        app.id,
        {
          locationDetails: 'https://meet.google.com/abc-defg-hij',
        },
        'owner-user-id',
        dbClient,
      );
      expect(updateResult.success).toBe(true);

      // Cancel appointment
      const cancelResult = await cancelAppointment(
        app.id,
        { reason: 'Rescheduled upon client request' },
        'owner-user-id',
        dbClient,
      );
      expect(cancelResult.success).toBe(true);
      if (!cancelResult.success) return;
      expect(cancelResult.data.status).toBe('cancelled');
      expect(cancelResult.data.cancellationReason).toBe('Rescheduled upon client request');
      expect(cancelResult.data.cancelledAt).toBeInstanceOf(Date);
    });
  });

  // AC-4
  describe('AC-4: Blocked Time CRUD and Range Queries (R-A)', () => {
    it('AC-4: creates blackout window with starts_at, ends_at, all_day flag, and retrieves within range queries', async () => {
      const createResult = await createBlockedTime(
        {
          title: 'Equipment Maintenance',
          startsAt: new Date('2026-11-02T08:00:00.000Z'),
          endsAt: new Date('2026-11-02T16:00:00.000Z'),
          allDay: true,
          notes: 'Camera sensors cleaning and calibration',
        },
        'owner-user-id',
        dbClient,
      );

      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const bt = createResult.data;
      expect(bt.id).toBeDefined();
      expect(bt.title).toBe('Equipment Maintenance');
      expect(bt.allDay).toBe(true);

      // Range query overlapping
      const rangeResults = await repo.listBlockedTimeInRange(
        {
          startDate: new Date('2026-11-02T00:00:00.000Z'),
          endDate: new Date('2026-11-02T23:59:59.000Z'),
        },
        dbClient,
      );
      expect(rangeResults).toHaveLength(1);
      expect(rangeResults[0]?.id).toBe(bt.id);

      // Update
      const updateResult = await updateBlockedTime(
        bt.id,
        { title: 'Full Day Maintenance' },
        'owner-user-id',
        dbClient,
      );
      expect(updateResult.success).toBe(true);

      const fetched = await getBlockedTimeById(bt.id, dbClient);
      expect(fetched?.title).toBe('Full Day Maintenance');

      // Delete
      const deleteResult = await deleteBlockedTime(bt.id, 'owner-user-id', dbClient);
      expect(deleteResult.success).toBe(true);

      const afterDelete = await getBlockedTimeById(bt.id, dbClient);
      expect(afterDelete).toBeNull();
    });
  });
});
