import type { AvailableSlot } from '@/server/calendar/availability';
import type {
  PublicBookingActionResult,
  ConfirmedBookingSummary,
} from '@/server/calendar/public-actions';

export const COMMON_TIMEZONES = [
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Europe/Vienna',
  'Europe/Zurich',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'America/Sao_Paulo',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
  'UTC',
] as const;

/**
 * Detects visitor timezone in browser runtime using Intl.DateTimeFormat (AC-1).
 * Falls back safely to 'Europe/Berlin' or 'UTC' if unavailable.
 */
export function detectVisitorTimezone(fallback = 'Europe/Berlin'): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === 'string' && tz.trim().length > 0) {
      return tz;
    }
  } catch {
    // Intl not supported or errored
  }
  return fallback;
}

/**
 * Formats time in HH:MM format for a specific timezone.
 */
export function formatLocalTime(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  }
}

/**
 * Formats a slot start and end time in visitor local time with side-by-side indicator
 * of studio timezone (AC-2).
 * Example: "10:00 - 10:30 (16:00 Berlin)"
 */
export function formatSlotWithStudioTime(
  slot: { startsAtUtc: string; endsAtUtc: string },
  visitorTimezone: string,
  studioTimezone: string,
): {
  visitorTime: string;
  studioTime: string;
  combinedLabel: string;
} {
  const start = new Date(slot.startsAtUtc);
  const end = new Date(slot.endsAtUtc);

  const visitorStart = formatLocalTime(start, visitorTimezone);
  const visitorEnd = formatLocalTime(end, visitorTimezone);
  const visitorTime = `${visitorStart} – ${visitorEnd}`;

  const studioStart = formatLocalTime(start, studioTimezone);
  const studioEnd = formatLocalTime(end, studioTimezone);
  const studioCity = studioTimezone.split('/').pop()?.replace(/_/g, ' ') ?? studioTimezone;
  const studioTime = `${studioStart} – ${studioEnd} ${studioCity}`;

  const isSameTz = visitorTimezone === studioTimezone;
  const combinedLabel = isSameTz ? visitorTime : `${visitorTime} (${studioStart} ${studioCity})`;

  return {
    visitorTime,
    studioTime,
    combinedLabel,
  };
}

/**
 * Groups available slots by their local date string (YYYY-MM-DD).
 */
export function groupSlotsByDate(slots: AvailableSlot[]): Record<string, AvailableSlot[]> {
  const grouped: Record<string, AvailableSlot[]> = {};
  for (const slot of slots) {
    const key = slot.date;
    (grouped[key] ??= []).push(slot);
  }
  return grouped;
}

export interface CalendarDayCell {
  dateStr: string; // 'YYYY-MM-DD'
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  hasSlots: boolean;
  slotsCount: number;
}

/**
 * Generates an accessible calendar month grid of days for slot picking.
 */
export function generateMonthGrid(
  year: number,
  month: number, // 0-indexed (0 = Jan, 11 = Dec)
  availableDates: Set<string>,
  todayStr: string,
): CalendarDayCell[][] {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));

  // Monday = 0, Sunday = 6
  let firstDayOfWeek = firstDay.getUTCDay() - 1;
  if (firstDayOfWeek === -1) firstDayOfWeek = 6;

  const totalDays = lastDay.getUTCDate();
  const cells: CalendarDayCell[] = [];

  // Previous month padding
  const prevMonthLastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const day = prevMonthLastDay - i;
    const prevDate = new Date(Date.UTC(year, month - 1, day));
    const dateStr = prevDate.toISOString().slice(0, 10);
    cells.push({
      dateStr,
      dayNumber: day,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      isPast: dateStr < todayStr,
      hasSlots: availableDates.has(dateStr),
      slotsCount: 0,
    });
  }

  // Current month days
  for (let d = 1; d <= totalDays; d++) {
    const curDate = new Date(Date.UTC(year, month, d));
    const dateStr = curDate.toISOString().slice(0, 10);
    cells.push({
      dateStr,
      dayNumber: d,
      isCurrentMonth: true,
      isToday: dateStr === todayStr,
      isPast: dateStr < todayStr,
      hasSlots: availableDates.has(dateStr),
      slotsCount: 0,
    });
  }

  // Next month padding to fill out 35 or 42 cells (5 or 6 weeks)
  const remaining = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const nextDate = new Date(Date.UTC(year, month + 1, d));
    const dateStr = nextDate.toISOString().slice(0, 10);
    cells.push({
      dateStr,
      dayNumber: d,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      isPast: dateStr < todayStr,
      hasSlots: availableDates.has(dateStr),
      slotsCount: 0,
    });
  }

  // Group into weeks
  const weeks: CalendarDayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  return weeks;
}

/**
 * Returns next year/month pair.
 */
export function getNextMonth(year: number, month: number): { year: number; month: number } {
  if (month === 11) {
    return { year: year + 1, month: 0 };
  }
  return { year, month: month + 1 };
}

/**
 * Returns previous year/month pair.
 */
export function getPrevMonth(year: number, month: number): { year: number; month: number } {
  if (month === 0) {
    return { year: year - 1, month: 11 };
  }
  return { year, month: month - 1 };
}

/**
 * Formats Month and Year for header display (e.g. "October 2026").
 */
export function formatMonthYear(year: number, month: number, locale = 'en'): string {
  const date = new Date(Date.UTC(year, month, 1));
  try {
    return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return `${String(year)}-${String(month + 1).padStart(2, '0')}`;
  }
}

/**
 * Fetches an ALTCHA challenge for public booking (AC-7).
 */
export async function fetchBookingChallenge(
  slug: string,
  signal?: AbortSignal,
): Promise<import('@/app/[locale]/f/_components/pow-solver').AltchaChallenge | null> {
  try {
    const res = await fetch(`/api/public/book/${encodeURIComponent(slug)}/challenge`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal,
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') {
      return null;
    }
    if (
      typeof data.challenge !== 'string' ||
      typeof data.salt !== 'string' ||
      typeof data.signature !== 'string'
    ) {
      return null;
    }

    return data as unknown as import('@/app/[locale]/f/_components/pow-solver').AltchaChallenge;
  } catch {
    return null;
  }
}

/**
 * Quick validation for the public booking attendee form.
 */
export function validateBookingAttendeeForm(
  name: string,
  email: string,
  locale: 'en' | 'de',
): { isValid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!name.trim()) {
    errors.attendeeName = locale === 'de' ? 'Bitte geben Sie Ihren Namen ein' : 'Name is required';
  }
  if (!email.trim() || !email.includes('@')) {
    errors.attendeeEmail =
      locale === 'de'
        ? 'Bitte geben Sie eine gültige E-Mail-Adresse ein'
        : 'Valid email is required';
  }
  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Builds the RFC 5545 ICS generation parameters from confirmed booking summary.
 */
export function buildBookingIcsParams(
  summary: {
    appointmentId: string;
    bookingTypeTitle: string;
    startsAt: string;
    endsAt: string;
    locationType: string;
    meetUrl?: string | null;
    locationDetails?: string | null;
    attendeeName: string;
    attendeeEmail: string;
  },
  studioName: string,
  studioEmail?: string | null,
) {
  const startDate = new Date(summary.startsAt);
  const endDate = new Date(summary.endsAt);

  const locationStr =
    summary.locationType === 'google_meet'
      ? (summary.meetUrl ?? 'Google Meet')
      : (summary.locationDetails ?? (summary.locationType === 'phone' ? 'Phone Call' : studioName));

  const descriptionLines = [
    `Appointment: ${summary.bookingTypeTitle}`,
    `Attendee: ${summary.attendeeName} (${summary.attendeeEmail})`,
    `Studio: ${studioName}`,
  ];

  if (summary.locationType === 'google_meet') {
    descriptionLines.push(
      summary.meetUrl
        ? `Google Meet Link: ${summary.meetUrl}`
        : 'Google Meet video link will be sent prior to the session.',
    );
  } else if (summary.locationDetails) {
    descriptionLines.push(`Location Details: ${summary.locationDetails}`);
  }

  if (studioEmail) {
    descriptionLines.push(`Studio Contact: ${studioEmail}`);
  }

  return {
    uid: summary.appointmentId,
    title: `${summary.bookingTypeTitle}: ${studioName} & ${summary.attendeeName}`,
    description: descriptionLines.join('\n'),
    startsAt: startDate,
    endsAt: endDate,
    location: locationStr,
    attendeeName: summary.attendeeName,
    attendeeEmail: summary.attendeeEmail,
    studioName,
  };
}

/**
 * Resolves localized human-readable location label for booking header.
 */
export function resolveBookingLocationLabel(
  bookingType: {
    locationType: string;
    locationDetails?: string | null;
  },
  t: (key: string) => string,
): string {
  if (bookingType.locationType === 'google_meet') {
    return t('sessionDetails.googleMeet');
  }
  if (bookingType.locationDetails) {
    return bookingType.locationDetails;
  }
  if (bookingType.locationType === 'phone') {
    return t('sessionDetails.phone');
  }
  return t('sessionDetails.inPerson');
}

export interface PublicBookingSubmissionPayload {
  slug: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  attendeeName: string;
  attendeeEmail: string;
  attendeePhone?: string;
  attendeeNotes?: string;
  website_url?: string;
  altcha_payload: string;
  locale: 'en' | 'de';
}

/**
 * Normalizes attendee form inputs into a typed booking submission payload.
 */
export function buildPublicBookingSubmission(params: {
  slug: string;
  slot: AvailableSlot;
  visitorTimezone: string;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  honeypot?: string;
  powPayload: string;
  locale: 'en' | 'de';
}): PublicBookingSubmissionPayload {
  return {
    slug: params.slug,
    startsAt: params.slot.startsAtUtc,
    endsAt: params.slot.endsAtUtc,
    timezone: params.visitorTimezone,
    attendeeName: params.name.trim(),
    attendeeEmail: params.email.trim(),
    attendeePhone: params.phone?.trim() ? params.phone.trim() : undefined,
    attendeeNotes: params.notes?.trim() ? params.notes.trim() : undefined,
    website_url: params.honeypot ?? '',
    altcha_payload: params.powPayload,
    locale: params.locale,
  };
}

export interface ProcessBookingResultOutcome {
  confirmedBooking: ConfirmedBookingSummary | null;
  errorBanner: string | null;
  fieldErrors: Record<string, string>;
  shouldResetSlot: boolean;
  shouldReloadSlots: boolean;
}

/**
 * Evaluates the result of a booking submission action and derives pure UI state changes.
 */
export function processBookingSubmissionResult(
  res: PublicBookingActionResult<ConfirmedBookingSummary>,
  t: (key: string) => string,
): ProcessBookingResultOutcome {
  if (res.success && res.data) {
    return {
      confirmedBooking: res.data,
      errorBanner: null,
      fieldErrors: {},
      shouldResetSlot: false,
      shouldReloadSlots: false,
    };
  }

  if (res.collision) {
    return {
      confirmedBooking: null,
      errorBanner: res.error ?? t('errors.collision'),
      fieldErrors: {},
      shouldResetSlot: true,
      shouldReloadSlots: true,
    };
  }

  if (res.code === 'RATE_LIMITED') {
    return {
      confirmedBooking: null,
      errorBanner: res.error ?? t('errors.rateLimited'),
      fieldErrors: {},
      shouldResetSlot: false,
      shouldReloadSlots: false,
    };
  }

  if (res.fieldErrors) {
    return {
      confirmedBooking: null,
      errorBanner: res.error ?? t('errors.general'),
      fieldErrors: res.fieldErrors,
      shouldResetSlot: false,
      shouldReloadSlots: false,
    };
  }

  return {
    confirmedBooking: null,
    errorBanner: res.error ?? t('errors.general'),
    fieldErrors: {},
    shouldResetSlot: false,
    shouldReloadSlots: false,
  };
}
