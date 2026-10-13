import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { logger } from '@/server/log';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { leads } from '@/server/db/schema/leads';
import { auditEvents } from '@/server/db/schema/audit';
import { createForm, publishForm } from '@/server/inquiry-forms/service';
import { submitInquiry } from '@/server/inquiry-forms/submit';
import { PUBLIC_AUTH_ACTIONS, isPublicAuthAction } from '@/server/auth/public-actions';
import { scanServerActions, checkAllowlistComments } from '../helpers/server-action-scanner';
import * as rateLimiterModule from '@/server/auth/rate-limiter';
import { RateLimitUnavailableError } from '@/server/auth/rate-limiter';
import type { DbClient } from '@/server/db/client';

describe('TASK-0027: submitInquiry Service Integration Tests', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  let publishedFormSlug: string;
  let strictFormSlug: string;
  let draftFormSlug: string;

  const loggedPayloads: string[] = [];

  const CANARY = {
    givenName: 'CanaryFirstName123',
    familyName: 'CanaryLastName456',
    email: 'canary.submit.test@example.com',
    phone: '+49 30 11223344',
    message: 'CanarySecretInquiryMessage777',
    eventLocation: 'CanarySecretVenueLocation',
    rawIp: '198.51.100.42',
  };

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
    vi.spyOn(logger, 'debug').mockImplementation((...args) => {
      loggedPayloads.push(JSON.stringify(args));
    });

    // 1. Seed studio settings
    await dbClient.insert(studioSettings).values({
      studio_name: 'Studio Test Photography',
      timezone: 'Europe/Berlin',
      default_locale: 'en',
    });

    // 2. Create and publish a form with accept_unverified = true and all fields enabled
    const createRes = await createForm(
      {
        name: 'Open Inquiries',
        default_locale: 'en',
        accept_unverified: true,
        privacy_policy_url: 'https://example.com/privacy',
        fields: [
          { key: 'given_name', enabled: true, required: true, order: 0 },
          { key: 'family_name', enabled: true, required: false, order: 1 },
          { key: 'email', enabled: true, required: true, order: 2 },
          { key: 'phone', enabled: true, required: false, order: 3 },
          { key: 'event_type', enabled: true, required: false, order: 4 },
          { key: 'event_date', enabled: true, required: false, order: 5 },
          { key: 'event_location', enabled: true, required: false, order: 6 },
          { key: 'message', enabled: true, required: false, order: 7 },
        ],
        event_types: [
          { key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' },
          { key: 'portrait', label_en: 'Portrait', label_de: 'Porträt' },
        ],
      },
      'owner-admin',
      dbClient,
    );
    if (!createRes.success) throw new Error(createRes.error);
    const pubRes = await publishForm(createRes.data.id, 'owner-admin', dbClient);
    if (!pubRes.success) throw new Error(pubRes.error);
    publishedFormSlug = pubRes.data.slug;

    // 3. Create and publish a form with accept_unverified = false (default)
    const strictRes = await createForm(
      {
        name: 'Strict Inquiries',
        default_locale: 'en',
        accept_unverified: false,
        privacy_policy_url: 'https://example.com/privacy',
      },
      'owner-admin',
      dbClient,
    );
    if (!strictRes.success) throw new Error(strictRes.error);
    const pubStrictRes = await publishForm(strictRes.data.id, 'owner-admin', dbClient);
    if (!pubStrictRes.success) throw new Error(pubStrictRes.error);
    strictFormSlug = pubStrictRes.data.slug;

    // 4. Create a draft form (unpublished)
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
  });

  it('AC-1: creates a new lead with delivery_mode=hosted, verification=unverified, and notice version info', async () => {
    const res = await submitInquiry(
      {
        given_name: 'Alice',
        family_name: 'Wonderland',
        email: 'alice@example.com',
        phone: '+49 30 123456',
        event_type: 'wedding',
        event_date: '2027-06-15',
        event_location: 'Berlin',
        message: 'Looking forward to our photoshoot!',
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.99',
      },
      dbClient,
    );

    expect(res.success).toBe(true);
    expect(res.outcome).toBe('success');
    expect(res.leadId).toBeDefined();

    const createdLeads = await dbClient.select().from(leads);
    expect(createdLeads).toHaveLength(1);

    const lead = createdLeads[0];
    expect(lead).toBeDefined();
    if (!lead) throw new Error('Lead not found');
    expect(lead.id).toBe(res.leadId);
    expect(lead.deliveryMode).toBe('hosted');
    expect(lead.verification).toBe('unverified');
    expect(lead.status).toBe('new');
    expect(lead.locale).toBe('en');
    expect(lead.givenName).toBe('Alice');
    expect(lead.familyName).toBe('Wonderland');
    expect(lead.email).toBe('alice@example.com');
    expect(lead.emailNormalized).toBe('alice@example.com');
    expect(lead.phone).toBe('+49 30 123456');
    expect(lead.eventTypeKey).toBe('wedding');
    expect(lead.eventDate).toBe('2027-06-15');
    expect(lead.eventLocation).toBe('Berlin');
    expect(lead.message).toBe('Looking forward to our photoshoot!');
    expect(lead.noticeVersionId).toBeDefined();
    expect(lead.noticeAcknowledgedAt).toBeInstanceOf(Date);
    expect(Date.now() - lead.noticeAcknowledgedAt.getTime()).toBeLessThan(5000);
  });

  it('AC-8: draft and unknown slugs return identical not_found outcome', async () => {
    const draftRes = await submitInquiry(
      {
        given_name: 'Test',
        email: 'test@example.com',
        notice_acknowledged: true,
      },
      {
        slug: draftFormSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.1',
      },
      dbClient,
    );
    expect(draftRes.success).toBe(false);
    expect(draftRes.outcome).toBe('not_found');
    expect(draftRes.code).toBe('NOT_FOUND');

    const unknownRes = await submitInquiry(
      {
        given_name: 'Test',
        email: 'test@example.com',
        notice_acknowledged: true,
      },
      {
        slug: 'non-existent-form-slug-xyz',
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.1',
      },
      dbClient,
    );
    expect(unknownRes.success).toBe(false);
    expect(unknownRes.outcome).toBe('not_found');
    expect(unknownRes.code).toBe('NOT_FOUND');
  });

  it('AC-3: honeypot field filled returns accepted_silently, persists nothing, logs honeypot, and writes no audit event', async () => {
    const auditCountBefore = (await dbClient.select().from(auditEvents)).length;
    const leadsCountBefore = (await dbClient.select().from(leads)).length;

    const result = await submitInquiry(
      {
        given_name: 'Spammy',
        email: 'spammer@example.com',
        website: 'https://spam-link.ru', // Honeypot filled!
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.5',
      },
      dbClient,
    );

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('accepted_silently');
    expect(result.redirectUrl).toBe(`/en/f/${publishedFormSlug}/thanks`);

    // Persist nothing: no lead created
    const leadsCountAfter = (await dbClient.select().from(leads)).length;
    expect(leadsCountAfter).toBe(leadsCountBefore);

    // No audit event written
    const auditCountAfter = (await dbClient.select().from(auditEvents)).length;
    expect(auditCountAfter).toBe(auditCountBefore);

    // One log line with reason 'honeypot' written
    const honeypotLogs = loggedPayloads.filter((p) => p.includes('"honeypot"'));
    expect(honeypotLogs.length).toBe(1);
    expect(honeypotLogs[0]).toContain('"accepted_silently"');
  });

  it('AC-4: rate limits 5 accepted submissions per IP bucket within 10 min, rejects 6th, while distinct IP succeeds', async () => {
    const ip = '198.51.100.22';

    // 5 successful submissions from the same IP
    for (let i = 1; i <= 5; i++) {
      const res = await submitInquiry(
        {
          given_name: `Submitter ${String(i)}`,
          email: `submitter${String(i)}@example.com`,
          notice_acknowledged: true,
        },
        {
          slug: publishedFormSlug,
          locale: 'en',
          deliveryMode: 'hosted',
          verification: 'unverified',
          clientIp: ip,
        },
        dbClient,
      );
      expect(res.success).toBe(true);
      expect(res.outcome).toBe('success');
    }

    // 6th attempt from the same IP must be RATE_LIMITED
    const res6 = await submitInquiry(
      {
        given_name: 'Submitter 6',
        email: 'submitter6@example.com',
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: ip,
      },
      dbClient,
    );

    expect(res6.success).toBe(false);
    if (!res6.success) {
      expect(res6.outcome).toBe('rate_limited');
      expect(res6.code).toBe('RATE_LIMITED');
      expect(res6.error).toBe('Too many attempts, please try again later');
    }

    // A different IP bucket still succeeds
    const differentIpRes = await submitInquiry(
      {
        given_name: 'Other IP Submitter',
        email: 'other.ip@example.com',
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '203.0.113.88',
      },
      dbClient,
    );
    expect(differentIpRes.success).toBe(true);
    expect(differentIpRes.outcome).toBe('success');
  });

  it('AC-5: form circuit breaker triggers after 100 submissions to one form within an hour from distinct IPs', async () => {
    // Perform 100 submissions from distinct IP buckets
    for (let i = 1; i <= 100; i++) {
      const ip = `192.168.${String(i)}.1`;
      const res = await submitInquiry(
        {
          given_name: `Flood Test ${String(i)}`,
          email: `flood${String(i)}@example.com`,
          notice_acknowledged: true,
        },
        {
          slug: publishedFormSlug,
          locale: 'en',
          deliveryMode: 'hosted',
          verification: 'unverified',
          clientIp: ip,
        },
        dbClient,
      );
      expect(res.success).toBe(true);
    }

    // 101st submission arrives from a new IP bucket
    const res101 = await submitInquiry(
      {
        given_name: 'Flood 101',
        email: 'flood101@example.com',
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '192.168.99.1',
      },
      dbClient,
    );

    expect(res101.success).toBe(false);
    if (!res101.success) {
      expect(res101.outcome).toBe('rate_limited');
      expect(res101.code).toBe('RATE_LIMITED');
      expect(res101.error).toBe('Too many attempts, please try again later');
    }
  });

  it('AC-6: fails closed with UNAVAILABLE when rate limit store is unavailable', async () => {
    // Simulate rate limiter store failure
    const consumeSpy = vi
      .spyOn(rateLimiterModule, 'consumeRateLimit')
      .mockRejectedValueOnce(new RateLimitUnavailableError('Simulated DB connection failure'));

    const leadsCountBefore = (await dbClient.select().from(leads)).length;

    const res = await submitInquiry(
      {
        given_name: 'Test Visitor',
        email: 'visitor@example.com',
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.99',
      },
      dbClient,
    );

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.outcome).toBe('unavailable');
      expect(res.code).toBe('UNAVAILABLE');
    }

    // No lead created
    const leadsCountAfter = (await dbClient.select().from(leads)).length;
    expect(leadsCountAfter).toBe(leadsCountBefore);

    consumeSpy.mockRestore();
  });

  it('AC-7: rejects unverified submissions with UNVERIFIED_REJECTED on forms with accept_unverified = false', async () => {
    const leadsCountBefore = (await dbClient.select().from(leads)).length;

    const res = await submitInquiry(
      {
        given_name: 'Alice',
        email: 'alice@example.com',
        notice_acknowledged: true,
      },
      {
        slug: strictFormSlug, // accept_unverified = false
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.10',
      },
      dbClient,
    );

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.outcome).toBe('unverified_rejected');
      expect(res.code).toBe('UNVERIFIED_REJECTED');
      expect(res.error).toBe(
        'We could not verify your submission. Please enable JavaScript and try again.',
      );
    }

    // No lead created
    const leadsCountAfter = (await dbClient.select().from(leads)).length;
    expect(leadsCountAfter).toBe(leadsCountBefore);
  });

  it('AC-9: returns VALIDATION_FAILED with field keys for invalid input, and creates no lead', async () => {
    const leadsCountBefore = (await dbClient.select().from(leads)).length;

    // Unknown field key
    const resUnknown = await submitInquiry(
      {
        given_name: 'Test',
        email: 'test@example.com',
        notice_acknowledged: true,
        extra_malicious_key: 'hacked',
      },
      {
        slug: publishedFormSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.11',
      },
      dbClient,
    );
    expect(resUnknown.success).toBe(false);
    if (!resUnknown.success) {
      expect(resUnknown.outcome).toBe('validation_failed');
      expect(resUnknown.code).toBe('VALIDATION_FAILED');
    }

    // Email with CRLF
    const resCRLF = await submitInquiry(
      {
        given_name: 'Test',
        email: 'test@example.com\r\nBcc: evil@example.com',
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.12',
      },
      dbClient,
    );
    expect(resCRLF.success).toBe(false);
    expect(resCRLF.outcome).toBe('validation_failed');

    // Past date
    const resPastDate = await submitInquiry(
      {
        given_name: 'Test',
        email: 'test@example.com',
        event_date: '2019-01-01',
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.13',
      },
      dbClient,
    );
    expect(resPastDate.success).toBe(false);
    expect(resPastDate.outcome).toBe('validation_failed');

    // 2001 chars message
    const resLongMsg = await submitInquiry(
      {
        given_name: 'Test',
        email: 'test@example.com',
        message: 'x'.repeat(2001),
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.14',
      },
      dbClient,
    );
    expect(resLongMsg.success).toBe(false);
    expect(resLongMsg.outcome).toBe('validation_failed');

    // Verify 0 leads created
    const leadsCountAfter = (await dbClient.select().from(leads)).length;
    expect(leadsCountAfter).toBe(leadsCountBefore);
  });

  it('AC-15: logs captured during submissions contain only allowed fields of ADR-0015 §12 (no canary personal data)', async () => {
    // Clear logged payloads
    loggedPayloads.length = 0;

    // Submit with canary personal data
    const res = await submitInquiry(
      {
        given_name: CANARY.givenName,
        family_name: CANARY.familyName,
        email: CANARY.email,
        phone: CANARY.phone,
        message: CANARY.message,
        event_location: CANARY.eventLocation,
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: CANARY.rawIp,
      },
      dbClient,
    );

    expect(res.success).toBe(true);

    // Verify that NO logged payload contains any canary personal data
    const allLogsCombined = loggedPayloads.join('\n');
    expect(allLogsCombined).not.toContain(CANARY.givenName);
    expect(allLogsCombined).not.toContain(CANARY.familyName);
    expect(allLogsCombined).not.toContain(CANARY.email);
    expect(allLogsCombined).not.toContain(CANARY.phone);
    expect(allLogsCombined).not.toContain(CANARY.message);
    expect(allLogsCombined).not.toContain(CANARY.eventLocation);
    expect(allLogsCombined).not.toContain(CANARY.rawIp);
  });

  it('AC-12: localized German validation errors are returned when locale is de', async () => {
    const res = await submitInquiry(
      {
        given_name: '',
        email: 'invalid-email',
        notice_acknowledged: false,
      },
      {
        slug: publishedFormSlug,
        locale: 'de',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.99',
      },
      dbClient,
    );

    expect(res.success).toBe(false);
    expect(res.outcome).toBe('validation_failed');
    expect(res.fieldErrors?.given_name).toBe('Dieses Feld ist erforderlich');
    expect(res.fieldErrors?.email).toBe('Bitte geben Sie eine gültige E-Mail-Adresse ein');
    expect(res.fieldErrors?.notice_acknowledged).toBe(
      'Sie müssen die Datenschutzerklärung zur Kenntnis nehmen',
    );
  });

  it('AC-16: submitInquiryAction is allowlisted in PUBLIC_AUTH_ACTIONS with compensating comment', () => {
    expect(PUBLIC_AUTH_ACTIONS).toContain('submitInquiryAction');
    expect(isPublicAuthAction('submitInquiryAction')).toBe(true);

    const rootDir = path.resolve(process.cwd(), 'src');
    const publicActionsFile = path.resolve(process.cwd(), 'src/server/auth/public-actions.ts');

    const commentViolations = checkAllowlistComments(publicActionsFile);
    expect(commentViolations).toEqual([]);

    const result = scanServerActions({
      rootDir,
      allowlist: PUBLIC_AUTH_ACTIONS,
      publicActionsFile,
      checkAllowlistComments: true,
    });
    expect(result.violations).toEqual([]);
  });
});
