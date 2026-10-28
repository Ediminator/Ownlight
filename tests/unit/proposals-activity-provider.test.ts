import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { proposalsActivityProvider } from '@/server/proposals/privacy';
import type { DbClient } from '@/server/db/client';

describe('TASK-0059: Proposals Activity Provider Unit Tests', () => {
  it('returns empty array when candidateIds is empty', async () => {
    const tx = {} as DbClient;
    const res = await proposalsActivityProvider.activeClientIds(tx, new Date(), []);
    expect(res).toEqual([]);
  });

  it('identifies clients with active status proposals and recent activity', async () => {
    let callCount = 0;
    const tx = {
      selectDistinct: () => ({
        from: () => ({
          where: () => {
            callCount++;
            if (callCount === 1) {
              // active status proposals (draft, sent, accepted)
              return Promise.resolve([{ clientId: 'client-1' }]);
            }
            // recent updates or valid until
            return Promise.resolve([{ clientId: 'client-2' }, { clientId: 'client-1' }]);
          },
        }),
      }),
    } as unknown as DbClient;

    const res = await proposalsActivityProvider.activeClientIds(
      tx,
      new Date('2026-01-01T00:00:00Z'),
      ['client-1', 'client-2', 'client-3'],
    );

    expect(res).toHaveLength(2);
    expect(res).toContain('client-1');
    expect(res).toContain('client-2');
    expect(res).not.toContain('client-3');
  });

  it('returns empty array when no candidates have active or recent proposals', async () => {
    const tx = {
      selectDistinct: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    } as unknown as DbClient;

    const res = await proposalsActivityProvider.activeClientIds(
      tx,
      new Date('2026-01-01T00:00:00Z'),
      ['client-inactive'],
    );

    expect(res).toEqual([]);
  });
});
