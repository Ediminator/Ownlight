import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  registerExportProvider,
  getExportProviders,
  resetExportProviders,
  clearExportProviders,
  collectExportData,
} from '@/server/privacy/export/registry';
import type { ExportProvider } from '@/server/privacy/export/types';
import type { DbClient } from '@/server/db/client';

describe('TASK-0015: DSAR export provider registry', () => {
  beforeEach(() => {
    resetExportProviders();
  });

  it('provides all default providers out of the box', () => {
    const providers = getExportProviders();
    const ids = providers.map((p) => p.id);
    expect(ids).toContain('subject');
    expect(ids).toContain('client');
    expect(ids).toContain('addresses');
    expect(ids).toContain('tags');
    expect(ids).toContain('notes');
    expect(ids).toContain('timeline');
    expect(ids).toContain('consents');
    expect(ids).toContain('audit');
  });

  it('allows registering a custom export provider', () => {
    const customProvider: ExportProvider = {
      id: 'custom.provider',
      category: 'custom_category',
      coveredTables: ['custom_table'],
      collect: () => Promise.resolve([{ key: 'value' }]),
    };

    registerExportProvider(customProvider);
    const providers = getExportProviders();
    expect(providers.find((p) => p.id === 'custom.provider')).toBeDefined();
  });

  it('resets back to default providers on resetExportProviders', () => {
    const customProvider: ExportProvider = {
      id: 'custom.ephemeral',
      category: 'ephemeral',
      coveredTables: [],
      collect: () => Promise.resolve([]),
    };
    registerExportProvider(customProvider);
    expect(getExportProviders().find((p) => p.id === 'custom.ephemeral')).toBeDefined();

    resetExportProviders();
    expect(getExportProviders().find((p) => p.id === 'custom.ephemeral')).toBeUndefined();
  });

  it('collects data and formats subject without email_normalized', async () => {
    const contactRow = {
      id: 'c0000000-0000-4000-8000-000000000001',
      clientId: 'b0000000-0000-4000-8000-000000000001',
      isPrimary: true,
      givenName: 'Alice',
      familyName: 'Smith',
      email: 'alice@example.com',
      emailNormalized: 'alice@example.com',
      phone: '+49 151 12345678',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    };

    const clientRow = {
      id: 'b0000000-0000-4000-8000-000000000001',
      displayName: 'Alice Smith',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-02T00:00:00Z'),
    };

    // Clear registry and add only controlled test provider
    clearExportProviders();
    const testProvider: ExportProvider = {
      id: 'test.notes',
      category: 'notes',
      coveredTables: ['client_notes'],
      collect: () => Promise.resolve([{ id: 'n1', body: 'Test note' }]),
    };
    registerExportProvider(testProvider);

    let queryCount = 0;
    const mockFrom = {
      where: () => ({
        limit: () => {
          queryCount++;
          if (queryCount === 1) return Promise.resolve([contactRow]);
          if (queryCount === 2) return Promise.resolve([clientRow]);
          return Promise.resolve([]);
        },
      }),
      limit: () => Promise.resolve([{ studio_name: 'Lumière Photo' }]),
    };
    const mockTx = {
      select: () => ({
        from: () => mockFrom,
      }),
    } as unknown as DbClient;

    const result = await collectExportData(contactRow.id, mockTx);
    expect(result).not.toBeNull();
    if (!result) return;

    const collected = result.exportData;
    expect(collected.schema).toBe('ownlight.dsar.v1');
    expect(collected.subject.id).toBe('c0000000-0000-4000-8000-000000000001');
    expect(collected.subject.display_name).toBe('Alice Smith');
    expect(collected.subject.first_name).toBe('Alice');
    expect(collected.subject.last_name).toBe('Smith');
    expect(collected.subject.email).toBe('alice@example.com');
    // Ensure email_normalized is not exposed in subject
    expect(
      (collected.subject as unknown as Record<string, unknown>).email_normalized,
    ).toBeUndefined();
    expect(
      (collected.subject as unknown as Record<string, unknown>).emailNormalized,
    ).toBeUndefined();

    expect(collected.categories.notes).toEqual([{ id: 'n1', body: 'Test note' }]);
  });
});
