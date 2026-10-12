import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { logger } from '@/server/log';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { jobRegistry, JobRegistry, type WorkerJob, type JobContext } from '@/server/worker/jobs';

export {
  jobRegistry,
  JobRegistry,
  type WorkerJob,
  type JobContext,
  type JobResult,
} from '@/server/worker/jobs';

export const WORKER_ADVISORY_LOCK_ID = 884210;
export const DEFAULT_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours (daily)

export interface BackgroundWorkerOptions {
  connectionUrl?: string;
  db?: DbClient;
  dbClient?: DbClient;
  sql?: postgres.Sql | null;
  registry?: JobRegistry;
  runOnce?: boolean;
  intervalMs?: number;
  logger?: typeof logger;
  mockAdvisoryLock?: boolean;
}

export class BackgroundWorker {
  public connectionUrl: string;
  public db: DbClient | null;
  public runOnce: boolean;
  public intervalMs: number;
  public isShuttingDown: boolean;
  public abortController: AbortController;
  public activeSweepPromise: Promise<unknown> | null;
  public timer: NodeJS.Timeout | null;
  public sql: postgres.Sql | null;
  public registry: JobRegistry;
  public mockAdvisoryLock: boolean;

  private runningJobs = new Set<string>();
  private activeJobPromises = new Map<string, Promise<unknown>>();
  private timers: NodeJS.Timeout[] = [];
  private workerLogger: typeof logger;

  constructor(options: BackgroundWorkerOptions = {}) {
    const isCli = typeof process !== 'undefined' && Array.isArray(process.argv);
    this.mockAdvisoryLock = options.mockAdvisoryLock ?? options.connectionUrl === '';

    const resolvedUrl =
      options.connectionUrl ??
      (this.mockAdvisoryLock
        ? ''
        : (process.env.DATABASE_RETENTION_URL ?? process.env.DATABASE_URL));

    this.db = options.db ?? options.dbClient ?? null;

    if (!resolvedUrl && !this.db && !this.mockAdvisoryLock) {
      throw new Error(
        'Database connection URL missing. Set DATABASE_RETENTION_URL or DATABASE_URL in environment.',
      );
    }

    this.connectionUrl = resolvedUrl ?? '';
    this.runOnce = options.runOnce ?? (isCli && process.argv.includes('--run-once'));
    this.intervalMs = options.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.registry = options.registry ?? jobRegistry;
    this.workerLogger = options.logger ?? logger;
    this.sql = options.sql ?? null;
    this.isShuttingDown = false;
    this.abortController = new AbortController();
    this.activeSweepPromise = null;
    this.timer = null;
  }

  async start(): Promise<{ success: boolean; reason?: string }> {
    if (!this.mockAdvisoryLock && !this.sql && !this.db && this.connectionUrl) {
      this.sql = postgres(this.connectionUrl, {
        max: 1,
        onnotice: () => undefined,
      });
    }

    let isLocked = false;

    if (this.mockAdvisoryLock) {
      isLocked = true;
    } else if (this.sql) {
      const lockRes = await this.sql<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_lock(${WORKER_ADVISORY_LOCK_ID}) as locked`;
      isLocked = lockRes[0]?.locked ?? false;
    } else if (this.db) {
      try {
        const lockRes: unknown = await this.db.execute(
          sql`SELECT pg_try_advisory_lock(${WORKER_ADVISORY_LOCK_ID}) as locked`,
        );
        const rows = Array.isArray(lockRes)
          ? (lockRes as { locked?: boolean }[])
          : typeof lockRes === 'object' &&
              lockRes !== null &&
              'rows' in lockRes &&
              Array.isArray((lockRes as { rows: unknown[] }).rows)
            ? (lockRes as { rows: { locked?: boolean }[] }).rows
            : [];
        const firstRow = rows[0];
        isLocked = firstRow?.locked ?? true;
      } catch {
        isLocked = true;
      }
    } else {
      isLocked = true;
    }

    if (!isLocked) {
      this.workerLogger.warn('Another worker holds the advisory lock. Exiting duplicate instance.');
      if (this.sql) {
        await this.sql.end();
        this.sql = null;
      }
      return { success: false, reason: 'locked' };
    }

    this.workerLogger.info('Background worker started (advisory lock acquired).');

    // Run initial cycle across registered jobs
    await this.runCycle();

    if (this.runOnce || this.isShuttingDown) {
      await this.stop();
      return { success: true };
    }

    // Schedule each registered job on its interval
    for (const job of this.registry.getAll()) {
      const interval =
        job.id === 'retention-sweep' && this.intervalMs !== DEFAULT_SWEEP_INTERVAL_MS
          ? this.intervalMs
          : job.intervalMs;

      const timer = setInterval(() => {
        if (this.isShuttingDown) return;
        void this.runJob(job);
      }, interval);

      this.timers.push(timer);
      if (job.id === 'retention-sweep') {
        this.timer = timer;
      }
    }

    return { success: true };
  }

  async runCycle(): Promise<void> {
    if (this.isShuttingDown) return;

    for (const job of this.registry.getAll()) {
      await this.runJob(job);
    }
  }

  async runJob(job: WorkerJob): Promise<void> {
    if (this.isShuttingDown) return;

    // AC-5: Concurrency guard: runs of the same job never overlap
    if (this.runningJobs.has(job.id)) {
      return;
    }

    this.runningJobs.add(job.id);
    const dbClient = this.db ?? defaultDb;
    const ctx: JobContext = {
      db: dbClient,
      signal: this.abortController.signal,
      logger: this.workerLogger,
    };

    const promise = (async () => {
      try {
        return await job.run(ctx);
      } catch (err) {
        // AC-4: Error isolation. Log job ID and error class ONLY (no payload, no contact data)
        const errorClass = err instanceof Error ? err.constructor.name : typeof err;
        this.workerLogger.error(
          {
            jobId: job.id,
            errorClass,
          },
          `Worker job failed: ${job.id} (${errorClass})`,
        );
      }
    })();

    this.activeJobPromises.set(job.id, promise);
    if (job.id === 'retention-sweep') {
      this.activeSweepPromise = promise;
    }

    try {
      await promise;
    } finally {
      this.runningJobs.delete(job.id);
      this.activeJobPromises.delete(job.id);
      if (job.id === 'retention-sweep') {
        this.activeSweepPromise = null;
      }
    }
  }

  async stop(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.abortController.abort();
    this.workerLogger.info('Worker shutting down gracefully...');

    // Clear all scheduled intervals
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // AC-6: Wait for in-flight job runs to finish
    if (this.activeSweepPromise) {
      this.workerLogger.info('Waiting for in-flight sweep batch to complete...');
      try {
        await this.activeSweepPromise;
      } catch {
        // Handled in runJob
      }
    }

    if (this.activeJobPromises.size > 0) {
      await Promise.allSettled(Array.from(this.activeJobPromises.values()));
    }

    // Release advisory lock and close raw connection
    if (this.mockAdvisoryLock) {
      // In-memory mock advisory lock; no remote connection to release
    } else if (this.sql) {
      try {
        await this.sql`SELECT pg_advisory_unlock(${WORKER_ADVISORY_LOCK_ID})`;
        await this.sql.end();
      } catch {
        // Ignore unlock errors during process termination
      }
      this.sql = null;
    } else if (this.db) {
      try {
        await this.db.execute(sql`SELECT pg_advisory_unlock(${WORKER_ADVISORY_LOCK_ID})`);
      } catch {
        // Ignore unlock errors
      }
    }

    this.workerLogger.info('Worker stopped cleanly.');
  }
}

/**
 * Auto-run if executed directly as the worker script.
 * Strictly checks process.argv[1] filename to prevent false triggers.
 */
function isWorkerMain(): boolean {
  const argv1 = typeof process !== 'undefined' ? process.argv[1] : undefined;
  if (!argv1) return false;
  const scriptName = path.basename(argv1);
  if (!/^worker\.(?:mjs|ts|js)$/i.test(scriptName)) return false;
  try {
    return path.resolve(argv1) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isWorkerMain()) {
  const worker = new BackgroundWorker();

  const handleSignal = async (signal: string) => {
    logger.info(`Received ${signal}. Initiating graceful worker shutdown.`);
    await worker.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void handleSignal('SIGTERM'));
  process.on('SIGINT', () => void handleSignal('SIGINT'));

  try {
    const outcome = await worker.start();
    if (!outcome.success && outcome.reason === 'locked') {
      process.exit(0);
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      `Fatal worker error: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}
