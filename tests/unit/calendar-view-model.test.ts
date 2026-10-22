import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  EVENT_COLOR_TOKENS,
  getEventBadgeClasses,
  groupEventsByDate,
  getEventsForDate,
  calculateNextGridFocus,
  formatEventTimeRange,
  getInitialAppointmentState,
  submitAppointmentForm,
  getInitialBlockedTimeState,
  submitBlockedTimeForm,
  findCellCoordinates,
  getOrderedWeekdays,
  matchCalendarKeyboardShortcut,
  type AppointmentActionDispatcher,
  type BlockedTimeActionDispatcher,
  type AppointmentFormValues,
  type BlockedTimeFormValues,
} from '@/components/calendar/calendar-view-model';
import type { UnifiedCalendarEvent } from '@/server/calendar/service';

describe('TASK-0042: Calendar View-Model & Color Token System (AC-2, AC-3, AC-4, AC-5, AC-6)', () => {
  const emptyApptValues: AppointmentFormValues = {
    title: '',
    startsAt: '',
    endsAt: '',
    attendeeName: '',
    attendeeEmail: '',
    locationType: 'google_meet',
  };

  const emptyBlockedValues: BlockedTimeFormValues = {
    title: '',
    startsAt: '',
    endsAt: '',
    allDay: false,
  };

  describe('AC-2: Visual Design and Color Token Contrast System', () => {
    it('AC-2: defines high-contrast Indigo tokens for Shoots meeting >= 4.5:1 ratio', () => {
      const shootToken = EVENT_COLOR_TOKENS.shoot;
      expect(shootToken.badgeClasses).toContain('bg-indigo-50');
      expect(shootToken.badgeClasses).toContain('border-indigo-200');
      expect(shootToken.badgeClasses).toContain('text-indigo-900');
      expect(shootToken.badgeClasses).toContain('dark:bg-indigo-950');
      expect(shootToken.badgeClasses).toContain('dark:border-indigo-800');
      expect(shootToken.badgeClasses).toContain('dark:text-indigo-200');
    });

    it('AC-2: defines high-contrast Amber tokens for Appointments meeting >= 4.5:1 ratio', () => {
      const apptToken = EVENT_COLOR_TOKENS.appointment;
      expect(apptToken.badgeClasses).toContain('bg-amber-50');
      expect(apptToken.badgeClasses).toContain('border-amber-200');
      expect(apptToken.badgeClasses).toContain('text-amber-900');
      expect(apptToken.badgeClasses).toContain('dark:bg-amber-950');
      expect(apptToken.badgeClasses).toContain('dark:border-amber-800');
      expect(apptToken.badgeClasses).toContain('dark:text-amber-200');
    });

    it('AC-2: defines high-contrast Slate tokens for Blocked Time meeting >= 4.5:1 ratio', () => {
      const blockedToken = EVENT_COLOR_TOKENS.blocked_time;
      expect(blockedToken.badgeClasses).toContain('bg-slate-100');
      expect(blockedToken.badgeClasses).toContain('border-slate-300');
      expect(blockedToken.badgeClasses).toContain('text-slate-800');
      expect(blockedToken.badgeClasses).toContain('dark:bg-slate-800');
      expect(blockedToken.badgeClasses).toContain('dark:border-slate-700');
      expect(blockedToken.badgeClasses).toContain('dark:text-slate-300');
    });

    it('AC-2: getEventBadgeClasses returns appropriate token classes based on event type', () => {
      expect(getEventBadgeClasses('shoot')).toBe(EVENT_COLOR_TOKENS.shoot.badgeClasses);
      expect(getEventBadgeClasses('appointment')).toBe(EVENT_COLOR_TOKENS.appointment.badgeClasses);
      expect(getEventBadgeClasses('blocked_time')).toBe(
        EVENT_COLOR_TOKENS.blocked_time.badgeClasses,
      );
      expect(
        getEventBadgeClasses(
          'non_existent' as unknown as Parameters<typeof getEventBadgeClasses>[0],
        ),
      ).toBe(EVENT_COLOR_TOKENS.blocked_time.badgeClasses);
    });
  });

  describe('AC-3: Accessible Month Grid Arrow Key Navigation Calculations', () => {
    it('AC-3: ArrowRight moves focus to the next day cell, wrapping to next row if at end of week', () => {
      // row 0, col 2 -> row 0, col 3
      expect(calculateNextGridFocus(0, 2, 'ArrowRight')).toEqual({ row: 0, col: 3 });
      // row 0, col 6 -> row 1, col 0 (wrapping)
      expect(calculateNextGridFocus(0, 6, 'ArrowRight')).toEqual({ row: 1, col: 0 });
      // row 5, col 6 -> stays at row 5, col 6 (boundary)
      expect(calculateNextGridFocus(5, 6, 'ArrowRight')).toEqual({ row: 5, col: 6 });
    });

    it('AC-3: ArrowLeft moves focus to previous day cell, wrapping to previous row if at start of week', () => {
      // row 1, col 3 -> row 1, col 2
      expect(calculateNextGridFocus(1, 3, 'ArrowLeft')).toEqual({ row: 1, col: 2 });
      // row 1, col 0 -> row 0, col 6 (wrapping)
      expect(calculateNextGridFocus(1, 0, 'ArrowLeft')).toEqual({ row: 0, col: 6 });
      // row 0, col 0 -> stays at row 0, col 0 (boundary)
      expect(calculateNextGridFocus(0, 0, 'ArrowLeft')).toEqual({ row: 0, col: 0 });
    });

    it('AC-3: ArrowDown moves focus down one week (same day of week, row + 1)', () => {
      expect(calculateNextGridFocus(2, 4, 'ArrowDown')).toEqual({ row: 3, col: 4 });
      // row 5 -> stays at row 5 (boundary)
      expect(calculateNextGridFocus(5, 4, 'ArrowDown')).toEqual({ row: 5, col: 4 });
    });

    it('AC-3: ArrowUp moves focus up one week (same day of week, row - 1)', () => {
      expect(calculateNextGridFocus(3, 4, 'ArrowUp')).toEqual({ row: 2, col: 4 });
      // row 0 -> stays at row 0 (boundary)
      expect(calculateNextGridFocus(0, 4, 'ArrowUp')).toEqual({ row: 0, col: 4 });
      // non-arrow key -> stays in place
      expect(calculateNextGridFocus(2, 3, 'Enter')).toEqual({ row: 2, col: 3 });
    });
  });

  describe('AC-4: Event Grouping and Time Formatting', () => {
    const mockEvents: UnifiedCalendarEvent[] = [
      {
        id: '1',
        type: 'shoot',
        title: 'Wedding Shoot',
        startsAt: '2026-10-22T10:00:00.000Z',
        endsAt: '2026-10-22T14:00:00.000Z',
        allDay: false,
        timezone: 'Europe/Berlin',
      },
      {
        id: '2',
        type: 'appointment',
        title: 'Discovery Call',
        startsAt: '2026-10-22T15:00:00.000Z',
        endsAt: '2026-10-22T15:30:00.000Z',
        allDay: false,
        timezone: 'Europe/Berlin',
      },
      {
        id: '4',
        type: 'blocked_time',
        title: 'All Day Out of Office',
        startsAt: '2026-10-22',
        endsAt: '2026-10-22',
        allDay: true,
        timezone: 'Europe/Berlin',
      },
      {
        id: '3',
        type: 'blocked_time',
        title: 'Studio Maintenance',
        startsAt: '2026-10-23T00:00:00.000Z',
        endsAt: '2026-10-23T23:59:59.999Z',
        allDay: true,
        timezone: 'Europe/Berlin',
      },
    ];

    it('AC-4: groups events by date string accurately', () => {
      const grouped = groupEventsByDate(mockEvents);
      expect(grouped.get('2026-10-22')?.length).toBe(3);
      expect(grouped.get('2026-10-23')?.length).toBe(1);
      expect(grouped.get('2026-10-24')).toBeUndefined();
    });

    it('AC-4: retrieves events for a specific date', () => {
      const oct22Events = getEventsForDate(mockEvents, '2026-10-22');
      expect(oct22Events).toHaveLength(3);
      expect(oct22Events[0]?.title).toBe('All Day Out of Office');
      expect(oct22Events[1]?.title).toBe('Wedding Shoot');
      expect(oct22Events[2]?.title).toBe('Discovery Call');
    });

    it('AC-4: formats event time ranges cleanly in 24h format', () => {
      const timeStr = formatEventTimeRange(
        '2026-10-22T10:00:00.000Z',
        '2026-10-22T14:30:00.000Z',
        false,
        'UTC',
      );
      expect(timeStr).toBe('10:00 – 14:30');

      const timeWithDateObj = formatEventTimeRange(
        new Date('2026-10-22T10:00:00.000Z'),
        new Date('2026-10-22T14:30:00.000Z'),
        false,
        'Europe/Berlin',
      );
      expect(timeWithDateObj).toBeDefined();

      const timeWithoutTz = formatEventTimeRange(
        '2026-10-22T10:00:00.000Z',
        '2026-10-22T14:30:00.000Z',
      );
      expect(timeWithoutTz).toBeDefined();

      const allDayStr = formatEventTimeRange(
        '2026-10-22T00:00:00.000Z',
        '2026-10-22T23:59:59.999Z',
        true,
        'UTC',
      );
      expect(allDayStr).toBe('All Day');

      const nonExistentDateEvents = getEventsForDate(mockEvents, '1999-01-01');
      expect(nonExistentDateEvents).toEqual([]);
    });
  });

  describe('AC-5: Appointment Form State and Submission Helpers', () => {
    const dummyAppt: UnifiedCalendarEvent = {
      id: 'appt-1',
      type: 'appointment',
      title: 'Consultation Call',
      startsAt: '2026-10-25T15:00:00.000Z',
      endsAt: '2026-10-25T16:00:00.000Z',
      allDay: false,
      timezone: 'UTC',
      attendeeName: 'Emma Watson',
      attendeeEmail: 'emma@example.org',
      attendeePhone: '+49 30 1234567',
      locationType: 'in_person',
      locationDetails: 'Studio B',
      notes: 'Bring portfolio',
    };

    it('computes initial appointment state in edit and cancel mode', () => {
      const editState = getInitialAppointmentState(dummyAppt, 'edit');
      expect(editState.title).toBe('Consultation Call');
      expect(editState.attendeeName).toBe('Emma Watson');
      expect(editState.locationType).toBe('in_person');
      expect(editState.locationDetails).toBe('Studio B');
      expect(editState.notes).toBe('Bring portfolio');

      const cancelState = getInitialAppointmentState(dummyAppt, 'cancel');
      expect(cancelState.title).toBe('Consultation Call');
    });

    it('computes initial appointment state with nullish optional fields in edit mode', () => {
      const minimalAppt: UnifiedCalendarEvent = {
        id: 'appt-2',
        type: 'appointment',
        title: 'Quick Call',
        startsAt: '',
        endsAt: '',
        allDay: false,
        timezone: 'UTC',
      };
      const state = getInitialAppointmentState(minimalAppt, 'edit');
      expect(state.startsAt).toBe('');
      expect(state.endsAt).toBe('');
      expect(state.attendeePhone).toBe('');
      expect(state.locationType).toBe('google_meet');
      expect(state.locationDetails).toBe('');
      expect(state.notes).toBe('');
    });

    it('computes initial appointment state in create mode with defaultDate', () => {
      const state = getInitialAppointmentState(null, 'create', '2026-10-25');
      expect(state.title).toBe('');
      expect(state.startsAt).toContain('2026-10-25');
      expect(state.locationType).toBe('google_meet');
    });

    it('computes initial appointment state in create mode without defaultDate', () => {
      const state = getInitialAppointmentState(null, 'create');
      expect(state.title).toBe('');
      expect(state.startsAt).toBeDefined();
      expect(state.endsAt).toBeDefined();
    });

    it('submits appointment form in cancel mode (success and failure)', async () => {
      const mockCancel = vi.fn().mockResolvedValue({ success: true });
      const dispatchers: AppointmentActionDispatcher = {
        create: vi.fn(),
        update: vi.fn(),
        cancel: mockCancel,
      };

      const res = await submitAppointmentForm(
        'cancel',
        dummyAppt,
        {
          title: 'Cancel',
          startsAt: '2026-10-25T15:00',
          endsAt: '2026-10-25T16:00',
          attendeeName: 'Emma',
          attendeeEmail: 'emma@example.org',
          locationType: 'google_meet',
          cancelReason: 'Client sick',
        },
        dispatchers,
      );
      expect(res).toEqual({ success: true });
      expect(mockCancel).toHaveBeenCalledWith('appt-1', { reason: 'Client sick' });

      // Cancel without appointment returns error
      const noApptRes = await submitAppointmentForm('cancel', null, emptyApptValues, dispatchers);
      expect(noApptRes.success).toBe(false);

      // Cancel failure from action
      mockCancel.mockResolvedValueOnce({
        success: false,
        error: 'Cannot cancel past appointment',
      });
      const failRes = await submitAppointmentForm(
        'cancel',
        dummyAppt,
        emptyApptValues,
        dispatchers,
      );
      expect(failRes).toEqual({ success: false, error: 'Cannot cancel past appointment' });
    });

    it('submits appointment form in edit mode (success and failure)', async () => {
      const mockUpdate = vi.fn().mockResolvedValue({ success: true });
      const dispatchers: AppointmentActionDispatcher = {
        create: vi.fn(),
        update: mockUpdate,
        cancel: vi.fn(),
      };

      const res = await submitAppointmentForm(
        'edit',
        dummyAppt,
        {
          title: 'Updated Call',
          startsAt: '2026-10-25T15:00',
          endsAt: '2026-10-25T16:00',
          attendeeName: 'Emma',
          attendeeEmail: 'emma@example.org',
          attendeePhone: '+49 30 9999',
          locationType: 'google_meet',
          locationDetails: 'https://meet.google.com/xyz',
          notes: 'Notes here',
        },
        dispatchers,
      );
      expect(res).toEqual({ success: true });

      // Edit without appointment returns error
      const noApptRes = await submitAppointmentForm('edit', null, emptyApptValues, dispatchers);
      expect(noApptRes.success).toBe(false);

      // Edit failure from action
      mockUpdate.mockResolvedValueOnce({ success: false, error: 'Update failed' });
      const failRes = await submitAppointmentForm(
        'edit',
        dummyAppt,
        {
          title: 'Updated',
          startsAt: '2026-10-25T15:00',
          endsAt: '2026-10-25T16:00',
          attendeeName: 'Emma',
          attendeeEmail: 'emma@example.org',
          locationType: 'google_meet',
        },
        dispatchers,
      );
      expect(failRes).toEqual({ success: false, error: 'Update failed' });
    });

    it('submits appointment form in create mode (success and failure)', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ success: true });
      const dispatchers: AppointmentActionDispatcher = {
        create: mockCreate,
        update: vi.fn(),
        cancel: vi.fn(),
      };

      const res = await submitAppointmentForm(
        'create',
        null,
        {
          title: 'New Consultation',
          startsAt: '2026-10-25T15:00',
          endsAt: '2026-10-25T16:00',
          attendeeName: 'Liam',
          attendeeEmail: 'liam@example.org',
          locationType: 'google_meet',
        },
        dispatchers,
      );
      expect(res).toEqual({ success: true });

      // Create failure
      mockCreate.mockResolvedValueOnce({ success: false, error: 'Invalid range' });
      const failRes = await submitAppointmentForm(
        'create',
        null,
        {
          title: 'New Consultation',
          startsAt: '2026-10-25T15:00',
          endsAt: '2026-10-25T16:00',
          attendeeName: 'Liam',
          attendeeEmail: 'liam@example.org',
          locationType: 'google_meet',
        },
        dispatchers,
      );
      expect(failRes).toEqual({ success: false, error: 'Invalid range' });
    });

    it('catches thrown errors in appointment form submission', async () => {
      const mockCreate = vi.fn().mockRejectedValue(new Error('Network error'));
      const dispatchers: AppointmentActionDispatcher = {
        create: mockCreate,
        update: vi.fn(),
        cancel: vi.fn(),
      };

      const res = await submitAppointmentForm(
        'create',
        null,
        {
          title: 'Error Call',
          startsAt: '2026-10-25T15:00',
          endsAt: '2026-10-25T16:00',
          attendeeName: 'Liam',
          attendeeEmail: 'liam@example.org',
          locationType: 'google_meet',
        },
        dispatchers,
      );
      expect(res).toEqual({ success: false, error: 'Network error' });

      // Non-error throw

      const nonErrorCreate = vi.fn().mockRejectedValue('Fatal string error');
      const nonErrorDispatchers: AppointmentActionDispatcher = {
        create: nonErrorCreate,
        update: vi.fn(),
        cancel: vi.fn(),
      };
      const resString = await submitAppointmentForm(
        'create',
        null,
        {
          title: 'Error Call',
          startsAt: '2026-10-25T15:00',
          endsAt: '2026-10-25T16:00',
          attendeeName: 'Liam',
          attendeeEmail: 'liam@example.org',
          locationType: 'google_meet',
        },
        nonErrorDispatchers,
      );
      expect(resString).toEqual({ success: false, error: 'Operation failed' });
    });
  });

  describe('AC-6: Blocked Time Form State and Submission Helpers', () => {
    const dummyBlocked: UnifiedCalendarEvent = {
      id: 'bt-1',
      type: 'blocked_time',
      title: 'Studio Maintenance',
      startsAt: '2026-10-25T09:00:00.000Z',
      endsAt: '2026-10-25T17:00:00.000Z',
      allDay: false,
      timezone: 'UTC',
      notes: 'Rigging repair',
    };

    it('computes initial blocked time state in edit and delete mode', () => {
      const editState = getInitialBlockedTimeState(dummyBlocked, 'edit');
      expect(editState.title).toBe('Studio Maintenance');
      expect(editState.allDay).toBe(false);
      expect(editState.notes).toBe('Rigging repair');

      const deleteState = getInitialBlockedTimeState(dummyBlocked, 'delete');
      expect(deleteState.title).toBe('Studio Maintenance');
    });

    it('computes initial blocked time state with missing startsAt/endsAt in edit mode', () => {
      const minimalBlocked: UnifiedCalendarEvent = {
        id: 'bt-2',
        type: 'blocked_time',
        title: 'Vacation',
        startsAt: '',
        endsAt: '',
        allDay: true,
        timezone: 'UTC',
      };
      const state = getInitialBlockedTimeState(minimalBlocked, 'edit');
      expect(state.startsAt).toBe('');
      expect(state.endsAt).toBe('');
      expect(state.notes).toBe('');
    });

    it('computes initial blocked time state in create mode with defaultDate', () => {
      const state = getInitialBlockedTimeState(null, 'create', '2026-10-25');
      expect(state.title).toBe('Studio Maintenance');
      expect(state.startsAt).toContain('2026-10-25');
    });

    it('computes initial blocked time state in create mode without defaultDate', () => {
      const state = getInitialBlockedTimeState(null, 'create');
      expect(state.title).toBe('Studio Maintenance');
      expect(state.startsAt).toBeDefined();
    });

    it('submits blocked time form in delete mode (success and failure)', async () => {
      const mockDelete = vi.fn().mockResolvedValue({ success: true });
      const dispatchers: BlockedTimeActionDispatcher = {
        create: vi.fn(),
        update: vi.fn(),
        delete: mockDelete,
      };

      const res = await submitBlockedTimeForm(
        'delete',
        dummyBlocked,
        {
          title: 'Delete',
          startsAt: '2026-10-25T09:00',
          endsAt: '2026-10-25T17:00',
          allDay: false,
        },
        dispatchers,
      );
      expect(res).toEqual({ success: true });
      expect(mockDelete).toHaveBeenCalledWith('bt-1');

      // Missing record
      const noRecordRes = await submitBlockedTimeForm(
        'delete',
        null,
        emptyBlockedValues,
        dispatchers,
      );
      expect(noRecordRes.success).toBe(false);

      // Failure from action
      mockDelete.mockResolvedValueOnce({ success: false, error: 'Cannot delete' });
      const failRes = await submitBlockedTimeForm(
        'delete',
        dummyBlocked,
        emptyBlockedValues,
        dispatchers,
      );
      expect(failRes).toEqual({ success: false, error: 'Cannot delete' });
    });

    it('submits blocked time form in edit mode (success and failure)', async () => {
      const mockUpdate = vi.fn().mockResolvedValue({ success: true });
      const dispatchers: BlockedTimeActionDispatcher = {
        create: vi.fn(),
        update: mockUpdate,
        delete: vi.fn(),
      };

      const res = await submitBlockedTimeForm(
        'edit',
        dummyBlocked,
        {
          title: 'Updated Maintenance',
          startsAt: '2026-10-25T09:00',
          endsAt: '2026-10-25T17:00',
          allDay: true,
          notes: 'Updated notes',
        },
        dispatchers,
      );
      expect(res).toEqual({ success: true });

      // Missing record
      const noRecordRes = await submitBlockedTimeForm(
        'edit',
        null,
        emptyBlockedValues,
        dispatchers,
      );
      expect(noRecordRes.success).toBe(false);

      // Failure from action
      mockUpdate.mockResolvedValueOnce({ success: false, error: 'Update blocked time failed' });
      const failRes = await submitBlockedTimeForm(
        'edit',
        dummyBlocked,
        {
          title: 'Updated',
          startsAt: '2026-10-25T09:00',
          endsAt: '2026-10-25T17:00',
          allDay: false,
        },
        dispatchers,
      );
      expect(failRes).toEqual({ success: false, error: 'Update blocked time failed' });
    });

    it('submits blocked time form in create mode (success, default title, and failure)', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ success: true });
      const dispatchers: BlockedTimeActionDispatcher = {
        create: mockCreate,
        update: vi.fn(),
        delete: vi.fn(),
      };

      const res = await submitBlockedTimeForm(
        'create',
        null,
        {
          title: '',
          startsAt: '2026-10-25T09:00',
          endsAt: '2026-10-25T17:00',
          allDay: false,
        },
        dispatchers,
      );
      expect(res).toEqual({ success: true });
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ title: 'Blocked Time' }));

      // Failure
      mockCreate.mockResolvedValueOnce({ success: false, error: 'Creation failed' });
      const failRes = await submitBlockedTimeForm(
        'create',
        null,
        {
          title: 'Custom Title',
          startsAt: '2026-10-25T09:00',
          endsAt: '2026-10-25T17:00',
          allDay: false,
        },
        dispatchers,
      );
      expect(failRes).toEqual({ success: false, error: 'Creation failed' });
    });

    it('catches thrown errors in blocked time submission', async () => {
      const mockCreate = vi.fn().mockRejectedValue(new Error('Network disconnected'));
      const dispatchers: BlockedTimeActionDispatcher = {
        create: mockCreate,
        update: vi.fn(),
        delete: vi.fn(),
      };

      const res = await submitBlockedTimeForm(
        'create',
        null,
        {
          title: 'Throwing',
          startsAt: '2026-10-25T09:00',
          endsAt: '2026-10-25T17:00',
          allDay: false,
        },
        dispatchers,
      );
      expect(res).toEqual({ success: false, error: 'Network disconnected' });

      // Non-error throw

      const nonErrorCreate = vi.fn().mockRejectedValue('Fatal string error');
      const nonErrorDispatchers: BlockedTimeActionDispatcher = {
        create: nonErrorCreate,
        update: vi.fn(),
        delete: vi.fn(),
      };
      const resString = await submitBlockedTimeForm(
        'create',
        null,
        {
          title: 'Throwing',
          startsAt: '2026-10-25T09:00',
          endsAt: '2026-10-25T17:00',
          allDay: false,
        },
        nonErrorDispatchers,
      );
      expect(resString).toEqual({ success: false, error: 'Operation failed' });
    });
  });

  describe('AC-3, AC-4: Grid Coordinates, Weekdays, and Keyboard Shortcuts', () => {
    it('findCellCoordinates locates date in 6x7 grid or falls back to {0, 0}', () => {
      const mockGrid = [
        [{ dateString: '2026-10-01' }, { dateString: '2026-10-02' }],
        [{ dateString: '2026-10-08' }, { dateString: '2026-10-09' }],
      ];

      expect(
        findCellCoordinates(
          mockGrid as unknown as Parameters<typeof findCellCoordinates>[0],
          '2026-10-09',
        ),
      ).toEqual({ row: 1, col: 1 });
      expect(
        findCellCoordinates(
          mockGrid as unknown as Parameters<typeof findCellCoordinates>[0],
          '2026-12-31',
        ),
      ).toEqual({ row: 0, col: 0 });
      expect(findCellCoordinates([], '2026-10-09')).toEqual({ row: 0, col: 0 });
    });

    it('getOrderedWeekdays orders weekday names starting from firstDayOfWeek', () => {
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      // Sunday start (0)
      expect(getOrderedWeekdays(names, 0)).toEqual([
        'Sun',
        'Mon',
        'Tue',
        'Wed',
        'Thu',
        'Fri',
        'Sat',
      ]);
      // Monday start (1)
      expect(getOrderedWeekdays(names, 1)).toEqual([
        'Mon',
        'Tue',
        'Wed',
        'Thu',
        'Fri',
        'Sat',
        'Sun',
      ]);
    });

    it('matchCalendarKeyboardShortcut resolves view change or today action', () => {
      expect(matchCalendarKeyboardShortcut('m', false, false)).toBe('month');
      expect(matchCalendarKeyboardShortcut('M', false, false)).toBe('month');
      expect(matchCalendarKeyboardShortcut('w', false, false)).toBe('week');
      expect(matchCalendarKeyboardShortcut('W', false, false)).toBe('week');
      expect(matchCalendarKeyboardShortcut('d', false, false)).toBe('day');
      expect(matchCalendarKeyboardShortcut('D', false, false)).toBe('day');
      expect(matchCalendarKeyboardShortcut('t', false, false)).toBe('today');
      expect(matchCalendarKeyboardShortcut('T', false, false)).toBe('today');

      // Ignored in input elements or when modal is open
      expect(matchCalendarKeyboardShortcut('m', true, false)).toBeNull();
      expect(matchCalendarKeyboardShortcut('m', false, true)).toBeNull();
      expect(matchCalendarKeyboardShortcut('x', false, false)).toBeNull();
    });
  });
});
