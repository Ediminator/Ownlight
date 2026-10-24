import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { validateCaldavServerUrl, CaldavSsrfError } from '@/server/integrations/caldav/ssrf';

describe('TASK-0047: CalDAV SSRF Protection (AC-1, Security ASVS V5.5)', () => {
  it('AC-1: allows valid public HTTPS CalDAV endpoints', () => {
    expect(() => validateCaldavServerUrl('https://caldav.icloud.com')).not.toThrow();
    expect(() =>
      validateCaldavServerUrl('https://nextcloud.example.org/remote.php/dav'),
    ).not.toThrow();
    expect(() =>
      validateCaldavServerUrl('https://caldav.fastmail.com/dav/calendars/'),
    ).not.toThrow();
  });

  it('AC-1: blocks loopback IPv4 and localhost in production/default mode', () => {
    expect(() => validateCaldavServerUrl('http://127.0.0.1:5232')).toThrow(CaldavSsrfError);
    expect(() => validateCaldavServerUrl('http://localhost:5232')).toThrow(CaldavSsrfError);
    expect(() => validateCaldavServerUrl('https://127.0.0.2')).toThrow(CaldavSsrfError);
  });

  it('AC-1: blocks private RFC 1918 subnets', () => {
    expect(() => validateCaldavServerUrl('http://10.0.0.1/dav')).toThrow(CaldavSsrfError);
    expect(() => validateCaldavServerUrl('http://172.16.0.1/dav')).toThrow(CaldavSsrfError);
    expect(() => validateCaldavServerUrl('http://172.31.255.255/dav')).toThrow(CaldavSsrfError);
    expect(() => validateCaldavServerUrl('http://192.168.1.1/dav')).toThrow(CaldavSsrfError);
  });

  it('AC-1: blocks AWS/cloud link-local metadata address (169.254.169.254)', () => {
    expect(() => validateCaldavServerUrl('http://169.254.169.254/latest/meta-data')).toThrow(
      CaldavSsrfError,
    );
  });

  it('AC-1: blocks IPv6 loopback and private/local addresses', () => {
    expect(() => validateCaldavServerUrl('http://[::1]:5232')).toThrow(CaldavSsrfError);
    expect(() => validateCaldavServerUrl('http://[fe80::1]')).toThrow(CaldavSsrfError);
    expect(() => validateCaldavServerUrl('http://[fc00::1]')).toThrow(CaldavSsrfError);
  });

  it('AC-1: blocks non-http(s) protocols', () => {
    expect(() => validateCaldavServerUrl('ftp://caldav.example.org')).toThrow(CaldavSsrfError);
    expect(() => validateCaldavServerUrl('file:///etc/passwd')).toThrow(CaldavSsrfError);
    expect(() => validateCaldavServerUrl('javascript:alert(1)')).toThrow(CaldavSsrfError);
  });

  it('AC-1: allows loopback only when explicit allowLoopback option is enabled for testing', () => {
    expect(() =>
      validateCaldavServerUrl('http://127.0.0.1:5232', { allowLoopback: true }),
    ).not.toThrow();
    expect(() =>
      validateCaldavServerUrl('http://localhost:5232', { allowLoopback: true }),
    ).not.toThrow();
  });

  it('AC-1: blocks empty string, whitespace, and malformed URLs', () => {
    expect(() => validateCaldavServerUrl('')).toThrow('Server URL cannot be empty.');
    expect(() => validateCaldavServerUrl('   ')).toThrow('Server URL cannot be empty.');
    expect(() => validateCaldavServerUrl('http://')).toThrow('Invalid CalDAV server URL format.');
  });

  it('AC-1: blocks internal and local domain suffixes', () => {
    expect(() => validateCaldavServerUrl('https://nas.local/dav')).toThrow(CaldavSsrfError);
    expect(() => validateCaldavServerUrl('https://cal.internal/dav')).toThrow(CaldavSsrfError);
    expect(() => validateCaldavServerUrl('https://router.lan/dav')).toThrow(CaldavSsrfError);
    expect(() => validateCaldavServerUrl('https://domain.arpa/dav')).toThrow(CaldavSsrfError);
  });

  it('AC-1: maps and inspects IPv4-mapped IPv6 addresses', () => {
    expect(() => validateCaldavServerUrl('http://[::ffff:192.168.1.1]/dav')).toThrow(
      CaldavSsrfError,
    );
    expect(() =>
      validateCaldavServerUrl('http://[::ffff:127.0.0.1]/dav', { allowLoopback: true }),
    ).not.toThrow();
  });
});
