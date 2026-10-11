import { describe, it, expect, vi } from 'vitest';
import { parseCliArgs } from '@/server/retention/cli';
import { buildRetention } from '../../scripts/build-retention.mjs';

vi.mock('server-only', () => ({}));

describe('Retention CLI argument parsing and build unit tests', () => {
  it('parses flags with space and equal-sign syntax correctly', () => {
    const args1 = parseCliArgs([
      '--dry-run',
      '--policy',
      'policy-a',
      '--batch-size',
      '250',
      '--connection-url',
      'postgres://localhost:5432/db',
    ]);

    expect(args1.dryRun).toBe(true);
    expect(args1.policyIds).toEqual(['policy-a']);
    expect(args1.batchSize).toBe(250);
    expect(args1.connectionUrl).toBe('postgres://localhost:5432/db');

    const args2 = parseCliArgs([
      '--dry-run=false',
      '--policy=policy-b',
      '--batch-size=50',
      '--connection-url=postgres://localhost:5432/db2',
    ]);

    expect(args2.dryRun).toBe(false);
    expect(args2.policyIds).toEqual(['policy-b']);
    expect(args2.batchSize).toBe(50);
    expect(args2.connectionUrl).toBe('postgres://localhost:5432/db2');
  });

  it('handles empty or unrecognized flags safely', () => {
    const emptyArgs = parseCliArgs([]);
    expect(emptyArgs.dryRun).toBe(false);
    expect(emptyArgs.policyIds).toBeUndefined();
    expect(emptyArgs.batchSize).toBeUndefined();
    expect(emptyArgs.connectionUrl).toBeUndefined();

    const ignoredArgs = parseCliArgs(['--unknown', '--batch-size=invalid']);
    expect(ignoredArgs.dryRun).toBe(false);
    expect(ignoredArgs.batchSize).toBeUndefined();
  });

  it('buildRetention programmatically creates retention bundles', async () => {
    const buildResult = await buildRetention();
    expect(buildResult.errors).toHaveLength(0);
  });
});
