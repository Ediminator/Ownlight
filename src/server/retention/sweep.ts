import 'server-only';
import { db, type DbClient } from '@/server/db/client';
import { logger } from '@/server/log';
import { audit } from '@/server/audit';
import { getPolicies, computeCutoff, type RetentionPolicy, type RetentionEntity } from './policy';

export interface SweepOptions {
  dryRun?: boolean;
  client?: DbClient;
  policyIds?: string[];
  batchSize?: number;
  signal?: AbortSignal;
  now?: Date;
  onBatchStart?: (policyId: string, batchIndex: number) => Promise<void> | void;
  onBatchComplete?: (
    policyId: string,
    batchIndex: number,
    batchCount: number,
  ) => Promise<void> | void;
  beforeBatchCommit?: (policyId: string, batchIndex: number) => Promise<void> | void;
}

export interface PolicySweepResult {
  policyId: string;
  entity: string;
  action: 'delete' | 'anonymize';
  scannedCount: number;
  deletedCount: number;
  heldCount: number;
  failedCount?: number;
  dryRun: boolean;
  durationMs: number;
  erasableCount?: number;
  erasableIds?: string[];
  heldIds?: string[];
  errors?: string[];
}

export interface SweepSummary {
  dryRun: boolean;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  totalScanned: number;
  totalDeleted: number;
  totalHeld: number;
  totalFailed?: number;
  aborted: boolean;
  policies: PolicySweepResult[];
}

/**
 * Executes retention sweep across all or selected policies.
 * Performs atomic deletions inside batch transactions and respects legal holds.
 */
export async function runRetentionSweep(options: SweepOptions = {}): Promise<SweepSummary> {
  const startedAt = new Date();
  const dryRun = Boolean(options.dryRun);
  const client = options.client ?? db;
  const now = options.now ?? new Date();
  const allPolicies = getPolicies();

  const selectedPolicies: RetentionPolicy[] = options.policyIds
    ? allPolicies.filter((p) => options.policyIds?.includes(p.id))
    : allPolicies;

  const policyResults: PolicySweepResult[] = [];
  let totalScanned = 0;
  let totalDeleted = 0;
  let totalHeld = 0;
  let aborted = false;

  logger.info(
    {
      dryRun,
      policyCount: selectedPolicies.length,
      startedAt: startedAt.toISOString(),
    },
    `Starting retention sweep (dryRun=${String(dryRun)})`,
  );

  for (const policy of selectedPolicies) {
    if (options.signal?.aborted) {
      aborted = true;
      break;
    }

    const policyStart = Date.now();
    const cutoff = computeCutoff(now, policy.after);
    const batchSize = options.batchSize ?? policy.batchSize ?? 500;

    let policyScanned = 0;
    let policyDeleted = 0;
    let policyHeld = 0;
    let policyFailed = 0;
    const policyErrors: string[] = [];
    const policyErasableIds: string[] = [];
    const policyHeldIds: string[] = [];
    const excludedIds: string[] = [];
    let batchIndex = 0;
    let hasMore = true;

    while (hasMore) {
      if (options.signal?.aborted) {
        aborted = true;
        break;
      }

      const candidates = await policy.getCandidates(client, cutoff, batchSize, excludedIds);
      if (candidates.length === 0) {
        break;
      }

      const heldRows: RetentionEntity[] = [];
      const eligibleRows: RetentionEntity[] = [];

      for (const row of candidates) {
        let isHeld = false;
        if (policy.legalHold) {
          isHeld = await policy.legalHold(row, client);
        }
        if (isHeld) {
          heldRows.push(row);
          if (!policyHeldIds.includes(row.id)) {
            policyHeldIds.push(row.id);
          }
          if (!excludedIds.includes(row.id)) {
            excludedIds.push(row.id);
          }
        } else {
          eligibleRows.push(row);
          if (!policyErasableIds.includes(row.id)) {
            policyErasableIds.push(row.id);
          }
        }
      }

      policyHeld += heldRows.length;
      policyScanned += candidates.length;

      if (!dryRun) {
        if (eligibleRows.length > 0) {
          if (options.signal?.aborted) {
            aborted = true;
            break;
          }

          if (options.onBatchStart) {
            await options.onBatchStart(policy.id, batchIndex);
          }

          if (policy.eraseCandidate) {
            // Individual candidate execution with failure isolation (TASK-0019 / AC-12)
            for (const row of eligibleRows) {
              if (options.signal?.aborted) {
                aborted = true;
                break;
              }
              try {
                const res = await policy.eraseCandidate(client, row.id);
                if (res.outcome === 'deleted') {
                  policyDeleted++;
                } else if (res.outcome === 'held') {
                  policyHeld++;
                  if (!policyHeldIds.includes(row.id)) {
                    policyHeldIds.push(row.id);
                  }
                  if (!excludedIds.includes(row.id)) {
                    excludedIds.push(row.id);
                  }
                } else {
                  policyFailed++;
                  if (!excludedIds.includes(row.id)) {
                    excludedIds.push(row.id);
                  }
                  policyErrors.push(
                    typeof res.error === 'string' ? res.error : `Erasure failed for ${row.id}`,
                  );
                }
              } catch (err) {
                policyFailed++;
                if (!excludedIds.includes(row.id)) {
                  excludedIds.push(row.id);
                }
                policyErrors.push(err instanceof Error ? err.message : String(err));
                logger.error(
                  {
                    err: err instanceof Error ? err.message : String(err),
                    candidateId: row.id,
                    policyId: policy.id,
                  },
                  'Candidate erasure threw an error, individual candidate rolled back cleanly',
                );
              }
            }
          } else {
            const eligibleIds: string[] = eligibleRows.map((r) => r.id);

            // Atomic batch transaction
            await client.transaction(async (tx) => {
              if (options.beforeBatchCommit) {
                await options.beforeBatchCommit(policy.id, batchIndex);
              }
              await policy.deleteBatch(tx, eligibleIds);
            });

            policyDeleted += eligibleRows.length;
          }

          if (options.onBatchComplete) {
            await options.onBatchComplete(policy.id, batchIndex, eligibleRows.length);
          }
        } else {
          // If all candidates in this batch were held and no eligible rows, continue pagination
          if (heldRows.length === 0) {
            hasMore = false;
          }
        }
      } else {
        // Dry-run mode: exclude inspected rows to simulate next batch
        for (const r of eligibleRows) {
          if (!excludedIds.includes(r.id)) {
            excludedIds.push(r.id);
          }
        }
        policyDeleted += eligibleRows.length;
      }

      if (candidates.length < batchSize) {
        hasMore = false;
      }

      batchIndex++;
    }

    const policyDuration = Date.now() - policyStart;
    const result: PolicySweepResult = {
      policyId: policy.id,
      entity: policy.entity,
      action: policy.action,
      scannedCount: policyScanned,
      deletedCount: dryRun ? 0 : policyDeleted,
      heldCount: policyHeld,
      failedCount: policyFailed > 0 ? policyFailed : undefined,
      dryRun,
      durationMs: policyDuration,
      erasableCount: policyErasableIds.length,
      erasableIds: policyErasableIds,
      heldIds: policyHeldIds,
      errors: policyErrors.length > 0 ? policyErrors : undefined,
    };
    policyResults.push(result);

    totalScanned += policyScanned;
    totalDeleted += dryRun ? 0 : policyDeleted;
    totalHeld += policyHeld;

    // Record audit event for actual retention sweep runs (counts only)
    if (!dryRun && !aborted && policyScanned > 0) {
      try {
        const auditMeta: Record<string, unknown> = {
          policy_id: policy.id,
          scanned_count: policyScanned,
          deleted_count: policyDeleted,
          held_count: policyHeld,
          dry_run: false,
          duration_ms: policyDuration,
        };
        if (policyFailed > 0) {
          auditMeta.failed_count = policyFailed;
        }

        await audit(
          {
            actorType: 'system',
            actorId: 'retention-worker',
            action: 'retention.sweep.completed',
            targetType: policy.entity,
            outcome: 'success',
            metadata: auditMeta,
          },
          client,
        );
      } catch {
        // Non-fatal if recording completion audit log fails
      }
    }
  }

  const completedAt = new Date();
  const totalFailed = policyResults.reduce((acc, p) => acc + (p.failedCount ?? 0), 0);
  const summary: SweepSummary = {
    dryRun,
    startedAt,
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    totalScanned,
    totalDeleted,
    totalHeld,
    totalFailed: totalFailed > 0 ? totalFailed : undefined,
    aborted,
    policies: policyResults,
  };

  logger.info(
    {
      dryRun,
      durationMs: summary.durationMs,
      totalScanned,
      totalDeleted,
      totalHeld,
      aborted,
    },
    `Retention sweep finished: ${String(totalDeleted)} deleted, ${String(totalHeld)} held (dryRun=${String(dryRun)})`,
  );

  return summary;
}
