import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import type { DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';
import { clients, type Client, type ClientContact } from '@/server/db/schema/clients';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { leads } from '@/server/db/schema/leads';
import { user } from '@/server/db/schema/auth';
import {
  createLead,
  changeLeadStatus,
  deleteLeads,
  getLead,
  listLeads,
  resolveActor,
} from '@/server/leads/service';
import { listLeadsRecords, getLeadsByIds, deleteNonConvertedLeads } from '@/server/leads/repo';
import { isAllowedLeadStatusTransition, type LeadStatus } from '@/server/leads/transitions';
import { getPolicies } from '@/server/retention/policy';
import { getErasureProviders } from '@/server/privacy/erasure/registry';
import { planErasure, eraseSubject } from '@/server/privacy/erasure/service';
import { getExportProviders, collectExportData } from '@/server/privacy/export/registry';

describe('TASK-0026: Branch coverage boost for Leads Domain, Retention, and Privacy', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let formId: string;
  let noticeVersionId: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    formId = generateUuidV7();
    noticeVersionId = generateUuidV7();

    await dbClient.insert(user).values({
      id: '018f0000-0000-7000-8000-000000000001',
      name: 'Studio Owner',
      email: 'owner@studio.test',
      emailVerified: true,
      role: 'owner',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await dbClient.insert(inquiryForms).values({
      id: formId,
      slug: 'branch-test-form',
      name: 'Branch Form',
      status: 'published',
      defaultLocale: 'en',
      fields: [],
      eventTypes: [],
      currentNoticeVersionId: null,
      autoReplyEnabled: false,
      acceptUnverified: true,
    });

    await dbClient.insert(inquiryFormNoticeVersions).values({
      id: noticeVersionId,
      formId,
      version: 1,
      acknowledgementTextEn: 'Notice ack',
      acknowledgementTextDe: 'Notice ack de',
      privacyPolicyUrl: 'https://example.com/privacy',
      createdByActorId: '018f0000-0000-7000-8000-000000000001',
    });
  });

  describe('Leads Repo branches', () => {
    it('covers listLeadsRecords query filters: status, verification, cursor as Date and string, and hasMore', async () => {
      // Empty getLeadsByIds and deleteNonConvertedLeads
      const emptyList = await getLeadsByIds([], dbClient);
      expect(emptyList).toEqual([]);
      const deletedEmpty = await deleteNonConvertedLeads([], dbClient);
      expect(deletedEmpty).toBe(0);

      // Create 3 leads
      const l1 = await createLead(
        {
          formId,
          noticeVersionId,
          locale: 'en',
          verification: 'verified',
          deliveryMode: 'hosted',
          givenName: 'Lead One',
          email: 'lead1@example.com',
        },
        undefined,
        dbClient,
      );
      if (!l1.success) throw new Error('Expected lead1');

      const l2 = await createLead(
        {
          formId,
          noticeVersionId,
          locale: 'en',
          verification: 'unverified',
          deliveryMode: 'hosted',
          givenName: 'Lead Two',
          email: 'lead2@example.com',
        },
        undefined,
        dbClient,
      );
      if (!l2.success) throw new Error('Expected lead2');

      // Filter by status
      const statusRes = await listLeadsRecords({ status: 'new' }, dbClient);
      expect(statusRes.leads.length).toBeGreaterThanOrEqual(2);

      // Filter by verification
      const verifiedRes = await listLeadsRecords({ verification: 'verified' }, dbClient);
      expect(verifiedRes.leads.some((l) => l.id === l1.id)).toBe(true);

      const unverifiedRes = await listLeadsRecords({ verification: 'unverified' }, dbClient);
      expect(unverifiedRes.leads.some((l) => l.id === l2.id)).toBe(true);

      // limit: 1 to trigger hasMore = true and nextCursor
      const page1 = await listLeadsRecords({ limit: 1 }, dbClient);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBeDefined();

      if (page1.nextCursor) {
        // Cursor with string
        const page2Str = await listLeadsRecords(
          {
            limit: 1,
            cursor: {
              receivedAt: page1.nextCursor.receivedAt,
              id: page1.nextCursor.id,
            },
          },
          dbClient,
        );
        expect(page2Str.leads).toBeDefined();

        // Cursor with Date
        const page2Date = await listLeadsRecords(
          {
            limit: 1,
            cursor: {
              receivedAt: new Date(page1.nextCursor.receivedAt),
              id: page1.nextCursor.id,
            },
          },
          dbClient,
        );
        expect(page2Date.leads).toBeDefined();
      }
    });
  });

  describe('Leads Service branches', () => {
    it('covers createLead validation failure', async () => {
      const invalid = await createLead(
        {
          formId: 'invalid-uuid',
          noticeVersionId: 'invalid-uuid',
          locale: 'en',
          email: 'not-an-email',
        },
        undefined,
        dbClient,
      );
      expect(invalid.success).toBe(false);
      if (invalid.success) throw new Error('Expected validation failure');
      expect(invalid.code).toBe('VALIDATION_FAILED');
      expect(invalid.fields).toBeDefined();
    });

    it('covers changeLeadStatus NOT_FOUND and actor branching', async () => {
      const nonExistent = await changeLeadStatus(
        generateUuidV7(),
        'contacted',
        undefined,
        dbClient,
      );
      expect(nonExistent.success).toBe(false);
      if (nonExistent.success) throw new Error('Expected NOT_FOUND');
      expect(nonExistent.code).toBe('NOT_FOUND');

      // Valid lead with string actor
      const lead = await createLead(
        {
          formId,
          noticeVersionId,
          locale: 'en',
          givenName: 'Test Actor',
          email: 'actor@example.com',
        },
        undefined,
        dbClient,
      );
      if (!lead.success) throw new Error('Expected lead');

      const updatedStrActor = await changeLeadStatus(
        lead.id,
        'contacted',
        'owner-string-id',
        dbClient,
      );
      expect(updatedStrActor.success).toBe(true);
    });

    it('covers deleteLeads with empty array', async () => {
      const emptyRes = await deleteLeads([], undefined, dbClient);
      expect(emptyRes.success).toBe(true);
      if (!emptyRes.success) throw new Error('Expected emptyRes to succeed');
      expect(emptyRes.count).toBe(0);
    });

    it('covers getLead returning null for unknown ID', async () => {
      const missing = await getLead(generateUuidV7(), dbClient);
      expect(missing).toBeNull();
    });

    it('covers listLeads with query', async () => {
      const list = await listLeads({ emailQuery: 'nonexistent-query' }, dbClient);
      expect(list.leads).toEqual([]);
    });
  });

  describe('Lead Transitions default branch', () => {
    it('covers default branch returning false for unknown status', () => {
      expect(isAllowedLeadStatusTransition('unknown' as LeadStatus, 'new')).toBe(false);
      expect(isAllowedLeadStatusTransition('new', 'unknown' as LeadStatus)).toBe(false);
    });
  });

  describe('Retention Policy deleteBatch branches', () => {
    it('executes deleteBatch on unconverted-leads and spam-leads policies', async () => {
      const policies = getPolicies();
      const unconvertedPolicy = policies.find((p) => p.id === 'unconverted-leads');
      const spamPolicy = policies.find((p) => p.id === 'spam-leads');

      expect(unconvertedPolicy).toBeDefined();
      expect(spamPolicy).toBeDefined();

      // Create leads to batch delete
      const l1 = await createLead(
        {
          formId,
          noticeVersionId,
          locale: 'en',
          givenName: 'Batch 1',
          email: 'batch1@example.com',
        },
        undefined,
        dbClient,
      );
      if (!l1.success) throw new Error('Expected lead');

      const l2 = await createLead(
        {
          formId,
          noticeVersionId,
          locale: 'en',
          givenName: 'Batch 2',
          email: 'batch2@example.com',
        },
        undefined,
        dbClient,
      );
      if (!l2.success) throw new Error('Expected lead');

      if (unconvertedPolicy?.deleteBatch) {
        await unconvertedPolicy.deleteBatch(dbClient, [l1.id]);
        const check = await getLead(l1.id, dbClient);
        expect(check).toBeNull();
      }

      if (spamPolicy?.deleteBatch) {
        await spamPolicy.deleteBatch(dbClient, [l2.id]);
        const check = await getLead(l2.id, dbClient);
        expect(check).toBeNull();
      }
    });
  });

  describe('Erasure and Export Registry provider branches', () => {
    it('covers converted-leads and leads erasure providers for alternate subject kinds', async () => {
      const erasureProviders = getErasureProviders();
      const convertedProvider = erasureProviders.find((p) => p.id === 'converted-leads');
      const leadsProvider = erasureProviders.find((p) => p.id === 'leads');

      expect(convertedProvider).toBeDefined();
      expect(leadsProvider).toBeDefined();

      // converted-leads plan and erase for lead kind -> returns 0
      const planLead = await convertedProvider?.plan(
        { kind: 'lead', leadId: generateUuidV7() },
        dbClient,
      );
      expect(planLead).toBe(0);
      const eraseLead = await convertedProvider?.erase(
        { kind: 'lead', leadId: generateUuidV7() },
        dbClient,
      );
      expect(eraseLead).toBe(0);

      // converted-leads plan and erase for contact kind -> returns 0
      const planContact = await convertedProvider?.plan(
        { kind: 'contact', clientId: generateUuidV7(), contactId: generateUuidV7() },
        dbClient,
      );
      expect(planContact).toBe(0);
      const eraseContact = await convertedProvider?.erase(
        { kind: 'contact', clientId: generateUuidV7(), contactId: generateUuidV7() },
        dbClient,
      );
      expect(eraseContact).toBe(0);

      // leads provider plan and erase for client kind -> returns 0
      const planClient = await leadsProvider?.plan(
        { kind: 'client', clientId: generateUuidV7() },
        dbClient,
      );
      expect(planClient).toBe(0);
      const eraseClient = await leadsProvider?.erase(
        { kind: 'client', clientId: generateUuidV7() },
        dbClient,
      );
      expect(eraseClient).toBe(0);
    });

    it('covers lead export provider when subject is not lead and fullName fallback to "Lead"', async () => {
      const exportProviders = getExportProviders();
      const leadsExportProvider = exportProviders.find((p) => p.id === 'leads');
      expect(leadsExportProvider).toBeDefined();

      // Calling leads export provider with non-lead subject
      const emptyItems = await leadsExportProvider?.collect(
        {
          kind: 'contact',
          contactId: 'dummy',
          clientId: 'dummy',
          contact: {} as unknown as ClientContact,
          client: {} as unknown as Client,
        },
        dbClient,
      );
      expect(emptyItems).toEqual([]);

      // Insert client and converted lead with no givenName, no familyName, no email to trigger "Lead" fallback
      const testClientId = generateUuidV7();
      await dbClient.insert(clients).values({
        id: testClientId,
        displayName: 'Test Client',
        kind: 'person',
        preferredLocale: 'en',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const dummyId = generateUuidV7();
      await dbClient.insert(leads).values({
        id: dummyId,
        clientId: testClientId,
        formId,
        noticeVersionId,
        noticeAcknowledgedAt: new Date(),
        status: 'converted',
        verification: 'verified',
        deliveryMode: 'hosted',
        locale: 'en',
        givenName: null,
        familyName: null,
        email: null,
        receivedAt: new Date(),
        lastActivityAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const collected = await collectExportData({ leadId: dummyId }, dbClient);
      expect(collected).toBeDefined();
      expect(collected?.exportData.subject.display_name).toBe('Lead');

      // Test collectExportData when leadId is missing from DB
      const missingExport = await collectExportData({ leadId: generateUuidV7() }, dbClient);
      expect(missingExport).toBeNull();

      // Test collectExportData when neither leadId nor contactId is provided
      const emptyExport = await collectExportData({}, dbClient);
      expect(emptyExport).toBeNull();
    });

    it('covers planErasure and eraseSubject for nonexistent lead', async () => {
      const nonExistentLeadId = generateUuidV7();

      const planRes = await planErasure({ kind: 'lead', leadId: nonExistentLeadId }, dbClient);
      expect(planRes).toBeNull();

      const eraseRes = await eraseSubject(
        { kind: 'lead', leadId: nonExistentLeadId },
        { actor: { actorType: 'system', actorId: 'test-retention' } },
        dbClient,
      );
      expect(eraseRes.success).toBe(false);
      if (eraseRes.success) throw new Error('Expected failure');
      expect(eraseRes.code).toBe('NOT_FOUND');
    });

    it('covers resolveActor with various inputs', () => {
      expect(resolveActor(undefined)).toEqual({
        actorType: 'system',
        actorId: 'lead-domain',
      });
      expect(resolveActor(null)).toEqual({
        actorType: 'system',
        actorId: 'lead-domain',
      });
      expect(resolveActor('user-123')).toEqual({
        actorType: 'owner',
        actorId: 'user-123',
      });
      expect(resolveActor({ actorId: 'user-456' })).toEqual({
        actorType: 'owner',
        actorId: 'user-456',
      });
      expect(resolveActor({ actorType: 'system', actorId: 'custom-actor' })).toEqual({
        actorType: 'system',
        actorId: 'custom-actor',
      });
    });

    it('covers retention policy eraseCandidate branches for unconverted and spam leads', async () => {
      const policies = getPolicies();
      const unconvertedPolicy = policies.find((p) => p.id === 'unconverted-leads');
      const spamPolicy = policies.find((p) => p.id === 'spam-leads');

      expect(unconvertedPolicy?.eraseCandidate).toBeDefined();
      expect(spamPolicy?.eraseCandidate).toBeDefined();

      // 1. Success deletion branch
      const l1 = await createLead(
        {
          formId,
          noticeVersionId,
          locale: 'en',
          givenName: 'Candidate 1',
          email: 'cand1@example.com',
        },
        undefined,
        dbClient,
      );
      if (!l1.success) throw new Error('Expected lead');

      if (unconvertedPolicy?.eraseCandidate) {
        const eraseCandidateRes = await unconvertedPolicy.eraseCandidate(dbClient, l1.id);
        expect(eraseCandidateRes).toEqual({ outcome: 'deleted' });
      }

      // 2. Non-existent lead failure branch
      if (unconvertedPolicy?.eraseCandidate) {
        const failRes = await unconvertedPolicy.eraseCandidate(dbClient, generateUuidV7());
        expect(failRes.outcome).toBe('failed');
      }

      if (spamPolicy?.eraseCandidate) {
        const failRes = await spamPolicy.eraseCandidate(dbClient, generateUuidV7());
        expect(failRes.outcome).toBe('failed');
      }
    });
  });
});
