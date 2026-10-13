import { describe, it, expect, vi } from 'vitest';
import { safeCompareTokens } from '@/server/auth/setup';
import { hasRequiredScopes } from '@/server/auth/api-keys';
import {
  signOutAction,
  requestPasswordResetAction,
  resetPasswordAction,
} from '@/server/auth/actions';
import {
  anonymizeIp,
  getAccountKey,
  getIpKey,
  cleanupExpiredRateLimits,
  consumeRateLimit,
  checkRateLimit,
  recordFailedAttempt,
  RateLimitUnavailableError,
} from '@/server/auth/rate-limiter';
import type { DbClient } from '@/server/db/client';

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: () => undefined,
      set: () => undefined,
      delete: () => undefined,
    }),
  headers: () =>
    Promise.resolve({
      get: () => null,
    }),
}));

describe('Auth Unit Branch Coverage', () => {
  describe('safeCompareTokens branches', () => {
    it('returns false when either argument is not a string', () => {
      expect(safeCompareTokens(null, 'valid')).toBe(false);
      expect(safeCompareTokens('valid', undefined)).toBe(false);
      expect(safeCompareTokens(123, 'valid')).toBe(false);
      expect(safeCompareTokens('valid', {})).toBe(false);
      expect(safeCompareTokens(null, null)).toBe(false);
    });

    it('returns false for length mismatches while executing equal work', () => {
      expect(safeCompareTokens('short', 'much_longer_string')).toBe(false);
      expect(safeCompareTokens('abc', 'abcd')).toBe(false);
    });

    it('returns true for identical strings and false for differing strings', () => {
      expect(safeCompareTokens('identical-token', 'identical-token')).toBe(true);
      expect(safeCompareTokens('identical-token-a', 'identical-token-b')).toBe(false);
    });
  });

  describe('API key hasRequiredScopes branches', () => {
    it('handles undefined or empty required scopes, wildcard, and matching sets', () => {
      expect(hasRequiredScopes(['clients:read'])).toBe(true);
      expect(hasRequiredScopes(['clients:read'], [])).toBe(true);
      expect(hasRequiredScopes(['*'], ['clients:read', 'settings:write'])).toBe(true);
      expect(hasRequiredScopes(['clients:read', 'clients:write'], ['clients:read'])).toBe(true);
      expect(hasRequiredScopes(['clients:read'], ['clients:write'])).toBe(false);
    });
  });

  describe('Server Actions edge cases and error handling', () => {
    it('signOutAction cleanly handles missing session cookie', async () => {
      const res = await signOutAction();
      expect(res.success).toBe(true);
    });

    it('requestPasswordResetAction returns failure when email format is invalid', async () => {
      const res = await requestPasswordResetAction({ email: 'not-an-email' });
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('resetPasswordAction returns failure when password violates policy', async () => {
      const res = await resetPasswordAction({
        email: 'user@example.com',
        token: 'any-token',
        newPassword: 'short',
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe('Password must be at least 12 characters long.');
    });
  });

  describe('Rate Limiter branch coverage', () => {
    it('anonymizeIp covers empty, partial IPv4, standard IPv4, IPv6, and non-IP strings', () => {
      expect(anonymizeIp('')).toBe('0.0.0.0');
      expect(anonymizeIp('   ')).toBe('0.0.0.0');
      expect(anonymizeIp('192.168.1')).toBe('192.168.1');
      expect(anonymizeIp('192.168.1.100')).toBe('192.168.1.0');
      expect(anonymizeIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:85a3::/48');
      expect(anonymizeIp('unknown-client-host')).toBe('unknown-client-host');
    });

    it('getAccountKey and getIpKey format keys properly', () => {
      const accKey = getAccountKey('  User@Example.Com  ');
      expect(accKey.startsWith('account:')).toBe(true);
      expect(accKey.length).toBe(40);

      const ipKey = getIpKey('10.20.30.40');
      expect(ipKey).toBe('ip:10.20.30.0');
    });

    it('cleanupExpiredRateLimits handles success and error paths', async () => {
      const mockSuccessClient = {
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({}),
        }),
      } as unknown as DbClient;
      const resOk = await cleanupExpiredRateLimits(mockSuccessClient);
      expect(resOk).toBe(1);

      const mockErrorClient = {
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('DB failure')),
        }),
      } as unknown as DbClient;
      const resErr = await cleanupExpiredRateLimits(mockErrorClient);
      expect(resErr).toBe(0);
    });

    it('checkRateLimit handles empty rows, expired rows, exceeded limits, and under limit', async () => {
      // 1. Empty rows with windowMs as number and client as 4th arg
      const mockEmptyClient = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({}),
        }),
      } as unknown as DbClient;

      const emptyRes = await checkRateLimit('key:1', 10, 60000, mockEmptyClient);
      expect(emptyRes.allowed).toBe(true);
      expect(emptyRes.remaining).toBe(10);

      // 2. Client passed as 3rd arg (windowMsOrClient is object)
      const objClientRes = await checkRateLimit('key:2', 5, mockEmptyClient);
      expect(objClientRes.allowed).toBe(true);
      expect(objClientRes.remaining).toBe(5);

      // 3. Expired row (expiresAt <= now)
      const mockExpiredClient = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue([{ count: 10, expiresAt: new Date(Date.now() - 5000) }]),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({}),
        }),
      } as unknown as DbClient;

      const expiredRes = await checkRateLimit('key:3', 10, 60000, mockExpiredClient);
      expect(expiredRes.allowed).toBe(true);
      expect(expiredRes.remaining).toBe(10);

      // 4. Over limit (count >= max)
      const mockBlockedClient = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue([{ count: 10, expiresAt: new Date(Date.now() + 60000) }]),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({}),
        }),
      } as unknown as DbClient;

      const blockedRes = await checkRateLimit('key:4', 10, 60000, mockBlockedClient);
      expect(blockedRes.allowed).toBe(false);
      expect(blockedRes.remaining).toBe(0);

      // 5. Under limit (count < max)
      const mockUnderClient = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue([{ count: 3, expiresAt: new Date(Date.now() + 60000) }]),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({}),
        }),
      } as unknown as DbClient;

      const underRes = await checkRateLimit('key:5', 10, 60000, mockUnderClient);
      expect(underRes.allowed).toBe(true);
      expect(underRes.remaining).toBe(7);

      // 6. DB error
      const mockErrorClient = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockRejectedValue(new Error('Connection lost')),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({}),
        }),
      } as unknown as DbClient;

      await expect(checkRateLimit('key:6', 10, 60000, mockErrorClient)).rejects.toThrow(
        RateLimitUnavailableError,
      );

      // 7. Rethrows existing RateLimitUnavailableError
      const mockRethrowClient = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockRejectedValue(new RateLimitUnavailableError('Already wrapped')),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({}),
        }),
      } as unknown as DbClient;

      await expect(checkRateLimit('key:7', 10, 60000, mockRethrowClient)).rejects.toThrow(
        'Already wrapped',
      );
    });

    it('consumeRateLimit and recordFailedAttempt handle empty return and error wrapping', async () => {
      // Empty returning rows
      const mockEmptyReturnClient = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as unknown as DbClient;

      await expect(consumeRateLimit('k:1', 10, 60000, mockEmptyReturnClient)).rejects.toThrow(
        'Failed to execute rate limit upsert',
      );

      // Error thrown
      const mockErrClient = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockImplementation(() => {
              const rejected = Promise.reject(new Error('Write lock'));
              return Object.assign(rejected, {
                returning: vi.fn().mockReturnValue(rejected),
              });
            }),
          }),
        }),
      } as unknown as DbClient;

      await expect(consumeRateLimit('k:2', 10, 60000, mockErrClient)).rejects.toThrow(
        RateLimitUnavailableError,
      );
      await expect(recordFailedAttempt('k:2', 60000, mockErrClient)).rejects.toThrow(
        RateLimitUnavailableError,
      );

      // resetRateLimit
      const { resetRateLimit } = await import('@/server/auth/rate-limiter');
      const mockResetClient = {
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({}),
        }),
      } as unknown as DbClient;
      await expect(resetRateLimit('k:3', mockResetClient)).resolves.toBeUndefined();

      const mockResetErrClient = {
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('Delete fail')),
        }),
      } as unknown as DbClient;
      await expect(resetRateLimit('k:3', mockResetErrClient)).rejects.toThrow(
        RateLimitUnavailableError,
      );
    });
  });
});
