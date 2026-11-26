import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { contractsActivityProvider } from '@/server/contracts/privacy/activity-provider';
import { getActivityProviders, resetActivityProviders } from '@/server/clients/activity';
import type { DbClient } from '@/server/db/client';

describe('TASK-0066: Contracts Activity Provider Unit Tests (AC-6)', () => {
  it('AC-6: registers contracts activity provider in default activity registry', () => {
    resetActivityProviders();
    const providers = getActivityProviders();
    expect(providers.map((p) => p.id)).toContain('contracts');
  });

  it('AC-6: returns empty array when candidateIds is empty', async () => {
    const res = await contractsActivityProvider.activeClientIds({} as DbClient, new Date(), []);
    expect(res).toEqual([]);
  });

  it('AC-6: identifies clients with active contracts or contracts issued/signed within window', async () => {
    let callCount = 0;
    const tx = {
      selectDistinct: () => ({
        from: () => ({
          where: () => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve([{ clientId: 'client-active-status' }]);
            }
            return Promise.resolve([
              { clientId: 'client-recent-signed' },
              { clientId: 'client-active-status' },
            ]);
          },
        }),
      }),
    } as unknown as DbClient;

    const res = await contractsActivityProvider.activeClientIds(
      tx,
      new Date('2024-01-01T00:00:00.000Z'),
      ['client-active-status', 'client-recent-signed', 'client-stale'],
    );

    expect(res).toHaveLength(2);
    expect(res).toContain('client-active-status');
    expect(res).toContain('client-recent-signed');
    expect(res).not.toContain('client-stale');
  });
});
