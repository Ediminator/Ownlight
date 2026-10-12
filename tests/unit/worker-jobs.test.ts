import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { JobRegistry, type WorkerJob } from '@/server/worker/jobs';

describe('TASK-0022: Worker Job Registry Unit Tests', () => {
  it('registers a valid job and retrieves it by ID', () => {
    const registry = new JobRegistry();
    const job: WorkerJob = {
      id: 'test-job',
      intervalMs: 5000,
      run: vi.fn().mockResolvedValue({ success: true }),
    };

    registry.register(job);
    expect(registry.has('test-job')).toBe(true);
    expect(registry.get('test-job')).toBe(job);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.size).toBe(1);
  });

  it('rejects duplicate job ID registration with descriptive error', () => {
    const registry = new JobRegistry();
    const job1: WorkerJob = {
      id: 'duplicate-id',
      intervalMs: 5000,
      run: vi.fn(),
    };
    const job2: WorkerJob = {
      id: 'duplicate-id',
      intervalMs: 10000,
      run: vi.fn(),
    };

    registry.register(job1);
    expect(() => {
      registry.register(job2);
    }).toThrow(/already registered/i);
  });

  it('validates job schema on registration (id, intervalMs, run)', () => {
    const registry = new JobRegistry();

    expect(() => {
      registry.register({
        id: '',
        intervalMs: 1000,
        run: vi.fn(),
      });
    }).toThrow(/non-empty string/i);

    expect(() => {
      registry.register({
        id: 'bad-interval',
        intervalMs: 0,
        run: vi.fn(),
      });
    }).toThrow(/positive number/i);

    expect(() => {
      registry.register({
        id: 'bad-interval-negative',
        intervalMs: -500,
        run: vi.fn(),
      });
    }).toThrow(/positive number/i);

    expect(() => {
      registry.register({
        id: 'bad-run',
        intervalMs: 1000,
        run: undefined as unknown as WorkerJob['run'],
      });
    }).toThrow(/function/i);
  });

  it('clears all registered jobs', () => {
    const registry = new JobRegistry();
    registry.register({ id: 'job-1', intervalMs: 1000, run: vi.fn() });
    registry.register({ id: 'job-2', intervalMs: 2000, run: vi.fn() });
    expect(registry.size).toBe(2);

    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.has('job-1')).toBe(false);
    expect(registry.getAll()).toHaveLength(0);
  });
});
