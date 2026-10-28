import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import type { DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';
import { type AuthContext } from '@/server/auth/guards';
import { UnauthenticatedError } from '@/server/auth/repo-auth';
import { proposalLineItems } from '@/server/db/schema/proposals';
import { packages, catalogueItems } from '@/server/db/schema/packages';
import { clients } from '@/server/db/schema/clients';
import { pipelineStages, projects } from '@/server/db/schema/projects';
import { clientTimelineEvents } from '@/server/db/schema/timeline';
import { auditEvents } from '@/server/db/schema/audit';
import {
  createProposal,
  getProposalById,
  getProposalByTokenHash,
  getProposalByRawToken,
  listProposalsByProject,
  updateProposal,
  setProposalLineItems,
  transitionProposalStatus,
  revokeProposalToken,
  ProposalForbiddenError,
  ProposalNotFoundError,
  ProposalImmutableError,
} from '@/server/proposals/repo';
import { eq } from 'drizzle-orm';
import { seedDefaultPipelineStages } from '@/server/db/seeds/pipeline-stages';

describe('TASK-0058: Proposals Repository Integration Tests (AC-1, AC-5, AC-6, AC-7, AC-9)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  const ownerAuth: AuthContext = {
    user: {
      id: '01920000-0000-7000-8000-000000000001',
      name: 'Studio Owner',
      email: 'owner@example.com',
      emailVerified: true,
      image: null,
      role: 'owner',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    authType: 'session',
    scopes: ['*'],
  };

  const clientAuth: AuthContext = {
    user: {
      id: '01920000-0000-7000-8000-000000000002',
      name: 'Client User',
      email: 'client@example.com',
      emailVerified: true,
      image: null,
      role: 'client',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    authType: 'session',
    scopes: ['*'],
  };

  let testClientId: string;
  let otherClientId: string;
  let testProjectId: string;
  let testPackageId: string;
  let testCatalogueItemId: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    await seedDefaultPipelineStages(dbClient);

    const now = new Date();

    // 1. Create test clients
    const [c1] = (await dbClient
      .insert(clients)
      .values({
        kind: 'person',
        displayName: 'Emma Watson',
        preferredLocale: 'en',
        createdAt: now,
        updatedAt: now,
      })
      .returning()) as [typeof clients.$inferSelect];
    testClientId = c1.id;

    const [c2] = (await dbClient
      .insert(clients)
      .values({
        kind: 'person',
        displayName: 'Other Client',
        preferredLocale: 'en',
        createdAt: now,
        updatedAt: now,
      })
      .returning()) as [typeof clients.$inferSelect];
    otherClientId = c2.id;

    // 2. Create test project for testClientId
    const [stage] = (await dbClient.select().from(pipelineStages).limit(1)) as [
      typeof pipelineStages.$inferSelect,
    ];
    const [p1] = (await dbClient
      .insert(projects)
      .values({
        clientId: testClientId,
        stageId: stage.id,
        title: 'Emma & Liam Wedding',
        projectTypeKey: 'wedding',
        currency: 'EUR',
        createdAt: now,
        updatedAt: now,
      })
      .returning()) as [typeof projects.$inferSelect];
    testProjectId = p1.id;

    // 3. Create test package
    const [pkg] = (await dbClient
      .insert(packages)
      .values({
        name: 'Full Day Wedding Coverage',
        slug: 'wedding-full-day',
        description: 'Comprehensive wedding coverage',
        basePriceMinor: 280000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()) as [typeof packages.$inferSelect];
    testPackageId = pkg.id;

    // 4. Create test catalogue item
    const [item] = (await dbClient
      .insert(catalogueItems)
      .values({
        name: 'Extra Hour Coverage',
        slug: 'extra-hour-coverage',
        category: 'service',
        unitPriceMinor: 25000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()) as [typeof catalogueItems.$inferSelect];
    testCatalogueItemId = item.id;
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  // AC-1
  describe('AC-1: Proposal Creation with Deep Copy Snapshots', () => {
    it('AC-1: creates proposal and line items in a single transaction with generated UUIDv7, draft status, and token hash', async () => {
      const created = await createProposal(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Wedding Photography Proposal',
          currency: 'EUR',
          pricesIncludeTax: true,
          isKleinunternehmer: false,
          lineItems: [
            {
              packageId: testPackageId,
              itemType: 'base_package',
              name: 'Full Day Wedding Coverage',
              description: '8 Hours continuous coverage',
              unitPriceMinor: 280000,
              quantity: 1,
              taxRateBasisPoints: 1900,
              isOptional: false,
              isSelected: true,
            },
            {
              catalogueItemId: testCatalogueItemId,
              itemType: 'addon',
              name: 'Extra Hour Coverage',
              description: '1 additional shooting hour',
              unitPriceMinor: 25000,
              quantity: 1,
              taxRateBasisPoints: 1900,
              isOptional: true,
              isSelected: true,
            },
          ],
        },
        ownerAuth,
        dbClient,
      );

      expect(created.id).toBeDefined();
      expect(created.status).toBe('draft');
      expect(created.version).toBe(1);
      expect(created.rawToken).toBeDefined();
      expect(created.tokenHash).toHaveLength(64);
      expect(created.totalMinor).toBe(305000); // 280000 + 25000
      expect(created.lineItems).toHaveLength(2);

      // Verify line items persisted in database
      const dbItems = await dbClient
        .select()
        .from(proposalLineItems)
        .where(eq(proposalLineItems.proposalId, created.id));
      expect(dbItems).toHaveLength(2);

      // Verify audit event emitted
      const auditRows = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'proposal.created'));
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      expect(auditRows[0]?.targetId).toBe(created.id);
    });
  });

  // AC-5
  describe('AC-5: Updating Proposal Line Items and Recalculating Totals', () => {
    it('AC-5: replaces line items on draft proposal, recalculates totals, and persists them', async () => {
      const created = await createProposal(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Initial Proposal',
          pricesIncludeTax: true,
          isKleinunternehmer: false,
          lineItems: [
            {
              name: 'Original Item',
              unitPriceMinor: 10000,
              quantity: 1,
              taxRateBasisPoints: 1900,
            },
          ],
        },
        ownerAuth,
        dbClient,
      );
      expect(created.totalMinor).toBe(10000);

      // Update line items to two new items
      const updated = await setProposalLineItems(
        created.id,
        [
          {
            name: 'Upgraded Package',
            unitPriceMinor: 200000,
            quantity: 1,
            taxRateBasisPoints: 1900,
            itemType: 'base_package',
            isSelected: true,
          },
          {
            name: 'Fine Art Print Box',
            unitPriceMinor: 30000,
            quantity: 2,
            taxRateBasisPoints: 1900,
            itemType: 'addon',
            isSelected: true,
          },
        ],
        ownerAuth,
        dbClient,
      );

      expect(updated.lineItems).toHaveLength(2);
      expect(updated.totalMinor).toBe(260000); // 200000 + (30000 * 2)
      expect(updated.subtotalMinor).toBe(260000);

      // Verify database reflects updated items
      const dbProposal = await getProposalById(created.id, ownerAuth, dbClient);
      expect(dbProposal?.totalMinor).toBe(260000);
      expect(dbProposal?.lineItems).toHaveLength(2);
      expect(dbProposal?.lineItems.find((i) => i.name === 'Original Item')).toBeUndefined();
    });
  });

  // AC-6
  describe('AC-6: Transition to Accepted & Immutability Enforcement', () => {
    it('AC-6: stores accepted_options_snapshot and permanently locks accepted proposal against edits', async () => {
      const created = await createProposal(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Proposal to Accept',
          pricesIncludeTax: true,
          isKleinunternehmer: false,
          lineItems: [
            {
              name: 'Full Day Package',
              unitPriceMinor: 250000,
              quantity: 1,
              taxRateBasisPoints: 1900,
              itemType: 'base_package',
              isSelected: true,
            },
            {
              name: 'Album Addon',
              unitPriceMinor: 50000,
              quantity: 1,
              taxRateBasisPoints: 1900,
              itemType: 'addon',
              isSelected: true,
            },
          ],
        },
        ownerAuth,
        dbClient,
      );

      // Transition to accepted
      const accepted = await transitionProposalStatus(
        created.id,
        {
          newStatus: 'accepted',
          acceptedByName: 'Emma Watson',
          acceptedByEmail: 'emma@example.com',
          acceptanceIpAnonymized: '192.168.1.0',
          acceptanceUserAgent: 'Mozilla/5.0 Playwright',
        },
        ownerAuth,
        dbClient,
      );

      expect(accepted.status).toBe('accepted');
      expect(accepted.acceptedAt).toBeInstanceOf(Date);
      expect(accepted.acceptedByName).toBe('Emma Watson');
      expect(accepted.acceptedOptionsSnapshot).toBeDefined();
      expect(accepted.acceptedOptionsSnapshot?.totalMinor).toBe(300000);
      expect(accepted.acceptedOptionsSnapshot?.items).toHaveLength(2);

      // Verify project price was synchronized
      const [proj] = await dbClient.select().from(projects).where(eq(projects.id, testProjectId));
      expect(proj?.priceMinor).toBe(300000);

      // Verify relationship timeline recorded proposal.accepted event
      const timelineEvents = await dbClient
        .select()
        .from(clientTimelineEvents)
        .where(eq(clientTimelineEvents.type, 'proposal.accepted'));
      expect(timelineEvents).toHaveLength(1);
      expect(timelineEvents[0]?.clientId).toBe(testClientId);

      // I1-S01: regression - audit log must NOT record customer name in metadata
      const acceptedAudit = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'proposal.accepted'));
      expect(acceptedAudit).toHaveLength(1);
      expect(acceptedAudit[0]?.metadata).toEqual(
        expect.objectContaining({
          proposal_id: created.id,
          total_minor: 300000,
        }),
      );
      expect(acceptedAudit[0]?.metadata).not.toHaveProperty('accepted_by_name');

      // AC-6 Immutability: attempting to modify line items must throw ProposalImmutableError
      await expect(
        setProposalLineItems(
          created.id,
          [{ name: 'Tampered Item', unitPriceMinor: 100, quantity: 1, taxRateBasisPoints: 1900 }],
          ownerAuth,
          dbClient,
        ),
      ).rejects.toThrow(ProposalImmutableError);

      // AC-6 Immutability: attempting to update proposal metadata must throw ProposalImmutableError
      await expect(
        updateProposal(created.id, { title: 'Tampered Title' }, ownerAuth, dbClient),
      ).rejects.toThrow(ProposalImmutableError);

      // AC-6 Immutability: attempting to re-transition from accepted must throw ProposalImmutableError
      await expect(
        transitionProposalStatus(
          created.id,
          { newStatus: 'declined', declineReason: 'Change mind' },
          ownerAuth,
          dbClient,
        ),
      ).rejects.toThrow(ProposalImmutableError);
    });
  });

  // AC-7
  describe('AC-7: Referential Decoupling from Master Catalogue Updates', () => {
    it('AC-7: does not alter proposal line items when master package or catalogue item price increases', async () => {
      // 1. Create proposal referencing master package at 280000 cents (€2800)
      const created = await createProposal(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Decoupled Proposal',
          lineItems: [
            {
              packageId: testPackageId,
              itemType: 'base_package',
              name: 'Full Day Wedding Coverage',
              unitPriceMinor: 280000,
              quantity: 1,
              taxRateBasisPoints: 1900,
            },
            {
              catalogueItemId: testCatalogueItemId,
              itemType: 'addon',
              name: 'Extra Hour Coverage',
              unitPriceMinor: 25000,
              quantity: 1,
              taxRateBasisPoints: 1900,
            },
          ],
        },
        ownerAuth,
        dbClient,
      );

      // 2. Update master package price in catalogue from 280000 to 350000 cents (€3500)
      await dbClient
        .update(packages)
        .set({ basePriceMinor: 350000 })
        .where(eq(packages.id, testPackageId));

      // 3. Update master catalogue item price from 25000 to 35000 cents (€350)
      await dbClient
        .update(catalogueItems)
        .set({ unitPriceMinor: 35000 })
        .where(eq(catalogueItems.id, testCatalogueItemId));

      // 4. Re-fetch proposal from database
      const refetched = await getProposalById(created.id, ownerAuth, dbClient);

      expect(refetched).toBeDefined();
      const pkgItem = refetched?.lineItems.find((i) => i.itemType === 'base_package');
      const addonItem = refetched?.lineItems.find((i) => i.itemType === 'addon');

      // Proposal line items MUST remain immutably fixed at original snapshot price
      expect(pkgItem?.unitPriceMinor).toBe(280000);
      expect(addonItem?.unitPriceMinor).toBe(25000);
      expect(refetched?.totalMinor).toBe(305000);
    });
  });

  // AC-9
  describe('AC-9: Authentication and Authorization Boundary Enforcement', () => {
    it('AC-9: rejects unauthenticated caller with UNAUTHENTICATED', async () => {
      await expect(
        createProposal(
          {
            projectId: testProjectId,
            clientId: testClientId,
            title: 'Unauthenticated Proposal',
          },
          undefined, // no auth
          dbClient,
        ),
      ).rejects.toThrow(UnauthenticatedError);
    });

    it('AC-9: rejects non-owner role with UNAUTHENTICATED', async () => {
      await expect(
        createProposal(
          {
            projectId: testProjectId,
            clientId: testClientId,
            title: 'Client Role Proposal',
          },
          clientAuth, // role = client
          dbClient,
        ),
      ).rejects.toThrow(UnauthenticatedError);
    });

    it('AC-9: rejects invalid project/client relationship with FORBIDDEN', async () => {
      // Trying to attach a proposal to testProjectId with a different client ID
      await expect(
        createProposal(
          {
            projectId: testProjectId,
            clientId: otherClientId, // mismatched client!
            title: 'Mismatched Client Proposal',
          },
          ownerAuth,
          dbClient,
        ),
      ).rejects.toThrow(ProposalForbiddenError);
    });
  });

  // Retrieval, listing, and token operations
  describe('Proposal Retrieval, Token Verification & Revocation', () => {
    it('resolves proposal by token hash and raw token', async () => {
      const created = await createProposal(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Token Resolvable Proposal',
          internalNotes: 'Top secret studio pricing strategy',
          lineItems: [
            {
              name: 'Session Package',
              unitPriceMinor: 150000,
              quantity: 1,
              taxRateBasisPoints: 1900,
            },
          ],
        },
        ownerAuth,
        dbClient,
      );

      // Public lookup by token hash
      const byHash = await getProposalByTokenHash(created.tokenHash, dbClient);
      expect(byHash).toBeDefined();
      expect(byHash?.id).toBe(created.id);
      expect(byHash?.lineItems).toHaveLength(1);
      // I1-S04: regression - internalNotes must be redacted to null on public token lookup
      expect(byHash?.internalNotes).toBeNull();

      // Public lookup by raw token
      const byRaw = await getProposalByRawToken(created.rawToken, dbClient);
      expect(byRaw).toBeDefined();
      expect(byRaw?.id).toBe(created.id);
      expect(byRaw?.internalNotes).toBeNull();

      // Owner lookup must still preserve full internalNotes
      const byOwner = await getProposalById(created.id, ownerAuth, dbClient);
      expect(byOwner?.internalNotes).toBe('Top secret studio pricing strategy');
    });

    it('lists proposals by project ordered newest first', async () => {
      const p1 = await createProposal(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'First Proposal',
          lineItems: [
            {
              name: 'Item 1',
              unitPriceMinor: 1000,
              quantity: 1,
              taxRateBasisPoints: 1900,
            },
            {
              name: 'Item 2',
              unitPriceMinor: 2000,
              quantity: 1,
              taxRateBasisPoints: 1900,
            },
          ],
        },
        ownerAuth,
        dbClient,
      );

      const p2 = await createProposal(
        { projectId: testProjectId, clientId: testClientId, title: 'Second Proposal' },
        ownerAuth,
        dbClient,
      );

      const list = await listProposalsByProject(testProjectId, ownerAuth, dbClient);
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list[0]?.id).toBe(p2.id); // newest first
      expect(list[1]?.id).toBe(p1.id);
    });

    it('revokes secret token and invalidates old token', async () => {
      const created = await createProposal(
        { projectId: testProjectId, clientId: testClientId, title: 'Token To Revoke' },
        ownerAuth,
        dbClient,
      );

      const initialToken = created.rawToken;
      const initialHash = created.tokenHash;

      // Revoke token
      const revoked = await revokeProposalToken(created.id, ownerAuth, dbClient);
      expect(revoked.rawToken).not.toBe(initialToken);
      expect(revoked.proposal.tokenHash).not.toBe(initialHash);

      // Old raw token should now fail resolution
      const resolvedOld = await getProposalByRawToken(initialToken, dbClient);
      expect(resolvedOld).toBeNull();

      // New token resolves proposal
      const resolvedNew = await getProposalByRawToken(revoked.rawToken, dbClient);
      expect(resolvedNew).toBeDefined();
      expect(resolvedNew?.id).toBe(created.id);
    });

    it('records sent and declined timeline events on status transitions', async () => {
      const created = await createProposal(
        { projectId: testProjectId, clientId: testClientId, title: 'Timeline Test' },
        ownerAuth,
        dbClient,
      );

      // Transition to sent
      const sent = await transitionProposalStatus(
        created.id,
        { newStatus: 'sent' },
        ownerAuth,
        dbClient,
      );
      expect(sent.status).toBe('sent');
      expect(sent.sentAt).toBeInstanceOf(Date);

      const sentEvents = await dbClient
        .select()
        .from(clientTimelineEvents)
        .where(eq(clientTimelineEvents.type, 'proposal.sent'));
      expect(sentEvents.length).toBeGreaterThanOrEqual(1);

      // Transition to declined
      const declined = await transitionProposalStatus(
        created.id,
        { newStatus: 'declined', declineReason: 'Budget constraints' },
        ownerAuth,
        dbClient,
      );
      expect(declined.status).toBe('declined');
      expect(declined.declinedAt).toBeInstanceOf(Date);
      expect(declined.declineReason).toBe('Budget constraints');

      const declinedEvents = await dbClient
        .select()
        .from(clientTimelineEvents)
        .where(eq(clientTimelineEvents.type, 'proposal.declined'));
      expect(declinedEvents.length).toBeGreaterThanOrEqual(1);

      // I1-S02: regression - audit log must record has_decline_reason boolean, NOT raw free-text decline_reason
      const declinedAudit = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'proposal.declined'));
      expect(declinedAudit.length).toBeGreaterThanOrEqual(1);
      expect(declinedAudit[0]?.metadata).toEqual(
        expect.objectContaining({
          has_decline_reason: true,
        }),
      );
      expect(declinedAudit[0]?.metadata).not.toHaveProperty('decline_reason');
    });

    it('handles not found and empty list conditions gracefully', async () => {
      const nonExistentId = '01920000-0000-7000-8000-999999999999';

      expect(await getProposalById(nonExistentId, ownerAuth, dbClient)).toBeNull();
      expect(await getProposalByTokenHash('non-existent-hash', dbClient)).toBeNull();
      expect(await listProposalsByProject(nonExistentId, ownerAuth, dbClient)).toEqual([]);

      await expect(
        updateProposal(nonExistentId, { title: 'Test' }, ownerAuth, dbClient),
      ).rejects.toThrow(ProposalNotFoundError);

      await expect(setProposalLineItems(nonExistentId, [], ownerAuth, dbClient)).rejects.toThrow(
        ProposalNotFoundError,
      );

      await expect(
        transitionProposalStatus(nonExistentId, { newStatus: 'sent' }, ownerAuth, dbClient),
      ).rejects.toThrow(ProposalNotFoundError);

      await expect(revokeProposalToken(nonExistentId, ownerAuth, dbClient)).rejects.toThrow(
        ProposalNotFoundError,
      );
    });

    it('rejects proposal creation when projectId does not exist in database', async () => {
      const nonExistentProjectId = '01920000-0000-7000-8000-999999999999';

      await expect(
        createProposal(
          {
            projectId: nonExistentProjectId,
            clientId: testClientId,
            title: 'No Project Proposal',
          },
          ownerAuth,
          dbClient,
        ),
      ).rejects.toThrow(ProposalForbiddenError);
    });

    it('updates proposal metadata and recalculates totals when pricesIncludeTax changes', async () => {
      const created = await createProposal(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Tax Toggle Proposal',
          pricesIncludeTax: true,
          lineItems: [
            {
              name: 'Package',
              unitPriceMinor: 11900,
              quantity: 1,
              taxRateBasisPoints: 1900,
            },
          ],
        },
        ownerAuth,
        dbClient,
      );

      expect(created.totalMinor).toBe(11900);
      expect(created.taxMinor).toBe(1900);

      const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const updated = await updateProposal(
        created.id,
        {
          title: 'Updated Title',
          currency: 'USD',
          pricesIncludeTax: false,
          validUntil,
          internalNotes: 'Client requested Net pricing',
          taxNotice: 'Custom tax notice',
        },
        ownerAuth,
        dbClient,
      );

      expect(updated.title).toBe('Updated Title');
      expect(updated.currency).toBe('USD');
      expect(updated.pricesIncludeTax).toBe(false);
      expect(updated.taxNotice).toBe('Custom tax notice');
      expect(updated.subtotalMinor).toBe(11900);
      expect(updated.taxMinor).toBe(Math.round((11900 * 1900) / 10000));
      expect(updated.totalMinor).toBe(11900 + updated.taxMinor);
    });

    it('transitions to expired and then superseded, and supports selectedLineItemIds on acceptance', async () => {
      const created = await createProposal(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Lifecycle Proposal',
          lineItems: [
            {
              name: 'Base Package',
              itemType: 'base_package',
              unitPriceMinor: 200000,
              quantity: 1,
              taxRateBasisPoints: 1900,
              isSelected: true,
            },
            {
              name: 'Optional Second Shooter',
              itemType: 'addon',
              unitPriceMinor: 50000,
              quantity: 1,
              taxRateBasisPoints: 1900,
              isSelected: true,
            },
          ],
        },
        ownerAuth,
        dbClient,
      );

      // Sent -> Expired -> Superseded
      await transitionProposalStatus(created.id, { newStatus: 'sent' }, ownerAuth, dbClient);
      const expired = await transitionProposalStatus(
        created.id,
        { newStatus: 'expired' },
        ownerAuth,
        dbClient,
      );
      expect(expired.status).toBe('expired');

      const superseded = await transitionProposalStatus(
        created.id,
        { newStatus: 'superseded' },
        ownerAuth,
        dbClient,
      );
      expect(superseded.status).toBe('superseded');

      // Now create another proposal to test selective acceptance
      const p2 = await createProposal(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Selective Acceptance Proposal',
          lineItems: [
            {
              name: 'Base Deliverable',
              itemType: 'base_package',
              unitPriceMinor: 100000,
              quantity: 1,
              taxRateBasisPoints: 1900,
              isSelected: true,
            },
            {
              name: 'Addon Deliverable',
              itemType: 'addon',
              unitPriceMinor: 40000,
              quantity: 1,
              taxRateBasisPoints: 1900,
              isSelected: true,
            },
          ],
        },
        ownerAuth,
        dbClient,
      );

      const baseItem = p2.lineItems.find((i) => i.itemType === 'base_package');
      expect(baseItem).toBeDefined();
      const baseItemId = baseItem ? baseItem.id : '';

      // Client accepts ONLY base package (omits addon from selectedLineItemIds)
      const accepted = await transitionProposalStatus(
        p2.id,
        {
          newStatus: 'accepted',
          acceptedByName: 'Selective Emma',
          selectedLineItemIds: [baseItemId],
        },
        ownerAuth,
        dbClient,
      );

      expect(accepted.status).toBe('accepted');
      expect(accepted.totalMinor).toBe(100000); // 40000 addon was deselected!
      expect(accepted.acceptedOptionsSnapshot?.items).toHaveLength(1);
      expect(accepted.acceptedOptionsSnapshot?.items[0]?.name).toBe('Base Deliverable');
    });

    it('supports options object { auth, client } in createProposal', async () => {
      const created = await createProposal(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Options Object Proposal',
        },
        { auth: ownerAuth, client: dbClient },
      );

      expect(created.id).toBeDefined();
      expect(created.title).toBe('Options Object Proposal');
    });

    it('supports apiKey auth context (emits token actorType)', async () => {
      const apiKeyAuth: AuthContext = {
        authType: 'apiKey',
        apiKey: {
          id: '01920000-0000-7000-8000-000000000099',
          userId: ownerAuth.user.id,
          name: 'Test Key',
          prefix: 'ownlight_live_',
          tokenHash: 'hash',
          scopes: ['*'],
          expiresAt: null,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        user: { ...ownerAuth.user, role: 'owner' },
        scopes: ['*'],
      };

      const created = await createProposal(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'API Key Auth Proposal',
        },
        apiKeyAuth,
        dbClient,
      );

      expect(created.id).toBeDefined();

      const sent = await transitionProposalStatus(
        created.id,
        { newStatus: 'sent' },
        apiKeyAuth,
        dbClient,
      );
      expect(sent.status).toBe('sent');

      const declined = await transitionProposalStatus(
        created.id,
        { newStatus: 'declined', declineReason: 'Too expensive' },
        apiKeyAuth,
        dbClient,
      );
      expect(declined.status).toBe('declined');
    });

    it('handles explicit item id and position and empty line items', async () => {
      const customItemId = generateUuidV7();
      const pWithCustom = await createProposal(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Custom Item ID Proposal',
          lineItems: [
            {
              id: customItemId,
              itemType: 'custom',
              name: 'Custom Line',
              unitPriceMinor: 5000,
              quantity: 2,
              taxRateBasisPoints: 1900,
              position: 5,
            },
          ],
        },
        ownerAuth,
        dbClient,
      );

      expect(pWithCustom.lineItems[0]?.id).toBe(customItemId);
      expect(pWithCustom.lineItems[0]?.position).toBe(5);

      const customSetId = generateUuidV7();
      const updatedItems = await setProposalLineItems(
        pWithCustom.id,
        [
          {
            id: customSetId,
            itemType: 'custom',
            name: 'Updated Custom Line',
            unitPriceMinor: 6000,
            quantity: 1,
            taxRateBasisPoints: 1900,
            position: 10,
          },
        ],
        ownerAuth,
        dbClient,
      );
      expect(updatedItems.lineItems[0]?.id).toBe(customSetId);
      expect(updatedItems.lineItems[0]?.position).toBe(10);

      const emptyItems = await setProposalLineItems(pWithCustom.id, [], ownerAuth, dbClient);
      expect(emptyItems.lineItems).toHaveLength(0);
      expect(emptyItems.totalMinor).toBe(0);
    });

    it('updates tax settings and recalculates totals', async () => {
      const created = await createProposal(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Tax Toggle Proposal',
          pricesIncludeTax: false,
          isKleinunternehmer: false,
          lineItems: [
            {
              name: 'Service',
              unitPriceMinor: 10000,
              quantity: 1,
              taxRateBasisPoints: 1900,
            },
          ],
        },
        ownerAuth,
        dbClient,
      );

      expect(created.taxMinor).toBe(1900);
      expect(created.totalMinor).toBe(11900);

      const updated = await updateProposal(
        created.id,
        {
          isKleinunternehmer: true,
          pricesIncludeTax: true,
          taxNotice: 'Kleinunternehmer gem. § 19 UStG',
          internalNotes: 'Notes',
        },
        ownerAuth,
        dbClient,
      );

      expect(updated.isKleinunternehmer).toBe(true);
      expect(updated.taxMinor).toBe(0);
      expect(updated.totalMinor).toBe(10000);
    });
  });
});
