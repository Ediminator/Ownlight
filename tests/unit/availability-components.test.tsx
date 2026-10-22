import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

vi.mock('next-intl', () => ({
  useTranslations: (section?: string) => {
    const t = (key: string, values?: Record<string, unknown>) => {
      const fullKey = section ? `${section}.${key}` : key;
      if (values) return `${fullKey}:${JSON.stringify(values)}`;
      return fullKey;
    };
    t.has = () => true;
    return t;
  },
  useLocale: () => 'en',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/en/settings/calendar/availability',
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => '/en/settings/calendar/availability',
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('@/server/calendar/availability-actions', () => ({
  updateWeeklyScheduleAction: vi.fn().mockResolvedValue({ success: true, data: [] }),
  createDateOverrideAction: vi.fn().mockResolvedValue({ success: true }),
  deleteDateOverrideAction: vi.fn().mockResolvedValue({ success: true }),
  createBookingTypeAction: vi.fn().mockResolvedValue({ success: true }),
  updateBookingTypeAction: vi.fn().mockResolvedValue({ success: true }),
  deleteBookingTypeAction: vi.fn().mockResolvedValue({ success: true }),
}));

import { AvailabilitySettingsView } from '@/components/calendar/settings/availability-settings-view';
import { WeeklyScheduleEditor } from '@/components/calendar/settings/weekly-schedule-editor';
import { DateOverridesManager } from '@/components/calendar/settings/date-overrides-manager';
import { BookingTypesManager } from '@/components/calendar/settings/booking-types-manager';
import {
  generateTimeOptions,
  isTimeRangeValid,
  formatDateDisplay,
  getColorDotClass,
  WEEKDAY_ORDER,
  WEEKDAY_KEY_MAP,
  COLOR_OPTIONS,
} from '@/components/calendar/settings/availability-helpers';
import type {
  AvailabilitySchedule,
  AvailabilityOverride,
  BookingType,
} from '@/server/db/schema/calendar';

describe('TASK-0043: Availability Settings UI Components Static Render Tests', () => {
  const dummySchedules: AvailabilitySchedule[] = [
    {
      id: 'sched-1',
      dayOfWeek: 1,
      startTime: '08:30',
      endTime: '16:30',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'sched-2',
      dayOfWeek: 2,
      startTime: '09:00',
      endTime: '17:00',
      isActive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const dummyOverrides: AvailabilityOverride[] = [
    {
      id: 'ov-1',
      date: '2026-11-20',
      isUnavailable: true,
      startTime: null,
      endTime: null,
      reason: 'Studio Closed - Conference',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'ov-2',
      date: '2026-12-01',
      isUnavailable: false,
      startTime: '10:00',
      endTime: '14:00',
      reason: 'Half Day',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const dummyBookingTypes: BookingType[] = [
    {
      id: 'bt-1',
      title: 'Portrait Consultation',
      slug: 'portrait-consultation',
      description: 'Introductory portrait discussion',
      durationMinutes: 45,
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 15,
      minNoticeHours: 24,
      maxFutureDays: 60,
      locationType: 'in_person',
      locationDetails: 'Studio A',
      color: 'indigo',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'bt-2',
      title: 'Virtual Mini Session',
      slug: 'virtual-mini',
      description: null,
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      minNoticeHours: 12,
      maxFutureDays: 30,
      locationType: 'google_meet',
      locationDetails: null,
      color: 'rose',
      isActive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'bt-3',
      title: 'Phone Discovery Call',
      slug: 'phone-discovery',
      description: null,
      durationMinutes: 15,
      bufferBeforeMinutes: 5,
      bufferAfterMinutes: 5,
      minNoticeHours: 6,
      maxFutureDays: 14,
      locationType: 'phone',
      locationDetails: null,
      color: 'amber',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'bt-4',
      title: 'On Location Shoot Consultation',
      slug: 'on-location-consult',
      description: 'Client outdoor session prep',
      durationMinutes: 60,
      bufferBeforeMinutes: 30,
      bufferAfterMinutes: 30,
      minNoticeHours: 48,
      maxFutureDays: 90,
      locationType: 'in_person',
      locationDetails: 'Customer venue',
      color: 'emerald',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  describe('AvailabilitySettingsView', () => {
    it('renders breadcrumbs, tabs and default schedules panel', () => {
      const html = renderToStaticMarkup(
        <AvailabilitySettingsView
          initialSchedules={dummySchedules}
          initialOverrides={dummyOverrides}
          initialBookingTypes={dummyBookingTypes}
          locale="en"
          defaultTab="schedules"
        />,
      );

      expect(html).toContain('breadcrumb-settings');
      expect(html).toContain('tab-weekly-schedule');
      expect(html).toContain('tab-date-overrides');
      expect(html).toContain('tab-booking-types');
      expect(html).toContain('panel-schedules');
      expect(html).toContain('weekly-schedule-editor');
    });

    it('renders with overrides tab selected initially', () => {
      const html = renderToStaticMarkup(
        <AvailabilitySettingsView
          initialSchedules={dummySchedules}
          initialOverrides={dummyOverrides}
          initialBookingTypes={dummyBookingTypes}
          locale="en"
          defaultTab="overrides"
        />,
      );

      expect(html).toContain('panel-overrides');
      expect(html).toContain('add-date-override-btn');
    });

    it('renders with booking-types tab selected initially', () => {
      const html = renderToStaticMarkup(
        <AvailabilitySettingsView
          initialSchedules={dummySchedules}
          initialOverrides={dummyOverrides}
          initialBookingTypes={dummyBookingTypes}
          locale="en"
          defaultTab="booking-types"
        />,
      );

      expect(html).toContain('panel-booking-types');
      expect(html).toContain('new-booking-type-btn');
    });
  });

  describe('WeeklyScheduleEditor', () => {
    it('renders day rows for Mon through Sun with active states and time options', () => {
      const html = renderToStaticMarkup(
        <WeeklyScheduleEditor initialSchedules={dummySchedules} locale="en" />,
      );

      expect(html).toContain('weekly-schedule-editor');
      expect(html).toContain('schedule-row-1');
      expect(html).toContain('schedule-row-0');
      expect(html).toContain('schedule-active-toggle-1');
      expect(html).toContain('schedule-start-time-1');
      expect(html).toContain('schedule-end-time-1');
      expect(html).toContain('save-weekly-schedule-btn');
    });

    it('renders correctly with empty initialSchedules (default working days)', () => {
      const html = renderToStaticMarkup(<WeeklyScheduleEditor initialSchedules={[]} locale="de" />);

      expect(html).toContain('weekly-schedule-editor');
      expect(html).toContain('schedule-row-1');
      expect(html).toContain('schedule-row-6');
    });

    it('renders success and error notifications and client error messages', () => {
      const successHtml = renderToStaticMarkup(
        <WeeklyScheduleEditor
          initialSchedules={dummySchedules}
          locale="en"
          initialNotification={{ type: 'success', message: 'Schedules saved successfully' }}
        />,
      );
      expect(successHtml).toContain('availability-notification');
      expect(successHtml).toContain('Schedules saved successfully');

      const errorHtml = renderToStaticMarkup(
        <WeeklyScheduleEditor
          initialSchedules={dummySchedules}
          locale="en"
          initialNotification={{ type: 'error', message: 'Failed to update schedule' }}
          initialClientErrors={{ 1: 'End time must be after start time' }}
        />,
      );
      expect(errorHtml).toContain('availability-notification');
      expect(errorHtml).toContain('Failed to update schedule');
      expect(errorHtml).toContain('schedule-error-1');
      expect(errorHtml).toContain('End time must be after start time');
    });
  });

  describe('DateOverridesManager', () => {
    it('renders populated overrides table with both unavailable and custom hours rows', () => {
      const html = renderToStaticMarkup(
        <DateOverridesManager initialOverrides={dummyOverrides} locale="en" />,
      );

      expect(html).toContain('date-overrides-table');
      expect(html).toContain('override-row-2026-11-20');
      expect(html).toContain('override-row-2026-12-01');
      expect(html).toContain('delete-override-2026-11-20');
      expect(html).toContain('Studio Closed - Conference');
      expect(html).toContain('Half Day');
    });

    it('renders empty state when initialOverrides is empty', () => {
      const html = renderToStaticMarkup(<DateOverridesManager initialOverrides={[]} locale="en" />);

      expect(html).toContain('date-overrides-empty');
      expect(html).toContain('add-date-override-btn');
    });

    it('renders Add Date Override dialog when defaultAddOpen is true', () => {
      const html = renderToStaticMarkup(
        <DateOverridesManager
          initialOverrides={dummyOverrides}
          locale="en"
          defaultAddOpen={true}
        />,
      );

      expect(html).toContain('override-date-input');
      expect(html).toContain('override-unavailable-checkbox');
      expect(html).toContain('override-reason-input');
      expect(html).toContain('override-save-btn');
      expect(html).toContain('override-cancel-btn');
    });

    it('renders delete confirmation dialog and notifications', () => {
      const deleteHtml = renderToStaticMarkup(
        <DateOverridesManager
          initialOverrides={dummyOverrides}
          locale="en"
          defaultDeleteTarget={dummyOverrides[0]}
        />,
      );

      expect(deleteHtml).toContain('confirm-delete-override-btn');
      expect(deleteHtml).toContain('cancel-delete-override-btn');

      const notifHtml = renderToStaticMarkup(
        <DateOverridesManager
          initialOverrides={dummyOverrides}
          locale="en"
          initialNotification={{ type: 'success', message: 'Override created successfully' }}
        />,
      );
      expect(notifHtml).toContain('availability-notification');
      expect(notifHtml).toContain('Override created successfully');
    });
  });

  describe('BookingTypesManager', () => {
    it('renders booking type cards with details, copy link buttons, and action buttons', () => {
      const html = renderToStaticMarkup(
        <BookingTypesManager initialBookingTypes={dummyBookingTypes} locale="en" />,
      );

      expect(html).toContain('booking-types-list');
      expect(html).toContain('booking-type-card-portrait-consultation');
      expect(html).toContain('booking-type-card-virtual-mini');
      expect(html).toContain('booking-type-card-phone-discovery');
      expect(html).toContain('booking-type-card-on-location-consult');

      expect(html).toContain('copy-booking-type-link-portrait-consultation');
      expect(html).toContain('edit-booking-type-portrait-consultation');
      expect(html).toContain('delete-booking-type-portrait-consultation');

      expect(html).toContain('Portrait Consultation');
      expect(html).toContain('Virtual Mini Session');
      expect(html).toContain('Phone Discovery Call');
      expect(html).toContain('On Location Shoot Consultation');
    });

    it('renders empty state when initialBookingTypes is empty', () => {
      const html = renderToStaticMarkup(
        <BookingTypesManager initialBookingTypes={[]} locale="en" />,
      );

      expect(html).toContain('booking-types-empty');
      expect(html).toContain('new-booking-type-btn');
    });

    it('renders New Booking Type modal dialog with all input fields', () => {
      const html = renderToStaticMarkup(
        <BookingTypesManager
          initialBookingTypes={dummyBookingTypes}
          locale="en"
          defaultDialogOpen={true}
        />,
      );

      expect(html).toContain('booking-type-title-input');
      expect(html).toContain('booking-type-slug-input');
      expect(html).toContain('booking-type-description-input');
      expect(html).toContain('booking-type-duration-input');
      expect(html).toContain('booking-type-buffer-before-input');
      expect(html).toContain('booking-type-buffer-after-input');
      expect(html).toContain('booking-type-notice-input');
      expect(html).toContain('booking-type-horizon-input');
      expect(html).toContain('booking-type-location-type-select');
      expect(html).toContain('booking-type-active-toggle');
      expect(html).toContain('booking-type-submit-btn');
      expect(html).toContain('booking-type-cancel-btn');
    });

    it('renders Edit Booking Type dialog with pre-populated values', () => {
      const html = renderToStaticMarkup(
        <BookingTypesManager
          initialBookingTypes={dummyBookingTypes}
          locale="en"
          defaultEditingItem={dummyBookingTypes[0]}
        />,
      );

      expect(html).toContain('booking-type-title-input');
      expect(html).toContain('value="Portrait Consultation"');
      expect(html).toContain('value="portrait-consultation"');
      expect(html).toContain('booking-type-submit-btn');
    });

    it('renders delete confirmation dialog and notifications', () => {
      const deleteHtml = renderToStaticMarkup(
        <BookingTypesManager
          initialBookingTypes={dummyBookingTypes}
          locale="en"
          defaultDeleteTarget={dummyBookingTypes[0]}
        />,
      );

      expect(deleteHtml).toContain('confirm-delete-booking-type-btn');
      expect(deleteHtml).toContain('cancel-delete-booking-type-btn');

      const notifHtml = renderToStaticMarkup(
        <BookingTypesManager
          initialBookingTypes={dummyBookingTypes}
          locale="en"
          initialNotification={{ type: 'success', message: 'Booking type saved' }}
        />,
      );
      expect(notifHtml).toContain('availability-notification');
      expect(notifHtml).toContain('Booking type saved');
    });
  });

  describe('availability-helpers pure logic', () => {
    it('generateTimeOptions returns 48 30-minute intervals from 00:00 to 23:30', () => {
      const options = generateTimeOptions();
      expect(options.length).toBe(48);
      expect(options[0]).toBe('00:00');
      expect(options[options.length - 1]).toBe('23:30');
    });

    it('isTimeRangeValid checks start and end time comparison', () => {
      expect(isTimeRangeValid('09:00', '17:00')).toBe(true);
      expect(isTimeRangeValid('08:30', '09:00')).toBe(true);
      expect(isTimeRangeValid('17:00', '09:00')).toBe(false);
      expect(isTimeRangeValid('09:00', '09:00')).toBe(false);
      expect(isTimeRangeValid('invalid', '17:00')).toBe(false);
      expect(isTimeRangeValid('09:00', 'invalid')).toBe(false);
      expect(isTimeRangeValid('', '')).toBe(false);
    });

    it('formatDateDisplay formats YYYY-MM-DD for both en and de locales', () => {
      const enFormatted = formatDateDisplay('2026-11-20', 'en');
      expect(enFormatted).toBeDefined();
      expect(enFormatted).toContain('2026');

      const deFormatted = formatDateDisplay('2026-11-20', 'de');
      expect(deFormatted).toBeDefined();
      expect(deFormatted).toContain('2026');

      // Invalid regex pattern returns original string
      expect(formatDateDisplay('invalid-date')).toBe('invalid-date');
      expect(formatDateDisplay('')).toBe('');
    });

    it('formatDateDisplay catch block returns isoDate if Intl.DateTimeFormat throws', () => {
      const originalDateTimeFormat = Intl.DateTimeFormat;
      // @ts-expect-error Mocking Intl.DateTimeFormat to force error
      Intl.DateTimeFormat = class {
        format() {
          throw new Error('Locale error');
        }
      };

      const result = formatDateDisplay('2026-11-20', 'en');
      expect(result).toBe('2026-11-20');

      Intl.DateTimeFormat = originalDateTimeFormat;
    });

    it('getColorDotClass handles known and unknown color options', () => {
      for (const col of COLOR_OPTIONS) {
        const cls = getColorDotClass(col);
        expect(cls).toBeDefined();
        expect(cls.length).toBeGreaterThan(0);
      }
      expect(getColorDotClass('unknown-color')).toBe('bg-indigo-500');
    });

    it('WEEKDAY_ORDER and WEEKDAY_KEY_MAP are defined correctly', () => {
      expect(WEEKDAY_ORDER).toEqual([1, 2, 3, 4, 5, 6, 0]);
      expect(WEEKDAY_KEY_MAP[1]).toBe('monday');
      expect(WEEKDAY_KEY_MAP[0]).toBe('sunday');
    });
  });
});
