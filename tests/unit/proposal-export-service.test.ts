import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import type { DbClient } from '@/server/db/client';
import { user } from '@/server/db/schema/auth';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { projects, pipelineStages } from '@/server/db/schema/projects';
import { seedDefaultPipelineStages } from '@/server/db/seeds/pipeline-stages';
import { packages, packageIncludedItems } from '@/server/db/schema/packages';
import { proposals, proposalLineItems } from '@/server/db/schema/proposals';
import { getAcceptedProposalForProject } from '@/server/proposals/service';
import { generateUuidV7 } from '@/lib/id';

describe('TASK-0060: Downstream Contract & Accounting Export Query (AC-9)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let testClientId: string;
  let testProjectId: string;
  let testPackageId: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    await seedDefaultPipelineStages(dbClient);
    const [stage] = await dbClient.select().from(pipelineStages).limit(1);
    if (!stage) throw new Error('Stage must exist');

    // Create Owner User
    await dbClient.insert(user).values({
      id: generateUuidV7(),
      name: 'Studio Owner',
      email: 'owner@example.org',
      role: 'owner',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create Client
    testClientId = generateUuidV7();
    await dbClient.insert(clients).values({
      id: testClientId,
      kind: 'person',
      displayName: 'Emma & Liam Watson',
      preferredLocale: 'en',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(clientContacts).values({
      id: generateUuidV7(),
      clientId: testClientId,
      givenName: 'Emma',
      familyName: 'Watson',
      email: 'emma@example.com',
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create Project
    testProjectId = generateUuidV7();
    await dbClient.insert(projects).values({
      id: testProjectId,
      clientId: testClientId,
      stageId: stage.id,
      title: 'Emma & Liam Wedding Shoot',
      projectTypeKey: 'wedding',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create Master Package & Included Items
    testPackageId = generateUuidV7();
    await dbClient.insert(packages).values({
      id: testPackageId,
      name: 'Full Day Master Wedding Package',
      slug: 'full-day-master',
      basePriceMinor: 250000,
      currency: 'EUR',
      taxRateBasisPoints: 1900,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(packageIncludedItems).values([
      {
        id: generateUuidV7(),
        packageId: testPackageId,
        title: '8 Hours Continuous Coverage',
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: generateUuidV7(),
        packageId: testPackageId,
        title: 'Private Online Gallery with Downloads',
        position: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-9: returns structured AcceptedProposalSummary for downstream E6 contract and E12 accounting interfaces', async () => {
    const proposalId = generateUuidV7();
    const acceptedAt = new Date('2026-10-28T14:00:00Z');

    // Insert accepted proposal
    await dbClient.insert(proposals).values({
      id: proposalId,
      projectId: testProjectId,
      clientId: testClientId,
      title: 'Wedding Proposal Emma & Liam',
      status: 'accepted',
      currency: 'EUR',
      subtotalMinor: 290000,
      taxMinor: 55100,
      totalMinor: 345100,
      tokenHash: 'dummy-sha256-hash-1',
      acceptedAt,
      acceptedByName: 'Emma Watson',
      acceptedByEmail: 'emma@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Insert line items
    await dbClient.insert(proposalLineItems).values([
      {
        id: generateUuidV7(),
        proposalId,
        packageId: testPackageId,
        itemType: 'base_package',
        name: 'Full Day Master Wedding Package',
        unitPriceMinor: 250000,
        quantity: 1,
        isSelected: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: generateUuidV7(),
        proposalId,
        itemType: 'addon',
        name: 'Second Photographer',
        unitPriceMinor: 40000,
        quantity: 1,
        isSelected: true,
        position: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: generateUuidV7(),
        proposalId,
        itemType: 'addon',
        name: 'Unselected Drone Coverage',
        unitPriceMinor: 30000,
        quantity: 1,
        isSelected: false, // not selected by client!
        position: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const summary = await getAcceptedProposalForProject(testProjectId, dbClient);

    expect(summary).toBeDefined();
    expect(summary?.proposalId).toBe(proposalId);
    expect(summary?.projectId).toBe(testProjectId);
    expect(summary?.packageName).toBe('Full Day Master Wedding Package');
    expect(summary?.includedItems).toEqual([
      '8 Hours Continuous Coverage',
      'Private Online Gallery with Downloads',
    ]);
    expect(summary?.selectedAddons).toHaveLength(1);
    expect(summary?.selectedAddons[0]).toEqual({
      name: 'Second Photographer',
      quantity: 1,
      unitPriceMinor: 40000,
    });
    expect(summary?.subtotalMinor).toBe(290000);
    expect(summary?.taxMinor).toBe(55100);
    expect(summary?.totalMinor).toBe(345100);
    expect(summary?.currency).toBe('EUR');
    expect(summary?.acceptedAt).toEqual(acceptedAt);
    expect(summary?.acceptedByName).toBe('Emma Watson');
    expect(summary?.acceptedByEmail).toBe('emma@example.com');
  });

  it('AC-9: returns null when project has no accepted proposal', async () => {
    // Project with only a draft proposal
    await dbClient.insert(proposals).values({
      id: generateUuidV7(),
      projectId: testProjectId,
      clientId: testClientId,
      title: 'Draft Proposal',
      status: 'draft',
      currency: 'EUR',
      tokenHash: 'dummy-sha256-hash-draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const summary = await getAcceptedProposalForProject(testProjectId, dbClient);
    expect(summary).toBeNull();
  });

  it('AC-9: handles custom base package with no master package reference', async () => {
    const proposalId = generateUuidV7();

    await dbClient.insert(proposals).values({
      id: proposalId,
      projectId: testProjectId,
      clientId: testClientId,
      title: 'Custom Commercial Proposal',
      status: 'accepted',
      currency: 'EUR',
      subtotalMinor: 150000,
      taxMinor: 28500,
      totalMinor: 178500,
      tokenHash: 'dummy-sha256-hash-custom',
      acceptedAt: new Date(),
      acceptedByName: 'Corporate Liaison',
      acceptedByEmail: 'corp@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(proposalLineItems).values({
      id: generateUuidV7(),
      proposalId,
      packageId: null, // custom package without catalogue reference
      itemType: 'base_package',
      name: 'Custom Studio Branding Shoot',
      unitPriceMinor: 150000,
      quantity: 1,
      isSelected: true,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const summary = await getAcceptedProposalForProject(testProjectId, dbClient);

    expect(summary).toBeDefined();
    expect(summary?.packageName).toBe('Custom Studio Branding Shoot');
    expect(summary?.includedItems).toEqual([]);
    expect(summary?.totalMinor).toBe(178500);
  });

  it('AC-9: handles fallback values when accepted proposal has no base package item or nullable acceptance details', async () => {
    const proposalId = generateUuidV7();
    const now = new Date();

    await dbClient.insert(proposals).values({
      id: proposalId,
      projectId: testProjectId,
      clientId: testClientId,
      title: 'A La Carte Only Proposal',
      status: 'accepted',
      currency: 'EUR',
      subtotalMinor: 50000,
      taxMinor: 9500,
      totalMinor: 59500,
      tokenHash: 'dummy-sha256-hash-alacarte',
      acceptedAt: null,
      acceptedByName: null,
      acceptedByEmail: null,
      createdAt: now,
      updatedAt: now,
    });

    const summary = await getAcceptedProposalForProject(testProjectId, dbClient);

    expect(summary).toBeDefined();
    expect(summary?.packageName).toBe('A La Carte Only Proposal');
    expect(summary?.includedItems).toEqual([]);
    expect(summary?.acceptedByName).toBe('');
    expect(summary?.acceptedByEmail).toBe('');
    expect(summary?.acceptedAt).toEqual(now);
  });
});
