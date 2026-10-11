import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

let mockExecuteThrows: unknown = null;
vi.mock('@/server/retention/runner', () => ({
  executeRetentionSweep: vi.fn().mockImplementation(() => {
    if (mockExecuteThrows) {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately mocking both Error and non-Error rejections
      return Promise.reject(mockExecuteThrows);
    }
    return Promise.resolve({
      totalScanned: 10,
      totalDeleted: 5,
      totalHeld: 2,
      durationMs: 123,
      policies: [],
    });
  }),
}));

import { parseCliArgs, runCli } from '@/server/retention/cli';
import { buildRetention } from '../../scripts/build-retention.mjs';

describe('Retention CLI argument parsing and build unit tests', () => {
  beforeEach(() => {
    mockExecuteThrows = null;
    vi.clearAllMocks();
  });

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

  it('handles edge case flags, invalid numbers, and trailing flags without values', () => {
    const edgeArgs = parseCliArgs([
      '', // empty token
      '--dry-run=true',
      '--batch-size',
      '0', // non-positive number
      '--batch-size',
      '-10', // negative number
      '--batch-size=abc', // NaN
      '--batch-size=0', // zero
      '--batch-size=', // empty value
      '--connection-url=postgres://custom',
      '--policy', // trailing without value
    ]);

    expect(edgeArgs.dryRun).toBe(true);
    expect(edgeArgs.policyIds).toBeUndefined();
    expect(edgeArgs.batchSize).toBeUndefined();
    expect(edgeArgs.connectionUrl).toBe('postgres://custom');

    const trailingConnUrl = parseCliArgs(['--connection-url']);
    expect(trailingConnUrl.connectionUrl).toBeUndefined();

    const trailingBatchSize = parseCliArgs(['--batch-size']);
    expect(trailingBatchSize.batchSize).toBeUndefined();
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

  it('runCli executes sweep and exits with code 0 on success', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      return undefined as never;
    });

    const origArgv = process.argv;
    process.argv = ['node', 'cli.mjs', '--dry-run', '--batch-size=100'];

    await runCli();
    expect(exitSpy).toHaveBeenCalledWith(0);

    process.argv = origArgv;
    exitSpy.mockRestore();
  });

  it('runCli catches Error exceptions and exits with code 1', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit:${String(code)}`);
    });

    mockExecuteThrows = new Error('Database connection failed');
    const origArgv = process.argv;
    process.argv = ['node', 'cli.mjs'];

    await expect(runCli()).rejects.toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);

    process.argv = origArgv;
    exitSpy.mockRestore();
  });

  it('runCli catches non-Error string exceptions and exits with code 1', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit:${String(code)}`);
    });

    mockExecuteThrows = 'Raw string error failure';
    const origArgv = process.argv;
    process.argv = ['node', 'cli.mjs'];

    await expect(runCli()).rejects.toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);

    process.argv = origArgv;
    exitSpy.mockRestore();
  });

  it('buildRetention programmatically creates retention bundles', async () => {
    const buildResult = await buildRetention();
    expect(buildResult.errors).toHaveLength(0);
  });
});
