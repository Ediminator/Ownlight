import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  registerErasureProvider,
  getErasureProviders,
  clearErasureProviders,
  resetErasureProviders,
  registerErasureHoldProvider,
  getErasureHoldProviders,
  clearErasureHoldProviders,
  resetErasureHoldProviders,
} from '@/server/privacy/erasure/registry';
import type { ErasureProvider, ErasureHoldProvider } from '@/server/privacy/erasure/types';

describe('Erasure & Hold Provider Registries', () => {
  beforeEach(() => {
    resetErasureProviders();
    resetErasureHoldProviders();
  });

  it('initialises default domain erasure providers', () => {
    const providers = getErasureProviders();
    const categories = providers.map((p) => p.category);

    expect(categories).toContain('consents');
    expect(categories).toContain('timeline');
    expect(categories).toContain('notes');
    expect(categories).toContain('tags');
    expect(categories).toContain('addresses');
    expect(categories).toContain('contacts');
    expect(categories).toContain('client');
  });

  it('allows registering and clearing custom erasure providers', () => {
    const customProvider: ErasureProvider = {
      id: 'custom_archive',
      category: 'archive',
      coveredTables: ['archive_items'],
      plan: () => Promise.resolve(5),
      erase: () => Promise.resolve(5),
    };

    registerErasureProvider(customProvider);
    expect(getErasureProviders().map((p) => p.id)).toContain('custom_archive');

    clearErasureProviders();
    expect(getErasureProviders()).toHaveLength(0);

    resetErasureProviders();
    expect(getErasureProviders().length).toBeGreaterThanOrEqual(7);
  });

  it('allows registering and clearing hold providers', () => {
    expect(getErasureHoldProviders().length).toBeGreaterThanOrEqual(1);
    expect(getErasureHoldProviders().map((p) => p.id)).toContain('client_legal_hold');

    const testHoldProvider: ErasureHoldProvider = {
      id: 'statutory_invoice',
      holds: () =>
        Promise.resolve([
          {
            reason: 'statutory.invoice',
            retainUntil: new Date('2036-12-31T23:59:59Z'),
          },
        ]),
    };

    registerErasureHoldProvider(testHoldProvider);
    expect(getErasureHoldProviders().map((p) => p.id)).toContain('statutory_invoice');

    clearErasureHoldProviders();
    expect(getErasureHoldProviders()).toHaveLength(0);

    registerErasureHoldProvider(testHoldProvider);
    resetErasureHoldProviders();
    expect(getErasureHoldProviders().length).toBeGreaterThanOrEqual(1);
    expect(getErasureHoldProviders().map((p) => p.id)).toContain('client_legal_hold');
  });

  describe('default erasure and hold provider execution', () => {
    it('exercises legal_hold and client erasure providers for client and contact subjects', async () => {
      const providers = getErasureProviders();
      const legalHoldProvider = providers.find((p) => p.id === 'legal_hold');
      const clientProvider = providers.find((p) => p.id === 'client');

      expect(legalHoldProvider).toBeDefined();
      expect(clientProvider).toBeDefined();

      const mockTx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 1 }]),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'row-1' }]),
          }),
        }),
      } as unknown as Parameters<NonNullable<typeof legalHoldProvider>['plan']>[1];

      // 1. legal_hold provider
      if (legalHoldProvider) {
        // Contact subject returns 0 for both plan and erase
        const contactSubject = {
          kind: 'contact' as const,
          clientId: 'c-1',
          contactId: 'ct-1',
        };
        expect(await legalHoldProvider.plan(contactSubject, mockTx)).toBe(0);
        expect(await legalHoldProvider.erase(contactSubject, mockTx)).toBe(0);

        // Client subject queries db
        const clientSubject = { kind: 'client' as const, clientId: 'c-1' };
        expect(await legalHoldProvider.plan(clientSubject, mockTx)).toBe(1);
        expect(await legalHoldProvider.erase(clientSubject, mockTx)).toBe(1);
      }

      // 2. client provider
      if (clientProvider) {
        // Contact subject returns 0 for both plan and erase
        const contactSubject = {
          kind: 'contact' as const,
          clientId: 'c-1',
          contactId: 'ct-1',
        };
        expect(await clientProvider.plan(contactSubject, mockTx)).toBe(0);
        expect(await clientProvider.erase(contactSubject, mockTx)).toBe(0);

        // Client subject queries db
        const clientSubject = { kind: 'client' as const, clientId: 'c-1' };
        expect(await clientProvider.plan(clientSubject, mockTx)).toBe(1);
        expect(await clientProvider.erase(clientSubject, mockTx)).toBe(1);
      }
    });

    it('exercises client_legal_hold hold provider across all branches', async () => {
      const holdProviders = getErasureHoldProviders();
      const clientHoldProvider = holdProviders.find((p) => p.id === 'client_legal_hold');
      expect(clientHoldProvider).toBeDefined();

      if (!clientHoldProvider) return;

      // Client subject with no hold in db
      const mockTxEmpty = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as never;
      const noHoldRes = await clientHoldProvider.holds(
        { kind: 'client', clientId: 'c-1' },
        mockTxEmpty,
      );
      expect(noHoldRes).toEqual([]);

      // Client subject with active hold (until in future)
      const mockTxActive = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  reason: 'dispute',
                  until: '2030-12-31',
                },
              ]),
            }),
          }),
        }),
      } as never;
      const activeRes = await clientHoldProvider.holds(
        { kind: 'client', clientId: 'c-1' },
        mockTxActive,
      );
      expect(activeRes).toHaveLength(1);
      expect(activeRes[0]?.reason).toBe('manual.dispute');
      expect(activeRes[0]?.retainUntil).toBe('2030-12-31');

      // Client subject with expired hold (until in past)
      const mockTxExpired = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  reason: 'statutory',
                  until: '2020-01-01',
                },
              ]),
            }),
          }),
        }),
      } as never;
      const expiredRes = await clientHoldProvider.holds(
        { kind: 'client', clientId: 'c-1' },
        mockTxExpired,
      );
      expect(expiredRes).toEqual([]);
    });

    it('exercises contacts erasure provider for contact subject branches (not found, primary with oldest, secondary)', async () => {
      const providers = getErasureProviders();
      const contactsProvider = providers.find((p) => p.id === 'contacts');
      expect(contactsProvider).toBeDefined();

      if (!contactsProvider) return;

      // 1. Contact subject not found
      const mockTxNotFound = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as never;
      const resNotFound = await contactsProvider.erase(
        { kind: 'contact', clientId: 'c-1', contactId: 'ct-notfound' },
        mockTxNotFound,
      );
      expect(resNotFound).toBe(0);

      // 2. Contact subject is primary and oldest remaining contact exists
      const mockTxPrimary = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValueOnce([{ id: 'ct-primary', isPrimary: true }]),
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValueOnce([{ id: 'ct-oldest' }]),
              }),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'ct-primary' }]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      } as never;

      const resPrimary = await contactsProvider.erase(
        { kind: 'contact', clientId: 'c-1', contactId: 'ct-primary' },
        mockTxPrimary,
      );
      expect(resPrimary).toBe(1);

      // 3. Contact subject is secondary (not primary)
      const mockTxSecondary = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValueOnce([{ id: 'ct-sec', isPrimary: false }]),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'ct-sec' }]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      } as never;

      const resSecondary = await contactsProvider.erase(
        { kind: 'contact', clientId: 'c-1', contactId: 'ct-sec' },
        mockTxSecondary,
      );
      expect(resSecondary).toBe(1);
    });
  });
});
