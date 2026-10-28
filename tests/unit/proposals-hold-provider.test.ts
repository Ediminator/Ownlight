import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { proposalsHoldProvider } from '@/server/proposals/privacy/hold-provider';
import type { DbClient } from '@/server/db/client';

describe('TASK-0059: Proposals Commercial Hold Provider (AC-4)', () => {
  it('AC-4: returns active hold with code statutory.commercial_document when client has an accepted proposal', async () => {
    const acceptanceDate = new Date('2026-05-15T14:30:00.000Z');

    const mockTx = {
      select: () => ({
        from: () => ({
          where: () =>
            Promise.resolve([
              {
                id: '01910000-0000-7000-8000-000000000001',
                status: 'accepted',
                acceptedAt: acceptanceDate,
                updatedAt: acceptanceDate,
                createdAt: new Date('2026-05-01T10:00:00.000Z'),
              },
            ]),
        }),
      }),
    } as unknown as DbClient;

    const holds = await proposalsHoldProvider.holds(
      { kind: 'client', clientId: '01910000-0000-7000-8000-0000000000aa' },
      mockTx,
    );

    expect(holds).toHaveLength(1);
    const hold = holds[0];
    if (!hold) throw new Error('Expected hold');

    expect(hold.reason).toBe('statutory.commercial_document');
    // Lock date: 10 years from end of calendar year of acceptance (2026 -> 2036-12-31T23:59:59.999Z)
    expect(hold.retainUntil).toBe('2036-12-31T23:59:59.999Z');
  });

  it('AC-4: calculates retention lock date based on latest accepted proposal when multiple accepted proposals exist', async () => {
    const mockTx = {
      select: () => ({
        from: () => ({
          where: () =>
            Promise.resolve([
              {
                id: 'p-1',
                status: 'accepted',
                acceptedAt: new Date('2024-03-10T10:00:00.000Z'),
                updatedAt: new Date('2024-03-10T10:00:00.000Z'),
                createdAt: new Date('2024-03-01T10:00:00.000Z'),
              },
              {
                id: 'p-2',
                status: 'accepted',
                acceptedAt: new Date('2026-11-20T12:00:00.000Z'),
                updatedAt: new Date('2026-11-20T12:00:00.000Z'),
                createdAt: new Date('2026-11-15T12:00:00.000Z'),
              },
            ]),
        }),
      }),
    } as unknown as DbClient;

    const holds = await proposalsHoldProvider.holds(
      { kind: 'client', clientId: 'c-multiple' },
      mockTx,
    );

    expect(holds).toHaveLength(1);
    // Based on 2026 acceptance, not 2024
    expect(holds[0]?.retainUntil).toBe('2036-12-31T23:59:59.999Z');
  });

  it('AC-4: handles reverse order of proposals and fallback dates when acceptedAt is null', async () => {
    const mockTx = {
      select: () => ({
        from: () => ({
          where: () =>
            Promise.resolve([
              {
                id: 'p-newer',
                status: 'accepted',
                acceptedAt: null,
                updatedAt: new Date('2028-05-01T00:00:00.000Z'),
                createdAt: new Date('2028-01-01T00:00:00.000Z'),
              },
              {
                id: 'p-older',
                status: 'accepted',
                acceptedAt: null,
                updatedAt: new Date('2025-01-01T00:00:00.000Z'),
                createdAt: new Date('2025-01-01T00:00:00.000Z'),
              },
            ]),
        }),
      }),
    } as unknown as DbClient;

    const holds = await proposalsHoldProvider.holds(
      { kind: 'client', clientId: 'c-fallbacks' },
      mockTx,
    );

    expect(holds).toHaveLength(1);
    expect(holds[0]?.retainUntil).toBe('2038-12-31T23:59:59.999Z');
  });

  it('AC-4: returns zero holds when client has only unaccepted proposals (draft, sent, declined, expired)', async () => {
    const mockTx = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]), // No accepted proposals
        }),
      }),
    } as unknown as DbClient;

    const holds = await proposalsHoldProvider.holds(
      { kind: 'client', clientId: 'c-unaccepted' },
      mockTx,
    );

    expect(holds).toHaveLength(0);
  });

  it('AC-4: returns zero holds when client has no proposals at all', async () => {
    const mockTx = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    } as unknown as DbClient;

    const holds = await proposalsHoldProvider.holds(
      { kind: 'client', clientId: 'c-empty' },
      mockTx,
    );

    expect(holds).toHaveLength(0);
  });

  it('AC-4: ignores non-client subjects (lead, contact) and returns empty array', async () => {
    const mockTx = {} as DbClient;
    const leadHolds = await proposalsHoldProvider.holds(
      { kind: 'lead', leadId: 'lead-123' },
      mockTx,
    );
    expect(leadHolds).toEqual([]);

    const contactHolds = await proposalsHoldProvider.holds(
      { kind: 'contact', contactId: 'contact-1', clientId: 'client-1' },
      mockTx,
    );
    expect(contactHolds).toEqual([]);
  });
});
