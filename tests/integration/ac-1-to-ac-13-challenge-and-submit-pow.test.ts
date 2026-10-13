import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { GET as challengeRouteGet } from '@/app/api/public/forms/[slug]/challenge/route';
import { submitInquiry } from '@/server/inquiry-forms/submit';
import { createForm, publishForm, archiveForm } from '@/server/inquiry-forms/service';
import {
  getOrCreatePowSecret,
  createFormChallenge,
  POW_EXPIRY_MS,
  type FormChallenge,
} from '@/server/inquiry-forms/pow';
import { solveAltchaWebCrypto } from '@/app/[locale]/f/_components/pow-solver';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { inquiryPowReplays } from '@/server/db/schema/inquiry-forms';
import { leads } from '@/server/db/schema/leads';
import { runRetentionSweep } from '@/server/retention/sweep';
import { resetPolicies } from '@/server/retention/policy';
import { logger } from '@/server/log';
import * as rateLimiterModule from '@/server/auth/rate-limiter';
import { RateLimitUnavailableError } from '@/server/auth/rate-limiter';
import type { DbClient } from '@/server/db/client';

describe('TASK-0029: Challenge & Submit Proof-of-Work Integration Tests', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  let strictPublishedSlug: string;
  let openPublishedSlug: string;
  let draftFormSlug: string;
  let archivedFormSlug: string;

  const loggedPayloads: string[] = [];

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    loggedPayloads.length = 0;
    vi.spyOn(logger, 'info').mockImplementation((...args) => {
      loggedPayloads.push(JSON.stringify(args));
    });
    vi.spyOn(logger, 'warn').mockImplementation((...args) => {
      loggedPayloads.push(JSON.stringify(args));
    });
    vi.spyOn(logger, 'error').mockImplementation((...args) => {
      loggedPayloads.push(JSON.stringify(args));
    });

    // 1. Seed studio settings
    await dbClient.insert(studioSettings).values({
      studio_name: 'PoW Photography Studio',
      timezone: 'Europe/Berlin',
      default_locale: 'en',
    });

    // 2. Create strict form (accept_unverified = false, default)
    const strictRes = await createForm(
      {
        name: 'Strict Verification Form',
        default_locale: 'en',
        accept_unverified: false,
        privacy_policy_url: 'https://example.com/privacy',
        fields: [
          { key: 'given_name', enabled: true, required: true, order: 0 },
          { key: 'email', enabled: true, required: true, order: 1 },
          { key: 'message', enabled: true, required: false, order: 2 },
        ],
      },
      'owner-admin',
      dbClient,
    );
    if (!strictRes.success) throw new Error(strictRes.error);
    const pubStrictRes = await publishForm(strictRes.data.id, 'owner-admin', dbClient);
    if (!pubStrictRes.success) throw new Error(pubStrictRes.error);
    strictPublishedSlug = pubStrictRes.data.slug;

    // 3. Create open form (accept_unverified = true)
    const openRes = await createForm(
      {
        name: 'Open Inquiries Form',
        default_locale: 'en',
        accept_unverified: true,
        privacy_policy_url: 'https://example.com/privacy',
        fields: [
          { key: 'given_name', enabled: true, required: true, order: 0 },
          { key: 'email', enabled: true, required: true, order: 1 },
        ],
      },
      'owner-admin',
      dbClient,
    );
    if (!openRes.success) throw new Error(openRes.error);
    const pubOpenRes = await publishForm(openRes.data.id, 'owner-admin', dbClient);
    if (!pubOpenRes.success) throw new Error(pubOpenRes.error);
    openPublishedSlug = pubOpenRes.data.slug;

    // 4. Create draft form
    const draftRes = await createForm(
      {
        name: 'Draft Form',
        default_locale: 'en',
        privacy_policy_url: 'https://example.com/privacy',
      },
      'owner-admin',
      dbClient,
    );
    if (!draftRes.success) throw new Error(draftRes.error);
    draftFormSlug = draftRes.data.slug;

    // 5. Create archived form
    const archRes = await createForm(
      {
        name: 'Archived Form',
        default_locale: 'en',
        privacy_policy_url: 'https://example.com/privacy',
      },
      'owner-admin',
      dbClient,
    );
    if (!archRes.success) throw new Error(archRes.error);
    const pubArchRes = await publishForm(archRes.data.id, 'owner-admin', dbClient);
    if (!pubArchRes.success) throw new Error(pubArchRes.error);
    await archiveForm(archRes.data.id, 'owner-admin', dbClient);
    archivedFormSlug = pubArchRes.data.slug;
  });

  it('AC-1: GET /api/public/forms/[slug]/challenge returns 200 with ALTCHA challenge and Cache-Control: no-store', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/public/forms/${strictPublishedSlug}/challenge`,
      {
        headers: {
          'x-forwarded-for': '198.51.100.55',
        },
      },
    );

    const res = await challengeRouteGet(req, {
      params: Promise.resolve({ slug: strictPublishedSlug }),
      client: dbClient,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as FormChallenge;
    expect(body.algorithm).toBe('SHA-256');
    expect(body.challenge).toMatch(/^[a-f0-9]{64}$/i);
    expect(body.maxnumber).toBeGreaterThan(0);
    expect(body.salt).toBeDefined();
    expect(body.signature).toMatch(/^[a-f0-9]{64}$/i);
  });

  it('AC-1: GET /api/public/forms/[slug]/challenge returns 404 for draft, archived, or unknown slugs', async () => {
    // Draft
    const reqDraft = new NextRequest(
      `http://localhost:3000/api/public/forms/${draftFormSlug}/challenge`,
      { headers: { 'x-forwarded-for': '198.51.100.56' } },
    );
    const resDraft = await challengeRouteGet(reqDraft, {
      params: Promise.resolve({ slug: draftFormSlug }),
      client: dbClient,
    });
    expect(resDraft.status).toBe(404);

    // Archived
    const reqArch = new NextRequest(
      `http://localhost:3000/api/public/forms/${archivedFormSlug}/challenge`,
      { headers: { 'x-forwarded-for': '198.51.100.57' } },
    );
    const resArch = await challengeRouteGet(reqArch, {
      params: Promise.resolve({ slug: archivedFormSlug }),
      client: dbClient,
    });
    expect(resArch.status).toBe(404);

    // Unknown
    const reqUnknown = new NextRequest(
      `http://localhost:3000/api/public/forms/non-existent-form/challenge`,
      { headers: { 'x-forwarded-for': '198.51.100.58' } },
    );
    const resUnknown = await challengeRouteGet(reqUnknown, {
      params: Promise.resolve({ slug: 'non-existent-form' }),
      client: dbClient,
    });
    expect(resUnknown.status).toBe(404);
  });

  it('AC-4: rate limits challenge requests to 30 per 10 minutes per anonymized IP bucket, returning 429 on 31st', async () => {
    const testIp = '198.51.100.70';

    for (let i = 1; i <= 30; i++) {
      const req = new NextRequest(
        `http://localhost:3000/api/public/forms/${strictPublishedSlug}/challenge`,
        { headers: { 'x-forwarded-for': testIp } },
      );
      const res = await challengeRouteGet(req, {
        params: Promise.resolve({ slug: strictPublishedSlug }),
        client: dbClient,
      });
      expect(res.status).toBe(200);
    }

    // 31st request from same IP bucket returns 429
    const req31 = new NextRequest(
      `http://localhost:3000/api/public/forms/${strictPublishedSlug}/challenge`,
      { headers: { 'x-forwarded-for': testIp } },
    );
    const res31 = await challengeRouteGet(req31, {
      params: Promise.resolve({ slug: strictPublishedSlug }),
      client: dbClient,
    });
    expect(res31.status).toBe(429);
    expect(await res31.text()).toBe('Too Many Requests');

    // Different IP bucket can still request
    const reqOtherIp = new NextRequest(
      `http://localhost:3000/api/public/forms/${strictPublishedSlug}/challenge`,
      { headers: { 'x-forwarded-for': '203.0.113.88' } },
    );
    const resOther = await challengeRouteGet(reqOtherIp, {
      params: Promise.resolve({ slug: strictPublishedSlug }),
      client: dbClient,
    });
    expect(resOther.status).toBe(200);
  });

  it('AC-4: fails closed with 503 Service Unavailable when rate limiter throws RateLimitUnavailableError', async () => {
    const spy = vi
      .spyOn(rateLimiterModule, 'consumeRateLimit')
      .mockRejectedValueOnce(new RateLimitUnavailableError('Database disconnected'));

    const req = new NextRequest(
      `http://localhost:3000/api/public/forms/${strictPublishedSlug}/challenge`,
      { headers: { 'x-forwarded-for': '198.51.100.99' } },
    );
    const res = await challengeRouteGet(req, {
      params: Promise.resolve({ slug: strictPublishedSlug }),
      client: dbClient,
    });

    expect(res.status).toBe(503);
    expect(await res.text()).toBe('Service Unavailable');
    spy.mockRestore();
  });

  it('AC-2: hosted form submission with valid PoW solution creates exactly one lead with verification = "verified"', async () => {
    const secret = await getOrCreatePowSecret(dbClient);
    // Challenge issued 4 seconds ago with small maxnumber for fast solving
    const issueTime = Date.now() - 4000;
    const challenge = await createFormChallenge(secret, {
      maxnumber: 200,
      params: { issued: String(issueTime) },
    });
    const solution = await solveAltchaWebCrypto(challenge);
    expect(solution).not.toBeNull();
    if (!solution) throw new Error('Expected solution');

    const res = await submitInquiry(
      {
        given_name: 'Arthur',
        email: 'arthur.verified@example.com',
        notice_acknowledged: true,
      },
      {
        slug: strictPublishedSlug, // accept_unverified = false
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.101',
        altchaPayload: solution.base64,
      },
      dbClient,
    );

    expect(res.success).toBe(true);
    if (!res.success) throw new Error('Expected success');
    expect(res.outcome).toBe('success');
    expect(res.leadId).toBeDefined();
    const createdLeadId = res.leadId;
    if (!createdLeadId) throw new Error('Expected createdLeadId');

    // Verify lead in database has verification = 'verified'
    const leadRows = await dbClient.select().from(leads).where(eq(leads.id, createdLeadId));
    expect(leadRows).toHaveLength(1);
    expect(leadRows[0]?.verification).toBe('verified');

    // Verify signature was recorded in inquiry_pow_replays
    const replayRows = await dbClient.select().from(inquiryPowReplays);
    expect(replayRows.length).toBeGreaterThanOrEqual(1);
  });

  it('AC-3: embed form submission with valid PoW solution creates lead with verification = "verified"', async () => {
    const secret = await getOrCreatePowSecret(dbClient);
    const issueTime = Date.now() - 3500;
    const challenge = await createFormChallenge(secret, {
      maxnumber: 200,
      params: { issued: String(issueTime) },
    });
    const solution = await solveAltchaWebCrypto(challenge);
    expect(solution).not.toBeNull();
    if (!solution) throw new Error('Expected solution');

    const res = await submitInquiry(
      {
        given_name: 'EmbedUser',
        email: 'embed.verified@example.com',
        notice_acknowledged: true,
      },
      {
        slug: strictPublishedSlug, // accept_unverified = false
        locale: 'en',
        deliveryMode: 'embed',
        verification: 'unverified',
        clientIp: '198.51.100.102',
        altchaPayload: solution.base64,
      },
      dbClient,
    );

    expect(res.success).toBe(true);
    if (!res.success) throw new Error('Expected success');
    expect(res.outcome).toBe('success');
    expect(res.leadId).toBeDefined();
    const embedLeadId = res.leadId;
    if (!embedLeadId) throw new Error('Expected embedLeadId');

    const leadRows = await dbClient.select().from(leads).where(eq(leads.id, embedLeadId));
    expect(leadRows).toHaveLength(1);
    expect(leadRows[0]?.verification).toBe('verified');
  });

  it('AC-5: submitting the same PoW signature twice detects replay, marks unverified, rejects strict form and logs pow_replay', async () => {
    const secret = await getOrCreatePowSecret(dbClient);
    const issueTime = Date.now() - 4000;
    const challenge = await createFormChallenge(secret, {
      maxnumber: 200,
      params: { issued: String(issueTime) },
    });
    const solution = await solveAltchaWebCrypto(challenge);
    expect(solution).not.toBeNull();
    if (!solution) throw new Error('Expected solution');

    // First submission succeeds
    const firstRes = await submitInquiry(
      {
        given_name: 'FirstUser',
        email: 'first@example.com',
        notice_acknowledged: true,
      },
      {
        slug: strictPublishedSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.103',
        altchaPayload: solution.base64,
      },
      dbClient,
    );
    expect(firstRes.success).toBe(true);

    // Second submission with exact same payload is a replay
    const secondRes = await submitInquiry(
      {
        given_name: 'ReplayAttacker',
        email: 'replay@example.com',
        notice_acknowledged: true,
      },
      {
        slug: strictPublishedSlug, // accept_unverified = false
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.104',
        altchaPayload: solution.base64,
      },
      dbClient,
    );

    expect(secondRes.success).toBe(false);
    if (!secondRes.success) {
      expect(secondRes.outcome).toBe('unverified_rejected');
      expect(secondRes.code).toBe('UNVERIFIED_REJECTED');
    }

    // Verify warning log with reason pow_replay was emitted
    const allLogs = loggedPayloads.join('\n');
    expect(allLogs).toContain('pow_replay');
  });

  it('AC-6: rejects challenge issued less than 3 seconds before submission', async () => {
    const secret = await getOrCreatePowSecret(dbClient);
    // Issued in the future or under 3s ago, guaranteeing < 3s elapsed regardless of runner CPU speed
    const issueTime = Date.now() + 5000;
    const challenge = await createFormChallenge(secret, {
      maxnumber: 200,
      params: { issued: String(issueTime) },
    });
    const solution = await solveAltchaWebCrypto(challenge);
    expect(solution).not.toBeNull();
    if (!solution) throw new Error('Expected solution');

    const res = await submitInquiry(
      {
        given_name: 'SpeedyBot',
        email: 'speedy@example.com',
        notice_acknowledged: true,
      },
      {
        slug: strictPublishedSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.105',
        altchaPayload: solution.base64,
      },
      dbClient,
    );

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.outcome).toBe('unverified_rejected');
      expect(res.code).toBe('UNVERIFIED_REJECTED');
    }
  });

  it('AC-7: rejects expired challenge (> 10 minutes)', async () => {
    const secret = await getOrCreatePowSecret(dbClient);
    // Issued 11 minutes ago, expired 1 minute ago
    const issueTime = Date.now() - (POW_EXPIRY_MS + 60000);
    const expires = new Date(issueTime + POW_EXPIRY_MS);
    const challenge = await createFormChallenge(secret, {
      maxnumber: 200,
      expires,
      params: { issued: String(issueTime) },
    });
    const solution = await solveAltchaWebCrypto(challenge);
    expect(solution).not.toBeNull();
    if (!solution) throw new Error('Expected solution');

    const res = await submitInquiry(
      {
        given_name: 'LateUser',
        email: 'late@example.com',
        notice_acknowledged: true,
      },
      {
        slug: strictPublishedSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.106',
        altchaPayload: solution.base64,
      },
      dbClient,
    );

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.outcome).toBe('unverified_rejected');
      expect(res.code).toBe('UNVERIFIED_REJECTED');
    }
  });

  it('AC-8: rejects submission with tampered signature or invalid solution', async () => {
    const secret = await getOrCreatePowSecret(dbClient);
    const issueTime = Date.now() - 4000;
    const challenge = await createFormChallenge(secret, {
      maxnumber: 200,
      params: { issued: String(issueTime) },
    });
    const solution = await solveAltchaWebCrypto(challenge);
    expect(solution).not.toBeNull();
    if (!solution) throw new Error('Expected solution');

    // Tamper with signature
    const tamperedPayload = {
      ...solution.payload,
      signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    };
    const tamperedBase64 = Buffer.from(JSON.stringify(tamperedPayload)).toString('base64');

    const res = await submitInquiry(
      {
        given_name: 'Tamperer',
        email: 'tamper@example.com',
        notice_acknowledged: true,
      },
      {
        slug: strictPublishedSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.107',
        altchaPayload: tamperedBase64,
      },
      dbClient,
    );

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.outcome).toBe('unverified_rejected');
      expect(res.code).toBe('UNVERIFIED_REJECTED');
    }
  });

  it('AC-9: form with accept_unverified = false rejects submission with no PoW payload with localized message', async () => {
    // English
    const resEn = await submitInquiry(
      {
        given_name: 'NoJsVisitor',
        email: 'nojs@example.com',
        notice_acknowledged: true,
      },
      {
        slug: strictPublishedSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.108',
      },
      dbClient,
    );

    expect(resEn.success).toBe(false);
    if (!resEn.success) {
      expect(resEn.outcome).toBe('unverified_rejected');
      expect(resEn.code).toBe('UNVERIFIED_REJECTED');
      expect(resEn.error).toBe(
        'We could not verify your submission. Please enable JavaScript and try again.',
      );
    }

    // German
    const resDe = await submitInquiry(
      {
        given_name: 'NoJsBesucher',
        email: 'nojs.de@example.com',
        notice_acknowledged: true,
      },
      {
        slug: strictPublishedSlug,
        locale: 'de',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.109',
      },
      dbClient,
    );

    expect(resDe.success).toBe(false);
    if (!resDe.success) {
      expect(resDe.outcome).toBe('unverified_rejected');
      expect(resDe.error).toBe(
        'Wir konnten Ihre Anfrage nicht verifizieren. Bitte aktivieren Sie JavaScript und versuchen Sie es erneut.',
      );
    }
  });

  it('AC-10: form with accept_unverified = true accepts submission without PoW payload as verification = "unverified"', async () => {
    const res = await submitInquiry(
      {
        given_name: 'UnverifiedAccepted',
        email: 'accepted.unverified@example.com',
        notice_acknowledged: true,
      },
      {
        slug: openPublishedSlug, // accept_unverified = true
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.110',
      },
      dbClient,
    );

    expect(res.success).toBe(true);
    if (!res.success) throw new Error('Expected success');
    expect(res.outcome).toBe('success');
    expect(res.leadId).toBeDefined();
    const openLeadId = res.leadId;
    if (!openLeadId) throw new Error('Expected openLeadId');

    const leadRows = await dbClient.select().from(leads).where(eq(leads.id, openLeadId));
    expect(leadRows).toHaveLength(1);
    expect(leadRows[0]?.verification).toBe('unverified');
  });

  it('AC-11: retention sweep deletes expired rows in inquiry_pow_replays and preserves unexpired rows', async () => {
    resetPolicies();

    const pastExpired = new Date(Date.now() - 60000); // 1 minute in the past
    const futureExpires = new Date(Date.now() + 600000); // 10 minutes in the future

    const expiredHash = '1'.repeat(64);
    const unexpiredHash = '2'.repeat(64);

    await dbClient.insert(inquiryPowReplays).values([
      { signatureHash: expiredHash, expiresAt: pastExpired },
      { signatureHash: unexpiredHash, expiresAt: futureExpires },
    ]);

    // Run live retention sweep
    const sweepResult = await runRetentionSweep({
      client: dbClient,
      dryRun: false,
    });

    const replayPolicyResult = sweepResult.policies.find(
      (p) => p.policyId === 'expired-pow-replays',
    );
    expect(replayPolicyResult).toBeDefined();
    expect(replayPolicyResult?.deletedCount).toBeGreaterThanOrEqual(1);

    // Verify database state: expiredHash is deleted, unexpiredHash is preserved
    const remainingRows = await dbClient.select().from(inquiryPowReplays);
    const remainingHashes = remainingRows.map((r) => r.signatureHash);
    expect(remainingHashes).not.toContain(expiredHash);
    expect(remainingHashes).toContain(unexpiredHash);
  });

  it('AC-13: HMAC secret in studio_settings persists across challenges and is not leaked in responses or logs', async () => {
    const req1 = new NextRequest(
      `http://localhost:3000/api/public/forms/${strictPublishedSlug}/challenge`,
      { headers: { 'x-forwarded-for': '198.51.100.120' } },
    );
    const res1 = await challengeRouteGet(req1, {
      params: Promise.resolve({ slug: strictPublishedSlug }),
      client: dbClient,
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as FormChallenge;

    // Check studio settings has hmac key stored
    const settings = await dbClient.select().from(studioSettings);
    expect(settings[0]?.forms_pow_hmac_key).toBeDefined();
    const storedSecret = settings[0]?.forms_pow_hmac_key;
    expect(storedSecret).not.toBeNull();
    if (!storedSecret) throw new Error('Expected storedSecret');

    // Key must not appear anywhere in client response JSON
    const body1Str = JSON.stringify(body1);
    expect(body1Str).not.toContain(storedSecret);

    // Next challenge uses the same secret
    const req2 = new NextRequest(
      `http://localhost:3000/api/public/forms/${strictPublishedSlug}/challenge`,
      { headers: { 'x-forwarded-for': '198.51.100.121' } },
    );
    const res2 = await challengeRouteGet(req2, {
      params: Promise.resolve({ slug: strictPublishedSlug }),
      client: dbClient,
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as FormChallenge;

    const body2Str = JSON.stringify(body2);
    expect(body2Str).not.toContain(storedSecret);

    // Verify logs never contain storedSecret
    const allLogs = loggedPayloads.join('\n');
    expect(allLogs).not.toContain(storedSecret);
  });
});
