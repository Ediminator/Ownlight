import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/server/db/schema';
import { logger } from '@/server/log';
import { runRetentionSweep, type SweepOptions, type SweepSummary } from './sweep';
import type { DbClient } from '@/server/db/client';

export interface CliOptions extends SweepOptions {
  connectionUrl?: string;
  dbClient?: DbClient;
  retentionMonths?: number;
}

export interface CliExecutionResult extends SweepSummary {
  auditEvents: { scanned: number; deleted: number; held: number };
  sessions: { scanned: number; deleted: number; held: number };
  rateLimits: { scanned: number; deleted: number; held: number };
}

export function parseCliArgs(argv: string[]): {
  dryRun: boolean;
  policyIds?: string[];
  batchSize?: number;
  connectionUrl?: string;
} {
  let dryRun = false;
  const policyIds: string[] = [];
  let batchSize: number | undefined;
  let connectionUrl: string | undefined;

  const tokens = [...argv];
  while (tokens.length > 0) {
    const arg = tokens.shift();
    if (!arg) continue;

    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--dry-run=')) {
      dryRun = arg.split('=')[1] === 'true';
    } else if (arg === '--policy') {
      const val = tokens.shift();
      if (val) policyIds.push(val);
    } else if (arg.startsWith('--policy=')) {
      const val = arg.slice('--policy='.length);
      if (val) policyIds.push(val);
    } else if (arg === '--batch-size') {
      const val = tokens.shift();
      if (val) {
        const num = parseInt(val, 10);
        if (!Number.isNaN(num) && num > 0) batchSize = num;
      }
    } else if (arg.startsWith('--batch-size=')) {
      const val = arg.slice('--batch-size='.length);
      const num = parseInt(val, 10);
      if (!Number.isNaN(num) && num > 0) batchSize = num;
    } else if (arg === '--connection-url') {
      connectionUrl = tokens.shift();
    } else if (arg.startsWith('--connection-url=')) {
      connectionUrl = arg.slice('--connection-url='.length);
    }
  }

  return {
    dryRun,
    policyIds: policyIds.length > 0 ? policyIds : undefined,
    batchSize,
    connectionUrl,
  };
}

/**
 * Executes retention sweep against the database and returns structured results.
 * Supports legacy executeRetentionSweep signature for backwards compatibility.
 */
export async function executeRetentionSweep(options: CliOptions = {}): Promise<CliExecutionResult> {
  const isCliInvocation = typeof process !== 'undefined' && Array.isArray(process.argv);
  const cliArgs = isCliInvocation ? parseCliArgs(process.argv.slice(2)) : { dryRun: false };

  const dryRun =
    options.dryRun ?? (cliArgs.dryRun || (isCliInvocation && process.argv.includes('--dry-run')));
  const policyIds = options.policyIds ?? cliArgs.policyIds;
  const batchSize = options.batchSize ?? cliArgs.batchSize;
  const connectionUrl =
    options.connectionUrl ??
    cliArgs.connectionUrl ??
    process.env.DATABASE_RETENTION_URL ??
    process.env.DATABASE_URL;

  let client = options.dbClient ?? options.client;
  let rawClient: postgres.Sql | null = null;

  if (!client) {
    if (!connectionUrl) {
      throw new Error(
        'Database connection URL missing. Set DATABASE_RETENTION_URL or DATABASE_URL in environment.',
      );
    }

    rawClient = postgres(connectionUrl, {
      max: 1,
      onnotice: () => undefined,
    });
    client = drizzle(rawClient, { schema });
  }

  try {
    const summary = await runRetentionSweep({
      client,
      dryRun,
      policyIds,
      batchSize,
      now: options.now,
      signal: options.signal,
      onBatchStart: options.onBatchStart,
      onBatchComplete: options.onBatchComplete,
      beforeBatchCommit: options.beforeBatchCommit,
    });

    const auditPolicy = summary.policies.find(
      (p) => p.policyId === 'audit-events-retention' || p.entity === 'audit_events',
    );
    const sessionPolicy = summary.policies.find(
      (p) => p.policyId === 'expired-sessions' || p.entity === 'session',
    );
    const rateLimitPolicy = summary.policies.find(
      (p) => p.policyId === 'expired-rate-limits' || p.entity === 'rate_limits',
    );

    return {
      ...summary,
      auditEvents: {
        scanned: auditPolicy?.scannedCount ?? 0,
        deleted: auditPolicy?.deletedCount ?? 0,
        held: auditPolicy?.heldCount ?? 0,
      },
      sessions: {
        scanned: sessionPolicy?.scannedCount ?? 0,
        deleted: sessionPolicy?.deletedCount ?? 0,
        held: sessionPolicy?.heldCount ?? 0,
      },
      rateLimits: {
        scanned: rateLimitPolicy?.scannedCount ?? 0,
        deleted: rateLimitPolicy?.deletedCount ?? 0,
        held: rateLimitPolicy?.heldCount ?? 0,
      },
    };
  } finally {
    if (rawClient) {
      await rawClient.end();
    }
  }
}

export async function runCli(): Promise<void> {
  const cliArgs = parseCliArgs(process.argv.slice(2));
  logger.info(
    { dryRun: cliArgs.dryRun },
    `Starting retention CLI sweep (dryRun=${String(cliArgs.dryRun)})`,
  );

  try {
    const results = await executeRetentionSweep();
    logger.info(
      {
        totalScanned: results.totalScanned,
        totalDeleted: results.totalDeleted,
        totalHeld: results.totalHeld,
        durationMs: results.durationMs,
        policies: results.policies,
      },
      `Retention sweep finished: ${String(results.totalDeleted)} deleted, ${String(results.totalHeld)} held in ${String(results.durationMs)}ms`,
    );
    process.exit(0);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      `Retention sweep failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

// Auto-run if executed directly as a script
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  void runCli();
}
