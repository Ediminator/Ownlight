import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockExecuteRetentionSweep = vi.fn();
const mockProcessOutboxBatch = vi.fn();
const mockProcessEmailOutboxBatch = vi.fn();
const mockRunCalendarSyncWorker = vi.fn();

vi.mock('@/server/retention/runner', () => ({
  executeRetentionSweep: (...args: unknown[]): unknown =>
    mockExecuteRetentionSweep(...args) as unknown,
}));

vi.mock('@/server/integrations/google/sync-worker', () => ({
  processOutboxBatch: (...args: unknown[]): unknown => mockProcessOutboxBatch(...args) as unknown,
}));

vi.mock('@/server/email/outbox-processor', () => ({
  processEmailOutboxBatch: (...args: unknown[]): unknown =>
    mockProcessEmailOutboxBatch(...args) as unknown,
}));

vi.mock('@/server/worker/calendar-sync-worker', () => ({
  runCalendarSyncWorker: (...args: unknown[]): unknown =>
    mockRunCalendarSyncWorker(...args) as unknown,
}));

import { JobRegistry, registerDefaultJobs, type JobContext } from '@/server/worker/jobs';
import type { DbClient } from '@/server/db/client';

describe('Worker Jobs & Registry Branch Coverage Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('JobRegistry branch coverage', () => {
    it('rejects registration with empty or non-string id', () => {
      const registry = new JobRegistry();
      expect(() => {
        registry.register({
          id: '',
          intervalMs: 1000,
          run: () => Promise.resolve(undefined),
        });
      }).toThrow('Job id must be a non-empty string');

      expect(() => {
        registry.register({
          id: null as unknown as string,
          intervalMs: 1000,
          run: () => Promise.resolve(undefined),
        });
      }).toThrow('Job id must be a non-empty string');
    });

    it('rejects registration with invalid or non-positive intervalMs', () => {
      const registry = new JobRegistry();
      expect(() => {
        registry.register({
          id: 'test-job',
          intervalMs: 0,
          run: () => Promise.resolve(undefined),
        });
      }).toThrow('Job intervalMs must be a positive number for "test-job"');

      expect(() => {
        registry.register({
          id: 'test-job',
          intervalMs: -500,
          run: () => Promise.resolve(undefined),
        });
      }).toThrow('Job intervalMs must be a positive number for "test-job"');

      expect(() => {
        registry.register({
          id: 'test-job',
          intervalMs: '1000' as unknown as number,
          run: () => Promise.resolve(undefined),
        });
      }).toThrow('Job intervalMs must be a positive number for "test-job"');
    });

    it('rejects registration with non-function run property', () => {
      const registry = new JobRegistry();
      expect(() => {
        registry.register({
          id: 'test-job',
          intervalMs: 1000,
          run: 'not-a-function' as unknown as () => Promise<unknown>,
        });
      }).toThrow('Job run must be a function for "test-job"');
    });

    it('rejects duplicate job registration with identical id', () => {
      const registry = new JobRegistry();
      const job = {
        id: 'dup-job',
        intervalMs: 5000,
        run: () => Promise.resolve(undefined),
      };
      registry.register(job);
      expect(() => {
        registry.register(job);
      }).toThrow('Job with ID "dup-job" is already registered');
    });

    it('supports get, has, getAll, clear, and size accurately', () => {
      const registry = new JobRegistry();
      expect(registry.size).toBe(0);
      expect(registry.has('job-1')).toBe(false);
      expect(registry.get('job-1')).toBeUndefined();
      expect(registry.getAll()).toEqual([]);

      const job1 = { id: 'job-1', intervalMs: 2000, run: () => Promise.resolve(1) };
      const job2 = { id: 'job-2', intervalMs: 4000, run: () => Promise.resolve(2) };

      registry.register(job1);
      registry.register(job2);

      expect(registry.size).toBe(2);
      expect(registry.has('job-1')).toBe(true);
      expect(registry.has('job-2')).toBe(true);
      expect(registry.get('job-1')).toBe(job1);
      expect(registry.getAll()).toHaveLength(2);

      registry.clear();
      expect(registry.size).toBe(0);
      expect(registry.has('job-1')).toBe(false);
    });
  });

  describe('registerDefaultJobs branch coverage', () => {
    it('registers all default jobs when registry is empty and skips already registered jobs', () => {
      const registry = new JobRegistry();
      registerDefaultJobs(registry);

      expect(registry.size).toBe(4);
      expect(registry.has('retention-sweep')).toBe(true);
      expect(registry.has('google-contacts-outbox')).toBe(true);
      expect(registry.has('email-outbox-processor')).toBe(true);
      expect(registry.has('calendar-sync-worker')).toBe(true);

      // Calling registerDefaultJobs again triggers the negative (!has) branches
      registerDefaultJobs(registry);
      expect(registry.size).toBe(4);
    });

    it('executes run() handlers for all default registered jobs', async () => {
      const registry = new JobRegistry();
      registerDefaultJobs(registry);

      const mockDb = {} as DbClient;
      const mockSignal = new AbortController().signal;
      const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      const ctx: JobContext = {
        db: mockDb,
        signal: mockSignal,
        logger: mockLogger as unknown as JobContext['logger'],
      };

      // 1. retention-sweep
      mockExecuteRetentionSweep.mockResolvedValueOnce({
        totalDeleted: 5,
        totalHeld: 2,
      });
      const sweepJob = registry.get('retention-sweep');
      expect(sweepJob).toBeDefined();
      if (!sweepJob) throw new Error('Missing retention-sweep job');
      const sweepResult = await sweepJob.run(ctx);
      expect(sweepResult).toEqual({ totalDeleted: 5, totalHeld: 2 });
      expect(mockExecuteRetentionSweep).toHaveBeenCalledWith({
        dbClient: mockDb,
        dryRun: false,
        signal: mockSignal,
      });
      expect(mockLogger.info).toHaveBeenCalled();

      // 2. google-contacts-outbox
      mockProcessOutboxBatch.mockResolvedValueOnce({ processed: 3 });
      const googleJob = registry.get('google-contacts-outbox');
      expect(googleJob).toBeDefined();
      if (!googleJob) throw new Error('Missing google-contacts-outbox job');
      const googleResult = await googleJob.run(ctx);
      expect(googleResult).toEqual({ processed: 3 });
      expect(mockProcessOutboxBatch).toHaveBeenCalledWith({ dbClient: mockDb });

      // 3. email-outbox-processor
      mockProcessEmailOutboxBatch.mockResolvedValueOnce({ sent: 4 });
      const emailJob = registry.get('email-outbox-processor');
      expect(emailJob).toBeDefined();
      if (!emailJob) throw new Error('Missing email-outbox-processor job');
      const emailResult = await emailJob.run(ctx);
      expect(emailResult).toEqual({ sent: 4 });
      expect(mockProcessEmailOutboxBatch).toHaveBeenCalledWith({
        dbClient: mockDb,
        signal: mockSignal,
      });

      // 4. calendar-sync-worker (TASK-0046 / AC-3)
      mockRunCalendarSyncWorker.mockResolvedValueOnce({
        batchSize: 10,
        syncedCount: 1,
        failedCount: 0,
        durationMs: 42,
      });
      const calJob = registry.get('calendar-sync-worker');
      expect(calJob).toBeDefined();
      if (!calJob) throw new Error('Missing calendar-sync-worker job');
      const calResult = await calJob.run(ctx);
      expect(calResult).toEqual({
        batchSize: 10,
        syncedCount: 1,
        failedCount: 0,
        durationMs: 42,
      });
      expect(mockRunCalendarSyncWorker).toHaveBeenCalledWith({
        dbClient: mockDb,
      });
    });
  });
});
