import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { consumeRateLimit, recordFailedAttempt } from '@/server/auth/rate-limiter';
import { rateLimits } from '@/server/db/schema/auth';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';

describe('AC-6, AC-8: Atomic rate limiter operations and window resets', () => {
  let testDb: TestDatabaseInstance;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-6: 20 concurrent consumeRateLimit calls on fresh key with max=10 allow exactly 10', async () => {
    const dbClient = testDb.db as unknown as DbClient;
    const key = 'test:concurrent:consume';
    const max = 10;
    const windowMs = 60_000;

    const promises = Array.from({ length: 20 }, () =>
      consumeRateLimit(key, max, windowMs, dbClient),
    );

    const results = await Promise.all(promises);
    const allowedResults = results.filter((r) => r.allowed);
    const rejectedResults = results.filter((r) => !r.allowed);

    expect(allowedResults.length).toBe(10);
    expect(rejectedResults.length).toBe(10);

    const rows = await dbClient.select().from(rateLimits).where(eq(rateLimits.key, key));
    expect(rows.length).toBe(1);
    expect(rows[0]?.count).toBe(20);
  });

  it('AC-6: 20 concurrent recordFailedAttempt calls on a fresh key yield count=20', async () => {
    const dbClient = testDb.db as unknown as DbClient;
    const key = 'test:concurrent:record';
    const windowMs = 60_000;

    const promises = Array.from({ length: 20 }, () => recordFailedAttempt(key, windowMs, dbClient));

    await Promise.all(promises);

    const rows = await dbClient.select().from(rateLimits).where(eq(rateLimits.key, key));
    expect(rows.length).toBe(1);
    expect(rows[0]?.count).toBe(20);
  });

  it('AC-8: consumeRateLimit on expired window row restarts count at 1 with new expires_at in same statement', async () => {
    const dbClient = testDb.db as unknown as DbClient;
    const key = 'test:expired:consume';
    const windowMs = 60_000;
    const now = Date.now();

    // Insert a record that expired 5 minutes ago with high count
    await dbClient.insert(rateLimits).values({
      key,
      count: 99,
      lastAttemptAt: new Date(now - 600_000),
      expiresAt: new Date(now - 300_000),
    });

    const result = await consumeRateLimit(key, 10, windowMs, dbClient);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(result.resetAt.getTime()).toBeGreaterThan(now);

    const rows = await dbClient.select().from(rateLimits).where(eq(rateLimits.key, key));
    expect(rows.length).toBe(1);
    expect(rows[0]?.count).toBe(1);
    expect(rows[0]?.expiresAt.getTime()).toBeGreaterThan(now);
  });

  it('AC-8: recordFailedAttempt on expired window row restarts count at 1 with new expires_at in same statement', async () => {
    const dbClient = testDb.db as unknown as DbClient;
    const key = 'test:expired:record';
    const windowMs = 60_000;
    const now = Date.now();

    // Insert an expired record
    await dbClient.insert(rateLimits).values({
      key,
      count: 50,
      lastAttemptAt: new Date(now - 600_000),
      expiresAt: new Date(now - 300_000),
    });

    await recordFailedAttempt(key, windowMs, dbClient);

    const rows = await dbClient.select().from(rateLimits).where(eq(rateLimits.key, key));
    expect(rows.length).toBe(1);
    expect(rows[0]?.count).toBe(1);
    expect(rows[0]?.expiresAt.getTime()).toBeGreaterThan(now);
  });
});
