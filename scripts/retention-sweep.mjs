#!/usr/bin/env node
/**
 * scripts/retention-sweep.mjs
 * Delegates to the unified compiled retention CLI runner (TASK-0020).
 * Duplicate schema definitions have been eliminated (AC-5).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distCli = path.resolve(rootDir, 'dist/retention/cli.mjs');

export async function executeRetentionSweep(options = {}) {
  try {
    const { executeRetentionSweep: sweepTs } = await import('../src/server/retention/cli.ts');
    return await sweepTs(options);
  } catch {
    if (!existsSync(distCli)) {
      const { buildRetention } = await import('./build-retention.mjs');
      await buildRetention();
    }
    const { executeRetentionSweep: sweepDist } = await import('../dist/retention/cli.mjs');
    return await sweepDist(options);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  if (!existsSync(distCli)) {
    const { buildRetention } = await import('./build-retention.mjs');
    await buildRetention();
  }
  const { runCli } = await import('../dist/retention/cli.mjs');
  await runCli();
}
