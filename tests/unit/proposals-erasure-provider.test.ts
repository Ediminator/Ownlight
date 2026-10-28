import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import * as PrivacyModule from '@/server/proposals/privacy/index';
import { proposalsErasureProvider } from '@/server/proposals/privacy/index';
import type { DbClient } from '@/server/db/client';

describe('TASK-0059: Proposals Erasure Provider Unit Tests (AC-3)', () => {
  it('exports all expected providers from privacy barrel index', () => {
    expect(PrivacyModule.proposalsErasureProvider).toBeDefined();
    expect(PrivacyModule.proposalsHoldProvider).toBeDefined();
    expect(PrivacyModule.proposalsExportProvider).toBeDefined();
    expect(PrivacyModule.proposalsActivityProvider).toBeDefined();
  });

  it('plan: returns 0 when subject is not a client', async () => {
    const tx = {} as DbClient;
    const planCount = await proposalsErasureProvider.plan({ kind: 'lead', leadId: 'lead-1' }, tx);
    expect(planCount).toBe(0);

    const contactPlanCount = await proposalsErasureProvider.plan(
      { kind: 'contact', contactId: 'contact-1', clientId: 'client-1' },
      tx,
    );
    expect(contactPlanCount).toBe(0);
  });

  it('plan: returns count of unaccepted proposals for client and handles undefined row', async () => {
    const tx = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ count: 3 }]),
        }),
      }),
    } as unknown as DbClient;

    const count = await proposalsErasureProvider.plan({ kind: 'client', clientId: 'client-1' }, tx);
    expect(count).toBe(3);

    const txEmpty = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    } as unknown as DbClient;

    const countZero = await proposalsErasureProvider.plan(
      { kind: 'client', clientId: 'client-1' },
      txEmpty,
    );
    expect(countZero).toBe(0);
  });

  it('erase: returns 0 when subject is not a client', async () => {
    const tx = {} as DbClient;
    const deleted = await proposalsErasureProvider.erase({ kind: 'lead', leadId: 'lead-1' }, tx);
    expect(deleted).toBe(0);
  });

  it('erase: returns 0 when client has no unaccepted proposals', async () => {
    const tx = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    } as unknown as DbClient;

    const deleted = await proposalsErasureProvider.erase(
      { kind: 'client', clientId: 'client-1' },
      tx,
    );
    expect(deleted).toBe(0);
  });

  it('erase: deletes proposal line items and proposals when unaccepted proposals exist', async () => {
    let deletedLineItems = false;
    let deletedProposals = false;

    const tx = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ id: 'prop-1' }, { id: 'prop-2' }]),
        }),
      }),
      delete: () => ({
        where: () => {
          if (!deletedLineItems) {
            deletedLineItems = true;
            return Promise.resolve();
          }
          deletedProposals = true;
          return {
            returning: () => Promise.resolve([{ id: 'prop-1' }, { id: 'prop-2' }]),
          };
        },
      }),
    } as unknown as DbClient;

    const count = await proposalsErasureProvider.erase(
      { kind: 'client', clientId: 'client-1' },
      tx,
    );

    expect(count).toBe(2);
    expect(deletedLineItems).toBe(true);
    expect(deletedProposals).toBe(true);
  });
});
