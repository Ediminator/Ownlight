import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { eq } from 'drizzle-orm';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { projects, pipelineStages } from '@/server/db/schema/projects';
import { proposals, proposalLineItems } from '@/server/db/schema/proposals';
import { auditEvents } from '@/server/db/schema/audit';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { user } from '@/server/db/schema/auth';
import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { eraseSubject, checkErasureHolds } from '@/server/privacy/erasure/service';
import { runRetentionSweep } from '@/server/retention/sweep';
import {
  resetErasureHoldProviders,
  resetErasureProviders,
} from '@/server/privacy/erasure/registry';
import { resetActivityProviders } from '@/server/clients/activity';
import { resetPolicies } from '@/server/retention/policy';
import type { DbClient } from '@/server/db/client';

describe('TASK-0059: Proposals Erasure & Statutory Hold Integration (AC-3, AC-4, AC-5)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  const ownerUserId = '018f0000-0000-7000-8000-000000000001';
  let defaultStageId = '01910000-0000-7000-8000-000000000010';
  let archivedStageId = '01910000-0000-7000-8000-000000000011';

  beforeEach(async () => {
    resetErasureHoldProviders();
    resetErasureProviders();
    resetActivityProviders();
    resetPolicies();

    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;

    // Seed studio owner user
    await dbClient.insert(user).values({
      id: ownerUserId,
      name: 'Studio Owner',
      email: 'owner@example.org',
      role: 'owner',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });

    // Seed studio settings
    await dbClient.insert(studioSettings).values({
      studio_name: 'Studio Test',
      currency: 'EUR',
      default_locale: 'en',
      timezone: 'UTC',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });

    // Fetch existing inquiry and archived pipeline stages seeded by migrations
    const [inquiryStage] = await dbClient
      .select({ id: pipelineStages.id })
      .from(pipelineStages)
      .where(eq(pipelineStages.key, 'inquiry'))
      .limit(1);

    if (inquiryStage) {
      defaultStageId = inquiryStage.id;
    } else {
      const [anyStage] = await dbClient
        .select({ id: pipelineStages.id })
        .from(pipelineStages)
        .limit(1);
      defaultStageId = anyStage?.id ?? '01910000-0000-7000-8000-000000000010';
    }

    const [archivedStage] = await dbClient
      .select({ id: pipelineStages.id })
      .from(pipelineStages)
      .where(eq(pipelineStages.key, 'archived'))
      .limit(1);

    if (archivedStage) {
      archivedStageId = archivedStage.id;
    } else {
      archivedStageId = defaultStageId;
    }
  });

  afterEach(async () => {
    delete (globalThis as unknown as { db: DbClient | undefined }).db;
    resetErasureHoldProviders();
    resetErasureProviders();
    resetActivityProviders();
    resetPolicies();
    await testDb.destroy();
  });

  it('AC-3: hard-deletes unaccepted proposals and line items leaving zero orphaned rows when client is erased', async () => {
    const clientId = '01910000-0000-7000-8000-0000000000c1';
    const contactId = '01910000-0000-7000-8000-0000000000d1';
    const projectId = '01910000-0000-7000-8000-0000000000e1';
    const proposal1Id = '01910000-0000-7000-8000-0000000000f1';
    const proposal2Id = '01910000-0000-7000-8000-0000000000f2';

    // 1. Create client and contact
    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Unaccepted Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });

    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      givenName: 'Test',
      familyName: 'Subject',
      isPrimary: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    // 2. Create project
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: archivedStageId,
      title: 'Inquiry Project',
      projectTypeKey: 'portrait',
      currency: 'EUR',
      priceMinor: 50000,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });

    // 3. Create unaccepted proposals: draft and declined
    await dbClient.insert(proposals).values([
      {
        id: proposal1Id,
        projectId,
        clientId,
        title: 'Draft Proposal',
        status: 'draft',
        currency: 'EUR',
        subtotalMinor: 50000,
        taxMinor: 9500,
        totalMinor: 59500,
        tokenHash: 'token_hash_unaccepted_1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: proposal2Id,
        projectId,
        clientId,
        title: 'Declined Proposal',
        status: 'declined',
        currency: 'EUR',
        subtotalMinor: 60000,
        taxMinor: 11400,
        totalMinor: 71400,
        tokenHash: 'token_hash_unaccepted_2',
        declineReason: 'Too expensive',
        declinedAt: new Date('2026-01-05T00:00:00Z'),
        createdAt: new Date('2026-01-02T00:00:00Z'),
        updatedAt: new Date('2026-01-05T00:00:00Z'),
      },
    ]);

    // 4. Create proposal line items
    await dbClient.insert(proposalLineItems).values([
      {
        id: '01910000-0000-7000-8000-0000000000a1',
        proposalId: proposal1Id,
        itemType: 'base_package',
        name: 'Basic Portrait',
        unitPriceMinor: 50000,
        quantity: 1,
        taxRateBasisPoints: 1900,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: '01910000-0000-7000-8000-0000000000a2',
        proposalId: proposal2Id,
        itemType: 'addon',
        name: 'Extra Retouched Photos',
        unitPriceMinor: 10000,
        quantity: 1,
        taxRateBasisPoints: 1900,
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
    ]);

    // Verify records exist initially
    const initialProposals = await dbClient
      .select()
      .from(proposals)
      .where(eq(proposals.clientId, clientId));
    expect(initialProposals).toHaveLength(2);
    const initialLineItems = await dbClient.select().from(proposalLineItems);
    expect(initialLineItems).toHaveLength(2);

    // 5. Execute erasure for client
    const res = await eraseSubject(
      { kind: 'client', clientId },
      { actor: { actorType: 'owner', actorId: ownerUserId } },
      dbClient,
    );

    expect(res.success).toBe(true);
    if (!res.success) throw new Error('Expected erasure to succeed');

    // 6. Assert all proposals and line items were hard-deleted (zero orphaned database rows)
    const remainingProposals = await dbClient
      .select()
      .from(proposals)
      .where(eq(proposals.clientId, clientId));
    expect(remainingProposals).toHaveLength(0);

    const remainingLineItems = await dbClient.select().from(proposalLineItems);
    expect(remainingLineItems).toHaveLength(0);

    // Assert client itself was erased
    const remainingClient = await dbClient.select().from(clients).where(eq(clients.id, clientId));
    expect(remainingClient).toHaveLength(0);
  });

  it('AC-4: blocks erasure when an accepted proposal exists under statutory commercial hold (§147 AO, §257 HGB)', async () => {
    const clientId = '01910000-0000-7000-8000-0000000000c2';
    const contactId = '01910000-0000-7000-8000-0000000000d2';
    const projectId = '01910000-0000-7000-8000-0000000000e2';
    const acceptedProposalId = '01910000-0000-7000-8000-0000000000f3';

    // 1. Create client and contact
    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Commercial Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });

    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      givenName: 'Commercial',
      familyName: 'Buyer',
      isPrimary: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    // 2. Create project
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: defaultStageId,
      title: 'Commercial Shoot',
      projectTypeKey: 'commercial',
      currency: 'EUR',
      priceMinor: 150000,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });

    // 3. Create accepted proposal
    const acceptedAt = new Date('2026-06-15T12:00:00.000Z');
    await dbClient.insert(proposals).values({
      id: acceptedProposalId,
      projectId,
      clientId,
      title: 'Commercial Campaign Proposal',
      status: 'accepted',
      currency: 'EUR',
      subtotalMinor: 150000,
      taxMinor: 28500,
      totalMinor: 178500,
      tokenHash: 'token_hash_accepted_1',
      acceptedAt,
      acceptedByName: 'Commercial Buyer',
      acceptedByEmail: 'buyer@example.com',
      acceptanceIpAnonymized: '192.168.1.0/24',
      createdAt: new Date('2026-06-01T00:00:00Z'),
      updatedAt: acceptedAt,
    });

    // 4. Check erasure holds
    const holds = await checkErasureHolds({ kind: 'client', clientId }, dbClient);
    expect(holds.length).toBeGreaterThan(0);
    const statutoryHold = holds.find((h) => h.reason === 'statutory.commercial_document');
    expect(statutoryHold).toBeDefined();
    // 2026 acceptance year -> retainUntil 2036-12-31T23:59:59.999Z (10 years from end of calendar year per §147 AO)
    expect(statutoryHold?.retainUntil).toBe('2036-12-31T23:59:59.999Z');

    // 5. Attempt erasure and verify it is blocked
    const res = await eraseSubject(
      { kind: 'client', clientId },
      { actor: { actorType: 'owner', actorId: ownerUserId } },
      dbClient,
    );

    expect(res.success).toBe(false);
    if (res.success) throw new Error('Expected erasure to fail');
    expect(res.code).toBe('ERASURE_BLOCKED');
    if (res.code !== 'ERASURE_BLOCKED') throw new Error('Expected ERASURE_BLOCKED');
    expect(res.holds.some((h) => h.reason === 'statutory.commercial_document')).toBe(true);

    // Verify all records remain completely intact
    const clientRows = await dbClient.select().from(clients).where(eq(clients.id, clientId));
    expect(clientRows).toHaveLength(1);
    const proposalRows = await dbClient
      .select()
      .from(proposals)
      .where(eq(proposals.id, acceptedProposalId));
    expect(proposalRows).toHaveLength(1);

    // Verify privacy.erasure.blocked audit event was emitted
    const blockedEvents = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'privacy.erasure.blocked'));
    expect(blockedEvents.length).toBeGreaterThan(0);
  });

  it('AC-5: retention runner prunes unaccepted proposals older than 12 months where no project was booked and records audit event', async () => {
    const clientId = '01910000-0000-7000-8000-0000000000c3';
    const projectId = '01910000-0000-7000-8000-0000000000e3';

    // 1. Create client and project using the default inquiry stage
    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Inquiry Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      lastActivityAt: new Date('2024-01-01T00:00:00Z'),
    });

    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: defaultStageId,
      title: 'Old Unbooked Project',
      projectTypeKey: 'portrait',
      currency: 'EUR',
      priceMinor: 50000,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      lastActivityAt: new Date('2024-01-01T00:00:00Z'),
    });

    const now = new Date('2026-10-10T12:00:00.000Z');
    const fourteenMonthsAgo = new Date('2025-08-10T12:00:00.000Z');
    const sixMonthsAgo = new Date('2026-04-10T12:00:00.000Z');

    const oldExpiredProposalId = '01910000-0000-7000-8000-0000000000b1';
    const recentDraftProposalId = '01910000-0000-7000-8000-0000000000b2';

    // 2. Seed old proposal (> 12 months) and recent proposal (< 12 months)
    await dbClient.insert(proposals).values([
      {
        id: oldExpiredProposalId,
        projectId,
        clientId,
        title: 'Old Expired Proposal',
        status: 'declined',
        currency: 'EUR',
        subtotalMinor: 50000,
        taxMinor: 9500,
        totalMinor: 59500,
        tokenHash: 'token_old_expired',
        createdAt: fourteenMonthsAgo,
        updatedAt: fourteenMonthsAgo,
      },
      {
        id: recentDraftProposalId,
        projectId,
        clientId,
        title: 'Recent Draft Proposal',
        status: 'draft',
        currency: 'EUR',
        subtotalMinor: 50000,
        taxMinor: 9500,
        totalMinor: 59500,
        tokenHash: 'token_recent_draft',
        createdAt: sixMonthsAgo,
        updatedAt: sixMonthsAgo,
      },
    ]);

    await dbClient.insert(proposalLineItems).values({
      id: '01910000-0000-7000-8000-000000000081',
      proposalId: oldExpiredProposalId,
      itemType: 'base_package',
      name: 'Old Package',
      unitPriceMinor: 50000,
      quantity: 1,
      taxRateBasisPoints: 1900,
      createdAt: fourteenMonthsAgo,
      updatedAt: fourteenMonthsAgo,
    });

    // 3. Run retention sweep for unaccepted-proposals policy
    const sweepResult = await runRetentionSweep({
      policyIds: ['unaccepted-proposals'],
      client: dbClient,
      dryRun: false,
      now,
    });

    const proposalPolicyResult = sweepResult.policies.find(
      (p) => p.policyId === 'unaccepted-proposals',
    );

    expect(proposalPolicyResult).toBeDefined();
    expect(proposalPolicyResult?.scannedCount).toBe(1);
    expect(proposalPolicyResult?.deletedCount).toBe(1);

    // 4. Assert old proposal was pruned, recent proposal was preserved
    const survivingProposals = await dbClient
      .select()
      .from(proposals)
      .where(eq(proposals.clientId, clientId));
    expect(survivingProposals).toHaveLength(1);
    expect(survivingProposals[0]?.id).toBe(recentDraftProposalId);

    // Assert line items for old proposal were deleted
    const survivingLineItems = await dbClient
      .select()
      .from(proposalLineItems)
      .where(eq(proposalLineItems.proposalId, oldExpiredProposalId));
    expect(survivingLineItems).toHaveLength(0);

    // 5. Assert audit event recorded for retention sweep completion
    const sweepAuditEvents = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'retention.sweep.completed'));
    const proposalSweepEvent = sweepAuditEvents.find(
      (e) => e.metadata?.policy_id === 'unaccepted-proposals',
    );
    expect(proposalSweepEvent).toBeDefined();
    expect(proposalSweepEvent?.outcome).toBe('success');
  });
});
