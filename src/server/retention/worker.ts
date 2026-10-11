import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { logger } from '@/server/log';
import { executeRetentionSweep, type CliExecutionResult } from './runner';

export const WORKER_ADVISORY_LOCK_ID = 884210;
export const DEFAULT_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours (daily)

export interface BackgroundWorkerOptions {
  connectionUrl?: string;
  runOnce?: boolean;
  intervalMs?: number;
}

export class BackgroundWorker {
  public connectionUrl: string;
  public runOnce: boolean;
  public intervalMs: number;
  public isShuttingDown: boolean;
  public abortController: AbortController;
  public activeSweepPromise: Promise<CliExecutionResult> | null;
  public timer: NodeJS.Timeout | null;
  public sql: postgres.Sql | null;

  constructor(options: BackgroundWorkerOptions = {}) {
    const isCli = typeof process !== 'undefined' && Array.isArray(process.argv);
    const resolvedUrl =
      options.connectionUrl ?? process.env.DATABASE_RETENTION_URL ?? process.env.DATABASE_URL;

    if (!resolvedUrl) {
      throw new Error(
        'Database connection URL missing. Set DATABASE_RETENTION_URL or DATABASE_URL in environment.',
      );
    }

    this.connectionUrl = resolvedUrl;
    this.runOnce = options.runOnce ?? (isCli && process.argv.includes('--run-once'));
    this.intervalMs = options.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.isShuttingDown = false;
    this.abortController = new AbortController();
    this.activeSweepPromise = null;
    this.timer = null;
    this.sql = null;
  }

  async start(): Promise<{ success: boolean; reason?: string }> {
    this.sql = postgres(this.connectionUrl, {
      max: 1,
      onnotice: () => undefined,
    });

    // Acquire PostgreSQL advisory lock to ensure leader election across worker replicas
    const lockRes = await this.sql<
      { locked: boolean }[]
    >`SELECT pg_try_advisory_lock(${WORKER_ADVISORY_LOCK_ID}) as locked`;
    const isLocked = lockRes[0]?.locked;

    if (!isLocked) {
      logger.warn('Another worker holds the advisory lock. Exiting duplicate instance.');
      await this.sql.end();
      this.sql = null;
      return { success: false, reason: 'locked' };
    }

    logger.info('Background worker started (advisory lock acquired).');

    // Run initial sweep
    await this.runCycle();

    if (this.runOnce || this.isShuttingDown) {
      await this.stop();
      return { success: true };
    }

    // Schedule daily retention sweep
    this.timer = setInterval(() => {
      if (this.isShuttingDown) return;
      void this.runCycle();
    }, this.intervalMs);

    return { success: true };
  }

  async runCycle(): Promise<void> {
    if (this.isShuttingDown) return;

    logger.info('Worker: running daily retention sweep...');
    try {
      this.activeSweepPromise = executeRetentionSweep({
        connectionUrl: this.connectionUrl,
        dryRun: false,
        signal: this.abortController.signal,
      });
      const results = await this.activeSweepPromise;
      logger.info(
        {
          deletedCount: results.totalDeleted,
          heldCount: results.totalHeld,
        },
        `Worker: daily retention sweep completed (deleted: ${String(results.totalDeleted)}, held: ${String(results.totalHeld)}).`,
      );
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        `Worker: retention sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.activeSweepPromise = null;
    }
  }

  async stop(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.abortController.abort();
    logger.info('Worker shutting down gracefully...');

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.activeSweepPromise) {
      logger.info('Waiting for in-flight sweep batch to complete...');
      try {
        await this.activeSweepPromise;
      } catch {
        // Active sweep error is logged in runCycle
      }
    }

    if (this.sql) {
      try {
        await this.sql`SELECT pg_advisory_unlock(${WORKER_ADVISORY_LOCK_ID})`;
        await this.sql.end();
      } catch {
        // Ignore unlock errors during process termination
      }
      this.sql = null;
    }

    logger.info('Worker stopped cleanly.');
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
