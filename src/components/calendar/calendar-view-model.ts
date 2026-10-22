/**
 * Calendar View-Model & Color Token Helpers
 *
 * Side-effect-free helper functions for visual token mapping,
 * accessible grid focus calculations, event grouping, time display,
 * coordinate search, weekday reordering, keyboard shortcuts, and form payload transforms.
 * (ADR-0017 §3, TASK-0042 AC-2, AC-3, AC-4, AC-5, AC-6)
 */

import type { CalendarEventType, UnifiedCalendarEvent } from '@/server/calendar/service';
import type { MonthGridCell } from '@/client/calendar/grid-math';
import type { BookingLocationType } from '@/server/db/schema/calendar';
import { formatIsoDate } from '@/client/calendar/grid-math';
import {
  createAppointmentAction,
  updateAppointmentAction,
  cancelAppointmentAction,
  createBlockedTimeAction,
  updateBlockedTimeAction,
  deleteBlockedTimeAction,
} from '@/server/calendar/actions';

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

export interface AppointmentFormValues {
  title: string;
  startsAt: string;
  endsAt: string;
  attendeeName: string;
  attendeeEmail: string;
  attendeePhone?: string;
  locationType: BookingLocationType;
  locationDetails?: string;
  notes?: string;
  cancelReason?: string;
}

/**
 * Computes initial state for appointment form modals.
 */
export function getInitialAppointmentState(
  appointment?: UnifiedCalendarEvent | null,
  mode: 'create' | 'edit' | 'cancel' = 'create',
  defaultDate?: string,
): AppointmentFormValues {
  if (appointment && (mode === 'edit' || mode === 'cancel')) {
    return {
      title: appointment.title,
      startsAt: appointment.startsAt
        ? new Date(appointment.startsAt).toISOString().slice(0, 16)
        : '',
      endsAt: appointment.endsAt ? new Date(appointment.endsAt).toISOString().slice(0, 16) : '',
      attendeeName: appointment.attendeeName ?? '',
      attendeeEmail: appointment.attendeeEmail ?? '',
      attendeePhone: appointment.attendeePhone ?? '',
      locationType: appointment.locationType
        ? (appointment.locationType as BookingLocationType)
        : 'google_meet',
      locationDetails: appointment.locationDetails ?? '',
      notes: appointment.notes ?? '',
      cancelReason: '',
    };
  }

  const baseDate = defaultDate ? new Date(defaultDate) : new Date();
  baseDate.setHours(10, 0, 0, 0);
  const endDefault = new Date(baseDate.getTime() + 60 * 60 * 1000);

  return {
    title: '',
    startsAt: baseDate.toISOString().slice(0, 16),
    endsAt: endDefault.toISOString().slice(0, 16),
    attendeeName: '',
    attendeeEmail: '',
    attendeePhone: '',
    locationType: 'google_meet',
    locationDetails: '',
    notes: '',
    cancelReason: '',
  };
}

export interface AppointmentActionDispatcher {
  create: typeof createAppointmentAction;
  update: typeof updateAppointmentAction;
  cancel: typeof cancelAppointmentAction;
}

/**
 * Handles appointment form submissions across create, edit, and cancel modes.
 */
export async function submitAppointmentForm(
  mode: 'create' | 'edit' | 'cancel',
  appointment: UnifiedCalendarEvent | null | undefined,
  values: AppointmentFormValues,
  dispatchers: AppointmentActionDispatcher = {
    create: createAppointmentAction,
    update: updateAppointmentAction,
    cancel: cancelAppointmentAction,
  },
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    if (mode === 'cancel') {
      if (!appointment) {
        return { success: false, error: 'Appointment not found' };
      }
      const res = await dispatchers.cancel(appointment.id, {
        reason:
          values.cancelReason && values.cancelReason.length > 0 ? values.cancelReason : undefined,
      });
      if (!res.success) {
        return { success: false, error: res.error };
      }
    } else if (mode === 'edit') {
      if (!appointment) {
        return { success: false, error: 'Appointment not found' };
      }
      const res = await dispatchers.update(appointment.id, {
        title: values.title,
        startsAt: new Date(values.startsAt),
        endsAt: new Date(values.endsAt),
        attendeeName: values.attendeeName,
        attendeeEmail: values.attendeeEmail,
        attendeePhone:
          values.attendeePhone && values.attendeePhone.length > 0 ? values.attendeePhone : null,
        locationType: values.locationType,
        locationDetails:
          values.locationDetails && values.locationDetails.length > 0
            ? values.locationDetails
            : null,
        attendeeNotes: values.notes && values.notes.length > 0 ? values.notes : null,
      });
      if (!res.success) {
        return { success: false, error: res.error };
      }
    } else {
      const res = await dispatchers.create({
        title: values.title,
        startsAt: new Date(values.startsAt),
        endsAt: new Date(values.endsAt),
        attendeeName: values.attendeeName,
        attendeeEmail: values.attendeeEmail,
        attendeePhone:
          values.attendeePhone && values.attendeePhone.length > 0
            ? values.attendeePhone
            : undefined,
        locationType: values.locationType,
        locationDetails:
          values.locationDetails && values.locationDetails.length > 0
            ? values.locationDetails
            : undefined,
        attendeeNotes: values.notes && values.notes.length > 0 ? values.notes : undefined,
      });
      if (!res.success) {
        return { success: false, error: res.error };
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Operation failed' };
  }
}

export interface BlockedTimeFormValues {
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  notes?: string;
}

/**
 * Computes initial state for blocked time form modals.
 */
export function getInitialBlockedTimeState(
  blockedTime?: UnifiedCalendarEvent | null,
  mode: 'create' | 'edit' | 'delete' = 'create',
  defaultDate?: string,
): BlockedTimeFormValues {
  if (blockedTime && (mode === 'edit' || mode === 'delete')) {
    return {
      title: blockedTime.title,
      startsAt: blockedTime.startsAt
        ? new Date(blockedTime.startsAt).toISOString().slice(0, 16)
        : '',
      endsAt: blockedTime.endsAt ? new Date(blockedTime.endsAt).toISOString().slice(0, 16) : '',
      allDay: blockedTime.allDay,
      notes: blockedTime.notes ?? '',
    };
  }

  const baseDate = defaultDate ? new Date(defaultDate) : new Date();
  baseDate.setHours(9, 0, 0, 0);
  const endDefault = new Date(baseDate.getTime() + 8 * 60 * 60 * 1000);

  return {
    title: 'Studio Maintenance',
    startsAt: baseDate.toISOString().slice(0, 16),
    endsAt: endDefault.toISOString().slice(0, 16),
    allDay: false,
    notes: '',
  };
}

export interface BlockedTimeActionDispatcher {
  create: typeof createBlockedTimeAction;
  update: typeof updateBlockedTimeAction;
  delete: typeof deleteBlockedTimeAction;
}

/**
 * Handles blocked time form submissions across create, edit, and delete modes.
 */
export async function submitBlockedTimeForm(
  mode: 'create' | 'edit' | 'delete',
  blockedTime: UnifiedCalendarEvent | null | undefined,
  values: BlockedTimeFormValues,
  dispatchers: BlockedTimeActionDispatcher = {
    create: createBlockedTimeAction,
    update: updateBlockedTimeAction,
    delete: deleteBlockedTimeAction,
  },
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    if (mode === 'delete') {
      if (!blockedTime) {
        return { success: false, error: 'Blocked time not found' };
      }
      const res = await dispatchers.delete(blockedTime.id);
      if (!res.success) {
        return { success: false, error: res.error };
      }
    } else if (mode === 'edit') {
      if (!blockedTime) {
        return { success: false, error: 'Blocked time not found' };
      }
      const res = await dispatchers.update(blockedTime.id, {
        title: values.title,
        startsAt: new Date(values.startsAt),
        endsAt: new Date(values.endsAt),
        allDay: values.allDay,
        notes: values.notes && values.notes.length > 0 ? values.notes : null,
      });
      if (!res.success) {
        return { success: false, error: res.error };
      }
    } else {
      const res = await dispatchers.create({
        title: values.title && values.title.length > 0 ? values.title : 'Blocked Time',
        startsAt: new Date(values.startsAt),
        endsAt: new Date(values.endsAt),
        allDay: values.allDay,
        notes: values.notes && values.notes.length > 0 ? values.notes : undefined,
      });
      if (!res.success) {
        return { success: false, error: res.error };
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Operation failed' };
  }
}

/**
 * Finds (row, col) coordinates for a given date string in a month grid.
 */
export function findCellCoordinates(
  grid: MonthGridCell[][],
  dateStr: string,
): { row: number; col: number } {
  let r = 0;
  for (const row of grid) {
    let c = 0;
    for (const cell of row) {
      if (cell.dateString === dateStr) {
        return { row: r, col: c };
      }
      c++;
    }
    r++;
  }
  return { row: 0, col: 0 };
}

/**
 * Reorders localized weekday names according to firstDayOfWeek (0 = Sunday, 1 = Monday).
 */
export function getOrderedWeekdays(names: string[], firstDayOfWeek: number): string[] {
  const ordered: string[] = [];
  for (let i = 0; i < 7; i++) {
    const idx = (firstDayOfWeek + i) % 7;
    ordered.push(names.at(idx) ?? '');
  }
  return ordered;
}

/**
 * Evaluates single-key calendar shortcuts ('m', 'w', 'd', 't').
 */
export function matchCalendarKeyboardShortcut(
  key: string,
  isTargetInput: boolean,
  isModalOpen: boolean,
): 'month' | 'week' | 'day' | 'today' | null {
  if (isTargetInput || isModalOpen) {
    return null;
  }
  const lower = key.toLowerCase();
  switch (lower) {
    case 'm':
      return 'month';
    case 'w':
      return 'week';
    case 'd':
      return 'day';
    case 't':
      return 'today';
    default:
      return null;
  }
}
