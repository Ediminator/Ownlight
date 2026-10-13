import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

vi.mock('server-only', () => ({}));

import {
  createFormChallenge,
  verifyPowPayload,
  recordChallengeUsage,
  getOrCreatePowSecret,
  POW_EXPIRY_MS,
} from '@/server/inquiry-forms/pow';
import {
  solveAltchaWebCrypto,
  fetchFormChallenge,
  createAltchaSolverController,
} from '@/app/[locale]/f/_components/pow-solver';
import type { DbClient } from '@/server/db/client';
import type { StudioSettings } from '@/server/db/schema';

describe('TASK-0029: Proof-of-Work (ALTCHA) Unit Tests', () => {
  const mockSecret = 'test-secret-key-at-least-32-chars-long-1234567890';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('AC-1: createFormChallenge generates valid ALTCHA v1 SHA-256 challenge structure with parameters', async () => {
    const challenge = await createFormChallenge(mockSecret, { maxnumber: 1000 });

    expect(challenge.algorithm).toBe('SHA-256');
    expect(challenge.challenge).toMatch(/^[a-f0-9]{64}$/i);
    expect(challenge.maxnumber).toBe(1000);
    expect(challenge.salt).toBeDefined();
    expect(challenge.signature).toMatch(/^[a-f0-9]{64}$/i);

    // Verify salt contains embedded issued timestamp
    expect(challenge.salt).toContain('issued=');
    expect(challenge.salt).toContain('expires=');
  });

  it('AC-12: solveAltchaWebCrypto finds the correct number and yields every 1000 iterations without WASM or eval', async () => {
    // Generate a challenge with small maxnumber so test runs quickly (<100ms)
    const challenge = await createFormChallenge(mockSecret, { maxnumber: 500 });

    let progressCalls = 0;
    const solution = await solveAltchaWebCrypto(challenge, undefined, () => {
      progressCalls++;
    });
    expect(progressCalls).toBeGreaterThanOrEqual(0);

    expect(solution).not.toBeNull();
    if (!solution) throw new Error('Expected solution');

    expect(solution.payload.algorithm).toBe('SHA-256');
    expect(solution.payload.challenge).toBe(challenge.challenge);
    expect(solution.payload.salt).toBe(challenge.salt);
    expect(solution.payload.signature).toBe(challenge.signature);
    expect(solution.payload.number).toBeGreaterThanOrEqual(0);
    expect(solution.payload.number).toBeLessThanOrEqual(500);

    // Verify raw hash matches target challenge
    const encoder = new TextEncoder();
    const data = encoder.encode(challenge.salt + String(solution.payload.number));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(hashHex.toLowerCase()).toBe(challenge.challenge.toLowerCase());
  });

  it('AC-12: solveAltchaWebCrypto respects AbortSignal and returns null when aborted', async () => {
    const challenge = await createFormChallenge(mockSecret, { maxnumber: 10000 });
    const controller = new AbortController();
    controller.abort();

    const solution = await solveAltchaWebCrypto(challenge, controller.signal);
    expect(solution).toBeNull();
  });

  it('AC-12: solveAltchaWebCrypto returns null if solution exceeds maxnumber or on invalid challenge', async () => {
    const challenge = await createFormChallenge(mockSecret, { maxnumber: 10 });
    // Override challenge hash to something that won't match 0..10
    const impossibleChallenge = {
      ...challenge,
      challenge: 'f'.repeat(64),
      maxnumber: 5,
    };

    const solution = await solveAltchaWebCrypto(impossibleChallenge);
    expect(solution).toBeNull();

    // Also test maxnumber <= 0 fallback branch
    const zeroMaxChallenge = {
      ...impossibleChallenge,
      maxnumber: 0,
    };
    const abortAfter1 = new AbortController();
    // Abort immediately so it doesn't loop 50,000 times
    abortAfter1.abort();
    const solutionZero = await solveAltchaWebCrypto(zeroMaxChallenge, abortAfter1.signal);
    expect(solutionZero).toBeNull();
  });

  it('AC-6: verifyPowPayload marks submission unverified (too_fast) if submitted < 3 seconds after issuance', async () => {
    const issueTime = Date.now();
    const challenge = await createFormChallenge(mockSecret, {
      maxnumber: 200,
      params: { issued: String(issueTime) },
    });
    const solution = await solveAltchaWebCrypto(challenge);
    expect(solution).not.toBeNull();
    if (!solution) throw new Error('Expected solution');

    // Simulate submission after only 1 second (too fast, threshold is 3s)
    const submitTime = issueTime + 1000;
    const mockDb = {
      insert: vi.fn(),
    } as unknown as DbClient;

    const result = await verifyPowPayload(solution.base64, mockSecret, mockDb, submitTime);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('too_fast');
  });

  it('AC-7: verifyPowPayload marks submission unverified (expired) if submitted after expiry (> 10 minutes)', async () => {
    const issueTime = Date.now() - (POW_EXPIRY_MS + 5000); // 10m 5s ago
    const expires = new Date(issueTime + POW_EXPIRY_MS); // expired 5s ago
    const challenge = await createFormChallenge(mockSecret, {
      maxnumber: 200,
      expires,
      params: { issued: String(issueTime) },
    });
    const solution = await solveAltchaWebCrypto(challenge);
    expect(solution).not.toBeNull();
    if (!solution) throw new Error('Expected solution');

    const submitTime = Date.now();
    const mockDb = {
      insert: vi.fn(),
    } as unknown as DbClient;

    const result = await verifyPowPayload(solution.base64, mockSecret, mockDb, submitTime);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('AC-8: verifyPowPayload marks submission unverified (invalid) on tampered signature or invalid number', async () => {
    const issueTime = Date.now() - 4000;
    const challenge = await createFormChallenge(mockSecret, {
      maxnumber: 200,
      params: { issued: String(issueTime) },
    });
    const solution = await solveAltchaWebCrypto(challenge);
    expect(solution).not.toBeNull();
    if (!solution) throw new Error('Expected solution');

    const submitTime = Date.now();
    const mockDb = {
      insert: vi.fn(),
    } as unknown as DbClient;

    // 1. Tampered signature
    const tamperedPayload = {
      ...solution.payload,
      signature: '0000000000000000000000000000000000000000000000000000000000000000',
    };
    const tamperedBase64 = Buffer.from(JSON.stringify(tamperedPayload)).toString('base64');
    const resultTampered = await verifyPowPayload(tamperedBase64, mockSecret, mockDb, submitTime);
    expect(resultTampered.verified).toBe(false);
    expect(resultTampered.reason).toBe('invalid');

    // 2. Invalid solution number
    const wrongNumberPayload = {
      ...solution.payload,
      number: solution.payload.number + 9999,
    };
    const wrongNumberBase64 = Buffer.from(JSON.stringify(wrongNumberPayload)).toString('base64');
    const resultWrong = await verifyPowPayload(wrongNumberBase64, mockSecret, mockDb, submitTime);
    expect(resultWrong.verified).toBe(false);
    expect(resultWrong.reason).toBe('invalid');

    // 3. Malformed JSON base64
    const malformedResult = await verifyPowPayload(
      'not-valid-base64-json',
      mockSecret,
      mockDb,
      submitTime,
    );
    expect(malformedResult.verified).toBe(false);
    expect(malformedResult.reason).toBe('invalid');

    // 4. Missing or empty payload
    const missingResult = await verifyPowPayload('', mockSecret, mockDb, submitTime);
    expect(missingResult.verified).toBe(false);
    expect(missingResult.reason).toBe('missing');
  });

  it('AC-5: recordChallengeUsage detects replays via atomic onConflictDoNothing', async () => {
    const signatureHash = 'a'.repeat(64);
    const expiresAt = new Date(Date.now() + 600000);

    // Mock first insert: returns 1 row (success)
    const mockDbFirst = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ signatureHash }]),
          }),
        }),
      }),
    } as unknown as DbClient;

    const firstUsage = await recordChallengeUsage(signatureHash, expiresAt, mockDbFirst);
    expect(firstUsage.replayed).toBe(false);

    // Mock second insert: returns 0 rows (conflict/replay)
    const mockDbSecond = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as unknown as DbClient;

    const secondUsage = await recordChallengeUsage(signatureHash, expiresAt, mockDbSecond);
    expect(secondUsage.replayed).toBe(true);
  });

  it('AC-13: getOrCreatePowSecret reuses existing HMAC secret and never generates a new one if present', async () => {
    const existingSecret = 'already-existing-hmac-secret-32-bytes-base64url';
    const mockSettings: StudioSettings = {
      id: '00000000-0000-0000-0000-000000000001',
      studio_name: 'Test Studio',
      default_locale: 'en',
      timezone: 'UTC',
      currency: 'EUR',
      mfa_required: false,
      mfa_postponed_until: null,
      forms_pow_hmac_key: existingSecret,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Mock studio settings returning existing secret
    const settingsRepo = await import('@/server/settings/repo');
    vi.spyOn(settingsRepo, 'getStudioSettings').mockResolvedValue(mockSettings);

    const updateSpy = vi.fn();
    const mockDb = {
      update: (...args: unknown[]) => {
        updateSpy(...args);
        return {
          set: vi.fn(),
        };
      },
    } as unknown as DbClient;

    const secret = await getOrCreatePowSecret(mockDb);
    expect(secret).toBe(existingSecret);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('AC-13: getOrCreatePowSecret generates 32 cryptographically secure bytes on first use when absent', async () => {
    const mockSettingsNoSecret: StudioSettings = {
      id: '00000000-0000-0000-0000-000000000001',
      studio_name: 'Test Studio',
      default_locale: 'en',
      timezone: 'UTC',
      currency: 'EUR',
      mfa_required: false,
      mfa_postponed_until: null,
      forms_pow_hmac_key: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const settingsRepo = await import('@/server/settings/repo');
    vi.spyOn(settingsRepo, 'getStudioSettings').mockResolvedValue(mockSettingsNoSecret);

    let updatedValue: string | undefined;
    const mockDb = {
      update: () => ({
        set: (val: { forms_pow_hmac_key?: string }) => {
          updatedValue = val.forms_pow_hmac_key;
          return {
            where: () => Promise.resolve(undefined),
          };
        },
      }),
    } as unknown as DbClient;

    const secret = await getOrCreatePowSecret(mockDb);
    expect(secret).toBeDefined();
    // 32 bytes in base64url is 43 characters
    expect(secret.length).toBeGreaterThanOrEqual(42);
    expect(updatedValue).toBe(secret);
  });

  it('fetchFormChallenge handles successful response and network failures gracefully', async () => {
    // 1. Successful fetch
    const mockChallenge = {
      algorithm: 'SHA-256',
      challenge: 'c'.repeat(64),
      maxnumber: 50000,
      salt: 'salt123?issued=123',
      signature: 's'.repeat(64),
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockChallenge), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const challenge = await fetchFormChallenge('test-slug');
    expect(challenge).toEqual(mockChallenge);

    // 2. 404 or 500 status returns null
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    const notFound = await fetchFormChallenge('test-slug');
    expect(notFound).toBeNull();

    // 3. Network error returns null
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const networkErr = await fetchFormChallenge('test-slug');
    expect(networkErr).toBeNull();
  });

  it('I1-U01: createAltchaSolverController.ensureVerifiedPayload awaits pipeline when called while fetching', async () => {
    const challenge = await createFormChallenge(mockSecret, { maxnumber: 100 });
    let fetchResolve: ((c: typeof challenge) => void) | undefined;
    const slowFetch = new Promise<typeof challenge>((resolve) => {
      fetchResolve = resolve;
    });

    const sleepCalls: number[] = [];
    const controller = createAltchaSolverController('test-slug', {
      fetchChallenge: () => slowFetch,
      sleep: (ms) => {
        sleepCalls.push(ms);
        return Promise.resolve();
      },
    });

    // Start background fetch pipeline
    void controller.start();
    expect(controller.getStatus()).toBe('fetching');

    // Call ensureVerifiedPayload() while STILL FETCHING (I1-U01)
    const payloadPromise = controller.ensureVerifiedPayload();
    expect(controller.isWaitingForSubmit()).toBe(true);

    // Resolve fetch
    if (fetchResolve) {
      fetchResolve(challenge);
    }

    // Should resolve with solved payload, NOT null!
    const payload = await payloadPromise;
    expect(payload).not.toBeNull();
    expect(typeof payload).toBe('string');
    expect(controller.getStatus()).toBe('verified');
    expect(controller.isWaitingForSubmit()).toBe(false);
  });

  it('I1-U01: createAltchaSolverController.ensureVerifiedPayload awaits remaining duration if submitted under 3,000ms', async () => {
    const fixedNow = 1700000000000;
    let currentTime = fixedNow;
    const challenge = await createFormChallenge(mockSecret, {
      maxnumber: 100,
      params: { issued: String(fixedNow) },
    });

    const sleepCalls: number[] = [];
    const controller = createAltchaSolverController('test-slug', {
      fetchChallenge: () => Promise.resolve(challenge),
      now: () => currentTime,
      sleep: (ms) => {
        sleepCalls.push(ms);
        currentTime += ms;
        return Promise.resolve();
      },
    });

    // Start and wait for solve to finish (simulating instant 100ms solve)
    await controller.start();
    expect(controller.getStatus()).toBe('verified');

    // Submit at fixedNow + 500ms (< 3,000ms elapsed)
    currentTime = fixedNow + 500;
    const remainingBefore = controller.getRemainingDurationMs();
    expect(remainingBefore).toBe(2550); // 3050 - 500

    const payload = await controller.ensureVerifiedPayload();
    expect(payload).not.toBeNull();
    // Verify sleep was called to wait for the remaining 2,550ms
    expect(sleepCalls).toEqual([2550]);
  });

  it('I1-U01: createAltchaSolverController.ensureVerifiedPayload does not sleep if more than 3,050ms have elapsed', async () => {
    const fixedNow = 1700000000000;
    const challenge = await createFormChallenge(mockSecret, {
      maxnumber: 100,
      params: { issued: String(fixedNow - 5000) }, // Issued 5 seconds ago
    });

    const sleepCalls: number[] = [];
    const controller = createAltchaSolverController('test-slug', {
      fetchChallenge: () => Promise.resolve(challenge),
      now: () => fixedNow,
      sleep: (ms) => {
        sleepCalls.push(ms);
        return Promise.resolve();
      },
    });

    await controller.start();
    expect(controller.getStatus()).toBe('verified');
    expect(controller.getRemainingDurationMs()).toBe(0);

    const payload = await controller.ensureVerifiedPayload();
    expect(payload).not.toBeNull();
    expect(sleepCalls).toHaveLength(0);
  });

  it('I1-U01: createAltchaSolverController returns null on fetch failure or aborted signal', async () => {
    const controller = createAltchaSolverController('test-slug', {
      fetchChallenge: () => Promise.resolve(null),
    });

    void controller.start();
    const payload = await controller.ensureVerifiedPayload();
    expect(payload).toBeNull();
    expect(controller.getStatus()).toBe('error');
    expect(controller.isWaitingForSubmit()).toBe(false);
  });
});
