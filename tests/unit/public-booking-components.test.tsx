import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

// Mock next/navigation
const mockNotFound = vi.fn();
vi.mock('next/navigation', () => ({
  notFound: () => {
    mockNotFound();
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en/book/test-consultation',
}));

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: (section?: string) => {
    const t = (key: string, values?: Record<string, unknown>) => {
      return `${section ? `${section}.` : ''}${key}${values ? JSON.stringify(values) : ''}`;
    };
    t.has = () => true;
    return t;
  },
  useLocale: () => 'en',
}));

// Mock pow-solver
const mockSolver = {
  start: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn(),
  ensureVerifiedPayload: vi.fn().mockResolvedValue('mock-pow-payload-verified'),
};

vi.mock('@/app/[locale]/f/_components/pow-solver', () => ({
  createAltchaSolverController: vi.fn(() => mockSolver),
}));

// Mock server repos and actions
vi.mock('@/server/calendar/repo', () => ({
  findBookingTypeBySlug: vi.fn(),
}));

vi.mock('@/server/settings/repo', () => ({
  getStudioSettings: vi.fn(),
}));

vi.mock('@/server/calendar/public-actions', () => ({
  getPublicAvailableSlotsAction: vi.fn().mockResolvedValue({
    success: true,
    data: {
      slots: [
        {
          starts_at: '2026-11-10T10:00:00.000Z',
          ends_at: '2026-11-10T11:00:00.000Z',
          startsAt: '2026-11-10T10:00:00.000Z',
          endsAt: '2026-11-10T11:00:00.000Z',
          startsAtUtc: '2026-11-10T10:00:00.000Z',
          endsAtUtc: '2026-11-10T11:00:00.000Z',
          date: '2026-11-10',
          startTime: '10:00',
          endTime: '11:00',
          formattedStartTime: '10:00',
          formattedEndTime: '11:00',
          formattedDate: 'Tuesday, November 10, 2026',
          formattedTime: '10:00 - 11:00',
        },
      ],
      studioTimezone: 'Europe/Berlin',
    },
  }),
  submitPublicBookingAction: vi.fn().mockResolvedValue({
    success: true,
    data: {
      appointmentId: '019a1234-5678-7000-8000-000000000001',
      title: 'Portrait Consultation - Alex Smith',
      bookingTypeTitle: 'Portrait Consultation',
      durationMinutes: 60,
      startsAt: '2026-11-10T10:00:00.000Z',
      endsAt: '2026-11-10T11:00:00.000Z',
      timezone: 'Europe/Berlin',
      attendeeName: 'Alex Smith',
      attendeeEmail: 'alex@example.org',
      locationType: 'google_meet',
      locationDetails: null,
      meetUrl: 'https://meet.google.com/abc-defg-hij',
    },
  }),
}));

vi.mock('@/server/inquiry-forms/pow', () => ({
  getOrCreatePowSecret: vi.fn().mockResolvedValue('mock-secret'),
  createFormChallenge: vi.fn().mockReturnValue({
    algorithm: 'SHA-256',
    challenge: 'abc123challenge',
    maxnumber: 10000,
    salt: 'salt123',
    signature: 'sig123',
  }),
  POW_MAX_NUMBER: 10000,
}));

vi.mock('@/server/auth/rate-limiter', () => ({
  consumeRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 29,
    resetAt: new Date(Date.now() + 60000),
  }),
  anonymizeIp: (ip: string) => `anon:${ip}`,
}));

vi.mock('@/server/http/client-ip', () => ({
  resolveClientIp: vi.fn().mockReturnValue('192.0.2.1'),
}));

import { BookingClosedView } from '@/components/calendar/public/booking-closed-view';
import {
  BookingConfirmationView,
  downloadBookingIcs,
  executeBookingIcsDownload,
} from '@/components/calendar/public/booking-confirmation-view';
import { PublicBookingScheduler } from '@/components/calendar/public/public-booking-scheduler';
import {
  buildBookingIcsParams,
  validateBookingAttendeeForm,
  getNextMonth,
  getPrevMonth,
  formatMonthYear,
  fetchBookingChallenge,
  detectVisitorTimezone,
  formatLocalTime,
  formatSlotWithStudioTime,
  generateMonthGrid,
  groupSlotsByDate,
  resolveBookingLocationLabel,
  buildPublicBookingSubmission,
  processBookingSubmissionResult,
} from '@/components/calendar/public/booking-helpers';
import BookingPage, { generateMetadata } from '@/app/[locale]/book/[slug]/page';
import { GET as challengeRouteHandler } from '@/app/api/public/book/[slug]/challenge/route';
import { findBookingTypeBySlug } from '@/server/calendar/repo';
import { getStudioSettings } from '@/server/settings/repo';
import { consumeRateLimit, type RateLimitCheckResult } from '@/server/auth/rate-limiter';
import type { ConfirmedBookingSummary } from '@/server/calendar/public-actions';
import type { BookingType } from '@/server/db/schema/calendar';
import type { StudioSettings } from '@/server/db/schema';
import type { AvailableSlot } from '@/server/calendar/availability';

function createMockSlot(overrides: Partial<AvailableSlot> = {}): AvailableSlot {
  return {
    starts_at: '2026-11-20T10:00:00.000Z',
    ends_at: '2026-11-20T10:45:00.000Z',
    startsAt: '2026-11-20T10:00:00.000Z',
    endsAt: '2026-11-20T10:45:00.000Z',
    startsAtUtc: '2026-11-20T10:00:00.000Z',
    endsAtUtc: '2026-11-20T10:45:00.000Z',
    date: '2026-11-20',
    startTime: '10:00',
    endTime: '10:45',
    formattedStartTime: '10:00',
    formattedEndTime: '10:45',
    formattedDate: 'Friday, November 20, 2026',
    formattedTime: '10:00 - 10:45',
    ...overrides,
  };
}

function createMockSummary(
  overrides: Partial<ConfirmedBookingSummary> = {},
): ConfirmedBookingSummary {
  return {
    appointmentId: '019a0000-0000-7000-8000-000000000001',
    title: 'Editorial Portrait - Elena Rostova',
    bookingTypeTitle: 'Editorial Portrait',
    durationMinutes: 60,
    startsAt: '2026-11-15T14:00:00.000Z',
    endsAt: '2026-11-15T15:00:00.000Z',
    timezone: 'Europe/Berlin',
    attendeeName: 'Elena Rostova',
    attendeeEmail: 'elena@example.com',
    locationType: 'google_meet',
    locationDetails: null,
    meetUrl: 'https://meet.google.com/xyz-1234-abc',
    ...overrides,
  };
}

function createMockBookingType(overrides: Partial<BookingType> = {}): BookingType {
  return {
    id: '019a1234-5678-7000-8000-000000000001',
    slug: 'discovery-session',
    title: 'Discovery Session',
    description: 'Initial consultation',
    durationMinutes: 45,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 15,
    minNoticeHours: 24,
    maxFutureDays: 60,
    locationType: 'google_meet',
    locationDetails: null,
    color: 'indigo',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createMockStudioSettings(overrides: Partial<StudioSettings> = {}): StudioSettings {
  return {
    id: '019a1234-5678-7000-8000-000000000002',
    studio_name: 'Studio Nord',
    default_locale: 'en',
    timezone: 'Europe/Berlin',
    currency: 'EUR',
    mfa_required: false,
    mfa_postponed_until: null,
    forms_pow_hmac_key: 'pow-key-secret',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('Public Booking Components & Routes (Unit Tests)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('BookingClosedView (AC-9)', () => {
    it('renders with minimal props (no email, no title)', () => {
      const html = renderToStaticMarkup(<BookingClosedView studioName="Lumiere Photography" />);
      expect(html).toContain('Lumiere Photography');
      expect(html).toContain('publicBooking.closed.title');
      expect(html).toContain('publicBooking.closed.description');
      expect(html).not.toContain('mailto:');
    });

    it('renders with bookingTypeTitle and studioEmail', () => {
      const html = renderToStaticMarkup(
        <BookingClosedView
          studioName="Lumiere Photography"
          bookingTypeTitle="Wedding Consultation"
          studioEmail="contact@lumiere.com"
        />,
      );
      expect(html).toContain('Wedding Consultation');
      expect(html).toContain('contact@lumiere.com');
      expect(html).toContain('mailto:contact@lumiere.com');
    });
  });

  describe('BookingConfirmationView (AC-3, AC-11)', () => {
    const baseSummary = createMockSummary();

    it('renders Google Meet booking confirmation with meet link and download button', () => {
      const html = renderToStaticMarkup(
        <BookingConfirmationView
          summary={baseSummary}
          slug="editorial-portrait"
          studioName="Lumiere Studio"
          studioEmail="hello@lumiere.com"
        />,
      );
      expect(html).toContain('publicBooking.confirmation.title');
      expect(html).toContain('Editorial Portrait (60 min)');
      expect(html).toContain('elena@example.com');
      expect(html).toContain('Google Meet');
      expect(html).toContain('publicBooking.confirmation.googleMeetNotice');
      expect(html).toContain('publicBooking.confirmation.addToCalendar');
      // I1-U01: Add to Calendar button uses text-primary-foreground
      expect(html).toContain('text-primary-foreground');
      // I2-U01: Google Meet notice uses text-neutral-600 dark:text-neutral-400
      expect(html).toContain('text-neutral-600 dark:text-neutral-400 mt-0.5');
    });

    it('I2-U01: renders Google Meet notice and section headings with WCAG 1.4.3 compliant dark mode contrast', () => {
      const html = renderToStaticMarkup(
        <BookingConfirmationView
          summary={baseSummary}
          slug="editorial-portrait"
          studioName="Lumiere Studio"
          studioEmail="hello@lumiere.com"
        />,
      );
      expect(html).toContain('text-neutral-600 dark:text-neutral-400 mt-0.5');
      expect(html).toContain('publicBooking.confirmation.googleMeetNotice');
      expect(html).not.toContain('text-neutral-500');
    });

    it('renders in-person location details and handles custom location text', () => {
      const html = renderToStaticMarkup(
        <BookingConfirmationView
          summary={createMockSummary({
            locationType: 'in_person',
            locationDetails: 'Studio B, Floor 2, Main Street 42',
            meetUrl: null,
          })}
          slug="editorial-portrait"
          studioName="Lumiere Studio"
        />,
      );
      expect(html).toContain('Studio B, Floor 2, Main Street 42');
      expect(html).not.toContain('https://meet.google.com');
    });

    it('renders phone location details', () => {
      const html = renderToStaticMarkup(
        <BookingConfirmationView
          summary={createMockSummary({
            locationType: 'phone',
            locationDetails: '+49 30 12345678',
            meetUrl: null,
          })}
          slug="editorial-portrait"
          studioName="Lumiere Studio"
        />,
      );
      expect(html).toContain('+49 30 12345678');
    });

    it('renders "Book Another Session" button when onBookAnother prop is provided', () => {
      const onBookAnother = vi.fn();
      const html = renderToStaticMarkup(
        <BookingConfirmationView
          summary={baseSummary}
          slug="editorial-portrait"
          studioName="Lumiere Studio"
          onBookAnother={onBookAnother}
        />,
      );
      expect(html).toContain('publicBooking.confirmation.bookAnother');
    });

    it('handles fallback date formatting on invalid timezone and calls downloadBookingIcs', () => {
      const onDownload = vi.fn();
      const html = renderToStaticMarkup(
        <BookingConfirmationView
          summary={createMockSummary({
            timezone: 'Invalid/Nonexistent_Timezone',
          })}
          slug="editorial-portrait"
          studioName="Lumiere Studio"
          onDownload={onDownload}
        />,
      );
      expect(html).toContain('publicBooking.confirmation.title');

      // Test downloadBookingIcs helper directly
      downloadBookingIcs(
        'editorial-portrait',
        baseSummary,
        'Lumiere Studio',
        'hello@lumiere.com',
        onDownload,
      );
      expect(onDownload).toHaveBeenCalledTimes(1);
    });

    it('handles unknown locationType fallback', () => {
      const html = renderToStaticMarkup(
        <BookingConfirmationView
          summary={createMockSummary({
            locationType: 'custom_heliport',
            locationDetails: null,
          })}
          slug="editorial-portrait"
          studioName="Lumiere Studio"
        />,
      );
      expect(html).toContain('In Person');
    });

    it('downloadBookingIcs handles missing window/document gracefully', () => {
      const origWindow = globalThis.window;
      Reflect.deleteProperty(globalThis, 'window');

      expect(() => {
        downloadBookingIcs('test', baseSummary, 'Lumiere Studio');
      }).not.toThrow();

      (globalThis as { window?: unknown }).window = origWindow;
    });

    it('downloadBookingIcs triggers browser blob download and onDownload callback', () => {
      const origWindow = globalThis.window;
      const origDoc = globalThis.document;

      try {
        const mockUrl = 'blob:http://localhost/test-blob-123';
        const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue(mockUrl);
        const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

        const mockClick = vi.fn();
        const mockLink = {
          href: '',
          setAttribute: vi.fn(),
          click: mockClick,
        };

        const appendSpy = vi.fn();
        const removeSpy = vi.fn();
        const createElementSpy = vi.fn().mockReturnValue(mockLink);

        globalThis.window = {} as unknown as Window & typeof globalThis;
        globalThis.document = {
          body: {
            appendChild: appendSpy,
            removeChild: removeSpy,
          },
          createElement: createElementSpy,
        } as unknown as Document;

        const onDownload = vi.fn();
        downloadBookingIcs(
          'session-abc',
          baseSummary,
          'Lumiere Studio',
          'info@lumiere.com',
          onDownload,
        );

        expect(onDownload).toHaveBeenCalledTimes(1);
        expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
        expect(appendSpy).toHaveBeenCalledWith(mockLink);
        expect(mockClick).toHaveBeenCalledTimes(1);
        expect(removeSpy).toHaveBeenCalledWith(mockLink);
        expect(revokeObjectURLSpy).toHaveBeenCalledWith(mockUrl);

        createObjectURLSpy.mockRestore();
        revokeObjectURLSpy.mockRestore();
      } finally {
        globalThis.window = origWindow;
        globalThis.document = origDoc;
      }
    });

    it('downloadBookingIcs passes studioEmail to buildBookingIcsParams', () => {
      const onDownload = vi.fn();
      downloadBookingIcs('slug-1', baseSummary, 'Studio North', 'north@example.com', onDownload);
      expect(onDownload).toHaveBeenCalledTimes(1);
    });

    it('executeBookingIcsDownload manages downloading state and invokes callback', () => {
      const onDownload = vi.fn();
      const stateHistory: boolean[] = [];
      const setDownloading = (val: boolean) => stateHistory.push(val);

      executeBookingIcsDownload(
        'slug-1',
        baseSummary,
        'Studio North',
        'north@example.com',
        onDownload,
        setDownloading,
      );

      expect(onDownload).toHaveBeenCalledTimes(1);
      expect(stateHistory).toEqual([true, false]);
    });
  });

  describe('PublicBookingScheduler (AC-1, AC-2, AC-7)', () => {
    const bookingType = {
      id: '019a1111-2222-7000-8000-000000000001',
      slug: 'wedding-consult',
      title: 'Wedding Consultation',
      description: 'Discuss wedding photography packages and timelines.',
      durationMinutes: 45,
      locationType: 'google_meet',
      locationDetails: null,
    };
    const mockSlot = createMockSlot();

    it('renders scheduler in English with full layout and timezone selection', () => {
      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioEmail="info@lumiere.com"
          studioTimezone="Europe/Berlin"
          locale="en"
        />,
      );
      expect(html).toContain('Lumiere Studio');
      expect(html).toContain('Wedding Consultation');
      expect(html).toContain('Discuss wedding photography packages and timelines.');
      expect(html).toContain('45'); // duration
      expect(html).toContain('publicBooking.slotPicker.timezoneLabel');
      expect(html).toContain('publicBooking.slotPicker.selectDate');
    });

    it('I2-U01: renders slot picker available slots header with text-neutral-600 dark:text-neutral-400 for >= 4.5:1 contrast', () => {
      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioEmail="info@lumiere.com"
          studioTimezone="Europe/Berlin"
          locale="en"
        />,
      );
      expect(html).toContain(
        'text-xs font-semibold text-neutral-600 dark:text-neutral-400 uppercase tracking-wider mb-3',
      );
      expect(html).not.toContain('text-neutral-500');
    });

    it('renders scheduler in German with in-person location', () => {
      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={{
            ...bookingType,
            locationType: 'in_person',
            locationDetails: 'Studio Berlin-Mitte',
          }}
          studioName="Fotostudio Berlin"
          studioEmail="kontakt@fotostudio.de"
          studioTimezone="Europe/Berlin"
          locale="de"
        />,
      );
      expect(html).toContain('Fotostudio Berlin');
      expect(html).toContain('Studio Berlin-Mitte');
    });

    it('renders scheduler with phone location type', () => {
      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={{
            ...bookingType,
            locationType: 'phone',
            locationDetails: null,
          }}
          studioName="Fotostudio Berlin"
          studioTimezone="Europe/Berlin"
          locale="en"
        />,
      );
      expect(html).toContain('publicBooking.sessionDetails.phone');
    });

    it('renders Step 2 attendee form when initialSelectedSlot is provided', () => {
      const mockSlot = createMockSlot();

      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
          initialSelectedSlot={mockSlot}
          initialAttendeeName="Marcus Vance"
          initialAttendeeEmail="marcus@example.com"
          initialAttendeeNotes="Need studio lighting setup."
        />,
      );

      expect(html).toContain('publicBooking.form.title');
      expect(html).toContain('publicBooking.form.name');
      expect(html).toContain('publicBooking.form.email');
      expect(html).toContain('publicBooking.form.notes');
      expect(html).toContain('publicBooking.form.submit');
      expect(html).toContain('Marcus Vance');
      expect(html).toContain('marcus@example.com');
      expect(html).toContain('Need studio lighting setup.');
      expect(html).toContain('website_url'); // honeypot
    });

    it('renders field errors and error alert banner in attendee form (I1-U02, I1-U03)', () => {
      const mockSlot = createMockSlot();

      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
          initialSelectedSlot={mockSlot}
          initialErrorBanner="This slot was just reserved by another client."
          initialFieldErrors={{
            attendeeName: 'Name is required',
            attendeeEmail: 'Valid email is required',
          }}
          initialSubmitting={true}
        />,
      );

      expect(html).toContain('This slot was just reserved by another client.');
      expect(html).toContain('Name is required');
      expect(html).toContain('Valid email is required');
      expect(html).toContain('publicBooking.form.submitting');

      // I1-U03: aria-invalid and aria-describedby linked to role="alert" error elements
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain('aria-describedby="attendee-name-error"');
      expect(html).toContain('id="attendee-name-error"');
      expect(html).toContain('aria-describedby="attendee-email-error"');
      expect(html).toContain('id="attendee-email-error"');

      // I1-U02: WCAG 2.2 AA compliant contrast colors (text-red-600 dark:text-red-400)
      expect(html).toContain('text-red-600');
    });

    it('I1-U01: uses text-primary-foreground on selected date button, submit button, and Add to Calendar button', () => {
      const mockSlot = createMockSlot();
      const htmlPicker = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
        />,
      );
      // Calendar day button selected state uses text-primary-foreground
      expect(htmlPicker).toContain('text-primary-foreground');

      const htmlForm = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
          initialSelectedSlot={mockSlot}
        />,
      );
      // Submit button uses text-primary-foreground
      expect(htmlForm).toContain('text-primary-foreground');
    });

    it('I1-U04: renders localized weekday column headers via i18n keys', () => {
      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="de"
        />,
      );
      expect(html).toContain('publicBooking.calendar.days.mon');
      expect(html).toContain('publicBooking.calendar.days.tue');
      expect(html).toContain('publicBooking.calendar.days.wed');
      expect(html).toContain('publicBooking.calendar.days.thu');
      expect(html).toContain('publicBooking.calendar.days.fri');
      expect(html).toContain('publicBooking.calendar.days.sat');
      expect(html).toContain('publicBooking.calendar.days.sun');
    });

    it('renders confirmation view when initialConfirmedBooking is set', () => {
      const mockSummary = createMockSummary({
        appointmentId: '019a9999-0000-7000-8000-000000000001',
        bookingTypeTitle: 'Wedding Consultation',
        durationMinutes: 45,
        startsAt: '2026-11-20T10:00:00.000Z',
        endsAt: '2026-11-20T10:45:00.000Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'Marcus Vance',
        attendeeEmail: 'marcus@example.com',
        locationType: 'google_meet',
        meetUrl: 'https://meet.google.com/test-meet',
      });

      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
          initialConfirmedBooking={mockSummary}
        />,
      );

      expect(html).toContain('publicBooking.confirmation.title');
      expect(html).toContain('Wedding Consultation (45 min)');
      expect(html).toContain('marcus@example.com');
    });

    it('renders slot buttons when initialSlots has slots for selected date', () => {
      const mockSlots = [
        createMockSlot({
          starts_at: '2026-10-23T09:00:00.000Z',
          ends_at: '2026-10-23T09:45:00.000Z',
          startsAt: '2026-10-23T09:00:00.000Z',
          endsAt: '2026-10-23T09:45:00.000Z',
          startsAtUtc: '2026-10-23T09:00:00.000Z',
          endsAtUtc: '2026-10-23T09:45:00.000Z',
          date: '2026-10-23',
          formattedTime: '09:00 - 09:45',
        }),
        createMockSlot({
          starts_at: '2026-10-23T11:00:00.000Z',
          ends_at: '2026-10-23T11:45:00.000Z',
          startsAt: '2026-10-23T11:00:00.000Z',
          endsAt: '2026-11-23T11:45:00.000Z',
          startsAtUtc: '2026-10-23T11:00:00.000Z',
          endsAtUtc: '2026-10-23T11:45:00.000Z',
          date: '2026-10-23',
          formattedTime: '11:00 - 11:45',
        }),
      ];

      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
          initialVisitorTimezone="America/New_York"
          initialSlots={mockSlots}
          initialSelectedDate="2026-10-23"
        />,
      );

      expect(html).toContain('slot-2026-10-23T09:00:00.000Z');
      expect(html).toContain('slot-2026-10-23T11:00:00.000Z');
    });

    it('renders empty slots message when no slots are available for the selected date', () => {
      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={{
            ...bookingType,
            description: null,
            locationType: 'in_person',
            locationDetails: null,
          }}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
          initialSlots={[]}
          initialLoadingSlots={false}
          initialSelectedDate="2026-10-23"
        />,
      );

      expect(html).toContain('publicBooking.slotPicker.noSlots');
      expect(html).toContain('publicBooking.sessionDetails.inPerson');
    });

    it('renders same timezone and solving pow status', () => {
      const mockSlot = createMockSlot();

      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
          initialVisitorTimezone="Europe/Berlin"
          initialSelectedSlot={mockSlot}
          initialPowStatus="solving"
        />,
      );

      expect(html).toContain('publicBooking.form.powVerifying');
    });

    it('renders loading skeleton when initialLoadingSlots is true', () => {
      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
          initialLoadingSlots={true}
        />,
      );
      expect(html).toContain('publicBooking.slotPicker.loadingSlots');
    });

    it('renders empty slots message when no slots are available for selected date', () => {
      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
          initialSlots={[]}
          initialLoadingSlots={false}
          initialSelectedDate="2026-11-10"
        />,
      );
      expect(html).toContain('publicBooking.slotPicker.noSlotsOnDate');
    });

    it('renders error banner when initialErrorBanner is provided', () => {
      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
          initialErrorBanner="Payment or system error occurred"
        />,
      );
      expect(html).toContain('Payment or system error occurred');
    });

    it('renders validation field errors when initialFieldErrors is populated', () => {
      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
          initialSelectedSlot={mockSlot}
          initialFieldErrors={{
            attendeeName: 'Name is required',
            attendeeEmail: 'Valid email is required',
          }}
        />,
      );
      expect(html).toContain('Name is required');
      expect(html).toContain('Valid email is required');
    });

    it('renders disabled submitting button state when initialSubmitting is true', () => {
      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
          initialSelectedSlot={mockSlot}
          initialSubmitting={true}
        />,
      );
      expect(html).toContain('publicBooking.form.submitting');
    });

    it('renders verified pow status label when initialPowStatus is not solving', () => {
      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
          initialSelectedSlot={mockSlot}
          initialPowStatus="verified"
        />,
      );
      expect(html).toContain('publicBooking.form.powVerified');
    });

    it('renders detected timezone option when visitor timezone is not in COMMON_TIMEZONES', () => {
      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
          initialVisitorTimezone="Atlantic/Reykjavik"
        />,
      );
      expect(html).toContain('Atlantic/Reykjavik (detected)');
    });

    it('renders indicator dot on dates with slots that are not currently selected', () => {
      const today = new Date();
      const currentMonthStr = today.toISOString().slice(0, 7);
      const unselectedDate = `${currentMonthStr}-28`;
      const selectedDate = `${currentMonthStr}-25`;

      const unselectedSlot = createMockSlot({
        date: unselectedDate,
        starts_at: `${unselectedDate}T10:00:00Z`,
        ends_at: `${unselectedDate}T11:00:00Z`,
      });
      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
          initialSlots={[unselectedSlot]}
          initialSelectedDate={selectedDate}
        />,
      );
      expect(html).toContain(`calendar-day-${unselectedDate}`);
    });

    it('renders studio time label under visitor time when timezones differ in slot list', () => {
      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={bookingType}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
          initialVisitorTimezone="America/New_York"
          initialSelectedDate="2026-11-20"
          initialSlots={[
            createMockSlot({
              date: '2026-11-20',
              starts_at: '2026-11-20T14:00:00Z',
              ends_at: '2026-11-20T15:00:00Z',
              startsAtUtc: '2026-11-20T14:00:00Z',
              endsAtUtc: '2026-11-20T15:00:00Z',
            }),
          ]}
        />,
      );
      expect(html).toContain('slot-2026-11-20T14:00:00Z');
      expect(html).toContain('Berlin');
    });

    it('renders phone location details when locationType is phone with custom details', () => {
      const html = renderToStaticMarkup(
        <PublicBookingScheduler
          bookingType={{
            ...bookingType,
            locationType: 'phone',
            locationDetails: '+49 30 999888',
          }}
          studioName="Lumiere Studio"
          studioTimezone="Europe/Berlin"
          locale="en"
        />,
      );
      expect(html).toContain('+49 30 999888');
    });
  });

  describe('Booking Helpers: validateBookingAttendeeForm & buildBookingIcsParams', () => {
    it('validates form inputs for English locale', () => {
      const invalidEmpty = validateBookingAttendeeForm('', '', 'en');
      expect(invalidEmpty.isValid).toBe(false);
      expect(invalidEmpty.errors.attendeeName).toBe('Name is required');
      expect(invalidEmpty.errors.attendeeEmail).toBe('Valid email is required');

      const invalidEmail = validateBookingAttendeeForm('John Doe', 'invalid-email', 'en');
      expect(invalidEmail.isValid).toBe(false);
      expect(invalidEmail.errors.attendeeName).toBeUndefined();
      expect(invalidEmail.errors.attendeeEmail).toBe('Valid email is required');

      const valid = validateBookingAttendeeForm('John Doe', 'john@example.com', 'en');
      expect(valid.isValid).toBe(true);
      expect(valid.errors).toEqual({});
    });

    it('validates form inputs for German locale', () => {
      const invalid = validateBookingAttendeeForm('', '', 'de');
      expect(invalid.isValid).toBe(false);
      expect(invalid.errors.attendeeName).toBe('Bitte geben Sie Ihren Namen ein');
      expect(invalid.errors.attendeeEmail).toBe('Bitte geben Sie eine gültige E-Mail-Adresse ein');
    });

    it('buildBookingIcsParams handles all location types and optional fields', () => {
      const base = {
        appointmentId: 'apt-1',
        title: 'Headshot - Sarah Connor',
        bookingTypeTitle: 'Headshot',
        durationMinutes: 60,
        timezone: 'Europe/Berlin',
        startsAt: '2026-11-01T10:00:00.000Z',
        endsAt: '2026-11-01T11:00:00.000Z',
        attendeeName: 'Sarah Connor',
        attendeeEmail: 'sarah@example.com',
      };

      // 1. Google meet with URL
      const meetWithUrl = buildBookingIcsParams(
        createMockSummary({
          ...base,
          locationType: 'google_meet',
          locationDetails: null,
          meetUrl: 'https://meet.google.com/abc',
        }),
        'Studio Cyberdyne',
        'contact@cyberdyne.com',
      );
      expect(meetWithUrl.location).toBe('https://meet.google.com/abc');
      expect(meetWithUrl.description).toContain('Google Meet Link: https://meet.google.com/abc');
      expect(meetWithUrl.description).toContain('Studio Contact: contact@cyberdyne.com');

      // 2. Google meet without URL
      const meetWithoutUrl = buildBookingIcsParams(
        createMockSummary({
          ...base,
          locationType: 'google_meet',
          locationDetails: null,
          meetUrl: null,
        }),
        'Studio Cyberdyne',
      );
      expect(meetWithoutUrl.location).toBe('Google Meet');
      expect(meetWithoutUrl.description).toContain(
        'Google Meet video link will be sent prior to the session.',
      );

      // 3. In person with location details
      const inPersonWithDetails = buildBookingIcsParams(
        createMockSummary({
          ...base,
          locationType: 'in_person',
          locationDetails: 'Room 101',
          meetUrl: null,
        }),
        'Studio Cyberdyne',
      );
      expect(inPersonWithDetails.location).toBe('Room 101');
      expect(inPersonWithDetails.description).toContain('Location Details: Room 101');

      // 4. In person without location details
      const inPersonNoDetails = buildBookingIcsParams(
        createMockSummary({
          ...base,
          locationType: 'in_person',
          locationDetails: null,
          meetUrl: null,
        }),
        'Studio Cyberdyne',
      );
      expect(inPersonNoDetails.location).toBe('Studio Cyberdyne');

      // 5. Phone
      const phone = buildBookingIcsParams(
        createMockSummary({
          ...base,
          locationType: 'phone',
          locationDetails: null,
          meetUrl: null,
        }),
        'Studio Cyberdyne',
      );
      expect(phone.location).toBe('Phone Call');
    });

    it('calculates next and previous months across year boundaries', () => {
      expect(getNextMonth(2026, 11)).toEqual({ year: 2027, month: 0 });
      expect(getNextMonth(2026, 5)).toEqual({ year: 2026, month: 6 });
      expect(getPrevMonth(2026, 0)).toEqual({ year: 2025, month: 11 });
      expect(getPrevMonth(2026, 5)).toEqual({ year: 2026, month: 4 });
      expect(formatMonthYear(2026, 9, 'en')).toBe('October 2026');
      expect(formatMonthYear(2026, 9, 'de')).toBe('Oktober 2026');
    });

    it('fetchBookingChallenge handles success, failure, malformed, and thrown errors', async () => {
      const origFetch = globalThis.fetch;

      // 1. Success
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            algorithm: 'SHA-256',
            challenge: 'chal-123',
            maxnumber: 10000,
            salt: 'salt-1',
            signature: 'sig-1',
          }),
      });
      const resSuccess = await fetchBookingChallenge('consultation');
      expect(resSuccess?.challenge).toBe('chal-123');

      // 2. HTTP error
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
      });
      const resError = await fetchBookingChallenge('missing');
      expect(resError).toBeNull();

      // 3. Malformed JSON
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ unexpected: true }),
      });
      const resMalformed = await fetchBookingChallenge('consultation');
      expect(resMalformed).toBeNull();

      // 4. Exception thrown
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Network offline'));
      const resException = await fetchBookingChallenge('consultation');
      expect(resException).toBeNull();

      globalThis.fetch = origFetch;
    });

    it('detectVisitorTimezone detects valid timezone and falls back on error or empty string', () => {
      const detected = detectVisitorTimezone();
      expect(typeof detected).toBe('string');
      expect(detected.length).toBeGreaterThan(0);

      // 1. Fallback when DateTimeFormat throws
      const spyThrow = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () {
        throw new Error('Not supported');
      });
      expect(detectVisitorTimezone('Europe/Vienna')).toBe('Europe/Vienna');
      spyThrow.mockRestore();

      // 2. Fallback when resolved timezone is empty string
      const spyEmpty = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () {
        return {
          resolvedOptions: () => ({ timeZone: '' }),
        } as unknown as Intl.DateTimeFormat;
      });
      expect(detectVisitorTimezone('UTC')).toBe('UTC');
      spyEmpty.mockRestore();
    });

    it('formatLocalTime formats time and handles invalid timezone via UTC fallback', () => {
      const date = new Date('2026-11-10T14:30:00Z');
      const formatted = formatLocalTime(date, 'UTC');
      expect(formatted).toBe('14:30');

      const fallback = formatLocalTime(date, 'Invalid/Timezone');
      expect(fallback).toBe('14:30');
    });

    it('formatSlotWithStudioTime handles same tz, different tz, and city formatting without slashes', () => {
      const slot = {
        startsAtUtc: '2026-11-10T14:00:00Z',
        endsAtUtc: '2026-11-10T15:00:00Z',
      };
      // Same timezone
      const same = formatSlotWithStudioTime(slot, 'Europe/Berlin', 'Europe/Berlin');
      expect(same.combinedLabel).toBe(same.visitorTime);

      // Different timezone
      const diff = formatSlotWithStudioTime(slot, 'America/New_York', 'Europe/Berlin');
      expect(diff.combinedLabel).toContain('Berlin');

      // Studio timezone without slash (e.g. UTC)
      const noSlash = formatSlotWithStudioTime(slot, 'Europe/Berlin', 'UTC');
      expect(noSlash.combinedLabel).toContain('UTC');
    });

    it('generateMonthGrid handles month starting on Sunday (e.g. March 2026)', () => {
      // 2026-03-01 is Sunday (UTC day 0)
      const grid = generateMonthGrid(2026, 2, new Set(['2026-03-15']), '2026-03-10');
      expect(grid.length).toBeGreaterThanOrEqual(4);
      // Sunday start should produce 6 padding days from previous month (Feb 23 to Feb 28)
      expect(grid[0]?.[0]?.isCurrentMonth).toBe(false);
      expect(grid[0]?.[6]?.isCurrentMonth).toBe(true);
      expect(grid[0]?.[6]?.dayNumber).toBe(1);
    });

    it('formatMonthYear handles Intl exception with fallback string formatting', () => {
      const spyThrow = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () {
        throw new Error('Locale error');
      });

      const fallback = formatMonthYear(2026, 9, 'en');
      expect(fallback).toBe('2026-10');

      spyThrow.mockRestore();
    });

    it('fetchBookingChallenge handles non-object and incomplete responses', async () => {
      const origFetch = globalThis.fetch;

      // 1. Primitive non-object JSON
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(123),
      });
      expect(await fetchBookingChallenge('test')).toBeNull();

      // 2. Missing signature
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            challenge: 'chal',
            salt: 'salt',
          }),
      });
      expect(await fetchBookingChallenge('test')).toBeNull();

      globalThis.fetch = origFetch;
    });

    it('groupSlotsByDate groups multiple slots correctly', () => {
      const slot1 = {
        startsAtUtc: '2026-11-10T10:00:00Z',
        endsAtUtc: '2026-11-10T11:00:00Z',
        date: '2026-11-10',
        startTime: '10:00',
        endTime: '11:00',
      };
      const slot2 = {
        startsAtUtc: '2026-11-10T14:00:00Z',
        endsAtUtc: '2026-11-10T15:00:00Z',
        date: '2026-11-10',
        startTime: '14:00',
        endTime: '15:00',
      };
      const slot3 = {
        startsAtUtc: '2026-11-11T09:00:00Z',
        endsAtUtc: '2026-11-11T10:00:00Z',
        date: '2026-11-11',
        startTime: '09:00',
        endTime: '10:00',
      };

      const grouped = groupSlotsByDate([
        slot1,
        slot2,
        slot3,
      ] as unknown as import('@/server/calendar/availability').AvailableSlot[]);
      expect(grouped['2026-11-10']?.length).toBe(2);
      expect(grouped['2026-11-11']?.length).toBe(1);
    });

    it('resolveBookingLocationLabel maps google_meet, in_person, and phone', () => {
      const tMock = (k: string) => `translated.${k}`;

      // 1. google_meet
      expect(
        resolveBookingLocationLabel({ locationType: 'google_meet', locationDetails: null }, tMock),
      ).toBe('translated.sessionDetails.googleMeet');

      // 2. in_person with custom details
      expect(
        resolveBookingLocationLabel(
          { locationType: 'in_person', locationDetails: 'Studio Room 4' },
          tMock,
        ),
      ).toBe('Studio Room 4');

      // 3. phone without details
      expect(
        resolveBookingLocationLabel({ locationType: 'phone', locationDetails: null }, tMock),
      ).toBe('translated.sessionDetails.phone');

      // 4. in_person without details
      expect(
        resolveBookingLocationLabel({ locationType: 'in_person', locationDetails: null }, tMock),
      ).toBe('translated.sessionDetails.inPerson');
    });

    it('buildPublicBookingSubmission trims strings and handles optional phone and notes', () => {
      const slot = createMockSlot({
        startsAtUtc: '2026-11-10T10:00:00Z',
        endsAtUtc: '2026-11-10T11:00:00Z',
      });

      // With phone and notes
      const payloadWithOptional = buildPublicBookingSubmission({
        slug: 'portrait-consult',
        slot,
        visitorTimezone: 'Europe/Berlin',
        name: '  Elena Vance  ',
        email: '  elena@example.com  ',
        phone: '  +49 30 111222  ',
        notes: '  Need headshots  ',
        honeypot: '',
        powPayload: 'valid-pow',
        locale: 'en',
      });

      expect(payloadWithOptional.attendeeName).toBe('Elena Vance');
      expect(payloadWithOptional.attendeeEmail).toBe('elena@example.com');
      expect(payloadWithOptional.attendeePhone).toBe('+49 30 111222');
      expect(payloadWithOptional.attendeeNotes).toBe('Need headshots');
      expect(payloadWithOptional.website_url).toBe('');

      // Without phone and notes
      const payloadWithoutOptional = buildPublicBookingSubmission({
        slug: 'portrait-consult',
        slot,
        visitorTimezone: 'Europe/Berlin',
        name: 'Elena',
        email: 'elena@example.com',
        phone: '   ',
        notes: '',
        honeypot: undefined,
        powPayload: 'valid-pow',
        locale: 'de',
      });

      expect(payloadWithoutOptional.attendeePhone).toBeUndefined();
      expect(payloadWithoutOptional.attendeeNotes).toBeUndefined();
      expect(payloadWithoutOptional.website_url).toBe('');
      expect(payloadWithoutOptional.locale).toBe('de');
    });

    it('processBookingSubmissionResult handles success, collision, rate-limit, and fieldErrors', () => {
      const tMock = (k: string) => `translated.${k}`;

      // 1. Success
      const successResult = processBookingSubmissionResult(
        {
          success: true,
          data: createMockSummary(),
        },
        tMock,
      );
      expect(successResult.confirmedBooking).toBeDefined();
      expect(successResult.shouldResetSlot).toBe(false);

      // 2. Collision
      const collisionResult = processBookingSubmissionResult(
        {
          success: false,
          collision: true,
          error: 'Slot conflict',
        },
        tMock,
      );
      expect(collisionResult.errorBanner).toBe('Slot conflict');
      expect(collisionResult.shouldResetSlot).toBe(true);
      expect(collisionResult.shouldReloadSlots).toBe(true);

      // 2b. Collision with default error
      const collisionDefaultResult = processBookingSubmissionResult(
        {
          success: false,
          collision: true,
        },
        tMock,
      );
      expect(collisionDefaultResult.errorBanner).toBe('translated.errors.collision');

      // 3. Rate limited
      const rateLimitedResult = processBookingSubmissionResult(
        {
          success: false,
          code: 'RATE_LIMITED',
        },
        tMock,
      );
      expect(rateLimitedResult.errorBanner).toBe('translated.errors.rateLimited');
      expect(rateLimitedResult.shouldResetSlot).toBe(false);

      // 4. Field errors
      const fieldErrorsResult = processBookingSubmissionResult(
        {
          success: false,
          fieldErrors: { attendeeName: 'Required' },
        },
        tMock,
      );
      expect(fieldErrorsResult.fieldErrors.attendeeName).toBe('Required');
      expect(fieldErrorsResult.errorBanner).toBe('translated.errors.general');

      // 5. Generic error
      const genericResult = processBookingSubmissionResult(
        {
          success: false,
        },
        tMock,
      );
      expect(genericResult.errorBanner).toBe('translated.errors.general');
    });
  });

  describe('BookingPage Server Component & generateMetadata (AC-1, AC-9)', () => {
    it('generateMetadata returns closed notice metadata if booking type is not active', async () => {
      vi.mocked(findBookingTypeBySlug).mockResolvedValueOnce(null);
      vi.mocked(getStudioSettings).mockResolvedValueOnce(createMockStudioSettings());

      const metadata = await generateMetadata({
        params: Promise.resolve({ locale: 'en', slug: 'inactive-slug' }),
      });
      expect(metadata.title).toBe('Bookings Closed | Studio Nord');
      expect(metadata.robots).toEqual({ index: false, follow: false });
    });

    it('generateMetadata returns active title and description', async () => {
      vi.mocked(findBookingTypeBySlug).mockResolvedValueOnce(
        createMockBookingType({
          slug: 'portrait-session',
          title: 'Portrait Session',
          description: 'Custom studio session',
          isActive: true,
        }),
      );
      vi.mocked(getStudioSettings).mockResolvedValueOnce(createMockStudioSettings());

      const metadata = await generateMetadata({
        params: Promise.resolve({ locale: 'en', slug: 'portrait-session' }),
      });
      expect(metadata.title).toBe('Portrait Session | Studio Nord');
      expect(metadata.description).toBe('Custom studio session');
    });

    it('generateMetadata falls back to default studio name if getStudioSettings throws', async () => {
      vi.mocked(findBookingTypeBySlug).mockResolvedValueOnce(
        createMockBookingType({
          slug: 'portrait-session',
          title: 'Portrait Session',
          description: null,
          isActive: true,
        }),
      );
      vi.mocked(getStudioSettings).mockRejectedValueOnce(new Error('DB connection failure'));

      const metadata = await generateMetadata({
        params: Promise.resolve({ locale: 'en', slug: 'portrait-session' }),
      });
      expect(metadata.title).toBe('Portrait Session | Ownlight Studio');
      expect(metadata.description).toBe(
        'Book an appointment for Portrait Session with Ownlight Studio',
      );
    });

    it('BookingPage renders BookingClosedView when booking type is null or inactive', async () => {
      vi.mocked(findBookingTypeBySlug).mockResolvedValueOnce(
        createMockBookingType({
          id: 'bt-inactive',
          slug: 'closed-session',
          title: 'Old Mini Session',
          isActive: false,
        }),
      );
      vi.mocked(getStudioSettings).mockResolvedValueOnce(
        createMockStudioSettings({
          studio_name: 'Lumiere',
          timezone: 'Europe/Paris',
        }),
      );

      const jsx = await BookingPage({
        params: Promise.resolve({ locale: 'en', slug: 'closed-session' }),
      });
      const html = renderToStaticMarkup(jsx);
      expect(html).toContain('Old Mini Session');
      expect(html).toContain('publicBooking.closed.title');
    });

    it('BookingPage renders PublicBookingScheduler when booking type is active', async () => {
      vi.mocked(findBookingTypeBySlug).mockResolvedValueOnce(
        createMockBookingType({
          id: 'bt-active',
          slug: 'headshot-30',
          title: 'Express Headshot',
          description: 'Quick professional headshot',
          durationMinutes: 30,
          locationType: 'in_person',
          locationDetails: 'Studio 1',
          isActive: true,
        }),
      );
      vi.mocked(getStudioSettings).mockResolvedValueOnce(
        createMockStudioSettings({
          studio_name: 'Lumiere',
          timezone: 'Europe/Berlin',
        }),
      );

      const jsx = await BookingPage({
        params: Promise.resolve({ locale: 'en', slug: 'headshot-30' }),
      });
      const html = renderToStaticMarkup(jsx);
      expect(html).toContain('Express Headshot');
      expect(html).toContain('Quick professional headshot');
    });

    it('BookingPage throws notFound if locale is invalid', async () => {
      await expect(
        BookingPage({
          params: Promise.resolve({ locale: 'fr', slug: 'headshot-30' }),
        }),
      ).rejects.toThrow('NEXT_NOT_FOUND');
      expect(mockNotFound).toHaveBeenCalled();
    });

    it('BookingPage falls back to default studio settings if getStudioSettings throws', async () => {
      vi.mocked(findBookingTypeBySlug).mockResolvedValueOnce(
        createMockBookingType({
          id: 'bt-active',
          slug: 'headshot-30',
          title: 'Express Headshot',
          durationMinutes: 30,
          locationType: 'google_meet',
          isActive: true,
        }),
      );
      vi.mocked(getStudioSettings).mockRejectedValueOnce(new Error('DB failure'));

      const jsx = await BookingPage({
        params: Promise.resolve({ locale: 'en', slug: 'headshot-30' }),
      });
      const html = renderToStaticMarkup(jsx);
      expect(html).toContain('Express Headshot');
      expect(html).toContain('Ownlight Studio');
    });
  });

  describe('Public Challenge Route Handler (AC-7, AC-8)', () => {
    it('returns 404 when booking type is inactive or missing', async () => {
      vi.mocked(findBookingTypeBySlug).mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/public/book/missing/challenge');
      const res = await challengeRouteHandler(req, {
        params: Promise.resolve({ slug: 'missing' }),
      });

      expect(res.status).toBe(404);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(await res.text()).toBe('Booking type not found or closed');
    });

    it('returns 429 when rate limit is exceeded', async () => {
      vi.mocked(findBookingTypeBySlug).mockResolvedValueOnce(
        createMockBookingType({
          id: 'bt-1',
          slug: 'active-slug',
          isActive: true,
        }),
      );
      const deniedResult: RateLimitCheckResult = {
        allowed: false,
        remaining: 0,
        resetAt: new Date(Date.now() + 60000),
      };
      vi.mocked(consumeRateLimit).mockResolvedValueOnce(deniedResult);

      const req = new NextRequest('http://localhost:3000/api/public/book/active-slug/challenge');
      const res = await challengeRouteHandler(req, {
        params: Promise.resolve({ slug: 'active-slug' }),
      });

      expect(res.status).toBe(429);
      expect(await res.text()).toBe('Too Many Requests');
    });

    it('returns 200 with ALTCHA challenge when active and allowed', async () => {
      vi.mocked(findBookingTypeBySlug).mockResolvedValueOnce(
        createMockBookingType({
          id: 'bt-1',
          slug: 'active-slug',
          isActive: true,
        }),
      );
      const allowedResult: RateLimitCheckResult = {
        allowed: true,
        remaining: 25,
        resetAt: new Date(Date.now() + 60000),
      };
      vi.mocked(consumeRateLimit).mockResolvedValueOnce(allowedResult);

      const req = new NextRequest('http://localhost:3000/api/public/book/active-slug/challenge');
      const res = await challengeRouteHandler(req, {
        params: Promise.resolve({ slug: 'active-slug' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const body = (await res.json()) as { challenge: string; algorithm: string };
      expect(body.challenge).toBe('abc123challenge');
      expect(body.algorithm).toBe('SHA-256');
    });

    it('returns 503 if an unexpected database error occurs', async () => {
      vi.mocked(findBookingTypeBySlug).mockRejectedValueOnce(new Error('PostgreSQL unavailable'));

      const req = new NextRequest('http://localhost:3000/api/public/book/active-slug/challenge');
      const res = await challengeRouteHandler(req, {
        params: Promise.resolve({ slug: 'active-slug' }),
      });

      expect(res.status).toBe(503);
      expect(await res.text()).toBe('Service Unavailable');
    });
  });
});
