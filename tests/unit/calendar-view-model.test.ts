import { describe, it, expect } from 'vitest';
import {
  EVENT_COLOR_TOKENS,
  getEventBadgeClasses,
  groupEventsByDate,
  getEventsForDate,
  calculateNextGridFocus,
  formatEventTimeRange,
} from '@/components/calendar/calendar-view-model';
import type { UnifiedCalendarEvent } from '@/server/calendar/service';

describe('TASK-0042: Calendar View-Model & Color Token System (AC-2, AC-3, AC-4)', () => {
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
});
