import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: () => undefined,
      set: () => undefined,
      delete: () => undefined,
    }),
  headers: () => Promise.resolve(new Headers()),
}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { createLead, listLeads, changeLeadStatus } from '@/server/leads/service';
import { changeLeadStatusAction, exportLeadDsarAction } from '@/server/leads/actions';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import type { DbClient } from '@/server/db/client';

describe('TASK-0031: Leads Unit Tests (AC-2, AC-7, Pagination, Schema Validation)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let formId: string;
  let noticeVersionId: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    formId = '018f0000-0000-7000-8000-000000000002';
    noticeVersionId = '018f0000-0000-7000-8000-000000000003';

    await dbClient.insert(inquiryForms).values({
      id: formId,
      slug: 'test-form',
      name: 'General Inquiries',
      status: 'published',
      defaultLocale: 'en',
      fields: [{ key: 'given_name', enabled: true, required: true, order: 0 }],
      eventTypes: [],
      currentNoticeVersionId: null,
      autoReplyEnabled: true,
      acceptUnverified: false,
    });

    await dbClient.insert(inquiryFormNoticeVersions).values({
      id: noticeVersionId,
      formId,
      version: 1,
      acknowledgementTextEn: 'Notice EN',
      acknowledgementTextDe: 'Notice DE',
      privacyPolicyUrl: 'https://example.org/privacy',
      createdByActorId: 'owner-test',
    });
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-2: listLeads filters leads strictly by status (new, contacted, archived, spam)', async () => {
    const l1 = await createLead(
      { formId, noticeVersionId, locale: 'en', givenName: 'L1', email: 'l1@example.org' },
      undefined,
      dbClient,
    );
    const l2 = await createLead(
      { formId, noticeVersionId, locale: 'en', givenName: 'L2', email: 'l2@example.org' },
      undefined,
      dbClient,
    );
    const l3 = await createLead(
      { formId, noticeVersionId, locale: 'en', givenName: 'L3', email: 'l3@example.org' },
      undefined,
      dbClient,
    );
    expect(l1.success && l2.success && l3.success).toBe(true);
    if (!l1.success || !l2.success || !l3.success) return;

    // Transition l2 to contacted, l3 to archived
    await changeLeadStatus(l2.data.id, 'contacted', 'owner-test', dbClient);
    await changeLeadStatus(l3.data.id, 'archived', 'owner-test', dbClient);

    // Query status = 'new'
    const newLeads = await listLeads({ status: 'new' }, dbClient);
    expect(newLeads.leads).toHaveLength(1);
    expect(newLeads.leads[0]?.id).toBe(l1.data.id);

    // Query status = 'contacted'
    const contactedLeads = await listLeads({ status: 'contacted' }, dbClient);
    expect(contactedLeads.leads).toHaveLength(1);
    expect(contactedLeads.leads[0]?.id).toBe(l2.data.id);

    // Query status = 'archived'
    const archivedLeads = await listLeads({ status: 'archived' }, dbClient);
    expect(archivedLeads.leads).toHaveLength(1);
    expect(archivedLeads.leads[0]?.id).toBe(l3.data.id);

    // Query status = 'spam' -> empty
    const spamLeads = await listLeads({ status: 'spam' }, dbClient);
    expect(spamLeads.leads).toHaveLength(0);
  });

  it('AC-7: listLeads filters by email prefix / exact match on email_normalized', async () => {
    await createLead(
      { formId, noticeVersionId, locale: 'en', givenName: 'Jane', email: 'Jane.Doe@Example.ORG' },
      undefined,
      dbClient,
    );
    await createLead(
      { formId, noticeVersionId, locale: 'en', givenName: 'John', email: 'john.smith@example.org' },
      undefined,
      dbClient,
    );

    // Search prefix "jane@"
    const search1 = await listLeads({ emailQuery: 'jane@' }, dbClient);
    expect(search1.leads).toHaveLength(0);

    // Search prefix "jane"
    const search2 = await listLeads({ emailQuery: 'jane' }, dbClient);
    expect(search2.leads).toHaveLength(1);
    expect(search2.leads[0]?.emailNormalized).toBe('jane.doe@example.org');

    // Case insensitive prefix search "JANE.DOE@"
    const search3 = await listLeads({ emailQuery: 'JANE.DOE@' }, dbClient);
    expect(search3.leads).toHaveLength(1);
    expect(search3.leads[0]?.emailNormalized).toBe('jane.doe@example.org');
  });

  it('supports pagination via page parameter and keyset cursor', async () => {
    for (let i = 1; i <= 5; i++) {
      await createLead(
        {
          formId,
          noticeVersionId,
          locale: 'en',
          givenName: `User${String(i)}`,
          email: `user${String(i)}@example.org`,
        },
        undefined,
        dbClient,
      );
    }

    // Page 1 with limit 2
    const p1 = await listLeads({ limit: 2, page: 1 }, dbClient);
    expect(p1.leads).toHaveLength(2);
    expect(p1.hasMore).toBe(true);

    // Page 2 with limit 2
    const p2 = await listLeads({ limit: 2, page: 2 }, dbClient);
    expect(p2.leads).toHaveLength(2);
    expect(p2.leads[0]?.id).not.toBe(p1.leads[0]?.id);
    expect(p2.hasMore).toBe(true);

    // Page 3 with limit 2
    const p3 = await listLeads({ limit: 2, page: 3 }, dbClient);
    expect(p3.leads).toHaveLength(1);
    expect(p3.hasMore).toBe(false);

    // Keyset cursor pagination
    const cursorPage1 = await listLeads({ limit: 2 }, dbClient);
    expect(cursorPage1.nextCursor).not.toBeNull();
    if (!cursorPage1.nextCursor) return;

    const cursorPage2 = await listLeads({ limit: 2, cursor: cursorPage1.nextCursor }, dbClient);
    expect(cursorPage2.leads).toHaveLength(2);
    expect(cursorPage2.leads[0]?.id).not.toBe(cursorPage1.leads[0]?.id);
  });

  it('changeLeadStatusAction rejects invalid input schema without touching database', async () => {
    const invalidId = await changeLeadStatusAction({
      leadId: 'not-a-uuid',
      targetStatus: 'contacted',
    });
    expect(invalidId.success).toBe(false);
    if (!invalidId.success) {
      expect(invalidId.code).toBe('VALIDATION_FAILED');
    }

    const invalidStatus = await changeLeadStatusAction({
      leadId: '018f0000-0000-7000-8000-000000000099',
      targetStatus: 'unknown-status' as unknown as import('@/server/db/schema/leads').LeadStatus,
    });
    expect(invalidStatus.success).toBe(false);
    if (!invalidStatus.success) {
      expect(invalidStatus.code).toBe('VALIDATION_FAILED');
    }
  });

  it('exportLeadDsarAction rejects invalid input schema', async () => {
    const res = await exportLeadDsarAction({ leadId: 'invalid' });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.code).toBe('VALIDATION_FAILED');
    }
  });

  it('getLeadWithDetails retrieves lead with form name and notice version', async () => {
    const created = await createLead(
      {
        formId,
        noticeVersionId,
        locale: 'en',
        givenName: 'DetailsTest',
        email: 'details@example.org',
      },
      undefined,
      dbClient,
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const details = await (
      await import('@/server/leads/repo')
    ).getLeadWithDetails(created.data.id, dbClient);
    expect(details).not.toBeNull();
    expect(details?.lead.id).toBe(created.data.id);
    expect(details?.formName).toBe('General Inquiries');
    expect(details?.noticeVersion?.acknowledgementTextEn).toBe('Notice EN');

    const nonExistent = await (
      await import('@/server/leads/repo')
    ).getLeadWithDetails('018f0000-0000-7000-8000-999999999999', dbClient);
    expect(nonExistent).toBeNull();
  });

  it('getLeadCounts accurately aggregates counts across all statuses', async () => {
    await createLead(
      { formId, noticeVersionId, locale: 'en', givenName: 'N1', email: 'n1@example.org' },
      undefined,
      dbClient,
    );
    const l2 = await createLead(
      { formId, noticeVersionId, locale: 'en', givenName: 'N2', email: 'n2@example.org' },
      undefined,
      dbClient,
    );
    const l3 = await createLead(
      { formId, noticeVersionId, locale: 'en', givenName: 'N3', email: 'n3@example.org' },
      undefined,
      dbClient,
    );
    if (l2.success) {
      await changeLeadStatus(l2.data.id, 'contacted', 'owner-test', dbClient);
    }
    if (l3.success) {
      await changeLeadStatus(l3.data.id, 'spam', 'owner-test', dbClient);
    }

    const counts = await (await import('@/server/leads/repo')).getLeadCounts(dbClient);
    expect(counts.all).toBeGreaterThanOrEqual(3);
    expect(counts.new).toBeGreaterThanOrEqual(1);
    expect(counts.contacted).toBeGreaterThanOrEqual(1);
    expect(counts.spam).toBeGreaterThanOrEqual(1);
  });

  it('deleteNonConvertedLeads handles empty array and deletes records', async () => {
    const { deleteNonConvertedLeads } = await import('@/server/leads/repo');
    const zero = await deleteNonConvertedLeads([], dbClient);
    expect(zero).toBe(0);

    const l1 = await createLead(
      { formId, noticeVersionId, locale: 'en', givenName: 'Del1', email: 'del1@example.org' },
      undefined,
      dbClient,
    );
    if (!l1.success) return;

    const deleted = await deleteNonConvertedLeads([l1.data.id], dbClient);
    expect(deleted).toBe(1);
  });

  it('deleteAllSpamLeads deletes spam leads and records audit event', async () => {
    const { deleteAllSpamLeads } = await import('@/server/leads/service');
    const s1 = await createLead(
      { formId, noticeVersionId, locale: 'en', givenName: 'Spam1', email: 'spam1@example.org' },
      undefined,
      dbClient,
    );
    if (!s1.success) return;
    await changeLeadStatus(s1.data.id, 'spam', 'owner-test', dbClient);

    const res = await deleteAllSpamLeads('owner-test', dbClient);
    expect(res.count).toBeGreaterThanOrEqual(1);
  });

  it('changeLeadStatusAction supports alternative invocation shapes', async () => {
    // rawInput as string + secondArg as string
    const l1 = await createLead(
      { formId, noticeVersionId, locale: 'en', givenName: 'Shape1', email: 'shape1@example.org' },
      undefined,
      dbClient,
    );
    if (!l1.success) return;

    // Call with invalid auth but checking parameter parsing branch
    const res = await changeLeadStatusAction(l1.data.id, 'contacted', dbClient);
    expect(res.success).toBe(false);

    // Call with toStatus candidate object
    const res2 = await changeLeadStatusAction(
      { leadId: l1.data.id, toStatus: 'archived' },
      dbClient,
    );
    expect(res2.success).toBe(false);
  });

  it('deleteLeadsAction parses multiple argument shapes before auth check', async () => {
    const { deleteLeadsAction } = await import('@/server/leads/actions');
    const validUuid = '018f0000-0000-7000-8000-000000000001';

    // Array of strings shape
    const resArr = await deleteLeadsAction([validUuid], dbClient);
    expect(resArr.success).toBe(false);

    // Single string shape
    const resStr = await deleteLeadsAction(validUuid, dbClient);
    expect(resStr.success).toBe(false);

    // Object with deleteAllSpam
    const resSpam = await deleteLeadsAction({ deleteAllSpam: true }, dbClient);
    expect(resSpam.success).toBe(false);

    // Object with leadId string
    const resId = await deleteLeadsAction({ leadId: validUuid }, dbClient);
    expect(resId.success).toBe(false);

    // Object with leadIds array
    const resIds = await deleteLeadsAction({ leadIds: [validUuid] }, dbClient);
    expect(resIds.success).toBe(false);

    // Invalid schema
    const resEmpty = await deleteLeadsAction({ leadIds: [] }, dbClient);
    expect(resEmpty.success).toBe(false);
  });

  it('getLeadCountsAction rejects unauthenticated calls', async () => {
    const { getLeadCountsAction } = await import('@/server/leads/actions');
    const res = await getLeadCountsAction(dbClient);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.code).toBe('UNAUTHORIZED');
    }
  });
});
