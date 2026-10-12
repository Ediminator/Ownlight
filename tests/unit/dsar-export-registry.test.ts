import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  registerExportProvider,
  getExportProviders,
  resetExportProviders,
  clearExportProviders,
  collectExportData,
} from '@/server/privacy/export/registry';
import {
  registerCategoryDefinition,
  getCategoryDefinition,
  getAllCategoryDefinitions,
  resetCategoryRegistry,
} from '@/server/privacy/export/categories';
import { generateHtmlExport } from '@/server/privacy/export/html';
import type { ExportProvider } from '@/server/privacy/export/types';
import type { DbClient } from '@/server/db/client';

describe('TASK-0015: DSAR export provider registry', () => {
  beforeEach(() => {
    resetExportProviders();
    resetCategoryRegistry();
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

  it('handles missing contact and missing client branches in collectExportData', async () => {
    // Missing contact
    const mockTxNoContact = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      }),
    } as unknown as DbClient;

    const resNoContact = await collectExportData('unknown-contact', mockTxNoContact);
    expect(resNoContact).toBeNull();

    // Contact exists but client does not
    let count = 0;
    const mockTxNoClient = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              count++;
              if (count === 1) {
                return Promise.resolve([
                  {
                    id: 'c1',
                    clientId: 'b1',
                    isPrimary: false,
                    givenName: null,
                    familyName: null,
                    email: null,
                    phone: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                  },
                ]);
              }
              return Promise.resolve([]);
            },
          }),
        }),
      }),
    } as unknown as DbClient;

    const resNoClient = await collectExportData('c1', mockTxNoClient);
    expect(resNoClient).toBeNull();
  });

  it('handles non-array provider collection and anonymous contact naming', async () => {
    const contactRow = {
      id: 'c-secondary',
      clientId: 'b-company',
      isPrimary: false,
      givenName: null,
      familyName: null,
      email: null,
      phone: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    };

    const clientRow = {
      id: 'b-company',
      displayName: 'Acme Corp',
      kind: 'company',
      preferredLocale: 'de',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-02T00:00:00Z'),
    };

    clearExportProviders();
    // Provider returning single object instead of array
    registerExportProvider({
      id: 'single.item.provider',
      category: 'client_relationship',
      coveredTables: ['clients'],
      collect: () => Promise.resolve({ item: 'value' }),
    });

    let qCount = 0;
    const mockTx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              qCount++;
              if (qCount === 1) return Promise.resolve([contactRow]);
              if (qCount === 2) return Promise.resolve([clientRow]);
              return Promise.resolve([]);
            },
          }),
          limit: () => Promise.resolve([{ studio_name: 'Studio Test' }]),
        }),
      }),
    } as unknown as DbClient;

    const res = await collectExportData('c-secondary', mockTx);
    expect(res).not.toBeNull();
    expect(res?.exportData.subject.role).toBe('secondary');
    expect(res?.exportData.subject.display_name).toBe('Acme Corp');
    expect(res?.exportData.categories.client_relationship).toEqual([{ item: 'value' }]);
  });

  it('supports category definitions registry extensions', () => {
    const all = getAllCategoryDefinitions();
    expect(all.length).toBeGreaterThan(0);

    const notesDef = getCategoryDefinition('notes');
    expect(notesDef).toBeDefined();
    expect(notesDef?.id).toBe('notes');

    // Register custom category definition
    registerCategoryDefinition({
      id: 'custom_files',
      titleKey: 'privacy.export.categories.custom_files.title',
      purposeKey: 'privacy.export.categories.custom_files.purpose',
      lawfulBasisKey: 'privacy.export.categories.custom_files.lawful_basis',
      retentionKey: 'privacy.export.categories.custom_files.retention',
      recipientsKey: 'privacy.export.categories.custom_files.recipients',
      sourceKey: 'privacy.export.categories.custom_files.source',
      title: { en: 'Files', de: 'Dateien' },
      purpose: { en: 'File storage', de: 'Dateispeicherung' },
      lawfulBasis: { en: 'Art. 6(1)(b) GDPR', de: 'Art. 6 Abs. 1 lit. b DSGVO' },
      retention: { en: '1 year', de: '1 Jahr' },
      recipients: { en: 'None', de: 'Keine' },
      source: { en: 'Direct', de: 'Direkt' },
    });

    expect(getCategoryDefinition('custom_files')).toBeDefined();
    resetCategoryRegistry();
    expect(getCategoryDefinition('custom_files')).toBeUndefined();
  });

  it('renders empty notice when category has 0 items in HTML generator', () => {
    const exportData = {
      schema: 'ownlight.dsar.v1' as const,
      generated_at: new Date().toISOString(),
      studio: { name: 'Test Studio' },
      subject: {
        id: 's1',
        display_name: 'Empty Test',
        first_name: null,
        last_name: null,
        email: null,
        phone: null,
        role: 'primary' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      categories: {
        notes: [], // empty category items
      },
    };

    const html = generateHtmlExport(exportData, 'en');
    expect(html).toContain('No records stored in this category.');
  });

  it('generateExport handles null result and formats json and html', async () => {
    const { generateExport } = await import('@/server/privacy/export/service');

    // 1. Returns null when subject not found
    const nullRes = await generateExport({
      contactId: '00000000-0000-0000-0000-000000000000',
      format: 'json',
      locale: 'en',
      actorId: '01912345-6789-7abc-8def-012345678000',
      client: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      } as unknown as DbClient,
    });
    expect(nullRes).toBeNull();

    // 2. Uses defaultDb when options.client is undefined
    const mockRegistry = await import('@/server/privacy/export/registry');
    vi.spyOn(mockRegistry, 'collectExportData').mockResolvedValueOnce(null);
    const fallbackDbRes = await generateExport({
      contactId: '00000000-0000-0000-0000-000000000000',
      format: 'json',
      locale: 'en',
      actorId: '01912345-6789-7abc-8def-012345678000',
    });
    expect(fallbackDbRes).toBeNull();
  });

  it('subject provider handles name formatting and role branches', async () => {
    const providers = getExportProviders();
    const subjectProvider = providers.find((p) => p.id === 'subject');
    expect(subjectProvider).toBeDefined();
    if (!subjectProvider) {
      throw new Error('subjectProvider not found');
    }

    const dummyDb = {} as unknown as DbClient;
    const baseClient = {
      id: 'c1',
      kind: 'person' as const,
      displayName: 'Fallback Client',
      preferredLocale: 'en' as const,
      googleContactsSyncEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActivityAt: new Date(),
    };
    const baseContact = {
      id: 'ct1',
      clientId: 'c1',
      givenName: 'John' as string | null,
      familyName: null as string | null,
      email: null as string | null,
      emailNormalized: null as string | null,
      phone: null as string | null,
      isPrimary: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 1. Given name only
    const resGivenOnly = (await subjectProvider.collect(
      { clientId: 'c1', contactId: 'ct1', client: baseClient, contact: baseContact },
      dummyDb,
    )) as { display_name: string; role: string }[];
    expect(resGivenOnly[0]?.display_name).toBe('John');
    expect(resGivenOnly[0]?.role).toBe('secondary');

    // 2. Family name only
    const resFamilyOnly = (await subjectProvider.collect(
      {
        clientId: 'c1',
        contactId: 'ct2',
        client: baseClient,
        contact: {
          ...baseContact,
          id: 'ct2',
          givenName: null,
          familyName: 'Smith',
          isPrimary: true,
        },
      },
      dummyDb,
    )) as { display_name: string; role: string }[];
    expect(resFamilyOnly[0]?.display_name).toBe('Smith');
    expect(resFamilyOnly[0]?.role).toBe('primary');

    // 3. Both empty/null -> falls back to client.displayName
    const resNeither = (await subjectProvider.collect(
      {
        clientId: 'c1',
        contactId: 'ct3',
        client: { ...baseClient, displayName: 'Fallback Studio Client' },
        contact: { ...baseContact, id: 'ct3', givenName: '', familyName: null, isPrimary: false },
      },
      dummyDb,
    )) as { display_name: string; role: string }[];
    expect(resNeither[0]?.display_name).toBe('Fallback Studio Client');
  });
});
