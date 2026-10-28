import 'server-only';
import { eq, and } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { proposals } from '@/server/db/schema/proposals';
import type {
  ErasureHoldProvider,
  ErasureSubject,
  ErasureHold,
} from '@/server/privacy/erasure/types';

/**
 * Proposals Commercial Statutory Hold Provider (TASK-0059 / ADR-0018 §6).
 * Enforces GDPR Art. 17(3)(b) retention exception:
 *
 * Under German tax and commercial law (§147 Abs. 1 Nr. 2 AO, §257 Abs. 1 Nr. 2 HGB),
 * accepted commercial agreements, quotation vouchers, and binding commission deliverables
 * must be retained for 10 years starting from the end of the calendar year of acceptance.
 *
 * Blocks client erasure with code 'statutory.commercial_document' while any accepted proposal exists.
 */
export const proposalsHoldProvider: ErasureHoldProvider = {
  id: 'proposals',

  holds: async (subject: ErasureSubject, tx: DbClient): Promise<ErasureHold[]> => {
    if (subject.kind !== 'client') {
      return [];
    }

    const acceptedProposals = await tx
      .select({
        id: proposals.id,
        acceptedAt: proposals.acceptedAt,
        updatedAt: proposals.updatedAt,
        createdAt: proposals.createdAt,
      })
      .from(proposals)
      .where(and(eq(proposals.clientId, subject.clientId), eq(proposals.status, 'accepted')));

    if (acceptedProposals.length === 0) {
      return [];
    }

    const firstProposal = acceptedProposals[0];
    if (!firstProposal) {
      return [];
    }

    const firstDate = firstProposal.acceptedAt ?? firstProposal.updatedAt;
    let latestLockDate = new Date(
      Date.UTC(firstDate.getUTCFullYear() + 10, 11, 31, 23, 59, 59, 999),
    );

    for (const p of acceptedProposals.slice(1)) {
      const acceptanceDate = p.acceptedAt ?? p.updatedAt;
      const acceptanceYear = acceptanceDate.getUTCFullYear();
      // 10 years from end of calendar year of acceptance (§147(4) AO)
      const lockDate = new Date(Date.UTC(acceptanceYear + 10, 11, 31, 23, 59, 59, 999));

      if (lockDate.getTime() > latestLockDate.getTime()) {
        latestLockDate = lockDate;
      }
    }

    return [
      {
        reason: 'statutory.commercial_document',
        retainUntil: latestLockDate.toISOString(),
      },
    ];
  },
};
