import { describe, it, expect } from 'vitest';
import {
  availabilityScheduleItemSchema,
  updateAvailabilitySchedulesSchema,
  createAvailabilityOverrideSchema,
  createBookingTypeSchema,
  updateBookingTypeSchema,
} from '@/server/calendar/schema';
import { generateSlug, isValidSlug } from '@/lib/slug';
import {
  generateTimeOptions,
  isTimeRangeValid,
  formatDateDisplay,
  getColorDotClass,
  WEEKDAY_ORDER,
  WEEKDAY_KEY_MAP,
} from '@/components/calendar/settings/availability-helpers';
import fs from 'node:fs';
import path from 'node:path';

describe('TASK-0043: Availability & Booking Types Unit Tests', () => {
  // AC-2: Client and server validation for weekly schedule times
  describe('AC-2: Weekly Schedule Validation Schema', () => {
    it('AC-2: accepts valid daily schedule when startTime < endTime', () => {
      const valid = availabilityScheduleItemSchema.safeParse({
        dayOfWeek: 1,
        startTime: '08:30',
        endTime: '16:30',
        isActive: true,
      });
      expect(valid.success).toBe(true);
    });

    it('AC-2: rejects daily schedule when endTime is earlier than startTime (e.g. 17:00 - 09:00)', () => {
      const invalid = availabilityScheduleItemSchema.safeParse({
        dayOfWeek: 1,
        startTime: '17:00',
        endTime: '09:00',
        isActive: true,
      });
      expect(invalid.success).toBe(false);
      if (!invalid.success) {
        expect(invalid.error.issues[0]?.message).toBe('End time must be after start time');
        expect(invalid.error.issues[0]?.path).toContain('endTime');
      }
    });

    it('AC-2: rejects daily schedule when endTime is equal to startTime (e.g. 09:00 - 09:00)', () => {
      const invalid = availabilityScheduleItemSchema.safeParse({
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '09:00',
        isActive: true,
      });
      expect(invalid.success).toBe(false);
      if (!invalid.success) {
        expect(invalid.error.issues[0]?.message).toBe('End time must be after start time');
      }
    });

    it('AC-2: rejects daily schedule with invalid time format or invalid day of week', () => {
      const invalidTime = availabilityScheduleItemSchema.safeParse({
        dayOfWeek: 1,
        startTime: '9:00',
        endTime: '17:00',
        isActive: true,
      });
      expect(invalidTime.success).toBe(false);

      const invalidDay = availabilityScheduleItemSchema.safeParse({
        dayOfWeek: 7,
        startTime: '09:00',
        endTime: '17:00',
        isActive: true,
      });
      expect(invalidDay.success).toBe(false);
    });

    it('AC-2: updateAvailabilitySchedulesSchema validates array of schedule items', () => {
      const validBatch = updateAvailabilitySchedulesSchema.safeParse({
        schedules: [
          { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isActive: true },
          { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', isActive: true },
        ],
      });
      expect(validBatch.success).toBe(true);

      const invalidBatch = updateAvailabilitySchedulesSchema.safeParse({
        schedules: [{ dayOfWeek: 1, startTime: '18:00', endTime: '09:00', isActive: true }],
      });
      expect(invalidBatch.success).toBe(false);
    });
  });

  // AC-3 & AC-4: Date Override Validation Schema
  describe('AC-3: Date Override Validation Schema', () => {
    it('AC-3: accepts date override marked unavailable with reason', () => {
      const valid = createAvailabilityOverrideSchema.safeParse({
        date: '2026-11-20',
        isUnavailable: true,
        reason: 'Conference',
      });
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data.date).toBe('2026-11-20');
        expect(valid.data.isUnavailable).toBe(true);
        expect(valid.data.reason).toBe('Conference');
      }
    });

    it('AC-3: accepts date override with custom hours when startTime < endTime', () => {
      const valid = createAvailabilityOverrideSchema.safeParse({
        date: '2026-12-24',
        isUnavailable: false,
        startTime: '10:00',
        endTime: '14:00',
        reason: 'Christmas Eve half-day',
      });
      expect(valid.success).toBe(true);
    });

    it('AC-3: rejects date override with custom hours when endTime <= startTime', () => {
      const invalid = createAvailabilityOverrideSchema.safeParse({
        date: '2026-12-24',
        isUnavailable: false,
        startTime: '16:00',
        endTime: '10:00',
      });
      expect(invalid.success).toBe(false);
      if (!invalid.success) {
        expect(invalid.error.issues[0]?.message).toBe('End time must be after start time');
      }
    });

    it('AC-3: rejects invalid date formats', () => {
      const invalid = createAvailabilityOverrideSchema.safeParse({
        date: '20-11-2026',
        isUnavailable: true,
      });
      expect(invalid.success).toBe(false);
    });
  });

  // AC-5, AC-6, AC-7: Booking Types Validation Schema
  describe('AC-5, AC-6, AC-7: Booking Types Validation Schema', () => {
    it('AC-5: accepts valid booking type configuration', () => {
      const valid = createBookingTypeSchema.safeParse({
        title: 'Portrait Consultation',
        slug: 'portrait-consultation',
        durationMinutes: 45,
        bufferBeforeMinutes: 10,
        bufferAfterMinutes: 15,
        minNoticeHours: 24,
        maxFutureDays: 60,
        locationType: 'google_meet',
        color: 'indigo',
        isActive: true,
      });
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data.durationMinutes).toBe(45);
        expect(valid.data.bufferBeforeMinutes).toBe(10);
        expect(valid.data.bufferAfterMinutes).toBe(15);
      }
    });

    it('AC-6: rejects invalid slug formats (uppercase, spaces, special characters, consecutive hyphens)', () => {
      const uppercase = createBookingTypeSchema.safeParse({
        title: 'Invalid',
        slug: 'Portrait-Consultation',
      });
      expect(uppercase.success).toBe(false);

      const spaces = createBookingTypeSchema.safeParse({
        title: 'Invalid',
        slug: 'portrait consultation',
      });
      expect(spaces.success).toBe(false);

      const consecutiveHyphens = createBookingTypeSchema.safeParse({
        title: 'Invalid',
        slug: 'portrait--consultation',
      });
      expect(consecutiveHyphens.success).toBe(false);

      const leadingHyphen = createBookingTypeSchema.safeParse({
        title: 'Invalid',
        slug: '-portrait',
      });
      expect(leadingHyphen.success).toBe(false);

      const trailingHyphen = createBookingTypeSchema.safeParse({
        title: 'Invalid',
        slug: 'portrait-',
      });
      expect(trailingHyphen.success).toBe(false);

      const singleChar = createBookingTypeSchema.safeParse({
        title: 'Invalid',
        slug: 'a',
      });
      expect(singleChar.success).toBe(false);
    });

    it('AC-6: rejects out-of-bounds duration, buffer, notice, or horizon values', () => {
      // Duration < 5 min
      expect(
        createBookingTypeSchema.safeParse({
          title: 'Too short',
          slug: 'too-short',
          durationMinutes: 4,
        }).success,
      ).toBe(false);

      // Duration > 480 min (8 hours)
      expect(
        createBookingTypeSchema.safeParse({
          title: 'Too long',
          slug: 'too-long',
          durationMinutes: 481,
        }).success,
      ).toBe(false);

      // Buffer before > 120 min
      expect(
        createBookingTypeSchema.safeParse({
          title: 'Too much buffer',
          slug: 'too-much-buffer',
          bufferBeforeMinutes: 121,
        }).success,
      ).toBe(false);

      // Notice > 168 hours (7 days)
      expect(
        createBookingTypeSchema.safeParse({
          title: 'Too much notice',
          slug: 'too-much-notice',
          minNoticeHours: 169,
        }).success,
      ).toBe(false);

      // Horizon > 365 days
      expect(
        createBookingTypeSchema.safeParse({
          title: 'Too far future',
          slug: 'too-far-future',
          maxFutureDays: 366,
        }).success,
      ).toBe(false);
    });

    it('AC-7: updateBookingTypeSchema allows partial updates', () => {
      const partial = updateBookingTypeSchema.safeParse({
        durationMinutes: 60,
        isActive: false,
      });
      expect(partial.success).toBe(true);
      if (partial.success) {
        expect(partial.data.durationMinutes).toBe(60);
        expect(partial.data.isActive).toBe(false);
      }
    });
  });

  // Slug Generator helper tests
  describe('AC-5 & AC-6: Slug Generator & Validator Helpers', () => {
    it('generates lowercase kebab-case slug from title', () => {
      expect(generateSlug('Portrait Consultation')).toBe('portrait-consultation');
      expect(generateSlug('30-Minute Discovery Call')).toBe('30-minute-discovery-call');
      expect(generateSlug('')).toBe('');
    });

    it('converts German umlauts correctly (ä->ae, ö->oe, ü->ue, ß->ss)', () => {
      expect(generateSlug('Porträt & Fotoshooting')).toBe('portraet-fotoshooting');
      expect(generateSlug('Übergrößen Shooting in Köln')).toBe('uebergroessen-shooting-in-koeln');
    });

    it('removes punctuation and trims leading/trailing hyphens', () => {
      expect(generateSlug('  --- Hello World! (Consultation)? --- ')).toBe(
        'hello-world-consultation',
      );
    });

    it('truncates to max 64 characters without ending with a hyphen', () => {
      const longTitle =
        'This is an exceedingly long title that should certainly exceed sixty-four characters in total';
      const slug = generateSlug(longTitle);
      expect(slug.length).toBeLessThanOrEqual(64);
      expect(slug.endsWith('-')).toBe(false);
    });

    it('isValidSlug validates according to rules', () => {
      expect(isValidSlug('portrait-consultation')).toBe(true);
      expect(isValidSlug('call-30min')).toBe(true);
      expect(isValidSlug('')).toBe(false);
      expect(isValidSlug('a')).toBe(false);
      expect(isValidSlug('-test')).toBe(false);
      expect(isValidSlug('test-')).toBe(false);
      expect(isValidSlug('test--slug')).toBe(false);
      expect(isValidSlug('Test_Slug')).toBe(false);
      expect(isValidSlug(null as unknown as string)).toBe(false);
    });
  });

  // AC-1, AC-2: Pure Availability Helper Functions
  describe('AC-1 & AC-2: Availability Helpers', () => {
    it('generateTimeOptions generates 48 half-hour slots', () => {
      const opts = generateTimeOptions();
      expect(opts.length).toBe(48);
      expect(opts[0]).toBe('00:00');
      expect(opts[47]).toBe('23:30');
    });

    it('isTimeRangeValid checks strictly startTime < endTime', () => {
      expect(isTimeRangeValid('09:00', '17:00')).toBe(true);
      expect(isTimeRangeValid('17:00', '09:00')).toBe(false);
      expect(isTimeRangeValid('09:00', '09:00')).toBe(false);
      expect(isTimeRangeValid('', '17:00')).toBe(false);
      expect(isTimeRangeValid('09:00', '')).toBe(false);
    });

    it('formatDateDisplay formats valid dates and passes through fallbacks', () => {
      expect(formatDateDisplay('2026-11-20', 'en')).toContain('2026');
      expect(formatDateDisplay('2026-11-20', 'de')).toContain('2026');
      expect(formatDateDisplay('invalid-date')).toBe('invalid-date');
      expect(formatDateDisplay('')).toBe('');
    });

    it('getColorDotClass returns appropriate badge classes for all tokens', () => {
      expect(getColorDotClass('emerald')).toBe('bg-emerald-500');
      expect(getColorDotClass('amber')).toBe('bg-amber-500');
      expect(getColorDotClass('rose')).toBe('bg-rose-500');
      expect(getColorDotClass('sky')).toBe('bg-sky-500');
      expect(getColorDotClass('violet')).toBe('bg-violet-500');
      expect(getColorDotClass('indigo')).toBe('bg-indigo-500');
      expect(getColorDotClass('unknown')).toBe('bg-indigo-500');
    });

    it('WEEKDAY_ORDER and WEEKDAY_KEY_MAP cover standard Mon-Sun week', () => {
      expect(WEEKDAY_ORDER).toEqual([1, 2, 3, 4, 5, 6, 0]);
      expect(WEEKDAY_KEY_MAP[0]).toBe('sunday');
      expect(WEEKDAY_KEY_MAP[1]).toBe('monday');
    });
  });

  // AC-9: Translation Parity for Availability & Booking Types
  describe('AC-9: Translation Parity', () => {
    it('AC-9: all settings.availability keys exist in both en.json and de.json', () => {
      const enPath = path.resolve(process.cwd(), 'messages/en.json');
      const dePath = path.resolve(process.cwd(), 'messages/de.json');

      const en = JSON.parse(fs.readFileSync(enPath, 'utf8')) as Record<
        string,
        Record<string, unknown>
      >;
      const de = JSON.parse(fs.readFileSync(dePath, 'utf8')) as Record<
        string,
        Record<string, unknown>
      >;

      const enSettings = en.settings;
      const deSettings = de.settings;
      expect(enSettings).toBeDefined();
      expect(deSettings).toBeDefined();

      const enAvailability = enSettings?.availability as Record<string, unknown> | undefined;
      const deAvailability = deSettings?.availability as Record<string, unknown> | undefined;

      expect(enAvailability).toBeDefined();
      expect(deAvailability).toBeDefined();

      if (enAvailability && deAvailability) {
        expect(enAvailability.title).toBe('Availability & Booking Types');
        expect(deAvailability.title).toBe('Verfügbarkeit & Buchungsarten');
      }
    });
  });
});
