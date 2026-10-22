/**
 * Calendar View-Model & Color Token Helpers
 *
 * Side-effect-free helper functions for visual token mapping,
 * accessible grid focus calculations, event grouping, and time display.
 * (ADR-0017 §3, TASK-0042 AC-2, AC-3, AC-4)
 */

import type { CalendarEventType, UnifiedCalendarEvent } from '@/server/calendar/service';
import { formatIsoDate } from '@/client/calendar/grid-math';

export interface EventColorTokenDefinition {
  type: CalendarEventType;
  badgeClasses: string;
  dotClass: string;
  borderClass: string;
}

/**
 * Visual color token definitions meeting WCAG 2.2 AA >= 4.5:1 contrast
 * against card backgrounds in both light and dark themes. (AC-2)
 */
export const EVENT_COLOR_TOKENS: Record<CalendarEventType, EventColorTokenDefinition> = {
  shoot: {
    type: 'shoot',
    badgeClasses:
      'bg-indigo-50 border-indigo-200 text-indigo-900 dark:bg-indigo-950 dark:border-indigo-800 dark:text-indigo-200',
    dotClass: 'bg-indigo-600 dark:bg-indigo-400',
    borderClass: 'border-l-indigo-600 dark:border-l-indigo-400',
  },
  appointment: {
    type: 'appointment',
    badgeClasses:
      'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-200',
    dotClass: 'bg-amber-600 dark:bg-amber-400',
    borderClass: 'border-l-amber-600 dark:border-l-amber-400',
  },
  blocked_time: {
    type: 'blocked_time',
    badgeClasses:
      'bg-slate-100 border-slate-300 text-slate-800 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300',
    dotClass: 'bg-slate-600 dark:bg-slate-400',
    borderClass: 'border-l-slate-600 dark:border-l-slate-400',
  },
};

/**
 * Returns Tailwind CSS badge classes for a given calendar event type.
 */
export function getEventBadgeClasses(type: CalendarEventType): string {
  switch (type) {
    case 'shoot':
      return EVENT_COLOR_TOKENS.shoot.badgeClasses;
    case 'appointment':
      return EVENT_COLOR_TOKENS.appointment.badgeClasses;
    case 'blocked_time':
    default:
      return EVENT_COLOR_TOKENS.blocked_time.badgeClasses;
  }
}

/**
 * Calculates next (row, col) focus coordinates in a 6x7 month grid
 * given an arrow key press. (AC-3)
 */
export function calculateNextGridFocus(
  currentRow: number,
  currentCol: number,
  key: string,
): { row: number; col: number } {
  switch (key) {
    case 'ArrowRight':
      if (currentCol < 6) {
        return { row: currentRow, col: currentCol + 1 };
      }
      if (currentRow < 5) {
        return { row: currentRow + 1, col: 0 };
      }
      return { row: currentRow, col: currentCol };

    case 'ArrowLeft':
      if (currentCol > 0) {
        return { row: currentRow, col: currentCol - 1 };
      }
      if (currentRow > 0) {
        return { row: currentRow - 1, col: 6 };
      }
      return { row: currentRow, col: currentCol };

    case 'ArrowDown':
      return { row: Math.min(5, currentRow + 1), col: currentCol };

    case 'ArrowUp':
      return { row: Math.max(0, currentRow - 1), col: currentCol };

    default:
      return { row: currentRow, col: currentCol };
  }
}

/**
 * Extracts a normalized 'YYYY-MM-DD' date string from an event's startsAt.
 */
export function getEventDateKey(event: UnifiedCalendarEvent): string {
  if (event.allDay && typeof event.startsAt === 'string' && event.startsAt.length >= 10) {
    return event.startsAt.slice(0, 10);
  }
  const date = new Date(event.startsAt);
  return formatIsoDate(date);
}

/**
 * Groups unified calendar events by their calendar date key ('YYYY-MM-DD').
 */
export function groupEventsByDate(
  events: UnifiedCalendarEvent[],
): Map<string, UnifiedCalendarEvent[]> {
  const map = new Map<string, UnifiedCalendarEvent[]>();

  for (const event of events) {
    const key = getEventDateKey(event);
    const existing = map.get(key) ?? [];
    existing.push(event);
    map.set(key, existing);
  }

  // Sort each date's events chronologically
  for (const list of map.values()) {
    list.sort((a, b) => {
      if (a.allDay && !b.allDay) return -1;
      if (!a.allDay && b.allDay) return 1;
      return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    });
  }

  return map;
}

/**
 * Retrieves all events scheduled for a specific date string ('YYYY-MM-DD').
 */
export function getEventsForDate(
  events: UnifiedCalendarEvent[],
  dateString: string,
): UnifiedCalendarEvent[] {
  return groupEventsByDate(events).get(dateString) ?? [];
}

/**
 * Formats a start and end time into a clean 24-hour range string (e.g. "14:00 – 16:30").
 */
export function formatEventTimeRange(
  startsAt: string | Date,
  endsAt: string | Date,
  allDay = false,
  timeZone?: string,
): string {
  if (allDay) {
    return 'All Day';
  }

  const startDate = typeof startsAt === 'string' ? new Date(startsAt) : startsAt;
  const endDate = typeof endsAt === 'string' ? new Date(endsAt) : endsAt;

  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  };

  const startFormatted = new Intl.DateTimeFormat('en-GB', timeOptions).format(startDate);
  const endFormatted = new Intl.DateTimeFormat('en-GB', timeOptions).format(endDate);

  return `${startFormatted} – ${endFormatted}`;
}
