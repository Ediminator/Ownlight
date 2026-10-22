import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import {
  createAppointmentAction,
  updateAppointmentAction,
  cancelAppointmentAction,
  createBlockedTimeAction,
  updateBlockedTimeAction,
  deleteBlockedTimeAction,
  getCalendarEventsAction,
} from '@/server/calendar/actions';
import * as guards from '@/server/auth/guards';
import * as service from '@/server/calendar/service';
import type { DbClient } from '@/server/db/client';
import type { Appointment, BlockedTime } from '@/server/db/schema/calendar';

describe('TASK-0042: Calendar Server Actions Branch Coverage', () => {
  const dummyClient = {} as DbClient;

  const mockOwnerAuth: guards.AuthContext = {
    user: {
      id: 'owner-1',
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

  const mockAppointment: Appointment = {
    id: '01920000-0000-7000-8000-000000000001',
    bookingTypeId: null,
    clientId: null,
    projectId: null,
    leadId: null,
    title: 'Valid appt',
    status: 'scheduled',
    startsAt: new Date('2026-10-25T10:00:00Z'),
    endsAt: new Date('2026-10-25T11:00:00Z'),
    timezone: 'Europe/Berlin',
    attendeeName: 'Emma',
    attendeeEmail: 'emma@example.org',
    attendeePhone: null,
    attendeeNotes: null,
    locationType: 'google_meet',
    locationDetails: null,
    meetUrl: null,
    cancellationReason: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockBlockedTime: BlockedTime = {
    id: 'bt-1',
    title: 'Valid block',
    startsAt: new Date('2026-10-25T10:00:00Z'),
    endsAt: new Date('2026-10-25T11:00:00Z'),
    allDay: false,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Auth and Forbidden branches', () => {
    it('returns FORBIDDEN when user has non-owner role', async () => {
      vi.spyOn(guards, 'requireOwner').mockRejectedValueOnce(
        new guards.ForbiddenError('Owner role required'),
      );

      const res = await createAppointmentAction({}, dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('FORBIDDEN');
    });

    it('returns UNAUTHENTICATED when unauthenticated error occurs', async () => {
      vi.spyOn(guards, 'requireOwner').mockRejectedValueOnce(
        new guards.UnauthorizedError('No session'),
      );

      const res = await createAppointmentAction({}, dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('UNAUTHENTICATED');
    });

    it('creates appointment successfully via mock service', async () => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValue(mockOwnerAuth);
      vi.spyOn(service, 'createAppointment').mockResolvedValueOnce({
        success: true,
        data: mockAppointment,
      });

      const res = await createAppointmentAction(
        {
          title: 'Valid appt',
          startsAt: '2026-10-25T10:00:00Z',
          endsAt: '2026-10-25T11:00:00Z',
          attendeeName: 'Emma',
          attendeeEmail: 'emma@example.org',
        },
        dummyClient,
      );
      expect(res.success).toBe(true);
    });
  });

  describe('updateAppointmentAction branches', () => {
    beforeEach(() => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValue(mockOwnerAuth);
    });

    it('handles update with string ID and invalid input validation', async () => {
      const res = await updateAppointmentAction(
        '01920000-0000-7000-8000-000000000001',
        { startsAt: '2026-10-25T12:00:00Z', endsAt: '2026-10-25T10:00:00Z' }, // ends before starts
        dummyClient,
      );
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
    });

    it('handles update with object input containing id', async () => {
      vi.spyOn(service, 'updateAppointment').mockResolvedValueOnce({
        success: true,
        data: mockAppointment,
      });

      const res = await updateAppointmentAction(
        { id: '01920000-0000-7000-8000-000000000001', title: 'Updated' },
        dummyClient,
      );
      expect(res.success).toBe(true);
    });

    it('rejects update when input lacks an id', async () => {
      const res = await updateAppointmentAction(null);
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
      expect(res.fields).toContain('id');
    });
  });

  describe('cancelAppointmentAction branches', () => {
    beforeEach(() => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValue(mockOwnerAuth);
    });

    it('handles cancellation with object input containing id', async () => {
      vi.spyOn(service, 'cancelAppointment').mockResolvedValueOnce({
        success: true,
        data: { ...mockAppointment, status: 'cancelled' },
      });

      const res = await cancelAppointmentAction(
        { id: '01920000-0000-7000-8000-000000000001', reason: 'Sick' },
        dummyClient,
      );
      expect(res.success).toBe(true);
    });

    it('rejects cancellation when input lacks an id', async () => {
      const res = await cancelAppointmentAction(123);
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
      expect(res.fields).toContain('id');
    });

    it('rejects cancellation with oversized reason string', async () => {
      const res = await cancelAppointmentAction(
        '01920000-0000-7000-8000-000000000001',
        { reason: 'a'.repeat(1001) },
        dummyClient,
      );
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('Blocked time actions branches', () => {
    beforeEach(() => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValue(mockOwnerAuth);
    });

    it('rejects createBlockedTimeAction with invalid date order', async () => {
      const res = await createBlockedTimeAction(
        {
          title: 'Test',
          startsAt: '2026-10-25T12:00:00Z',
          endsAt: '2026-10-25T10:00:00Z',
        },
        dummyClient,
      );
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
    });

    it('creates blocked time successfully via mock service', async () => {
      vi.spyOn(service, 'createBlockedTime').mockResolvedValueOnce({
        success: true,
        data: mockBlockedTime,
      });

      const res = await createBlockedTimeAction(
        {
          title: 'Valid block',
          startsAt: '2026-10-25T10:00:00Z',
          endsAt: '2026-10-25T11:00:00Z',
        },
        dummyClient,
      );
      expect(res.success).toBe(true);
    });

    it('handles updateBlockedTimeAction with object containing id', async () => {
      vi.spyOn(service, 'updateBlockedTime').mockResolvedValueOnce({
        success: true,
        data: { ...mockBlockedTime, title: 'Updated' },
      });

      const res = await updateBlockedTimeAction({ id: 'bt-1', title: 'Updated' }, dummyClient);
      expect(res.success).toBe(true);
    });

    it('rejects updateBlockedTimeAction without id', async () => {
      const res = await updateBlockedTimeAction(null);
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
    });

    it('rejects updateBlockedTimeAction with invalid dates', async () => {
      const res = await updateBlockedTimeAction(
        'bt-1',
        { startsAt: '2026-10-25T12:00:00Z', endsAt: '2026-10-25T10:00:00Z' },
        dummyClient,
      );
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
    });

    it('handles deleteBlockedTimeAction with object containing id', async () => {
      vi.spyOn(service, 'deleteBlockedTime').mockResolvedValueOnce({
        success: true,
        data: { id: 'bt-1' },
      });

      const res = await deleteBlockedTimeAction({ id: 'bt-1' }, dummyClient);
      expect(res.success).toBe(true);
    });

    it('rejects deleteBlockedTimeAction without id', async () => {
      const res = await deleteBlockedTimeAction(undefined);
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('getCalendarEventsAction branches', () => {
    beforeEach(() => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValue(mockOwnerAuth);
    });

    it('rejects invalid parameters for getCalendarEventsAction', async () => {
      const res = await getCalendarEventsAction({ startDate: 'not-a-date' }, dummyClient);
      expect(res.success).toBe(false);
      expect(res.code).toBe('VALIDATION_FAILED');
    });

    it('queries calendar events successfully via mock service', async () => {
      vi.spyOn(service, 'getUnifiedCalendarEvents').mockResolvedValueOnce([]);

      const res = await getCalendarEventsAction(
        {
          startDate: '2026-10-01T00:00:00Z',
          endDate: '2026-10-31T23:59:59Z',
        },
        dummyClient,
      );
      expect(res.success).toBe(true);
    });

    it('catches and formats internal service errors gracefully', async () => {
      vi.spyOn(service, 'getUnifiedCalendarEvents').mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      const res = await getCalendarEventsAction(
        {
          startDate: '2026-10-01T00:00:00Z',
          endDate: '2026-10-31T23:59:59Z',
        },
        dummyClient,
      );

      expect(res.success).toBe(false);
      expect(res.code).toBe('INTERNAL_ERROR');
      expect(res.error).toBe('Database connection failed');
    });

    it('catches non-Error thrown gracefully in getCalendarEventsAction', async () => {
      vi.spyOn(service, 'getUnifiedCalendarEvents').mockRejectedValueOnce('string error');

      const res = await getCalendarEventsAction(
        {
          startDate: '2026-10-01T00:00:00Z',
          endDate: '2026-10-31T23:59:59Z',
        },
        dummyClient,
      );
      expect(res.success).toBe(false);
      expect(res.code).toBe('INTERNAL_ERROR');
    });

    it('queries calendar events defaulting client when not passed', async () => {
      vi.spyOn(service, 'getUnifiedCalendarEvents').mockResolvedValueOnce([]);

      const res = await getCalendarEventsAction({
        startDate: '2026-10-01T00:00:00Z',
        endDate: '2026-10-31T23:59:59Z',
      });
      expect(res.success).toBe(true);
    });
  });

  describe('Service failure branches (no revalidation)', () => {
    beforeEach(() => {
      vi.spyOn(guards, 'requireOwner').mockResolvedValue(mockOwnerAuth);
    });

    it('handles createAppointment service failure', async () => {
      vi.spyOn(service, 'createAppointment').mockResolvedValueOnce({
        success: false,
        code: 'INTERNAL_ERROR',
        error: 'Failed to insert',
      });

      const res = await createAppointmentAction(
        {
          title: 'Valid appt',
          startsAt: '2026-10-25T10:00:00Z',
          endsAt: '2026-10-25T11:00:00Z',
          attendeeName: 'Emma',
          attendeeEmail: 'emma@example.org',
        },
        dummyClient,
      );
      expect(res.success).toBe(false);
      expect(res.code).toBe('INTERNAL_ERROR');
    });

    it('handles updateAppointment service failure and client default', async () => {
      vi.spyOn(service, 'updateAppointment').mockResolvedValueOnce({
        success: false,
        code: 'NOT_FOUND',
        error: 'Not found',
      });

      const res = await updateAppointmentAction('01920000-0000-7000-8000-000000000001', {
        title: 'New Title',
      });
      expect(res.success).toBe(false);
      expect(res.code).toBe('NOT_FOUND');
    });

    it('handles cancelAppointment service failure and client default', async () => {
      vi.spyOn(service, 'cancelAppointment').mockResolvedValueOnce({
        success: false,
        code: 'NOT_FOUND',
        error: 'Not found',
      });

      const res = await cancelAppointmentAction('01920000-0000-7000-8000-000000000001', {
        reason: 'Rescheduled',
      });
      expect(res.success).toBe(false);
      expect(res.code).toBe('NOT_FOUND');
    });

    it('handles createBlockedTime service failure', async () => {
      vi.spyOn(service, 'createBlockedTime').mockResolvedValueOnce({
        success: false,
        code: 'INTERNAL_ERROR',
        error: 'Failed to create block',
      });

      const res = await createBlockedTimeAction(
        {
          title: 'Test block',
          startsAt: '2026-10-25T10:00:00Z',
          endsAt: '2026-10-25T11:00:00Z',
        },
        dummyClient,
      );
      expect(res.success).toBe(false);
      expect(res.code).toBe('INTERNAL_ERROR');
    });

    it('handles updateBlockedTime service failure and string ID with default client', async () => {
      vi.spyOn(service, 'updateBlockedTime').mockResolvedValueOnce({
        success: false,
        code: 'NOT_FOUND',
        error: 'Not found',
      });

      const res = await updateBlockedTimeAction('bt-1', { title: 'Updated' });
      expect(res.success).toBe(false);
      expect(res.code).toBe('NOT_FOUND');
    });

    it('handles deleteBlockedTime with string ID and default client', async () => {
      vi.spyOn(service, 'deleteBlockedTime').mockResolvedValueOnce({
        success: true,
        data: { id: 'bt-1' },
      });

      const res = await deleteBlockedTimeAction('bt-1');
      expect(res.success).toBe(true);
    });

    it('handles deleteBlockedTime service failure and object with default client', async () => {
      vi.spyOn(service, 'deleteBlockedTime').mockResolvedValueOnce({
        success: false,
        code: 'NOT_FOUND',
        error: 'Not found',
      });

      const res = await deleteBlockedTimeAction({ id: 'bt-1' });
      expect(res.success).toBe(false);
      expect(res.code).toBe('NOT_FOUND');
    });
  });
});
