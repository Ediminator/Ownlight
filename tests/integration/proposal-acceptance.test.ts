import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';

vi.mock('server-only', () => ({}));

const mockHeadersStore = new Map<string, string>();
const mockCookiesStore = new Map<string, string>();

vi.mock('next/headers', () => ({
  headers: () =>
    Promise.resolve({
      get: (name: string) => mockHeadersStore.get(name.toLowerCase()) ?? null,
    }),
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const val = mockCookiesStore.get(name);
        return val ? { name, value: val } : undefined;
      },
    }),
}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import type { DbClient } from '@/server/db/client';
import { user } from '@/server/db/schema/auth';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { projects, pipelineStages } from '@/server/db/schema/projects';
import { proposals, proposalLineItems } from '@/server/db/schema/proposals';
import { emailOutbox } from '@/server/db/schema/email-outbox';
import { auditEvents } from '@/server/db/schema/audit';
import { clientTimelineEvents } from '@/server/db/schema/timeline';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { generateUuidV7 } from '@/lib/id';
import { seedDefaultPipelineStages } from '@/server/db/seeds/pipeline-stages';
import { acceptProposalAction } from '@/server/proposals/public-actions';
import { consumeProposalRateLimit } from '@/server/auth/rate-limiter';
import { GET as publicProposalGet } from '@/app/api/public/proposals/[token]/route';
import middleware from '@/middleware';

describe('TASK-0062: Proposal Public Acceptance Integration Tests', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let inquiryStageId: string;
  let bookedStageId: string;
  let testClientId: string;
  let testProjectId: string;
  let activeProposalId: string;
  const rawToken = 'test-token-32-byte-length-secure-url-safe-abc123';
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    mockHeadersStore.clear();
    mockCookiesStore.clear();

    // 1. Seed pipeline stages
    await seedDefaultPipelineStages(dbClient);
    const stages = await dbClient.select().from(pipelineStages);
    const inq = stages.find((s) => s.category === 'inquiry');
    const bkd = stages.find((s) => s.category === 'booked');
    if (!inq || !bkd) {
      throw new Error('Default pipeline stages missing');
    }
    inquiryStageId = inq.id;
    bookedStageId = bkd.id;

    // 2. Studio settings
    await dbClient.insert(studioSettings).values({
      id: generateUuidV7(),
      studio_name: 'Solstice Light Studio',
      default_locale: 'en',
      timezone: 'Europe/Berlin',
      currency: 'EUR',
      mfa_required: false,
    });

    // 3. Studio Owner
    await dbClient.insert(user).values({
      id: generateUuidV7(),
      name: 'Studio Owner',
      email: 'owner@example.org',
      role: 'owner',
    });

    // 4. Client & Contact
    testClientId = generateUuidV7();
    await dbClient.insert(clients).values({
      id: testClientId,
      kind: 'person',
      displayName: 'Emma & Liam Client',
      preferredLocale: 'en',
    });

    await dbClient.insert(clientContacts).values({
      id: generateUuidV7(),
      clientId: testClientId,
      givenName: 'Emma',
      familyName: 'Client',
      email: 'emma@example.com',
      emailNormalized: 'emma@example.com',
      isPrimary: true,
    });

    // 5. Project in 'inquiry' stage
    testProjectId = generateUuidV7();
    await dbClient.insert(projects).values({
      id: testProjectId,
      clientId: testClientId,
      stageId: inquiryStageId,
      title: 'Emma & Liam Wedding Commission',
      currency: 'EUR',
      priceMinor: 0,
    });

    // 6. Proposal in 'sent' status
    activeProposalId = generateUuidV7();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 14);

    await dbClient.insert(proposals).values({
      id: activeProposalId,
      projectId: testProjectId,
      clientId: testClientId,
      title: 'Wedding Photography Proposal',
      status: 'sent',
      version: 1,
      currency: 'EUR',
      subtotalMinor: 200000,
      taxMinor: 31933,
      totalMinor: 200000,
      pricesIncludeTax: true,
      isKleinunternehmer: false,
      validUntil: futureDate,
      tokenHash,
      tokenRevokedAt: null,
      sentAt: new Date(),
    });

    // 7. Line items: 1 base package, 1 optional addon
    await dbClient.insert(proposalLineItems).values([
      {
        id: generateUuidV7(),
        proposalId: activeProposalId,
        itemType: 'base_package',
        name: 'Full Day Wedding Coverage',
        unitPriceMinor: 200000,
        quantity: 1,
        minQuantity: 1,
        maxQuantity: 1,
        taxRateBasisPoints: 1900,
        isOptional: false,
        isSelected: true,
        position: 0,
      },
      {
        id: generateUuidV7(),
        proposalId: activeProposalId,
        itemType: 'addon',
        name: 'Fine Art Linen Album',
        unitPriceMinor: 45000,
        quantity: 1,
        minQuantity: 0,
        maxQuantity: 3,
        taxRateBasisPoints: 1900,
        isOptional: true,
        isSelected: false,
        position: 1,
      },
    ]);
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  describe('AC-1: Middleware cookieless header verification', () => {
    it('AC-1: strips set-cookie and injects X-Robots-Tag: noindex, nofollow, noarchive on /p/[token] and /en/p/[token]', () => {
      // Direct /p/[token]
      const req1 = new NextRequest(`http://localhost:3000/p/${rawToken}`);
      const res1 = middleware(req1);
      expect(res1.headers.get('set-cookie')).toBeNull();
      expect(res1.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');

      // Localized /en/p/[token]
      const req2 = new NextRequest(`http://localhost:3000/en/p/${rawToken}`);
      const res2 = middleware(req2);
      expect(res2.headers.get('set-cookie')).toBeNull();
      expect(res2.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');

      // Localized /de/p/[token]
      const req3 = new NextRequest(`http://localhost:3000/de/p/${rawToken}`);
      const res3 = middleware(req3);
      expect(res3.headers.get('set-cookie')).toBeNull();
      expect(res3.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    });
  });

  describe('AC-6: Rate limiting integration test on public proposal endpoint', () => {
    it('AC-6: allows up to 30 requests/min and returns HTTP 429 on 31st attempt from same IP bucket', async () => {
      const testIp = '198.51.100.22';

      // 30 valid requests
      for (let i = 1; i <= 30; i++) {
        const req = new NextRequest(`http://localhost:3000/api/public/proposals/${rawToken}`, {
          headers: { 'x-forwarded-for': testIp },
        });
        const res = await publicProposalGet(req, {
          params: Promise.resolve({ token: rawToken }),
          client: dbClient,
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
      }

      // 31st request from same /24 subnet returns 429
      const req31 = new NextRequest(`http://localhost:3000/api/public/proposals/${rawToken}`, {
        headers: { 'x-forwarded-for': '198.51.100.99' }, // Same /24
      });
      const res31 = await publicProposalGet(req31, {
        params: Promise.resolve({ token: rawToken }),
        client: dbClient,
      });
      expect(res31.status).toBe(429);
      expect(await res31.text()).toBe('Too Many Requests');

      // Request from another IP subnet succeeds
      const reqOther = new NextRequest(`http://localhost:3000/api/public/proposals/${rawToken}`, {
        headers: { 'x-forwarded-for': '203.0.113.88' },
      });
      const resOther = await publicProposalGet(reqOther, {
        params: Promise.resolve({ token: rawToken }),
        client: dbClient,
      });
      expect(resOther.status).toBe(200);
    });
  });

  describe('AC-3: acceptProposalAction serializable execution', () => {
    it('AC-3: successfully accepts proposal, freezes snapshot, advances project to booked stage, and enqueues confirmation emails', async () => {
      mockHeadersStore.set('x-forwarded-for', '198.51.100.50');
      mockHeadersStore.set('user-agent', 'Mozilla/5.0 Acceptance Test Client');

      const lineItems = await dbClient
        .select()
        .from(proposalLineItems)
        .where(eq(proposalLineItems.proposalId, activeProposalId));

      const addonItem = lineItems.find((i) => i.itemType === 'addon');
      expect(addonItem).toBeDefined();
      if (!addonItem) throw new Error('Addon item not found');

      // Client accepts proposal selecting 2 units of the linen album
      const result = await acceptProposalAction(
        {
          token: rawToken,
          acceptedByName: 'Emma Watson',
          acceptedByEmail: 'emma.client@example.com',
          selectedOptions: [{ id: addonItem.id, quantity: 2 }],
          agreementConfirmed: true,
        },
        dbClient,
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);

      expect(result.data.status).toBe('accepted');
      expect(result.data.totalMinor).toBe(290000); // 200000 base + (45000 * 2)

      // 1. Verify proposal row state
      const [updatedProposal] = await dbClient
        .select()
        .from(proposals)
        .where(eq(proposals.id, activeProposalId));

      expect(updatedProposal?.status).toBe('accepted');
      expect(updatedProposal?.acceptedAt).not.toBeNull();
      expect(updatedProposal?.acceptedByName).toBe('Emma Watson');
      expect(updatedProposal?.acceptedByEmail).toBe('emma.client@example.com');
      expect(updatedProposal?.acceptanceIpAnonymized).toBe('198.51.100.0'); // IPv4 /24 mask
      expect(updatedProposal?.totalMinor).toBe(290000);

      // 2. Verify frozen immutable snapshot
      const snapshot = updatedProposal?.acceptedOptionsSnapshot;
      expect(snapshot).not.toBeNull();
      expect(snapshot?.acceptedByName).toBe('Emma Watson');
      expect(snapshot?.acceptedByEmail).toBe('emma.client@example.com');
      expect(snapshot?.totalMinor).toBe(290000);
      expect(snapshot?.items).toHaveLength(2);

      // 3. Verify project price sync and atomic stage transition (inquiry -> booked)
      const [updatedProject] = await dbClient
        .select()
        .from(projects)
        .where(eq(projects.id, testProjectId));

      expect(updatedProject?.priceMinor).toBe(290000);
      expect(updatedProject?.currency).toBe('EUR');
      expect(updatedProject?.stageId).toBe(bookedStageId);

      // 4. Verify email outbox enqueued items (client confirmation and owner alert)
      const outboxRows = await dbClient
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.proposalId, activeProposalId));

      expect(outboxRows).toHaveLength(2);
      const clientEmail = outboxRows.find((e) => e.kind === 'proposal_accepted_client');
      const ownerEmail = outboxRows.find((e) => e.kind === 'proposal_accepted_owner');

      expect(clientEmail).toBeDefined();
      expect(clientEmail?.recipient).toBe('emma.client@example.com');
      expect(ownerEmail).toBeDefined();
      expect(ownerEmail?.recipient).toBe('owner@example.org');

      // 5. Verify timeline event
      const timelineRows = await dbClient
        .select()
        .from(clientTimelineEvents)
        .where(eq(clientTimelineEvents.clientId, testClientId));

      const acceptedTimeline = timelineRows.find((t) => t.type === 'proposal.accepted');
      expect(acceptedTimeline).toBeDefined();
      expect(acceptedTimeline?.subjectId).toBe(activeProposalId);

      // 6. Verify audit log event
      const auditRows = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.targetId, activeProposalId));

      const acceptedAudit = auditRows.find((a) => a.action === 'proposal.accepted');
      expect(acceptedAudit).toBeDefined();
      expect(acceptedAudit?.outcome).toBe('success');
      expect(acceptedAudit?.metadata).toMatchObject({
        proposal_id: activeProposalId,
        total_minor: 290000,
        currency: 'EUR',
      });
    });

    it('AC-3: prevents deselecting base package deliverable even if omitted in client payload', async () => {
      // Client submits only empty selectedOptions
      const result = await acceptProposalAction(
        {
          token: rawToken,
          acceptedByName: 'Emma Watson',
          acceptedByEmail: 'emma@example.com',
          selectedOptions: [],
          agreementConfirmed: true,
        },
        dbClient,
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);

      // Total still includes base package (200000)
      expect(result.data.totalMinor).toBe(200000);

      const [updatedProposal] = await dbClient
        .select()
        .from(proposals)
        .where(eq(proposals.id, activeProposalId));

      const snapshot = updatedProposal?.acceptedOptionsSnapshot;
      expect(snapshot?.items.some((i) => i.itemType === 'base_package')).toBe(true);
    });

    it('AC-4: rejects acceptance attempt when validUntil is in the past', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 2);

      await dbClient
        .update(proposals)
        .set({ validUntil: pastDate })
        .where(eq(proposals.id, activeProposalId));

      const result = await acceptProposalAction(
        {
          token: rawToken,
          acceptedByName: 'Emma Watson',
          acceptedByEmail: 'emma@example.com',
          agreementConfirmed: true,
        },
        dbClient,
      );

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.code).toBe('EXPIRED');
    });

    it('AC-5: rejects acceptance attempt when proposal token is revoked', async () => {
      await dbClient
        .update(proposals)
        .set({ tokenRevokedAt: new Date() })
        .where(eq(proposals.id, activeProposalId));

      const result = await acceptProposalAction(
        {
          token: rawToken,
          acceptedByName: 'Emma Watson',
          acceptedByEmail: 'emma@example.com',
          agreementConfirmed: true,
        },
        dbClient,
      );

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.code).toBe('REVOKED');
    });

    it('AC-3: rejects acceptance when proposal is already accepted', async () => {
      await dbClient
        .update(proposals)
        .set({ status: 'accepted', acceptedAt: new Date() })
        .where(eq(proposals.id, activeProposalId));

      const result = await acceptProposalAction(
        {
          token: rawToken,
          acceptedByName: 'Emma Watson',
          acceptedByEmail: 'emma@example.com',
          agreementConfirmed: true,
        },
        dbClient,
      );

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.code).toBe('ALREADY_ACCEPTED');
    });

    it('AC-3: rejects acceptance when proposal status is not sent or previewable draft', async () => {
      await dbClient
        .update(proposals)
        .set({ status: 'declined' })
        .where(eq(proposals.id, activeProposalId));

      const result = await acceptProposalAction(
        {
          token: rawToken,
          acceptedByName: 'Emma Watson',
          acceptedByEmail: 'emma@example.com',
          agreementConfirmed: true,
        },
        dbClient,
      );

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.code).toBe('INVALID_STATUS');
    });

    it('AC-3: handles selectedOptionIds object items and preserves non-optional custom deliverables', async () => {
      // Reset proposal to sent
      await dbClient
        .update(proposals)
        .set({ status: 'sent', acceptedAt: null })
        .where(eq(proposals.id, activeProposalId));

      // Add a non-optional custom deliverable to the proposal
      await dbClient.insert(proposalLineItems).values({
        id: crypto.randomUUID(),
        proposalId: activeProposalId,
        itemType: 'custom',
        name: 'Extra Photo Retouching',
        unitPriceMinor: 10000,
        quantity: 1,
        minQuantity: 1,
        maxQuantity: 1,
        taxRateBasisPoints: 1900,
        isOptional: false,
        isSelected: true,
        position: 3,
      });

      const lineItems = await dbClient
        .select()
        .from(proposalLineItems)
        .where(eq(proposalLineItems.proposalId, activeProposalId));
      const addon = lineItems.find((i) => i.itemType === 'addon');
      expect(addon).toBeDefined();
      if (!addon) throw new Error('Addon item missing');

      const result = await acceptProposalAction(
        {
          token: rawToken,
          acceptedByName: 'Emma Watson',
          acceptedByEmail: 'emma@example.com',
          agreementConfirmed: true,
          selectedOptionIds: [{ id: addon.id, quantity: 1 }],
        },
        dbClient,
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);
      expect(result.data.status).toBe('accepted');
    });

    it('AC-3: handles selectedOptionIds as string array', async () => {
      // Reset proposal to sent
      await dbClient
        .update(proposals)
        .set({ status: 'sent', acceptedAt: null })
        .where(eq(proposals.id, activeProposalId));

      const lineItems = await dbClient
        .select()
        .from(proposalLineItems)
        .where(eq(proposalLineItems.proposalId, activeProposalId));
      const addon = lineItems.find((i) => i.itemType === 'addon');
      expect(addon).toBeDefined();
      if (!addon) throw new Error('Addon item missing');

      const result = await acceptProposalAction(
        {
          token: rawToken,
          acceptedByName: 'Emma Watson',
          acceptedByEmail: 'emma@example.com',
          agreementConfirmed: true,
          selectedOptionIds: [addon.id],
        },
        dbClient,
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);
      expect(result.data.status).toBe('accepted');
    });

    it('AC-3: handles unexpected transaction error and returns INTERNAL_ERROR', async () => {
      const txSpy = vi
        .spyOn(dbClient, 'transaction')
        .mockRejectedValueOnce(new Error('Fatal Postgres connection crash'));

      try {
        const result = await acceptProposalAction(
          {
            token: rawToken,
            acceptedByName: 'Emma Watson',
            acceptedByEmail: 'emma@example.com',
            agreementConfirmed: true,
          },
          dbClient,
        );

        expect(result.success).toBe(false);
        if (result.success) throw new Error('Expected failure');
        expect(result.code).toBe('INTERNAL_ERROR');
        expect(result.error).toBe('Fatal Postgres connection crash');
      } finally {
        txSpy.mockRestore();
      }
    });

    it('AC-3: returns NOT_FOUND when proposal token does not exist', async () => {
      const result = await acceptProposalAction(
        {
          token: 'non-existent-token-abc-123',
          acceptedByName: 'Emma Watson',
          acceptedByEmail: 'emma@example.com',
          agreementConfirmed: true,
        },
        dbClient,
      );

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.code).toBe('NOT_FOUND');
    });

    it('AC-6: returns RATE_LIMITED when acceptProposalAction rate check fails', async () => {
      mockHeadersStore.set('x-forwarded-for', '198.51.100.99');
      // Exhaust rate limit for this IP
      for (let i = 0; i < 30; i++) {
        await consumeProposalRateLimit('198.51.100.99', dbClient);
      }

      const result = await acceptProposalAction(
        {
          token: rawToken,
          acceptedByName: 'Emma Watson',
          acceptedByEmail: 'emma@example.com',
          agreementConfirmed: true,
        },
        dbClient,
      );

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.code).toBe('RATE_LIMITED');
    });

    it('AC-6: returns SERVICE_UNAVAILABLE when rate limit check throws an error', async () => {
      mockHeadersStore.set('x-forwarded-for', '198.51.100.123');
      const brokenClient = {
        insert: vi.fn().mockImplementation(() => {
          throw new Error('Redis/PGlite rate table crashed');
        }),
      } as unknown as typeof dbClient;

      const result = await acceptProposalAction(
        {
          token: rawToken,
          acceptedByName: 'Emma Watson',
          acceptedByEmail: 'emma@example.com',
          agreementConfirmed: true,
        },
        brokenClient,
      );

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.code).toBe('SERVICE_UNAVAILABLE');
    });
  });
});
