import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import fs from 'node:fs';
import path from 'node:path';
import { buildGoogleAuthorizationUrl } from '@/server/integrations/google/service';
import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_CONTACTS_SCOPE,
  hasGoogleCalendarScope,
  hasGoogleContactsScope,
} from '@/server/integrations/google/constants';
import {
  formatCalendarEventSummary,
  sanitizeClientNameForCalendar,
} from '@/server/integrations/google/calendar-client';
import { calculateCalendarBackoffMs } from '@/server/worker/calendar-sync-worker';
import {
  formatCalendarSyncDate,
  getCalendarSyncState,
  formatCalendarOptions,
} from '@/components/settings/google-calendar-sync-helper';

describe('Google Calendar OAuth & Sync Unit Tests (TASK-0046)', () => {
  describe('AC-1: Incremental OAuth Scope Expansion & Authorization URL', () => {
    it('AC-1: generates OAuth authorization URL with include_granted_scopes: true and calendar scope', () => {
      const urlString = buildGoogleAuthorizationUrl({
        clientId: 'test-client-id-12345',
        state: 'test-state-value-12345678901234567890',
        codeChallenge: 'test-code-challenge-value',
        redirectUri: 'https://example.com/api/integrations/google/callback',
        scope: GOOGLE_CALENDAR_SCOPE,
        includeGrantedScopes: true,
      });

      const url = new URL(urlString);
      expect(url.searchParams.get('include_granted_scopes')).toBe('true');
      expect(url.searchParams.get('scope')).toBe(GOOGLE_CALENDAR_SCOPE);
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(url.searchParams.get('state')).toBe('test-state-value-12345678901234567890');
      expect(url.searchParams.get('code_challenge')).toBe('test-code-challenge-value');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('AC-1: supports requesting multiple combined scopes without breaking single-scope callers', () => {
      const combinedScope = `${GOOGLE_CONTACTS_SCOPE} ${GOOGLE_CALENDAR_SCOPE}`;
      const urlString = buildGoogleAuthorizationUrl({
        clientId: 'test-client-id-12345',
        state: 'test-state-combined',
        codeChallenge: 'challenge',
        redirectUri: 'https://example.com/callback',
        scope: combinedScope,
        includeGrantedScopes: true,
      });

      const url = new URL(urlString);
      expect(url.searchParams.get('scope')).toBe(combinedScope);
      expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    });

    it('I1-SEC01/02/03: hasGoogleCalendarScope parses space-delimited scopes and rejects spoofed URL substrings', () => {
      // Valid exact scopes
      expect(hasGoogleCalendarScope(GOOGLE_CALENDAR_SCOPE)).toBe(true);
      expect(hasGoogleCalendarScope('https://www.googleapis.com/auth/calendar')).toBe(true);
      expect(hasGoogleCalendarScope(`${GOOGLE_CONTACTS_SCOPE} ${GOOGLE_CALENDAR_SCOPE}`)).toBe(
        true,
      );
      expect(
        hasGoogleCalendarScope(
          `https://www.googleapis.com/auth/userinfo.profile ${GOOGLE_CALENDAR_SCOPE} https://www.googleapis.com/auth/contacts`,
        ),
      ).toBe(true);

      // Null, empty, or whitespace
      expect(hasGoogleCalendarScope(null)).toBe(false);
      expect(hasGoogleCalendarScope(undefined)).toBe(false);
      expect(hasGoogleCalendarScope('')).toBe(false);
      expect(hasGoogleCalendarScope('   ')).toBe(false);

      // Only contacts scope
      expect(hasGoogleCalendarScope(GOOGLE_CONTACTS_SCOPE)).toBe(false);

      // Spoofed URL substrings (regression test for CodeQL js/incomplete-url-substring-sanitization)
      expect(
        hasGoogleCalendarScope('https://www.googleapis.com/auth/calendar.events.attacker.com'),
      ).toBe(false);
      expect(
        hasGoogleCalendarScope(
          'https://attacker.com/https://www.googleapis.com/auth/calendar.events',
        ),
      ).toBe(false);
      expect(hasGoogleCalendarScope('https://www.googleapis.com/auth/calendars')).toBe(false);
      expect(hasGoogleCalendarScope('https://not-google.com/auth/calendar')).toBe(false);
    });

    it('hasGoogleContactsScope parses space-delimited scopes correctly', () => {
      expect(hasGoogleContactsScope(GOOGLE_CONTACTS_SCOPE)).toBe(true);
      expect(hasGoogleContactsScope('https://www.googleapis.com/auth/contacts.readonly')).toBe(
        true,
      );
      expect(hasGoogleContactsScope(GOOGLE_CALENDAR_SCOPE)).toBe(false);
      expect(hasGoogleContactsScope(null)).toBe(false);
      expect(hasGoogleContactsScope('https://attacker.com/auth/contacts')).toBe(false);
    });
  });

  describe('AC-4: PII Minimization and Event Summary Formatting', () => {
    it('AC-4: sanitizes full client name into First Name and Last Initial', () => {
      expect(sanitizeClientNameForCalendar('Robert Schumann')).toBe('Robert S.');
      expect(sanitizeClientNameForCalendar('Clara Wieck')).toBe('Clara W.');
      expect(sanitizeClientNameForCalendar('Prince')).toBe('Prince');
      expect(sanitizeClientNameForCalendar('')).toBe('Client');
      expect(sanitizeClientNameForCalendar(null)).toBe('Client');
    });

    it('AC-4: formats appointment event summary as [Studio] - [Title]: [First Name] [Last Initial]', () => {
      const summary = formatCalendarEventSummary({
        studioName: 'Lichtwerk Studio',
        entityType: 'appointment',
        title: 'Consultation',
        attendeeName: 'Robert Schumann',
      });
      expect(summary).toBe('Lichtwerk Studio - Consultation: Robert S.');
    });

    it('AC-4: formats shoot event summary with studio name and sanitized client name', () => {
      const summary = formatCalendarEventSummary({
        studioName: 'Moments Photography',
        entityType: 'shoot',
        title: 'Portrait Session',
        attendeeName: 'Johannes Brahms',
      });
      expect(summary).toBe('Moments Photography - Shoot: Portrait Session: Johannes B.');
    });

    it('AC-4: handles single word names or anonymous clients cleanly', () => {
      const summary = formatCalendarEventSummary({
        studioName: 'Atelier',
        entityType: 'appointment',
        title: 'Studio Booking',
        attendeeName: 'Cher',
      });
      expect(summary).toBe('Atelier - Studio Booking: Cher');
    });
  });

  describe('AC-6: Exponential Backoff Calculation on Rate Limiting', () => {
    it('AC-6: calculates exponential backoff for transient failures (attempts 1, 2, 3)', () => {
      const backoffAttempt1 = calculateCalendarBackoffMs(1);
      const backoffAttempt2 = calculateCalendarBackoffMs(2);
      const backoffAttempt3 = calculateCalendarBackoffMs(3);

      // Base 30s * 2^(attempt - 1) + up to 25% jitter
      expect(backoffAttempt1).toBeGreaterThanOrEqual(30_000);
      expect(backoffAttempt1).toBeLessThanOrEqual(37_500);

      expect(backoffAttempt2).toBeGreaterThanOrEqual(60_000);
      expect(backoffAttempt2).toBeLessThanOrEqual(75_000);

      expect(backoffAttempt3).toBeGreaterThanOrEqual(120_000);
      expect(backoffAttempt3).toBeLessThanOrEqual(150_000);
    });

    it('AC-6: clamps maximum exponential backoff to 1 hour', () => {
      const backoffHighAttempt = calculateCalendarBackoffMs(15);
      expect(backoffHighAttempt).toBeLessThanOrEqual(3_605_000);
    });
  });

  describe('AC-7: Calendar Sync View-Model Helpers', () => {
    it('AC-7: computes correct calendar sync status state', () => {
      expect(
        getCalendarSyncState({
          connected: false,
          hasCalendarScope: false,
          syncEnabled: false,
        }),
      ).toBe('disconnected');

      expect(
        getCalendarSyncState({
          connected: true,
          hasCalendarScope: false,
          syncEnabled: true,
        }),
      ).toBe('disconnected');

      expect(
        getCalendarSyncState({
          connected: true,
          hasCalendarScope: true,
          syncEnabled: false,
        }),
      ).toBe('inactive');

      expect(
        getCalendarSyncState({
          connected: true,
          hasCalendarScope: true,
          syncEnabled: true,
        }),
      ).toBe('active');
    });

    it('AC-7: formats calendar sync dates with locale or returns null when empty', () => {
      expect(formatCalendarSyncDate(null, 'en')).toBeNull();
      expect(formatCalendarSyncDate(undefined, 'de')).toBeNull();
      expect(formatCalendarSyncDate('invalid-date', 'en')).toBeNull();

      const testDate = new Date('2026-10-23T14:30:00Z');
      const enFormatted = formatCalendarSyncDate(testDate, 'en');
      const deFormatted = formatCalendarSyncDate(testDate, 'de');
      expect(enFormatted).toBeTruthy();
      expect(deFormatted).toBeTruthy();
    });

    it('AC-7: formats calendar dropdown options and defaults to primary calendar', () => {
      const emptyOptions = formatCalendarOptions([], 'Primary Calendar');
      expect(emptyOptions).toEqual([{ id: 'primary', label: 'Primary Calendar', isPrimary: true }]);

      const calendars = [
        { id: 'primary', summary: 'Main Studio', primary: true },
        { id: 'secondary_cal_123', summary: 'Portraits Only', primary: false },
      ];
      const formatted = formatCalendarOptions(calendars, 'Primary Calendar');
      expect(formatted).toHaveLength(2);
      const [firstCal, secondCal] = formatted;
      expect(firstCal?.id).toBe('primary');
      expect(firstCal?.label).toContain('Primary Calendar');
      expect(secondCal?.id).toBe('secondary_cal_123');
      expect(secondCal?.label).toBe('Portraits Only');
    });
  });

  describe('AC-9: Localization Key Parity for Google Calendar Settings', () => {
    it('AC-9: verifies identical translation keys for Google Calendar between en.json and de.json', () => {
      const enPath = path.resolve(process.cwd(), 'messages/en.json');
      const dePath = path.resolve(process.cwd(), 'messages/de.json');

      const en = JSON.parse(fs.readFileSync(enPath, 'utf8')) as {
        settings: { integrations: { google: Record<string, string> } };
      };
      const de = JSON.parse(fs.readFileSync(dePath, 'utf8')) as {
        settings: { integrations: { google: Record<string, string> } };
      };

      const enGoogle = en.settings.integrations.google;
      const deGoogle = de.settings.integrations.google;

      const calendarKeys = [
        'calendarTitle',
        'calendarDescription',
        'calendarScopeIndicatorGranted',
        'calendarScopeIndicatorNeedsAuth',
        'calendarScopeIndicatorNeedsAuthDesc',
        'authorizeCalendarButton',
        'authorizingCalendarButton',
        'calendarSyncToggleLabel',
        'calendarSyncToggleDescription',
        'calendarSelectorLabel',
        'calendarSelectorDescription',
        'calendarSelectorPrimary',
        'calendarSyncNowButton',
        'calendarSyncingButton',
        'calendarStatusActive',
        'calendarStatusInactive',
        'calendarStatusDisconnected',
        'calendarLastSyncedAt',
        'calendarNeverSynced',
        'calendarLastSyncError',
        'calendarSyncSuccessFeedback',
        'calendarSyncErrorFeedback',
      ];

      for (const key of calendarKeys) {
        const enVal = enGoogle[key];
        const deVal = deGoogle[key];
        expect(enVal, `en.json missing key: ${key}`).toBeDefined();
        expect(deVal, `de.json missing key: ${key}`).toBeDefined();
        expect(typeof enVal).toBe('string');
        expect(typeof deVal).toBe('string');
        expect((enVal ?? '').length).toBeGreaterThan(0);
        expect((deVal ?? '').length).toBeGreaterThan(0);
      }
    });
  });
});
