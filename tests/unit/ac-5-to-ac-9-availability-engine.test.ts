import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { DbClient } from '@/server/db/client';
import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { appointments, blockedTime, availabilityOverrides } from '@/server/db/schema/calendar';
import { projects, pipelineStages, shoots } from '@/server/db/schema/projects';
import { clients } from '@/server/db/schema/clients';
import { calculateAvailableSlots, parseStudioLocalDateTime } from '@/server/calendar/availability';
import { seedDefaultCalendarData } from '@/server/db/seeds/calendar';
import { seedDefaultPipelineStages } from '@/server/db/seeds/pipeline-stages';

describe('TASK-0040: Availability Engine (AC-5 to AC-9)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let bookingTypeId30m: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    await seedDefaultPipelineStages(dbClient);
    const seeds = await seedDefaultCalendarData(dbClient);

    const type30 = seeds.bookingTypes.find((b) => b.slug === 'discovery-call');
    bookingTypeId30m = type30?.id ?? '';
  }, 30000);

  afterEach(async () => {
    await testDb.destroy();
  });

  // AC-5
  describe('AC-5: Collision Subtraction for Shoots and Scheduled Appointments with Buffers', () => {
    it('AC-5: subtracts candidate slots overlapping with a scheduled appointment including buffer_after', async () => {
      // 2026-10-26 is Monday. Default hours: 09:00 - 17:00 Europe/Berlin
      // Reference now is 2026-10-20 (more than 24h notice)
      const testNow = new Date('2026-10-20T10:00:00.000Z');

      // Discovery call has 30m duration + 15m buffer_after
      // Insert appointment at 10:00 - 10:30 Europe/Berlin
      // 10:00 Europe/Berlin on 2026-10-26 (CET = UTC+1) is 09:00 UTC
      const appStart = parseStudioLocalDateTime('2026-10-26', '10:00', 'Europe/Berlin');
      const appEnd = parseStudioLocalDateTime('2026-10-26', '10:30', 'Europe/Berlin');

      await dbClient.insert(appointments).values({
        id: '01920000-0000-7000-8000-000000000101',
        title: 'Existing Consultation',
        status: 'scheduled',
        startsAt: appStart,
        endsAt: appEnd,
        attendeeName: 'Emma Watson',
        attendeeEmail: 'emma@example.com',
      });

      const slots = await calculateAvailableSlots({
        bookingTypeId: bookingTypeId30m,
        startDate: '2026-10-26',
        endDate: '2026-10-26',
        timezone: 'Europe/Berlin',
        now: testNow,
        db: dbClient,
      });

      const slotTimes = slots.map((s) => s.startTime);

      // 09:00 - 09:30: buffer_after ends at 09:45, no collision with 10:00 appointment
      expect(slotTimes).toContain('09:00');

      // 09:30 - 10:00: buffer_after is 15m (until 10:15).
      // Collision! Protected window (09:30 - 10:15) overlaps with appointment (10:00 - 10:30).
      expect(slotTimes).not.toContain('09:30');

      // 10:00 - 10:30: directly overlaps with appointment
      expect(slotTimes).not.toContain('10:00');

      // 10:30 - 11:00: starts right when appointment ends
      expect(slotTimes).toContain('10:30');
    });

    it('AC-5: subtracts candidate slots overlapping with an active shoot including buffer expansion', async () => {
      const testNow = new Date('2026-10-20T10:00:00.000Z');

      // Setup client and project for shoot
      const [client] = await dbClient
        .insert(clients)
        .values({
          id: '01920000-0000-7000-8000-000000000201',
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
          id: '01920000-0000-7000-8000-000000000202',
          clientId: client?.id ?? '',
          stageId: stage?.id ?? '',
          title: 'Commercial Portrait Project',
          lastActivityAt: new Date(),
        })
        .returning();

      // Shoot from 14:00 to 16:00 Europe/Berlin
      const shootStart = parseStudioLocalDateTime('2026-10-26', '14:00', 'Europe/Berlin');
      const shootEnd = parseStudioLocalDateTime('2026-10-26', '16:00', 'Europe/Berlin');

      await dbClient.insert(shoots).values({
        id: '01920000-0000-7000-8000-000000000203',
        projectId: project?.id ?? '',
        title: 'Studio Session',
        startsAt: shootStart,
        endsAt: shootEnd,
        timezone: 'Europe/Berlin',
      });

      const slots = await calculateAvailableSlots({
        bookingTypeId: bookingTypeId30m,
        startDate: '2026-10-26',
        endDate: '2026-10-26',
        timezone: 'Europe/Berlin',
        now: testNow,
        db: dbClient,
      });

      const slotTimes = slots.map((s) => s.startTime);

      // Slots before shoot: 13:00 is fine
      expect(slotTimes).toContain('13:00');
      // 13:30 has 15m buffer_after (ends 14:15), and shoot starts at 14:00 (expanded by 0m buffer_before).
      // Collision!
      expect(slotTimes).not.toContain('13:30');
      expect(slotTimes).not.toContain('14:00');
      expect(slotTimes).not.toContain('14:30');
      expect(slotTimes).not.toContain('15:00');
      expect(slotTimes).not.toContain('15:30');

      // Shoot ends at 16:00, buffer_after of shoot expands to 16:15.
      // Candidate 16:00 - 16:30 overlaps with shoot buffer (16:00 - 16:15).
      expect(slotTimes).not.toContain('16:00');

      // 16:30 starts after 16:15, so 16:30 is available
      expect(slotTimes).toContain('16:30');
    });
  });

  // AC-6
  describe('AC-6: Collision Subtraction for Blocked Time', () => {
    it('AC-6: excludes candidate slots colliding with active blocked_time interval', async () => {
      const testNow = new Date('2026-10-20T10:00:00.000Z');

      // Blocked time from 11:00 to 13:00 Europe/Berlin
      const blockedStart = parseStudioLocalDateTime('2026-10-26', '11:00', 'Europe/Berlin');
      const blockedEnd = parseStudioLocalDateTime('2026-10-26', '13:00', 'Europe/Berlin');

      await dbClient.insert(blockedTime).values({
        id: '01920000-0000-7000-8000-000000000301',
        title: 'Studio Maintenance',
        startsAt: blockedStart,
        endsAt: blockedEnd,
        allDay: false,
      });

      const slots = await calculateAvailableSlots({
        bookingTypeId: bookingTypeId30m,
        startDate: '2026-10-26',
        endDate: '2026-10-26',
        timezone: 'Europe/Berlin',
        now: testNow,
        db: dbClient,
      });

      const slotTimes = slots.map((s) => s.startTime);

      expect(slotTimes).toContain('10:00');
      // 10:30 with 15m buffer ends at 11:15, which overlaps with blockedTime at 11:00!
      expect(slotTimes).not.toContain('10:30');
      expect(slotTimes).not.toContain('11:00');
      expect(slotTimes).not.toContain('11:30');
      expect(slotTimes).not.toContain('12:00');
      expect(slotTimes).not.toContain('12:30');

      // Blocked time ends at 13:00, 13:00 is available
      expect(slotTimes).toContain('13:00');
    });
  });

  // AC-7
  describe('AC-7: Minimum Advance Notice Window Filtering', () => {
    it('AC-7: filters out slots starting within min_notice_hours (24h) from now', async () => {
      // Monday 2026-10-26.
      // If now is Sunday 2026-10-25 at 12:00 UTC (13:00 Europe/Berlin):
      // 24 hours advance notice window extends until Monday 2026-10-26 at 13:00 Europe/Berlin.
      const testNow = parseStudioLocalDateTime('2026-10-25', '13:00', 'Europe/Berlin');

      const slots = await calculateAvailableSlots({
        bookingTypeId: bookingTypeId30m,
        startDate: '2026-10-26',
        endDate: '2026-10-26',
        timezone: 'Europe/Berlin',
        now: testNow,
        db: dbClient,
      });

      const slotTimes = slots.map((s) => s.startTime);

      // Morning slots (before 13:00) must all be filtered out!
      expect(slotTimes).not.toContain('09:00');
      expect(slotTimes).not.toContain('10:00');
      expect(slotTimes).not.toContain('11:00');
      expect(slotTimes).not.toContain('12:00');
      expect(slotTimes).not.toContain('12:30');

      // Slots at or after 13:00 must be available
      expect(slotTimes).toContain('13:00');
      expect(slotTimes).toContain('14:00');
      expect(slotTimes).toContain('16:30');
    });
  });

  // AC-8
  describe('AC-8: Timezone Transformation and Formatting', () => {
    it('AC-8: converts studio slots defined in Europe/Berlin accurately to America/New_York with matching ISO strings', async () => {
      const testNow = new Date('2026-10-20T10:00:00.000Z');

      // On 2026-10-26, Europe/Berlin is in standard CET (UTC+1, DST ended Oct 25).
      // America/New_York is in EDT (UTC-4, DST ends Nov 1).
      // Berlin 09:00 CET = 08:00 UTC.
      // 08:00 UTC in America/New_York = 04:00 EDT (-04:00).
      const slots = await calculateAvailableSlots({
        bookingTypeId: bookingTypeId30m,
        startDate: '2026-10-26',
        endDate: '2026-10-26',
        timezone: 'America/New_York',
        now: testNow,
        db: dbClient,
      });

      expect(slots.length).toBeGreaterThan(0);

      const firstSlot = slots[0];
      expect(firstSlot).toBeDefined();
      if (!firstSlot) return;

      expect(firstSlot.startTime).toBe('04:00');
      expect(firstSlot.endTime).toBe('04:30');
      expect(firstSlot.starts_at).toBe('2026-10-26T04:00:00-04:00');
      expect(firstSlot.ends_at).toBe('2026-10-26T04:30:00-04:00');
      expect(firstSlot.startsAt).toBe('2026-10-26T04:00:00-04:00');
      expect(firstSlot.endsAt).toBe('2026-10-26T04:30:00-04:00');
      expect(firstSlot.startsAtUtc).toBe('2026-10-26T08:00:00.000Z');
      expect(firstSlot.endsAtUtc).toBe('2026-10-26T08:30:00.000Z');
      expect(firstSlot.formattedDate).toBe('2026-10-26');
      expect(firstSlot.formattedTime).toBe('04:00 - 04:30');

      // Verify slot starts_at ISO string parses back to identical UTC epoch milliseconds
      const parsedUtc = new Date(firstSlot.starts_at).getTime();
      expect(parsedUtc).toBe(new Date('2026-10-26T08:00:00.000Z').getTime());
    });
  });

  // AC-9
  describe('AC-9: Date Override Precedence Over Weekly Schedule', () => {
    it('AC-9: returns zero available slots when availability_overrides has is_unavailable = true', async () => {
      const testNow = new Date('2026-10-20T10:00:00.000Z');

      // Verify that Monday 2026-10-26 has slots before the override
      const beforeSlots = await calculateAvailableSlots({
        bookingTypeId: bookingTypeId30m,
        startDate: '2026-10-26',
        endDate: '2026-10-26',
        timezone: 'Europe/Berlin',
        now: testNow,
        db: dbClient,
      });
      expect(beforeSlots.length).toBeGreaterThan(0);

      // Insert full-day unavailable override
      await dbClient.insert(availabilityOverrides).values({
        id: '01920000-0000-7000-8000-000000000401',
        date: '2026-10-26',
        isUnavailable: true,
        reason: 'National Holiday / Studio Closed',
      });

      const afterSlots = await calculateAvailableSlots({
        bookingTypeId: bookingTypeId30m,
        startDate: '2026-10-26',
        endDate: '2026-10-26',
        timezone: 'Europe/Berlin',
        now: testNow,
        db: dbClient,
      });

      expect(afterSlots).toHaveLength(0);
    });

    it('AC-9: custom hours in availability_overrides restrict available slots to override window', async () => {
      const testNow = new Date('2026-10-20T10:00:00.000Z');

      // Saturday 2026-10-31 is normally inactive.
      // Add override with custom hours 10:00 - 12:00
      await dbClient.insert(availabilityOverrides).values({
        id: '01920000-0000-7000-8000-000000000402',
        date: '2026-10-31',
        startTime: '10:00',
        endTime: '12:00',
        isUnavailable: false,
        reason: 'Special Mini-Sessions Saturday',
      });

      const saturdaySlots = await calculateAvailableSlots({
        bookingTypeId: bookingTypeId30m,
        startDate: '2026-10-31',
        endDate: '2026-10-31',
        timezone: 'Europe/Berlin',
        now: testNow,
        db: dbClient,
      });

      const times = saturdaySlots.map((s) => s.startTime);
      expect(times).toEqual(['10:00', '10:30', '11:00', '11:30']);
    });
  });
});
