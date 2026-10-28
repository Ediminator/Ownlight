import 'server-only';
import { eq, inArray, and, count, ne } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { proposals, proposalLineItems } from '@/server/db/schema/proposals';
import type { ErasureProvider, ErasureSubject } from '@/server/privacy/erasure/types';

/**
 * Proposals Erasure Provider (TASK-0059 / GDPR Art. 17 / ADR-0018 §6).
 * Permanently hard-deletes unaccepted, draft, expired, or declined proposals
 * and their associated line items during client erasure.
 *
 * Pre-contractual discussions are not subject to statutory commercial retention.
 * Accepted proposals are protected by proposalsHoldProvider and are never deleted.
 */
export const proposalsErasureProvider: ErasureProvider = {
  id: 'proposals',
  category: 'proposals',
  coveredTables: ['proposals', 'proposal_line_items'] as const,
  subjectKinds: ['client', 'contact'] as const,

  plan: async (subject: ErasureSubject, tx: DbClient): Promise<number> => {
    if (subject.kind !== 'client') {
      return 0;
    }

    const [res] = await tx
      .select({ count: count() })
      .from(proposals)
      .where(and(eq(proposals.clientId, subject.clientId), ne(proposals.status, 'accepted')));

    return res?.count ?? 0;
  },

  erase: async (subject: ErasureSubject, tx: DbClient): Promise<number> => {
    if (subject.kind !== 'client') {
      return 0;
    }

    const unacceptedProposals = await tx
      .select({ id: proposals.id })
      .from(proposals)
      .where(and(eq(proposals.clientId, subject.clientId), ne(proposals.status, 'accepted')));

    if (unacceptedProposals.length === 0) {
      return 0;
    }

    const proposalIds = unacceptedProposals.map((p) => p.id);

    // 1. Hard-delete child line items to guarantee zero orphaned records
    await tx.delete(proposalLineItems).where(inArray(proposalLineItems.proposalId, proposalIds));

    // 2. Hard-delete unaccepted proposal headers
    const deleted = await tx
      .delete(proposals)
      .where(inArray(proposals.id, proposalIds))
      .returning({ id: proposals.id });

    return deleted.length;
  },
};
