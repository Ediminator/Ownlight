import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { DbClient } from '@/server/db/client';
import { proposals, proposalLineItems } from '@/server/db/schema/proposals';
import { clients } from '@/server/db/schema/clients';
import { pipelineStages, projects } from '@/server/db/schema/projects';
import { packages, catalogueItems } from '@/server/db/schema/packages';
import { seedDefaultPipelineStages } from './pipeline-stages';
import { seedPackagesAndCatalogue } from './packages';

export const SEED_CLIENT_ID = '01920000-0000-7000-8000-000000000081';
export const SEED_PROJECT_ID = '01920000-0000-7000-8000-000000000071';

export const SEED_PROPOSAL_DRAFT_ID = '01920000-0000-7000-8000-000000000201';
export const SEED_PROPOSAL_SENT_ID = '01920000-0000-7000-8000-000000000202';
export const SEED_PROPOSAL_ACCEPTED_ID = '01920000-0000-7000-8000-000000000203';

export interface SeedProposalsResult {
  seededProposals: number;
  seededLineItems: number;
}

/**
 * Synthetic seed script for proposals (TASK-0058 / ADR-0018).
 * Seeds sample proposals in draft, sent, and accepted states idempotently.
 */
export async function seedProposals(tx: DbClient): Promise<SeedProposalsResult> {
  const now = new Date();

  // 1. Ensure pipeline stages and packages exist
  await seedDefaultPipelineStages(tx);
  await seedPackagesAndCatalogue(tx);

  // 2. Ensure client exists
  const [existingClient] = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, SEED_CLIENT_ID))
    .limit(1);

  let clientId = existingClient?.id;
  if (!clientId) {
    const [insertedClient] = await tx
      .insert(clients)
      .values({
        id: SEED_CLIENT_ID,
        kind: 'person',
        displayName: 'Emma Watson',
        preferredLocale: 'en',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    clientId = insertedClient?.id ?? SEED_CLIENT_ID;
  }

  // 3. Ensure project exists
  const [existingProject] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, SEED_PROJECT_ID))
    .limit(1);

  let projectId = existingProject?.id;
  if (!projectId) {
    const [stage] = await tx.select({ id: pipelineStages.id }).from(pipelineStages).limit(1);

    const stageId = stage?.id ?? '01920000-0000-7000-8000-000000000001';

    const [insertedProject] = await tx
      .insert(projects)
      .values({
        id: SEED_PROJECT_ID,
        clientId,
        stageId,
        title: 'Emma & Liam Wedding',
        projectTypeKey: 'wedding',
        currency: 'EUR',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    projectId = insertedProject?.id ?? SEED_PROJECT_ID;
  }

  // Fetch package and catalogue items for reference
  const [weddingPkg] = await tx
    .select()
    .from(packages)
    .where(eq(packages.slug, 'wedding-full-day'))
    .limit(1);

  const [extraHourItem] = await tx
    .select()
    .from(catalogueItems)
    .where(eq(catalogueItems.slug, 'extra-hour-coverage'))
    .limit(1);

  const [albumItem] = await tx
    .select()
    .from(catalogueItems)
    .where(eq(catalogueItems.slug, 'fine-art-album-30x30'))
    .limit(1);

  let seededProposals = 0;
  let seededLineItems = 0;

  // Proposal 1: DRAFT
  const [draftExists] = await tx
    .select({ id: proposals.id })
    .from(proposals)
    .where(eq(proposals.id, SEED_PROPOSAL_DRAFT_ID))
    .limit(1);

  if (!draftExists) {
    const rawToken = 'demo-token-draft-proposal-seed-32bytes-secret';
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    await tx.insert(proposals).values({
      id: SEED_PROPOSAL_DRAFT_ID,
      projectId,
      clientId,
      title: 'Wedding Photography Proposal — Emma & Liam (Draft)',
      status: 'draft',
      version: 1,
      currency: 'EUR',
      subtotalMinor: 280000,
      taxMinor: 44706,
      totalMinor: 280000,
      pricesIncludeTax: true,
      isKleinunternehmer: false,
      tokenHash,
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    seededProposals++;

    // Add draft line items
    await tx.insert(proposalLineItems).values([
      {
        id: '01920000-0000-7000-8000-000000000211',
        proposalId: SEED_PROPOSAL_DRAFT_ID,
        packageId: weddingPkg?.id ?? null,
        catalogueItemId: null,
        itemType: 'base_package',
        name: weddingPkg?.name ?? 'Full Day Wedding Coverage',
        description: weddingPkg?.description ?? '8 Hours continuous coverage',
        unitPriceMinor: weddingPkg?.basePriceMinor ?? 280000,
        quantity: 1,
        minQuantity: 1,
        maxQuantity: 1,
        taxRateBasisPoints: 1900,
        isOptional: false,
        isSelected: true,
        position: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '01920000-0000-7000-8000-000000000212',
        proposalId: SEED_PROPOSAL_DRAFT_ID,
        packageId: null,
        catalogueItemId: albumItem?.id ?? null,
        itemType: 'addon',
        name: albumItem?.name ?? 'Fine Art Leather Album 30x30',
        description: albumItem?.description ?? 'Handmade leather flush-mount album',
        unitPriceMinor: albumItem?.unitPriceMinor ?? 55000,
        quantity: 1,
        minQuantity: 0,
        maxQuantity: 2,
        taxRateBasisPoints: 1900,
        isOptional: true,
        isSelected: false,
        position: 2,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    seededLineItems += 2;
  } else {
    seededProposals++;
    seededLineItems += 2;
  }

  // Proposal 2: SENT
  const [sentExists] = await tx
    .select({ id: proposals.id })
    .from(proposals)
    .where(eq(proposals.id, SEED_PROPOSAL_SENT_ID))
    .limit(1);

  if (!sentExists) {
    const rawToken = 'demo-token-sent-proposal-seed-32bytes-secret';
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const sentAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const validUntil = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);

    // 280000 + 25000 = 305000 Gross
    // Net = Math.round(305000 * 10000 / 11900) = 256303
    // Tax = 305000 - 256303 = 48697
    await tx.insert(proposals).values({
      id: SEED_PROPOSAL_SENT_ID,
      projectId,
      clientId,
      title: 'Wedding Coverage & Add-on — Emma & Liam',
      status: 'sent',
      version: 1,
      currency: 'EUR',
      subtotalMinor: 305000,
      taxMinor: 48697,
      totalMinor: 305000,
      pricesIncludeTax: true,
      isKleinunternehmer: false,
      tokenHash,
      sentAt,
      validUntil,
      createdAt: sentAt,
      updatedAt: sentAt,
    });
    seededProposals++;

    await tx.insert(proposalLineItems).values([
      {
        id: '01920000-0000-7000-8000-000000000221',
        proposalId: SEED_PROPOSAL_SENT_ID,
        packageId: weddingPkg?.id ?? null,
        catalogueItemId: null,
        itemType: 'base_package',
        name: weddingPkg?.name ?? 'Full Day Wedding Coverage',
        description: weddingPkg?.description ?? '8 Hours continuous coverage',
        unitPriceMinor: 280000,
        quantity: 1,
        minQuantity: 1,
        maxQuantity: 1,
        taxRateBasisPoints: 1900,
        isOptional: false,
        isSelected: true,
        position: 1,
        createdAt: sentAt,
        updatedAt: sentAt,
      },
      {
        id: '01920000-0000-7000-8000-000000000222',
        proposalId: SEED_PROPOSAL_SENT_ID,
        packageId: null,
        catalogueItemId: extraHourItem?.id ?? null,
        itemType: 'addon',
        name: extraHourItem?.name ?? 'Extra Hour Coverage',
        description: extraHourItem?.description ?? 'Additional hour of shooting',
        unitPriceMinor: extraHourItem?.unitPriceMinor ?? 25000,
        quantity: 1,
        minQuantity: 0,
        maxQuantity: 4,
        taxRateBasisPoints: 1900,
        isOptional: true,
        isSelected: true,
        position: 2,
        createdAt: sentAt,
        updatedAt: sentAt,
      },
    ]);
    seededLineItems += 2;
  } else {
    seededProposals++;
    seededLineItems += 2;
  }

  // Proposal 3: ACCEPTED
  const [acceptedExists] = await tx
    .select({ id: proposals.id })
    .from(proposals)
    .where(eq(proposals.id, SEED_PROPOSAL_ACCEPTED_ID))
    .limit(1);

  if (!acceptedExists) {
    const rawToken = 'demo-token-accepted-proposal-seed-32bytes-secret';
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const sentAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const acceptedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    const snapshot = {
      acceptedAt: acceptedAt.toISOString(),
      acceptedByName: 'Emma Watson',
      acceptedByEmail: 'emma@example.com',
      subtotalMinor: 280000,
      taxMinor: 44706,
      totalMinor: 280000,
      currency: 'EUR',
      pricesIncludeTax: true,
      isKleinunternehmer: false,
      taxBreakdown: [
        {
          taxRateBasisPoints: 1900,
          taxRatePercentFormatted: '19.00',
          netMinor: 235294,
          taxMinor: 44706,
          grossMinor: 280000,
        },
      ],
      items: [
        {
          id: '01920000-0000-7000-8000-000000000231',
          packageId: weddingPkg?.id ?? null,
          catalogueItemId: null,
          itemType: 'base_package' as const,
          name: 'Full Day Wedding Coverage',
          description: '8 Hours continuous coverage',
          unitPriceMinor: 280000,
          quantity: 1,
          taxRateBasisPoints: 1900,
          lineTotalMinor: 280000,
        },
      ],
    };

    await tx.insert(proposals).values({
      id: SEED_PROPOSAL_ACCEPTED_ID,
      projectId,
      clientId,
      title: 'Emma & Liam Commercial Agreement',
      status: 'accepted',
      version: 1,
      currency: 'EUR',
      subtotalMinor: 280000,
      taxMinor: 44706,
      totalMinor: 280000,
      pricesIncludeTax: true,
      isKleinunternehmer: false,
      tokenHash,
      sentAt,
      acceptedAt,
      acceptedByName: 'Emma Watson',
      acceptedByEmail: 'emma@example.com',
      acceptanceIpAnonymized: '192.168.1.0',
      acceptanceUserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      acceptedOptionsSnapshot: snapshot,
      createdAt: sentAt,
      updatedAt: acceptedAt,
    });
    seededProposals++;

    await tx.insert(proposalLineItems).values([
      {
        id: '01920000-0000-7000-8000-000000000231',
        proposalId: SEED_PROPOSAL_ACCEPTED_ID,
        packageId: weddingPkg?.id ?? null,
        catalogueItemId: null,
        itemType: 'base_package',
        name: 'Full Day Wedding Coverage',
        description: '8 Hours continuous coverage',
        unitPriceMinor: 280000,
        quantity: 1,
        minQuantity: 1,
        maxQuantity: 1,
        taxRateBasisPoints: 1900,
        isOptional: false,
        isSelected: true,
        position: 1,
        createdAt: sentAt,
        updatedAt: acceptedAt,
      },
    ]);
    seededLineItems++;
  } else {
    seededProposals++;
    seededLineItems++;
  }

  return {
    seededProposals,
    seededLineItems,
  };
}
