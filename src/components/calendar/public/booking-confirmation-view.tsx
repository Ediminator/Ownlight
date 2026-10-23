'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { generateSingleEventIcs } from '@/lib/calendar/ics';
import { buildBookingIcsParams } from './booking-helpers';
import type { ConfirmedBookingSummary } from '@/server/calendar/public-actions';

export interface BookingConfirmationViewProps {
  summary: ConfirmedBookingSummary;
  slug: string;
  studioName: string;
  studioEmail?: string | null;
  onBookAnother?: () => void;
  onDownload?: () => void;
}

/**
 * Generates and downloads the RFC 5545 .ics file for a confirmed booking.
 */
export function downloadBookingIcs(
  slug: string,
  summary: ConfirmedBookingSummary,
  studioName: string,
  studioEmail?: string | null,
  onDownload?: () => void,
) {
  const icsParams = buildBookingIcsParams(summary, studioName, studioEmail);
  const icsContent = generateSingleEventIcs(icsParams);

  if (onDownload) {
    onDownload();
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `booking-${slug}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

/**
 * Executes RFC 5545 ICS download workflow with progress state management.
 */
export function executeBookingIcsDownload(
  slug: string,
  summary: ConfirmedBookingSummary,
  studioName: string,
  studioEmail?: string | null,
  onDownload?: () => void,
  setDownloading?: (v: boolean) => void,
) {
  try {
    setDownloading?.(true);
    downloadBookingIcs(slug, summary, studioName, studioEmail, onDownload);
  } finally {
    setDownloading?.(false);
  }
}

/**
 * Confirmation view rendered after a successful booking reservation (AC-3, AC-11).
 * Displays session details and provides instant in-browser RFC 5545 .ics file download.
 */
export function BookingConfirmationView({
  summary,
  slug,
  studioName,
  studioEmail,
  onBookAnother,
  onDownload,
}: BookingConfirmationViewProps) {
  const t = useTranslations('publicBooking.confirmation');
  const [downloading, setDownloading] = useState(false);

  // Format date and time in visitor's preferred timezone
  const startDate = new Date(summary.startsAt);
  const endDate = new Date(summary.endsAt);

  let formattedDate = summary.startsAt;
  let formattedTimeRange = `${summary.startsAt} – ${summary.endsAt}`;
  try {
    const dateFormatter = new Intl.DateTimeFormat(undefined, {
      timeZone: summary.timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const timeFormatter = new Intl.DateTimeFormat(undefined, {
      timeZone: summary.timezone,
      hour: '2-digit',
      minute: '2-digit',
    });

    formattedDate = dateFormatter.format(startDate);
    formattedTimeRange = `${timeFormatter.format(startDate)} – ${timeFormatter.format(endDate)} (${summary.timezone})`;
  } catch {
    formattedDate = startDate.toLocaleDateString();
    formattedTimeRange = `${startDate.toLocaleTimeString()} – ${endDate.toLocaleTimeString()} (${summary.timezone})`;
  }

  const handleDownloadIcs = () => {
    executeBookingIcsDownload(slug, summary, studioName, studioEmail, onDownload, setDownloading);
  };

  return (
    <div
      className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8"
      aria-labelledby="confirmation-heading"
    >
      <div className="sm:mx-auto sm:w-full sm:max-w-xl px-4">
        {/* Studio Branding */}
        <header className="text-center mb-6">
          <p className="text-sm font-semibold tracking-wide uppercase text-neutral-600 dark:text-neutral-400">
            {studioName}
          </p>
        </header>

        {/* Confirmation Card */}
        <div className="bg-white dark:bg-neutral-900 shadow-sm border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 sm:p-8">
          {/* Success Check Icon */}
          <div className="mx-auto flex items-center justify-center h-14 w-14 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 mb-5">
            <svg
              className="h-8 w-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          <div className="text-center">
            <h1
              id="confirmation-heading"
              className="text-2xl font-bold text-neutral-900 dark:text-neutral-100"
            >
              {t('title')}
            </h1>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{t('subtitle')}</p>
            <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
              {t('emailNotice', { email: summary.attendeeEmail })}
            </p>
          </div>

          {/* Session Details Box */}
          <div className="mt-8 bg-neutral-50 dark:bg-neutral-800/50 rounded-xl p-5 border border-neutral-200/80 dark:border-neutral-700/60 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-400">
              {t('sessionSummary')}
            </h2>

            {/* Session Name */}
            <div className="flex items-start">
              <span className="text-neutral-400 mr-3 mt-0.5" aria-hidden="true">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </span>
              <div>
                <p className="text-xs text-neutral-600 dark:text-neutral-400">{t('session')}</p>
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {summary.bookingTypeTitle} ({summary.durationMinutes} min)
                </p>
              </div>
            </div>

            {/* Date and Time */}
            <div className="flex items-start">
              <span className="text-neutral-400 mr-3 mt-0.5" aria-hidden="true">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </span>
              <div>
                <p className="text-xs text-neutral-600 dark:text-neutral-400">{t('when')}</p>
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {formattedDate}
                </p>
                <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
                  {formattedTimeRange}
                </p>
              </div>
            </div>

            {/* Location */}
            <div className="flex items-start">
              <span className="text-neutral-400 mr-3 mt-0.5" aria-hidden="true">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              </span>
              <div>
                <p className="text-xs text-neutral-600 dark:text-neutral-400">{t('location')}</p>
                {summary.locationType === 'google_meet' ? (
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    Google Meet
                    <span className="block text-xs font-normal text-neutral-600 dark:text-neutral-400 mt-0.5">
                      {t('googleMeetNotice')}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {summary.locationDetails ??
                      (summary.locationType === 'phone' ? 'Phone Call' : 'In Person')}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-8 space-y-3">
            <button
              type="button"
              data-testid="add-to-calendar-btn"
              onClick={handleDownloadIcs}
              disabled={downloading}
              className="w-full inline-flex items-center justify-center px-5 py-3 border border-transparent text-sm font-medium rounded-xl text-primary-foreground bg-primary hover:bg-primary/90 shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors cursor-pointer"
            >
              <svg
                className="w-5 h-5 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              {t('addToCalendar')}
            </button>

            {onBookAnother && (
              <button
                type="button"
                onClick={onBookAnother}
                className="w-full inline-flex items-center justify-center px-4 py-2.5 border border-neutral-300 dark:border-neutral-700 text-sm font-medium rounded-xl text-neutral-700 dark:text-neutral-300 bg-white dark:bg-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors cursor-pointer"
              >
                {t('bookAnother')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
