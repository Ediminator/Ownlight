import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import type { DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';
import { clients, type Client, type ClientContact } from '@/server/db/schema/clients';
import {
  listClients,
  insertContact,
  updateContactRecord,
  deleteContactRecord,
} from '@/server/clients/repo';
import { googleContactsLinks } from '@/server/db/schema/google-contacts-links';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { leads, type Lead } from '@/server/db/schema/leads';
import { user } from '@/server/db/schema/auth';
import {
  createLead,
  changeLeadStatus,
  deleteLeads,
  getLead,
  listLeads,
  resolveActor,
} from '@/server/leads/service';
import {
  insertLeadRecord,
  listLeadsRecords,
  getLeadsByIds,
  deleteNonConvertedLeads,
  updateLeadStatusRecord,
} from '@/server/leads/repo';
import * as leadRepo from '@/server/leads/repo';
import { isAllowedLeadStatusTransition, type LeadStatus } from '@/server/leads/transitions';
import {
  getPolicies,
  getLeadRetentionMonths,
  getClientRetentionMonths,
} from '@/server/retention/policy';
import {
  getErasureProviders,
  registerErasureHoldProvider,
  getErasureHoldProviders,
} from '@/server/privacy/erasure/registry';
import { planErasure, eraseSubject } from '@/server/privacy/erasure/service';
import { getExportProviders, collectExportData } from '@/server/privacy/export/registry';
import { serverSchema } from '@/env';

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

    it('covers insertLeadRecord throwing when insert returns empty', async () => {
      const mockClient = {
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      } as unknown as DbClient;

      await expect(
        insertLeadRecord({} as unknown as Parameters<typeof insertLeadRecord>[0], mockClient),
      ).rejects.toThrow('Failed to insert lead record');
    });

    it('covers listLeadsRecords with empty query and empty/whitespace emailQuery', async () => {
      // Empty query (tests default limit = 25 and whereClause = undefined)
      const resEmpty = await listLeadsRecords({}, dbClient);
      expect(resEmpty.leads).toBeDefined();

      // Whitespace emailQuery (tests emailQuery.trim().length === 0 branch)
      const resWhitespace = await listLeadsRecords({ emailQuery: '   ' }, dbClient);
      expect(resWhitespace.leads).toBeDefined();
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

    it('covers createLead input validation branches (missing name or email)', async () => {
      // 1. Missing givenName
      const noGivenName = await createLead(
        {
          formId,
          noticeVersionId,
          locale: 'en',
          email: 'valid@example.com',
        },
        undefined,
        dbClient,
      );
      expect(noGivenName.success).toBe(false);

      // 2. Missing email
      const noEmail = await createLead(
        {
          formId,
          noticeVersionId,
          locale: 'en',
          givenName: 'No Email',
        },
        undefined,
        dbClient,
      );
      expect(noEmail.success).toBe(false);
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

    it('covers changeLeadStatus when updateLeadStatusRecord returns null', async () => {
      const lead = await createLead(
        {
          formId,
          noticeVersionId,
          locale: 'en',
          givenName: 'Update Fail',
          email: 'updatefail@example.com',
        },
        undefined,
        dbClient,
      );
      if (!lead.success) throw new Error('Expected lead');

      const spy = vi.spyOn(leadRepo, 'updateLeadStatusRecord').mockResolvedValueOnce(null);
      const res = await changeLeadStatus(lead.id, 'contacted', undefined, dbClient);
      spy.mockRestore();

      expect(res.success).toBe(false);
      if (res.success) throw new Error('Expected failure');
      expect(res.code).toBe('NOT_FOUND');
    });

    it('covers changeLeadStatus INVALID_TRANSITION', async () => {
      const lead = await createLead(
        {
          formId,
          noticeVersionId,
          locale: 'en',
          givenName: 'Invalid Trans',
          email: 'invtrans@example.com',
        },
        undefined,
        dbClient,
      );
      if (!lead.success) throw new Error('Expected lead');

      // 'converted' is invalid target
      const resConverted = await changeLeadStatus(lead.id, 'converted', undefined, dbClient);
      expect(resConverted.success).toBe(false);
      if (resConverted.success) throw new Error('Expected failure');
      expect(resConverted.code).toBe('INVALID_TRANSITION');

      // new -> new (self transition) is invalid
      const resSelf = await changeLeadStatus(lead.id, 'new', undefined, dbClient);
      expect(resSelf.success).toBe(false);
      if (resSelf.success) throw new Error('Expected failure');
      expect(resSelf.code).toBe('INVALID_TRANSITION');
    });

    it('covers deleteLeads with empty array', async () => {
      const emptyRes = await deleteLeads([], undefined, dbClient);
      expect(emptyRes.success).toBe(true);
      if (!emptyRes.success) throw new Error('Expected emptyRes to succeed');
      expect(emptyRes.count).toBe(0);
    });

    it('covers deleteLeads single delete (bulk=false), multiple delete (bulk=true), and converted lead rejection', async () => {
      // 1. Single delete (bulk = false)
      const l1 = await createLead(
        {
          formId,
          noticeVersionId,
          locale: 'en',
          givenName: 'Single Delete',
          email: 'single@example.com',
        },
        undefined,
        dbClient,
      );
      if (!l1.success) throw new Error('Expected lead');

      const res1 = await deleteLeads([l1.id], undefined, dbClient);
      expect(res1.success).toBe(true);
      if (!res1.success) throw new Error('Expected success');
      expect(res1.count).toBe(1);

      // 2. Multiple delete (bulk = true)
      const l2 = await createLead(
        {
          formId,
          noticeVersionId,
          locale: 'en',
          givenName: 'Multi Delete 1',
          email: 'multi1@example.com',
        },
        undefined,
        dbClient,
      );
      const l3 = await createLead(
        {
          formId,
          noticeVersionId,
          locale: 'en',
          givenName: 'Multi Delete 2',
          email: 'multi2@example.com',
        },
        undefined,
        dbClient,
      );
      if (!l2.success || !l3.success) throw new Error('Expected leads');

      const resMulti = await deleteLeads([l2.id, l3.id], undefined, dbClient);
      expect(resMulti.success).toBe(true);
      if (!resMulti.success) throw new Error('Expected success');
      expect(resMulti.count).toBe(2);

      // 3. Converted lead rejection (CONVERTED_LEAD)
      const convClientId = generateUuidV7();
      await dbClient.insert(clients).values({
        id: convClientId,
        displayName: 'Conv Client',
        kind: 'person',
        preferredLocale: 'en',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const convertedId = generateUuidV7();
      await dbClient.insert(leads).values({
        id: convertedId,
        clientId: convClientId,
        formId,
        noticeVersionId,
        noticeAcknowledgedAt: new Date(),
        status: 'converted',
        verification: 'verified',
        deliveryMode: 'hosted',
        locale: 'en',
        givenName: 'Converted',
        familyName: 'Lead',
        email: 'conv@example.com',
        receivedAt: new Date(),
        lastActivityAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const resConv = await deleteLeads([convertedId], undefined, dbClient);
      expect(resConv.success).toBe(false);
      if (resConv.success) throw new Error('Expected failure');
      expect(resConv.code).toBe('CONVERTED_LEAD');
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

  describe('Lead Transitions matrix branches', () => {
    it('covers default branch returning false for unknown status', () => {
      expect(isAllowedLeadStatusTransition('unknown' as LeadStatus, 'new')).toBe(false);
      expect(isAllowedLeadStatusTransition('new', 'unknown' as LeadStatus)).toBe(false);
    });

    it('covers all transition branches in isAllowedLeadStatusTransition', () => {
      // from === to
      expect(isAllowedLeadStatusTransition('new', 'new')).toBe(false);
      expect(isAllowedLeadStatusTransition('contacted', 'contacted')).toBe(false);
      expect(isAllowedLeadStatusTransition('archived', 'archived')).toBe(false);
      expect(isAllowedLeadStatusTransition('spam', 'spam')).toBe(false);
      expect(isAllowedLeadStatusTransition('converted', 'converted')).toBe(false);

      // from === 'converted' or to === 'converted'
      expect(isAllowedLeadStatusTransition('converted', 'new')).toBe(false);
      expect(isAllowedLeadStatusTransition('converted', 'contacted')).toBe(false);
      expect(isAllowedLeadStatusTransition('new', 'converted')).toBe(false);
      expect(isAllowedLeadStatusTransition('contacted', 'converted')).toBe(false);
      expect(isAllowedLeadStatusTransition('archived', 'converted')).toBe(false);
      expect(isAllowedLeadStatusTransition('spam', 'converted')).toBe(false);

      // from === 'new'
      expect(isAllowedLeadStatusTransition('new', 'contacted')).toBe(true);
      expect(isAllowedLeadStatusTransition('new', 'archived')).toBe(true);
      expect(isAllowedLeadStatusTransition('new', 'spam')).toBe(true);

      // from === 'contacted'
      expect(isAllowedLeadStatusTransition('contacted', 'archived')).toBe(true);
      expect(isAllowedLeadStatusTransition('contacted', 'spam')).toBe(true);
      expect(isAllowedLeadStatusTransition('contacted', 'new')).toBe(false);

      // from === 'archived'
      expect(isAllowedLeadStatusTransition('archived', 'new')).toBe(true);
      expect(isAllowedLeadStatusTransition('archived', 'contacted')).toBe(false);
      expect(isAllowedLeadStatusTransition('archived', 'spam')).toBe(false);

      // from === 'spam'
      expect(isAllowedLeadStatusTransition('spam', 'new')).toBe(true);
      expect(isAllowedLeadStatusTransition('spam', 'contacted')).toBe(false);
      expect(isAllowedLeadStatusTransition('spam', 'archived')).toBe(false);
    });
  });

  describe('Retention Policy branches', () => {
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

    it('covers getCandidates with excludedIds and without excludedIds for unconverted and spam policies', async () => {
      const policies = getPolicies();
      const unconvertedPolicy = policies.find((p) => p.id === 'unconverted-leads');
      const spamPolicy = policies.find((p) => p.id === 'spam-leads');

      expect(unconvertedPolicy?.getCandidates).toBeDefined();
      expect(spamPolicy?.getCandidates).toBeDefined();

      const future = new Date(Date.now() + 86400000);
      const dummyId = generateUuidV7();

      // With excludedIds
      const uncWithExcluded = await unconvertedPolicy?.getCandidates(dbClient, future, 10, [
        dummyId,
      ]);
      expect(uncWithExcluded).toBeDefined();

      const spamWithExcluded = await spamPolicy?.getCandidates(dbClient, future, 10, [dummyId]);
      expect(spamWithExcluded).toBeDefined();

      // Without excludedIds
      const uncEmpty = await unconvertedPolicy?.getCandidates(dbClient, future, 10, []);
      expect(uncEmpty).toBeDefined();

      const spamEmpty = await spamPolicy?.getCandidates(dbClient, future, 10, []);
      expect(spamEmpty).toBeDefined();

      // Check getters
      expect(unconvertedPolicy?.after).toEqual({ months: 12 });
      expect(spamPolicy?.after).toEqual({ days: 30 });
      expect(unconvertedPolicy?.action).toBe('delete');
      expect(spamPolicy?.action).toBe('delete');
    });

    it('covers eraseCandidate returning held outcome when erasure hold is present', async () => {
      const policies = getPolicies();
      const unconvertedPolicy = policies.find((p) => p.id === 'unconverted-leads');
      const spamPolicy = policies.find((p) => p.id === 'spam-leads');

      const l1 = await createLead(
        {
          formId,
          noticeVersionId,
          locale: 'en',
          givenName: 'Held Lead 1',
          email: 'held1@example.com',
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
          givenName: 'Held Lead 2',
          email: 'held2@example.com',
        },
        undefined,
        dbClient,
      );
      if (!l2.success) throw new Error('Expected lead');

      const heldIds = new Set([l1.id, l2.id]);
      registerErasureHoldProvider({
        id: 'test-coverage-lead-hold-provider',
        holds: (subject) => {
          if (subject.kind === 'lead' && heldIds.has(subject.leadId)) {
            return Promise.resolve([
              {
                reason: 'Legal inquiry',
                retainUntil: null,
              },
            ]);
          }
          return Promise.resolve([]);
        },
      });

      if (unconvertedPolicy?.eraseCandidate) {
        const heldRes1 = await unconvertedPolicy.eraseCandidate(dbClient, l1.id);
        expect(heldRes1).toEqual({ outcome: 'held' });
      }

      if (spamPolicy?.eraseCandidate) {
        const heldRes2 = await spamPolicy.eraseCandidate(dbClient, l2.id);
        expect(heldRes2).toEqual({ outcome: 'held' });
      }
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

    it('covers client erasure provider and client_legal_hold provider with lead and contact subject kinds', async () => {
      const erasureProviders = getErasureProviders();
      const clientProvider = erasureProviders.find((p) => p.id === 'client');
      expect(clientProvider).toBeDefined();

      // Lead kind
      const planLead = await clientProvider?.plan(
        { kind: 'lead', leadId: generateUuidV7() },
        dbClient,
      );
      expect(planLead).toBe(0);
      const eraseLead = await clientProvider?.erase(
        { kind: 'lead', leadId: generateUuidV7() },
        dbClient,
      );
      expect(eraseLead).toBe(0);

      // Contact kind
      const planContact = await clientProvider?.plan(
        { kind: 'contact', clientId: generateUuidV7(), contactId: generateUuidV7() },
        dbClient,
      );
      expect(planContact).toBe(0);
      const eraseContact = await clientProvider?.erase(
        { kind: 'contact', clientId: generateUuidV7(), contactId: generateUuidV7() },
        dbClient,
      );
      expect(eraseContact).toBe(0);

      // client_legal_hold provider with lead kind
      const holdProviders = getErasureHoldProviders();
      const legalHoldProv = holdProviders.find((p) => p.id === 'client_legal_hold');
      if (legalHoldProv) {
        const leadHolds = await legalHoldProv.holds(
          { kind: 'lead', leadId: generateUuidV7() },
          dbClient,
        );
        expect(leadHolds).toEqual([]);
      }
    });

    it('covers all default erasure providers early returns when subject kind is lead', async () => {
      const providers = getErasureProviders();
      const dummyLeadSubject = {
        kind: 'lead' as const,
        leadId: generateUuidV7(),
      };

      for (const p of providers) {
        if (p.id !== 'leads') {
          const planCount = await p.plan(dummyLeadSubject, dbClient);
          expect(planCount).toBe(0);
          const eraseCount = await p.erase(dummyLeadSubject, dbClient);
          expect(eraseCount).toBe(0);
        }
      }

      const holdProviders = getErasureHoldProviders();
      for (const hp of holdProviders) {
        const holds = await hp.holds(dummyLeadSubject, dbClient);
        expect(Array.isArray(holds)).toBe(true);
      }
    });

    it('covers all default export providers early returns when subject kind is lead', async () => {
      const providers = getExportProviders();
      const dummyLeadSubject = {
        kind: 'lead' as const,
        leadId: generateUuidV7(),
        lead: {
          id: generateUuidV7(),
          formId: generateUuidV7(),
          noticeVersionId: generateUuidV7(),
          status: 'new' as const,
          verification: 'verified' as const,
          deliveryMode: 'hosted' as const,
          locale: 'en' as const,
          givenName: null,
          familyName: null,
          email: null,
          phone: null,
          eventTypeKey: null,
          eventDate: null,
          eventLocation: null,
          message: null,
          autoReplyStatus: 'not_applicable' as const,
          noticeAcknowledgedAt: new Date(),
          receivedAt: new Date(),
          lastActivityAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          clientId: null,
        },
      };

      for (const p of providers) {
        if (p.id !== 'leads') {
          const items = await p.collect(
            dummyLeadSubject as unknown as Parameters<typeof p.collect>[0],
            dbClient,
          );
          expect(items).toEqual([]);
        }
      }
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

    it('covers lead export provider fallbacks when form and notice version are omitted/missing', async () => {
      // 1. Direct collect call with non-existent form and notice version IDs to hit nullish fallbacks
      const exportProviders = getExportProviders();
      const leadsExportProvider = exportProviders.find((p) => p.id === 'leads');
      expect(leadsExportProvider).toBeDefined();

      const fakeLead: Lead = {
        id: generateUuidV7(),
        clientId: null,
        formId: generateUuidV7(),
        noticeVersionId: generateUuidV7(),
        noticeAcknowledgedAt: new Date(),
        status: 'new',
        verification: 'verified',
        deliveryMode: 'hosted',
        locale: 'en',
        givenName: 'Test',
        familyName: 'Lead',
        email: 'test@example.com',
        emailNormalized: 'test@example.com',
        phone: null,
        eventTypeKey: null,
        eventDate: null,
        eventLocation: null,
        message: null,
        autoReplyStatus: 'not_applicable',
        convertedAt: null,
        receivedAt: new Date(),
        lastActivityAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const collectedItems = await leadsExportProvider?.collect(
        { kind: 'lead', leadId: fakeLead.id, lead: fakeLead },
        dbClient,
      );

      expect(collectedItems).toBeDefined();
      const itemsList = Array.isArray(collectedItems)
        ? collectedItems
        : collectedItems
          ? [collectedItems]
          : [];
      expect(itemsList.length).toBe(1);
      const item = itemsList[0] as Record<string, unknown> | undefined;
      expect(item?.form_name).toBe('Inquiry form');
      expect(item?.notice_version).toBeNull();
      expect(item?.notice_acknowledgement_text_en).toBeNull();
      expect(item?.notice_acknowledgement_text_de).toBeNull();
      expect(item?.notice_privacy_policy_url).toBeNull();

      // 2. collectExportData with converted lead having only email (joinedName empty -> email display_name)
      const testClientId = generateUuidV7();
      await dbClient.insert(clients).values({
        id: testClientId,
        displayName: 'Export Fallback Client',
        kind: 'person',
        preferredLocale: 'en',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const dummyLeadId = generateUuidV7();
      await dbClient.insert(leads).values({
        id: dummyLeadId,
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
        email: 'only-email@example.com',
        receivedAt: new Date(),
        lastActivityAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const collected = await collectExportData({ leadId: dummyLeadId }, dbClient);
      expect(collected).toBeDefined();
      expect(collected?.exportData.subject.display_name).toBe('only-email@example.com');
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
  });

  describe('LEAD_RETENTION_MONTHS environment validation branches', () => {
    const validServerEnvInput = {
      NODE_ENV: 'test',
      PORT: '3000',
      AUTH_URL: 'http://localhost:3000',
      AUTH_SECRET: '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a',
      DATABASE_URL: 'postgres://ownlight_app:password@127.0.0.1:5432/ownlight_dev',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      SMTP_FROM: 'noreply@example.com',
      STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
      STORAGE_PORT: '9000',
      STORAGE_REGION: 'us-east-1',
      STORAGE_ACCESS_KEY: 'valid_access_key_123',
      STORAGE_SECRET_KEY: '8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b',
      STORAGE_BUCKET_UPLOADS: 'ownlight-uploads',
      STORAGE_USE_SSL: 'false',
    };

    it('defaults to 12 when LEAD_RETENTION_MONTHS is unset or empty string', () => {
      const envUnset = { ...validServerEnvInput };
      delete (envUnset as Record<string, unknown>).LEAD_RETENTION_MONTHS;
      const parsedUnset = serverSchema.safeParse(envUnset);
      expect(parsedUnset.success).toBe(true);
      if (parsedUnset.success) {
        expect(parsedUnset.data.LEAD_RETENTION_MONTHS).toBe(12);
      }

      const envEmpty = { ...validServerEnvInput, LEAD_RETENTION_MONTHS: '' };
      const parsedEmpty = serverSchema.safeParse(envEmpty);
      expect(parsedEmpty.success).toBe(true);
      if (parsedEmpty.success) {
        expect(parsedEmpty.data.LEAD_RETENTION_MONTHS).toBe(12);
      }
    });

    it('parses valid LEAD_RETENTION_MONTHS and rejects out-of-range or non-numeric values', () => {
      // Valid
      const envValid = { ...validServerEnvInput, LEAD_RETENTION_MONTHS: '24' };
      const parsedValid = serverSchema.safeParse(envValid);
      expect(parsedValid.success).toBe(true);
      if (parsedValid.success) {
        expect(parsedValid.data.LEAD_RETENTION_MONTHS).toBe(24);
      }

      // Rejects 0 (< 1)
      const envZero = { ...validServerEnvInput, LEAD_RETENTION_MONTHS: '0' };
      const parsedZero = serverSchema.safeParse(envZero);
      expect(parsedZero.success).toBe(false);

      // Rejects 37 (> 36)
      const envHigh = { ...validServerEnvInput, LEAD_RETENTION_MONTHS: '37' };
      const parsedHigh = serverSchema.safeParse(envHigh);
      expect(parsedHigh.success).toBe(false);

      // Rejects non-numeric
      const envBad = { ...validServerEnvInput, LEAD_RETENTION_MONTHS: 'abc' };
      const parsedBad = serverSchema.safeParse(envBad);
      expect(parsedBad.success).toBe(false);
    });

    it('resolves getLeadRetentionMonths from environment', () => {
      const months = getLeadRetentionMonths();
      expect(typeof months).toBe('number');
      expect(months).toBeGreaterThanOrEqual(1);
      expect(months).toBeLessThanOrEqual(36);
    });

    it('resolves getLeadRetentionMonths and getClientRetentionMonths fallback branches', () => {
      const origLead = process.env.LEAD_RETENTION_MONTHS;
      try {
        // Out of range: <= 0
        process.env.LEAD_RETENTION_MONTHS = '0';
        expect(getLeadRetentionMonths()).toBe(12);

        // Out of range: > 36
        process.env.LEAD_RETENTION_MONTHS = '99';
        expect(getLeadRetentionMonths()).toBe(12);

        // In range: 24
        process.env.LEAD_RETENTION_MONTHS = '24';
        expect(getLeadRetentionMonths()).toBe(24);

        // Client retention months
        expect(getClientRetentionMonths()).toBeGreaterThanOrEqual(1);
      } finally {
        if (origLead !== undefined) {
          process.env.LEAD_RETENTION_MONTHS = origLead;
        } else {
          delete process.env.LEAD_RETENTION_MONTHS;
        }
      }
    });
  });

  describe('Client Repo branches coverage', () => {
    it('covers listClients overloading parameter forms and pagination', async () => {
      const res1 = await listClients(1, dbClient);
      expect(res1.items).toBeDefined();

      const res2 = await listClients(1, 10, dbClient);
      expect(res2.items).toBeDefined();

      const res3 = await listClients({ page: 1, pageSize: 5 }, dbClient);
      expect(res3.items).toBeDefined();

      const res4 = await listClients({ page: 2, pageSize: 5, q: 'test' }, 10, dbClient);
      expect(res4.items).toBeDefined();
    });

    it('covers contact repo operations with Google Sync and primary contact promotion', async () => {
      const cId = generateUuidV7();
      await dbClient.insert(clients).values({
        id: cId,
        displayName: 'Sync Client',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Insert primary contact (hits syncEnabled enqueueContactUpsert)
      const ct1 = await insertContact(
        cId,
        {
          givenName: 'Contact 1',
          email: 'c1@example.com',
          isPrimary: true,
        },
        dbClient,
      );
      expect(ct1.id).toBeDefined();

      // Insert secondary contact
      const ct2 = await insertContact(
        cId,
        {
          givenName: 'Contact 2',
          email: 'c2@example.com',
          isPrimary: false,
        },
        dbClient,
      );
      expect(ct2.id).toBeDefined();

      // Update contact record (hits syncEnabled enqueueContactUpsert on update)
      const updatedCt = await updateContactRecord(
        cId,
        ct1.id,
        { givenName: 'Updated Contact 1' },
        dbClient,
      );
      expect(updatedCt?.givenName).toBe('Updated Contact 1');

      // Add a google contacts link row for ct1 to test link deletion branch
      await dbClient.insert(googleContactsLinks).values({
        contactId: ct1.id,
        googleResourceName: 'people/c123',
        googleEtag: 'etag123',
        lastSyncedAt: new Date(),
      });

      // Delete primary contact (hits link deletion enqueueContactDelete and promotes ct2 to primary)
      const deleteRes = await deleteContactRecord(cId, ct1.id, dbClient);
      expect(deleteRes?.wasPrimary).toBe(true);
      expect(deleteRes?.newPrimaryId).toBe(ct2.id);

      // Delete remaining contact (was primary, but no remaining contacts left)
      const deleteRes2 = await deleteContactRecord(cId, ct2.id, dbClient);
      expect(deleteRes2?.wasPrimary).toBe(true);
      expect(deleteRes2?.newPrimaryId).toBeUndefined();

      // Delete non-existent contact
      const deleteNone = await deleteContactRecord(cId, generateUuidV7(), dbClient);
      expect(deleteNone).toBeNull();
    });

    it('covers resolveActor all branch paths', () => {
      // 1. undefined actor
      expect(resolveActor(undefined)).toEqual({
        actorType: 'system',
        actorId: 'lead-domain',
      });

      // 2. string actor
      expect(resolveActor('user-abc')).toEqual({
        actorType: 'owner',
        actorId: 'user-abc',
      });

      // 3. actor object with only actorType
      expect(resolveActor({ actorType: 'agent' })).toEqual({
        actorType: 'agent',
        actorId: null,
      });

      // 4. actor object with only actorId
      expect(resolveActor({ actorId: 'user-xyz' })).toEqual({
        actorType: 'owner',
        actorId: 'user-xyz',
      });

      // 5. empty actor object
      expect(resolveActor({})).toEqual({
        actorType: 'owner',
        actorId: null,
      });
    });

    it('covers updateLeadStatusRecord returning null for non-existent lead', async () => {
      const res = await updateLeadStatusRecord(generateUuidV7(), 'contacted', new Date(), dbClient);
      expect(res).toBeNull();
    });

    it('covers listLeadsRecords filtering, cursor parsing, and hasMore pagination branches', async () => {
      // Empty query with no filters
      const emptyRes = await listLeadsRecords({}, dbClient);
      expect(Array.isArray(emptyRes.leads)).toBe(true);

      // Whitespace emailQuery
      const wsEmailRes = await listLeadsRecords({ emailQuery: '   ' }, dbClient);
      expect(Array.isArray(wsEmailRes.leads)).toBe(true);

      // Create 2 test leads
      const now = new Date();
      const lead1 = await insertLeadRecord(
        {
          formId,
          noticeVersionId,
          noticeAcknowledgedAt: now,
          status: 'new',
          verification: 'unverified',
          deliveryMode: 'hosted',
          locale: 'en',
          givenName: 'TestLead1',
          familyName: 'Branch',
          email: 'lead1@example.com',
          emailNormalized: 'lead1@example.com',
          phone: null,
          eventTypeKey: null,
          eventDate: null,
          eventLocation: null,
          message: null,
          autoReplyStatus: 'not_applicable',
          receivedAt: new Date(now.getTime() - 2000),
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now,
        },
        dbClient,
      );

      const lead2 = await insertLeadRecord(
        {
          formId,
          noticeVersionId,
          noticeAcknowledgedAt: now,
          status: 'contacted',
          verification: 'verified',
          deliveryMode: 'hosted',
          locale: 'de',
          givenName: 'TestLead2',
          familyName: 'Branch',
          email: 'lead2@example.com',
          emailNormalized: 'lead2@example.com',
          phone: null,
          eventTypeKey: null,
          eventDate: null,
          eventLocation: null,
          message: null,
          autoReplyStatus: 'not_applicable',
          receivedAt: now,
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now,
        },
        dbClient,
      );

      // Filter by status, verification, and email prefix
      const filtered = await listLeadsRecords(
        {
          status: 'contacted',
          verification: 'verified',
          emailQuery: 'lead2',
          limit: 10,
        },
        dbClient,
      );
      expect(filtered.leads.some((l) => l.id === lead2.id)).toBe(true);
      expect(filtered.leads.some((l) => l.id === lead1.id)).toBe(false);

      // Pagination hasMore: limit = 1
      const paged = await listLeadsRecords(
        {
          limit: 1,
        },
        dbClient,
      );
      expect(paged.hasMore).toBe(true);
      expect(paged.nextCursor).not.toBeNull();

      // Cursor as Date object
      if (paged.nextCursor) {
        const cursorDate = new Date(paged.nextCursor.receivedAt);
        const nextDatePage = await listLeadsRecords(
          {
            cursor: { receivedAt: cursorDate, id: paged.nextCursor.id },
            limit: 10,
          },
          dbClient,
        );
        expect(Array.isArray(nextDatePage.leads)).toBe(true);

        // Cursor as ISO string
        const nextStringPage = await listLeadsRecords(
          {
            cursor: { receivedAt: paged.nextCursor.receivedAt, id: paged.nextCursor.id },
            limit: 10,
          },
          dbClient,
        );
        expect(Array.isArray(nextStringPage.leads)).toBe(true);
      }
    });
  });
});
