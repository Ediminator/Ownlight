import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    `translated-${key}${values ? JSON.stringify(values) : ''}`,
}));

vi.mock('@/server/integrations/google/calendar-actions', () => ({
  startGoogleCalendarAuthAction: vi.fn().mockResolvedValue({
    success: true,
    data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?scope=calendar' },
  }),
  toggleGoogleCalendarSyncAction: vi.fn().mockResolvedValue({
    success: true,
    data: { enabled: true },
  }),
  selectGoogleCalendarAction: vi.fn().mockResolvedValue({
    success: true,
    data: { calendarId: 'primary' },
  }),
  triggerManualCalendarSyncAction: vi.fn().mockResolvedValue({
    success: true,
    data: { outboundProcessed: 0, outboundFailed: 0, inboundSynced: true },
  }),
  getGoogleCalendarSettingsAction: vi.fn().mockResolvedValue({
    success: true,
    data: {
      status: 'connected',
      configured: true,
      connected: true,
      hasCalendarScope: true,
      calendarSyncEnabled: true,
      selectedCalendarId: 'primary',
      lastCalendarSyncAt: new Date('2026-10-23T12:00:00Z'),
      lastCalendarSyncError: null,
      calendars: [{ id: 'primary', summary: 'Primary Calendar', primary: true }],
    },
  }),
}));

import { GoogleCalendarSyncCard } from '@/components/settings/google-calendar-sync-card';

describe('GoogleCalendarSyncCard Component (AC-7, AC-9)', () => {
  it('AC-7: renders card in disconnected / needs-auth state with authorize button', () => {
    const html = renderToStaticMarkup(
      <GoogleCalendarSyncCard
        configured={true}
        connected={true}
        hasCalendarScope={false}
        calendarSyncEnabled={false}
        locale="en"
      />,
    );

    expect(html).toContain('data-testid="google-calendar-card"');
    expect(html).toContain('data-testid="calendar-scope-indicator"');
    expect(html).toContain('translated-calendarScopeIndicatorNeedsAuth');
    expect(html).toContain('data-testid="calendar-authorize-button"');
    expect(html).toContain('translated-authorizeCalendarButton');
    expect(html).toContain('data-testid="calendar-sync-toggle"');
    expect(html).toContain('data-testid="calendar-select-dropdown"');
    expect(html).toContain('data-testid="calendar-sync-now-button"');
  });

  it('AC-7: renders card in authorized state with active connection status', () => {
    const html = renderToStaticMarkup(
      <GoogleCalendarSyncCard
        configured={true}
        connected={true}
        hasCalendarScope={true}
        calendarSyncEnabled={true}
        selectedCalendarId="primary"
        lastCalendarSyncAt={new Date('2026-10-23T12:00:00Z')}
        locale="en"
      />,
    );

    expect(html).toContain('data-testid="google-calendar-card"');
    expect(html).toContain('translated-calendarScopeIndicatorGranted');
    expect(html).not.toContain('data-testid="calendar-authorize-button"');
    expect(html).toContain('translated-calendarStatusActive');
    expect(html).toContain('translated-calendarLastSyncedAt');
  });

  it('AC-7: displays sync error banner when lastCalendarSyncError is present', () => {
    const html = renderToStaticMarkup(
      <GoogleCalendarSyncCard
        configured={true}
        connected={true}
        hasCalendarScope={true}
        calendarSyncEnabled={true}
        selectedCalendarId="primary"
        lastCalendarSyncError="Google API 503 Service Unavailable"
        locale="en"
      />,
    );

    expect(html).toContain('data-testid="calendar-last-error"');
    expect(html).toContain('translated-calendarLastSyncError');
    expect(html).toContain('Google API 503 Service Unavailable');
    expect(html).toContain('role="alert"');
  });

  it('AC-7: conforms to WCAG 2.2 AA button styles with text-primary-foreground', () => {
    const html = renderToStaticMarkup(
      <GoogleCalendarSyncCard
        configured={true}
        connected={true}
        hasCalendarScope={false}
        calendarSyncEnabled={false}
        locale="en"
      />,
    );

    // Primary button should pair bg-primary with text-primary-foreground
    expect(html).toContain('bg-primary text-primary-foreground');
    expect(html).not.toContain('bg-primary text-white');
  });

  describe('google-calendar-sync-helper pure unit tests', () => {
    it('formats sync dates correctly and handles null or invalid inputs', async () => {
      const { formatCalendarSyncDate } =
        await import('@/components/settings/google-calendar-sync-helper');

      expect(formatCalendarSyncDate(null, 'en')).toBeNull();
      expect(formatCalendarSyncDate(undefined, 'en')).toBeNull();
      expect(formatCalendarSyncDate('invalid-date', 'en')).toBeNull();

      const validDate = new Date('2026-10-23T12:00:00Z');
      const formatted = formatCalendarSyncDate(validDate, 'en');
      expect(formatted).toBeTruthy();

      const stringFormatted = formatCalendarSyncDate('2026-10-23T12:00:00Z', 'en');
      expect(stringFormatted).toBeTruthy();

      // Invalid locale fallback / error handling
      expect(formatCalendarSyncDate(validDate, 'invalid-locale-!!!')).toBeNull();
    });

    it('computes calendar sync state accurately across connection permutations', async () => {
      const { getCalendarSyncState } =
        await import('@/components/settings/google-calendar-sync-helper');

      expect(
        getCalendarSyncState({ connected: false, hasCalendarScope: false, syncEnabled: false }),
      ).toBe('disconnected');

      expect(
        getCalendarSyncState({ connected: true, hasCalendarScope: false, syncEnabled: true }),
      ).toBe('disconnected');

      expect(
        getCalendarSyncState({ connected: true, hasCalendarScope: true, syncEnabled: false }),
      ).toBe('inactive');

      expect(
        getCalendarSyncState({ connected: true, hasCalendarScope: true, syncEnabled: true }),
      ).toBe('active');
    });

    it('formats calendar dropdown options with primary indicators and fallbacks', async () => {
      const { formatCalendarOptions } =
        await import('@/components/settings/google-calendar-sync-helper');

      // Null / empty array fallback
      expect(formatCalendarOptions(null)).toEqual([
        { id: 'primary', label: 'Primary Calendar', isPrimary: true },
      ]);
      expect(formatCalendarOptions([])).toEqual([
        { id: 'primary', label: 'Primary Calendar', isPrimary: true },
      ]);

      // Populated list
      const calendars = [
        { id: 'cal-1', summary: 'Studio Bookings', primary: true },
        { id: 'cal-2', summary: 'Personal Calendar' },
      ];
      const result = formatCalendarOptions(calendars, 'Main Calendar');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'cal-1',
        label: 'Studio Bookings (Main Calendar)',
        isPrimary: true,
      });
      expect(result[1]).toEqual({
        id: 'cal-2',
        label: 'Personal Calendar',
        isPrimary: false,
      });
    });
  });
});
