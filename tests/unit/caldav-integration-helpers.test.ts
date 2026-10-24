import { describe, it, expect } from 'vitest';
import {
  validateCaldavCredentials,
  formatLastSynced,
  clearFieldError,
  togglePasswordVisibility,
  resolveSelectedCalendarName,
} from '@/components/settings/caldav-integration-helpers';

describe('caldav-integration-helpers', () => {
  const messages = {
    serverUrlRequired: 'Server URL is required.',
    invalidServerUrl: 'Please enter a valid HTTP or HTTPS URL.',
    usernameRequired: 'Username is required.',
    passwordRequired: 'Password is required.',
  };

  it('validates correct credentials as valid', () => {
    const res = validateCaldavCredentials(
      {
        serverUrl: 'https://cal.example.org/dav',
        username: 'user@example.org',
        password: 'mock_pw',
      },
      messages,
    );

    expect(res.isValid).toBe(true);
    expect(res.errors).toEqual({});
  });

  it('flags missing serverUrl, username, and password', () => {
    const res = validateCaldavCredentials(
      {
        serverUrl: '   ',
        username: '   ',
        password: '',
      },
      messages,
    );

    expect(res.isValid).toBe(false);
    expect(res.errors.serverUrl).toBe('Server URL is required.');
    expect(res.errors.username).toBe('Username is required.');
    expect(res.errors.password).toBe('Password is required.');
  });

  it('flags invalid serverUrl format or protocol', () => {
    const resFtp = validateCaldavCredentials(
      {
        serverUrl: 'ftp://cal.example.org',
        username: 'user',
        password: 'mock_pw',
      },
      messages,
    );
    expect(resFtp.isValid).toBe(false);
    expect(resFtp.errors.serverUrl).toBe('Please enter a valid HTTP or HTTPS URL.');

    const resMalformed = validateCaldavCredentials(
      {
        serverUrl: 'not-a-valid-url',
        username: 'user',
        password: 'mock_pw',
      },
      messages,
    );
    expect(resMalformed.isValid).toBe(false);
    expect(resMalformed.errors.serverUrl).toBe('Please enter a valid HTTP or HTTPS URL.');
  });

  it('formats last synced date across locales and null fallback', () => {
    expect(formatLastSynced(null, 'en', 'Never synced')).toBe('Never synced');
    expect(formatLastSynced(undefined, 'en', 'Never synced')).toBe('Never synced');
    expect(formatLastSynced('invalid-date', 'en', 'Never synced')).toBe('Never synced');

    const date = new Date('2026-10-24T12:30:00Z');
    const formattedEn = formatLastSynced(date, 'en', 'Never synced');
    expect(formattedEn).toContain('2026');

    const formattedDe = formatLastSynced(date, 'de', 'Noch nie synchronisiert');
    expect(formattedDe).toContain('2026');
  });

  it('formats last synced with date fallback when Intl formatting throws', () => {
    const originalDateTimeFormat = Intl.DateTimeFormat;
    try {
      // Force Intl.DateTimeFormat to throw
      (Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = function () {
        throw new Error('Intl mock error');
      };

      const date = new Date('2026-10-24T12:30:00Z');
      const fallback = formatLastSynced(date, 'en', 'Never synced');
      expect(fallback).toBe('2026-10-24T12:30:00.000Z');
    } finally {
      Intl.DateTimeFormat = originalDateTimeFormat;
    }
  });

  it('clears specific field errors with clearFieldError', () => {
    const errors = {
      serverUrl: 'Invalid URL',
      username: 'Required',
      password: 'Required',
      calendar: 'Select calendar',
    };

    const clearedServer = clearFieldError(errors, 'serverUrl');
    expect(clearedServer.serverUrl).toBeUndefined();
    expect(clearedServer.username).toBe('Required');

    const clearedUsername = clearFieldError(errors, 'username');
    expect(clearedUsername.username).toBeUndefined();

    const clearedPassword = clearFieldError(errors, 'password');
    expect(clearedPassword.password).toBeUndefined();

    const clearedCalendar = clearFieldError(errors, 'calendar');
    expect(clearedCalendar.calendar).toBeUndefined();

    // No-op if field error does not exist
    expect(clearFieldError({}, 'serverUrl').serverUrl).toBeUndefined();
    expect(clearFieldError({}, 'username').username).toBeUndefined();
    expect(clearFieldError({}, 'password').password).toBeUndefined();
    const noOp = clearFieldError({ ...errors, calendar: undefined }, 'calendar');
    expect(noOp.calendar).toBeUndefined();

    // Fallback for unknown field type cast
    const fallback = clearFieldError(errors, 'unknown' as unknown as keyof typeof errors);
    expect(fallback).toBe(errors);
  });

  it('toggles password visibility', () => {
    expect(togglePasswordVisibility(false)).toBe(true);
    expect(togglePasswordVisibility(true)).toBe(false);
  });

  it('resolves selected calendar display name with fallbacks', () => {
    const calendars = [{ url: '/cal/1/', displayName: 'Studio Shoots' }, { url: '/cal/2/' }];

    expect(resolveSelectedCalendarName(calendars, '/cal/1/')).toBe('Studio Shoots');
    expect(resolveSelectedCalendarName(calendars, '/cal/2/')).toBe('/cal/2/');
    expect(resolveSelectedCalendarName(calendars, '/cal/not-found/')).toBe('Calendar');
  });
});
