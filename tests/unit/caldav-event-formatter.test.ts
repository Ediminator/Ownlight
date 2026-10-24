import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  formatCaldavEvent,
  formatCaldavSummary,
  parseCaldavEventToBusyIntervals,
} from '@/server/integrations/caldav/mapping';

describe('TASK-0047: CalDAV Event Conversion and Formatting (AC-3, AC-4)', () => {
  const baseAppointment = {
    id: '01920000-0000-7000-8000-000000000001',
    title: 'Consultation: Elena Rostova',
    attendeeName: 'Elena Rostova',
    attendeeEmail: 'elena.rostova@example.org',
    attendeePhone: '+49 170 1234567',
    attendeeNotes: 'Discussing wedding album layout and timeline.',
    locationType: 'in_person' as const,
    locationDetails: 'Studio Berlin, Room A',
    meetUrl: null,
    startsAt: new Date('2026-11-10T10:00:00Z'),
    endsAt: new Date('2026-11-10T11:00:00Z'),
    status: 'scheduled' as const,
  };

  it('AC-3: formats appointment event summary with studio name and PII minimization (First Name + Last Initial)', () => {
    const summary = formatCaldavSummary({
      studioName: 'Lumina Studio',
      entityType: 'appointment',
      title: baseAppointment.title,
      attendeeName: baseAppointment.attendeeName,
    });

    expect(summary).toBe('Lumina Studio - Consultation: Elena R.');
    expect(summary).not.toContain('Rostova');
  });

  it('AC-3: formats appointment to valid RFC 5545 VEVENT payload omitting sensitive notes and phone numbers by default', () => {
    const { icalString, filename } = formatCaldavEvent({
      studioName: 'Lumina Studio',
      entityType: 'appointment',
      entity: baseAppointment,
    });

    expect(filename).toBe('01920000-0000-7000-8000-000000000001.ics');
    expect(icalString).toContain('BEGIN:VCALENDAR');
    expect(icalString).toContain('BEGIN:VEVENT');
    expect(icalString).toContain('UID:01920000-0000-7000-8000-000000000001@ownlight');
    expect(icalString).toContain('SUMMARY:Lumina Studio - Consultation: Elena R.');
    expect(icalString).toContain('DTSTART:20261110T100000Z');
    expect(icalString).toContain('DTEND:20261110T110000Z');
    expect(icalString).toContain('LOCATION:Studio Berlin\\, Room A');
    expect(icalString).toContain('STATUS:CONFIRMED');

    // PII protection: attendee phone and internal notes must NOT leak into remote CalDAV payload
    expect(icalString).not.toContain('+49 170 1234567');
    expect(icalString).not.toContain('wedding album layout');
    expect(icalString).toContain('END:VEVENT');
    expect(icalString).toContain('END:VCALENDAR');
  });

  it('AC-3: formats shoot session with parent project and location', () => {
    const shoot = {
      id: '01920000-0000-7000-8000-000000000002',
      title: 'Engagement Shoot',
      projectTitle: 'Sophie & Marc Wedding',
      startsAt: new Date('2026-11-12T14:00:00Z'),
      endsAt: new Date('2026-11-12T16:00:00Z'),
      locationName: 'Tiergarten Berlin',
      notes: 'Bring reflector and 85mm lens',
    };

    const { icalString } = formatCaldavEvent({
      studioName: 'Lumina Studio',
      entityType: 'shoot',
      entity: shoot,
    });

    expect(icalString).toContain('SUMMARY:Lumina Studio - Engagement Shoot: Sophie & Marc W.');
    expect(icalString).toContain('LOCATION:Tiergarten Berlin');
    expect(icalString).not.toContain('85mm lens'); // private shoot notes omitted
  });

  it('AC-3: formats blocked time blackout window as busy interval', () => {
    const blocked = {
      id: '01920000-0000-7000-8000-000000000003',
      title: 'Studio Maintenance',
      startsAt: new Date('2026-11-15T08:00:00Z'),
      endsAt: new Date('2026-11-15T12:00:00Z'),
      allDay: false,
    };

    const { icalString } = formatCaldavEvent({
      studioName: 'Lumina Studio',
      entityType: 'blocked_time',
      entity: blocked,
    });

    expect(icalString).toContain('SUMMARY:Lumina Studio - Blocked: Studio Maintenance');
    expect(icalString).toContain('STATUS:BUSY');
  });

  it('AC-4: parses inbound CalDAV VCALENDAR / VEVENT data into busy intervals', () => {
    const remoteIcal = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Apple Inc.//macOS 14.0//EN',
      'BEGIN:VEVENT',
      'UID:ext-evt-991@icloud.com',
      'DTSTART:20261120T090000Z',
      'DTEND:20261120T103000Z',
      'SUMMARY:Dentist Appointment',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:ext-evt-992@icloud.com',
      'DTSTART:20261120T140000Z',
      'DTEND:20261120T150000Z',
      'SUMMARY:Private Call',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const intervals = parseCaldavEventToBusyIntervals(remoteIcal);
    expect(intervals).toHaveLength(2);

    expect(intervals[0]?.externalId).toBe('ext-evt-991@icloud.com');
    expect(intervals[0]?.startsAt.toISOString()).toBe('2026-11-20T09:00:00.000Z');
    expect(intervals[0]?.endsAt.toISOString()).toBe('2026-11-20T10:30:00.000Z');

    expect(intervals[1]?.externalId).toBe('ext-evt-992@icloud.com');
    expect(intervals[1]?.startsAt.toISOString()).toBe('2026-11-20T14:00:00.000Z');
    expect(intervals[1]?.endsAt.toISOString()).toBe('2026-11-20T15:00:00.000Z');
  });

  it('AC-3: formats event with meetUrl, allDay, and cancelled status', () => {
    const { icalString: meetIcal } = formatCaldavEvent({
      studioName: 'Lumina Studio',
      entityType: 'appointment',
      entity: {
        ...baseAppointment,
        meetUrl: 'https://meet.google.com/abc-defg-hij',
        status: 'cancelled',
      },
    });

    expect(meetIcal).toContain('LOCATION:https://meet.google.com/abc-defg-hij');
    expect(meetIcal).toContain('STATUS:CANCELLED');

    const { icalString: allDayIcal } = formatCaldavEvent({
      studioName: 'Lumina Studio',
      entityType: 'blocked_time',
      entity: {
        id: '01920000-0000-7000-8000-000000000005',
        title: 'Full Day Off',
        startsAt: new Date('2026-12-01T00:00:00Z'),
        endsAt: new Date('2026-12-02T00:00:00Z'),
        allDay: true,
      },
    });

    expect(allDayIcal).toContain('DTSTART;VALUE=DATE:20261201');
    expect(allDayIcal).toContain('DTEND;VALUE=DATE:20261202');
  });

  it('AC-4: handles parser edge cases (empty ical, missing dtend, cancelled event)', () => {
    expect(parseCaldavEventToBusyIntervals('')).toEqual([]);
    expect(parseCaldavEventToBusyIntervals('BEGIN:VCALENDAR\nEND:VCALENDAR')).toEqual([]);

    const singleEventNoEnd = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:no-end-evt@example.org',
      'DTSTART:20261120T100000Z',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:cancelled-evt@example.org',
      'DTSTART:20261120T120000Z',
      'STATUS:CANCELLED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const intervals = parseCaldavEventToBusyIntervals(singleEventNoEnd);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.externalId).toBe('no-end-evt@example.org');
    // Default 1 hour duration
    expect(intervals[0]?.endsAt.toISOString()).toBe('2026-11-20T11:00:00.000Z');
  });

  it('AC-3: handles allDay event starting and ending on same date (bumps nextDay by 1 day)', () => {
    const { icalString } = formatCaldavEvent({
      studioName: 'Lumina Studio',
      entityType: 'blocked_time',
      entity: {
        id: '01920000-0000-7000-8000-000000000006',
        title: 'Single Day Off',
        startsAt: new Date('2026-12-05T08:00:00Z'),
        endsAt: new Date('2026-12-05T18:00:00Z'),
        allDay: true,
      },
    });

    expect(icalString).toContain('DTSTART;VALUE=DATE:20261205');
    expect(icalString).toContain('DTEND;VALUE=DATE:20261206');
  });

  it('AC-4: parses local time format, ISO string fallback, and ignores invalid dates in inbound VEVENT', () => {
    const mixedIcal = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:local-tz-evt@example.org',
      'DTSTART:20261120T100000',
      'DTEND:20261120T110000',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:iso-str-evt@example.org',
      'DTSTART:2026-11-20T14:00:00.000Z',
      'DTEND:2026-11-20T15:00:00.000Z',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:invalid-date-evt@example.org',
      'DTSTART:not-a-valid-date',
      'DTEND:also-invalid',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const intervals = parseCaldavEventToBusyIntervals(mixedIcal);
    expect(intervals).toHaveLength(2);
    expect(intervals[0]?.externalId).toBe('local-tz-evt@example.org');
    expect(intervals[1]?.externalId).toBe('iso-str-evt@example.org');
  });
});
