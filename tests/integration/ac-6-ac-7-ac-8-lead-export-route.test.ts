import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq, sql } from 'drizzle-orm';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { POST } from '@/app/api/privacy/exports/route';
import { user, session } from '@/server/db/schema/auth';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { leads } from '@/server/db/schema/leads';
import { auditEvents } from '@/server/db/schema/audit';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { createApiKey } from '@/server/auth/api-keys';
import type { DbClient } from '@/server/db/client';

describe('TASK-0026: Lead DSAR Export Route (AC-6, AC-7, AC-8)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;
  let formId: string;
  let noticeVersionId: string;
  let testLeadId: string;

  const appOrigin = 'http://localhost:3000';

  interface ExportJsonPayload {
    schema: string;
    subject: {
      role: string;
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    };
    categories: {
      leads?: {
        given_name: string;
        family_name: string;
        email: string;
        phone: string;
        message: string;
        form_name: string;
        notice_acknowledgement_text_de: string;
        notice_privacy_policy_url: string;
        verification: string;
        delivery_mode: string;
        auto_reply_status: string;
        audit_actions: { action: string }[];
      }[];
    };
  }

  interface ApiErrorBody {
    error?: string;
    code?: string;
  }

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    // 1. Seed studio owner
    ownerUser = {
      id: '018f0000-0000-7000-8000-000000000001',
      name: 'Studio Owner',
      email: 'owner@studio-lumiere.test',
      role: 'owner',
    };
    await dbClient.insert(user).values({
      id: ownerUser.id,
      name: ownerUser.name,
      email: ownerUser.email,
      emailVerified: true,
      role: ownerUser.role,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // 2. Active session for owner (fresh reauth by default)
    const sessionRes = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRes.token;

    // 3. Studio settings
    await dbClient.insert(studioSettings).values({
      studio_name: 'Studio Lumière',
      currency: 'EUR',
      default_locale: 'de',
      timezone: 'Europe/Berlin',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });

    // 4. Inquiry form and notice version
    formId = '018f0000-0000-7000-8000-000000000010';
    noticeVersionId = '018f0000-0000-7000-8000-000000000011';

    await dbClient.insert(inquiryForms).values({
      id: formId,
      name: 'Wedding Inquiry Form',
      slug: 'wedding-form',
      status: 'published',
      defaultLocale: 'de',
      fields: [
        { key: 'given_name', enabled: true, required: true, order: 0 },
        { key: 'email', enabled: true, required: true, order: 1 },
      ],
      eventTypes: [],
      currentNoticeVersionId: null,
      autoReplyEnabled: true,
      acceptUnverified: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await dbClient.insert(inquiryFormNoticeVersions).values({
      id: noticeVersionId,
      formId: formId,
      version: 1,
      acknowledgementTextEn: 'Privacy notice text explaining Art. 6(1)(b) processing.',
      acknowledgementTextDe: 'Datenschutzerklärung zur Erläuterung der Art. 6(1)(b) Verarbeitung.',
      privacyPolicyUrl: 'https://example.com/privacy-notice-v1',
      createdByActorId: ownerUser.id,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    await dbClient
      .update(inquiryForms)
      .set({ currentNoticeVersionId: noticeVersionId })
      .where(eq(inquiryForms.id, formId));

    // 5. Seed test lead
    testLeadId = '018f0000-0000-7000-8000-000000000099';
    await dbClient.insert(leads).values({
      id: testLeadId,
      status: 'new',
      formId: formId,
      noticeVersionId: noticeVersionId,
      noticeAcknowledgedAt: new Date('2026-01-10T10:00:00Z'),
      givenName: 'Jane',
      familyName: 'Doe',
      email: 'jane.doe@example.com',
      emailNormalized: 'jane.doe@example.com',
      phone: '+49 30 123456',
      message: 'Looking for a portrait session in Berlin.',
      eventTypeKey: 'portrait',
      eventDate: '2026-08-15',
      eventLocation: 'Berlin',
      locale: 'de',
      verification: 'verified',
      deliveryMode: 'hosted',
      autoReplyStatus: 'not_applicable',
      receivedAt: new Date('2026-01-10T10:00:00Z'),
      lastActivityAt: new Date('2026-01-10T10:00:00Z'),
      createdAt: new Date('2026-01-10T10:00:00Z'),
      updatedAt: new Date('2026-01-10T10:00:00Z'),
    });

    // 6. Seed audit event for lead received
    await dbClient.insert(auditEvents).values({
      id: '018f0000-0000-7000-8000-000000000101',
      action: 'lead.received',
      actorType: 'system',
      actorId: 'public-inquiry-endpoint',
      targetType: 'lead',
      targetId: testLeadId,
      outcome: 'success',
      metadata: {
        form_id: formId,
        verification: 'verified',
        delivery_mode: 'hosted',
      },
      occurredAt: new Date('2026-01-10T10:00:00Z'),
    });
  });

  afterEach(async () => {
    await testDb.destroy();
    vi.restoreAllMocks();
  });

  function buildRequest({
    body = {},
    token = sessionToken,
    origin = appOrigin,
    authHeader,
  }: {
    body?: unknown;
    token?: string | null;
    origin?: string | null;
    authHeader?: string;
  } = {}): NextRequest {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      host: 'localhost:3000',
    };

    if (origin !== null) {
      headers.origin = origin;
    }
    if (token) {
      headers.cookie = `${SESSION_COOKIE_NAME}=${token}`;
    }
    if (authHeader) {
      headers.authorization = authHeader;
    }

    return new NextRequest(new URL('/api/privacy/exports', appOrigin), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  it('AC-6 (R-A): POST /api/privacy/exports with leadId generates ownlight.dsar.v1 json with no-store and audit log', async () => {
    const req = buildRequest({
      body: {
        leadId: testLeadId,
        format: 'json',
        locale: 'de',
      },
    });

    const res = await POST(req, { client: dbClient });
    expect(res.status).toBe(200);

    // Cache-Control: no-store
    expect(res.headers.get('cache-control')).toBe('no-store');

    const json = (await res.json()) as ExportJsonPayload;
    expect(json.schema).toBe('ownlight.dsar.v1');
    expect(json.subject.role).toBe('lead');
    expect(json.subject.id).toBe(testLeadId);
    expect(json.subject.first_name).toBe('Jane');
    expect(json.subject.last_name).toBe('Doe');
    expect(json.subject.email).toBe('jane.doe@example.com');

    // Leads category
    const leadsCategory = json.categories.leads;
    expect(leadsCategory).toBeDefined();
    if (!leadsCategory || leadsCategory.length === 0) {
      throw new Error('Expected leads category to have entries');
    }
    expect(Array.isArray(leadsCategory)).toBe(true);
    expect(leadsCategory).toHaveLength(1);

    const leadItem = leadsCategory[0];
    expect(leadItem).toBeDefined();
    if (!leadItem) {
      throw new Error('Expected leadItem to be defined');
    }
    expect(leadItem.given_name).toBe('Jane');
    expect(leadItem.family_name).toBe('Doe');
    expect(leadItem.email).toBe('jane.doe@example.com');
    expect(leadItem.phone).toBe('+49 30 123456');
    expect(leadItem.message).toBe('Looking for a portrait session in Berlin.');
    expect(leadItem.form_name).toBe('Wedding Inquiry Form');
    expect(leadItem.notice_acknowledgement_text_de).toBe(
      'Datenschutzerklärung zur Erläuterung der Art. 6(1)(b) Verarbeitung.',
    );
    expect(leadItem.notice_privacy_policy_url).toBe('https://example.com/privacy-notice-v1');
    expect(leadItem.verification).toBe('verified');
    expect(leadItem.delivery_mode).toBe('hosted');
    expect(leadItem.auto_reply_status).toBe('not_applicable');

    // Audit log in export
    expect(leadItem.audit_actions).toBeDefined();
    expect(leadItem.audit_actions.length).toBeGreaterThanOrEqual(1);
    const firstAudit = leadItem.audit_actions[0];
    expect(firstAudit).toBeDefined();
    if (!firstAudit) {
      throw new Error('Expected firstAudit to be defined');
    }
    expect(firstAudit.action).toBe('lead.received');

    // Audit event recorded in DB
    const [auditRow] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'privacy.export.generated'))
      .orderBy(sql`occurred_at DESC`)
      .limit(1);

    expect(auditRow).toBeDefined();
    if (!auditRow) throw new Error('Expected auditRow to be defined');
    expect(auditRow.targetType).toBe('lead');
    expect(auditRow.targetId).toBe(testLeadId);
    expect(auditRow.metadata).toMatchObject({
      subject_kind: 'lead',
      lead_id: testLeadId,
      format: 'json',
      locale: 'de',
    });
  });

  it('AC-7 (R-A): POST /api/privacy/exports generates HTML export with Art. 15 disclosures and zero scripts', async () => {
    const req = buildRequest({
      body: {
        leadId: testLeadId,
        format: 'html',
        locale: 'en',
      },
    });

    const res = await POST(req, { client: dbClient });
    expect(res.status).toBe(200);

    const html = await res.text();

    // Art. 15 disclosures for leads
    // Purpose: Answering the inquiry
    expect(html).toMatch(/Answering the inquiry/i);
    // Lawful basis: Art. 6(1)(b)
    expect(html).toContain('Art. 6(1)(b)');
    // Configured retention in months: 12 months
    expect(html).toMatch(/12\s+months/i);
    // Recipients: email provider for confirmation email
    expect(html).toMatch(/email provider.*confirmation email/i);
    // Source: inquiry form
    expect(html).toMatch(/inquiry form/i);

    // Security: zero <script> tags or external script/resource loading
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/src\s*=\s*["']https?:\/\//i);
    expect(html).not.toMatch(/href\s*=\s*["']https?:\/\//i);
  });

  it('AC-8: rejects request with both contactId and leadId with 400', async () => {
    const req = buildRequest({
      body: {
        contactId: '018f0000-0000-7000-8000-000000000021',
        leadId: testLeadId,
        format: 'json',
        locale: 'de',
      },
    });

    const res = await POST(req, { client: dbClient });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.error).toBeDefined();
  });

  it('AC-8: rejects request with neither contactId nor leadId with 400', async () => {
    const req = buildRequest({
      body: {
        format: 'json',
        locale: 'de',
      },
    });

    const res = await POST(req, { client: dbClient });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.error).toBeDefined();
  });

  it('AC-8: rejects request without fresh re-authentication with REAUTH_REQUIRED', async () => {
    // Age the session reauth timestamp beyond 5 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    await dbClient
      .update(session)
      .set({ lastReauthenticatedAt: tenMinutesAgo })
      .where(eq(session.token, sessionToken));

    const req = buildRequest({
      body: {
        leadId: testLeadId,
        format: 'json',
        locale: 'de',
      },
    });

    const res = await POST(req, { client: dbClient });
    expect(res.status).toBe(403);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.code).toBe('REAUTH_REQUIRED');

    // Restore fresh reauth
    await dbClient
      .update(session)
      .set({ lastReauthenticatedAt: new Date() })
      .where(eq(session.token, sessionToken));
  });

  it('AC-8: rejects API key auth with 403', async () => {
    const apiKey = await createApiKey({
      userId: ownerUser.id,
      name: 'Export Test Key',
      scopes: ['*'],
      client: dbClient,
    });

    const req = buildRequest({
      body: {
        leadId: testLeadId,
        format: 'json',
        locale: 'de',
      },
      token: null,
      authHeader: `Bearer ${apiKey.apiKey}`,
    });

    const res = await POST(req, { client: dbClient });
    expect(res.status).toBe(403);
  });
});
