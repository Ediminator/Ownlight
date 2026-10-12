import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveClientIp } from '@/server/http/client-ip';
import { getIpKey, anonymizeIp } from '@/server/auth/rate-limiter';
import { resetEnvCache } from '@/env';

describe('AC-1, AC-2, AC-3: Client IP Resolver', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEnvCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCache();
  });

  it('AC-1: resolves client IP correctly based on TRUSTED_PROXY_COUNT (N=1 vs N=2)', () => {
    const rawHeader = '198.51.100.7, 203.0.113.9';
    const headers = new Headers({
      'x-forwarded-for': rawHeader,
    });

    // Given TRUSTED_PROXY_COUNT=1, returns 203.0.113.9 (1st from right)
    process.env.TRUSTED_PROXY_COUNT = '1';
    resetEnvCache();
    expect(resolveClientIp(headers)).toBe('203.0.113.9');

    // Given TRUSTED_PROXY_COUNT=2, returns 198.51.100.7 (2nd from right)
    process.env.TRUSTED_PROXY_COUNT = '2';
    resetEnvCache();
    expect(resolveClientIp(headers)).toBe('198.51.100.7');

    // Also supports explicit parameter override if provided
    expect(resolveClientIp(headers, 1)).toBe('203.0.113.9');
    expect(resolveClientIp(headers, 2)).toBe('198.51.100.7');
  });

  it('AC-2: ignores X-Real-IP completely; result is identical with or without X-Real-IP', () => {
    process.env.TRUSTED_PROXY_COUNT = '1';
    resetEnvCache();

    const headersWithoutRealIp = new Headers({
      'x-forwarded-for': '198.51.100.7, 203.0.113.9',
    });

    const headersWithRealIp = new Headers({
      'x-forwarded-for': '198.51.100.7, 203.0.113.9',
      'x-real-ip': '10.0.0.1',
    });

    const headersWithSpoofedRealIp = new Headers({
      'x-forwarded-for': '198.51.100.7, 203.0.113.9',
      'x-real-ip': '192.168.1.100',
    });

    const baseResult = resolveClientIp(headersWithoutRealIp);
    expect(baseResult).toBe('203.0.113.9');
    expect(resolveClientIp(headersWithRealIp)).toBe(baseResult);
    expect(resolveClientIp(headersWithSpoofedRealIp)).toBe(baseResult);
  });

  it('AC-3: returns null when TRUSTED_PROXY_COUNT=0 and caller maps to unknown bucket', () => {
    process.env.TRUSTED_PROXY_COUNT = '0';
    resetEnvCache();

    const headers = new Headers({
      'x-forwarded-for': '198.51.100.7, 203.0.113.9',
    });

    const ip = resolveClientIp(headers);
    expect(ip).toBeNull();

    const bucket = ip ?? 'unknown';
    expect(bucket).toBe('unknown');
    expect(getIpKey(bucket)).toBe('ip:unknown');
    expect(anonymizeIp(bucket)).toBe('unknown');
  });

  it('AC-3: returns null when X-Forwarded-For is missing', () => {
    process.env.TRUSTED_PROXY_COUNT = '1';
    resetEnvCache();

    const headersEmpty = new Headers();
    expect(resolveClientIp(headersEmpty)).toBeNull();

    const recordEmpty: Record<string, string> = {};
    expect(resolveClientIp(recordEmpty)).toBeNull();
  });

  it('AC-3: returns null when header has fewer entries than TRUSTED_PROXY_COUNT', () => {
    process.env.TRUSTED_PROXY_COUNT = '3';
    resetEnvCache();

    // 2 entries, but N=3
    const headers = new Headers({
      'x-forwarded-for': '198.51.100.7, 203.0.113.9',
    });

    expect(resolveClientIp(headers)).toBeNull();
  });

  it('AC-3: returns null when the selected entry is not a valid IP address', () => {
    process.env.TRUSTED_PROXY_COUNT = '2';
    resetEnvCache();

    // Position len - 2 is 'not-an-ip'
    const headers = new Headers({
      'x-forwarded-for': 'not-an-ip, 203.0.113.9',
    });

    expect(resolveClientIp(headers)).toBeNull();
  });

  it('AC-1 / AC-3: supports IPv6 addresses and normalizes whitespace', () => {
    process.env.TRUSTED_PROXY_COUNT = '1';
    resetEnvCache();

    const headersIpv6 = new Headers({
      'x-forwarded-for': '  198.51.100.7 ,  2001:db8::1  ',
    });

    expect(resolveClientIp(headersIpv6)).toBe('2001:db8::1');

    process.env.TRUSTED_PROXY_COUNT = '2';
    resetEnvCache();
    expect(resolveClientIp(headersIpv6)).toBe('198.51.100.7');
  });

  it('AC-1: works with plain Record<string, string | string[] | undefined>', () => {
    process.env.TRUSTED_PROXY_COUNT = '1';
    resetEnvCache();

    const dict = {
      'x-forwarded-for': '198.51.100.7, 203.0.113.9',
    };
    expect(resolveClientIp(dict)).toBe('203.0.113.9');

    const arrayDict = {
      'x-forwarded-for': ['198.51.100.7', '203.0.113.9'],
    };
    expect(resolveClientIp(arrayDict)).toBe('203.0.113.9');
  });
});
