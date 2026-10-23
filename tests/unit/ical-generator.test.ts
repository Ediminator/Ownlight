import { describe, it, expect } from 'vitest';
import {
  foldLine,
  escapeText,
  formatUtcDateTime,
  formatDateOnly,
  maskSurname,
  maskSummaryTitle,
  generateFeedToken,
  hashFeedToken,
  formatVCalendar,
  buildShootEvent,
  buildAppointmentEvent,
  buildBlockedTimeEvent,
  getCalendarFeedDateWindow,
} from '@/server/calendar/ical';
import enMessages from '../../messages/en.json';
import deMessages from '../../messages/de.json';

describe('TASK-0045: RFC 5545 iCal Generator Unit Tests', () => {
  // AC-1: Strict CRLF line endings and line folding at 75 octets
  describe('AC-1: RFC 5545 Line Folding and CRLF', () => {
    it('AC-1: foldLine keeps short lines under 75 octets untouched except CRLF termination', () => {
      const line = 'SUMMARY:Discovery Call with Emma';
      const folded = foldLine(line);
      expect(folded).toBe(`${line}\r\n`);
      expect(folded.endsWith('\r\n')).toBe(true);
    });

    it('AC-1: foldLine strictly folds lines longer than 75 octets per RFC 5545 §3.1', () => {
      // 80 ASCII characters
      const longText = 'DESCRIPTION:' + 'A'.repeat(80);
      const folded = foldLine(longText);

      // Must be terminated with CRLF
      expect(folded.endsWith('\r\n')).toBe(true);

      // Split by CRLF (ignoring trailing empty split)
      const lines = folded.split('\r\n').filter((l) => l.length > 0);
      expect(lines.length).toBeGreaterThan(1);

      // First line must be <= 75 octets
      const firstLine = lines[0] ?? '';
      expect(Buffer.byteLength(firstLine, 'utf8')).toBeLessThanOrEqual(75);

      // Continuation lines must start with space and be <= 75 octets
      for (const continuation of lines.slice(1)) {
        expect(continuation.startsWith(' ')).toBe(true);
        expect(Buffer.byteLength(continuation, 'utf8')).toBeLessThanOrEqual(75);
      }
    });

    it('AC-1: foldLine handles multi-byte UTF-8 characters without mid-character byte splits', () => {
      // German umlauts and symbols (each 2 bytes in UTF-8: ä, ö, ü, ß)
      const umlautString =
        'SUMMARY:' +
        'Überraschungskonzert für Gäste mit Käse und süßen Äpfeln und Schweiß'.repeat(2);
      const folded = foldLine(umlautString);

      const lines = folded.split('\r\n').filter((l) => l.length > 0);
      for (const line of lines) {
        expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
      }

      // Reassembling folded line (removing CRLF and following space) must restore original string
      const unfolded = folded.replace(/\r\n /g, '').replace(/\r\n$/, '');
      expect(unfolded).toBe(umlautString);
    });

    it('AC-1: escapeText properly escapes backslashes, semicolons, commas, and newlines', () => {
      const raw =
        'Text with \\backslashes\\, semicolons; commas, and\nnewline with\r\ncarriage return';
      const escaped = escapeText(raw);
      expect(escaped).toBe(
        'Text with \\\\backslashes\\\\\\, semicolons\\; commas\\, and\\nnewline with\\ncarriage return',
      );
    });

    it('AC-1: formatUtcDateTime formats dates in UTC ISO basic YYYYMMDDTHHMMSSZ format', () => {
      const date = new Date('2026-10-23T14:30:00.000Z');
      expect(formatUtcDateTime(date)).toBe('20261023T143000Z');
    });

    it('AC-1: formatDateOnly formats all-day dates in YYYYMMDD format', () => {
      const date = new Date('2026-10-23T00:00:00.000Z');
      expect(formatDateOnly(date)).toBe('20261023');
    });

    it('AC-1: formatVCalendar produces a valid RFC 5545 envelope with CRLF line endings', () => {
      const ical = formatVCalendar({
        feedName: 'Test Studio Feed',
        timezone: 'Europe/Berlin',
        events: [
          {
            uid: 'event-1@ownlight',
            dtstamp: new Date('2026-10-23T12:00:00.000Z'),
            startsAt: new Date('2026-10-23T14:00:00.000Z'),
            endsAt: new Date('2026-10-23T15:00:00.000Z'),
            summary: 'Consultation: Clara S.',
            allDay: false,
          },
        ],
      });

      expect(ical.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(ical.includes('VERSION:2.0\r\n')).toBe(true);
      expect(ical.includes('PRODID:-//Ownlight//Studio Calendar//EN\r\n')).toBe(true);
      expect(ical.includes('X-WR-CALNAME:Test Studio Feed\r\n')).toBe(true);
      expect(ical.includes('BEGIN:VEVENT\r\n')).toBe(true);
      expect(ical.includes('UID:event-1@ownlight\r\n')).toBe(true);
      expect(ical.includes('SUMMARY:Consultation: Clara S.\r\n')).toBe(true);
      expect(ical.includes('END:VEVENT\r\n')).toBe(true);
      expect(ical.endsWith('END:VCALENDAR\r\n')).toBe(true);

      // Verify strict CRLF: no bare \n without \r
      const bareLf = ical.replace(/\r\n/g, '').includes('\n');
      expect(bareLf).toBe(false);
    });
  });

  // AC-2: Standard summary level surname masking and note redaction
  describe('AC-2: Standard Summary Level Privacy Sanitization', () => {
    it('AC-2: maskSurname sanitizes single client surname to initial', () => {
      expect(maskSurname('Clara Schumann')).toBe('Clara S.');
      expect(maskSurname('Emma Watson')).toBe('Emma W.');
      expect(maskSurname('John')).toBe('John');
      expect(maskSurname('John Doe Smith')).toBe('John Doe S.');
    });

    it('AC-2: maskSurname handles couples and multiple names', () => {
      expect(maskSurname('Emma & Liam Watson')).toBe('Emma & Liam W.');
      expect(maskSurname('Anna-Maria Schmidt')).toBe('Anna-Maria S.');
    });

    it('AC-2: maskSummaryTitle preserves event prefix while masking client surname', () => {
      expect(maskSummaryTitle('Consultation: Clara Schumann')).toBe('Consultation: Clara S.');
      expect(maskSummaryTitle('Shoot: Emma & Liam Watson')).toBe('Shoot: Emma & Liam W.');
      expect(maskSummaryTitle('Wedding Session')).toBe('Wedding Session');
    });

    it('AC-2: buildAppointmentEvent in standard mode masks surname and redacts notes & phone', () => {
      const appt = {
        id: '01920000-0000-7000-8000-000000000001',
        title: 'Consultation: Emma Watson',
        startsAt: new Date('2026-10-25T10:00:00.000Z'),
        endsAt: new Date('2026-10-25T11:00:00.000Z'),
        timezone: 'Europe/Berlin',
        status: 'scheduled',
        attendeeName: 'Emma Watson',
        attendeeEmail: 'emma@example.org',
        attendeePhone: '+49 170 1234567',
        locationType: 'phone',
        locationDetails: 'Phone Consultation',
        meetUrl: null,
        notes: 'Private internal notes about client budget and personal preferences',
      };

      const event = buildAppointmentEvent(appt, 'standard', new Date('2026-10-23T12:00:00.000Z'));
      expect(event.summary).toBe('Consultation: Emma W.');
      // Strictly omit notes and phone number
      expect(event.description ?? '').not.toContain('budget');
      expect(event.description ?? '').not.toContain('+49 170 1234567');
      expect(event.description ?? '').not.toContain('emma@example.org');
    });

    it('AC-2: buildShootEvent in standard mode masks surname and excludes internal notes', () => {
      const shoot = {
        id: '01920000-0000-7000-8000-000000000002',
        title: 'Shoot',
        projectTitle: 'Emma & Liam Watson',
        startsAt: new Date('2026-10-26T14:00:00.000Z'),
        endsAt: new Date('2026-10-26T17:00:00.000Z'),
        timezone: 'Europe/Berlin',
        locationName: 'Botanical Gardens, Munich',
        notes: 'Secret access gate code: 1234. VIP client.',
      };

      const event = buildShootEvent(shoot, 'standard', new Date('2026-10-23T12:00:00.000Z'));
      expect(event.summary).toBe('Shoot: Emma & Liam W.');
      expect(event.location).toBe('Botanical Gardens, Munich');
      // Notes must be strictly omitted
      expect(event.description ?? '').not.toContain('Secret access gate code');
    });

    it('AC-2: buildBlockedTimeEvent in standard mode preserves title but redacts internal notes', () => {
      const blocked = {
        id: '01920000-0000-7000-8000-000000000003',
        title: 'Studio Maintenance',
        startsAt: new Date('2026-10-27T08:00:00.000Z'),
        endsAt: new Date('2026-10-27T12:00:00.000Z'),
        allDay: false,
        notes: 'Electrician coming to fix studio main panel.',
      };

      const event = buildBlockedTimeEvent(
        blocked,
        'standard',
        new Date('2026-10-23T12:00:00.000Z'),
      );
      expect(event.summary).toBe('Studio Maintenance');
      expect(event.description ?? '').not.toContain('Electrician');
    });
  });

  // AC-3: Minimal summary level displays SUMMARY:Busy and zeroes identifiers
  describe('AC-3: Minimal Summary Level Privacy Sanitization', () => {
    it('AC-3: buildAppointmentEvent in minimal mode sets SUMMARY:Busy and clears location/description', () => {
      const appt = {
        id: '01920000-0000-7000-8000-000000000001',
        title: 'Consultation: Emma Watson',
        startsAt: new Date('2026-10-25T10:00:00.000Z'),
        endsAt: new Date('2026-10-25T11:00:00.000Z'),
        timezone: 'Europe/Berlin',
        status: 'scheduled',
        attendeeName: 'Emma Watson',
        attendeeEmail: 'emma@example.org',
        attendeePhone: '+49 170 1234567',
        locationType: 'in_person',
        locationDetails: 'Studio Address, Berlin',
        meetUrl: null,
        notes: 'Confidential client notes',
      };

      const event = buildAppointmentEvent(appt, 'minimal', new Date('2026-10-23T12:00:00.000Z'));
      expect(event.summary).toBe('Busy');
      expect(event.location).toBeUndefined();
      expect(event.description).toBeUndefined();
    });

    it('AC-3: buildShootEvent in minimal mode sets SUMMARY:Busy and clears location/description', () => {
      const shoot = {
        id: '01920000-0000-7000-8000-000000000002',
        title: 'Wedding Shoot',
        projectTitle: 'Emma & Liam Watson',
        startsAt: new Date('2026-10-26T14:00:00.000Z'),
        endsAt: new Date('2026-10-26T17:00:00.000Z'),
        timezone: 'Europe/Berlin',
        locationName: 'Grand Hotel Ballroom',
        notes: 'Gate access notes',
      };

      const event = buildShootEvent(shoot, 'minimal', new Date('2026-10-23T12:00:00.000Z'));
      expect(event.summary).toBe('Busy');
      expect(event.location).toBeUndefined();
      expect(event.description).toBeUndefined();
    });

    it('AC-3: buildBlockedTimeEvent in minimal mode sets SUMMARY:Busy and clears description', () => {
      const blocked = {
        id: '01920000-0000-7000-8000-000000000003',
        title: 'Doctor Appointment',
        startsAt: new Date('2026-10-27T08:00:00.000Z'),
        endsAt: new Date('2026-10-27T12:00:00.000Z'),
        allDay: false,
        notes: 'Medical details',
      };

      const event = buildBlockedTimeEvent(blocked, 'minimal', new Date('2026-10-23T12:00:00.000Z'));
      expect(event.summary).toBe('Busy');
      expect(event.description).toBeUndefined();
    });
  });

  // Full summary level tests
  describe('Full Summary Level Details', () => {
    it('buildAppointmentEvent in full mode includes unmasked attendee, contact details, notes and meetUrl', () => {
      const appt = {
        id: '01920000-0000-7000-8000-000000000001',
        title: 'Consultation: Emma Watson',
        startsAt: new Date('2026-10-25T10:00:00.000Z'),
        endsAt: new Date('2026-10-25T11:00:00.000Z'),
        timezone: 'Europe/Berlin',
        status: 'cancelled',
        attendeeName: 'Emma Watson',
        attendeeEmail: 'emma@example.org',
        attendeePhone: '+49 170 1234567',
        locationType: 'google_meet',
        locationDetails: null,
        meetUrl: 'https://meet.google.com/abc-defg-hij',
        notes: 'Requested wedding package pricing',
      };

      const event = buildAppointmentEvent(appt, 'full', new Date('2026-10-23T12:00:00.000Z'));
      expect(event.summary).toBe('Consultation: Emma Watson');
      expect(event.location).toBe('https://meet.google.com/abc-defg-hij');
      expect(event.status).toBe('CANCELLED');
      expect(event.description).toContain('Attendee: Emma Watson');
      expect(event.description).toContain('Email: emma@example.org');
      expect(event.description).toContain('Phone: +49 170 1234567');
      expect(event.description).toContain('Meeting URL: https://meet.google.com/abc-defg-hij');
      expect(event.description).toContain('Notes: Requested wedding package pricing');
    });

    it('buildShootEvent in full mode includes full project title, shoot title, and shoot notes', () => {
      const shoot = {
        id: '01920000-0000-7000-8000-000000000002',
        title: 'Golden Hour Session',
        projectTitle: 'Emma & Liam Watson',
        startsAt: new Date('2026-10-26T16:00:00.000Z'),
        endsAt: new Date('2026-10-26T18:00:00.000Z'),
        timezone: 'Europe/Berlin',
        locationName: 'Englischer Garten, Munich',
        notes: 'Bring reflector and 85mm prime lens',
      };

      const event = buildShootEvent(shoot, 'full', new Date('2026-10-23T12:00:00.000Z'));
      expect(event.summary).toBe('Emma & Liam Watson: Golden Hour Session');
      expect(event.location).toBe('Englischer Garten, Munich');
      expect(event.description).toBe('Bring reflector and 85mm prime lens');
    });

    it('buildBlockedTimeEvent in full mode includes title and notes', () => {
      const blocked = {
        id: '01920000-0000-7000-8000-000000000003',
        title: 'Studio Renovation',
        startsAt: new Date('2026-10-27T08:00:00.000Z'),
        endsAt: new Date('2026-10-27T17:00:00.000Z'),
        allDay: true,
        notes: 'Painting the cyclorama wall',
      };

      const event = buildBlockedTimeEvent(blocked, 'full', new Date('2026-10-23T12:00:00.000Z'));
      expect(event.summary).toBe('Studio Renovation');
      expect(event.description).toBe('Painting the cyclorama wall');
      expect(event.allDay).toBe(true);
    });

    it('buildAppointmentEvent handles meetUrl in standard mode', () => {
      const appt = {
        id: '01920000-0000-7000-8000-000000000004',
        title: '',
        startsAt: new Date('2026-10-25T10:00:00.000Z'),
        endsAt: new Date('2026-10-25T11:00:00.000Z'),
        status: 'scheduled',
        attendeeName: 'Emma Watson',
        attendeeEmail: 'emma@example.org',
        locationType: 'google_meet',
        meetUrl: 'https://meet.google.com/abc-defg-hij',
      };

      const event = buildAppointmentEvent(appt, 'standard', new Date('2026-10-23T12:00:00.000Z'));
      expect(event.summary).toBe('Appointment: Emma W.');
      expect(event.location).toBe('https://meet.google.com/abc-defg-hij');
      expect(event.description).toBe('Meeting URL: https://meet.google.com/abc-defg-hij');
    });

    it('buildAppointmentEvent handles google_meet without meetUrl and in_person locations', () => {
      const apptMeet = {
        id: '01920000-0000-7000-8000-000000000005',
        title: 'Online Consultation',
        startsAt: new Date('2026-10-25T10:00:00.000Z'),
        endsAt: new Date('2026-10-25T11:00:00.000Z'),
        status: 'scheduled',
        attendeeName: 'Emma Watson',
        attendeeEmail: 'emma@example.org',
        locationType: 'google_meet',
      };
      const eventMeet = buildAppointmentEvent(apptMeet, 'standard');
      expect(eventMeet.location).toBe('Google Meet');

      const apptInPerson = {
        id: '01920000-0000-7000-8000-000000000006',
        title: 'Studio Tour',
        startsAt: new Date('2026-10-25T10:00:00.000Z'),
        endsAt: new Date('2026-10-25T11:00:00.000Z'),
        status: 'scheduled',
        attendeeName: 'Emma Watson',
        attendeeEmail: 'emma@example.org',
        locationType: 'in_person',
        locationDetails: 'Studio Room B',
      };
      const eventInPerson = buildAppointmentEvent(apptInPerson, 'standard');
      expect(eventInPerson.location).toBe('Studio Room B');

      const apptPhone = {
        id: '01920000-0000-7000-8000-000000000008',
        title: 'Phone Consultation',
        startsAt: new Date('2026-10-25T10:00:00.000Z'),
        endsAt: new Date('2026-10-25T11:00:00.000Z'),
        status: 'scheduled',
        attendeeName: 'Emma Watson',
        attendeeEmail: 'emma@example.org',
        locationType: 'phone',
      };
      const eventPhone = buildAppointmentEvent(apptPhone, 'standard');
      expect(eventPhone.location).toBe('Phone Call');
    });

    it('formatVCalendar formats all-day events correctly with exclusive next-day DTEND', () => {
      const ical = formatVCalendar({
        events: [
          {
            uid: 'allday-1@ownlight',
            dtstamp: new Date('2026-10-23T12:00:00.000Z'),
            startsAt: new Date('2026-10-24T00:00:00.000Z'),
            endsAt: new Date('2026-10-24T23:59:59.000Z'),
            summary: 'All Day Studio Blackout',
            allDay: true,
            description: 'Renovation work',
            location: 'Studio Main Floor',
          },
        ],
      });

      expect(ical).toContain('DTSTART;VALUE=DATE:20261024\r\n');
      expect(ical).toContain('DTEND;VALUE=DATE:20261025\r\n');
      expect(ical).toContain('LOCATION:Studio Main Floor\r\n');
      expect(ical).toContain('DESCRIPTION:Renovation work\r\n');
    });

    it('handles shoot with shoot.title without projectTitle', () => {
      const shoot = {
        id: '01920000-0000-7000-8000-000000000007',
        title: 'Special Portrait Session: John Doe',
        startsAt: new Date('2026-10-26T16:00:00.000Z'),
      };
      const event = buildShootEvent(shoot, 'standard');
      expect(event.summary).toBe('Special Portrait Session: John D.');

      const fullEvent = buildShootEvent(shoot, 'full');
      expect(fullEvent.summary).toBe('Special Portrait Session: John Doe');
    });

    it('handles empty names and edge cases gracefully', () => {
      expect(maskSurname('')).toBe('');
      expect(maskSummaryTitle('')).toBe('');
      expect(maskSummaryTitle('Prefix:')).toBe('Prefix');
    });
  });

  // AC-5: SHA-256 Token Generation and Hashing
  describe('AC-5: Token Generation and Hashing', () => {
    it('AC-5: generateFeedToken generates a 32-byte base64url high-entropy string', () => {
      const token1 = generateFeedToken();
      const token2 = generateFeedToken();

      expect(typeof token1).toBe('string');
      // 32 bytes base64url is 43 characters
      expect(token1.length).toBe(43);
      expect(token1).not.toBe(token2);
      expect(/^[A-Za-z0-9_-]+$/.test(token1)).toBe(true);
    });

    it('AC-5: hashFeedToken generates a deterministic 64-character hex SHA-256 hash', () => {
      const syntheticTokenValue = 'synthetic-test-token-feed-1234567890';
      const hash1 = hashFeedToken(syntheticTokenValue);
      const hash2 = hashFeedToken(syntheticTokenValue);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
      expect(/^[a-f0-9]{64}$/.test(hash1)).toBe(true);

      // Verify different tokens yield different hashes
      const hashOther = hashFeedToken('synthetic-test-token-feed-0987654321');
      expect(hash1).not.toBe(hashOther);
    });
  });

  // Date window [-30 days, +180 days]
  describe('Date Window Range [-30 days, +180 days]', () => {
    it('computes correct startDate and endDate window relative to reference date', () => {
      const ref = new Date('2026-10-23T12:00:00.000Z');
      const { startDate, endDate } = getCalendarFeedDateWindow(ref);

      // 30 days before ref
      const expectedStart = new Date(ref.getTime() - 30 * 24 * 60 * 60 * 1000);
      // 180 days after ref
      const expectedEnd = new Date(ref.getTime() + 180 * 24 * 60 * 60 * 1000);

      expect(startDate.getTime()).toBe(expectedStart.getTime());
      expect(endDate.getTime()).toBe(expectedEnd.getTime());
    });
  });

  // AC-9: Translation parity
  describe('AC-9: Localization Parity for Calendar Feed Strings', () => {
    it('AC-9: verifies all calendar feed keys exist identically in en.json and de.json', () => {
      const enSettings = (enMessages as { settings?: { calendarFeed?: Record<string, unknown> } })
        .settings;
      const deSettings = (deMessages as { settings?: { calendarFeed?: Record<string, unknown> } })
        .settings;

      expect(enSettings).toBeDefined();
      expect(deSettings).toBeDefined();

      const enCalendarFeed = enSettings?.calendarFeed;
      const deCalendarFeed = deSettings?.calendarFeed;

      expect(enCalendarFeed).toBeDefined();
      expect(deCalendarFeed).toBeDefined();

      const enKeys = Object.keys(enCalendarFeed ?? {}).sort();
      const deKeys = Object.keys(deCalendarFeed ?? {}).sort();

      expect(enKeys).toEqual(deKeys);
      expect(enKeys.length).toBeGreaterThan(5);
    });

    it('I1-U02 regression: urlSection.copyError translation exists in en.json and de.json', () => {
      const enUrlSection = (
        enMessages as {
          settings?: { calendarFeed?: { urlSection?: { copyError?: string } } };
        }
      ).settings?.calendarFeed?.urlSection;
      const deUrlSection = (
        deMessages as {
          settings?: { calendarFeed?: { urlSection?: { copyError?: string } } };
        }
      ).settings?.calendarFeed?.urlSection;

      expect(enUrlSection?.copyError).toBe('Failed to copy URL');
      expect(deUrlSection?.copyError).toBe('Fehler beim Kopieren der URL');
    });
  });
});
