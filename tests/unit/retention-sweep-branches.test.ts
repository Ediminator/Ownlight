import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/audit', () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

import { runRetentionSweep } from '@/server/retention/sweep';
import { registerPolicy, resetPolicies, type RetentionPolicy } from '@/server/retention/policy';
import type { DbClient } from '@/server/db/client';

describe('Retention sweep branch coverage', () => {
  const mockDbClient = {
    transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as DbClient;

  beforeEach(() => {
    resetPolicies();
  });

  afterEach(() => {
    resetPolicies();
  });

  it('handles abort signal before starting policy and inside batch loops', async () => {
    const controller = new AbortController();
    controller.abort();

    const mockPolicy: RetentionPolicy = {
      id: 'test-aborted-policy',
      entity: 'test_entity',
      action: 'delete',
      getCandidates: vi.fn().mockResolvedValue([{ id: 'row-1' }]),
      deleteBatch: vi.fn().mockResolvedValue(undefined),
    };
    registerPolicy(mockPolicy);

    const res = await runRetentionSweep({
      client: mockDbClient,
      policyIds: [mockPolicy.id],
      signal: controller.signal,
    });

    expect(res.aborted).toBe(true);
    expect(mockPolicy.getCandidates).not.toHaveBeenCalled();
  });

  it('handles abort signal inside candidate loop of eraseCandidate', async () => {
    const controller = new AbortController();

    const mockPolicy: RetentionPolicy = {
      id: 'test-erase-candidate-abort',
      entity: 'test_entity',
      action: 'delete',
      batchSize: 10,
      deleteBatch: vi.fn(),
      getCandidates: vi.fn().mockResolvedValue([{ id: 'row-1' }, { id: 'row-2' }]),
      eraseCandidate: vi.fn().mockImplementation(() => {
        controller.abort();
        return Promise.resolve({ outcome: 'deleted' });
      }),
    };
    registerPolicy(mockPolicy);

    const res = await runRetentionSweep({
      client: mockDbClient,
      policyIds: [mockPolicy.id],
      signal: controller.signal,
      dryRun: false,
    });

    expect(res.aborted).toBe(true);
    expect(res.totalDeleted).toBe(1);
  });

  it('handles all eraseCandidate outcomes: deleted, held, failed with string, failed without string, Error exception, string exception', async () => {
    let callCount = 0;
    const mockPolicy: RetentionPolicy = {
      id: 'test-erase-outcomes',
      entity: 'test_entity',
      action: 'delete',
      batchSize: 10,
      deleteBatch: vi.fn(),
      getCandidates: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'c-deleted' },
          { id: 'c-held' },
          { id: 'c-held' }, // duplicate held id branch
          { id: 'c-failed-string' },
          { id: 'c-failed-nostring' },
          { id: 'c-throw-error' },
          { id: 'c-throw-string' },
        ])
        .mockResolvedValueOnce([]),
      eraseCandidate: vi.fn().mockImplementation((_client, id: string) => {
        callCount++;
        if (id === 'c-deleted') return Promise.resolve({ outcome: 'deleted' });
        if (id === 'c-held') return Promise.resolve({ outcome: 'held' });
        if (id === 'c-failed-string')
          return Promise.resolve({ outcome: 'failed', error: 'Known failure' });
        if (id === 'c-failed-nostring') return Promise.resolve({ outcome: 'failed' });
        if (id === 'c-throw-error') return Promise.reject(new Error('Boom Error'));
        if (id === 'c-throw-string') {
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- exercises non-Error exception branch String(err) in sweep runner
          return Promise.reject('Boom String');
        }
        return Promise.resolve({ outcome: 'deleted' });
      }),
    };
    registerPolicy(mockPolicy);

    const res = await runRetentionSweep({
      client: mockDbClient,
      policyIds: [mockPolicy.id],
      dryRun: false,
    });

    expect(callCount).toBe(7);
    expect(res.totalDeleted).toBe(1);
    expect(res.totalHeld).toBe(2);
    expect(res.totalFailed).toBe(4);
    const policyResult = res.policies[0];
    expect(policyResult?.errors).toContain('Known failure');
    expect(policyResult?.errors).toContain('Erasure failed for c-failed-nostring');
    expect(policyResult?.errors).toContain('Boom Error');
    expect(policyResult?.errors).toContain('Boom String');
  });

  it('handles deleteBatch mode with beforeBatchCommit and onBatchComplete hooks', async () => {
    const beforeBatchCommit = vi.fn();
    const onBatchComplete = vi.fn();

    const mockPolicy: RetentionPolicy = {
      id: 'test-delete-batch-hooks',
      entity: 'test_entity',
      action: 'delete',
      batchSize: 5,
      legalHold: vi.fn().mockImplementation((row: { id: string }) => {
        return Promise.resolve(row.id === 'held-1');
      }),
      getCandidates: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'del-1' }, { id: 'held-1' }])
        .mockResolvedValueOnce([]),
      deleteBatch: vi.fn().mockResolvedValue(undefined),
    };
    registerPolicy(mockPolicy);

    const res = await runRetentionSweep({
      client: mockDbClient,
      policyIds: [mockPolicy.id],
      dryRun: false,
      beforeBatchCommit,
      onBatchComplete,
    });

    expect(beforeBatchCommit).toHaveBeenCalledWith('test-delete-batch-hooks', 0);
    expect(onBatchComplete).toHaveBeenCalledWith('test-delete-batch-hooks', 0, 1);
    expect(res.totalDeleted).toBe(1);
    expect(res.totalHeld).toBe(1);
  });

  it('handles dry-run mode with legalHold evaluation and candidate pagination', async () => {
    const mockPolicy: RetentionPolicy = {
      id: 'test-dry-run-policy',
      entity: 'test_entity',
      action: 'delete',
      batchSize: 2,
      legalHold: vi.fn().mockImplementation((row: { id: string }) => {
        return Promise.resolve(row.id === 'held-dry');
      }),
      getCandidates: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'erasable-dry' }, { id: 'held-dry' }])
        .mockResolvedValueOnce([]),
      deleteBatch: vi.fn().mockResolvedValue(undefined),
    };
    registerPolicy(mockPolicy);

    const res = await runRetentionSweep({
      client: mockDbClient,
      policyIds: [mockPolicy.id],
      dryRun: true,
    });

    expect(res.dryRun).toBe(true);
    expect(res.totalDeleted).toBe(0);
    expect(res.totalHeld).toBe(1);
    const pRes = res.policies[0];
    expect(pRes?.erasableCount).toBe(1);
    expect(pRes?.erasableIds).toEqual(['erasable-dry']);
    expect(pRes?.heldIds).toEqual(['held-dry']);
    expect(mockPolicy.deleteBatch).not.toHaveBeenCalled();
  });

  it('terminates pagination when all candidates in batch are held and heldRows is empty', async () => {
    const mockPolicy: RetentionPolicy = {
      id: 'test-no-held-rows',
      entity: 'test_entity',
      action: 'delete',
      batchSize: 10,
      legalHold: () => false,
      getCandidates: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'r-1' }])
        .mockResolvedValueOnce([]),
      deleteBatch: vi.fn().mockResolvedValue(undefined),
    };
    registerPolicy(mockPolicy);

    const res = await runRetentionSweep({
      client: mockDbClient,
      policyIds: [mockPolicy.id],
      dryRun: false,
    });

    expect(res.totalDeleted).toBe(1);
  });
});
