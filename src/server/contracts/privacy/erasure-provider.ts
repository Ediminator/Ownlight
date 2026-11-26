import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { contracts } from '@/server/db/schema/contracts';
import type { ErasureProvider, ErasureSubject } from '@/server/privacy/erasure/types';
import { calculateStatutoryRetentionLockDate, getContractSignedDate } from './hold-provider';

export interface ContractErasabilityCandidate {
  status: string;
  clientSignedAt: Date | null;
  studioSignedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}

export interface ContractsErasureProviderOptions {
  deleteStorageAsset?: (storageKey: string) => Promise<void>;
  now?: () => Date;
}

/**
 * Determines whether a contract row may be hard-deleted during GDPR Art. 17 erasure.
 * Unexecuted contracts (draft, sent, declined, voided, superseded, signed_by_client) are erasable.
 * Executed contracts (status === 'signed') are protected while their 10-year §147 AO / §257 HGB
 * statutory lock date is in the future, and become erasable once the lock date has elapsed.
 */
export function isContractErasable(
  row: ContractErasabilityCandidate,
  now: Date = new Date(),
): boolean {
  if (row.status !== 'signed') {
    return true;
  }

  const lockDate = calculateStatutoryRetentionLockDate(getContractSignedDate(row));
  return lockDate.getTime() <= now.getTime();
}

/**
 * Factory for the Contracts GDPR Art. 17 Erasure Provider (TASK-0066 / ADR-0019 §7.2).
 */
export function createContractsErasureProvider(
  options: ContractsErasureProviderOptions = {},
): ErasureProvider {
  const getNow = options.now ?? (() => new Date());

  return {
    id: 'contracts',
    category: 'contracts',
    coveredTables: ['contracts'] as const,
    subjectKinds: ['client', 'contact'] as const,

    plan: async (subject: ErasureSubject, tx: DbClient): Promise<number> => {
      if (subject.kind !== 'client') {
        return 0;
      }

      const rows = await tx
        .select({
          id: contracts.id,
          status: contracts.status,
          clientSignedAt: contracts.clientSignedAt,
          studioSignedAt: contracts.studioSignedAt,
          updatedAt: contracts.updatedAt,
          createdAt: contracts.createdAt,
        })
        .from(contracts)
        .where(eq(contracts.clientId, subject.clientId));

      const now = getNow();
      return rows.filter((row) => isContractErasable(row, now)).length;
    },

    erase: async (subject: ErasureSubject, tx: DbClient): Promise<number> => {
      if (subject.kind !== 'client') {
        return 0;
      }

      const rows = await tx
        .select({
          id: contracts.id,
          status: contracts.status,
          clientSignedAt: contracts.clientSignedAt,
          studioSignedAt: contracts.studioSignedAt,
          updatedAt: contracts.updatedAt,
          createdAt: contracts.createdAt,
          pdfStorageKey: contracts.pdfStorageKey,
        })
        .from(contracts)
        .where(eq(contracts.clientId, subject.clientId));

      const now = getNow();
      const erasableRows = rows.filter((row) => isContractErasable(row, now));

      if (erasableRows.length === 0) {
        return 0;
      }

      if (options.deleteStorageAsset) {
        for (const row of erasableRows) {
          if (row.pdfStorageKey) {
            await options.deleteStorageAsset(row.pdfStorageKey);
          }
        }
      }

      const erasableIds = erasableRows.map((row) => row.id);
      const deleted = await tx
        .delete(contracts)
        .where(inArray(contracts.id, erasableIds))
        .returning({ id: contracts.id });

      return deleted.length;
    },
  };
}

/**
 * Default Contracts Erasure Provider registered in the erasure registry.
 */
export const contractsErasureProvider: ErasureProvider = createContractsErasureProvider();
