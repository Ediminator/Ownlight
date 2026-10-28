import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerActivityProvider,
  getActivityProviders,
  clearActivityProviders,
  resetActivityProviders,
  findActiveClientIds,
  type ActivityProvider,
} from '@/server/clients/activity';
import type { DbClient } from '@/server/db/client';

describe('TASK-0019: Client activity provider registry and domain providers', () => {
  beforeEach(() => {
    resetActivityProviders();
  });

  it('resets and returns default activity providers (timeline, notes, consents, projects, proposals)', () => {
    const providers = getActivityProviders();
    expect(providers.map((p) => p.id)).toEqual([
      'timeline',
      'notes',
      'consents',
      'projects',
      'proposals',
    ]);

    clearActivityProviders();
    expect(getActivityProviders()).toHaveLength(0);

    resetActivityProviders();
    expect(getActivityProviders()).toHaveLength(5);
  });

  it('findActiveClientIds returns empty Set when candidateIds is empty', async () => {
    const mockTx = {} as DbClient;
    const since = new Date('2026-01-01T00:00:00Z');

    const result = await findActiveClientIds(mockTx, since, []);
    expect(result.size).toBe(0);
  });

  it('default activity providers return empty array when candidateIds is empty', async () => {
    const mockTx = {} as DbClient;
    const since = new Date('2026-01-01T00:00:00Z');
    const providers = getActivityProviders();

    for (const p of providers) {
      const activeIds = await p.activeClientIds(mockTx, since, []);
      expect(activeIds).toEqual([]);
    }
  });

  it('findActiveClientIds aggregates activity from multiple custom providers (array and Set)', async () => {
    clearActivityProviders();

    const providerA: ActivityProvider = {
      id: 'providerA',
      activeClientIds: () => Promise.resolve(['client-1', 'client-2']),
    };

    const providerB: ActivityProvider = {
      id: 'providerB',
      activeClientIds: () => Promise.resolve(new Set(['client-2', 'client-3'])),
    };

    registerActivityProvider(providerA);
    registerActivityProvider(providerB);

    const mockTx = {} as DbClient;
    const since = new Date('2026-01-01T00:00:00Z');

    const active = await findActiveClientIds(mockTx, since, ['client-1', 'client-2', 'client-3']);
    expect(Array.from(active).sort()).toEqual(['client-1', 'client-2', 'client-3']);
  });

  it('exercises timeline, notes, and consents providers with mock queries', async () => {
    const since = new Date('2026-01-01T00:00:00Z');

    const mockTimelineRows = [{ clientId: 'client-timeline' }];
    const mockConsentsRows = [{ clientId: 'client-consent' }];

    const mockTx = {
      selectDistinct: vi.fn().mockReturnValue({
        from: vi.fn().mockImplementation(() => {
          return {
            where: vi.fn().mockImplementation(() => {
              return Promise.resolve(mockTimelineRows);
            }),
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(mockConsentsRows),
            }),
          };
        }),
      }),
    } as unknown as DbClient;

    const timelineProvider = getActivityProviders().find((p) => p.id === 'timeline');
    expect(timelineProvider).toBeDefined();
    if (timelineProvider) {
      const resTimeline = await timelineProvider.activeClientIds(mockTx, since, [
        'client-timeline',
      ]);
      expect(resTimeline).toEqual(['client-timeline']);
    }

    const consentsProvider = getActivityProviders().find((p) => p.id === 'consents');
    expect(consentsProvider).toBeDefined();
    if (consentsProvider) {
      const resConsents = await consentsProvider.activeClientIds(mockTx, since, ['client-consent']);
      expect(resConsents).toEqual(['client-consent']);
    }
  });
});
