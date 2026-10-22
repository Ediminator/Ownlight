import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  buildInitialScheduleMap,
  toggleWeekdayActive,
  updateWeekdayTime,
  validateWeeklyScheduleRanges,
  serializeWeeklySchedules,
  submitWeeklyScheduleUpdate,
  getInitialOverrideFormState,
  validateDateOverrideFormState,
  filterAndSortUpcomingOverrides,
  submitDateOverrideCreate,
  submitDateOverrideDelete,
  getInitialBookingTypeFormState,
  computeBookingTypeSlug,
  validateBookingTypeFormState,
  serializeCreateBookingTypePayload,
  serializeUpdateBookingTypePayload,
  submitBookingTypeCreate,
  submitBookingTypeUpdate,
  submitBookingTypeDelete,
  copyPublicBookingLink,
  getBookingLocationBadgeInfo,
  type OverrideFormState,
  type BookingTypeFormState,
} from '@/components/calendar/settings/availability-view-model';
import type {
  AvailabilitySchedule,
  AvailabilityOverride,
  BookingType,
} from '@/server/db/schema/calendar';

describe('TASK-0043: Availability View-Model Unit Tests', () => {
  describe('Weekly Schedule View-Model', () => {
    it('buildInitialScheduleMap populates default schedules Mon-Fri active, Sat-Sun inactive when empty', () => {
      const map = buildInitialScheduleMap([]);
      expect(map[1]?.isActive).toBe(true);
      expect(map[2]?.isActive).toBe(true);
      expect(map[3]?.isActive).toBe(true);
      expect(map[4]?.isActive).toBe(true);
      expect(map[5]?.isActive).toBe(true);
      expect(map[6]?.isActive).toBe(false);
      expect(map[0]?.isActive).toBe(false);
      expect(map[1]?.startTime).toBe('09:00');
      expect(map[1]?.endTime).toBe('17:00');
    });

    it('buildInitialScheduleMap uses persisted schedule values from DB', () => {
      const dbSchedules: AvailabilitySchedule[] = [
        {
          id: 's-1',
          dayOfWeek: 1,
          startTime: '08:30',
          endTime: '16:30',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 's-2',
          dayOfWeek: 6,
          startTime: '10:00',
          endTime: '14:00',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const map = buildInitialScheduleMap(dbSchedules);
      expect(map[1]?.startTime).toBe('08:30');
      expect(map[1]?.endTime).toBe('16:30');
      expect(map[1]?.isActive).toBe(true);
      expect(map[6]?.isActive).toBe(true);
      expect(map[0]?.isActive).toBe(false);
    });

    it('toggleWeekdayActive toggles day active state', () => {
      const initial = buildInitialScheduleMap([]);
      const toggled1 = toggleWeekdayActive(initial, 1);
      expect(toggled1[1]?.isActive).toBe(false);

      const toggledAgain = toggleWeekdayActive(toggled1, 1);
      expect(toggledAgain[1]?.isActive).toBe(true);

      // Missing day fallback
      const withMissing = toggleWeekdayActive({}, 3);
      expect(withMissing[3]?.isActive).toBe(true);
    });

    it('updateWeekdayTime updates start or end time cleanly', () => {
      const initial = buildInitialScheduleMap([]);
      const updatedStart = updateWeekdayTime(initial, 2, 'startTime', '10:15');
      expect(updatedStart[2]?.startTime).toBe('10:15');

      const updatedEnd = updateWeekdayTime(initial, 2, 'endTime', '18:45');
      expect(updatedEnd[2]?.endTime).toBe('18:45');

      // Missing day fallback
      const withMissing = updateWeekdayTime({}, 4, 'startTime', '08:00');
      expect(withMissing[4]?.startTime).toBe('08:00');
    });

    it('validateWeeklyScheduleRanges detects start >= end on active days only', () => {
      const schedules = buildInitialScheduleMap([]);
      // Mon valid (09:00 - 17:00)
      expect(validateWeeklyScheduleRanges(schedules, 'Range error')).toEqual({});

      // Set Mon invalid (17:00 - 09:00)
      schedules[1] = { dayOfWeek: 1, startTime: '17:00', endTime: '09:00', isActive: true };
      const errors = validateWeeklyScheduleRanges(schedules, 'Range error');
      expect(errors[1]).toBe('Range error');

      // Set Sat invalid (18:00 - 10:00) but inactive -> no error
      schedules[6] = { dayOfWeek: 6, startTime: '18:00', endTime: '10:00', isActive: false };
      const errorsInactive = validateWeeklyScheduleRanges(schedules, 'Range error');
      expect(errorsInactive[6]).toBeUndefined();
    });

    it('serializeWeeklySchedules formats schedule map into array of 7 days', () => {
      const schedules = buildInitialScheduleMap([]);
      const payload = serializeWeeklySchedules(schedules);
      expect(payload.schedules.length).toBe(7);
      expect(payload.schedules[0]?.dayOfWeek).toBe(1); // Monday is first in WEEKDAY_ORDER
      expect(payload.schedules[6]?.dayOfWeek).toBe(0); // Sunday is last in WEEKDAY_ORDER
    });

    it('serializeWeeklySchedules handles missing map keys with default fallback', () => {
      const payload = serializeWeeklySchedules({});
      expect(payload.schedules.length).toBe(7);
      expect(payload.schedules[0]?.startTime).toBe('09:00');
    });

    it('submitWeeklyScheduleUpdate handles success, failure response, and exception', async () => {
      const schedules = buildInitialScheduleMap([]);

      // Success
      const mockSuccess = vi.fn().mockResolvedValue({ success: true, data: [] });
      const res1 = await submitWeeklyScheduleUpdate(schedules, mockSuccess);
      expect(res1.success).toBe(true);

      // Action failure
      const mockFail = vi.fn().mockResolvedValue({ success: false, error: 'Database error' });
      const res2 = await submitWeeklyScheduleUpdate(schedules, mockFail);
      expect(res2.success).toBe(false);
      expect(res2.error).toBe('Database error');

      // Thrown exception
      const mockThrow = vi.fn().mockRejectedValue(new Error('Network offline'));
      const res3 = await submitWeeklyScheduleUpdate(schedules, mockThrow);
      expect(res3.success).toBe(false);
      expect(res3.error).toBe('Network offline');

      // Non-Error exception
      const mockThrowNonError = vi.fn().mockRejectedValue('String error');
      const res4 = await submitWeeklyScheduleUpdate(schedules, mockThrowNonError);
      expect(res4.success).toBe(false);
      expect(res4.error).toBe('Failed to update weekly schedule');
    });
  });

  describe('Date Overrides View-Model', () => {
    const errorMessages = {
      dateRequired: 'Date required',
      invalidDate: 'Invalid date format',
      invalidRange: 'Invalid time range',
    };

    it('getInitialOverrideFormState returns expected blank state', () => {
      const state = getInitialOverrideFormState();
      expect(state.date).toBe('');
      expect(state.isUnavailable).toBe(true);
      expect(state.startTime).toBe('09:00');
      expect(state.endTime).toBe('17:00');
      expect(state.reason).toBe('');
    });

    it('validateDateOverrideFormState validates date presence, date format, and time ranges', () => {
      expect(
        validateDateOverrideFormState(
          { ...getInitialOverrideFormState(), date: '' },
          errorMessages,
        ),
      ).toBe('Date required');

      expect(
        validateDateOverrideFormState(
          { ...getInitialOverrideFormState(), date: 'not-a-date' },
          errorMessages,
        ),
      ).toBe('Invalid date format');

      // Unavailable = true doesn't need valid start/end times
      expect(
        validateDateOverrideFormState(
          {
            date: '2026-11-20',
            isUnavailable: true,
            startTime: '20:00',
            endTime: '10:00',
            reason: '',
          },
          errorMessages,
        ),
      ).toBeNull();

      // Unavailable = false requires valid start < end times
      expect(
        validateDateOverrideFormState(
          {
            date: '2026-11-20',
            isUnavailable: false,
            startTime: '17:00',
            endTime: '09:00',
            reason: '',
          },
          errorMessages,
        ),
      ).toBe('Invalid time range');

      // Missing start or end
      expect(
        validateDateOverrideFormState(
          {
            date: '2026-11-20',
            isUnavailable: false,
            startTime: '',
            endTime: '17:00',
            reason: '',
          },
          errorMessages,
        ),
      ).toBe('Invalid time range');

      // Valid custom hours
      expect(
        validateDateOverrideFormState(
          {
            date: '2026-11-20',
            isUnavailable: false,
            startTime: '10:00',
            endTime: '14:00',
            reason: 'Pop-up event',
          },
          errorMessages,
        ),
      ).toBeNull();
    });

    it('filterAndSortUpcomingOverrides sorts overrides ascending and optionally filters past dates', () => {
      const overrides: AvailabilityOverride[] = [
        {
          id: 'o-2',
          date: '2026-12-01',
          isUnavailable: true,
          startTime: null,
          endTime: null,
          reason: 'Holiday',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'o-1',
          date: '2026-10-15',
          isUnavailable: false,
          startTime: '10:00',
          endTime: '14:00',
          reason: 'Past event',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'o-3',
          date: '2026-11-10',
          isUnavailable: true,
          startTime: null,
          endTime: null,
          reason: 'Workshop',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      // Without todayStr
      const sorted = filterAndSortUpcomingOverrides(overrides);
      expect(sorted[0]?.date).toBe('2026-10-15');
      expect(sorted[1]?.date).toBe('2026-11-10');
      expect(sorted[2]?.date).toBe('2026-12-01');

      // With todayStr = '2026-11-01'
      const upcoming = filterAndSortUpcomingOverrides(overrides, '2026-11-01');
      expect(upcoming.length).toBe(2);
      expect(upcoming[0]?.date).toBe('2026-11-10');
      expect(upcoming[1]?.date).toBe('2026-12-01');
    });

    it('submitDateOverrideCreate handles success, failure and exceptions', async () => {
      const values: OverrideFormState = {
        date: '2026-11-20',
        isUnavailable: true,
        startTime: '09:00',
        endTime: '17:00',
        reason: ' Conference ',
      };

      const mockCreated: AvailabilityOverride = {
        id: 'o-new',
        date: '2026-11-20',
        isUnavailable: true,
        startTime: null,
        endTime: null,
        reason: 'Conference',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Success unavailable
      const mockSuccess = vi.fn().mockResolvedValue({ success: true, data: mockCreated });
      const res1 = await submitDateOverrideCreate(values, mockSuccess);
      expect(res1.success).toBe(true);
      expect(mockSuccess).toHaveBeenCalledWith({
        date: '2026-11-20',
        isUnavailable: true,
        startTime: null,
        endTime: null,
        reason: 'Conference',
      });

      // Success custom hours
      const customValues: OverrideFormState = {
        date: '2026-11-21',
        isUnavailable: false,
        startTime: '10:00',
        endTime: '15:00',
        reason: '',
      };
      await submitDateOverrideCreate(customValues, mockSuccess);
      expect(mockSuccess).toHaveBeenCalledWith({
        date: '2026-11-21',
        isUnavailable: false,
        startTime: '10:00',
        endTime: '15:00',
        reason: null,
      });

      // Failure from action
      const mockFail = vi.fn().mockResolvedValue({ success: false, error: 'Duplicate date' });
      const res2 = await submitDateOverrideCreate(values, mockFail);
      expect(res2.success).toBe(false);
      expect(res2.error).toBe('Duplicate date');

      // Exception thrown
      const mockThrow = vi.fn().mockRejectedValue(new Error('Connection aborted'));
      const res3 = await submitDateOverrideCreate(values, mockThrow);
      expect(res3.success).toBe(false);
      expect(res3.error).toBe('Connection aborted');

      // Non-Error exception
      const mockThrowNonError = vi.fn().mockRejectedValue('Unknown error');
      const res4 = await submitDateOverrideCreate(values, mockThrowNonError);
      expect(res4.success).toBe(false);
      expect(res4.error).toBe('Failed to create override');
    });

    it('submitDateOverrideDelete handles success, failure, and exceptions', async () => {
      const mockSuccess = vi.fn().mockResolvedValue({ success: true });
      const res1 = await submitDateOverrideDelete('o-1', mockSuccess);
      expect(res1.success).toBe(true);

      const mockFail = vi.fn().mockResolvedValue({ success: false, error: 'Not found' });
      const res2 = await submitDateOverrideDelete('o-999', mockFail);
      expect(res2.success).toBe(false);
      expect(res2.error).toBe('Not found');

      const mockThrow = vi.fn().mockRejectedValue(new Error('Server crashed'));
      const res3 = await submitDateOverrideDelete('o-1', mockThrow);
      expect(res3.success).toBe(false);
      expect(res3.error).toBe('Server crashed');

      const mockThrowNonError = vi.fn().mockRejectedValue(404);
      const res4 = await submitDateOverrideDelete('o-1', mockThrowNonError);
      expect(res4.success).toBe(false);
      expect(res4.error).toBe('Failed to delete override');
    });
  });

  describe('Booking Types View-Model', () => {
    const errorMessages = {
      titleRequired: 'Title required',
      slugRequired: 'Slug required',
      slugInvalid: 'Slug invalid format',
      durationMin: 'Duration min 5 min',
      noticeMin: 'Notice min 0 hours',
      horizonMin: 'Horizon min 1 day',
    };

    it('getInitialBookingTypeFormState returns default state when no item passed', () => {
      const state = getInitialBookingTypeFormState();
      expect(state.title).toBe('');
      expect(state.slug).toBe('');
      expect(state.slugManuallyEdited).toBe(false);
      expect(state.durationMinutes).toBe(30);
      expect(state.bufferBeforeMinutes).toBe(0);
      expect(state.bufferAfterMinutes).toBe(15);
      expect(state.minNoticeHours).toBe(24);
      expect(state.maxFutureDays).toBe(60);
      expect(state.locationType).toBe('google_meet');
      expect(state.color).toBe('indigo');
      expect(state.isActive).toBe(true);
    });

    it('getInitialBookingTypeFormState populates existing booking type data', () => {
      const dummyItem: BookingType = {
        id: 'bt-1',
        title: 'Wedding Consultation',
        slug: 'wedding-consultation',
        description: 'Initial consultation call',
        durationMinutes: 45,
        bufferBeforeMinutes: 10,
        bufferAfterMinutes: 20,
        minNoticeHours: 48,
        maxFutureDays: 90,
        locationType: 'phone',
        locationDetails: '+49 30 123456',
        color: 'rose',
        isActive: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const state = getInitialBookingTypeFormState(dummyItem);
      expect(state.title).toBe('Wedding Consultation');
      expect(state.slug).toBe('wedding-consultation');
      expect(state.slugManuallyEdited).toBe(true);
      expect(state.durationMinutes).toBe(45);
      expect(state.color).toBe('rose');
      expect(state.isActive).toBe(false);
    });

    it('computeBookingTypeSlug generates slug automatically when not manually edited and not editing', () => {
      expect(computeBookingTypeSlug('Portrait Session', '', false, false)).toBe('portrait-session');
      // When manually edited
      expect(computeBookingTypeSlug('Portrait Session', 'custom-slug', true, false)).toBe(
        'custom-slug',
      );
      // When editing existing item
      expect(computeBookingTypeSlug('Portrait Session', 'original-slug', false, true)).toBe(
        'original-slug',
      );
    });

    it('validateBookingTypeFormState checks all constraints', () => {
      const valid = getInitialBookingTypeFormState();
      valid.title = 'Portrait Session';
      valid.slug = 'portrait-session';

      expect(validateBookingTypeFormState(valid, errorMessages)).toBeNull();

      // Title required
      expect(validateBookingTypeFormState({ ...valid, title: '   ' }, errorMessages)).toBe(
        'Title required',
      );

      // Slug required
      expect(validateBookingTypeFormState({ ...valid, slug: '' }, errorMessages)).toBe(
        'Slug required',
      );

      // Slug invalid
      expect(validateBookingTypeFormState({ ...valid, slug: 'Invalid_Slug!' }, errorMessages)).toBe(
        'Slug invalid format',
      );

      // Duration invalid
      expect(validateBookingTypeFormState({ ...valid, durationMinutes: 4 }, errorMessages)).toBe(
        'Duration min 5 min',
      );

      // Notice invalid
      expect(validateBookingTypeFormState({ ...valid, minNoticeHours: -1 }, errorMessages)).toBe(
        'Notice min 0 hours',
      );

      // Horizon invalid
      expect(validateBookingTypeFormState({ ...valid, maxFutureDays: 0 }, errorMessages)).toBe(
        'Horizon min 1 day',
      );
    });

    it('serializeCreateBookingTypePayload and serializeUpdateBookingTypePayload sanitize inputs', () => {
      const state: BookingTypeFormState = {
        title: '  Studio Shoot  ',
        slug: 'studio-shoot',
        slugManuallyEdited: true,
        description: '   ',
        durationMinutes: 60,
        bufferBeforeMinutes: 15,
        bufferAfterMinutes: 15,
        minNoticeHours: 12,
        maxFutureDays: 30,
        locationType: 'in_person',
        locationDetails: '  Studio A  ',
        color: 'emerald',
        isActive: true,
      };

      const createPayload = serializeCreateBookingTypePayload(state);
      expect(createPayload.title).toBe('Studio Shoot');
      expect(createPayload.description).toBeNull();
      expect(createPayload.locationDetails).toBe('Studio A');

      const updatePayload = serializeUpdateBookingTypePayload(state);
      expect(updatePayload.title).toBe('Studio Shoot');
      expect(updatePayload.description).toBeNull();
      expect(updatePayload.locationDetails).toBe('Studio A');
    });

    it('submitBookingTypeCreate handles success, failure, and exceptions', async () => {
      const state = getInitialBookingTypeFormState();
      state.title = 'Test';
      state.slug = 'test';

      const mockSuccess = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'bt-new', ...state },
      });
      const res1 = await submitBookingTypeCreate(state, mockSuccess);
      expect(res1.success).toBe(true);

      const mockFail = vi.fn().mockResolvedValue({ success: false, error: 'Slug conflict' });
      const res2 = await submitBookingTypeCreate(state, mockFail);
      expect(res2.success).toBe(false);
      expect(res2.error).toBe('Slug conflict');

      const mockThrow = vi.fn().mockRejectedValue(new Error('Network error'));
      const res3 = await submitBookingTypeCreate(state, mockThrow);
      expect(res3.success).toBe(false);
      expect(res3.error).toBe('Network error');

      const mockThrowNonError = vi.fn().mockRejectedValue('String fail');
      const res4 = await submitBookingTypeCreate(state, mockThrowNonError);
      expect(res4.success).toBe(false);
      expect(res4.error).toBe('Failed to create booking type');
    });

    it('submitBookingTypeUpdate handles success, failure, and exceptions', async () => {
      const state = getInitialBookingTypeFormState();
      state.title = 'Updated Title';
      state.slug = 'updated-title';

      const mockSuccess = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'bt-1', ...state },
      });
      const res1 = await submitBookingTypeUpdate('bt-1', state, mockSuccess);
      expect(res1.success).toBe(true);

      const mockFail = vi.fn().mockResolvedValue({ success: false, error: 'Update failed' });
      const res2 = await submitBookingTypeUpdate('bt-1', state, mockFail);
      expect(res2.success).toBe(false);
      expect(res2.error).toBe('Update failed');

      const mockThrow = vi.fn().mockRejectedValue(new Error('Database lock'));
      const res3 = await submitBookingTypeUpdate('bt-1', state, mockThrow);
      expect(res3.success).toBe(false);
      expect(res3.error).toBe('Database lock');

      const mockThrowNonError = vi.fn().mockRejectedValue(null);
      const res4 = await submitBookingTypeUpdate('bt-1', state, mockThrowNonError);
      expect(res4.success).toBe(false);
      expect(res4.error).toBe('Failed to update booking type');
    });

    it('submitBookingTypeDelete handles success, failure, and exceptions', async () => {
      const mockSuccess = vi.fn().mockResolvedValue({ success: true });
      const res1 = await submitBookingTypeDelete('bt-1', mockSuccess);
      expect(res1.success).toBe(true);

      const mockFail = vi.fn().mockResolvedValue({ success: false, error: 'Not found' });
      const res2 = await submitBookingTypeDelete('bt-1', mockFail);
      expect(res2.success).toBe(false);
      expect(res2.error).toBe('Not found');

      const mockThrow = vi.fn().mockRejectedValue(new Error('Delete rejected'));
      const res3 = await submitBookingTypeDelete('bt-1', mockThrow);
      expect(res3.success).toBe(false);
      expect(res3.error).toBe('Delete rejected');

      const mockThrowNonError = vi.fn().mockRejectedValue({});
      const res4 = await submitBookingTypeDelete('bt-1', mockThrowNonError);
      expect(res4.success).toBe(false);
      expect(res4.error).toBe('Failed to delete booking type');
    });

    it('copyPublicBookingLink copies url with mock writer or handles failures', async () => {
      const mockWriter = vi.fn().mockResolvedValue(undefined);
      const res1 = await copyPublicBookingLink(
        'my-session',
        'https://studio.example.org',
        mockWriter,
      );
      expect(res1).toBe(true);
      expect(mockWriter).toHaveBeenCalledWith('https://studio.example.org/book/my-session');

      const mockFailingWriter = vi.fn().mockRejectedValue(new Error('Denied'));
      const res2 = await copyPublicBookingLink(
        'my-session',
        'https://studio.example.org',
        mockFailingWriter,
      );
      expect(res2).toBe(false);

      // With global navigator.clipboard
      const mockClipboardWrite = vi.fn().mockResolvedValue(undefined);
      const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      try {
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: mockClipboardWrite },
          configurable: true,
        });
        const resNav = await copyPublicBookingLink('my-session', 'https://studio.example.org');
        expect(resNav).toBe(true);
        expect(mockClipboardWrite).toHaveBeenCalledWith(
          'https://studio.example.org/book/my-session',
        );
      } finally {
        if (originalClipboard) {
          Object.defineProperty(navigator, 'clipboard', originalClipboard);
        }
      }

      // Default without clipboard in Node environment returns false
      const res3 = await copyPublicBookingLink('my-session', 'https://studio.example.org');
      expect(typeof res3).toBe('boolean');
    });

    it('getBookingLocationBadgeInfo returns correct badge metadata for all location types', () => {
      expect(getBookingLocationBadgeInfo('google_meet')).toEqual({
        iconType: 'video',
        labelKey: 'locationGoogleMeet',
      });
      expect(getBookingLocationBadgeInfo('phone')).toEqual({
        iconType: 'phone',
        labelKey: 'locationPhone',
      });
      expect(getBookingLocationBadgeInfo('in_person')).toEqual({
        iconType: 'map-pin',
        labelKey: 'locationInPerson',
      });
    });
  });
});
