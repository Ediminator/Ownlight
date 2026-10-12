import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let currentHeaders = new Headers();

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(currentHeaders),
  cookies: () =>
    Promise.resolve({
      get: () => undefined,
      set: () => undefined,
      delete: () => undefined,
    }),
}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { requestPasswordResetAction } from '@/server/auth/actions';
import { user, account } from '@/server/db/schema/auth';
import { RESET_REQ_ACCOUNT_MAX_ATTEMPTS } from '@/server/auth/rate-limiter';
import { resetEnvCache } from '@/env';
import type { DbClient } from '@/server/db/client';

describe('AC-11: Password reset request rate limiting', () => {
  let testDb: TestDatabaseInstance;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    process.env.TRUSTED_PROXY_COUNT = '1';
    resetEnvCache();
  });

  afterEach(async () => {
    await testDb.destroy();
    process.env = { ...originalEnv };
    resetEnvCache();
  });

  it('AC-11: 11 requestPasswordResetAction calls for same email from same IP throttles at 6th call and sends no email', async () => {
    const dbClient = testDb.db as unknown as DbClient;
    const targetEmail = 'target-user@example.com';
    const clientIp = '203.0.113.55';

    // Seed existing user so password reset token can be generated
    const [createdUser] = await dbClient
      .insert(user)
      .values({
        name: 'Target User',
        email: targetEmail,
      })
      .returning();

    if (!createdUser) {
      throw new Error('Expected createdUser to be defined');
    }

    const placeholderHash = 'argon2id_hash_placeholder';
    await dbClient.insert(account).values({
      userId: createdUser.id,
      accountId: createdUser.id,
      providerId: 'credential',
      password: placeholderHash,
    });

    const sendMailSpy = vi.fn().mockResolvedValue({ messageId: 'test-message-id' });
    const mockTransporter = {
      sendMail: sendMailSpy,
    } as unknown as import('nodemailer').Transporter;

    currentHeaders = new Headers({
      'x-forwarded-for': clientIp,
    });

    // Calls 1 through 5 (up to RESET_REQ_ACCOUNT_MAX_ATTEMPTS = 5) must succeed and dispatch email
    for (let i = 1; i <= RESET_REQ_ACCOUNT_MAX_ATTEMPTS; i++) {
      const res = await requestPasswordResetAction(
        { email: targetEmail },
        { client: dbClient, transporter: mockTransporter },
      );
      expect(res.success).toBe(true);
    }

    expect(sendMailSpy).toHaveBeenCalledTimes(5);

    // Calls 6 through 11 must be throttled and send no additional email
    for (let i = 6; i <= 11; i++) {
      const throttledRes = await requestPasswordResetAction(
        { email: targetEmail },
        { client: dbClient, transporter: mockTransporter },
      );
      expect(throttledRes.success).toBe(false);
      expect(throttledRes.error).toBe('Too many password reset requests. Please try again later.');
    }

    // Still exactly 5 emails sent
    expect(sendMailSpy).toHaveBeenCalledTimes(5);
  });
});
