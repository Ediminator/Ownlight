import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mockCookiesStore = new Map<string, string>();
const mockHeadersStore = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const val = mockCookiesStore.get(name);
        return val ? { name, value: val } : undefined;
      },
      set: (name: string, value: string) => {
        mockCookiesStore.set(name, value);
      },
      delete: (name: string) => {
        mockCookiesStore.delete(name);
      },
    }),
  headers: () =>
    Promise.resolve({
      get: (name: string) => mockHeadersStore.get(name.toLowerCase()) ?? null,
    }),
}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import {
  changeLeadStatusAction,
  deleteLeadsAction,
  exportLeadDsarAction,
  getLeadCountsAction,
} from '@/server/leads/actions';
import { createLead, getLead } from '@/server/leads/service';
import { user, session, account } from '@/server/db/schema/auth';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { createApiKey } from '@/server/auth/api-keys';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { leads } from '@/server/db/schema/leads';
import { clients } from '@/server/db/schema/clients';
import { auditEvents } from '@/server/db/schema/audit';
import { eq, and } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { reauthenticateAction } from '@/server/auth/mfa-actions';
import { hashPasswordArgon2id } from '@/server/auth/passwords/policy';

describe('TASK-0031: Leads Inbox Actions Integration Tests (AC-3, AC-4, AC-5, AC-6, AC-8, AC-10)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;
  let formId: string;
  let noticeVersionId: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();

    const passwordHash = await hashPasswordArgon2id('ValidOwnerPassword123!');

    // 1. Seed owner user
    ownerUser = {
      id: '018f0000-0000-7000-8000-000000000001',
      name: 'Studio Owner',
      email: 'owner@example.org',
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

    await dbClient.insert(account).values({
      accountId: ownerUser.id,
      providerId: 'credential',
      userId: ownerUser.id,
      password: passwordHash,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // 2. Active owner web session
    const sessionRecord = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRecord.token;
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);

    // 3. Create test form & notice version
    formId = '018f0000-0000-7000-8000-000000000002';
    noticeVersionId = '018f0000-0000-7000-8000-000000000003';

    await dbClient.insert(inquiryForms).values({
      id: formId,
      slug: 'test-form',
      name: 'General Inquiries',
      status: 'published',
      defaultLocale: 'en',
      fields: [
        { key: 'given_name', enabled: true, required: true, order: 0 },
        { key: 'email', enabled: true, required: true, order: 1 },
      ],
      eventTypes: [
        { key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' },
        { key: 'portrait', label_en: 'Portrait', label_de: 'Porträt' },
      ],
      currentNoticeVersionId: null,
      autoReplyEnabled: true,
      acceptUnverified: false,
    });

    await dbClient.insert(inquiryFormNoticeVersions).values({
      id: noticeVersionId,
      formId,
      version: 1,
      acknowledgementTextEn: 'I acknowledge the studio privacy notice.',
      acknowledgementTextDe: 'Ich nehme die Datenschutzerklärung zur Kenntnis.',
      privacyPolicyUrl: 'https://example.org/privacy',
      createdByActorId: ownerUser.id,
    });

    await dbClient
      .update(inquiryForms)
      .set({ currentNoticeVersionId: noticeVersionId })
      .where(eq(inquiryForms.id, formId));
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-3: changeLeadStatusAction transitions status, updates lastActivityAt, and emits lead.status_changed audit event', async () => {
    const created = await createLead(
      {
        formId,
        noticeVersionId,
        locale: 'en',
        givenName: 'Alice',
        familyName: 'Smith',
        email: 'alice@example.org',
        eventTypeKey: 'wedding',
      },
      undefined,
      dbClient,
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const initialActivity = created.data.lastActivityAt;
    await new Promise((r) => setTimeout(r, 20));

    // Call changeLeadStatusAction to 'contacted'
    const res = await changeLeadStatusAction(
      {
        leadId: created.data.id,
        targetStatus: 'contacted',
      },
      dbClient,
    );

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.status).toBe('contacted');
    expect(new Date(res.data.lastActivityAt).getTime()).toBeGreaterThan(
      new Date(initialActivity).getTime(),
    );

    // Verify DB update
    const updatedLead = await getLead(created.data.id, dbClient);
    expect(updatedLead?.status).toBe('contacted');

    // Verify audit event emission (lead.status_changed)
    const audits = await dbClient
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, created.data.id),
          eq(auditEvents.action, 'lead.status_changed'),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorType).toBe('owner');
    expect(audits[0]?.actorId).toBe(ownerUser.id);
    expect(audits[0]?.metadata).toEqual({ from: 'new', to: 'contacted' });
  });

  it('AC-4: deleteLeadsAction bulk deletes selected leads and emits lead.deleted audit event with count and bulk flag', async () => {
    const lead1 = await createLead(
      {
        formId,
        noticeVersionId,
        locale: 'en',
        givenName: 'Bob',
        email: 'bob@example.org',
      },
      undefined,
      dbClient,
    );
    const lead2 = await createLead(
      {
        formId,
        noticeVersionId,
        locale: 'en',
        givenName: 'Charlie',
        email: 'charlie@example.org',
      },
      undefined,
      dbClient,
    );
    expect(lead1.success && lead2.success).toBe(true);
    if (!lead1.success || !lead2.success) return;

    const deleteRes = await deleteLeadsAction(
      { leadIds: [lead1.data.id, lead2.data.id] },
      dbClient,
    );
    expect(deleteRes.success).toBe(true);
    if (!deleteRes.success) return;
    expect(deleteRes.count).toBe(2);

    // Assert rows removed from DB
    const check1 = await getLead(lead1.data.id, dbClient);
    const check2 = await getLead(lead2.data.id, dbClient);
    expect(check1).toBeNull();
    expect(check2).toBeNull();

    // Verify audit event
    const audits = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'lead.deleted'));
    expect(audits.length).toBeGreaterThanOrEqual(1);
    const lastAudit = audits[audits.length - 1];
    expect(lastAudit?.metadata).toEqual({ count: 2, bulk: true });
  });

  it('AC-5: deleteLeadsAction with deleteAllSpam deletes all spam leads and emits lead.deleted', async () => {
    const leadSpam1 = await createLead(
      {
        formId,
        noticeVersionId,
        locale: 'en',
        givenName: 'Spam1',
        email: 'spam1@example.org',
      },
      undefined,
      dbClient,
    );
    const leadSpam2 = await createLead(
      {
        formId,
        noticeVersionId,
        locale: 'en',
        givenName: 'Spam2',
        email: 'spam2@example.org',
      },
      undefined,
      dbClient,
    );
    const leadGood = await createLead(
      {
        formId,
        noticeVersionId,
        locale: 'en',
        givenName: 'Good',
        email: 'good@example.org',
      },
      undefined,
      dbClient,
    );
    expect(leadSpam1.success && leadSpam2.success && leadGood.success).toBe(true);
    if (!leadSpam1.success || !leadSpam2.success || !leadGood.success) return;

    // Mark 2 leads as spam in DB
    await dbClient.update(leads).set({ status: 'spam' }).where(eq(leads.id, leadSpam1.data.id));
    await dbClient.update(leads).set({ status: 'spam' }).where(eq(leads.id, leadSpam2.data.id));

    // Delete all spam
    const deleteRes = await deleteLeadsAction({ deleteAllSpam: true }, dbClient);
    expect(deleteRes.success).toBe(true);
    if (!deleteRes.success) return;
    expect(deleteRes.count).toBe(2);

    // Verify spam leads are gone and good lead remains
    expect(await getLead(leadSpam1.data.id, dbClient)).toBeNull();
    expect(await getLead(leadSpam2.data.id, dbClient)).toBeNull();
    expect(await getLead(leadGood.data.id, dbClient)).not.toBeNull();

    // Verify audit event
    const audits = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'lead.deleted'));
    const lastAudit = audits[audits.length - 1];
    expect(lastAudit?.metadata).toEqual({ count: 2, bulk: true });
  });

  it('AC-6: deleteLeadsAction rejects deletion of converted leads with CONVERTED_LEAD and deletes nothing', async () => {
    // Create client
    const clientId = '018f0000-0000-7000-8000-000000000010';
    await dbClient.insert(clients).values({
      id: clientId,
      kind: 'person',
      displayName: 'Converted Client',
      preferredLocale: 'en',
    });

    const leadConverted = await createLead(
      {
        formId,
        noticeVersionId,
        locale: 'en',
        givenName: 'Converted',
        email: 'converted@example.org',
      },
      undefined,
      dbClient,
    );
    const leadNormal = await createLead(
      {
        formId,
        noticeVersionId,
        locale: 'en',
        givenName: 'Normal',
        email: 'normal@example.org',
      },
      undefined,
      dbClient,
    );
    expect(leadConverted.success && leadNormal.success).toBe(true);
    if (!leadConverted.success || !leadNormal.success) return;

    // Convert lead in DB
    await dbClient
      .update(leads)
      .set({ status: 'converted', clientId })
      .where(eq(leads.id, leadConverted.data.id));

    // Attempt to delete both
    const res = await deleteLeadsAction(
      { leadIds: [leadConverted.data.id, leadNormal.data.id] },
      dbClient,
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.code).toBe('CONVERTED_LEAD');
      expect(res.error).toBe('CONVERTED_LEAD');
    }

    // Assert neither was deleted
    expect(await getLead(leadConverted.data.id, dbClient)).not.toBeNull();
    expect(await getLead(leadNormal.data.id, dbClient)).not.toBeNull();
  });

  it('AC-8: exportLeadDsarAction requires step-up reauthentication within 5 minutes and generates DSAR bundle', async () => {
    const lead = await createLead(
      {
        formId,
        noticeVersionId,
        locale: 'en',
        givenName: 'Dana',
        familyName: 'Scully',
        email: 'scully@example.org',
        phone: '+49 30 1111 2222',
        eventTypeKey: 'portrait',
        message: 'Looking for a professional portrait shoot.',
      },
      undefined,
      dbClient,
    );
    expect(lead.success).toBe(true);
    if (!lead.success) return;

    // 1. Age session reauth timestamp to > 5 minutes ago (e.g. 10 minutes ago)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    await dbClient
      .update(session)
      .set({ lastReauthenticatedAt: tenMinutesAgo })
      .where(eq(session.token, sessionToken));

    // 2. Call exportLeadDsarAction -> should reject with REAUTH_REQUIRED
    const staleRes = await exportLeadDsarAction({ leadId: lead.data.id }, dbClient);
    expect(staleRes.success).toBe(false);
    if (!staleRes.success) {
      expect(staleRes.code).toBe('REAUTH_REQUIRED');
    }

    // 3. Perform reauthentication step-up
    const reauthRes = await reauthenticateAction({ password: 'ValidOwnerPassword123!' }, dbClient);
    expect(reauthRes.success).toBe(true);

    // 4. Call exportLeadDsarAction again -> should succeed
    const freshRes = await exportLeadDsarAction({ leadId: lead.data.id }, dbClient);
    expect(freshRes.success).toBe(true);
    if (!freshRes.success) return;

    expect(freshRes.contentType).toContain('application/json');
    expect(freshRes.content).toContain('scully@example.org');
    // Verify exact notice text acknowledged is included in export (AC-8)
    expect(freshRes.content).toContain('I acknowledge the studio privacy notice.');

    // Verify privacy.export.generated audit event
    const audits = await dbClient
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, lead.data.id),
          eq(auditEvents.action, 'privacy.export.generated'),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toMatchObject({
      subject_kind: 'lead',
      lead_id: lead.data.id,
      format: 'json',
    });
  });

  it('AC-10: changeLeadStatusAction and deleteLeadsAction deny access for unauthenticated and API-key requests with UNAUTHORIZED', async () => {
    const lead = await createLead(
      {
        formId,
        noticeVersionId,
        locale: 'en',
        givenName: 'Test',
        email: 'test@example.org',
      },
      undefined,
      dbClient,
    );
    expect(lead.success).toBe(true);
    if (!lead.success) return;

    // 1. Unauthenticated (no session)
    mockCookiesStore.clear();

    const unauthStatus = await changeLeadStatusAction(
      { leadId: lead.data.id, targetStatus: 'contacted' },
      dbClient,
    );
    expect(unauthStatus.success).toBe(false);
    if (!unauthStatus.success) {
      expect(unauthStatus.code).toBe('UNAUTHORIZED');
    }

    const unauthDelete = await deleteLeadsAction({ leadIds: [lead.data.id] }, dbClient);
    expect(unauthDelete.success).toBe(false);
    if (!unauthDelete.success) {
      expect(unauthDelete.code).toBe('UNAUTHORIZED');
    }

    // 2. API key bearer token
    const apiKeyResult = await createApiKey({
      userId: ownerUser.id,
      name: 'Admin API Key',
      scopes: ['*'],
      client: dbClient,
    });
    mockHeadersStore.set('authorization', `Bearer ${apiKeyResult.apiKey}`);

    const apiKeyStatus = await changeLeadStatusAction(
      { leadId: lead.data.id, targetStatus: 'contacted' },
      dbClient,
    );
    expect(apiKeyStatus.success).toBe(false);
    if (!apiKeyStatus.success) {
      expect(apiKeyStatus.code).toBe('UNAUTHORIZED');
    }

    const apiKeyDelete = await deleteLeadsAction({ leadIds: [lead.data.id] }, dbClient);
    expect(apiKeyDelete.success).toBe(false);
    if (!apiKeyDelete.success) {
      expect(apiKeyDelete.code).toBe('UNAUTHORIZED');
    }
  });

  it('getLeadCountsAction returns count per status and all', async () => {
    await createLead(
      {
        formId,
        noticeVersionId,
        locale: 'en',
        givenName: 'Lead1',
        email: 'lead1@example.org',
      },
      undefined,
      dbClient,
    );
    await createLead(
      {
        formId,
        noticeVersionId,
        locale: 'en',
        givenName: 'Lead2',
        email: 'lead2@example.org',
      },
      undefined,
      dbClient,
    );

    const countsRes = await getLeadCountsAction(dbClient);
    expect(countsRes.success).toBe(true);
    if (!countsRes.success) return;
    expect(countsRes.data.all).toBe(2);
    expect(countsRes.data.new).toBe(2);
    expect(countsRes.data.contacted).toBe(0);
  });

  it('exportLeadDsarAction returns NOT_FOUND when lead does not exist', async () => {
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
    await reauthenticateAction({ password: 'CorrectPassword123!' });

    const nonExistentId = '018f0000-0000-7000-8000-999999999999';
    const res = await exportLeadDsarAction({ leadId: nonExistentId }, dbClient);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.code).toBe('NOT_FOUND');
    }
  });
});
