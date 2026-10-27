import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import type { DbClient } from '@/server/db/client';
import { packages, packageIncludedItems, catalogueItems } from '@/server/db/schema/packages';
import { seedPackagesAndCatalogue } from '@/server/db/seeds/packages';

describe('TASK-0056: Synthetic Packages and Catalogue Seed Integration', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-1, AC-4: seedPackagesAndCatalogue idempotently seeds photography packages, bundled deliverables, and catalogue items', async () => {
    const result = await seedPackagesAndCatalogue(dbClient);

    expect(result.seededPackages).toBeGreaterThanOrEqual(3);
    expect(result.seededDeliverables).toBeGreaterThanOrEqual(6);
    expect(result.seededCatalogueItems).toBeGreaterThanOrEqual(5);

    // Verify Wedding Full Day package
    const pkgs = await dbClient.select().from(packages);
    const weddingPkg = pkgs.find((p) => p.slug === 'wedding-full-day');
    expect(weddingPkg).toBeDefined();
    expect(weddingPkg?.basePriceMinor).toBe(280000);
    expect(weddingPkg?.taxRateBasisPoints).toBe(1900);

    // Verify included deliverables for Wedding Full Day
    const deliverables = await dbClient.select().from(packageIncludedItems);
    const weddingDeliverables = deliverables.filter((d) => d.packageId === weddingPkg?.id);
    expect(weddingDeliverables.length).toBeGreaterThanOrEqual(3);

    // Verify Catalogue Items
    const items = await dbClient.select().from(catalogueItems);
    const extraHour = items.find((i) => i.slug === 'extra-hour-coverage');
    expect(extraHour).toBeDefined();
    expect(extraHour?.category).toBe('service');

    const album = items.find((i) => i.slug === 'fine-art-album-30x30');
    expect(album).toBeDefined();
    expect(album?.category).toBe('product');

    // Running seed a second time should be idempotent (no duplicate key errors)
    const secondResult = await seedPackagesAndCatalogue(dbClient);
    expect(secondResult.seededPackages).toBeGreaterThanOrEqual(3);
  });
});
