import 'server-only';
import { eq, and } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { contracts } from '@/server/db/schema/contracts';
import type {
  ErasureHoldProvider,
  ErasureSubject,
  ErasureHold,
} from '@/server/privacy/erasure/types';

export const STATUTORY_COMMERCIAL_CONTRACT_HOLD_REASON = 'statutory.commercial_contract' as const;
export const STATUTORY_COMMERCIAL_CONTRACT_LEGAL_BASIS =
  '§147 Abs. 1 Nr. 2 & 4 AO, §257 Abs. 1 Nr. 2 & 4 HGB, GDPR Art. 17(3)(b)' as const;

export interface SignedContractLockCandidate {
  id: string;
  clientSignedAt: Date | null;
  studioSignedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}

export interface ContractHoldEvaluation {
  active: boolean;
  reason: typeof STATUTORY_COMMERCIAL_CONTRACT_HOLD_REASON;
  retainUntil: string | null;
  legalExplanation: string;
}

/**
 * Calculates the statutory commercial retention lock date under §147 AO / §257 HGB:
 * UTC(Year(signed_at) + 10, December 31, 23:59:59.999).
 */
export function calculateStatutoryRetentionLockDate(signedAt: Date): Date {
  return new Date(Date.UTC(signedAt.getUTCFullYear() + 10, 11, 31, 23, 59, 59, 999));
}

/**
 * Resolves the authoritative execution timestamp of a signed contract.
 */
export function getContractSignedDate(row: {
  clientSignedAt: Date | null;
  studioSignedAt?: Date | null;
  updatedAt: Date;
  createdAt?: Date;
}): Date {
  return row.clientSignedAt ?? row.studioSignedAt ?? row.updatedAt;
}

/**
 * Evaluates whether executed commercial contracts require an active statutory hold at `now`.
 */
export function evaluateContractStatutoryHold(
  signedContracts: readonly SignedContractLockCandidate[],
  now: Date = new Date(),
): ContractHoldEvaluation {
  const first = signedContracts[0];
  if (!first) {
    return {
      active: false,
      reason: STATUTORY_COMMERCIAL_CONTRACT_HOLD_REASON,
      retainUntil: null,
      legalExplanation: STATUTORY_COMMERCIAL_CONTRACT_LEGAL_BASIS,
    };
  }

  let latestLockDate = calculateStatutoryRetentionLockDate(getContractSignedDate(first));

  for (const contract of signedContracts.slice(1)) {
    const lockDate = calculateStatutoryRetentionLockDate(getContractSignedDate(contract));
    if (lockDate.getTime() > latestLockDate.getTime()) {
      latestLockDate = lockDate;
    }
  }

  const active = latestLockDate.getTime() > now.getTime();

  return {
    active,
    reason: STATUTORY_COMMERCIAL_CONTRACT_HOLD_REASON,
    retainUntil: latestLockDate.toISOString(),
    legalExplanation: STATUTORY_COMMERCIAL_CONTRACT_LEGAL_BASIS,
  };
}

/**
 * Contracts Statutory Commercial Hold Provider (TASK-0066 / ADR-0019 §7.3).
 * Enforces GDPR Art. 17(3)(b) retention exception under §147 AO and §257 HGB:
 *
 * Executed contracts (`status === 'signed'`) must be retained for 10 years starting
 * from the end of the calendar year in which the contract was executed.
 * Blocks client erasure with code `'statutory.commercial_contract'` while the lock date
 * has not yet elapsed, and unblocks erasure once the 10-year lock date expires.
 */
export const contractsHoldProvider: ErasureHoldProvider = {
  id: 'contracts',

  holds: async (subject: ErasureSubject, tx: DbClient): Promise<ErasureHold[]> => {
    if (subject.kind !== 'client') {
      return [];
    }

    const signedContracts = await tx
      .select({
        id: contracts.id,
        clientSignedAt: contracts.clientSignedAt,
        studioSignedAt: contracts.studioSignedAt,
        updatedAt: contracts.updatedAt,
        createdAt: contracts.createdAt,
      })
      .from(contracts)
      .where(and(eq(contracts.clientId, subject.clientId), eq(contracts.status, 'signed')));

    const evaluation = evaluateContractStatutoryHold(signedContracts, new Date());
    if (!evaluation.active || !evaluation.retainUntil) {
      return [];
    }

    return [
      {
        reason: evaluation.reason,
        retainUntil: evaluation.retainUntil,
      },
    ];
  },
};
