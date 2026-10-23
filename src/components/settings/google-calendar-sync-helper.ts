/**
 * Pure helper functions for Google Calendar & Meet settings view-model logic.
 */

export interface CalendarOption {
  id: string;
  label: string;
  isPrimary: boolean;
}

export function formatCalendarSyncDate(
  date: Date | string | null | undefined,
  locale: string,
): string | null {
  if (!date) return null;
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return null;
  }
}

export type CalendarSyncState = 'active' | 'inactive' | 'disconnected';

export function getCalendarSyncState(options: {
  connected: boolean;
  hasCalendarScope: boolean;
  syncEnabled: boolean;
}): CalendarSyncState {
  if (!options.connected || !options.hasCalendarScope) {
    return 'disconnected';
  }
  return options.syncEnabled ? 'active' : 'inactive';
}

export function formatCalendarOptions(
  calendars?: { id: string; summary: string; primary?: boolean }[] | null,
  fallbackPrimaryLabel = 'Primary Calendar',
): CalendarOption[] {
  if (!calendars || calendars.length === 0) {
    return [
      {
        id: 'primary',
        label: fallbackPrimaryLabel,
        isPrimary: true,
      },
    ];
  }

  return calendars.map((cal) => ({
    id: cal.id,
    label: cal.primary ? `${cal.summary} (${fallbackPrimaryLabel})` : cal.summary,
    isPrimary: cal.primary ? true : cal.id === 'primary',
  }));
}
