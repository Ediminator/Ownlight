import { inArray, gte, or, and } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { proposals } from '@/server/db/schema/proposals';
import type { ActivityProvider } from '@/server/clients/activity';

/**
 * Retention sweep activity provider for proposals & quotes (ADR-0018 §6).
 * Identifies clients that have active pre-contractual proposals, recent quotation updates,
 * or accepted commercial agreements, preventing automated retention sweeps from marking
 * them inactive or purging them.
 */
export const proposalsActivityProvider: ActivityProvider = {
  id: 'proposals',

  activeClientIds: async (
    tx: DbClient,
    since: Date,
    candidateIds: readonly string[],
  ): Promise<string[]> => {
    if (candidateIds.length === 0) {
      return [];
    }

    const activeIds = new Set<string>();
    const now = new Date();
    const candidateList = [...candidateIds];

    // 1. Clients with active or accepted proposals (draft, sent, accepted)
    const activeStatusRows = await tx
      .selectDistinct({ clientId: proposals.clientId })
      .from(proposals)
      .where(
        and(
          inArray(proposals.clientId, candidateList),
          inArray(proposals.status, ['draft', 'sent', 'accepted']),
        ),
      );

    for (const row of activeStatusRows) {
      activeIds.add(row.clientId);
    }

    // 2. Clients with proposals updated, sent, or valid recently or into the future
    const recentProposalRows = await tx
      .selectDistinct({ clientId: proposals.clientId })
      .from(proposals)
      .where(
        and(
          inArray(proposals.clientId, candidateList),
          or(
            gte(proposals.updatedAt, since),
            gte(proposals.createdAt, since),
            gte(proposals.validUntil, now),
          ),
        ),
      );

    for (const row of recentProposalRows) {
      activeIds.add(row.clientId);
    }

    return [...activeIds];
  },
};
