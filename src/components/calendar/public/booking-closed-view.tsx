'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

export interface BookingClosedViewProps {
  studioName: string;
  bookingTypeTitle?: string;
  studioEmail?: string | null;
}

/**
 * Polite notice rendered when a booking link is inactive or unavailable (AC-9).
 * Preserves studio branding without exposing slot picker or reservation controls.
 */
export function BookingClosedView({
  studioName,
  bookingTypeTitle,
  studioEmail,
}: BookingClosedViewProps) {
  const t = useTranslations('publicBooking.closed');

  return (
    <div
      className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8"
      aria-labelledby="closed-heading"
    >
      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
        {/* Studio Branding */}
        <header className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary mb-3">
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <p className="text-sm font-semibold tracking-wide uppercase text-neutral-600 dark:text-neutral-400">
            {studioName}
          </p>
          {bookingTypeTitle && (
            <p className="mt-1 text-lg font-medium text-neutral-900 dark:text-neutral-100">
              {bookingTypeTitle}
            </p>
          )}
        </header>

        {/* Closed Notice Card */}
        <div className="bg-white dark:bg-neutral-900 shadow-sm border border-neutral-200 dark:border-neutral-800 rounded-2xl p-8 text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 mb-4">
            <svg
              className="h-6 w-6"
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
          </div>

          <h1
            id="closed-heading"
            className="text-xl font-semibold text-neutral-900 dark:text-neutral-100"
          >
            {t('title')}
          </h1>

          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{t('description')}</p>

          {studioEmail && (
            <div className="mt-6 pt-6 border-t border-neutral-100 dark:border-neutral-800">
              <a
                href={`mailto:${studioEmail}`}
                className="inline-flex items-center text-sm font-medium text-primary hover:underline"
              >
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                {studioEmail}
              </a>
            </div>
          )}

          <div className="mt-6">
            <Link
              href="/"
              className="inline-flex items-center justify-center w-full px-4 py-2 text-sm font-medium rounded-lg text-neutral-700 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
            >
              {t('backHome')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
