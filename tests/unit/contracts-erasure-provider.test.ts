import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import * as PrivacyModule from '@/server/contracts/privacy/index';
import {
  contractsErasureProvider,
  createContractsErasureProvider,
  isContractErasable,
} from '@/server/contracts/privacy/erasure-provider';
import type { DbClient } from '@/server/db/client';

describe('TASK-0066: Contracts Erasure Provider Unit Tests (AC-3, AC-4, AC-5)', () => {
  it('exports all expected contract privacy providers from barrel index', () => {
    expect(PrivacyModule.contractsExportProvider).toBeDefined();
    expect(PrivacyModule.contractsErasureProvider).toBeDefined();
    expect(PrivacyModule.contractsHoldProvider).toBeDefined();
    expect(PrivacyModule.contractsActivityProvider).toBeDefined();
  });

  it('AC-3 & AC-5: isContractErasable marks unexecuted and expired signed contracts as erasable, protecting active signed contracts', () => {
    const now = new Date('2026-11-25T00:00:00.000Z');

    expect(
      isContractErasable(
        {
          status: 'draft',
          clientSignedAt: null,
          studioSignedAt: null,
          updatedAt: now,
          createdAt: now,
        },
        now,
      ),
    ).toBe(true);

    expect(
      isContractErasable(
        {
          status: 'declined',
          clientSignedAt: null,
          studioSignedAt: null,
          updatedAt: now,
          createdAt: now,
        },
        now,
      ),
    ).toBe(true);

    expect(
      isContractErasable(
        {
          status: 'voided',
          clientSignedAt: null,
          studioSignedAt: null,
          updatedAt: now,
          createdAt: now,
        },
        now,
      ),
    ).toBe(true);

    // Active signed contract (signed 2024 -> locked until 2034-12-31)
    expect(
      isContractErasable(
        {
          status: 'signed',
          clientSignedAt: new Date('2024-06-01T00:00:00.000Z'),
          studioSignedAt: new Date('2024-06-01T00:00:00.000Z'),
          updatedAt: new Date('2024-06-01T00:00:00.000Z'),
          createdAt: new Date('2024-06-01T00:00:00.000Z'),
        },
        now,
      ),
    ).toBe(false);

    // Expired signed contract (signed 2014 -> locked until 2024-12-31 -> expired in 2026)
    expect(
      isContractErasable(
        {
          status: 'signed',
          clientSignedAt: new Date('2014-06-01T00:00:00.000Z'),
          studioSignedAt: new Date('2014-06-01T00:00:00.000Z'),
          updatedAt: new Date('2014-06-01T00:00:00.000Z'),
          createdAt: new Date('2014-06-01T00:00:00.000Z'),
        },
        now,
      ),
    ).toBe(true);
  });

  it('AC-3: plan returns 0 for non-client subjects and counts only erasable contracts', async () => {
    expect(
      await contractsErasureProvider.plan({ kind: 'lead', leadId: 'lead-1' }, {} as DbClient),
    ).toBe(0);
    expect(
      await contractsErasureProvider.plan(
        { kind: 'contact', contactId: 'ct-1', clientId: 'c-1' },
        {} as DbClient,
      ),
    ).toBe(0);

    const now = new Date('2026-11-25T00:00:00.000Z');
    const provider = createContractsErasureProvider({ now: () => now });
    const tx = {
      select: () => ({
        from: () => ({
          where: () =>
            Promise.resolve([
              {
                id: 'c-draft',
                status: 'draft',
                clientSignedAt: null,
                studioSignedAt: null,
                updatedAt: now,
                createdAt: now,
                pdfStorageKey: null,
              },
              {
                id: 'c-voided',
                status: 'voided',
                clientSignedAt: null,
                studioSignedAt: null,
                updatedAt: now,
                createdAt: now,
                pdfStorageKey: null,
              },
              {
                id: 'c-signed-active',
                status: 'signed',
                clientSignedAt: new Date('2025-01-01T00:00:00.000Z'),
                studioSignedAt: new Date('2025-01-01T00:00:00.000Z'),
                updatedAt: new Date('2025-01-01T00:00:00.000Z'),
                createdAt: new Date('2025-01-01T00:00:00.000Z'),
                pdfStorageKey: 'contracts/2025/CTR-1.pdf',
              },
            ]),
        }),
      }),
    } as unknown as DbClient;

    expect(await provider.plan({ kind: 'client', clientId: 'client-1' }, tx)).toBe(2);
  });

  it('AC-3: erase deletes unexecuted contracts, invokes storage cleanup for unsealed assets, and returns deletion count', async () => {
    expect(
      await contractsErasureProvider.erase({ kind: 'lead', leadId: 'lead-1' }, {} as DbClient),
    ).toBe(0);

    const deletedAssets: string[] = [];
    const now = new Date('2026-11-25T00:00:00.000Z');
    const provider = createContractsErasureProvider({
      now: () => now,
      deleteStorageAsset: (key) => {
        deletedAssets.push(key);
        return Promise.resolve();
      },
    });

    const tx = {
      select: () => ({
        from: () => ({
          where: () =>
            Promise.resolve([
              {
                id: 'ctr-draft',
                status: 'draft',
                clientSignedAt: null,
                studioSignedAt: null,
                updatedAt: now,
                createdAt: now,
                pdfStorageKey: 'contracts/drafts/ephemeral.pdf',
              },
              {
                id: 'ctr-declined',
                status: 'declined',
                clientSignedAt: null,
                studioSignedAt: null,
                updatedAt: now,
                createdAt: now,
                pdfStorageKey: null,
              },
            ]),
        }),
      }),
      delete: () => ({
        where: () => ({
          returning: () => Promise.resolve([{ id: 'ctr-draft' }, { id: 'ctr-declined' }]),
        }),
      }),
    } as unknown as DbClient;

    const deletedCount = await provider.erase({ kind: 'client', clientId: 'client-1' }, tx);
    expect(deletedCount).toBe(2);
    expect(deletedAssets).toEqual(['contracts/drafts/ephemeral.pdf']);
  });

  it('AC-3: erase returns 0 when client has no erasable contracts', async () => {
    const tx = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    } as unknown as DbClient;

    expect(
      await contractsErasureProvider.erase({ kind: 'client', clientId: 'client-empty' }, tx),
    ).toBe(0);
  });
});
