/**
 * Pure Calendar Math Helper
 *
 * Isomorphic, side-effect-free date and grid matrix calculations.
 * Safe across leap years, month boundaries, and DST transitions.
 * (ADR-0017 §3, TASK-0042 AC-11)
 */

export interface MonthGridCell {
  date: Date;
  dateString: string; // 'YYYY-MM-DD'
  year: number;
  month: number; // 0-11
  day: number; // 1-31
  isCurrentMonth: boolean;
  isToday: boolean;
  dayOfWeek: number; // 0 (Sunday) to 6 (Saturday)
}

/**
 * Returns the 2-digit zero-padded representation of a number.
 */
export function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

/**
 * Formats a Date object to 'YYYY-MM-DD' using local calendar components.
 */
export function formatIsoDate(date: Date): string {
  const year = String(date.getFullYear());
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}-${month}-${day}`;
}

/**
 * Parses a 'YYYY-MM-DD' string into a Date object set to noon (12:00:00.000)
 * in local time. Setting to noon ensures that +/- 1-hour daylight saving time
 * shifts never flip the calendar date.
 */
export function parseIsoDate(dateStr: string): Date {
  const [y = '1970', m = '1', d = '1'] = dateStr.split('-');
  const year = parseInt(y, 10);
  const month = parseInt(m, 10) - 1;
  const day = parseInt(d, 10);
  return new Date(year, month, day, 12, 0, 0, 0);
}

/**
 * Returns the locale-aware first day of the week:
 * - 1 (Monday) for German locales (de, de-DE, de-AT, etc.) and ISO standard.
 * - 0 (Sunday) for US English (en-US) and default fallback.
 */
export function getFirstDayOfWeek(locale?: string): number {
  if (!locale) return 0;
  const lower = locale.toLowerCase();
  if (lower.startsWith('de')) {
    return 1; // Monday
  }
  return 0; // Sunday (en-US, default)
}

/**
 * Checks whether a given Gregorian year is a leap year.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns the number of days in a given month (0-indexed: 0 = Jan, 11 = Dec).
 */
export function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Checks whether two dates correspond to the same calendar day.
 */
export function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/**
 * Returns the start (00:00:00.000) and end (23:59:59.999) Date boundaries
 * for a specific day.
 */
export function getDayBoundaries(dateOrStr: Date | string): { start: Date; end: Date } {
  const d = typeof dateOrStr === 'string' ? parseIsoDate(dateOrStr) : dateOrStr;
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();

  const start = new Date(year, month, day, 0, 0, 0, 0);
  const end = new Date(year, month, day, 23, 59, 59, 999);
  return { start, end };
}

/**
 * Creates a single MonthGridCell with noon timestamp.
 */
export function createGridCell(
  year: number,
  month: number,
  day: number,
  targetMonth: number,
  today: Date = new Date(),
): MonthGridCell {
  const cellDate = new Date(year, month, day, 12, 0, 0, 0);
  return {
    date: cellDate,
    dateString: formatIsoDate(cellDate),
    year: cellDate.getFullYear(),
    month: cellDate.getMonth(),
    day: cellDate.getDate(),
    isCurrentMonth: cellDate.getMonth() === targetMonth,
    isToday: isSameDay(cellDate, today),
    dayOfWeek: cellDate.getDay(),
  };
}

/**
 * Generates a full 6x7 (42 cells) month grid matrix with leading and trailing padding.
 *
 * @param year Full 4-digit year (e.g. 2026)
 * @param monthIndex 0-indexed month (0 = Jan, 9 = Oct, 11 = Dec)
 * @param firstDayOfWeek 0 = Sunday, 1 = Monday
 * @param today Reference date for `isToday` flag
 */
export function getMonthGrid(
  year: number,
  monthIndex: number,
  firstDayOfWeek = 0,
  today: Date = new Date(),
): MonthGridCell[][] {
  const firstOfMonth = new Date(year, monthIndex, 1, 12, 0, 0, 0);
  const firstOfMonthDayOfWeek = firstOfMonth.getDay();

  // Calculate leading padding days from preceding month
  const leadingDays = (firstOfMonthDayOfWeek - firstDayOfWeek + 7) % 7;
  const daysInCurrentMonth = getDaysInMonth(year, monthIndex);

  const cells: MonthGridCell[] = [];

  // 1. Leading padding days
  if (leadingDays > 0) {
    const prevMonthDays = getDaysInMonth(year, monthIndex - 1);
    const startDay = prevMonthDays - leadingDays + 1;
    for (let day = startDay; day <= prevMonthDays; day++) {
      cells.push(createGridCell(year, monthIndex - 1, day, monthIndex, today));
    }
  }

  // 2. Current month days
  for (let day = 1; day <= daysInCurrentMonth; day++) {
    cells.push(createGridCell(year, monthIndex, day, monthIndex, today));
  }

  // 3. Trailing padding days to fill 6 full weeks (42 cells)
  const remainingCells = 42 - cells.length;
  for (let day = 1; day <= remainingCells; day++) {
    cells.push(createGridCell(year, monthIndex + 1, day, monthIndex, today));
  }

  // Chunk into 6 rows of 7 days
  const grid: MonthGridCell[][] = [];
  for (let r = 0; r < 6; r++) {
    grid.push(cells.slice(r * 7, (r + 1) * 7));
  }

  return grid;
}

/**
 * Returns the exact query boundaries for a visible month grid,
 * including leading and trailing padding days.
 */
export function getMonthBoundaries(
  year: number,
  monthIndex: number,
  firstDayOfWeek = 0,
): {
  monthStart: Date;
  monthEnd: Date;
  gridStart: Date;
  gridEnd: Date;
} {
  const monthStart = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const daysInMonth = getDaysInMonth(year, monthIndex);
  const monthEnd = new Date(year, monthIndex, daysInMonth, 23, 59, 59, 999);

  const firstOfMonth = new Date(year, monthIndex, 1, 12, 0, 0, 0);
  const leadingDays = (firstOfMonth.getDay() - firstDayOfWeek + 7) % 7;

  const gridStart = new Date(year, monthIndex, 1 - leadingDays, 0, 0, 0, 0);
  const gridEnd = new Date(year, monthIndex, 1 - leadingDays + 41, 23, 59, 59, 999);

  return {
    monthStart,
    monthEnd,
    gridStart,
    gridEnd,
  };
}

/**
 * Returns the 7 days of the containing week for a given date,
 * aligned with `firstDayOfWeek`.
 */
export function getWeekDays(
  baseDate: Date,
  firstDayOfWeek = 0,
  today: Date = new Date(),
): MonthGridCell[] {
  const normalized = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    12,
    0,
    0,
    0,
  );
  const currentDayOfWeek = normalized.getDay();
  const offset = (currentDayOfWeek - firstDayOfWeek + 7) % 7;

  const startOfWeek = new Date(
    normalized.getFullYear(),
    normalized.getMonth(),
    normalized.getDate() - offset,
    12,
    0,
    0,
    0,
  );

  const week: MonthGridCell[] = [];
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(
      startOfWeek.getFullYear(),
      startOfWeek.getMonth(),
      startOfWeek.getDate() + i,
      12,
      0,
      0,
      0,
    );
    week.push({
      date: dayDate,
      dateString: formatIsoDate(dayDate),
      year: dayDate.getFullYear(),
      month: dayDate.getMonth(),
      day: dayDate.getDate(),
      isCurrentMonth: dayDate.getMonth() === baseDate.getMonth(),
      isToday: isSameDay(dayDate, today),
      dayOfWeek: dayDate.getDay(),
    });
  }

  return week;
}

/**
 * Navigates a date forward or backward by one period based on active view.
 */
export function navigateDate(
  currentDate: Date,
  view: 'month' | 'week' | 'day',
  direction: 'prev' | 'next',
): Date {
  const mult = direction === 'next' ? 1 : -1;
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const day = currentDate.getDate();

  if (view === 'month') {
    return new Date(year, month + mult, day, 12, 0, 0, 0);
  }
  if (view === 'week') {
    return new Date(year, month, day + mult * 7, 12, 0, 0, 0);
  }
  // day
  return new Date(year, month, day + mult, 12, 0, 0, 0);
}
