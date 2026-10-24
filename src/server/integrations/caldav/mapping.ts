import 'server-only';
import {
  formatUtcDateTime,
  formatDateOnly,
  escapeText,
  foldLine,
  maskSurname,
  maskSummaryTitle,
} from '@/server/calendar/ical';

export interface FormatCaldavSummaryParams {
  studioName: string;
  entityType: 'appointment' | 'shoot' | 'blocked_time';
  title?: string;
  attendeeName?: string;
  projectTitle?: string;
}

/**
 * Formats calendar event summary according to PII minimization guidelines (AC-3, Decision D6).
 * Masks client surnames to First Name + Last Initial.
 */
export function formatCaldavSummary(params: FormatCaldavSummaryParams): string {
  const prefix = params.studioName ? `${params.studioName} - ` : '';

  if (params.entityType === 'appointment') {
    if (params.title) {
      const masked = maskSummaryTitle(params.title);
      return `${prefix}${masked}`;
    }
    const maskedName = params.attendeeName ? maskSurname(params.attendeeName) : 'Client';
    return `${prefix}Consultation: ${maskedName}`;
  }

  if (params.entityType === 'shoot') {
    if (params.projectTitle) {
      const shootTitle = params.title ?? 'Shoot';
      const maskedProject = maskSurname(params.projectTitle);
      return `${prefix}${shootTitle}: ${maskedProject}`;
    }
    return `${prefix}${maskSummaryTitle(params.title ?? 'Shoot')}`;
  }

  // Blocked time
  return `${prefix}Blocked: ${params.title ?? 'Studio Time'}`;
}

export interface CaldavEventInput {
  studioName: string;
  entityType: 'appointment' | 'shoot' | 'blocked_time';
  entity: {
    id: string;
    title?: string;
    startsAt: Date;
    endsAt?: Date | null;
    allDay?: boolean;
    locationType?: string;
    locationDetails?: string | null;
    locationName?: string | null;
    meetUrl?: string | null;
    attendeeName?: string;
    projectTitle?: string | null;
    status?: string;
  };
}

export interface FormattedCaldavEvent {
  filename: string;
  icalString: string;
  uid: string;
  summary: string;
}

/**
 * Serializes an appointment, shoot, or blocked time into an RFC 5545 VCALENDAR containing a single VEVENT.
 * Omits private shoot notes, client phone numbers, and internal consultation notes (AC-3).
 */
export function formatCaldavEvent(input: CaldavEventInput): FormattedCaldavEvent {
  const { studioName, entityType, entity } = input;
  const uid = `${entity.id}@ownlight`;
  const filename = `${entity.id}.ics`;

  const endsAt = entity.endsAt ?? new Date(entity.startsAt.getTime() + 60 * 60 * 1000);
  const summary = formatCaldavSummary({
    studioName,
    entityType,
    title: entity.title,
    attendeeName: entity.attendeeName,
    projectTitle: entity.projectTitle ?? undefined,
  });

  let location: string | undefined;
  if (entity.meetUrl) {
    location = entity.meetUrl;
  } else if (entity.locationDetails) {
    location = entity.locationDetails;
  } else if (entity.locationName) {
    location = entity.locationName;
  }

  let status = 'CONFIRMED';
  if (entity.status === 'cancelled') {
    status = 'CANCELLED';
  } else if (entityType === 'blocked_time') {
    status = 'BUSY';
  }

  const dtstamp = new Date();
  let buffer = '';

  buffer += foldLine('BEGIN:VCALENDAR');
  buffer += foldLine('VERSION:2.0');
  buffer += foldLine('PRODID:-//Ownlight//CalDAV Sync//EN');
  buffer += foldLine('CALSCALE:GREGORIAN');
  buffer += foldLine('METHOD:PUBLISH');

  buffer += foldLine('BEGIN:VEVENT');
  buffer += foldLine(`UID:${uid}`);
  buffer += foldLine(`DTSTAMP:${formatUtcDateTime(dtstamp)}`);

  if (entity.allDay) {
    buffer += foldLine(`DTSTART;VALUE=DATE:${formatDateOnly(entity.startsAt)}`);
    const nextDay = new Date(endsAt);
    if (formatDateOnly(entity.startsAt) === formatDateOnly(endsAt)) {
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    }
    buffer += foldLine(`DTEND;VALUE=DATE:${formatDateOnly(nextDay)}`);
  } else {
    buffer += foldLine(`DTSTART:${formatUtcDateTime(entity.startsAt)}`);
    buffer += foldLine(`DTEND:${formatUtcDateTime(endsAt)}`);
  }

  buffer += foldLine(`SUMMARY:${escapeText(summary)}`);

  if (location) {
    buffer += foldLine(`LOCATION:${escapeText(location)}`);
  }

  buffer += foldLine(`STATUS:${status}`);
  buffer += foldLine('END:VEVENT');
  buffer += foldLine('END:VCALENDAR');

  return {
    filename,
    icalString: buffer,
    uid,
    summary,
  };
}

/**
 * Parses an ISO or iCal date string (YYYYMMDDTHHMMSSZ or YYYYMMDD) into a JavaScript Date object.
 */
function parseIcalDateTime(value: string): Date | null {
  const clean = value.replace(/^VALUE=DATE:/i, '').trim();

  // YYYYMMDDTHHMMSSZ
  const utcMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(clean);
  if (utcMatch) {
    const [, y, m, d, h, min, s] = utcMatch;
    return new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s)),
    );
  }

  // YYYYMMDDTHHMMSS (local)
  const localMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(clean);
  if (localMatch) {
    const [, y, m, d, h, min, s] = localMatch;
    return new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s)),
    );
  }

  // YYYYMMDD (all day)
  const dateMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(clean);
  if (dateMatch) {
    const [, y, m, d] = dateMatch;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
  }

  const parsed = new Date(clean);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

export interface ParsedBusyInterval {
  externalId: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Parses remote CalDAV VCALENDAR/VEVENT strings to extract busy intervals for the availability engine (AC-4).
 */
export function parseCaldavEventToBusyIntervals(icalContent: string): ParsedBusyInterval[] {
  if (!icalContent.includes('BEGIN:VEVENT')) {
    return [];
  }

  // Unfold RFC 5545 lines (CRLF followed by space or tab)
  const unfolded = icalContent.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);

  const intervals: ParsedBusyInterval[] = [];

  let inVevent = false;
  let uid = '';
  let dtstartStr: string | null = null;
  let dtendStr: string | null = null;
  let status = 'CONFIRMED';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      inVevent = true;
      uid = '';
      dtstartStr = null;
      dtendStr = null;
      status = 'CONFIRMED';
      continue;
    }

    if (trimmed === 'END:VEVENT') {
      if (inVevent && dtstartStr && status !== 'CANCELLED') {
        const start = parseIcalDateTime(dtstartStr);
        let end: Date | null = null;

        if (dtendStr) {
          end = parseIcalDateTime(dtendStr);
        } else if (start) {
          end = new Date(start.getTime() + 60 * 60 * 1000);
        }

        if (start && end && end > start) {
          intervals.push({
            externalId: uid || `caldav_${String(start.getTime())}`,
            startsAt: start,
            endsAt: end,
          });
        }
      }
      inVevent = false;
      continue;
    }

    if (!inVevent) continue;

    if (trimmed.startsWith('UID:')) {
      uid = trimmed.slice(4).trim();
    } else if (trimmed.startsWith('DTSTART')) {
      const idx = trimmed.indexOf(':');
      if (idx !== -1) {
        dtstartStr = trimmed.slice(idx + 1).trim();
      }
    } else if (trimmed.startsWith('DTEND')) {
      const idx = trimmed.indexOf(':');
      if (idx !== -1) {
        dtendStr = trimmed.slice(idx + 1).trim();
      }
    } else if (trimmed.startsWith('STATUS:')) {
      status = trimmed.slice(7).trim().toUpperCase();
    }
  }

  return intervals;
}
