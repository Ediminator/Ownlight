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
import { signInAction } from '@/server/auth/actions';
import { verifyMfaTotpAction } from '@/server/auth/mfa-actions';
import { user, verification, totpCredential, rateLimits } from '@/server/db/schema/auth';
import { encryptTotpSecret } from '@/server/auth/totp';
import { MFA_IP_MAX_ATTEMPTS, IP_MAX_ATTEMPTS } from '@/server/auth/rate-limiter';
import { resetEnvCache } from '@/env';
import type { DbClient } from '@/server/db/client';

describe('AC-4, AC-5: Server actions with trusted client IP resolution', () => {
  let testDb: TestDatabaseInstance;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    process.env.TRUSTED_PROXY_COUNT = '1';
    process.env.AUTH_SECRET = '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a';
    resetEnvCache();
  });

  afterEach(async () => {
    await testDb.destroy();
    process.env = { ...originalEnv };
    resetEnvCache();
  });

  it('AC-4: throttles 51st failed signInAction call from same right-most IP despite spoofed left-most entries and X-Real-IP', async () => {
    const dbClient = testDb.db as unknown as DbClient;
    const trustedIp = '203.0.113.195';
    const testFailurePassword = 'IncorrectPassword123!';

    // Perform 50 failed signInAction calls with different emails, spoofed left-most entries, and spoofed X-Real-IP
    for (let i = 1; i <= IP_MAX_ATTEMPTS; i++) {
      const spoofedClientIp = `10.0.0.${String(i)}`;
      currentHeaders = new Headers({
        'x-forwarded-for': `${spoofedClientIp}, ${trustedIp}`,
        'x-real-ip': spoofedClientIp,
      });

      const res = await signInAction(
        {
          email: `user-${String(i)}@example.com`,
          password: testFailurePassword,
        },
        dbClient,
      );

      expect(res.success).toBe(false);
      expect(res.error).toBe('Invalid email or password.');
    }

    // 51st attempt from the same resolved IP with yet another spoofed IP must be throttled
    currentHeaders = new Headers({
      'x-forwarded-for': `10.0.0.51, ${trustedIp}`,
      'x-real-ip': '10.0.0.51',
    });

    const throttledRes = await signInAction(
      {
        email: 'user-51@example.com',
        password: testFailurePassword,
      },
      dbClient,
    );

    expect(throttledRes.success).toBe(false);
    expect(throttledRes.error).toBe('Too many failed attempts. Please try again later.');

    // A request from a different right-most IP should NOT be throttled
    currentHeaders = new Headers({
      'x-forwarded-for': '10.0.0.1, 198.51.100.22',
      'x-real-ip': '10.0.0.1',
    });

    const freshRes = await signInAction(
      {
        email: 'user-fresh@example.com',
        password: testFailurePassword,
      },
      dbClient,
    );

    expect(freshRes.success).toBe(false);
    expect(freshRes.error).toBe('Invalid email or password.');
  });

  it('AC-5: MFA verification action shares one IP bucket when requests vary only X-Real-IP or left-most X-Forwarded-For', async () => {
    const dbClient = testDb.db as unknown as DbClient;
    const trustedIp = '203.0.113.88';

    // 1. Seed user and TOTP credential
    const [testUser] = await dbClient
      .insert(user)
      .values({
        name: 'MFA User',
        email: 'mfa-test@example.com',
      })
      .returning();

    if (!testUser) {
      throw new Error('Expected testUser to be defined');
    }

    const testSecret = 'JBSWY3DPEHPK3PXP';
    await dbClient.insert(totpCredential).values({
      userId: testUser.id,
      secretEncrypted: encryptTotpSecret(testSecret),
      verified: true,
      lastUsedStep: 0,
    });

    // 2. Create MFA verification ticket
    const mfaTicket = 'valid-mfa-ticket-uuid-12345';
    await dbClient.insert(verification).values({
      identifier: `mfa_ticket:${mfaTicket}`,
      value: testUser.id,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    // 3. Perform failed MFA attempts varying left-most entry and X-Real-IP across distinct accounts
    for (let i = 1; i <= MFA_IP_MAX_ATTEMPTS; i++) {
      const spoofedClientIp = `172.16.0.${String(i)}`;
      currentHeaders = new Headers({
        'x-forwarded-for': `${spoofedClientIp}, ${trustedIp}`,
        'x-real-ip': spoofedClientIp,
      });

      const [userRow] = await dbClient
        .insert(user)
        .values({
          name: `MFA User ${String(i)}`,
          email: `mfa-user-${String(i)}@example.com`,
        })
        .returning();

      if (!userRow) {
        throw new Error('Expected userRow to be defined');
      }

      await dbClient.insert(totpCredential).values({
        userId: userRow.id,
        secretEncrypted: encryptTotpSecret('JBSWY3DPEHPK3PXP'),
        verified: true,
        lastUsedStep: 0,
      });

      const ticket = `mfa-ticket-${String(i)}`;
      await dbClient.insert(verification).values({
        identifier: `mfa_ticket:${ticket}`,
        value: userRow.id,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });

      const res = await verifyMfaTotpAction(
        {
          mfaTicket: ticket,
          code: '000000', // Invalid code
        },
        dbClient,
      );

      expect(res.success).toBe(false);
      expect(res.code).toBe('INVALID_CODE');
    }

    // 4. Next attempt from the same resolved IP must be throttled with RATE_LIMITED code
    const [finalUser] = await dbClient
      .insert(user)
      .values({
        name: 'MFA Final User',
        email: 'mfa-final@example.com',
      })
      .returning();

    if (!finalUser) {
      throw new Error('Expected finalUser to be defined');
    }

    await dbClient.insert(totpCredential).values({
      userId: finalUser.id,
      secretEncrypted: encryptTotpSecret('JBSWY3DPEHPK3PXP'),
      verified: true,
      lastUsedStep: 0,
    });

    const finalTicket = 'mfa-ticket-final';
    await dbClient.insert(verification).values({
      identifier: `mfa_ticket:${finalTicket}`,
      value: finalUser.id,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    currentHeaders = new Headers({
      'x-forwarded-for': `172.16.0.99, ${trustedIp}`,
      'x-real-ip': '172.16.0.99',
    });

    const throttledMfaRes = await verifyMfaTotpAction(
      {
        mfaTicket: finalTicket,
        code: '000000',
      },
      dbClient,
    );

    expect(throttledMfaRes.success).toBe(false);
    expect(throttledMfaRes.code).toBe('RATE_LIMITED');
    expect(throttledMfaRes.error).toBe(
      'Too many failed MFA verification attempts. Please try again later.',
    );

    // Verify rateLimits table only has one shared IP bucket for this right-most IP
    const rows = await dbClient.select().from(rateLimits);
    const mfaIpRows = rows.filter((r) => r.key.startsWith('mfa_ip:'));
    expect(mfaIpRows.length).toBe(1);
    expect(mfaIpRows[0]?.key).toBe('mfa_ip:203.0.113.0');
    expect(mfaIpRows[0]?.count).toBeGreaterThanOrEqual(MFA_IP_MAX_ATTEMPTS);
  });
});
