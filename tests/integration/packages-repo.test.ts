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
import { packages, packageIncludedItems } from '@/server/db/schema/packages';
import { auditEvents } from '@/server/db/schema/audit';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { eq, desc } from 'drizzle-orm';
import {
  createPackage,
  updatePackage,
  deletePackage,
  getPackageById,
  getPackageBySlug,
  listPackages,
  setPackageIncludedItems,
  reorderPackageIncludedItems,
} from '@/server/packages/repo';

describe('TASK-0056: Packages Repository Integration Tests (AC-1, AC-2, AC-3, AC-7, AC-8)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();

    // Create Owner User
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

    // Create Owner Session
    const sessionRecord = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRecord.token;
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
  });

  afterEach(async () => {
    mockCookiesStore.clear();
    mockHeadersStore.clear();
    await testDb.destroy();
  });

  it('AC-1: createPackage inserts package and child deliverables in a single transaction and emits package.created', async () => {
    const pkg = await createPackage(
      {
        name: 'Full Day Wedding Coverage',
        slug: 'wedding-full-day',
        description: 'Complete 8h wedding coverage with digital gallery',
        projectTypeKey: 'wedding',
        basePriceMinor: 280000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 1,
        isActive: true,
        includedItems: [
          {
            title: '8 Hours Continuous Coverage',
            description: 'Bridal prep to first dance',
            quantity: 1,
            position: 1,
          },
          {
            title: '400+ High-Resolution Edited Images',
            quantity: 400,
            position: 2,
          },
          {
            title: 'Private Online Gallery',
            quantity: 1,
            position: 3,
          },
        ],
      },
      dbClient,
    );

    // Verify returned package structure & UUIDv7
    expect(pkg).toBeDefined();
    expect(pkg.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(pkg.name).toBe('Full Day Wedding Coverage');
    expect(pkg.slug).toBe('wedding-full-day');
    expect(pkg.basePriceMinor).toBe(280000);
    expect(pkg.taxRateBasisPoints).toBe(1900);
    expect(pkg.includedItems).toHaveLength(3);

    for (const item of pkg.includedItems) {
      expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(item.packageId).toBe(pkg.id);
    }

    // Verify database persistence
    const [dbPkg] = await dbClient.select().from(packages).where(eq(packages.id, pkg.id));
    expect(dbPkg).toBeDefined();
    expect(dbPkg?.slug).toBe('wedding-full-day');

    const dbItems = await dbClient
      .select()
      .from(packageIncludedItems)
      .where(eq(packageIncludedItems.packageId, pkg.id));
    expect(dbItems).toHaveLength(3);

    // Verify audit event emission
    const [auditLog] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'package.created'))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);

    expect(auditLog).toBeDefined();
    expect(auditLog?.targetId).toBe(pkg.id);
    expect(auditLog?.targetType).toBe('package');
  });

  it('AC-2: updatePackage atomically updates fields, child deliverables, and emits package.updated', async () => {
    const pkg = await createPackage(
      {
        name: 'Initial Package',
        slug: 'initial-package',
        basePriceMinor: 100000,
        taxRateBasisPoints: 1900,
        includedItems: [{ title: 'Initial Item', quantity: 1, position: 1 }],
      },
      dbClient,
    );

    const updated = await updatePackage(
      pkg.id,
      {
        name: 'Updated Package Name',
        basePriceMinor: 125000,
        includedItems: [
          { title: 'Item 1 Updated', quantity: 2, position: 1 },
          { title: 'New Item 2', quantity: 1, position: 2 },
        ],
      },
      dbClient,
    );

    expect(updated.name).toBe('Updated Package Name');
    expect(updated.basePriceMinor).toBe(125000);
    expect(updated.includedItems).toHaveLength(2);

    // Verify audit log
    const [auditLog] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'package.updated'))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);

    expect(auditLog).toBeDefined();
    expect(auditLog?.targetId).toBe(pkg.id);
  });

  it('AC-2: setPackageIncludedItems and reorderPackageIncludedItems manage child deliverables cleanly', async () => {
    const pkg = await createPackage(
      {
        name: 'Reorder Test Package',
        slug: 'reorder-test',
        basePriceMinor: 50000,
      },
      dbClient,
    );

    const items = await setPackageIncludedItems(
      pkg.id,
      [
        { title: 'Deliverable A', quantity: 1, position: 1 },
        { title: 'Deliverable B', quantity: 1, position: 2 },
        { title: 'Deliverable C', quantity: 1, position: 3 },
      ],
      dbClient,
    );

    expect(items).toHaveLength(3);
    expect(items[0]?.title).toBe('Deliverable A');

    const item0 = items[0];
    const item1 = items[1];
    const item2 = items[2];
    expect(item0).toBeDefined();
    expect(item1).toBeDefined();
    expect(item2).toBeDefined();

    if (!item0 || !item1 || !item2) {
      throw new Error('Expected items to be defined');
    }

    // Reorder: C first, then A, then B
    const reordered = await reorderPackageIncludedItems(
      pkg.id,
      [item2.id, item0.id, item1.id],
      dbClient,
    );

    expect(reordered[0]?.id).toBe(item2.id);
    expect(reordered[0]?.position).toBe(0);
    expect(reordered[1]?.id).toBe(item0.id);
    expect(reordered[1]?.position).toBe(1);
    expect(reordered[2]?.id).toBe(item1.id);
    expect(reordered[2]?.position).toBe(2);
  });

  it('AC-3: deletePackage soft-deactivates the package with is_active = false and emits package.deleted', async () => {
    const pkg = await createPackage(
      {
        name: 'Soft Delete Package',
        slug: 'soft-delete-package',
        basePriceMinor: 75000,
        includedItems: [{ title: 'Deliverable 1', quantity: 1 }],
      },
      dbClient,
    );

    await deletePackage(pkg.id, dbClient);

    // Record must still exist in DB
    const [dbPkg] = await dbClient.select().from(packages).where(eq(packages.id, pkg.id));
    expect(dbPkg).toBeDefined();
    expect(dbPkg?.isActive).toBe(false);

    // Active listing should filter it out by default
    const activeList = await listPackages({ isActive: true }, dbClient);
    expect(activeList.some((p) => p.id === pkg.id)).toBe(false);

    // List with includeInactive should find it
    const allList = await listPackages({ isActive: undefined }, dbClient);
    expect(allList.some((p) => p.id === pkg.id)).toBe(true);

    // Audit log
    const [auditLog] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'package.deleted'))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);

    expect(auditLog).toBeDefined();
    expect(auditLog?.targetId).toBe(pkg.id);
  });

  it('AC-7: rejects unauthenticated caller attempting to invoke package repository operations with UNAUTHENTICATED', async () => {
    mockCookiesStore.clear();

    await expect(
      createPackage(
        {
          name: 'Unauthenticated Package',
          slug: 'unauth-pkg',
          basePriceMinor: 1000,
        },
        dbClient,
      ),
    ).rejects.toThrow('UNAUTHENTICATED');

    await expect(
      updatePackage('01920000-0000-7000-8000-000000000099', { name: 'Updated' }, dbClient),
    ).rejects.toThrow('UNAUTHENTICATED');

    await expect(deletePackage('01920000-0000-7000-8000-000000000099', dbClient)).rejects.toThrow(
      'UNAUTHENTICATED',
    );

    await expect(listPackages({}, dbClient)).rejects.toThrow('UNAUTHENTICATED');
    await expect(getPackageById('dummy-id', dbClient)).rejects.toThrow('UNAUTHENTICATED');
    await expect(getPackageBySlug('dummy-slug', dbClient)).rejects.toThrow('UNAUTHENTICATED');
  });

  it('AC-8: invalid package payload throws typed validation error and aborts transaction without writing', async () => {
    const invalidPayload = {
      name: 'Invalid Negative Price',
      slug: 'invalid-negative',
      basePriceMinor: -100,
    };

    await expect(createPackage(invalidPayload, dbClient)).rejects.toThrow();

    const dbRows = await dbClient
      .select()
      .from(packages)
      .where(eq(packages.slug, 'invalid-negative'));
    expect(dbRows).toHaveLength(0);
  });

  it('AC-2: updatePackage updates all optional fields and allows clearing included items', async () => {
    const pkg = await createPackage(
      {
        name: 'Full Field Package',
        slug: 'full-field-pkg',
        description: 'Old Description',
        projectTypeKey: 'wedding',
        basePriceMinor: 100000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 1,
        isActive: true,
        includedItems: [{ title: 'Will be cleared', quantity: 1 }],
      },
      dbClient,
    );

    const updated = await updatePackage(
      pkg.id,
      {
        name: 'Updated Full Field',
        slug: 'full-field-pkg-updated',
        description: 'New Description',
        projectTypeKey: 'portrait',
        basePriceMinor: 150000,
        currency: 'USD',
        taxRateBasisPoints: 700,
        position: 5,
        isActive: false,
        includedItems: [],
      },
      dbClient,
    );

    expect(updated.name).toBe('Updated Full Field');
    expect(updated.slug).toBe('full-field-pkg-updated');
    expect(updated.description).toBe('New Description');
    expect(updated.projectTypeKey).toBe('portrait');
    expect(updated.basePriceMinor).toBe(150000);
    expect(updated.currency).toBe('USD');
    expect(updated.taxRateBasisPoints).toBe(700);
    expect(updated.position).toBe(5);
    expect(updated.isActive).toBe(false);
    expect(updated.includedItems).toHaveLength(0);
  });

  it('AC-1, AC-2: handles not found and null query cases cleanly', async () => {
    const nonExistentId = '01920000-0000-7000-8000-000000000888';

    expect(await getPackageById(nonExistentId, dbClient)).toBeNull();
    expect(await getPackageBySlug('non-existent-slug', dbClient)).toBeNull();

    await expect(updatePackage(nonExistentId, { name: 'Fail' }, dbClient)).rejects.toThrow(
      'Package not found',
    );

    await expect(deletePackage(nonExistentId, dbClient)).rejects.toThrow('Package not found');

    await expect(
      setPackageIncludedItems(
        nonExistentId,
        [{ title: 'Fail', quantity: 1, position: 0 }],
        dbClient,
      ),
    ).rejects.toThrow('Package not found');

    await expect(reorderPackageIncludedItems(nonExistentId, ['id-1'], dbClient)).rejects.toThrow(
      'Package not found',
    );
  });

  it('AC-1: listPackages filters by projectTypeKey and empty results', async () => {
    const pkg = await createPackage(
      {
        name: 'Wedding Only',
        slug: 'wedding-only',
        projectTypeKey: 'wedding',
        basePriceMinor: 200000,
      },
      dbClient,
    );

    const weddingList = await listPackages({ projectTypeKey: 'wedding' }, dbClient);
    expect(weddingList.some((p) => p.id === pkg.id)).toBe(true);

    const commercialList = await listPackages({ projectTypeKey: 'commercial' }, dbClient);
    expect(commercialList.some((p) => p.id === pkg.id)).toBe(false);

    const universalList = await listPackages({ projectTypeKey: null }, dbClient);
    expect(universalList.some((p) => p.id === pkg.id)).toBe(false);

    // Default list with no filter conditions
    const allPackages = await listPackages(undefined, dbClient);
    expect(allPackages.length).toBeGreaterThan(0);
  });

  it('AC-1, AC-2: covers branches for packages without deliverables and partial updates', async () => {
    // createPackage without deliverables
    const barePkg = await createPackage(
      {
        name: 'Bare Package',
        slug: 'bare-pkg',
        basePriceMinor: 50000,
        includedItems: [],
      },
      dbClient,
    );
    expect(barePkg.includedItems).toHaveLength(0);

    // updatePackage without touching includedItems (validated.includedItems === undefined)
    const updatedBare = await updatePackage(
      barePkg.id,
      {
        name: 'Bare Package Renamed',
      },
      dbClient,
    );
    expect(updatedBare.name).toBe('Bare Package Renamed');
    expect(updatedBare.includedItems).toHaveLength(0);

    // listPackages when rows are empty
    const nonExistentTypeList = await listPackages(
      { projectTypeKey: 'non-existent-type' },
      dbClient,
    );
    expect(nonExistentTypeList).toEqual([]);

    // reorderPackageIncludedItems with empty array
    const reorderedEmpty = await reorderPackageIncludedItems(barePkg.id, [], dbClient);
    expect(reorderedEmpty).toEqual([]);

    // getPackageBySlug when package exists
    const fetchedBySlug = await getPackageBySlug('bare-pkg', dbClient);
    expect(fetchedBySlug?.slug).toBe('bare-pkg');
  });
});
