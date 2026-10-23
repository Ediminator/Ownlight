import { describe, it, expect, vi } from 'vitest';
import {
  publicBookingSubmissionSchema,
  getPublicAvailableSlotsSchema,
} from '@/server/calendar/schema';
import { generateSingleEventIcs, formatIcsUtcDate, escapeIcsText } from '@/lib/calendar/ics';
import {
  detectVisitorTimezone,
  formatLocalTime,
  formatSlotWithStudioTime,
  groupSlotsByDate,
  generateMonthGrid,
  getNextMonth,
  getPrevMonth,
  formatMonthYear,
  fetchBookingChallenge,
  COMMON_TIMEZONES,
} from '@/components/calendar/public/booking-helpers';
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

describe('TASK-0044: Public Booking Schema & Pure Helpers Unit Tests', () => {
  // ==========================================
  // Schema Validation Tests (AC-1, AC-3, AC-7)
  // ==========================================

  describe('publicBookingSubmissionSchema', () => {
    const validPayload = {
      slug: 'discovery-call',
      startsAt: '2026-10-26T14:00:00Z',
      endsAt: '2026-10-26T14:30:00Z',
      timezone: 'America/New_York',
      attendeeName: 'Emma Watson',
      attendeeEmail: 'emma.watson@example.com',
      attendeePhone: '+1 212 555 0199',
      attendeeNotes: 'Looking forward to discussing our session.',
      website_url: '',
      altcha_payload: 'eyJhbGciOiJTSEEyNTYiLCJjaGFsbGVuZ2UiOiIxMjMifQ==',
      locale: 'en',
    };

    it('AC-3: accepts valid public booking submission inputs', () => {
      const parsed = publicBookingSubmissionSchema.safeParse(validPayload);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data.slug).toBe('discovery-call');
      expect(parsed.data.attendeeName).toBe('Emma Watson');
      expect(parsed.data.attendeeEmail).toBe('emma.watson@example.com');
      expect(parsed.data.locale).toBe('en');
    });

    it('AC-7: rejects when attendeeName is empty or only whitespace', () => {
      const parsed = publicBookingSubmissionSchema.safeParse({
        ...validPayload,
        attendeeName: '   ',
      });
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(parsed.error.issues[0]?.path).toContain('attendeeName');
    });

    it('AC-7: rejects when attendeeEmail is not a valid email', () => {
      const parsed = publicBookingSubmissionSchema.safeParse({
        ...validPayload,
        attendeeEmail: 'not-an-email',
      });
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(parsed.error.issues[0]?.path).toContain('attendeeEmail');
    });

    it('AC-7: rejects when endsAt is not after startsAt', () => {
      const parsed = publicBookingSubmissionSchema.safeParse({
        ...validPayload,
        startsAt: '2026-10-26T14:30:00Z',
        endsAt: '2026-10-26T14:00:00Z',
      });
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(parsed.error.issues[0]?.path).toContain('endsAt');
    });

    it('AC-7: rejects when attendeeName exceeds 200 characters', () => {
      const parsed = publicBookingSubmissionSchema.safeParse({
        ...validPayload,
        attendeeName: 'A'.repeat(201),
      });
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(parsed.error.issues[0]?.path).toContain('attendeeName');
    });

    it('AC-7: rejects when attendeeNotes exceeds 2000 characters', () => {
      const parsed = publicBookingSubmissionSchema.safeParse({
        ...validPayload,
        attendeeNotes: 'N'.repeat(2001),
      });
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(parsed.error.issues[0]?.path).toContain('attendeeNotes');
    });

    it('AC-7: rejects unrecognized keys (strict schema)', () => {
      const parsed = publicBookingSubmissionSchema.safeParse({
        ...validPayload,
        extraMaliciousField: 'exploit',
      });
      expect(parsed.success).toBe(false);
    });

    it('AC-3: allows null or omitted optional phone and notes', () => {
      const parsed = publicBookingSubmissionSchema.safeParse({
        ...validPayload,
        attendeePhone: null,
        attendeeNotes: null,
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe('getPublicAvailableSlotsSchema', () => {
    it('validates public available slots query input', () => {
      const parsed = getPublicAvailableSlotsSchema.safeParse({
        slug: 'discovery-call',
        startDate: '2026-10-26',
        endDate: '2026-11-01',
        timezone: 'Europe/Berlin',
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects malformed date formats', () => {
      const parsed = getPublicAvailableSlotsSchema.safeParse({
        slug: 'discovery-call',
        startDate: '26-10-2026',
        endDate: '2026-11-01',
        timezone: 'Europe/Berlin',
      });
      expect(parsed.success).toBe(false);
    });
  });

  // ==========================================
  // ICS Calendar File Generation (AC-11)
  // ==========================================

  describe('generateSingleEventIcs (AC-11)', () => {
    it('AC-11: generates valid RFC 5545 iCalendar content with CRLF line endings', () => {
      const ics = generateSingleEventIcs({
        uid: '01920000-0000-7000-8000-000000000099',
        title: 'Discovery Call with Starlight Photography',
        description: 'Discussing wedding package and timeline.',
        location: 'https://meet.google.com/xyz-abcd-efg',
        startsAt: new Date('2026-10-26T14:00:00Z'),
        endsAt: new Date('2026-10-26T14:30:00Z'),
      });

      expect(ics).toContain('BEGIN:VCALENDAR\r\n');
      expect(ics).toContain('VERSION:2.0\r\n');
      expect(ics).toContain('PRODID:-//Ownlight//Booking Scheduler//EN\r\n');
      expect(ics).toContain('BEGIN:VEVENT\r\n');
      expect(ics).toContain('UID:01920000-0000-7000-8000-000000000099@ownlight\r\n');
      expect(ics).toContain('DTSTART:20261026T140000Z\r\n');
      expect(ics).toContain('DTEND:20261026T143000Z\r\n');
      expect(ics).toContain('SUMMARY:Discovery Call with Starlight Photography\r\n');
      expect(ics).toContain('DESCRIPTION:Discussing wedding package and timeline.\r\n');
      expect(ics).toContain('LOCATION:https://meet.google.com/xyz-abcd-efg\r\n');
      expect(ics).toContain('STATUS:CONFIRMED\r\n');
      expect(ics).toContain('END:VEVENT\r\n');
      expect(ics).toContain('END:VCALENDAR\r\n');
      expect(ics.endsWith('\r\n')).toBe(true);
    });

    it('AC-11: generates valid RFC 5545 iCalendar when uid is omitted and string dates are provided', () => {
      const ics = generateSingleEventIcs({
        title: 'Minimal Call',
        startsAt: '2026-10-26T14:00:00Z',
        endsAt: '2026-10-26T14:30:00Z',
        description: '   ',
        location: '',
      });

      expect(ics).toContain('BEGIN:VCALENDAR\r\n');
      expect(ics).toContain('SUMMARY:Minimal Call\r\n');
      expect(ics).toContain('@ownlight\r\n');
      expect(ics).not.toContain('DESCRIPTION:');
      expect(ics).not.toContain('LOCATION:');
    });

    it('AC-11: escapes special characters (commas, semicolons, backslashes, newlines) per RFC 5545', () => {
      const escaped = escapeIcsText('Notes, with semicolon; backslash\\ and\nnewline');
      expect(escaped).toBe('Notes\\, with semicolon\\; backslash\\\\ and\\nnewline');
    });

    it('AC-11: formatIcsUtcDate produces proper zero-padded UTC format', () => {
      const date = new Date(Date.UTC(2026, 4, 3, 9, 5, 2));
      expect(formatIcsUtcDate(date)).toBe('20260503T090502Z');
    });
  });

  // ==========================================
  // Timezone and Slot Formatting (AC-1, AC-2)
  // ==========================================

  describe('Slot Timezone Formatting (AC-2)', () => {
    it('AC-2: formats slot in visitor timezone with studio timezone indicator', () => {
      // 14:00 UTC = 10:00 EDT (America/New_York) and 16:00 CEST (Europe/Berlin)
      const slot = {
        startsAtUtc: '2026-10-26T14:00:00Z',
        endsAtUtc: '2026-10-26T14:30:00Z',
      };

      const result = formatSlotWithStudioTime(slot, 'America/New_York', 'Europe/Berlin');

      expect(result.visitorTime).toContain('10:00');
      expect(result.visitorTime).toContain('10:30');
      expect(result.studioTime).toContain('15:00');
      expect(result.studioTime).toContain('15:30');
      expect(result.studioTime).toContain('Berlin');
      expect(result.combinedLabel).toContain('10:00');
      expect(result.combinedLabel).toContain('15:00 Berlin');
    });

    it('AC-2: omits redundant studio indicator when visitor and studio share the same timezone', () => {
      const slot = {
        startsAtUtc: '2026-10-26T14:00:00Z',
        endsAtUtc: '2026-10-26T14:30:00Z',
      };

      const result = formatSlotWithStudioTime(slot, 'Europe/Berlin', 'Europe/Berlin');

      expect(result.combinedLabel).toBe(result.visitorTime);
      expect(result.combinedLabel).not.toContain('(');
    });

    it('AC-1: detectVisitorTimezone falls back to Europe/Berlin when Intl throws or unavailable', () => {
      const origDateTimeFormat = Intl.DateTimeFormat;
      try {
        Intl.DateTimeFormat = (() => {
          throw new Error('Intl not supported');
        }) as unknown as typeof Intl.DateTimeFormat;
        expect(detectVisitorTimezone()).toBe('Europe/Berlin');
      } finally {
        Intl.DateTimeFormat = origDateTimeFormat;
      }
    });

    it('AC-1: detectVisitorTimezone returns resolved timezone when Intl is supported', () => {
      const origDateTimeFormat = Intl.DateTimeFormat;
      try {
        Intl.DateTimeFormat = (() => ({
          resolvedOptions: () => ({ timeZone: 'America/New_York' }),
        })) as unknown as typeof Intl.DateTimeFormat;
        expect(detectVisitorTimezone()).toBe('America/New_York');
      } finally {
        Intl.DateTimeFormat = origDateTimeFormat;
      }
    });

    it('month navigation helpers compute next, prev and formatted month string', () => {
      expect(getNextMonth(2026, 11)).toEqual({ year: 2027, month: 0 });
      expect(getNextMonth(2026, 5)).toEqual({ year: 2026, month: 6 });
      expect(getPrevMonth(2026, 0)).toEqual({ year: 2025, month: 11 });
      expect(getPrevMonth(2026, 5)).toEqual({ year: 2026, month: 4 });
      expect(formatMonthYear(2026, 9, 'en')).toBe('October 2026');
      expect(formatMonthYear(2026, 9, 'de')).toBe('Oktober 2026');
    });

    it('formatLocalTime falls back cleanly on invalid timezone', () => {
      const d = new Date('2026-10-26T14:30:00Z');
      const formatted = formatLocalTime(d, 'Invalid/TimeZone_Name');
      expect(formatted).toBe('14:30');
    });

    it('formatMonthYear falls back on formatting error', () => {
      const origDateTimeFormat = Intl.DateTimeFormat;
      try {
        Intl.DateTimeFormat = (() => {
          throw new Error('Intl failure');
        }) as unknown as typeof Intl.DateTimeFormat;
        expect(formatMonthYear(2026, 9, 'en')).toBe('2026-10');
      } finally {
        Intl.DateTimeFormat = origDateTimeFormat;
      }
    });

    it('COMMON_TIMEZONES contains major worldwide regions and UTC', () => {
      expect(COMMON_TIMEZONES).toContain('Europe/Berlin');
      expect(COMMON_TIMEZONES).toContain('America/New_York');
      expect(COMMON_TIMEZONES).toContain('UTC');
    });
  });

  describe('fetchBookingChallenge', () => {
    it('returns challenge on successful endpoint response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            challenge: 'abc123challenge',
            salt: 'salt123',
            signature: 'sig123',
          }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const challenge = await fetchBookingChallenge('discovery-call');
      expect(challenge).toEqual({
        challenge: 'abc123challenge',
        salt: 'salt123',
        signature: 'sig123',
      });
      vi.unstubAllGlobals();
    });

    it('returns null when endpoint returns non-ok status or invalid payload', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal('fetch', mockFetch);

      expect(await fetchBookingChallenge('discovery-call')).toBeNull();
      vi.unstubAllGlobals();

      const invalidJsonFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ challenge: 'incomplete' }),
      });
      vi.stubGlobal('fetch', invalidJsonFetch);
      expect(await fetchBookingChallenge('discovery-call')).toBeNull();
      vi.unstubAllGlobals();

      const nonObjectJsonFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve('not-an-object'),
      });
      vi.stubGlobal('fetch', nonObjectJsonFetch);
      expect(await fetchBookingChallenge('discovery-call')).toBeNull();
      vi.unstubAllGlobals();
    });

    it('returns null when fetch throws network error', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetch);

      expect(await fetchBookingChallenge('discovery-call')).toBeNull();
      vi.unstubAllGlobals();
    });
  });

  // ==========================================
  // Calendar Grid Helper
  // ==========================================

  describe('generateMonthGrid', () => {
    it('generates a full 7-day-per-week grid with correct day numbers', () => {
      const availableDates = new Set(['2026-10-26', '2026-10-27']);
      const grid = generateMonthGrid(2026, 9, availableDates, '2026-10-20'); // Oct 2026 (0-indexed 9)

      expect(grid.length).toBeGreaterThanOrEqual(5);
      for (const week of grid) {
        expect(week.length).toBe(7);
      }

      // Check available date flags
      const cellOct26 = grid.flat().find((c) => c.dateStr === '2026-10-26');
      expect(cellOct26?.hasSlots).toBe(true);
      expect(cellOct26?.isCurrentMonth).toBe(true);

      const cellOct20 = grid.flat().find((c) => c.dateStr === '2026-10-20');
      expect(cellOct20?.isToday).toBe(true);
      expect(cellOct20?.hasSlots).toBe(false);
    });

    it('groups slots by date correctly', () => {
      const slots = [
        {
          starts_at: '2026-10-26T10:00:00-04:00',
          ends_at: '2026-10-26T10:30:00-04:00',
          startsAt: '2026-10-26T10:00:00-04:00',
          endsAt: '2026-10-26T10:30:00-04:00',
          startsAtUtc: '2026-10-26T14:00:00Z',
          endsAtUtc: '2026-10-26T14:30:00Z',
          date: '2026-10-26',
          startTime: '10:00',
          endTime: '10:30',
          formattedStartTime: '10:00',
          formattedEndTime: '10:30',
          formattedDate: '2026-10-26',
          formattedTime: '10:00 - 10:30',
        },
        {
          starts_at: '2026-10-26T11:00:00-04:00',
          ends_at: '2026-10-26T11:30:00-04:00',
          startsAt: '2026-10-26T11:00:00-04:00',
          endsAt: '2026-10-26T11:30:00-04:00',
          startsAtUtc: '2026-10-26T15:00:00Z',
          endsAtUtc: '2026-10-26T15:30:00Z',
          date: '2026-10-26',
          startTime: '11:00',
          endTime: '11:30',
          formattedStartTime: '11:00',
          formattedEndTime: '11:30',
          formattedDate: '2026-10-26',
          formattedTime: '11:00 - 11:30',
        },
      ];

      const grouped = groupSlotsByDate(slots);
      expect(grouped['2026-10-26']?.length).toBe(2);
    });
  });

  // ==========================================
  // Translation Parity Check (AC-10)
  // ==========================================

  describe('i18n Translation Parity (AC-10)', () => {
    it('AC-10: ensures publicBooking section exists with matching keys in en.json and de.json', () => {
      const enBooking = (enMessages as Record<string, unknown>).publicBooking as
        Record<string, unknown> | undefined;
      const deBooking = (deMessages as Record<string, unknown>).publicBooking as
        Record<string, unknown> | undefined;

      expect(enBooking).toBeDefined();
      expect(deBooking).toBeDefined();

      if (!enBooking || !deBooking) return;

      function compareKeys(
        enObj: Record<string, unknown>,
        deObj: Record<string, unknown>,
        path = '',
      ) {
        for (const key of Object.keys(enObj)) {
          const currentPath = path ? `${path}.${key}` : key;
          expect(deObj[key], `Missing German translation for key: ${currentPath}`).toBeDefined();
          if (typeof enObj[key] === 'object' && enObj[key] !== null && !Array.isArray(enObj[key])) {
            compareKeys(
              enObj[key] as Record<string, unknown>,
              deObj[key] as Record<string, unknown>,
              currentPath,
            );
          }
        }
      }

      compareKeys(enBooking, deBooking);
    });
  });
});
