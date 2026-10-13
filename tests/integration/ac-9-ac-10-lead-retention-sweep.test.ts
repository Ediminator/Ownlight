import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { executeRetentionSweep } from '@/server/retention/runner';
import { resetPolicies } from '@/server/retention/policy';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { clients } from '@/server/db/schema/clients';
import { leads } from '@/server/db/schema/leads';
import { auditEvents } from '@/server/db/schema/audit';
import type { DbClient } from '@/server/db/client';

describe('TASK-0026: Lead Retention Sweep (AC-9, AC-10)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  let formId: string;
  let noticeVersionId: string;
  let testClientId: string;

  let lead13mNewId: string;
  let lead11mContactedId: string;
  let lead31dSpamId: string;
  let lead29dSpamId: string;
  let lead5yConvertedId: string;

  const now = new Date('2026-10-15T12:00:00Z');

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    process.env.LEAD_RETENTION_MONTHS = '12';
    resetPolicies();

    // 1. Seed inquiry form and notice version
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
      createdAt: new Date('2020-01-01T00:00:00Z'),
      updatedAt: new Date('2020-01-01T00:00:00Z'),
    });

    await dbClient.insert(inquiryFormNoticeVersions).values({
      id: noticeVersionId,
      formId: formId,
      version: 1,
      acknowledgementTextEn: 'Privacy notice v1',
      acknowledgementTextDe: 'Datenschutzerklärung v1',
      privacyPolicyUrl: 'https://example.com/privacy',
      createdByActorId: '018f0000-0000-7000-8000-000000000001',
      createdAt: new Date('2020-01-01T00:00:00Z'),
    });

    await dbClient
      .update(inquiryForms)
      .set({ currentNoticeVersionId: noticeVersionId })
      .where(eq(inquiryForms.id, formId));

    // 2. Seed client for converted lead
    testClientId = '018f0000-0000-7000-8000-000000000050';
    await dbClient.insert(clients).values({
      id: testClientId,
      displayName: 'Converted Client',
      kind: 'person',
      preferredLocale: 'de',
      createdAt: new Date('2021-10-15T12:00:00Z'),
      lastActivityAt: new Date('2026-10-01T12:00:00Z'),
    });

    // Helper dates relative to now
    const d13MonthsAgo = new Date(now.getTime());
    d13MonthsAgo.setMonth(d13MonthsAgo.getMonth() - 13);

    const d11MonthsAgo = new Date(now.getTime());
    d11MonthsAgo.setMonth(d11MonthsAgo.getMonth() - 11);

    const d31DaysAgo = new Date(now.getTime());
    d31DaysAgo.setDate(d31DaysAgo.getDate() - 31);

    const d29DaysAgo = new Date(now.getTime());
    d29DaysAgo.setDate(d29DaysAgo.getDate() - 29);

    const d5YearsAgo = new Date(now.getTime());
    d5YearsAgo.setFullYear(d5YearsAgo.getFullYear() - 5);

    // 3. Seed 5 leads:
    // Lead 1: 13 months ago (new) -> eligible for unconverted-leads retention
    lead13mNewId = '018f0000-0000-7000-8000-000000000101';
    await dbClient.insert(leads).values({
      id: lead13mNewId,
      status: 'new',
      formId: formId,
      noticeVersionId: noticeVersionId,
      noticeAcknowledgedAt: d13MonthsAgo,
      locale: 'de',
      givenName: 'Old',
      familyName: 'Lead',
      email: 'old.lead@example.com',
      emailNormalized: 'old.lead@example.com',
      message: 'Old lead message',
      verification: 'verified',
      deliveryMode: 'hosted',
      autoReplyStatus: 'not_applicable',
      receivedAt: d13MonthsAgo,
      lastActivityAt: d13MonthsAgo,
      createdAt: d13MonthsAgo,
      updatedAt: d13MonthsAgo,
    });

    // Lead 2: 11 months ago (contacted) -> retains (under 12m)
    lead11mContactedId = '018f0000-0000-7000-8000-000000000102';
    await dbClient.insert(leads).values({
      id: lead11mContactedId,
      status: 'contacted',
      formId: formId,
      noticeVersionId: noticeVersionId,
      noticeAcknowledgedAt: d11MonthsAgo,
      locale: 'de',
      givenName: 'Recent',
      familyName: 'Contacted',
      email: 'recent.contacted@example.com',
      emailNormalized: 'recent.contacted@example.com',
      message: 'Recent contacted lead message',
      verification: 'verified',
      deliveryMode: 'hosted',
      autoReplyStatus: 'not_applicable',
      receivedAt: d11MonthsAgo,
      lastActivityAt: d11MonthsAgo,
      createdAt: d11MonthsAgo,
      updatedAt: d11MonthsAgo,
    });

    // Lead 3: 31 days ago (spam) -> eligible for spam-leads retention (over 30d)
    lead31dSpamId = '018f0000-0000-7000-8000-000000000103';
    await dbClient.insert(leads).values({
      id: lead31dSpamId,
      status: 'spam',
      formId: formId,
      noticeVersionId: noticeVersionId,
      noticeAcknowledgedAt: d31DaysAgo,
      locale: 'de',
      givenName: 'Old',
      familyName: 'Spam',
      email: 'old.spam@example.com',
      emailNormalized: 'old.spam@example.com',
      message: 'Spam message',
      verification: 'unverified',
      deliveryMode: 'hosted',
      autoReplyStatus: 'not_applicable',
      receivedAt: d31DaysAgo,
      lastActivityAt: d31DaysAgo,
      createdAt: d31DaysAgo,
      updatedAt: d31DaysAgo,
    });

    // Lead 4: 29 days ago (spam) -> retains (under 30d)
    lead29dSpamId = '018f0000-0000-7000-8000-000000000104';
    await dbClient.insert(leads).values({
      id: lead29dSpamId,
      status: 'spam',
      formId: formId,
      noticeVersionId: noticeVersionId,
      noticeAcknowledgedAt: d29DaysAgo,
      locale: 'de',
      givenName: 'Recent',
      familyName: 'Spam',
      email: 'recent.spam@example.com',
      emailNormalized: 'recent.spam@example.com',
      message: 'Recent spam message',
      verification: 'unverified',
      deliveryMode: 'hosted',
      autoReplyStatus: 'not_applicable',
      receivedAt: d29DaysAgo,
      lastActivityAt: d29DaysAgo,
      createdAt: d29DaysAgo,
      updatedAt: d29DaysAgo,
    });

    // Lead 5: 5 years old (converted) -> retains (converted leads belong to client lifecycle)
    lead5yConvertedId = '018f0000-0000-7000-8000-000000000105';
    await dbClient.insert(leads).values({
      id: lead5yConvertedId,
      clientId: testClientId,
      status: 'converted',
      formId: formId,
      noticeVersionId: noticeVersionId,
      noticeAcknowledgedAt: d5YearsAgo,
      locale: 'de',
      givenName: 'Converted',
      familyName: 'Lead',
      email: 'converted.lead@example.com',
      emailNormalized: 'converted.lead@example.com',
      message: 'Converted lead message',
      verification: 'verified',
      deliveryMode: 'hosted',
      autoReplyStatus: 'not_applicable',
      receivedAt: d5YearsAgo,
      lastActivityAt: d5YearsAgo,
      convertedAt: d5YearsAgo,
      createdAt: d5YearsAgo,
      updatedAt: d5YearsAgo,
    });
  });

  afterEach(async () => {
    delete process.env.LEAD_RETENTION_MONTHS;
    resetPolicies();
    await testDb.destroy();
    vi.restoreAllMocks();
  });

  it('AC-9 (R-A): retention sweep purges exactly 13-month and 31-day leads and reports them under unconverted-leads and spam-leads', async () => {
    const res = await executeRetentionSweep({
      dbClient,
      dryRun: false,
      now,
    });

    // Verify sweep result counts
    expect(res.unconvertedLeads).toBeDefined();
    expect(res.unconvertedLeads?.scanned).toBe(1);
    expect(res.unconvertedLeads?.deleted).toBe(1);
    expect(res.unconvertedLeads?.held).toBe(0);

    expect(res.spamLeads).toBeDefined();
    expect(res.spamLeads?.scanned).toBe(1);
    expect(res.spamLeads?.deleted).toBe(1);
    expect(res.spamLeads?.held).toBe(0);

    // Verify DB state: exactly lead13mNew and lead31dSpam are deleted
    const remainingLeads = await dbClient
      .select({ id: leads.id })
      .from(leads)
      .where(
        inArray(leads.id, [
          lead13mNewId,
          lead11mContactedId,
          lead31dSpamId,
          lead29dSpamId,
          lead5yConvertedId,
        ]),
      );

    const remainingIds = remainingLeads.map((r) => r.id);
    expect(remainingIds).not.toContain(lead13mNewId);
    expect(remainingIds).toContain(lead11mContactedId);
    expect(remainingIds).not.toContain(lead31dSpamId);
    expect(remainingIds).toContain(lead29dSpamId);
    expect(remainingIds).toContain(lead5yConvertedId);

    // Verify retention.sweep.completed audit events recorded for both policies
    const auditRows = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'retention.sweep.completed'));

    const unconvertedAudit = auditRows.find((a) => a.metadata?.policy_id === 'unconverted-leads');
    expect(unconvertedAudit).toBeDefined();
    if (!unconvertedAudit?.metadata) {
      throw new Error('Expected unconvertedAudit metadata');
    }
    expect(unconvertedAudit.metadata.deleted_count).toBe(1);

    const spamAudit = auditRows.find((a) => a.metadata?.policy_id === 'spam-leads');
    expect(spamAudit).toBeDefined();
    if (!spamAudit?.metadata) {
      throw new Error('Expected spamAudit metadata');
    }
    expect(spamAudit.metadata.deleted_count).toBe(1);
  });

  it('AC-10: retention sweep with --dry-run reports counts and deletes 0 rows', async () => {
    const res = await executeRetentionSweep({
      dbClient,
      dryRun: true,
      now,
    });

    // In dry-run, deleted count in summary is reported as 0
    expect(res.unconvertedLeads).toBeDefined();
    expect(res.unconvertedLeads?.scanned).toBe(1);
    expect(res.unconvertedLeads?.deleted).toBe(0);

    expect(res.spamLeads).toBeDefined();
    expect(res.spamLeads?.scanned).toBe(1);
    expect(res.spamLeads?.deleted).toBe(0);

    // In policy results, erasableCount is 1
    const unconvertedPolicyResult = res.policies.find((p) => p.policyId === 'unconverted-leads');
    expect(unconvertedPolicyResult?.erasableCount).toBe(1);

    const spamPolicyResult = res.policies.find((p) => p.policyId === 'spam-leads');
    expect(spamPolicyResult?.erasableCount).toBe(1);

    // DB state: all 5 leads are still present
    const remainingLeads = await dbClient
      .select({ id: leads.id })
      .from(leads)
      .where(
        inArray(leads.id, [
          lead13mNewId,
          lead11mContactedId,
          lead31dSpamId,
          lead29dSpamId,
          lead5yConvertedId,
        ]),
      );

    expect(remainingLeads).toHaveLength(5);
  });
});
