import crypto from 'node:crypto';
import type { CalendarFeedSummaryLevel } from '@/server/db/schema/calendar';

/**
 * Generates a high-entropy secret token (32 cryptographically secure random bytes, base64url encoded).
 * ASVS 5.0 V3.1 and Decision D6 compliant.
 */
export function generateFeedToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Computes deterministic SHA-256 hash of the feed token for database storage.
 * Only the hash is ever persisted in calendar_feeds.token_hash (AC-5).
 */
export function hashFeedToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * RFC 5545 §3.1 Line Folding:
 * Lines of text SHOULD NOT be longer than 75 octets, excluding the line break.
 * Long content lines are split into continuation lines starting with a single space.
 * Each line is terminated with strict CRLF (\r\n).
 * Never splits in the middle of a multi-byte UTF-8 character.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const totalBytes = encoder.encode(line).length;
  if (totalBytes <= 75) {
    return `${line}\r\n`;
  }

  const lines: string[] = [];
  let currentLine = '';
  let currentBytes = 0;
  const maxFirstLineBytes = 75;
  const maxContinuationBytes = 74; // 1 space (1 byte) + 74 bytes content = 75 bytes

  let isFirstLine = true;

  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    const maxBytes = isFirstLine ? maxFirstLineBytes : maxContinuationBytes;

    if (currentBytes + charBytes > maxBytes) {
      if (isFirstLine) {
        lines.push(currentLine);
        isFirstLine = false;
      } else {
        lines.push(` ${currentLine}`);
      }
      currentLine = char;
      currentBytes = charBytes;
    } else {
      currentLine += char;
      currentBytes += charBytes;
    }
  }

  if (currentLine.length > 0) {
    lines.push(` ${currentLine}`);
  }

  return `${lines.join('\r\n')}\r\n`;
}

/**
 * RFC 5545 §3.3.11 TEXT Property Escaping:
 * Backslashes, semicolons, commas, and newlines must be escaped.
 */
export function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Formats a Date object to RFC 5545 UTC timestamp format: YYYYMMDDTHHMMSSZ.
 */
export function formatUtcDateTime(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = date.getUTCFullYear().toString();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Formats a Date object to RFC 5545 DATE-only format: YYYYMMDD.
 */
export function formatDateOnly(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = date.getUTCFullYear().toString();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  return `${year}${month}${day}`;
}

/**
 * Sanitizes a client name by masking the surname to its initial (e.g. "Clara Schumann" -> "Clara S.").
 * Preserves compound first names or couples (e.g. "Emma & Liam Watson" -> "Emma & Liam W.").
 */
export function maskSurname(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;

  const parts = trimmed.split(/\s+/);
  if (parts.length <= 1) {
    return trimmed;
  }

  const lastIndex = parts.length - 1;
  const surname = parts[lastIndex];
  if (!surname) return trimmed;

  const initial = surname.charAt(0).toUpperCase();
  if (!initial) return trimmed;

  const prefix = parts.slice(0, lastIndex);
  return [...prefix, `${initial}.`].join(' ');
}

/**
 * Masks the client surname in an event title, preserving any prefix (e.g. "Consultation: Clara Schumann" -> "Consultation: Clara S.").
 */
export function maskSummaryTitle(title: string): string {
  if (!title) return '';
  const colonIndex = title.indexOf(':');
  if (colonIndex !== -1) {
    const prefix = title.slice(0, colonIndex).trim();
    const namePart = title.slice(colonIndex + 1).trim();
    if (namePart) {
      return `${prefix}: ${maskSurname(namePart)}`;
    }
    return prefix;
  }
  return title;
}

/**
 * Calculates the standard feed window [-30 days, +180 days] from reference date.
 */
export function getCalendarFeedDateWindow(referenceDate: Date = new Date()): {
  startDate: Date;
  endDate: Date;
} {
  const startDate = new Date(referenceDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  const endDate = new Date(referenceDate.getTime() + 180 * 24 * 60 * 60 * 1000);
  return { startDate, endDate };
}

export interface IcalEvent {
  uid: string;
  dtstamp: Date;
  startsAt: Date;
  endsAt: Date;
  allDay?: boolean;
  summary: string;
  description?: string;
  location?: string;
  status?: 'CONFIRMED' | 'CANCELLED' | 'BUSY';
}

export interface ShootSourceData {
  id: string;
  title: string;
  projectTitle?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  timezone?: string;
  locationName?: string | null;
  notes?: string | null;
}

export interface AppointmentSourceData {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  timezone?: string;
  status: string;
  attendeeName: string;
  attendeeEmail: string;
  attendeePhone?: string | null;
  locationType: string;
  locationDetails?: string | null;
  meetUrl?: string | null;
  notes?: string | null;
}

export interface BlockedTimeSourceData {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay?: boolean;
  notes?: string | null;
}

/**
 * Builds an RFC 5545 VEVENT representation of a shoot session.
 */
export function buildShootEvent(
  shoot: ShootSourceData,
  summaryLevel: CalendarFeedSummaryLevel,
  dtstamp: Date = new Date(),
): IcalEvent {
  const endsAt = shoot.endsAt ?? new Date(shoot.startsAt.getTime() + 60 * 60 * 1000);

  if (summaryLevel === 'minimal') {
    return {
      uid: `${shoot.id}@ownlight`,
      dtstamp,
      startsAt: shoot.startsAt,
      endsAt,
      allDay: false,
      summary: 'Busy',
      status: 'BUSY',
    };
  }

  let summary: string;
  if (summaryLevel === 'standard') {
    if (shoot.projectTitle) {
      const shootPrefix =
        shoot.title && shoot.title.toLowerCase() !== 'shoot' ? shoot.title : 'Shoot';
      summary = `${shootPrefix}: ${maskSurname(shoot.projectTitle)}`;
    } else {
      summary = maskSummaryTitle(shoot.title);
    }
  } else {
    // Full summary level
    summary = shoot.projectTitle ? `${shoot.projectTitle}: ${shoot.title}` : shoot.title;
  }

  const location = shoot.locationName ?? undefined;
  const description = summaryLevel === 'full' && shoot.notes ? shoot.notes : undefined;

  return {
    uid: `${shoot.id}@ownlight`,
    dtstamp,
    startsAt: shoot.startsAt,
    endsAt,
    allDay: false,
    summary,
    location,
    description,
    status: 'CONFIRMED',
  };
}

/**
 * Builds an RFC 5545 VEVENT representation of a consultation or meeting appointment.
 */
export function buildAppointmentEvent(
  appt: AppointmentSourceData,
  summaryLevel: CalendarFeedSummaryLevel,
  dtstamp: Date = new Date(),
): IcalEvent {
  if (summaryLevel === 'minimal') {
    return {
      uid: `${appt.id}@ownlight`,
      dtstamp,
      startsAt: appt.startsAt,
      endsAt: appt.endsAt,
      allDay: false,
      summary: 'Busy',
      status: 'BUSY',
    };
  }

  let summary: string;
  if (summaryLevel === 'standard') {
    if (appt.title) {
      summary = maskSummaryTitle(appt.title);
    } else {
      summary = `Appointment: ${maskSurname(appt.attendeeName)}`;
    }
  } else {
    summary = appt.title || `Appointment: ${appt.attendeeName}`;
  }

  let location: string | undefined;
  if (appt.meetUrl) {
    location = appt.meetUrl;
  } else if (appt.locationDetails) {
    location = appt.locationDetails;
  } else if (appt.locationType === 'google_meet') {
    location = 'Google Meet';
  } else if (appt.locationType === 'phone') {
    location = 'Phone Call';
  }

  let description: string | undefined;
  if (summaryLevel === 'full') {
    const parts: string[] = [];
    if (appt.attendeeName) parts.push(`Attendee: ${appt.attendeeName}`);
    if (appt.attendeeEmail) parts.push(`Email: ${appt.attendeeEmail}`);
    if (appt.attendeePhone) parts.push(`Phone: ${appt.attendeePhone}`);
    if (appt.meetUrl) parts.push(`Meeting URL: ${appt.meetUrl}`);
    if (appt.notes) parts.push(`Notes: ${appt.notes}`);
    if (parts.length > 0) {
      description = parts.join('\n');
    }
  } else {
    // Strictly no attendee notes or phone numbers (AC-2)
    if (appt.meetUrl) {
      description = `Meeting URL: ${appt.meetUrl}`;
    }
  }

  return {
    uid: `${appt.id}@ownlight`,
    dtstamp,
    startsAt: appt.startsAt,
    endsAt: appt.endsAt,
    allDay: false,
    summary,
    location,
    description,
    status: appt.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
  };
}

/**
 * Builds an RFC 5545 VEVENT representation of a blocked time / studio blackout interval.
 */
export function buildBlockedTimeEvent(
  blocked: BlockedTimeSourceData,
  summaryLevel: CalendarFeedSummaryLevel,
  dtstamp: Date = new Date(),
): IcalEvent {
  if (summaryLevel === 'minimal') {
    return {
      uid: `${blocked.id}@ownlight`,
      dtstamp,
      startsAt: blocked.startsAt,
      endsAt: blocked.endsAt,
      allDay: blocked.allDay,
      summary: 'Busy',
      status: 'BUSY',
    };
  }

  const summary = blocked.title;
  const description = summaryLevel === 'full' && blocked.notes ? blocked.notes : undefined;

  return {
    uid: `${blocked.id}@ownlight`,
    dtstamp,
    startsAt: blocked.startsAt,
    endsAt: blocked.endsAt,
    allDay: blocked.allDay,
    summary,
    description,
    status: 'BUSY',
  };
}

export interface FormatVCalendarOptions {
  feedName?: string;
  timezone?: string;
  events: IcalEvent[];
}

/**
 * Serializes a collection of IcalEvent objects into an RFC 5545 compliant VCALENDAR string.
 * Strictly terminates all lines with CRLF and folds lines exceeding 75 octets.
 */
export function formatVCalendar(options: FormatVCalendarOptions): string {
  const feedName = options.feedName ?? 'Studio Calendar';
  const timezone = options.timezone ?? 'Europe/Berlin';

  let buffer = '';

  buffer += foldLine('BEGIN:VCALENDAR');
  buffer += foldLine('VERSION:2.0');
  buffer += foldLine('PRODID:-//Ownlight//Studio Calendar//EN');
  buffer += foldLine('CALSCALE:GREGORIAN');
  buffer += foldLine('METHOD:PUBLISH');
  buffer += foldLine(`X-WR-CALNAME:${escapeText(feedName)}`);
  buffer += foldLine(`X-WR-TIMEZONE:${escapeText(timezone)}`);

  for (const event of options.events) {
    buffer += foldLine('BEGIN:VEVENT');
    buffer += foldLine(`UID:${event.uid}`);
    buffer += foldLine(`DTSTAMP:${formatUtcDateTime(event.dtstamp)}`);

    if (event.allDay) {
      buffer += foldLine(`DTSTART;VALUE=DATE:${formatDateOnly(event.startsAt)}`);
      // For all-day events, DTEND is exclusive in RFC 5545 (next day date)
      const endDate = new Date(event.endsAt);
      if (formatDateOnly(event.startsAt) === formatDateOnly(event.endsAt)) {
        endDate.setUTCDate(endDate.getUTCDate() + 1);
      }
      buffer += foldLine(`DTEND;VALUE=DATE:${formatDateOnly(endDate)}`);
    } else {
      buffer += foldLine(`DTSTART:${formatUtcDateTime(event.startsAt)}`);
      buffer += foldLine(`DTEND:${formatUtcDateTime(event.endsAt)}`);
    }

    buffer += foldLine(`SUMMARY:${escapeText(event.summary)}`);

    if (event.location) {
      buffer += foldLine(`LOCATION:${escapeText(event.location)}`);
    }

    if (event.description) {
      buffer += foldLine(`DESCRIPTION:${escapeText(event.description)}`);
    }

    buffer += foldLine(`STATUS:${event.status ?? 'CONFIRMED'}`);
    buffer += foldLine('END:VEVENT');
  }

  buffer += foldLine('END:VCALENDAR');

  return buffer;
}
