import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { POST } from '@/app/api/public/forms/[slug]/submissions/route';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { inquiryForms } from '@/server/db/schema/inquiry-forms';
import { leads } from '@/server/db/schema/leads';
import { createForm, publishForm } from '@/server/inquiry-forms/service';
import { logger } from '@/server/log';
import type { DbClient } from '@/server/db/client';

describe('AC-4 to AC-9: Script-free cross-origin POST handler', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  let publishedFormSlug: string;
  let publishedFormId: string;
  let strictFormSlug: string;

  const originalEmbedOrigins = process.env.PUBLIC_FORMS_EMBED_ORIGINS;
  const ALLOWED_ORIGIN = 'https://photographer.example';
  const OTHER_ALLOWED_ORIGIN = 'https://studio.example';

  const loggedPayloads: string[] = [];

  beforeEach(async () => {
    process.env.PUBLIC_FORMS_EMBED_ORIGINS = `${ALLOWED_ORIGIN},${OTHER_ALLOWED_ORIGIN}`;

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

    // 1. Studio settings
    await dbClient.insert(studioSettings).values({
      studio_name: 'Test Photo Studio',
      timezone: 'Europe/Berlin',
      default_locale: 'en',
    });

    // 2. Published form with accept_unverified = true
    const createRes = await createForm(
      {
        name: 'Contact Form',
        default_locale: 'en',
        accept_unverified: true,
        privacy_policy_url: 'https://photographer.example/privacy',
        fields: [
          { key: 'given_name', enabled: true, required: true, order: 0 },
          { key: 'family_name', enabled: true, required: false, order: 1 },
          { key: 'email', enabled: true, required: true, order: 2 },
          { key: 'phone', enabled: true, required: false, order: 3 },
          { key: 'message', enabled: true, required: false, order: 4 },
        ],
        event_types: [],
      },
      'test-owner',
      dbClient,
    );
    if (!createRes.success) throw new Error(createRes.error);
    publishedFormId = createRes.data.id;

    const pubRes = await publishForm(publishedFormId, 'test-owner', dbClient);
    if (!pubRes.success) throw new Error(pubRes.error);
    publishedFormSlug = pubRes.data.slug;

    // 3. Published form with accept_unverified = false
    const strictRes = await createForm(
      {
        name: 'Strict Verification Form',
        default_locale: 'en',
        accept_unverified: false,
        privacy_policy_url: 'https://photographer.example/privacy',
        fields: [
          { key: 'given_name', enabled: true, required: true, order: 0 },
          { key: 'email', enabled: true, required: true, order: 1 },
        ],
        event_types: [],
      },
      'test-owner',
      dbClient,
    );
    if (!strictRes.success) throw new Error(strictRes.error);

    const pubStrictRes = await publishForm(strictRes.data.id, 'test-owner', dbClient);
    if (!pubStrictRes.success) throw new Error(pubStrictRes.error);
    strictFormSlug = pubStrictRes.data.slug;
  });

  afterEach(async () => {
    process.env.PUBLIC_FORMS_EMBED_ORIGINS = originalEmbedOrigins;
    await testDb.destroy();
    vi.restoreAllMocks();
  });

  function buildFormRequest({
    slug,
    body,
    origin = ALLOWED_ORIGIN,
    contentType = 'application/x-www-form-urlencoded',
  }: {
    slug: string;
    body: string;
    origin?: string | null;
    contentType?: string | null;
  }): NextRequest {
    const headers: Record<string, string> = {};
    if (contentType !== null) {
      headers['content-type'] = contentType;
    }
    if (origin !== null) {
      headers.origin = origin;
    }
    headers['content-length'] = String(Buffer.byteLength(body, 'utf8'));

    return new NextRequest(`http://localhost:3000/api/public/forms/${slug}/submissions`, {
      method: 'POST',
      headers,
      body,
    });
  }

  it('AC-4 (R-A): valid script-free submission creates lead with delivery_mode = script_free and verification = unverified, redirects 303 to hosted thanks page', async () => {
    const body = new URLSearchParams({
      given_name: 'Alexander',
      family_name: 'Hamilton',
      email: 'alexander@example.com',
      message: 'Looking for a portrait session.',
      notice_acknowledged: 'true',
    }).toString();

    const req = buildFormRequest({ slug: publishedFormSlug, body });
    const res = await POST(req, {
      params: Promise.resolve({ slug: publishedFormSlug }),
      client: dbClient,
    });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `http://localhost:3000/en/f/${publishedFormSlug}/thanks`,
    );

    // Assert lead in database
    const createdLeads = await dbClient.select().from(leads);
    expect(createdLeads).toHaveLength(1);
    const lead = createdLeads[0];
    expect(lead).toBeDefined();
    if (!lead) throw new Error('Lead not found');
    expect(lead.givenName).toBe('Alexander');
    expect(lead.familyName).toBe('Hamilton');
    expect(lead.email).toBe('alexander@example.com');
    expect(lead.deliveryMode).toBe('script_free');
    expect(lead.verification).toBe('unverified');
  });

  it('AC-2 (R-A): returns 403 Forbidden when PUBLIC_FORMS_EMBED_ORIGINS is unset or empty', async () => {
    process.env.PUBLIC_FORMS_EMBED_ORIGINS = '';

    const body = new URLSearchParams({
      given_name: 'Alexander',
      email: 'alexander@example.com',
      notice_acknowledged: 'true',
    }).toString();

    const req = buildFormRequest({ slug: publishedFormSlug, body });
    const res = await POST(req, {
      params: Promise.resolve({ slug: publishedFormSlug }),
      client: dbClient,
    });

    expect(res.status).toBe(403);

    const createdLeads = await dbClient.select().from(leads);
    expect(createdLeads).toHaveLength(0);
  });

  it('AC-5: rejects request with missing Origin header with 403 Forbidden and creates no lead', async () => {
    const body = new URLSearchParams({
      given_name: 'Alexander',
      email: 'alexander@example.com',
      notice_acknowledged: 'true',
    }).toString();

    const req = buildFormRequest({ slug: publishedFormSlug, body, origin: null });
    const res = await POST(req, {
      params: Promise.resolve({ slug: publishedFormSlug }),
      client: dbClient,
    });

    expect(res.status).toBe(403);
    const createdLeads = await dbClient.select().from(leads);
    expect(createdLeads).toHaveLength(0);
  });

  it('AC-5: rejects request with null Origin header with 403 Forbidden and creates no lead', async () => {
    const body = new URLSearchParams({
      given_name: 'Alexander',
      email: 'alexander@example.com',
      notice_acknowledged: 'true',
    }).toString();

    const req = buildFormRequest({ slug: publishedFormSlug, body, origin: 'null' });
    const res = await POST(req, {
      params: Promise.resolve({ slug: publishedFormSlug }),
      client: dbClient,
    });

    expect(res.status).toBe(403);
    const createdLeads = await dbClient.select().from(leads);
    expect(createdLeads).toHaveLength(0);
  });

  it('AC-5: rejects request with unlisted Origin header with 403 Forbidden and creates no lead', async () => {
    const body = new URLSearchParams({
      given_name: 'Alexander',
      email: 'alexander@example.com',
      notice_acknowledged: 'true',
    }).toString();

    const req = buildFormRequest({
      slug: publishedFormSlug,
      body,
      origin: 'https://attacker.example',
    });
    const res = await POST(req, {
      params: Promise.resolve({ slug: publishedFormSlug }),
      client: dbClient,
    });

    expect(res.status).toBe(403);
    const createdLeads = await dbClient.select().from(leads);
    expect(createdLeads).toHaveLength(0);
  });

  it('AC-6: redirects 303 to success_redirect_url when origin is in allowed embed origins', async () => {
    // Configure success_redirect_url on form
    await dbClient
      .update(inquiryForms)
      .set({ successRedirectUrl: 'https://photographer.example/thank-you' })
      .where(eq(inquiryForms.id, publishedFormId));

    const body = new URLSearchParams({
      given_name: 'Alexander',
      email: 'alexander@example.com',
      notice_acknowledged: 'true',
    }).toString();

    const req = buildFormRequest({ slug: publishedFormSlug, body });
    const res = await POST(req, {
      params: Promise.resolve({ slug: publishedFormSlug }),
      client: dbClient,
    });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://photographer.example/thank-you');

    const createdLeads = await dbClient.select().from(leads);
    expect(createdLeads).toHaveLength(1);
  });

  it('AC-7: redirects only to hosted thanks page when form success_redirect_url has unlisted origin', async () => {
    // Configure malicious redirect destination on form
    await dbClient
      .update(inquiryForms)
      .set({ successRedirectUrl: 'https://attacker.example/phish' })
      .where(eq(inquiryForms.id, publishedFormId));

    const body = new URLSearchParams({
      given_name: 'Alexander',
      email: 'alexander@example.com',
      notice_acknowledged: 'true',
    }).toString();

    const req = buildFormRequest({ slug: publishedFormSlug, body });
    const res = await POST(req, {
      params: Promise.resolve({ slug: publishedFormSlug }),
      client: dbClient,
    });

    expect(res.status).toBe(303);
    // Must fall back to hosted thanks page, NEVER redirecting to attacker.example
    expect(res.headers.get('location')).toBe(
      `http://localhost:3000/en/f/${publishedFormSlug}/thanks`,
    );
  });

  it('AC-8: redirects 303 to error=unverified and creates no lead when form has accept_unverified = false', async () => {
    const body = new URLSearchParams({
      given_name: 'Alexander',
      email: 'alexander@example.com',
      notice_acknowledged: 'true',
    }).toString();

    const req = buildFormRequest({ slug: strictFormSlug, body });
    const res = await POST(req, {
      params: Promise.resolve({ slug: strictFormSlug }),
      client: dbClient,
    });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `http://localhost:3000/en/f/${strictFormSlug}?error=unverified`,
    );

    const createdLeads = await dbClient.select().from(leads);
    expect(createdLeads).toHaveLength(0);
  });

  it('AC-9: honeypot field website filled redirects 303 to success URL without storing lead row', async () => {
    const body = new URLSearchParams({
      given_name: 'Bot User',
      email: 'bot@example.com',
      website: 'https://spam-link.example',
      notice_acknowledged: 'true',
    }).toString();

    const req = buildFormRequest({ slug: publishedFormSlug, body });
    const res = await POST(req, {
      params: Promise.resolve({ slug: publishedFormSlug }),
      client: dbClient,
    });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `http://localhost:3000/en/f/${publishedFormSlug}/thanks`,
    );

    // Verify 0 leads in database
    const createdLeads = await dbClient.select().from(leads);
    expect(createdLeads).toHaveLength(0);
  });

  it('rejects unsupported Content-Type with 415 Unsupported Media Type', async () => {
    const req = buildFormRequest({
      slug: publishedFormSlug,
      body: JSON.stringify({ given_name: 'Alex' }),
      contentType: 'application/json',
    });

    const res = await POST(req, {
      params: Promise.resolve({ slug: publishedFormSlug }),
      client: dbClient,
    });

    expect(res.status).toBe(415);
  });

  it('rejects request exceeding 16 KiB with 413 Payload Too Large', async () => {
    const hugeMessage = 'a'.repeat(17 * 1024); // 17 KiB
    const body = new URLSearchParams({
      given_name: 'Alex',
      email: 'alex@example.com',
      message: hugeMessage,
      notice_acknowledged: 'true',
    }).toString();

    const req = buildFormRequest({ slug: publishedFormSlug, body });
    const res = await POST(req, {
      params: Promise.resolve({ slug: publishedFormSlug }),
      client: dbClient,
    });

    expect(res.status).toBe(413);
  });

  it('returns 404 Not Found for non-existent form slug', async () => {
    const body = new URLSearchParams({
      given_name: 'Alex',
      email: 'alex@example.com',
      notice_acknowledged: 'true',
    }).toString();

    const req = buildFormRequest({ slug: 'unknown-slug-xyz', body });
    const res = await POST(req, {
      params: Promise.resolve({ slug: 'unknown-slug-xyz' }),
      client: dbClient,
    });

    expect(res.status).toBe(404);
  });

  it('validation failure redirects 303 to error=invalid', async () => {
    // Missing required email
    const body = new URLSearchParams({
      given_name: 'Alex',
      notice_acknowledged: 'true',
    }).toString();

    const req = buildFormRequest({ slug: publishedFormSlug, body });
    const res = await POST(req, {
      params: Promise.resolve({ slug: publishedFormSlug }),
      client: dbClient,
    });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `http://localhost:3000/en/f/${publishedFormSlug}?error=invalid`,
    );
  });

  it('sets security headers on all responses (Cache-Control: no-store, X-Content-Type-Options: nosniff, Referrer-Policy: no-referrer)', async () => {
    const body = new URLSearchParams({
      given_name: 'Alexander',
      email: 'alexander@example.com',
      notice_acknowledged: 'true',
    }).toString();

    const req = buildFormRequest({ slug: publishedFormSlug, body });
    const res = await POST(req, {
      params: Promise.resolve({ slug: publishedFormSlug }),
      client: dbClient,
    });

    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('upholds zero PII logging guarantee during submission processing', async () => {
    const canaryEmail = 'canary-secret-pii@example.com';
    const canaryName = 'CanaryUniquePIIName';

    const body = new URLSearchParams({
      given_name: canaryName,
      email: canaryEmail,
      notice_acknowledged: 'true',
    }).toString();

    const req = buildFormRequest({ slug: publishedFormSlug, body });
    await POST(req, {
      params: Promise.resolve({ slug: publishedFormSlug }),
      client: dbClient,
    });

    // Check all logs
    const joinedLogs = loggedPayloads.join(' ');
    expect(joinedLogs).not.toContain(canaryEmail);
    expect(joinedLogs).not.toContain(canaryName);
  });
});
