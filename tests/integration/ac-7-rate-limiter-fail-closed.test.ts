import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import {
  RateLimitUnavailableError,
  checkRateLimit,
  consumeRateLimit,
  recordFailedAttempt,
} from '@/server/auth/rate-limiter';
import { signInAction } from '@/server/auth/actions';
import { logger } from '@/server/log';
import { session } from '@/server/db/schema/auth';
import type { DbClient } from '@/server/db/client';

describe('AC-7: Fail-closed rate limiter and error handling', () => {
  let testDb: TestDatabaseInstance;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
  });

  afterEach(async () => {
    await testDb.destroy();
    vi.restoreAllMocks();
  });

  it('AC-7: checkRateLimit, consumeRateLimit, and recordFailedAttempt throw RateLimitUnavailableError on DB failure', async () => {
    // Create a broken DB client proxy that rejects all queries
    const brokenDbClient = new Proxy({} as DbClient, {
      get() {
        return () => {
          throw new Error('Database connection terminated unexpectedly');
        };
      },
    });

    await expect(checkRateLimit('test-key', 5, 60_000, brokenDbClient)).rejects.toThrow(
      RateLimitUnavailableError,
    );

    await expect(consumeRateLimit('test-key', 5, 60_000, brokenDbClient)).rejects.toThrow(
      RateLimitUnavailableError,
    );

    await expect(recordFailedAttempt('test-key', 60_000, brokenDbClient)).rejects.toThrow(
      RateLimitUnavailableError,
    );
  });

  it('AC-7: signInAction refuses sign-in with generic message, creates no session, and logs RateLimitUnavailableError without PII/IP when DB rate limit fails', async () => {
    const rawEmail = 'legitimate-photographer@example.com';
    const rawIp = '203.0.113.195';

    // Mock logger.error to verify logged metadata
    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);

    // Mock next/headers for client IP resolution
    const mockHeaders = new Headers({
      'x-forwarded-for': rawIp,
    });
    vi.doMock('next/headers', () => ({
      headers: () => Promise.resolve(mockHeaders),
      cookies: () =>
        Promise.resolve({
          get: () => undefined,
          set: () => undefined,
          delete: () => undefined,
        }),
    }));

    // Create a mock DB client that fails on rate_limits queries
    const failingDbClient = new Proxy(testDb.db as unknown as DbClient, {
      get(target, prop, receiver): unknown {
        if (prop === 'select' || prop === 'insert' || prop === 'update' || prop === 'delete') {
          return () => {
            // Throw simulated database failure
            throw new Error('Simulated database failure during rate limiting');
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    const testAttemptPassword = 'ValidPassword123!';
    const result = await signInAction(
      {
        email: rawEmail,
        password: testAttemptPassword,
      },
      failingDbClient,
    );

    // 1. Refused with generic failure message
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid email or password.');

    // 2. No session was created
    const realDb = testDb.db as unknown as DbClient;
    const sessionRows = await realDb.select().from(session);
    expect(sessionRows.length).toBe(0);

    // 3. RateLimitUnavailableError was logged without identifier or IP
    expect(loggerErrorSpy).toHaveBeenCalled();
    const loggedCalls = loggerErrorSpy.mock.calls;
    const rateLimitErrorCall = loggedCalls.find((call) => {
      const firstArg = call[0] as Record<string, unknown> | undefined;
      const messageArg = call[1];
      const errObj = firstArg?.err as Error | undefined;
      return (
        firstArg?.errorClass === 'RateLimitUnavailableError' ||
        errObj?.name === 'RateLimitUnavailableError' ||
        (typeof messageArg === 'string' && messageArg.includes('RateLimitUnavailableError'))
      );
    });

    expect(rateLimitErrorCall).toBeDefined();

    // Verify no email or IP is leaked in the logged arguments
    const serializedLog = JSON.stringify(rateLimitErrorCall);
    expect(serializedLog).not.toContain(rawEmail);
    expect(serializedLog).not.toContain(rawIp);
  });
});
