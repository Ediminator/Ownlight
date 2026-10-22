import { describe, it, expect } from 'vitest';
import {
  getFirstDayOfWeek,
  formatIsoDate,
  parseIsoDate,
  isLeapYear,
  getDaysInMonth,
  getDayBoundaries,
  getMonthBoundaries,
  getMonthGrid,
  getWeekDays,
  navigateDate,
  isSameDay,
} from '@/client/calendar/grid-math';

describe('TASK-0042: Pure Calendar Grid Math Helper (AC-11)', () => {
  describe('AC-11: Locale-aware first day of week', () => {
    it('AC-11: returns Monday (1) for German locales (de, de-DE, de-AT, de-CH)', () => {
      expect(getFirstDayOfWeek('de')).toBe(1);
      expect(getFirstDayOfWeek('de-DE')).toBe(1);
      expect(getFirstDayOfWeek('de-AT')).toBe(1);
      expect(getFirstDayOfWeek('de-CH')).toBe(1);
    });

    it('AC-11: returns Sunday (0) for US English (en-US) and default', () => {
      expect(getFirstDayOfWeek('en-US')).toBe(0);
      expect(getFirstDayOfWeek('en')).toBe(0);
      expect(getFirstDayOfWeek('fr')).toBe(0);
      expect(getFirstDayOfWeek('')).toBe(0);
      expect(getFirstDayOfWeek()).toBe(0);
    });
  });

  describe('AC-11: Leap year calculations', () => {
    it('AC-11: correctly identifies leap years and common years', () => {
      expect(isLeapYear(2024)).toBe(true);
      expect(isLeapYear(2028)).toBe(true);
      expect(isLeapYear(2000)).toBe(true); // divisible by 400
      expect(isLeapYear(1900)).toBe(false); // divisible by 100 but not 400
      expect(isLeapYear(2023)).toBe(false);
      expect(isLeapYear(2025)).toBe(false);
      expect(isLeapYear(2026)).toBe(false);
    });

    it('AC-11: February has 29 days in leap years and 28 days in common years', () => {
      expect(getDaysInMonth(2024, 1)).toBe(29); // 2024 Feb
      expect(getDaysInMonth(2028, 1)).toBe(29); // 2028 Feb
      expect(getDaysInMonth(2025, 1)).toBe(28); // 2025 Feb
      expect(getDaysInMonth(2026, 1)).toBe(28); // 2026 Feb
    });
  });

  describe('AC-11: Month boundary padding and grid matrix generation', () => {
    it('AC-11: generates standard 6x7 (42 cells) month grid with preceding and succeeding month padding', () => {
      // October 2026:
      // Oct 1, 2026 is a Thursday (day 4).
      // With firstDayOfWeek = 1 (Monday):
      // Monday = Sep 28, Tue = Sep 29, Wed = Sep 30, Thu = Oct 1.
      // So 3 leading padding days from September.
      const grid = getMonthGrid(2026, 9, 1); // 9 = October (0-indexed)
      expect(grid).toHaveLength(6);
      grid.forEach((week) => {
        expect(week).toHaveLength(7);
      });

      const firstCell = grid[0]?.[0];
      expect(firstCell).toBeDefined();
      expect(firstCell?.year).toBe(2026);
      expect(firstCell?.month).toBe(8); // September
      expect(firstCell?.day).toBe(28);
      expect(firstCell?.isCurrentMonth).toBe(false);
      expect(firstCell?.dateString).toBe('2026-09-28');

      // 4th cell should be Oct 1, 2026
      const oct1 = grid[0]?.[3];
      expect(oct1).toBeDefined();
      expect(oct1?.isCurrentMonth).toBe(true);
      expect(oct1?.dateString).toBe('2026-10-01');

      // October has 31 days. Oct 31, 2026 is a Saturday (row 4, col 5).
      // Remaining cells in grid are from November 2026.
      const lastCell = grid[5]?.[6];
      expect(lastCell).toBeDefined();
      expect(lastCell?.isCurrentMonth).toBe(false);
      expect(lastCell?.month).toBe(10); // November
    });

    it('AC-11: handles months where day 1 falls exactly on firstDayOfWeek (zero leading padding)', () => {
      // February 2021 started on a Monday (Feb 1, 2021)
      const grid = getMonthGrid(2021, 1, 1);
      const firstCell = grid[0]?.[0];
      expect(firstCell).toBeDefined();
      expect(firstCell?.isCurrentMonth).toBe(true);
      expect(firstCell?.dateString).toBe('2021-02-01');
    });

    it('AC-11: calculates month grid boundaries accurately including padding days', () => {
      const boundaries = getMonthBoundaries(2026, 9, 1);
      expect(formatIsoDate(boundaries.monthStart)).toBe('2026-10-01');
      expect(formatIsoDate(boundaries.monthEnd)).toBe('2026-10-31');
      expect(formatIsoDate(boundaries.gridStart)).toBe('2026-09-28');
      expect(formatIsoDate(boundaries.gridEnd)).toBe('2026-11-08');
    });
  });

  describe('AC-11: Week days interval calculation', () => {
    it('AC-11: returns 7 days of the containing week starting on Monday for German locale', () => {
      // 2026-10-22 is a Thursday
      const baseDate = parseIsoDate('2026-10-22');
      const week = getWeekDays(baseDate, 1);
      expect(week).toHaveLength(7);
      expect(week[0]?.dateString).toBe('2026-10-19'); // Monday
      expect(week[1]?.dateString).toBe('2026-10-20');
      expect(week[2]?.dateString).toBe('2026-10-21');
      expect(week[3]?.dateString).toBe('2026-10-22');
      expect(week[4]?.dateString).toBe('2026-10-23');
      expect(week[5]?.dateString).toBe('2026-10-24');
      expect(week[6]?.dateString).toBe('2026-10-25'); // Sunday
    });

    it('AC-11: returns 7 days of the containing week starting on Sunday for US locale', () => {
      const baseDate = parseIsoDate('2026-10-22');
      const week = getWeekDays(baseDate, 0);
      expect(week).toHaveLength(7);
      expect(week[0]?.dateString).toBe('2026-10-18'); // Sunday
      expect(week[6]?.dateString).toBe('2026-10-24'); // Saturday
    });
  });

  describe('AC-11: DST Transitions and deterministic timezone-safe calculations', () => {
    it('AC-11: computes grid across Europe/Berlin spring forward DST transition (last Sunday in March)', () => {
      // March 2026: DST spring forward occurs on Sunday, March 29, 2026 (02:00 -> 03:00)
      const grid = getMonthGrid(2026, 2, 1); // March 2026
      const flat = grid.flat();
      const march29 = flat.find((c) => c.dateString === '2026-03-29');
      const march30 = flat.find((c) => c.dateString === '2026-03-30');
      expect(march29).toBeDefined();
      expect(march30).toBeDefined();
      expect(march29?.day).toBe(29);
      expect(march30?.day).toBe(30);

      // Verify no duplicate days or skipped days around DST transition
      const marchDays = flat.filter((c) => c.month === 2).map((c) => c.day);
      expect(marchDays).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    });

    it('AC-11: computes grid across Europe/Berlin fall back DST transition (last Sunday in October)', () => {
      // October 2026: DST fall back occurs on Sunday, October 25, 2026 (03:00 -> 02:00)
      const grid = getMonthGrid(2026, 9, 1); // October 2026
      const flat = grid.flat();
      const oct25 = flat.find((c) => c.dateString === '2026-10-25');
      const oct26 = flat.find((c) => c.dateString === '2026-10-26');
      expect(oct25).toBeDefined();
      expect(oct26).toBeDefined();
      expect(oct25?.day).toBe(25);
      expect(oct26?.day).toBe(26);

      const octDays = flat.filter((c) => c.month === 9).map((c) => c.day);
      expect(octDays).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    });
  });

  describe('AC-11: Date navigation (Month, Week, Day)', () => {
    it('AC-11: navigates months correctly, respecting year boundaries', () => {
      const decDate = parseIsoDate('2026-12-15');
      const nextMonth = navigateDate(decDate, 'month', 'next');
      expect(formatIsoDate(nextMonth)).toBe('2027-01-15');

      const prevMonth = navigateDate(nextMonth, 'month', 'prev');
      expect(formatIsoDate(prevMonth)).toBe('2026-12-15');
    });

    it('AC-11: navigates weeks correctly, handling month boundaries', () => {
      const date = parseIsoDate('2026-10-29');
      const nextWeek = navigateDate(date, 'week', 'next');
      expect(formatIsoDate(nextWeek)).toBe('2026-11-05');

      const prevWeek = navigateDate(nextWeek, 'week', 'prev');
      expect(formatIsoDate(prevWeek)).toBe('2026-10-29');
    });

    it('AC-11: navigates days correctly, handling leap days', () => {
      const feb28Leap = parseIsoDate('2024-02-28');
      const feb29 = navigateDate(feb28Leap, 'day', 'next');
      expect(formatIsoDate(feb29)).toBe('2024-02-29');

      const mar1 = navigateDate(feb29, 'day', 'next');
      expect(formatIsoDate(mar1)).toBe('2024-03-01');

      const mar1Prev = navigateDate(mar1, 'day', 'prev');
      expect(formatIsoDate(mar1Prev)).toBe('2024-02-29');
    });
  });

  describe('AC-11: Helper utility checks (getDayBoundaries, isSameDay)', () => {
    it('AC-11: calculates start and end of day boundaries', () => {
      const date = parseIsoDate('2026-10-22');
      const { start, end } = getDayBoundaries(date);
      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      expect(start.getSeconds()).toBe(0);
      expect(start.getMilliseconds()).toBe(0);

      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
      expect(end.getSeconds()).toBe(59);
      expect(end.getMilliseconds()).toBe(999);

      const fromStr = getDayBoundaries('2026-10-22');
      expect(fromStr.start.getHours()).toBe(0);
      expect(fromStr.end.getHours()).toBe(23);
    });

    it('AC-11: checks isSameDay accurately', () => {
      const d1 = new Date(2026, 9, 22, 10, 0, 0);
      const d2 = new Date(2026, 9, 22, 18, 30, 0);
      const d3 = new Date(2026, 9, 23, 10, 0, 0);
      expect(isSameDay(d1, d2)).toBe(true);
      expect(isSameDay(d1, d3)).toBe(false);
    });
  });
});
