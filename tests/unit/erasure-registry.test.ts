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
    expect(getErasureHoldProviders()).toHaveLength(0);

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
    expect(getErasureHoldProviders()).toHaveLength(1);
    expect(getErasureHoldProviders()[0]?.id).toBe('statutory_invoice');

    clearErasureHoldProviders();
    expect(getErasureHoldProviders()).toHaveLength(0);

    registerErasureHoldProvider(testHoldProvider);
    resetErasureHoldProviders();
    expect(getErasureHoldProviders()).toHaveLength(0);
  });
});
