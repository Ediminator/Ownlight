#!/usr/bin/env node
/**
 * scripts/worker.mjs
 * Delegates to the unified compiled retention worker (TASK-0020).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distWorker = path.resolve(rootDir, 'dist/retention/worker.mjs');

let WorkerClass;
try {
  const mod = await import('../src/server/retention/worker.ts');
  WorkerClass = mod.BackgroundWorker;
} catch {
  if (!existsSync(distWorker)) {
    const { buildRetention } = await import('./build-retention.mjs');
    await buildRetention();
  }
  const mod = await import('../dist/retention/worker.mjs');
  WorkerClass = mod.BackgroundWorker;
}

export const BackgroundWorker = WorkerClass;

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const worker = new BackgroundWorker();
  const handleSignal = async (signal) => {
    console.log(`\nReceived ${signal}. Initiating graceful worker shutdown.`);
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
    console.error('Fatal worker error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
