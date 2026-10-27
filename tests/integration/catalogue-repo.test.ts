import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mockCookiesStore = new Map<string, string>();
const mockHeadersStore = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const val = mockCookiesStore.get(name);
        return val ? { name, value: val } : undefined;
      },
      set: (name: string, value: string) => {
        mockCookiesStore.set(name, value);
      },
      delete: (name: string) => {
        mockCookiesStore.delete(name);
      },
    }),
  headers: () =>
    Promise.resolve({
      get: (name: string) => mockHeadersStore.get(name.toLowerCase()) ?? null,
    }),
}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import type { DbClient } from '@/server/db/client';
import { user } from '@/server/db/schema/auth';
import { catalogueItems } from '@/server/db/schema/packages';
import { auditEvents } from '@/server/db/schema/audit';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { eq, desc } from 'drizzle-orm';
import {
  createCatalogueItem,
  updateCatalogueItem,
  deleteCatalogueItem,
  getCatalogueItemById,
  getCatalogueItemBySlug,
  listCatalogueItems,
} from '@/server/catalogue/repo';

describe('TASK-0056: Catalogue Repository Integration Tests (AC-4, AC-5, AC-7, AC-8)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();

    const [insertedUser] = await dbClient
      .insert(user)
      .values({
        id: '01920000-0000-7000-8000-000000000001',
        name: 'Studio Owner',
        email: 'owner@example.org',
        role: 'owner',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!insertedUser) throw new Error('Expected user to be inserted');
    ownerUser = insertedUser;

    const sessionRecord = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRecord.token;
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
  });

  afterEach(async () => {
    mockCookiesStore.clear();
    mockHeadersStore.clear();
    await testDb.destroy();
  });

  it('AC-4: createCatalogueItem inserts item with UUIDv7 and emits catalogue_item.created', async () => {
    const item = await createCatalogueItem(
      {
        name: 'Second Photographer (Full Day)',
        slug: 'second-photographer-full-day',
        description: 'Experienced assistant shooter for comprehensive angles',
        category: 'service',
        unitPriceMinor: 65000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 1,
        isActive: true,
      },
      dbClient,
    );

    expect(item).toBeDefined();
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(item.name).toBe('Second Photographer (Full Day)');
    expect(item.slug).toBe('second-photographer-full-day');
    expect(item.category).toBe('service');
    expect(item.unitPriceMinor).toBe(65000);

    // Retrieve by ID
    const byId = await getCatalogueItemById(item.id, dbClient);
    expect(byId?.id).toBe(item.id);

    // Retrieve by Slug
    const bySlug = await getCatalogueItemBySlug('second-photographer-full-day', dbClient);
    expect(bySlug?.id).toBe(item.id);

    // Audit log
    const [auditLog] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'catalogue_item.created'))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);

    expect(auditLog).toBeDefined();
    expect(auditLog?.targetId).toBe(item.id);
    expect(auditLog?.targetType).toBe('catalogue_item');
  });

  it('AC-5: updateCatalogueItem modifies properties and emits catalogue_item.updated', async () => {
    const item = await createCatalogueItem(
      {
        name: 'Fine Art Album 20x20',
        slug: 'album-20x20',
        category: 'product',
        unitPriceMinor: 40000,
      },
      dbClient,
    );

    const updated = await updateCatalogueItem(
      item.id,
      {
        name: 'Fine Art Album 25x25 (Upgraded)',
        unitPriceMinor: 52000,
      },
      dbClient,
    );

    expect(updated.name).toBe('Fine Art Album 25x25 (Upgraded)');
    expect(updated.unitPriceMinor).toBe(52000);

    // Audit log
    const [auditLog] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'catalogue_item.updated'))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);

    expect(auditLog).toBeDefined();
    expect(auditLog?.targetId).toBe(item.id);
  });

  it('AC-5: deleteCatalogueItem soft-deactivates item with is_active = false and emits catalogue_item.deleted', async () => {
    const item = await createCatalogueItem(
      {
        name: 'Obsolete Rental Lens',
        slug: 'obsolete-rental-lens',
        category: 'product',
        unitPriceMinor: 5000,
      },
      dbClient,
    );

    await deleteCatalogueItem(item.id, dbClient);

    const [dbItem] = await dbClient
      .select()
      .from(catalogueItems)
      .where(eq(catalogueItems.id, item.id));
    expect(dbItem).toBeDefined();
    expect(dbItem?.isActive).toBe(false);

    // Listing active items filters it out
    const activeItems = await listCatalogueItems({ isActive: true }, dbClient);
    expect(activeItems.some((i) => i.id === item.id)).toBe(false);

    // Audit log
    const [auditLog] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'catalogue_item.deleted'))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);

    expect(auditLog).toBeDefined();
    expect(auditLog?.targetId).toBe(item.id);
  });

  it('AC-7: rejects unauthenticated caller with UNAUTHENTICATED', async () => {
    mockCookiesStore.clear();

    await expect(
      createCatalogueItem(
        {
          name: 'Unauth Item',
          slug: 'unauth-item',
          category: 'service',
          unitPriceMinor: 1000,
        },
        dbClient,
      ),
    ).rejects.toThrow('UNAUTHENTICATED');

    await expect(
      updateCatalogueItem('01920000-0000-7000-8000-000000000099', { name: 'Updated' }, dbClient),
    ).rejects.toThrow('UNAUTHENTICATED');

    await expect(
      deleteCatalogueItem('01920000-0000-7000-8000-000000000099', dbClient),
    ).rejects.toThrow('UNAUTHENTICATED');

    await expect(listCatalogueItems({}, dbClient)).rejects.toThrow('UNAUTHENTICATED');
    await expect(getCatalogueItemById('dummy-id', dbClient)).rejects.toThrow('UNAUTHENTICATED');
    await expect(getCatalogueItemBySlug('dummy-slug', dbClient)).rejects.toThrow('UNAUTHENTICATED');
  });

  it('AC-8: invalid catalogue payload throws typed validation error without persisting', async () => {
    await expect(
      createCatalogueItem(
        {
          name: '',
          slug: 'invalid-item',
          category: 'service',
          unitPriceMinor: 100,
        },
        dbClient,
      ),
    ).rejects.toThrow();

    const dbRows = await dbClient
      .select()
      .from(catalogueItems)
      .where(eq(catalogueItems.slug, 'invalid-item'));
    expect(dbRows).toHaveLength(0);
  });

  it('AC-5: updateCatalogueItem updates all optional fields', async () => {
    const item = await createCatalogueItem(
      {
        name: 'Full Update Item',
        slug: 'full-update-item',
        description: 'Old Description',
        category: 'service',
        unitPriceMinor: 20000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 1,
        isActive: true,
      },
      dbClient,
    );

    const updated = await updateCatalogueItem(
      item.id,
      {
        name: 'Updated Full Item',
        slug: 'full-update-item-updated',
        description: 'New Description',
        category: 'travel',
        unitPriceMinor: 35000,
        currency: 'USD',
        taxRateBasisPoints: 700,
        position: 9,
        isActive: false,
      },
      dbClient,
    );

    expect(updated.name).toBe('Updated Full Item');
    expect(updated.slug).toBe('full-update-item-updated');
    expect(updated.description).toBe('New Description');
    expect(updated.category).toBe('travel');
    expect(updated.unitPriceMinor).toBe(35000);
    expect(updated.currency).toBe('USD');
    expect(updated.taxRateBasisPoints).toBe(700);
    expect(updated.position).toBe(9);
    expect(updated.isActive).toBe(false);
  });

  it('AC-4, AC-5: handles not found cases cleanly', async () => {
    const nonExistentId = '01920000-0000-7000-8000-000000000999';

    expect(await getCatalogueItemById(nonExistentId, dbClient)).toBeNull();
    expect(await getCatalogueItemBySlug('non-existent-slug', dbClient)).toBeNull();

    await expect(updateCatalogueItem(nonExistentId, { name: 'Fail' }, dbClient)).rejects.toThrow(
      'Catalogue item not found',
    );

    await expect(deleteCatalogueItem(nonExistentId, dbClient)).rejects.toThrow(
      'Catalogue item not found',
    );
  });

  it('AC-4: listCatalogueItems filters by category and handles empty sets', async () => {
    const item = await createCatalogueItem(
      {
        name: 'Licensing Asset',
        slug: 'licensing-asset',
        category: 'licensing',
        unitPriceMinor: 10000,
      },
      dbClient,
    );

    const licensingList = await listCatalogueItems({ category: 'licensing' }, dbClient);
    expect(licensingList.some((i) => i.id === item.id)).toBe(true);

    const travelList = await listCatalogueItems({ category: 'travel' }, dbClient);
    expect(travelList.some((i) => i.id === item.id)).toBe(false);

    // List with no filter conditions
    const allItems = await listCatalogueItems(undefined, dbClient);
    expect(allItems.length).toBeGreaterThan(0);
  });
});
