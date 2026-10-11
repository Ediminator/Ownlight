import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@/server/log';
import { executeRetentionSweep, type CliOptions, type CliExecutionResult } from './runner';

export { executeRetentionSweep, type CliOptions, type CliExecutionResult };

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

export async function runCli(): Promise<void> {
  const cliArgs = parseCliArgs(process.argv.slice(2));
  logger.info(
    { dryRun: cliArgs.dryRun },
    `Starting retention CLI sweep (dryRun=${String(cliArgs.dryRun)})`,
  );

  try {
    const results = await executeRetentionSweep({
      dryRun: cliArgs.dryRun,
      policyIds: cliArgs.policyIds,
      batchSize: cliArgs.batchSize,
      connectionUrl: cliArgs.connectionUrl,
    });
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

/**
 * Auto-run if executed directly as the CLI / retention-sweep script.
 * Strictly checks process.argv[1] filename to prevent collision when bundled into worker.
 */
function isCliMain(): boolean {
  const argv1 = typeof process !== 'undefined' ? process.argv[1] : undefined;
  if (!argv1) return false;
  const scriptName = path.basename(argv1);
  if (!/^(?:cli|retention-sweep)\.(?:mjs|ts|js)$/i.test(scriptName)) return false;
  try {
    return path.resolve(argv1) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliMain()) {
  void runCli();
}
