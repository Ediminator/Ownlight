import type { DbClient } from '@/server/db/client';
import { logger } from '@/server/log';
import { executeRetentionSweep } from '@/server/retention/runner';
import { processOutboxBatch } from '@/server/integrations/google/sync-worker';

export interface JobContext {
  db: DbClient;
  signal: AbortSignal;
  logger: typeof logger;
}

export type JobResult = unknown;

export interface WorkerJob {
  id: string;
  intervalMs: number;
  run: (ctx: JobContext) => Promise<JobResult>;
}

export class JobRegistry {
  private jobs = new Map<string, WorkerJob>();

  register(job: WorkerJob): void {
    if (!job.id || typeof job.id !== 'string') {
      throw new Error('Job id must be a non-empty string');
    }
    if (typeof job.intervalMs !== 'number' || job.intervalMs <= 0) {
      throw new Error(`Job intervalMs must be a positive number for "${job.id}"`);
    }
    if (typeof job.run !== 'function') {
      throw new Error(`Job run must be a function for "${job.id}"`);
    }
    if (this.jobs.has(job.id)) {
      throw new Error(`Job with ID "${job.id}" is already registered`);
    }
    this.jobs.set(job.id, job);
  }

  get(id: string): WorkerJob | undefined {
    return this.jobs.get(id);
  }

  has(id: string): boolean {
    return this.jobs.has(id);
  }

  getAll(): WorkerJob[] {
    return Array.from(this.jobs.values());
  }

  clear(): void {
    this.jobs.clear();
  }

  get size(): number {
    return this.jobs.size;
  }
}

/**
 * Registers default built-in worker jobs:
 * 1. retention-sweep: daily GDPR data retention sweep (24 hours).
 * 2. google-contacts-outbox: periodic Google Contacts sync processor (15 seconds).
 */
export function registerDefaultJobs(registry: JobRegistry): void {
  if (!registry.has('retention-sweep')) {
    registry.register({
      id: 'retention-sweep',
      intervalMs: 24 * 60 * 60 * 1000,
      run: async (ctx: JobContext) => {
        ctx.logger.info('Worker: running daily retention sweep...');
        const results = await executeRetentionSweep({
          dbClient: ctx.db,
          dryRun: false,
          signal: ctx.signal,
        });
        ctx.logger.info(
          {
            deletedCount: results.totalDeleted,
            heldCount: results.totalHeld,
          },
          `Worker: daily retention sweep completed (deleted: ${String(results.totalDeleted)}, held: ${String(results.totalHeld)}).`,
        );
        return results;
      },
    });
  }

  if (!registry.has('google-contacts-outbox')) {
    registry.register({
      id: 'google-contacts-outbox',
      intervalMs: 15_000,
      run: async (ctx: JobContext) => {
        return processOutboxBatch({
          dbClient: ctx.db,
        });
      },
    });
  }
}

/**
 * Singleton worker job registry pre-populated with built-in jobs.
 */
export const jobRegistry = new JobRegistry();
registerDefaultJobs(jobRegistry);
