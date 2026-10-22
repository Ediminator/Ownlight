import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import {
  updateWeeklyScheduleAction,
  createDateOverrideAction,
  deleteDateOverrideAction,
  createBookingTypeAction,
  updateBookingTypeAction,
  deleteBookingTypeAction,
} from '@/server/calendar/availability-actions';
import * as guards from '@/server/auth/guards';
import * as service from '@/server/calendar/service';
import { revalidatePath } from 'next/cache';
import type { DbClient } from '@/server/db/client';
import type {
  AvailabilitySchedule,
  AvailabilityOverride,
  BookingType,
} from '@/server/db/schema/calendar';

describe('TASK-0043: Availability Server Actions Branch & Edge Cases', () => {
  const dummyClient = {} as DbClient;

  const mockOwnerAuth: guards.AuthContext = {
    user: {
      id: '01920000-0000-7000-8000-000000000001',
      name: 'Studio Owner',
      email: 'owner@example.com',
      image: null,
      role: 'owner',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    authType: 'session',
    scopes: ['*'],
  };

  const mockSchedule: AvailabilitySchedule = {
    id: 'sched-1',
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '17:00',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockOverride: AvailabilityOverride = {
    id: 'ov-1',
    date: '2026-11-20',
    isUnavailable: true,
    startTime: null,
    endTime: null,
    reason: 'Conference',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockBookingType: BookingType = {
    id: 'bt-1',
    title: 'Portrait Session',
    slug: 'portrait-session',
    description: '1 hour portrait',
    durationMinutes: 60,
    bufferBeforeMinutes: 10,
    bufferAfterMinutes: 15,
    minNoticeHours: 24,
    maxFutureDays: 60,
    locationType: 'in_person',
    locationDetails: null,
    color: 'emerald',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('updateWeeklyScheduleAction branches', () => {
    it('returns FORBIDDEN when requireOwner throws ForbiddenError', async () => {
      vi.spyOn(guards, 'requireOwner').mockRejectedValueOnce(
        new guards.ForbiddenError('Forbidden role'),
      );
      const res = await updateWeeklyScheduleAction([], dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('FORBIDDEN');
    });

    it('returns UNAUTHENTICATED when requireOwner throws generic error', async () => {
      vi.spyOn(guards, 'requireOwner').mockRejectedValueOnce(new Error('Session expired'));
      const res = await updateWeeklyScheduleAction([], dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('UNAUTHENTICATED');
    });

    it('returns VALIDATION_FAILED when schedule payload has invalid time format or invalid dayOfWeek', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      const res = await updateWeeklyScheduleAction(
        [{ dayOfWeek: 8, startTime: '09:00', endTime: '17:00', isActive: true }],
        dummyClient,
      );
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
      expect(res.error).toBeDefined();
      expect(res.fields).toBeDefined();
    });

    it('accepts rawInput object with schedules property and triggers revalidatePath on success', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      vi.spyOn(service, 'updateAvailabilitySchedules').mockResolvedValueOnce({
        success: true,
        data: [mockSchedule],
      });

      const res = await updateWeeklyScheduleAction(
        {
          schedules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isActive: true }],
        },
        dummyClient,
      );
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toEqual([mockSchedule]);
      }
      expect(revalidatePath).toHaveBeenCalledWith('/calendar');
      expect(revalidatePath).toHaveBeenCalledWith('/settings/calendar/availability');
    });

    it('handles safeRevalidate throwing without bubbling error', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      vi.spyOn(service, 'updateAvailabilitySchedules').mockResolvedValueOnce({
        success: true,
        data: [mockSchedule],
      });
      vi.mocked(revalidatePath).mockImplementationOnce(() => {
        throw new Error('Not in next context');
      });

      const res = await updateWeeklyScheduleAction(
        [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isActive: true }],
        dummyClient,
      );
      expect(res.success).toBe(true);
    });
  });

  describe('createDateOverrideAction branches', () => {
    it('returns FORBIDDEN when requireOwner throws ForbiddenError', async () => {
      vi.spyOn(guards, 'requireOwner').mockRejectedValueOnce(
        new guards.ForbiddenError('Forbidden role'),
      );
      const res = await createDateOverrideAction({}, dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('FORBIDDEN');
    });

    it('returns UNAUTHENTICATED when requireOwner throws generic error', async () => {
      vi.spyOn(guards, 'requireOwner').mockRejectedValueOnce(new Error('No token'));
      const res = await createDateOverrideAction({}, dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('UNAUTHENTICATED');
    });

    it('returns VALIDATION_FAILED when date override schema fails', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      const res = await createDateOverrideAction(
        { date: 'invalid-date', isUnavailable: true },
        dummyClient,
      );
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
      expect(res.fields).toContain('date');
    });

    it('creates date override successfully and revalidates paths', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      vi.spyOn(service, 'createAvailabilityOverride').mockResolvedValueOnce({
        success: true,
        data: mockOverride,
      });

      const res = await createDateOverrideAction(
        { date: '2026-11-20', isUnavailable: true, reason: 'Conference' },
        dummyClient,
      );
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toEqual(mockOverride);
      }
      expect(revalidatePath).toHaveBeenCalledWith('/calendar');
    });
  });

  describe('deleteDateOverrideAction branches', () => {
    it('returns FORBIDDEN when requireOwner throws ForbiddenError', async () => {
      vi.spyOn(guards, 'requireOwner').mockRejectedValueOnce(
        new guards.ForbiddenError('Forbidden role'),
      );
      const res = await deleteDateOverrideAction('ov-1', dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('FORBIDDEN');
    });

    it('returns UNAUTHENTICATED when requireOwner throws generic error', async () => {
      vi.spyOn(guards, 'requireOwner').mockRejectedValueOnce(new Error('No session'));
      const res = await deleteDateOverrideAction('ov-1', dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('UNAUTHENTICATED');
    });

    it('returns VALIDATION_FAILED when raw input is not a string or object with id', async () => {
      const res = await deleteDateOverrideAction(12345, dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
      expect(res.error).toBe('Override ID is required');
      expect(res.fields).toEqual(['id']);
    });

    it('accepts object with id and successfully deletes override', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      vi.spyOn(service, 'deleteAvailabilityOverride').mockResolvedValueOnce({
        success: true,
        data: { id: 'ov-1' },
      });

      const res = await deleteDateOverrideAction({ id: 'ov-1' }, dummyClient);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toEqual({ id: 'ov-1' });
      }
      expect(revalidatePath).toHaveBeenCalledWith('/calendar');
    });
  });

  describe('createBookingTypeAction branches', () => {
    it('returns FORBIDDEN when requireOwner throws ForbiddenError', async () => {
      vi.spyOn(guards, 'requireOwner').mockRejectedValueOnce(
        new guards.ForbiddenError('Forbidden role'),
      );
      const res = await createBookingTypeAction({}, dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('FORBIDDEN');
    });

    it('returns UNAUTHENTICATED when requireOwner throws generic error', async () => {
      vi.spyOn(guards, 'requireOwner').mockRejectedValueOnce(new Error('Expired'));
      const res = await createBookingTypeAction({}, dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('UNAUTHENTICATED');
    });

    it('returns VALIDATION_FAILED when payload does not conform to schema', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      const res = await createBookingTypeAction({ title: '' }, dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
      expect(res.fields).toBeDefined();
    });

    it('creates booking type successfully and revalidates paths including book link', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      vi.spyOn(service, 'createBookingType').mockResolvedValueOnce({
        success: true,
        data: mockBookingType,
      });

      const res = await createBookingTypeAction(
        {
          title: 'Portrait Session',
          slug: 'portrait-session',
          durationMinutes: 60,
          locationType: 'in_person',
        },
        dummyClient,
      );
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toEqual(mockBookingType);
      }
      expect(revalidatePath).toHaveBeenCalledWith('/book/portrait-session');
    });
  });

  describe('updateBookingTypeAction branches', () => {
    it('returns FORBIDDEN when requireOwner throws ForbiddenError', async () => {
      vi.spyOn(guards, 'requireOwner').mockRejectedValueOnce(
        new guards.ForbiddenError('Forbidden role'),
      );
      const res = await updateBookingTypeAction('bt-1', { title: 'Updated' }, dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('FORBIDDEN');
    });

    it('returns UNAUTHENTICATED when requireOwner throws generic error', async () => {
      vi.spyOn(guards, 'requireOwner').mockRejectedValueOnce(new Error('No token'));
      const res = await updateBookingTypeAction('bt-1', { title: 'Updated' }, dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('UNAUTHENTICATED');
    });

    it('returns VALIDATION_FAILED when raw input has no id', async () => {
      const res = await updateBookingTypeAction(null, {}, dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
      expect(res.error).toBe('Booking type ID is required');
    });

    it('accepts combined object with id and payload', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      vi.spyOn(service, 'updateBookingType').mockResolvedValueOnce({
        success: true,
        data: mockBookingType,
      });

      const res = await updateBookingTypeAction({ id: 'bt-1', durationMinutes: 45 }, dummyClient);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toEqual(mockBookingType);
      }
    });

    it('returns VALIDATION_FAILED when update payload fails schema validation', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      const res = await updateBookingTypeAction('bt-1', { durationMinutes: -10 }, dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
      expect(res.fields).toContain('durationMinutes');
    });

    it('updates booking type and revalidates paths', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      vi.spyOn(service, 'updateBookingType').mockResolvedValueOnce({
        success: true,
        data: mockBookingType,
      });

      const res = await updateBookingTypeAction('bt-1', { title: 'Portrait Session' }, dummyClient);
      expect(res.success).toBe(true);
      expect(revalidatePath).toHaveBeenCalledWith('/book/portrait-session');
    });
  });

  describe('deleteBookingTypeAction branches', () => {
    it('returns FORBIDDEN when requireOwner throws ForbiddenError', async () => {
      vi.spyOn(guards, 'requireOwner').mockRejectedValueOnce(
        new guards.ForbiddenError('Forbidden role'),
      );
      const res = await deleteBookingTypeAction('bt-1', dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('FORBIDDEN');
    });

    it('returns UNAUTHENTICATED when requireOwner throws generic error', async () => {
      vi.spyOn(guards, 'requireOwner').mockRejectedValueOnce(new Error('No token'));
      const res = await deleteBookingTypeAction('bt-1', dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('UNAUTHENTICATED');
    });

    it('returns VALIDATION_FAILED when raw input is invalid', async () => {
      const res = await deleteBookingTypeAction(undefined, dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
      expect(res.error).toBe('Booking type ID is required');
    });

    it('accepts object with id and deletes booking type successfully', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      vi.spyOn(service, 'deleteBookingType').mockResolvedValueOnce({
        success: true,
        data: { id: 'bt-1' },
      });

      const res = await deleteBookingTypeAction({ id: 'bt-1' }, dummyClient);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toEqual({ id: 'bt-1' });
      }
      expect(revalidatePath).toHaveBeenCalledWith('/settings/calendar/availability');
    });

    it('accepts string id and custom db client', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      vi.spyOn(service, 'deleteBookingType').mockResolvedValueOnce({
        success: true,
        data: { id: 'bt-1' },
      });

      const res = await deleteBookingTypeAction('bt-1', dummyClient);
      expect(res.success).toBe(true);
    });
  });

  describe('Service failure branches across all actions', () => {
    it('returns service error on updateWeeklyScheduleAction failure', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      vi.spyOn(service, 'updateAvailabilitySchedules').mockResolvedValueOnce({
        success: false,
        code: 'INTERNAL_ERROR',
        error: 'Failed to update schedule',
      });

      const res = await updateWeeklyScheduleAction(
        [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isActive: true }],
        dummyClient,
      );
      expect(res.success).toBe(false);
      expect(res.code).toBe('INTERNAL_ERROR');
    });

    it('returns service error on createDateOverrideAction failure', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      vi.spyOn(service, 'createAvailabilityOverride').mockResolvedValueOnce({
        success: false,
        code: 'INTERNAL_ERROR',
        error: 'Database write failed',
      });

      const res = await createDateOverrideAction(
        { date: '2026-11-20', isUnavailable: true },
        dummyClient,
      );
      expect(res.success).toBe(false);
      expect(res.code).toBe('INTERNAL_ERROR');
    });

    it('returns service error on deleteDateOverrideAction failure', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      vi.spyOn(service, 'deleteAvailabilityOverride').mockResolvedValueOnce({
        success: false,
        code: 'NOT_FOUND',
        error: 'Override not found',
      });

      const res = await deleteDateOverrideAction('ov-999', dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('NOT_FOUND');
    });

    it('returns service error on createBookingTypeAction failure', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      vi.spyOn(service, 'createBookingType').mockResolvedValueOnce({
        success: false,
        code: 'CONFLICT',
        error: 'Slug conflict',
      });

      const res = await createBookingTypeAction(
        {
          title: 'Consultation',
          slug: 'portrait-session',
          durationMinutes: 30,
          locationType: 'in_person',
        },
        dummyClient,
      );
      expect(res.success).toBe(false);
      expect(res.code).toBe('CONFLICT');
    });

    it('returns service error on updateBookingTypeAction failure', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      vi.spyOn(service, 'updateBookingType').mockResolvedValueOnce({
        success: false,
        code: 'CONFLICT',
        error: 'Slug conflict',
      });

      const res = await updateBookingTypeAction('bt-1', { title: 'New Name' }, dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('CONFLICT');
    });

    it('returns service error on deleteBookingTypeAction failure', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      vi.spyOn(service, 'deleteBookingType').mockResolvedValueOnce({
        success: false,
        code: 'NOT_FOUND',
        error: 'Booking type not found',
      });

      const res = await deleteBookingTypeAction('bt-999', dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('NOT_FOUND');
    });

    it('covers createDateOverrideAction when service returns failure', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValueOnce(mockOwnerAuth);
      vi.spyOn(service, 'createAvailabilityOverride').mockResolvedValueOnce({
        success: false,
        code: 'VALIDATION_FAILED',
        error: 'Overlap',
      });

      const res = await createDateOverrideAction(
        { date: '2026-11-20', isUnavailable: true },
        dummyClient,
      );
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
    });

    it('covers defaultDb fallback branches in updateBookingTypeAction and deleteBookingTypeAction', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValue(mockOwnerAuth);
      vi.spyOn(service, 'updateBookingType').mockResolvedValue({
        success: true,
        data: {
          id: 'bt-1',
          title: 'Portrait Session',
          slug: 'portrait-session',
          description: null,
          durationMinutes: 30,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 15,
          minNoticeHours: 24,
          maxFutureDays: 60,
          locationType: 'in_person',
          locationDetails: null,
          color: 'indigo',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      vi.spyOn(service, 'deleteBookingType').mockResolvedValue({
        success: true,
        data: { id: 'bt-1' },
      });
      vi.spyOn(service, 'deleteAvailabilityOverride').mockResolvedValue({
        success: true,
        data: { id: 'ov-1' },
      });

      // updateBookingTypeAction with single object argument without client
      const updateRes = await updateBookingTypeAction({ id: 'bt-1', title: 'New Name' });
      expect(updateRes.success).toBe(true);

      // deleteBookingTypeAction with string id and no client
      const deleteRes1 = await deleteBookingTypeAction('bt-1');
      expect(deleteRes1.success).toBe(true);

      // deleteBookingTypeAction with object id and no client
      const deleteRes2 = await deleteBookingTypeAction({ id: 'bt-1' });
      expect(deleteRes2.success).toBe(true);

      // deleteDateOverrideAction with string id and no client
      const deleteOvRes1 = await deleteDateOverrideAction('ov-1');
      expect(deleteOvRes1.success).toBe(true);

      // deleteDateOverrideAction with object id and no client
      const deleteOvRes2 = await deleteDateOverrideAction({ id: 'ov-1' });
      expect(deleteOvRes2.success).toBe(true);
    });
  });
});
