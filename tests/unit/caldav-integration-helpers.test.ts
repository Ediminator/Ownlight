import { describe, it, expect } from 'vitest';
import {
  validateCaldavCredentials,
  formatLastSynced,
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
});
