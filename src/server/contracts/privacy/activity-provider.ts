import { inArray, gte, or, and } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { contracts } from '@/server/db/schema/contracts';
import type { ActivityProvider } from '@/server/clients/activity';

/**
 * Retention sweep activity provider for contracts (TASK-0066 / ADR-0019 §7).
 * Identifies clients with active in-flight contracts or contracts issued/signed
 * within the retention window, preventing automated retention sweeps from
 * prematurely purging active client relationships.
 */
export const contractsActivityProvider: ActivityProvider = {
  id: 'contracts',

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

    // 1. Clients with ongoing in-flight contracts (draft, sent, signed_by_client)
    const activeStatusRows = await tx
      .selectDistinct({ clientId: contracts.clientId })
      .from(contracts)
      .where(
        and(
          inArray(contracts.clientId, candidateList),
          inArray(contracts.status, ['draft', 'sent', 'signed_by_client']),
        ),
      );

    for (const row of activeStatusRows) {
      activeIds.add(row.clientId);
    }

    // 2. Clients with contracts issued, signed, updated, or still valid within the retention window
    const recentContractRows = await tx
      .selectDistinct({ clientId: contracts.clientId })
      .from(contracts)
      .where(
        and(
          inArray(contracts.clientId, candidateList),
          or(
            gte(contracts.sentAt, since),
            gte(contracts.clientSignedAt, since),
            gte(contracts.studioSignedAt, since),
            gte(contracts.updatedAt, since),
            gte(contracts.createdAt, since),
            gte(contracts.validUntil, now),
          ),
        ),
      );

    for (const row of recentContractRows) {
      activeIds.add(row.clientId);
    }

    return [...activeIds];
  },
};
