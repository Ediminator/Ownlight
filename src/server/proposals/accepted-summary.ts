import 'server-only';
import { eq, and, desc, asc } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { proposals, proposalLineItems } from '@/server/db/schema/proposals';
import { packageIncludedItems } from '@/server/db/schema/packages';

export interface AcceptedProposalSummary {
  proposalId: string;
  projectId: string;
  packageName: string;
  includedItems: string[];
  selectedAddons: { name: string; quantity: number; unitPriceMinor: number }[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  acceptedAt: Date;
  acceptedByName: string;
  acceptedByEmail: string;
}

/**
 * Returns structured summary of accepted proposal on a project (ADR-0018 §4.1 / AC-9).
 * Decoupled from Next.js request/auth contexts to ensure background worker bundle safety.
 */
export async function getAcceptedProposalForProject(
  projectId: string,
  tx?: DbClient,
): Promise<AcceptedProposalSummary | null> {
  const client = tx ?? defaultDb;

  const [proposal] = await client
    .select()
    .from(proposals)
    .where(and(eq(proposals.projectId, projectId), eq(proposals.status, 'accepted')))
    .orderBy(desc(proposals.acceptedAt), desc(proposals.createdAt))
    .limit(1);

  if (!proposal) {
    return null;
  }

  const items = await client
    .select()
    .from(proposalLineItems)
    .where(eq(proposalLineItems.proposalId, proposal.id))
    .orderBy(asc(proposalLineItems.position), asc(proposalLineItems.createdAt));

  const basePackageItem = items.find((i) => i.itemType === 'base_package');
  let includedItems: string[] = [];

  if (basePackageItem?.packageId) {
    const includedRows = await client
      .select({ title: packageIncludedItems.title })
      .from(packageIncludedItems)
      .where(eq(packageIncludedItems.packageId, basePackageItem.packageId))
      .orderBy(asc(packageIncludedItems.position), asc(packageIncludedItems.createdAt));

    includedItems = includedRows.map((r) => r.title);
  }

  const packageName = basePackageItem?.name ?? proposal.title;

  const selectedAddons = items
    .filter((i) => (i.itemType === 'addon' || i.itemType === 'custom') && i.isSelected)
    .map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPriceMinor: i.unitPriceMinor,
    }));

  return {
    proposalId: proposal.id,
    projectId: proposal.projectId,
    packageName,
    includedItems,
    selectedAddons,
    subtotalMinor: proposal.subtotalMinor,
    taxMinor: proposal.taxMinor,
    totalMinor: proposal.totalMinor,
    currency: proposal.currency,
    acceptedAt: proposal.acceptedAt ?? proposal.updatedAt,
    acceptedByName: proposal.acceptedByName ?? '',
    acceptedByEmail: proposal.acceptedByEmail ?? '',
  };
}
