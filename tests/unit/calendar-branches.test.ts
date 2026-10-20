import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/server/auth/guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/guards')>();
  return {
    ...actual,
    requireAuth: vi.fn(),
  };
});

import { requireAuth } from '@/server/auth/guards';
import * as CalendarModule from '@/server/calendar/index';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { availabilitySchedules, availabilityOverrides } from '@/server/db/schema/calendar';
import { authorizeCalendarRead, authorizeCalendarWrite } from '@/server/calendar/policy';
import {
  createBookingType,
  updateBookingType,
  deleteBookingType,
  getBookingTypeById,
  getBookingTypeBySlug,
  getBookingTypes,
  createAppointment,
  updateAppointment,
  cancelAppointment,
  getAppointmentById,
  getAppointmentsInRange,
  createBlockedTime,
  updateBlockedTime,
  deleteBlockedTime,
  getBlockedTimeById,
  getBlockedTimeInRange,
  getAvailabilitySchedules,
  updateAvailabilitySchedules,
  getAvailabilityOverrides,
  createAvailabilityOverride,
  deleteAvailabilityOverride,
} from '@/server/calendar/service';
import * as repo from '@/server/calendar/repo';
import {
  calculateAvailableSlots,
  formatIsoWithTimezone,
  formatTimeInTimezone,
  formatDateInTimezone,
  parseStudioLocalDateTime,
} from '@/server/calendar/availability';
import { seedDefaultCalendarData } from '@/server/db/seeds/calendar';
import { seedDefaultPipelineStages } from '@/server/db/seeds/pipeline-stages';
import { CALENDAR_READ, CALENDAR_WRITE } from '@/server/auth/scopes';
import type { AuthContext } from '@/server/auth/guards';

describe('TASK-0040: Calendar Domain Branch Coverage', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    await seedDefaultPipelineStages(dbClient);
    await seedDefaultCalendarData(dbClient);
  }, 30000);

  afterEach(async () => {
    await testDb.destroy();
  });

  // ==========================================
  // Policy Tests
  // ==========================================
  describe('Calendar Policy authorization guards', () => {
    it('authorizeCalendarRead allows owner with wildcard scope', async () => {
      const mockAuth: AuthContext = {
        user: {
          id: 'u1',
          role: 'owner',
          name: 'Owner',
          email: 'owner@example.com',
          emailVerified: true,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        authType: 'session',
        scopes: ['*'],
      };

      const res = await authorizeCalendarRead(mockAuth);
      expect(res.user.id).toBe('u1');
    });

    it('authorizeCalendarRead allows owner with calendar:read scope', async () => {
      const mockAuth: AuthContext = {
        user: {
          id: 'u1',
          role: 'owner',
          name: 'Owner',
          email: 'owner@example.com',
          emailVerified: true,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        authType: 'apiKey',
        scopes: [CALENDAR_READ],
      };

      const res = await authorizeCalendarRead(mockAuth);
      expect(res.user.id).toBe('u1');
    });

    it('authorizeCalendarRead resolves via requireAuth when context is undefined', async () => {
      vi.mocked(requireAuth).mockResolvedValueOnce({
        user: {
          id: 'u-owner-req',
          role: 'owner',
          name: 'Req Owner',
          email: 'req@example.com',
          emailVerified: true,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        authType: 'session',
        scopes: ['*'],
      });

      const res = await authorizeCalendarRead(undefined, dbClient);
      expect(res.user.id).toBe('u-owner-req');
    });

    it('authorizeCalendarRead denies non-owner', async () => {
      const mockAuth: AuthContext = {
        user: {
          id: 'u2',
          role: 'client',
          name: 'Client',
          email: 'client@example.com',
          emailVerified: true,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        authType: 'session',
        scopes: ['*'],
      };

      await expect(authorizeCalendarRead(mockAuth)).rejects.toThrow(/Owner role required/);
    });

    it('authorizeCalendarRead denies owner without calendar:read scope', async () => {
      const mockAuth: AuthContext = {
        user: {
          id: 'u1',
          role: 'owner',
          name: 'Owner',
          email: 'owner@example.com',
          emailVerified: true,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        authType: 'apiKey',
        scopes: ['clients:read'],
      };

      await expect(authorizeCalendarRead(mockAuth)).rejects.toThrow(/Insufficient permissions/);
    });

    it('authorizeCalendarWrite allows owner with wildcard scope', async () => {
      const mockAuth: AuthContext = {
        user: {
          id: 'u1',
          role: 'owner',
          name: 'Owner',
          email: 'owner@example.com',
          emailVerified: true,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        authType: 'session',
        scopes: ['*'],
      };

      const res = await authorizeCalendarWrite('update', null, mockAuth);
      expect(res.user.id).toBe('u1');
    });

    it('authorizeCalendarWrite allows owner with calendar:write scope', async () => {
      const mockAuth: AuthContext = {
        user: {
          id: 'u1',
          role: 'owner',
          name: 'Owner',
          email: 'owner@example.com',
          emailVerified: true,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        authType: 'apiKey',
        scopes: [CALENDAR_WRITE],
      };

      const res = await authorizeCalendarWrite('update', null, mockAuth);
      expect(res.user.id).toBe('u1');
    });

    it('authorizeCalendarWrite resolves via requireAuth when context is undefined', async () => {
      vi.mocked(requireAuth).mockResolvedValueOnce({
        user: {
          id: 'u-owner-write-req',
          role: 'owner',
          name: 'Req Owner',
          email: 'req@example.com',
          emailVerified: true,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        authType: 'session',
        scopes: ['*'],
      });

      const res = await authorizeCalendarWrite('create', null, undefined, dbClient);
      expect(res.user.id).toBe('u-owner-write-req');
    });

    it('authorizeCalendarWrite denies non-owner', async () => {
      const mockAuth: AuthContext = {
        user: {
          id: 'u2',
          role: 'client',
          name: 'Client',
          email: 'client@example.com',
          emailVerified: true,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        authType: 'session',
        scopes: ['*'],
      };

      await expect(authorizeCalendarWrite('create', null, mockAuth)).rejects.toThrow(
        /Owner role required/,
      );
    });

    it('authorizeCalendarWrite denies owner without calendar:write scope', async () => {
      const mockAuth: AuthContext = {
        user: {
          id: 'u1',
          role: 'owner',
          name: 'Owner',
          email: 'owner@example.com',
          emailVerified: true,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        authType: 'apiKey',
        scopes: [CALENDAR_READ],
      };

      await expect(authorizeCalendarWrite('create', null, mockAuth)).rejects.toThrow(
        /Insufficient permissions/,
      );
    });
  });

  // ==========================================
  // Booking Types Service & Repo Branches
  // ==========================================
  describe('Booking Types Service branches', () => {
    it('createBookingType handles validation failure', async () => {
      const res = await createBookingType({ slug: 'X', title: '' }, 'owner', dbClient);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('createBookingType handles duplicate slug conflict', async () => {
      const res = await createBookingType(
        {
          slug: 'discovery-call', // already seeded
          title: 'Duplicate',
        },
        'owner',
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('CONFLICT');
      }
    });

    it('updateBookingType handles validation failure', async () => {
      const res = await updateBookingType(
        '01920000-0000-7000-8000-000000000031',
        { title: '' },
        'owner',
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('updateBookingType handles not found', async () => {
      const res = await updateBookingType(
        '01920000-0000-7000-8000-000000000099',
        { title: 'New Title' },
        'owner',
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('NOT_FOUND');
      }
    });

    it('updateBookingType handles db update failure', async () => {
      const spy = vi.spyOn(repo, 'updateBookingTypeRecord').mockResolvedValueOnce(null);
      const res = await updateBookingType(
        '01920000-0000-7000-8000-000000000031',
        { title: 'New Title' },
        'owner',
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('INTERNAL_ERROR');
      }
      spy.mockRestore();
    });

    it('updateBookingType succeeds', async () => {
      const res = await updateBookingType(
        '01920000-0000-7000-8000-000000000031',
        { title: 'Updated Discovery Call' },
        'owner',
        dbClient,
      );
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.title).toBe('Updated Discovery Call');
      }
    });

    it('deleteBookingType handles not found', async () => {
      const res = await deleteBookingType(
        '01920000-0000-7000-8000-000000000099',
        'owner',
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('NOT_FOUND');
      }
    });

    it('deleteBookingType succeeds', async () => {
      const created = await createBookingType(
        {
          slug: 'temporary-type',
          title: 'Temporary Type',
        },
        'owner',
        dbClient,
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const deleted = await deleteBookingType(created.data.id, 'owner', dbClient);
      expect(deleted.success).toBe(true);
    });

    it('getBookingTypeById and getBookingTypeBySlug work', async () => {
      const byId = await getBookingTypeById('01920000-0000-7000-8000-000000000031', dbClient);
      expect(byId?.slug).toBe('discovery-call');

      const bySlug = await getBookingTypeBySlug('discovery-call', dbClient);
      expect(bySlug?.id).toBe('01920000-0000-7000-8000-000000000031');

      const nonExistent = await getBookingTypeBySlug('does-not-exist', dbClient);
      expect(nonExistent).toBeNull();
    });

    it('getBookingTypes lists active and inactive', async () => {
      await createBookingType(
        {
          slug: 'inactive-type',
          title: 'Inactive',
          isActive: false,
        },
        'owner',
        dbClient,
      );

      const activeOnly = await getBookingTypes(false, dbClient);
      expect(activeOnly.find((b) => b.slug === 'inactive-type')).toBeUndefined();

      const all = await getBookingTypes(true, dbClient);
      expect(all.find((b) => b.slug === 'inactive-type')).toBeDefined();
    });
  });

  // ==========================================
  // Appointment Service & Repo Branches
  // ==========================================
  describe('Appointment Service branches', () => {
    it('createAppointment handles validation failure when endsAt <= startsAt', async () => {
      const res = await createAppointment(
        {
          title: 'Invalid Appointment',
          startsAt: new Date('2026-10-26T10:00:00.000Z'),
          endsAt: new Date('2026-10-26T09:00:00.000Z'), // ends before starts!
          attendeeName: 'Test',
          attendeeEmail: 'test@example.com',
        },
        'owner',
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('createAppointment handles invalid email', async () => {
      const res = await createAppointment(
        {
          title: 'Invalid Email',
          startsAt: new Date('2026-10-26T10:00:00.000Z'),
          endsAt: new Date('2026-10-26T10:30:00.000Z'),
          attendeeName: 'Test',
          attendeeEmail: 'not-an-email',
        },
        'owner',
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('updateAppointment handles validation failure and not found', async () => {
      // Validation failure
      const valRes = await updateAppointment(
        'some-id',
        { attendeeEmail: 'bad-email' },
        'owner',
        dbClient,
      );
      expect(valRes.success).toBe(false);
      if (!valRes.success) {
        expect(valRes.code).toBe('VALIDATION_FAILED');
      }

      // Not found
      const notFoundRes = await updateAppointment(
        '01920000-0000-7000-8000-000000000099',
        { title: 'New Title' },
        'owner',
        dbClient,
      );
      expect(notFoundRes.success).toBe(false);
      if (!notFoundRes.success) {
        expect(notFoundRes.code).toBe('NOT_FOUND');
      }
    });

    it('updateAppointment handles db update failure', async () => {
      const created = await createAppointment(
        {
          title: 'Appointment to update',
          startsAt: new Date('2026-10-26T10:00:00.000Z'),
          endsAt: new Date('2026-10-26T10:30:00.000Z'),
          attendeeName: 'Test',
          attendeeEmail: 'test@example.com',
        },
        'owner',
        dbClient,
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const spy = vi.spyOn(repo, 'updateAppointmentRecord').mockResolvedValueOnce(null);
      const res = await updateAppointment(created.data.id, { title: 'Updated' }, 'owner', dbClient);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('INTERNAL_ERROR');
      }
      spy.mockRestore();
    });

    it('updateAppointment succeeds', async () => {
      const created = await createAppointment(
        {
          title: 'Appointment to update',
          startsAt: new Date('2026-10-26T10:00:00.000Z'),
          endsAt: new Date('2026-10-26T10:30:00.000Z'),
          attendeeName: 'Test',
          attendeeEmail: 'test@example.com',
        },
        'owner',
        dbClient,
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const res = await updateAppointment(
        created.data.id,
        { title: 'Updated Title' },
        'owner',
        dbClient,
      );
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.title).toBe('Updated Title');
      }
    });

    it('cancelAppointment handles not found and cancellation failure', async () => {
      const notFoundRes = await cancelAppointment(
        '01920000-0000-7000-8000-000000000099',
        {},
        'owner',
        dbClient,
      );
      expect(notFoundRes.success).toBe(false);
      if (!notFoundRes.success) {
        expect(notFoundRes.code).toBe('NOT_FOUND');
      }

      const created = await createAppointment(
        {
          title: 'Appointment to cancel',
          startsAt: new Date('2026-10-26T10:00:00.000Z'),
          endsAt: new Date('2026-10-26T10:30:00.000Z'),
          attendeeName: 'Test',
          attendeeEmail: 'test@example.com',
        },
        'owner',
        dbClient,
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const spy = vi.spyOn(repo, 'updateAppointmentRecord').mockResolvedValueOnce(null);
      const res = await cancelAppointment(created.data.id, {}, 'owner', dbClient);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('INTERNAL_ERROR');
      }
      spy.mockRestore();
    });

    it('deleteAppointmentRecord repo helper deletes appointment', async () => {
      const created = await createAppointment(
        {
          title: 'Appointment to delete',
          startsAt: new Date('2026-10-26T10:00:00.000Z'),
          endsAt: new Date('2026-10-26T10:30:00.000Z'),
          attendeeName: 'Test',
          attendeeEmail: 'test@example.com',
        },
        'owner',
        dbClient,
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const deleted = await repo.deleteAppointmentRecord(created.data.id, dbClient);
      expect(deleted).toBe(true);

      const after = await getAppointmentById(created.data.id, dbClient);
      expect(after).toBeNull();
    });
  });

  // ==========================================
  // Blocked Time Service & Repo Branches
  // ==========================================
  describe('Blocked Time Service branches', () => {
    it('createBlockedTime handles validation failure', async () => {
      const res = await createBlockedTime(
        {
          title: 'Invalid',
          startsAt: new Date('2026-10-26T12:00:00.000Z'),
          endsAt: new Date('2026-10-26T11:00:00.000Z'),
        },
        'owner',
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('updateBlockedTime handles validation failure', async () => {
      const res = await updateBlockedTime(
        '01920000-0000-7000-8000-000000000099',
        {
          startsAt: new Date('2026-10-26T12:00:00.000Z'),
          endsAt: new Date('2026-10-26T11:00:00.000Z'),
        },
        'owner',
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('updateBlockedTime handles not found and failure', async () => {
      const notFound = await updateBlockedTime(
        '01920000-0000-7000-8000-000000000099',
        { title: 'New' },
        'owner',
        dbClient,
      );
      expect(notFound.success).toBe(false);
      if (!notFound.success) {
        expect(notFound.code).toBe('NOT_FOUND');
      }

      const created = await createBlockedTime(
        {
          title: 'BT',
          startsAt: new Date('2026-10-26T10:00:00.000Z'),
          endsAt: new Date('2026-10-26T12:00:00.000Z'),
        },
        'owner',
        dbClient,
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const spy = vi.spyOn(repo, 'updateBlockedTimeRecord').mockResolvedValueOnce(null);
      const res = await updateBlockedTime(created.data.id, { title: 'Updated' }, 'owner', dbClient);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('INTERNAL_ERROR');
      }
      spy.mockRestore();
    });

    it('updateBlockedTime succeeds', async () => {
      const created = await createBlockedTime(
        {
          title: 'BT to update',
          startsAt: new Date('2026-10-26T10:00:00.000Z'),
          endsAt: new Date('2026-10-26T12:00:00.000Z'),
        },
        'owner',
        dbClient,
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const res = await updateBlockedTime(
        created.data.id,
        { title: 'Updated BT' },
        'owner',
        dbClient,
      );
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.title).toBe('Updated BT');
      }
    });

    it('deleteBlockedTime succeeds', async () => {
      const created = await createBlockedTime(
        {
          title: 'BT to delete',
          startsAt: new Date('2026-10-26T10:00:00.000Z'),
          endsAt: new Date('2026-10-26T12:00:00.000Z'),
        },
        'owner',
        dbClient,
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const res = await deleteBlockedTime(created.data.id, 'owner', dbClient);
      expect(res.success).toBe(true);
      const after = await getBlockedTimeById(created.data.id, dbClient);
      expect(after).toBeNull();
    });

    it('deleteBlockedTime handles not found', async () => {
      const notFound = await deleteBlockedTime(
        '01920000-0000-7000-8000-000000000099',
        'owner',
        dbClient,
      );
      expect(notFound.success).toBe(false);
      if (!notFound.success) {
        expect(notFound.code).toBe('NOT_FOUND');
      }
    });
  });

  // ==========================================
  // Availability Schedules & Overrides Service
  // ==========================================
  describe('Availability Schedules & Overrides branches', () => {
    it('updateAvailabilitySchedules handles validation failure and updates schedules', async () => {
      const invalid = await updateAvailabilitySchedules(
        {
          schedules: [{ dayOfWeek: 9, startTime: '09:00', endTime: '17:00', isActive: true }],
        },
        'owner',
        dbClient,
      );
      expect(invalid.success).toBe(false);
      if (!invalid.success) {
        expect(invalid.code).toBe('VALIDATION_FAILED');
      }

      const validRes = await updateAvailabilitySchedules(
        {
          schedules: [{ dayOfWeek: 1, startTime: '10:00', endTime: '18:00', isActive: true }],
        },
        'owner',
        dbClient,
      );
      expect(validRes.success).toBe(true);

      const allSchedules = await getAvailabilitySchedules(dbClient);
      const monday = allSchedules.find((s) => s.dayOfWeek === 1);
      expect(monday?.startTime).toBe('10:00');
      expect(monday?.endTime).toBe('18:00');
    });

    it('createAvailabilityOverride and deleteAvailabilityOverride handle validation and not found', async () => {
      const invalid = await createAvailabilityOverride(
        {
          date: 'invalid-date',
        },
        'owner',
        dbClient,
      );
      expect(invalid.success).toBe(false);
      if (!invalid.success) {
        expect(invalid.code).toBe('VALIDATION_FAILED');
      }

      const created = await createAvailabilityOverride(
        {
          date: '2026-11-15',
          isUnavailable: true,
          reason: 'Workshop',
        },
        'owner',
        dbClient,
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const inRange = await getAvailabilityOverrides(
        { startDate: '2026-11-01', endDate: '2026-11-30' },
        dbClient,
      );
      expect(inRange).toHaveLength(1);

      const notFoundDelete = await deleteAvailabilityOverride(
        '01920000-0000-7000-8000-000000000099',
        'owner',
        dbClient,
      );
      expect(notFoundDelete.success).toBe(false);
      if (!notFoundDelete.success) {
        expect(notFoundDelete.code).toBe('NOT_FOUND');
      }

      const deleteRes = await deleteAvailabilityOverride(created.data.id, 'owner', dbClient);
      expect(deleteRes.success).toBe(true);
    });

    it('upsertAvailabilitySchedule inserts new row when dayOfWeek does not exist', async () => {
      // Delete day 6 (Saturday)
      await dbClient.delete(availabilitySchedules).where(eq(availabilitySchedules.dayOfWeek, 6));
      const inserted = await repo.upsertAvailabilitySchedule(
        { dayOfWeek: 6, startTime: '11:00', endTime: '15:00', isActive: true },
        dbClient,
      );
      expect(inserted.dayOfWeek).toBe(6);
      expect(inserted.startTime).toBe('11:00');
    });
  });

  // ==========================================
  // Availability Engine Edge Cases
  // ==========================================
  describe('Availability Engine edge cases', () => {
    it('returns empty array when booking type does not exist or is inactive', async () => {
      const nonExistent = await calculateAvailableSlots({
        bookingTypeId: '01920000-0000-7000-8000-000000000099',
        startDate: '2026-10-26',
        endDate: '2026-10-26',
        timezone: 'Europe/Berlin',
        db: dbClient,
      });
      expect(nonExistent).toEqual([]);

      const inactive = await createBookingType(
        { slug: 'inactive-test', title: 'Inactive', isActive: false },
        'owner',
        dbClient,
      );
      expect(inactive.success).toBe(true);
      if (!inactive.success) return;

      const inactiveSlots = await calculateAvailableSlots({
        bookingTypeId: inactive.data.id,
        startDate: '2026-10-26',
        endDate: '2026-10-26',
        timezone: 'Europe/Berlin',
        db: dbClient,
      });
      expect(inactiveSlots).toEqual([]);
    });

    it('handles continuousSlots = true mode', async () => {
      const testNow = new Date('2026-10-20T10:00:00.000Z');

      // Booking type with 30m duration + 15m buffer = 45m step
      const type = await repo.findBookingTypeBySlug('discovery-call', dbClient);
      expect(type).toBeDefined();

      const slots = await calculateAvailableSlots({
        bookingTypeId: type?.id ?? '',
        startDate: '2026-10-26',
        endDate: '2026-10-26',
        timezone: 'Europe/Berlin',
        now: testNow,
        db: dbClient,
        continuousSlots: true,
      });

      const times = slots.map((s) => s.startTime);
      expect(times[0]).toBe('09:00');
      expect(times[1]).toBe('09:45');
      expect(times[2]).toBe('10:30');
    });

    it('handles custom slotIntervalMinutes', async () => {
      const testNow = new Date('2026-10-20T10:00:00.000Z');
      const type = await repo.findBookingTypeBySlug('discovery-call', dbClient);

      const slots = await calculateAvailableSlots({
        bookingTypeId: type?.id ?? '',
        startDate: '2026-10-26',
        endDate: '2026-10-26',
        timezone: 'Europe/Berlin',
        now: testNow,
        db: dbClient,
        slotIntervalMinutes: 60,
      });

      const times = slots.map((s) => s.startTime);
      expect(times).toEqual([
        '09:00',
        '10:00',
        '11:00',
        '12:00',
        '13:00',
        '14:00',
        '15:00',
        '16:00',
      ]);
    });

    it('skips dates beyond maxFutureDays', async () => {
      const testNow = new Date('2026-10-20T10:00:00.000Z');
      const type = await repo.findBookingTypeBySlug('discovery-call', dbClient);

      // maxFutureDays is 60 days. Day 61: 2026-12-21
      const slots = await calculateAvailableSlots({
        bookingTypeId: type?.id ?? '',
        startDate: '2026-12-21',
        endDate: '2026-12-21',
        timezone: 'Europe/Berlin',
        now: testNow,
        db: dbClient,
      });

      expect(slots).toEqual([]);
    });

    it('directly tests date and time formatting utilities', () => {
      const d = new Date('2026-10-26T08:00:00.000Z');
      expect(formatTimeInTimezone(d, 'Europe/Berlin')).toBe('09:00');
      expect(formatDateInTimezone(d, 'Europe/Berlin')).toBe('2026-10-26');
      expect(formatIsoWithTimezone(d, 'Europe/Berlin')).toBe('2026-10-26T09:00:00+01:00');
      expect(formatIsoWithTimezone(d, 'America/New_York')).toBe('2026-10-26T04:00:00-04:00');

      const parsed = parseStudioLocalDateTime('2026-10-26', '09:00', 'Europe/Berlin');
      expect(parsed.toISOString()).toBe('2026-10-26T08:00:00.000Z');
    });

    it('handles DST transition hour in parseStudioLocalDateTime', () => {
      // Europe/Berlin switches to DST on 2026-03-29 at 02:00 -> jumps to 03:00
      const parsed = parseStudioLocalDateTime('2026-03-29', '02:30', 'Europe/Berlin');
      expect(parsed).toBeInstanceOf(Date);
    });

    it('handles missing day in scheduleMap during slot calculation', async () => {
      const testNow = new Date('2026-10-20T10:00:00.000Z');
      const type = await repo.findBookingTypeBySlug('discovery-call', dbClient);

      // Delete Sunday schedule (day 0)
      await dbClient.delete(availabilitySchedules).where(eq(availabilitySchedules.dayOfWeek, 0));

      const slots = await calculateAvailableSlots({
        bookingTypeId: type?.id ?? '',
        startDate: '2026-10-25', // Sunday
        endDate: '2026-10-25',
        timezone: 'Europe/Berlin',
        now: testNow,
        db: dbClient,
      });

      expect(slots).toEqual([]);
    });

    it('handles partial override missing start or end time', async () => {
      const testNow = new Date('2026-10-20T10:00:00.000Z');
      const type = await repo.findBookingTypeBySlug('discovery-call', dbClient);

      // Insert an override with null startTime
      await dbClient.insert(availabilityOverrides).values({
        date: '2026-10-27',
        startTime: null,
        endTime: '17:00',
        isUnavailable: false,
      });

      const slots = await calculateAvailableSlots({
        bookingTypeId: type?.id ?? '',
        startDate: '2026-10-27',
        endDate: '2026-10-27',
        timezone: 'Europe/Berlin',
        now: testNow,
        db: dbClient,
      });

      expect(slots).toEqual([]);
    });
  });

  // ==========================================
  // Calendar Barrel & Service Read Operations
  // ==========================================
  describe('Calendar Barrel & Service Read Operations', () => {
    it('exports all expected functions and types from barrel', () => {
      expect(CalendarModule.calculateAvailableSlots).toBeDefined();
      expect(CalendarModule.createAppointment).toBeDefined();
      expect(CalendarModule.updateAppointment).toBeDefined();
      expect(CalendarModule.cancelAppointment).toBeDefined();
      expect(CalendarModule.getAppointmentById).toBeDefined();
      expect(CalendarModule.getAppointmentsInRange).toBeDefined();
      expect(CalendarModule.createBlockedTime).toBeDefined();
      expect(CalendarModule.updateBlockedTime).toBeDefined();
      expect(CalendarModule.deleteBlockedTime).toBeDefined();
      expect(CalendarModule.getBlockedTimeById).toBeDefined();
      expect(CalendarModule.getBlockedTimeInRange).toBeDefined();
      expect(CalendarModule.createBookingType).toBeDefined();
      expect(CalendarModule.updateBookingType).toBeDefined();
      expect(CalendarModule.deleteBookingType).toBeDefined();
      expect(CalendarModule.getBookingTypeById).toBeDefined();
      expect(CalendarModule.getBookingTypeBySlug).toBeDefined();
      expect(CalendarModule.getBookingTypes).toBeDefined();
      expect(CalendarModule.getAvailabilitySchedules).toBeDefined();
      expect(CalendarModule.updateAvailabilitySchedules).toBeDefined();
      expect(CalendarModule.getAvailabilityOverrides).toBeDefined();
      expect(CalendarModule.createAvailabilityOverride).toBeDefined();
      expect(CalendarModule.deleteAvailabilityOverride).toBeDefined();
      expect(CalendarModule.authorizeCalendarRead).toBeDefined();
      expect(CalendarModule.authorizeCalendarWrite).toBeDefined();
    });

    it('covers service and repo range getters', async () => {
      const schedules = await getAvailabilitySchedules(dbClient);
      expect(schedules.length).toBeGreaterThanOrEqual(6);

      const appts = await getAppointmentsInRange(
        { startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
        dbClient,
      );
      expect(Array.isArray(appts)).toBe(true);

      const filteredAppts = await getAppointmentsInRange(
        {
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
          clientId: '01920000-0000-7000-8000-000000000001',
          projectId: '01920000-0000-7000-8000-000000000002',
          leadId: '01920000-0000-7000-8000-000000000003',
          status: 'scheduled',
        },
        dbClient,
      );
      expect(Array.isArray(filteredAppts)).toBe(true);

      const blocked = await getBlockedTimeInRange(
        { startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
        dbClient,
      );
      expect(Array.isArray(blocked)).toBe(true);

      const overrides = await repo.listAvailabilityOverridesInRange(
        { startDate: '2026-01-01', endDate: '2026-12-31' },
        dbClient,
      );
      expect(Array.isArray(overrides)).toBe(true);

      const nonExistentAppt = await getAppointmentById(
        '01920000-0000-7000-8000-000000000099',
        dbClient,
      );
      expect(nonExistentAppt).toBeNull();

      const nonExistentBlocked = await getBlockedTimeById(
        '01920000-0000-7000-8000-000000000099',
        dbClient,
      );
      expect(nonExistentBlocked).toBeNull();

      const nonExistentOverride = await repo.findAvailabilityOverrideById(
        '01920000-0000-7000-8000-000000000099',
        dbClient,
      );
      expect(nonExistentOverride).toBeNull();
    });

    it('seedDefaultCalendarData runs idempotently', async () => {
      const seeded = await seedDefaultCalendarData(dbClient);
      expect(seeded.schedules.length).toBe(7);
      expect(seeded.bookingTypes.length).toBe(2);
    });
  });
});
