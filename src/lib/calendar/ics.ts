import { generateUuidV7 } from '@/lib/id';

export interface GenerateIcsParams {
  uid?: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: Date | string;
  endsAt: Date | string;
  attendeeName?: string | null;
  attendeeEmail?: string | null;
  studioName?: string | null;
}

/**
 * Formats a Date object into UTC iCalendar format (YYYYMMDDTHHMMSSZ).
 */
export function formatIcsUtcDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = String(date.getUTCFullYear());
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hour = pad(date.getUTCHours());
  const minute = pad(date.getUTCMinutes());
  const second = pad(date.getUTCSeconds());
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

/**
 * Escapes characters per RFC 5545 Section 3.3.11.
 * Semicolons, commas, and backslashes must be backslash-escaped.
 * Newlines must be converted to \n.
 */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

/**
 * Generates a valid RFC 5545 single-event iCalendar (.ics) string (AC-11).
 * Uses strict CRLF (\r\n) line endings and standard headers.
 */
export function generateSingleEventIcs(params: GenerateIcsParams): string {
  const start = params.startsAt instanceof Date ? params.startsAt : new Date(params.startsAt);
  const end = params.endsAt instanceof Date ? params.endsAt : new Date(params.endsAt);
  const uid = params.uid ?? generateUuidV7();
  const dtStamp = formatIcsUtcDate(new Date());
  const dtStart = formatIcsUtcDate(start);
  const dtEnd = formatIcsUtcDate(end);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ownlight//Booking Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@ownlight`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(params.title)}`,
  ];

  if (params.description && params.description.trim().length > 0) {
    lines.push(`DESCRIPTION:${escapeIcsText(params.description.trim())}`);
  }

  if (params.location && params.location.trim().length > 0) {
    lines.push(`LOCATION:${escapeIcsText(params.location.trim())}`);
  }

  lines.push('STATUS:CONFIRMED');
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  return lines.join('\r\n') + '\r\n';
}
