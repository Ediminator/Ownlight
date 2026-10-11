import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq, sql } from 'drizzle-orm';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { POST } from '@/app/api/privacy/exports/route';
import { dsarExportSchema } from '@/server/privacy/export/schema';
import { user, session } from '@/server/db/schema/auth';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { clients, clientContacts, clientAddresses } from '@/server/db/schema/clients';
import { tags, clientTags } from '@/server/db/schema/tags';
import { clientNotes, clientTimelineEvents } from '@/server/db/schema/timeline';
import { consentRecords } from '@/server/db/schema/consents';
import { auditEvents } from '@/server/db/schema/audit';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { createApiKey } from '@/server/auth/api-keys';
import { logger } from '@/server/log';
import type { DbClient } from '@/server/db/client';

describe('TASK-0015: DSAR personal data export integration (AC-1 to AC-8)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  // Test entities
  let ownerUser: { id: string; name: string; email: string; role: string };
  let testClient: { id: string; displayName: string };
  let subjectContact: {
    id: string;
    givenName: string;
    familyName: string;
    email: string;
    phone: string;
  };
  let partnerContact: {
    id: string;
    givenName: string;
    familyName: string;
    email: string;
    phone: string;
  };
  let sessionToken: string;

  const appOrigin = 'http://localhost:3000';
  const exportUrl = `${appOrigin}/api/privacy/exports`;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    // 1. Seed studio owner
    ownerUser = {
      id: '018f0000-0000-7000-8000-000000000001',
      name: 'Studio Inhaber',
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

    // 2. Seed active session for owner (fresh reauth by default)
    const sessionRes = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRes.token;

    // 3. Seed studio settings
    await dbClient.insert(studioSettings).values({
      studio_name: 'Lumière Photo Studio',
      currency: 'EUR',
      default_locale: 'de',
      timezone: 'Europe/Berlin',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });

    // 4. Seed client
    testClient = {
      id: '018f0000-0000-7000-8000-000000000010',
      displayName: 'Jane & Paul Wedding',
    };
    await dbClient.insert(clients).values({
      id: testClient.id,
      displayName: testClient.displayName,
      kind: 'person',
      preferredLocale: 'de',
      createdAt: new Date('2026-01-10T10:00:00Z'),
      lastActivityAt: new Date('2026-01-15T15:00:00Z'),
    });

    // 5. Seed Subject Contact (S)
    subjectContact = {
      id: '018f0000-0000-7000-8000-000000000021',
      givenName: 'Jane',
      familyName: 'Doe',
      email: 'jane.doe@example.test',
      phone: '+49 151 12345678',
    };
    await dbClient.insert(clientContacts).values({
      id: subjectContact.id,
      clientId: testClient.id,
      isPrimary: true,
      givenName: subjectContact.givenName,
      familyName: subjectContact.familyName,
      email: subjectContact.email,
      emailNormalized: 'jane.doe@example.test',
      phone: subjectContact.phone,
      createdAt: new Date('2026-01-10T10:00:00Z'),
      updatedAt: new Date('2026-01-12T12:00:00Z'),
    });

    // 6. Seed Partner Contact (P) - personal data must NEVER appear in S's export
    partnerContact = {
      id: '018f0000-0000-7000-8000-000000000022',
      givenName: 'Paul',
      familyName: 'Partner',
      email: 'paul.partner.secret@example.test',
      phone: '+49 151 87654321',
    };
    await dbClient.insert(clientContacts).values({
      id: partnerContact.id,
      clientId: testClient.id,
      isPrimary: false,
      givenName: partnerContact.givenName,
      familyName: partnerContact.familyName,
      email: partnerContact.email,
      emailNormalized: 'paul.partner.secret@example.test',
      phone: partnerContact.phone,
      createdAt: new Date('2026-01-10T10:00:00Z'),
      updatedAt: new Date('2026-01-12T12:00:00Z'),
    });

    // 7. Seed client address
    await dbClient.insert(clientAddresses).values({
      id: '018f0000-0000-7000-8000-000000000031',
      clientId: testClient.id,
      type: 'postal',
      line1: 'Musterstraße 42',
      postalCode: '10115',
      city: 'Berlin',
      countryCode: 'DE',
      createdAt: new Date('2026-01-10T10:00:00Z'),
    });

    // 8. Seed client tag
    const tagId = '018f0000-0000-7000-8000-000000000041';
    await dbClient.insert(tags).values({
      id: tagId,
      name: 'hochzeit-2026',
      nameNormalized: 'hochzeit-2026',
      createdAt: new Date('2026-01-10T10:00:00Z'),
    });
    await dbClient.insert(clientTags).values({
      clientId: testClient.id,
      tagId: tagId,
      createdAt: new Date('2026-01-10T10:00:00Z'),
    });

    // 9. Seed client notes (one clean, one with XSS payload to test AC-2)
    await dbClient.insert(clientNotes).values([
      {
        id: '018f0000-0000-7000-8000-000000000051',
        clientId: testClient.id,
        body: 'Client prefers natural daylight portraiture.',
        createdAt: new Date('2026-01-11T11:00:00Z'),
        updatedAt: new Date('2026-01-11T11:00:00Z'),
      },
      {
        id: '018f0000-0000-7000-8000-000000000052',
        clientId: testClient.id,
        body: '<img src=x onerror=alert(1)>',
        createdAt: new Date('2026-01-12T12:00:00Z'),
        updatedAt: new Date('2026-01-12T12:00:00Z'),
      },
    ]);

    // 10. Seed client timeline event
    await dbClient.insert(clientTimelineEvents).values({
      id: '018f0000-0000-7000-8000-000000000061',
      clientId: testClient.id,
      type: 'client.created',
      actorType: 'owner',
      actorId: ownerUser.id,
      data: { source: 'inquiry_form' },
      occurredAt: new Date('2026-01-10T10:00:00Z'),
      createdAt: new Date('2026-01-10T10:00:00Z'),
    });

    // 11. Seed consent records for Subject S
    await dbClient.insert(consentRecords).values({
      id: '018f0000-0000-7000-8000-000000000071',
      contactId: subjectContact.id,
      purpose: 'marketing',
      status: 'granted',
      effectiveOn: '2026-01-10',
      method: 'paper_form',
      scope: null,
      recordedByActorType: 'owner',
      recordedByActorId: ownerUser.id,
      createdAt: new Date('2026-01-10T10:00:00Z'),
    });

    // 12. Seed audit events targeting client and subject S
    await dbClient.insert(auditEvents).values([
      {
        id: '018f0000-0000-7000-8000-000000000081',
        action: 'client.created',
        actorType: 'owner',
        actorId: ownerUser.id,
        targetType: 'client',
        targetId: testClient.id,
        occurredAt: new Date('2026-01-10T10:00:00Z'),
        outcome: 'success',
        metadata: {},
      },
      {
        id: '018f0000-0000-7000-8000-000000000082',
        action: 'client_contact.created',
        actorType: 'owner',
        actorId: ownerUser.id,
        targetType: 'contact',
        targetId: subjectContact.id,
        occurredAt: new Date('2026-01-10T10:00:00Z'),
        outcome: 'success',
        metadata: {},
      },
    ]);
  });

  afterEach(async () => {
    await testDb.destroy();
    vi.restoreAllMocks();
  });

  /**
   * Helper to construct authenticated requests
   */
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

    return new NextRequest(exportUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  it('AC-1: generates valid ownlight.dsar.v1 JSON export with S personal data and strictly excludes partner P and normalized email', async () => {
    const req = buildRequest({
      body: {
        contactId: subjectContact.id,
        format: 'json',
        locale: 'en',
      },
    });

    const res = await POST(req, { client: dbClient });
    expect(res.status).toBe(200);

    const jsonText = await res.text();
    const raw = JSON.parse(jsonText) as unknown;

    // Schema validation
    const parsed = dsarExportSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error(`Invalid export schema: ${JSON.stringify(parsed.error.issues)}`);
    }

    const data = parsed.data;

    expect(data.schema).toBe('ownlight.dsar.v1');
    expect(data.studio.name).toBe('Lumière Photo Studio');

    // Subject data
    expect(data.subject.id).toBe(subjectContact.id);
    expect(data.subject.display_name).toBe('Jane Doe');
    expect(data.subject.first_name).toBe('Jane');
    expect(data.subject.last_name).toBe('Doe');
    expect(data.subject.email).toBe('jane.doe@example.test');
    expect(data.subject.phone).toBe('+49 151 12345678');
    expect(data.subject.role).toBe('primary');

    // Domain categories
    expect(data.categories.client).toHaveLength(1);
    expect(data.categories.client?.[0]?.display_name).toBe('Jane & Paul Wedding');

    expect(data.categories.addresses).toHaveLength(1);
    expect(data.categories.addresses?.[0]?.line1).toBe('Musterstraße 42');

    expect(data.categories.tags).toHaveLength(1);
    expect(data.categories.tags?.[0]?.name).toBe('hochzeit-2026');

    expect(data.categories.notes).toHaveLength(2);
    expect(data.categories.timeline).toHaveLength(1);
    expect(data.categories.consents).toHaveLength(1);
    expect(data.categories.consents?.[0]?.purpose).toBe('marketing');
    expect(data.categories.audit).toHaveLength(2);

    // CRITICAL PRIVACY CHECKS: Partner P's email and phone must NOT appear in the payload
    expect(jsonText).not.toContain(partnerContact.email);
    expect(jsonText).not.toContain(partnerContact.phone);

    // email_normalized must not be exposed
    expect(jsonText).not.toContain('email_normalized');
    expect(jsonText).not.toContain('emailNormalized');
  });

  it('AC-2: generates German HTML export with Art. 15(1) disclosures, zero scripts, zero external URLs, and escaped XSS', async () => {
    const req = buildRequest({
      body: {
        contactId: subjectContact.id,
        format: 'html',
        locale: 'de',
      },
    });

    const res = await POST(req, { client: dbClient });
    expect(res.status).toBe(200);

    const html = await res.text();

    // 1. Language & title
    expect(html).toContain('<html lang="de">');
    expect(html).toContain('Datenauskunft (Art. 15 DSGVO / CCPA)');
    expect(html).toContain('Lumière Photo Studio');
    expect(html).toContain('Jane Doe');

    // 2. Art. 15(1) Disclosures per category
    expect(html).toContain('Verarbeitungszweck');
    expect(html).toContain('Rechtsgrundlage');
    expect(html).toContain('Speicherdauer');

    // 3. Art. 15(1) General disclosures
    expect(html).toContain('Empfänger');
    expect(html).toContain('Datenherkunft');
    expect(html).toContain('Ihre Rechte als betroffene Person');
    expect(html).toContain('Recht auf Berichtigung (Art. 16 DSGVO)');
    expect(html).toContain('Recht auf Löschung / „Recht auf Vergessenwerden“ (Art. 17 DSGVO)');
    expect(html).toContain('Recht auf Datenübertragbarkeit (Art. 20 DSGVO)');
    expect(html).toContain('Widerspruchsrecht (Art. 21 DSGVO)');
    expect(html).toContain('Beschwerderecht bei einer Aufsichtsbehörde (Art. 77 DSGVO)');

    // 4. Zero scripts
    expect(html).not.toMatch(/<script\b/i);

    // 5. Zero inline event handlers on tags
    expect(html).not.toMatch(/<[a-zA-Z0-9_-]+[^>]*\s+on[a-zA-Z]+\s*=/i);

    // 6. Zero external resource URLs
    expect(html).not.toMatch(/(src|href|url)\s*=\s*['"]?https?:\/\//i);

    // 7. Malicious note body <img src=x onerror=alert(1)> is safely escaped
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');

    // 8. Third-party partner data isolated
    expect(html).not.toContain(partnerContact.email);
    expect(html).not.toContain(partnerContact.phone);
  });

  it('AC-3: verifies attachment filename with UUID and date, no-store cache control, and nosniff headers', async () => {
    const todayStr = new Date().toISOString().slice(0, 10);

    // Check JSON export headers
    const jsonReq = buildRequest({
      body: { contactId: subjectContact.id, format: 'json', locale: 'en' },
    });
    const jsonRes = await POST(jsonReq, { client: dbClient });
    expect(jsonRes.status).toBe(200);

    const jsonDisp = jsonRes.headers.get('content-disposition');
    expect(jsonDisp).toBe(
      `attachment; filename="ownlight-data-export-${subjectContact.id}-${todayStr}.json"`,
    );
    expect(jsonRes.headers.get('cache-control')).toBe('no-store');
    expect(jsonRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(jsonRes.headers.get('content-type')).toBe('application/json; charset=utf-8');

    // Check HTML export headers
    const htmlReq = buildRequest({
      body: { contactId: subjectContact.id, format: 'html', locale: 'de' },
    });
    const htmlRes = await POST(htmlReq, { client: dbClient });
    expect(htmlRes.status).toBe(200);

    const htmlDisp = htmlRes.headers.get('content-disposition');
    expect(htmlDisp).toBe(
      `attachment; filename="ownlight-data-export-${subjectContact.id}-${todayStr}.html"`,
    );
    expect(htmlRes.headers.get('cache-control')).toBe('no-store');
    expect(htmlRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(htmlRes.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('AC-4: denies unauthenticated, API keys with *, stale session, cross-origin, and invalid requests without leaking PII', async () => {
    // 1. Unauthenticated request (no session cookie) -> 401
    const unauthReq = buildRequest({
      token: null,
      body: { contactId: subjectContact.id, format: 'json', locale: 'en' },
    });
    const unauthRes = await POST(unauthReq, { client: dbClient });
    expect(unauthRes.status).toBe(401);
    const unauthBody = await unauthRes.text();
    expect(unauthBody).not.toContain(subjectContact.email);

    // 2. API key with scope * -> 403 (ADR-0006)
    const apiKey = await createApiKey({
      userId: ownerUser.id,
      name: 'Full Access Test Key',
      scopes: ['*'],
      client: dbClient,
    });
    const apiKeyReq = buildRequest({
      token: null,
      authHeader: `Bearer ${apiKey.apiKey}`,
      body: { contactId: subjectContact.id, format: 'json', locale: 'en' },
    });
    const apiKeyRes = await POST(apiKeyReq, { client: dbClient });
    expect(apiKeyRes.status).toBe(403);
    const apiKeyBody = (await apiKeyRes.json()) as { message: string };
    expect(apiKeyBody.message).toContain('API keys are not permitted');

    // 3. Stale owner session (> 5 minutes since last re-authentication) -> 403 REAUTH_REQUIRED
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    await dbClient
      .update(session)
      .set({ lastReauthenticatedAt: tenMinutesAgo })
      .where(eq(session.token, sessionToken));

    const staleReq = buildRequest({
      body: { contactId: subjectContact.id, format: 'json', locale: 'en' },
    });
    const staleRes = await POST(staleReq, { client: dbClient });
    expect(staleRes.status).toBe(403);
    const staleBody = (await staleRes.json()) as { code: string };
    expect(staleBody.code).toBe('REAUTH_REQUIRED');

    // Restore fresh reauth
    await dbClient
      .update(session)
      .set({ lastReauthenticatedAt: new Date() })
      .where(eq(session.token, sessionToken));

    // 4. Cross-origin request -> 403
    const crossOriginReq = buildRequest({
      origin: 'https://evil-cross-origin.com',
      body: { contactId: subjectContact.id, format: 'json', locale: 'en' },
    });
    const crossOriginRes = await POST(crossOriginReq, { client: dbClient });
    expect(crossOriginRes.status).toBe(403);
    const crossOriginBody = (await crossOriginRes.json()) as { message: string };
    expect(crossOriginBody.message).toContain('Forbidden origin');

    // 5. Malformed contactId (not a valid UUID) -> 400
    const malformedReq = buildRequest({
      body: { contactId: 'not-a-uuid', format: 'json', locale: 'en' },
    });
    const malformedRes = await POST(malformedReq, { client: dbClient });
    expect(malformedRes.status).toBe(400);

    // 6. Unknown contactId (valid UUID, non-existent) -> 404
    const nonExistentId = '018f0000-0000-7000-8000-999999999999';
    const unknownReq = buildRequest({
      body: { contactId: nonExistentId, format: 'json', locale: 'en' },
    });
    const unknownRes = await POST(unknownReq, { client: dbClient });
    expect(unknownRes.status).toBe(404);

    // 7. Unknown body property -> 400 (.strict() schema enforcement)
    const extraPropertyReq = buildRequest({
      body: {
        contactId: subjectContact.id,
        format: 'json',
        locale: 'en',
        unexpectedField: 'malicious',
      },
    });
    const extraPropertyRes = await POST(extraPropertyReq, { client: dbClient });
    expect(extraPropertyRes.status).toBe(400);
  });

  it('AC-6: creates exactly one audit event with allowlisted metadata, adds no rows to other tables, and writes no files', async () => {
    // Record baseline row counts
    const getRowCounts = async () => {
      const [clientRows] = await dbClient
        .select({ count: sql<number>`count(*)::int` })
        .from(clients);
      const [contactRows] = await dbClient
        .select({ count: sql<number>`count(*)::int` })
        .from(clientContacts);
      const [noteRows] = await dbClient
        .select({ count: sql<number>`count(*)::int` })
        .from(clientNotes);
      const [timelineRows] = await dbClient
        .select({ count: sql<number>`count(*)::int` })
        .from(clientTimelineEvents);
      const [auditRows] = await dbClient
        .select({ count: sql<number>`count(*)::int` })
        .from(auditEvents);
      return {
        clients: clientRows?.count ?? 0,
        contacts: contactRows?.count ?? 0,
        notes: noteRows?.count ?? 0,
        timeline: timelineRows?.count ?? 0,
        audit: auditRows?.count ?? 0,
      };
    };

    const before = await getRowCounts();

    const req = buildRequest({
      body: { contactId: subjectContact.id, format: 'json', locale: 'en' },
    });
    const res = await POST(req, { client: dbClient });
    expect(res.status).toBe(200);

    const after = await getRowCounts();

    // Exactly one audit row added
    expect(after.audit).toBe(before.audit + 1);

    // No other table gained rows
    expect(after.clients).toBe(before.clients);
    expect(after.contacts).toBe(before.contacts);
    expect(after.notes).toBe(before.notes);
    expect(after.timeline).toBe(before.timeline);

    // Inspect the new audit row
    const [latestAudit] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'privacy.export.generated'))
      .orderBy(sql`occurred_at desc`)
      .limit(1);

    expect(latestAudit).toBeDefined();
    if (!latestAudit) {
      throw new Error('Expected audit event to exist');
    }

    expect(latestAudit.action).toBe('privacy.export.generated');
    expect(latestAudit.targetType).toBe('contact');
    expect(latestAudit.targetId).toBe(subjectContact.id);
    expect(latestAudit.actorType).toBe('owner');
    expect(latestAudit.actorId).toBe(ownerUser.id);
    expect(latestAudit.outcome).toBe('success');

    // Allowlisted metadata only: contact_id, format, locale, category_count
    const meta = latestAudit.metadata ?? {};
    expect(Object.keys(meta).sort()).toEqual(
      ['category_count', 'contact_id', 'format', 'locale'].sort(),
    );
    expect(meta.contact_id).toBe(subjectContact.id);
    expect(meta.format).toBe('json');
    expect(meta.locale).toBe('en');
    expect(typeof meta.category_count).toBe('number');
  });

  it('AC-7: captured logs contain zero subject name, email, phone, address, notes, or consent scope', async () => {
    const loggedMessages: string[] = [];
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation((...args) => {
      loggedMessages.push(JSON.stringify(args));
    });
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation((...args) => {
      loggedMessages.push(JSON.stringify(args));
    });
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation((...args) => {
      loggedMessages.push(JSON.stringify(args));
    });

    // Run JSON export
    const jsonReq = buildRequest({
      body: { contactId: subjectContact.id, format: 'json', locale: 'en' },
    });
    await POST(jsonReq, { client: dbClient });

    // Run HTML export
    const htmlReq = buildRequest({
      body: { contactId: subjectContact.id, format: 'html', locale: 'de' },
    });
    await POST(htmlReq, { client: dbClient });

    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();

    const fullLogDump = loggedMessages.join('\n');

    // Strict assertions: No PII anywhere in application logs
    expect(fullLogDump).not.toContain(subjectContact.givenName);
    expect(fullLogDump).not.toContain(subjectContact.familyName);
    expect(fullLogDump).not.toContain(subjectContact.email);
    expect(fullLogDump).not.toContain(subjectContact.phone);
    expect(fullLogDump).not.toContain('Musterstraße 42');
    expect(fullLogDump).not.toContain('natural daylight portraiture');
  });

  it('AC-8: completes export in under 2 seconds even with 500 timeline events and 50 notes', async () => {
    // Bulk insert 500 timeline events
    const timelineRows = Array.from({ length: 500 }, (_, i) => ({
      id: `018f0000-0000-7000-8000-${String(1000 + i).padStart(12, '0')}`,
      clientId: testClient.id,
      type: 'client.note_added',
      actorType: 'owner' as const,
      actorId: ownerUser.id,
      data: { noteIndex: i },
      occurredAt: new Date(Date.now() - i * 60000),
      createdAt: new Date(Date.now() - i * 60000),
    }));
    await dbClient.insert(clientTimelineEvents).values(timelineRows);

    // Bulk insert 50 notes
    const noteRows = Array.from({ length: 50 }, (_, i) => ({
      id: `018f0000-0000-7000-8000-${String(2000 + i).padStart(12, '0')}`,
      clientId: testClient.id,
      body: `Detailed operational note number ${String(i)} for client record.`,
      createdAt: new Date(Date.now() - i * 120000),
      updatedAt: new Date(Date.now() - i * 120000),
    }));
    await dbClient.insert(clientNotes).values(noteRows);

    // Test JSON export duration
    const jsonReq = buildRequest({
      body: { contactId: subjectContact.id, format: 'json', locale: 'en' },
    });
    const jsonStart = performance.now();
    const jsonRes = await POST(jsonReq, { client: dbClient });
    const jsonDuration = performance.now() - jsonStart;

    expect(jsonRes.status).toBe(200);
    expect(jsonDuration).toBeLessThan(2000);

    // Test HTML export duration
    const htmlReq = buildRequest({
      body: { contactId: subjectContact.id, format: 'html', locale: 'de' },
    });
    const htmlStart = performance.now();
    const htmlRes = await POST(htmlReq, { client: dbClient });
    const htmlDuration = performance.now() - htmlStart;

    expect(htmlRes.status).toBe(200);
    expect(htmlDuration).toBeLessThan(2000);
  });
});
