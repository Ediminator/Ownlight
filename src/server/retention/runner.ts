import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/server/db/schema';
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
  inactiveClients?: { scanned: number; deleted: number; held: number };
  unconvertedLeads?: { scanned: number; deleted: number; held: number };
  spamLeads?: { scanned: number; deleted: number; held: number };
}

/**
 * Executes retention sweep against the database and returns structured results.
 * Pure runner logic without CLI arg parsing or auto-run side effects.
 */
export async function executeRetentionSweep(options: CliOptions = {}): Promise<CliExecutionResult> {
  const dryRun = options.dryRun ?? false;
  const policyIds = options.policyIds;
  const batchSize = options.batchSize;
  const connectionUrl =
    options.connectionUrl ?? process.env.DATABASE_RETENTION_URL ?? process.env.DATABASE_URL;

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
    const clientPolicy = summary.policies.find(
      (p) => p.policyId === 'inactive-clients' || p.entity === 'clients',
    );
    const unconvertedLeadsPolicy = summary.policies.find((p) => p.policyId === 'unconverted-leads');
    const spamLeadsPolicy = summary.policies.find((p) => p.policyId === 'spam-leads');

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
      inactiveClients: {
        scanned: clientPolicy?.scannedCount ?? 0,
        deleted: clientPolicy?.deletedCount ?? 0,
        held: clientPolicy?.heldCount ?? 0,
      },
      unconvertedLeads: {
        scanned: unconvertedLeadsPolicy?.scannedCount ?? 0,
        deleted: unconvertedLeadsPolicy?.deletedCount ?? 0,
        held: unconvertedLeadsPolicy?.heldCount ?? 0,
      },
      spamLeads: {
        scanned: spamLeadsPolicy?.scannedCount ?? 0,
        deleted: spamLeadsPolicy?.deletedCount ?? 0,
        held: spamLeadsPolicy?.heldCount ?? 0,
      },
    };
  } finally {
    if (rawClient) {
      await rawClient.end();
    }
  }
}
