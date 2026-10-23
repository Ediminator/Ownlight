'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  detectVisitorTimezone,
  formatSlotWithStudioTime,
  groupSlotsByDate,
  generateMonthGrid,
  getNextMonth,
  getPrevMonth,
  formatMonthYear,
  fetchBookingChallenge,
  validateBookingAttendeeForm,
  COMMON_TIMEZONES,
} from './booking-helpers';
import { BookingConfirmationView } from './booking-confirmation-view';
import {
  getPublicAvailableSlotsAction,
  submitPublicBookingAction,
  type ConfirmedBookingSummary,
} from '@/server/calendar/public-actions';
import type { AvailableSlot } from '@/server/calendar/availability';
import {
  createAltchaSolverController,
  type PowSolverStatus,
} from '@/app/[locale]/f/_components/pow-solver';

export interface PublicBookingTypeProps {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  durationMinutes: number;
  locationType: string;
  locationDetails?: string | null;
}

export interface PublicBookingSchedulerProps {
  bookingType: PublicBookingTypeProps;
  studioName: string;
  studioEmail?: string | null;
  studioTimezone: string;
  locale: 'en' | 'de';
  initialVisitorTimezone?: string;
  initialSlots?: AvailableSlot[];
  initialLoadingSlots?: boolean;
  initialSelectedDate?: string;
  initialSelectedSlot?: AvailableSlot | null;
  initialAttendeeName?: string;
  initialAttendeeEmail?: string;
  initialAttendeePhone?: string;
  initialAttendeeNotes?: string;
  initialHoneypot?: string;
  initialSubmitting?: boolean;
  initialErrorBanner?: string | null;
  initialFieldErrors?: Record<string, string>;
  initialConfirmedBooking?: ConfirmedBookingSummary | null;
  initialPowStatus?: PowSolverStatus;
  initialPowPayload?: string;
}

/**
 * Public responsive booking scheduler component (AC-1, AC-2, AC-3, AC-6, AC-7, AC-8).
 * Manages visitor timezone detection, responsive date/slot selection, ALTCHA PoW solving,
 * and serializable reservation submission.
 */
export function PublicBookingScheduler({
  bookingType,
  studioName,
  studioEmail,
  studioTimezone,
  locale,
  initialVisitorTimezone,
  initialSlots,
  initialLoadingSlots,
  initialSelectedDate,
  initialSelectedSlot,
  initialAttendeeName,
  initialAttendeeEmail,
  initialAttendeePhone,
  initialAttendeeNotes,
  initialHoneypot,
  initialSubmitting,
  initialErrorBanner,
  initialFieldErrors,
  initialConfirmedBooking,
  initialPowStatus,
  initialPowPayload,
}: PublicBookingSchedulerProps) {
  const t = useTranslations('publicBooking');

  // 1. Timezone detection & state (AC-1)
  const [visitorTimezone, setVisitorTimezone] = useState<string>(
    () => initialVisitorTimezone ?? detectVisitorTimezone(studioTimezone),
  );

  // 2. Calendar view state
  const today = new Date();
  const [viewYear, setViewYear] = useState<number>(today.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(today.getMonth());
  const todayStr = today.toISOString().slice(0, 10);

  // 3. Available slots state
  const [slots, setSlots] = useState<AvailableSlot[]>(initialSlots ?? []);
  const [loadingSlots, setLoadingSlots] = useState<boolean>(
    initialLoadingSlots ?? (initialSlots ? false : true),
  );
  const [selectedDate, setSelectedDate] = useState<string>(initialSelectedDate ?? todayStr);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(
    initialSelectedSlot ?? null,
  );

  // 4. Form state
  const [attendeeName, setAttendeeName] = useState(initialAttendeeName ?? '');
  const [attendeeEmail, setAttendeeEmail] = useState(initialAttendeeEmail ?? '');
  const [attendeePhone, setAttendeePhone] = useState(initialAttendeePhone ?? '');
  const [attendeeNotes, setAttendeeNotes] = useState(initialAttendeeNotes ?? '');
  const [honeypot, setHoneypot] = useState(initialHoneypot ?? '');
  const [submitting, setSubmitting] = useState(initialSubmitting ?? false);
  const [errorBanner, setErrorBanner] = useState<string | null>(initialErrorBanner ?? null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(initialFieldErrors ?? {});
  const [confirmedBooking, setConfirmedBooking] = useState<ConfirmedBookingSummary | null>(
    initialConfirmedBooking ?? null,
  );

  // 5. ALTCHA PoW solver state (AC-7)
  const [powStatus, setPowStatus] = useState<PowSolverStatus>(initialPowStatus ?? 'idle');
  const [powPayload, setPowPayload] = useState<string>(initialPowPayload ?? '');
  const solverControllerRef = useRef<ReturnType<typeof createAltchaSolverController> | null>(null);

  // Initialize and run ALTCHA solver
  useEffect(() => {
    const controller = createAltchaSolverController(bookingType.slug, {
      fetchChallenge: fetchBookingChallenge,
      onStatusChange: setPowStatus,
      onPayloadChange: setPowPayload,
    });
    solverControllerRef.current = controller;
    void controller.start();

    return () => {
      controller.abort();
    };
  }, [bookingType.slug]);

  // Load available slots for the current month and timezone (AC-1, AC-2)
  const loadSlots = useCallback(
    async (year: number, month: number, tz: string) => {
      setLoadingSlots(true);
      setErrorBanner(null);

      // Start from 1st of month to last of next month for 60-day window
      const start = new Date(Date.UTC(year, month, 1));
      const end = new Date(Date.UTC(year, month + 2, 0));

      const startDateStr = start.toISOString().slice(0, 10);
      const endDateStr = end.toISOString().slice(0, 10);

      try {
        const res = await getPublicAvailableSlotsAction({
          slug: bookingType.slug,
          startDate: startDateStr,
          endDate: endDateStr,
          timezone: tz,
        });

        if (res.success && res.data) {
          setSlots(res.data.slots);
          // If selected date has no slots, default to first date that has slots
          const datesWithSlots = new Set(res.data.slots.map((s) => s.date));
          if (!datesWithSlots.has(selectedDate) && res.data.slots.length > 0) {
            const firstSlotDate = res.data.slots[0]?.date;
            if (firstSlotDate) {
              setSelectedDate(firstSlotDate);
            }
          }
        }
      } catch {
        setErrorBanner(t('errors.general'));
      } finally {
        setLoadingSlots(false);
      }
    },
    [bookingType.slug, selectedDate, t],
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await Promise.resolve();
      if (!cancelled) {
        void loadSlots(viewYear, viewMonth, visitorTimezone);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [viewYear, viewMonth, visitorTimezone, loadSlots]);

  // Month navigation handlers
  const handlePrevMonth = () => {
    const prev = getPrevMonth(viewYear, viewMonth);
    setViewYear(prev.year);
    setViewMonth(prev.month);
  };

  const handleNextMonth = () => {
    const next = getNextMonth(viewYear, viewMonth);
    setViewYear(next.year);
    setViewMonth(next.month);
  };

  // Group slots by date
  const groupedSlots = groupSlotsByDate(slots);
  const availableDatesSet = new Set(Object.keys(groupedSlots));
  const monthWeeks = generateMonthGrid(viewYear, viewMonth, availableDatesSet, todayStr);
  const slotsForSelectedDate = groupedSlots[selectedDate] ?? [];

  // Handle Form Submission (AC-3, AC-6, AC-7, AC-8)
  const handleSubmitBooking = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorBanner(null);
    setFieldErrors({});

    // Client-side quick validation
    const validation = validateBookingAttendeeForm(attendeeName, attendeeEmail, locale);
    if (!validation.isValid) {
      setFieldErrors(validation.errors);
      return;
    }

    if (!selectedSlot) {
      setErrorBanner(t('slotPicker.selectDate'));
      return;
    }

    setSubmitting(true);

    try {
      // 1. Ensure ALTCHA PoW is solved
      let altchaPayload = powPayload;
      if (!altchaPayload && solverControllerRef.current) {
        const solved = await solverControllerRef.current.ensureVerifiedPayload();
        if (solved) {
          altchaPayload = solved;
        }
      }

      if (!altchaPayload) {
        setErrorBanner(t('errors.powFailed'));
        setSubmitting(false);
        return;
      }

      // 2. Submit booking to server action
      const submission = {
        slug: bookingType.slug,
        startsAt: selectedSlot.startsAtUtc,
        endsAt: selectedSlot.endsAtUtc,
        timezone: visitorTimezone,
        attendeeName: attendeeName.trim(),
        attendeeEmail: attendeeEmail.trim(),
        attendeePhone: attendeePhone.trim() || undefined,
        attendeeNotes: attendeeNotes.trim() || undefined,
        website_url: honeypot,
        altcha_payload: altchaPayload,
        locale,
      };

      const res = await submitPublicBookingAction(submission);

      if (res.success && res.data) {
        setConfirmedBooking(res.data);
      } else {
        if (res.collision) {
          // Double-booking collision (AC-6)
          setErrorBanner(res.error ?? t('errors.collision'));
          // Deselect slot and refresh available slots
          setSelectedSlot(null);
          void loadSlots(viewYear, viewMonth, visitorTimezone);
        } else if (res.code === 'RATE_LIMITED') {
          // Rate limit exceeded (AC-8)
          setErrorBanner(res.error ?? t('errors.rateLimited'));
        } else if (res.fieldErrors) {
          setFieldErrors(res.fieldErrors);
          setErrorBanner(res.error ?? t('errors.general'));
        } else {
          setErrorBanner(res.error ?? t('errors.general'));
        }
      }
    } catch {
      setErrorBanner(t('errors.general'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleBookAnother = () => {
    setConfirmedBooking(null);
    setSelectedSlot(null);
    void loadSlots(viewYear, viewMonth, visitorTimezone);
  };

  // If already confirmed, render confirmation view (AC-3, AC-11)
  if (confirmedBooking) {
    return (
      <BookingConfirmationView
        summary={confirmedBooking}
        slug={bookingType.slug}
        studioName={studioName}
        studioEmail={studioEmail}
        onBookAnother={handleBookAnother}
      />
    );
  }

  // Location string mapping
  const locationLabel =
    bookingType.locationType === 'google_meet'
      ? t('sessionDetails.googleMeet')
      : (bookingType.locationDetails ??
        (bookingType.locationType === 'phone'
          ? t('sessionDetails.phone')
          : t('sessionDetails.inPerson')));

  return (
    <div
      className="min-h-screen bg-neutral-50 dark:bg-neutral-950 py-8 px-4 sm:px-6 lg:px-8 flex flex-col justify-center"
      aria-labelledby="booking-title"
    >
      <div className="max-w-4xl mx-auto w-full bg-white dark:bg-neutral-900 rounded-3xl shadow-sm border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-neutral-200 dark:divide-neutral-800">
          {/* ========================================================= */}
          {/* LEFT PANEL: Session Details & Studio Info                 */}
          {/* ========================================================= */}
          <div className="p-6 sm:p-8 md:col-span-5 flex flex-col justify-between bg-neutral-50/50 dark:bg-neutral-900/50">
            <div>
              <header className="mb-6">
                <p className="text-xs font-semibold tracking-wider uppercase text-neutral-500 dark:text-neutral-400">
                  {studioName}
                </p>
                <h1
                  id="booking-title"
                  className="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100"
                >
                  {bookingType.title}
                </h1>
              </header>

              <div className="space-y-3.5 mb-6 text-sm text-neutral-600 dark:text-neutral-300">
                {/* Duration */}
                <div className="flex items-center text-neutral-700 dark:text-neutral-300">
                  <svg
                    className="w-4 h-4 mr-2.5 text-neutral-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="font-medium">
                    {t('sessionDetails.duration', { duration: bookingType.durationMinutes })}
                  </span>
                </div>

                {/* Location */}
                <div className="flex items-start text-neutral-700 dark:text-neutral-300">
                  <svg
                    className="w-4 h-4 mr-2.5 mt-0.5 text-neutral-400 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  <span className="text-xs leading-relaxed">{locationLabel}</span>
                </div>
              </div>

              {/* Description */}
              {bookingType.description && (
                <div className="mt-4 pt-4 border-t border-neutral-200/60 dark:border-neutral-800 text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed whitespace-pre-wrap">
                  {bookingType.description}
                </div>
              )}
            </div>

            {/* Timezone Indicator and Selector in Left Panel footer */}
            <div className="mt-8 pt-6 border-t border-neutral-200/60 dark:border-neutral-800">
              <label
                htmlFor="timezone-select"
                className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
              >
                {t('slotPicker.timezoneLabel')}
              </label>
              <div className="relative">
                <select
                  id="timezone-select"
                  data-testid="timezone-select"
                  value={visitorTimezone}
                  onChange={(e) => {
                    setVisitorTimezone(e.target.value);
                  }}
                  className="w-full text-xs rounded-lg border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 py-2 pl-3 pr-8 focus:ring-primary focus:border-primary shadow-sm"
                >
                  {!COMMON_TIMEZONES.includes(
                    visitorTimezone as (typeof COMMON_TIMEZONES)[number],
                  ) && <option value={visitorTimezone}>{visitorTimezone} (detected)</option>}
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1.5 text-[11px] text-neutral-500 dark:text-neutral-500">
                Studio: {studioTimezone}
              </p>
            </div>
          </div>

          {/* ========================================================= */}
          {/* RIGHT PANEL: Date/Slot Picker OR Attendee Form            */}
          {/* ========================================================= */}
          <div className="p-6 sm:p-8 md:col-span-7">
            {/* Top Error Alert Banner */}
            {errorBanner && (
              <div
                role="alert"
                data-testid="booking-error-banner"
                className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-300 flex items-start"
              >
                <svg
                  className="w-5 h-5 mr-2.5 mt-0.5 shrink-0 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span>{errorBanner}</span>
              </div>
            )}

            {!selectedSlot ? (
              /* Step 1: Calendar Grid & Slot Picker */
              <div className="space-y-6">
                <div>
                  <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
                    {t('slotPicker.selectDate')}
                  </h2>

                  {/* Month Navigation Header */}
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      {formatMonthYear(viewYear, viewMonth, locale)}
                    </span>
                    <div className="flex space-x-1">
                      <button
                        type="button"
                        aria-label="Previous month"
                        onClick={handlePrevMonth}
                        className="p-1.5 rounded-lg text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 19l-7-7 7-7"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        aria-label="Next month"
                        onClick={handleNextMonth}
                        className="p-1.5 rounded-lg text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Calendar Grid */}
                  <div role="grid" aria-label="Calendar date picker" className="space-y-1">
                    {/* Days of Week Header */}
                    <div
                      role="row"
                      className="grid grid-cols-7 text-center text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-2"
                    >
                      <span role="columnheader">Mo</span>
                      <span role="columnheader">Tu</span>
                      <span role="columnheader">We</span>
                      <span role="columnheader">Th</span>
                      <span role="columnheader">Fr</span>
                      <span role="columnheader">Sa</span>
                      <span role="columnheader">Su</span>
                    </div>

                    {/* Calendar Grid Weeks & Cells */}
                    {monthWeeks.map((week, weekIdx) => (
                      <div
                        key={`week-${String(weekIdx)}`}
                        role="row"
                        className="grid grid-cols-7 gap-1"
                      >
                        {week.map((cell, cellIdx) => {
                          const isSelected = cell.dateStr === selectedDate;
                          const isClickable = cell.hasSlots && !cell.isPast;

                          return (
                            <div
                              key={`${cell.dateStr}-${String(cellIdx)}`}
                              role="gridcell"
                              className="w-full flex justify-center"
                            >
                              <button
                                type="button"
                                disabled={!isClickable}
                                data-testid={`calendar-day-${cell.dateStr}`}
                                aria-label={`${String(cell.dayNumber)}, ${cell.dateStr}${cell.hasSlots ? ' - Available slots' : ''}`}
                                onClick={() => {
                                  setSelectedDate(cell.dateStr);
                                }}
                                className={`
                                  relative h-9 w-full flex items-center justify-center rounded-lg text-xs font-medium transition-colors
                                  ${
                                    isSelected
                                      ? 'bg-primary text-white font-semibold shadow-sm'
                                      : cell.hasSlots && !cell.isPast
                                        ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 hover:bg-primary/20 dark:hover:bg-primary/30 cursor-pointer font-semibold'
                                        : 'text-neutral-300 dark:text-neutral-700 cursor-not-allowed'
                                  }
                                  ${!cell.isCurrentMonth ? 'opacity-40' : ''}
                                `}
                              >
                                {cell.dayNumber}
                                {cell.hasSlots && !cell.isPast && !isSelected && (
                                  <span className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" />
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Available Slots List for Selected Date */}
                <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800">
                  <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">
                    {t('slotPicker.availableSlots', { date: selectedDate })}
                  </h3>

                  {loadingSlots ? (
                    <div className="py-8 text-center text-xs text-neutral-500">
                      <div className="inline-block animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent mb-2" />
                      <p>{t('slotPicker.loadingSlots')}</p>
                    </div>
                  ) : slotsForSelectedDate.length === 0 ? (
                    <div className="py-8 text-center text-xs text-neutral-500 dark:text-neutral-400">
                      {t('slotPicker.noSlotsOnDate')}
                    </div>
                  ) : (
                    <div
                      data-testid="slots-list"
                      className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1"
                    >
                      {slotsForSelectedDate.map((slot) => {
                        const formatted = formatSlotWithStudioTime(
                          slot,
                          visitorTimezone,
                          studioTimezone,
                        );

                        return (
                          <button
                            key={slot.startsAtUtc}
                            type="button"
                            data-testid={`slot-${slot.startsAtUtc}`}
                            onClick={() => {
                              setSelectedSlot(slot);
                            }}
                            aria-label={t('slotPicker.selectSlotAria', {
                              time: formatted.combinedLabel,
                            })}
                            className="flex flex-col items-start px-3.5 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:border-primary hover:bg-primary/5 dark:hover:bg-primary/10 transition-colors text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                              {formatted.visitorTime}
                            </span>
                            {visitorTimezone !== studioTimezone && (
                              <span className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                                {formatted.studioTime}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Step 2: Attendee Form when slot is selected */
              <div>
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
                  {t('form.title')}
                </h2>

                {/* Selected Slot Banner */}
                <div className="mb-6 p-4 rounded-2xl bg-primary/5 dark:bg-primary/10 border border-primary/20 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="p-2 rounded-xl bg-primary/10 text-primary">
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                    </span>
                    <div>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        {t('form.selectedSlot')}
                      </p>
                      <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        {selectedDate} ·{' '}
                        {
                          formatSlotWithStudioTime(selectedSlot, visitorTimezone, studioTimezone)
                            .combinedLabel
                        }
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSlot(null);
                    }}
                    className="text-xs font-medium text-primary hover:underline px-2.5 py-1.5 rounded-lg hover:bg-primary/10 transition-colors cursor-pointer"
                  >
                    {t('form.changeSlot')}
                  </button>
                </div>

                {/* Reservation Form */}
                <form
                  onSubmit={(e) => {
                    void handleSubmitBooking(e);
                  }}
                  className="space-y-4"
                  noValidate
                >
                  {/* Honeypot Field (AC-7) */}
                  <div
                    aria-hidden="true"
                    style={{
                      display: 'none',
                    }}
                  >
                    <label htmlFor="booking_website_url">{t('form.honeypotLabel')}</label>
                    <input
                      id="booking_website_url"
                      type="text"
                      name="website_url"
                      tabIndex={-1}
                      autoComplete="off"
                      value={honeypot}
                      onChange={(e) => {
                        setHoneypot(e.target.value);
                      }}
                    />
                  </div>

                  {/* Name Input */}
                  <div>
                    <label
                      htmlFor="attendee-name"
                      className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
                    >
                      {t('form.nameLabel')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="attendee-name"
                      data-testid="attendee-name-input"
                      type="text"
                      required
                      value={attendeeName}
                      onChange={(e) => {
                        setAttendeeName(e.target.value);
                      }}
                      placeholder={t('form.namePlaceholder')}
                      className={`w-full rounded-xl border text-sm px-3.5 py-2.5 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:ring-2 focus:ring-primary shadow-sm ${
                        fieldErrors.attendeeName
                          ? 'border-red-500'
                          : 'border-neutral-300 dark:border-neutral-700'
                      }`}
                    />
                    {fieldErrors.attendeeName && (
                      <p className="mt-1 text-xs text-red-500">{fieldErrors.attendeeName}</p>
                    )}
                  </div>

                  {/* Email Input */}
                  <div>
                    <label
                      htmlFor="attendee-email"
                      className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
                    >
                      {t('form.emailLabel')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="attendee-email"
                      data-testid="attendee-email-input"
                      type="email"
                      required
                      value={attendeeEmail}
                      onChange={(e) => {
                        setAttendeeEmail(e.target.value);
                      }}
                      placeholder={t('form.emailPlaceholder')}
                      className={`w-full rounded-xl border text-sm px-3.5 py-2.5 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:ring-2 focus:ring-primary shadow-sm ${
                        fieldErrors.attendeeEmail
                          ? 'border-red-500'
                          : 'border-neutral-300 dark:border-neutral-700'
                      }`}
                    />
                    {fieldErrors.attendeeEmail && (
                      <p className="mt-1 text-xs text-red-500">{fieldErrors.attendeeEmail}</p>
                    )}
                  </div>

                  {/* Phone Input */}
                  <div>
                    <label
                      htmlFor="attendee-phone"
                      className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
                    >
                      {t('form.phoneLabel')}
                    </label>
                    <input
                      id="attendee-phone"
                      data-testid="attendee-phone-input"
                      type="tel"
                      value={attendeePhone}
                      onChange={(e) => {
                        setAttendeePhone(e.target.value);
                      }}
                      placeholder={t('form.phonePlaceholder')}
                      className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 text-sm px-3.5 py-2.5 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:ring-2 focus:ring-primary shadow-sm"
                    />
                  </div>

                  {/* Notes Input */}
                  <div>
                    <label
                      htmlFor="attendee-notes"
                      className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
                    >
                      {t('form.notesLabel')}
                    </label>
                    <textarea
                      id="attendee-notes"
                      data-testid="attendee-notes-input"
                      rows={3}
                      value={attendeeNotes}
                      onChange={(e) => {
                        setAttendeeNotes(e.target.value);
                      }}
                      placeholder={t('form.notesPlaceholder')}
                      className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 text-sm px-3.5 py-2.5 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:ring-2 focus:ring-primary shadow-sm resize-none"
                    />
                  </div>

                  {/* Submit Button */}
                  <div className="pt-2">
                    <button
                      type="submit"
                      data-testid="confirm-booking-btn"
                      disabled={submitting}
                      className="w-full inline-flex items-center justify-center px-5 py-3 border border-transparent text-sm font-semibold rounded-xl text-white bg-primary hover:bg-primary/90 shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {submitting ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                          {t('form.submitting')}
                        </>
                      ) : (
                        t('form.submit')
                      )}
                    </button>
                  </div>

                  {/* ALTCHA badge indicator */}
                  <div className="text-center pt-1">
                    <p className="text-[11px] text-neutral-400 dark:text-neutral-500 inline-flex items-center">
                      <svg
                        className="w-3.5 h-3.5 mr-1 text-emerald-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                        />
                      </svg>
                      {powStatus === 'solving' ? t('form.powVerifying') : t('form.powVerified')}
                    </p>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
