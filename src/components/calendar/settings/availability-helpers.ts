/**
 * Pure view-model and calculation helpers for Availability and Booking Types settings.
 */

export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const WEEKDAY_KEY_MAP: Record<number, string> = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
};

/**
 * Generate 30-minute interval time options from 00:00 to 23:30.
 */
export function generateTimeOptions(): string[] {
  const options: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = h.toString().padStart(2, '0');
      const mm = m.toString().padStart(2, '0');
      options.push(`${hh}:${mm}`);
    }
  }
  return options;
}

export const TIME_OPTIONS = generateTimeOptions();

/**
 * Validates that startTime is strictly earlier than endTime (HH:MM strings).
 */
export function isTimeRangeValid(startTime: string, endTime: string): boolean {
  if (!startTime || !endTime) return false;
  return startTime < endTime;
}

/**
 * Formats a YYYY-MM-DD string into a readable date string according to locale.
 */
export function formatDateDisplay(isoDate: string, locale = 'en'): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  try {
    const parts = isoDate.split('-').map(Number);
    const year = parts[0] ?? 2026;
    const month = parts[1] ?? 1;
    const day = parts[2] ?? 1;
    const date = new Date(Date.UTC(year, month - 1, day));
    return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return isoDate;
  }
}

export const COLOR_OPTIONS = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet'] as const;

export type ColorOption = (typeof COLOR_OPTIONS)[number];

export const COLOR_CLASS_MAP: Record<
  string,
  { bg: string; text: string; dot: string; border: string }
> = {
  indigo: {
    bg: 'bg-indigo-50 dark:bg-indigo-950/40',
    text: 'text-indigo-700 dark:text-indigo-300',
    dot: 'bg-indigo-500',
    border: 'border-indigo-200 dark:border-indigo-800',
  },
  emerald: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    text: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    border: 'border-emerald-200 dark:border-emerald-800',
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
    border: 'border-amber-200 dark:border-amber-800',
  },
  rose: {
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    text: 'text-rose-700 dark:text-rose-300',
    dot: 'bg-rose-500',
    border: 'border-rose-200 dark:border-rose-800',
  },
  sky: {
    bg: 'bg-sky-50 dark:bg-sky-950/40',
    text: 'text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500',
    border: 'border-sky-200 dark:border-sky-800',
  },
  violet: {
    bg: 'bg-violet-50 dark:bg-violet-950/40',
    text: 'text-violet-700 dark:text-violet-300',
    dot: 'bg-violet-500',
    border: 'border-violet-200 dark:border-violet-800',
  },
};

/**
 * Returns the CSS dot class for a booking type color token.
 */
export function getColorDotClass(color: string): string {
  switch (color) {
    case 'emerald':
      return 'bg-emerald-500';
    case 'amber':
      return 'bg-amber-500';
    case 'rose':
      return 'bg-rose-500';
    case 'sky':
      return 'bg-sky-500';
    case 'violet':
      return 'bg-violet-500';
    case 'indigo':
    default:
      return 'bg-indigo-500';
  }
}
