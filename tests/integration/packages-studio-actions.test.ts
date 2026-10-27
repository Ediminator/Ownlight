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
import { packages, catalogueItems } from '@/server/db/schema/packages';
import { auditEvents } from '@/server/db/schema/audit';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { eq, desc } from 'drizzle-orm';
import {
  savePackageAction,
  archivePackageAction,
  listPackagesAction,
} from '@/server/packages/actions';
import {
  saveCatalogueItemAction,
  archiveCatalogueItemAction,
  listCatalogueItemsAction,
} from '@/server/catalogue/actions';
import { updateStudioTaxSettingsAction, getStudioTaxSettingsAction } from '@/server/studio/actions';

describe('TASK-0057: Packages, Catalogue & Studio Tax Actions Integration Tests', () => {
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

    const sessionRecord = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRecord.token;
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
  });

  afterEach(async () => {
    mockCookiesStore.clear();
    mockHeadersStore.clear();
    await testDb.destroy();
  });

  describe('AC-1: Create Package Action', () => {
    it('AC-1: savePackageAction creates package with bundled deliverables in database and emits audit log', async () => {
      const payload = {
        name: 'Full Day Wedding Coverage',
        slug: 'wedding-full-day',
        description: '8 hours of coverage with album and digital delivery.',
        projectTypeKey: 'wedding',
        basePriceMinor: 280000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 0,
        isActive: true,
        includedItems: [
          {
            title: '8 Hours Continuous Coverage',
            description: 'Bridal prep to first dance',
            quantity: 1,
            position: 0,
          },
          {
            title: '400+ Edited High-Resolution Images',
            description: 'Full resolution without watermark',
            quantity: 400,
            position: 1,
          },
        ],
      };

      const result = await savePackageAction(payload, dbClient);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.id).toBeDefined();
      expect(result.data.name).toBe('Full Day Wedding Coverage');
      expect(result.data.slug).toBe('wedding-full-day');
      expect(result.data.basePriceMinor).toBe(280000);
      expect(result.data.includedItems.length).toBe(2);
      expect(result.data.includedItems[0]?.title).toBe('8 Hours Continuous Coverage');
      expect(result.data.includedItems[1]?.quantity).toBe(400);

      // Verify in DB
      const [saved] = await dbClient
        .select()
        .from(packages)
        .where(eq(packages.id, result.data.id))
        .limit(1);
      expect(saved).toBeDefined();
      expect(saved?.name).toBe('Full Day Wedding Coverage');

      // Verify audit log
      const [auditLog] = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'package.created'))
        .orderBy(desc(auditEvents.occurredAt))
        .limit(1);
      expect(auditLog).toBeDefined();
      expect(auditLog?.targetId).toBe(result.data.id);
    });
  });

  describe('AC-2: Edit and Reorder Package Action', () => {
    it('AC-2: savePackageAction updates existing package title, modifies deliverable description, and reorders items', async () => {
      // Create initial package
      const created = await savePackageAction(
        {
          name: 'Original Package',
          slug: 'original-package',
          basePriceMinor: 150000,
          currency: 'EUR',
          taxRateBasisPoints: 1900,
          includedItems: [
            { title: 'Item 1', description: 'Desc 1', quantity: 1, position: 0 },
            { title: 'Item 2', description: 'Desc 2', quantity: 2, position: 1 },
          ],
        },
        dbClient,
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const pkgId = created.data.id;
      const [item1, item2] = created.data.includedItems;
      expect(item1).toBeDefined();
      expect(item2).toBeDefined();

      // Update package: change title, modify item 1 description, reorder item 2 before item 1
      const updatePayload = {
        id: pkgId,
        name: 'Updated Package Title',
        slug: 'original-package',
        basePriceMinor: 175000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        includedItems: [
          {
            id: item2?.id,
            title: item2?.title ?? 'Item 2',
            description: 'Item 2 now first',
            quantity: item2?.quantity ?? 2,
            position: 0,
          },
          {
            id: item1?.id,
            title: item1?.title ?? 'Item 1',
            description: 'Updated item 1 description',
            quantity: item1?.quantity ?? 1,
            position: 1,
          },
        ],
      };

      const updated = await savePackageAction(updatePayload, dbClient);
      expect(updated.success).toBe(true);
      if (!updated.success) return;

      expect(updated.data.name).toBe('Updated Package Title');
      expect(updated.data.basePriceMinor).toBe(175000);
      expect(updated.data.includedItems.length).toBe(2);
      expect(updated.data.includedItems[0]?.title).toBe('Item 2');
      expect(updated.data.includedItems[1]?.title).toBe('Item 1');
      expect(updated.data.includedItems[1]?.description).toBe('Updated item 1 description');
    });
  });

  describe('AC-3: Archive and Restore Package Action', () => {
    it('AC-3: archivePackageAction deactivates package (is_active = false) without deleting history and supports restore', async () => {
      const created = await savePackageAction(
        {
          name: 'Package To Archive',
          slug: 'package-to-archive',
          basePriceMinor: 200000,
          currency: 'EUR',
          taxRateBasisPoints: 1900,
        },
        dbClient,
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const pkgId = created.data.id;

      // Archive package
      const archiveRes = await archivePackageAction({ id: pkgId, isActive: false }, dbClient);
      expect(archiveRes.success).toBe(true);
      if (!archiveRes.success) return;
      expect(archiveRes.data.isActive).toBe(false);

      // Verify in DB
      const [archivedPkg] = await dbClient
        .select()
        .from(packages)
        .where(eq(packages.id, pkgId))
        .limit(1);
      expect(archivedPkg?.isActive).toBe(false);

      // Verify audit event
      const [deleteAudit] = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'package.deleted'))
        .orderBy(desc(auditEvents.occurredAt))
        .limit(1);
      expect(deleteAudit).toBeDefined();

      // Restore package
      const restoreRes = await archivePackageAction({ id: pkgId, isActive: true }, dbClient);
      expect(restoreRes.success).toBe(true);
      if (!restoreRes.success) return;
      expect(restoreRes.data.isActive).toBe(true);

      const [restoredPkg] = await dbClient
        .select()
        .from(packages)
        .where(eq(packages.id, pkgId))
        .limit(1);
      expect(restoredPkg?.isActive).toBe(true);
    });
  });

  describe('AC-4: Catalogue Item Actions', () => {
    it('AC-4: saveCatalogueItemAction creates add-on items across categories and archiveCatalogueItemAction toggles active status', async () => {
      const payload = {
        name: 'Additional Coverage Hour',
        slug: 'additional-coverage-hour',
        description: 'One hour of extra shoot coverage',
        category: 'service' as const,
        unitPriceMinor: 15000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 0,
        isActive: true,
      };

      const createRes = await saveCatalogueItemAction(payload, dbClient);
      expect(createRes.success).toBe(true);
      if (!createRes.success) return;

      expect(createRes.data.id).toBeDefined();
      expect(createRes.data.name).toBe('Additional Coverage Hour');
      expect(createRes.data.category).toBe('service');
      expect(createRes.data.unitPriceMinor).toBe(15000);

      // Verify in DB
      const [item] = await dbClient
        .select()
        .from(catalogueItems)
        .where(eq(catalogueItems.id, createRes.data.id))
        .limit(1);
      expect(item).toBeDefined();

      // Archive catalogue item
      const archiveRes = await archiveCatalogueItemAction(
        { id: createRes.data.id, isActive: false },
        dbClient,
      );
      expect(archiveRes.success).toBe(true);

      const [archivedItem] = await dbClient
        .select()
        .from(catalogueItems)
        .where(eq(catalogueItems.id, createRes.data.id))
        .limit(1);
      expect(archivedItem?.isActive).toBe(false);

      // Restore catalogue item
      const restoreRes = await archiveCatalogueItemAction(
        { id: createRes.data.id, isActive: true },
        dbClient,
      );
      expect(restoreRes.success).toBe(true);

      const [restoredItem] = await dbClient
        .select()
        .from(catalogueItems)
        .where(eq(catalogueItems.id, createRes.data.id))
        .limit(1);
      expect(restoredItem?.isActive).toBe(true);
    });
  });

  describe('AC-5: Update Studio Tax Settings Action', () => {
    it('AC-5: updateStudioTaxSettingsAction saves Kleinunternehmer statutory notice and pricing mode', async () => {
      const payload = {
        taxNumber: '12/345/67890',
        vatId: 'DE123456789',
        isKleinunternehmer: true,
        kleinunternehmerNotice: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
        defaultTaxRateBasisPoints: 0,
        pricesIncludeTax: true,
      };

      const result = await updateStudioTaxSettingsAction(payload, dbClient);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.tax_number).toBe('12/345/67890');
      expect(result.data.vat_id).toBe('DE123456789');
      expect(result.data.is_kleinunternehmer).toBe(true);
      expect(result.data.kleinunternehmer_notice).toBe(
        'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
      );
      expect(result.data.default_tax_rate_basis_points).toBe(0);
      expect(result.data.prices_include_tax).toBe(true);

      // Verify audit log
      const [auditLog] = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'studio_settings.tax_updated'))
        .orderBy(desc(auditEvents.occurredAt))
        .limit(1);
      expect(auditLog).toBeDefined();

      // Verify read action
      const readRes = await getStudioTaxSettingsAction(dbClient);
      expect(readRes.success).toBe(true);
      if (readRes.success) {
        expect(readRes.data.is_kleinunternehmer).toBe(true);
      }
    });
  });

  describe('AC-6: Unauthenticated Access Denied', () => {
    it('AC-6: rejects unauthenticated caller with UNAUTHENTICATED across all packages, catalogue, and tax actions', async () => {
      // Clear session cookie to simulate unauthenticated request
      mockCookiesStore.clear();

      const pkgRes = await savePackageAction({ name: 'Test', slug: 'test' }, dbClient);
      expect(pkgRes.success).toBe(false);
      if (!pkgRes.success) {
        expect(pkgRes.code).toBe('UNAUTHENTICATED');
      }

      const archivePkgRes = await archivePackageAction(
        { id: '01920000-0000-7000-8000-000000000001' },
        dbClient,
      );
      expect(archivePkgRes.success).toBe(false);
      if (!archivePkgRes.success) {
        expect(archivePkgRes.code).toBe('UNAUTHENTICATED');
      }

      const catRes = await saveCatalogueItemAction(
        { name: 'Item', slug: 'item', category: 'service' },
        dbClient,
      );
      expect(catRes.success).toBe(false);
      if (!catRes.success) {
        expect(catRes.code).toBe('UNAUTHENTICATED');
      }

      const archiveCatRes = await archiveCatalogueItemAction(
        { id: '01920000-0000-7000-8000-000000000001' },
        dbClient,
      );
      expect(archiveCatRes.success).toBe(false);
      if (!archiveCatRes.success) {
        expect(archiveCatRes.code).toBe('UNAUTHENTICATED');
      }

      const taxRes = await updateStudioTaxSettingsAction({ isKleinunternehmer: true }, dbClient);
      expect(taxRes.success).toBe(false);
      if (!taxRes.success) {
        expect(taxRes.code).toBe('UNAUTHENTICATED');
      }

      const listPkgRes = await listPackagesAction({}, dbClient);
      expect(listPkgRes.success).toBe(false);
      if (!listPkgRes.success) {
        expect(listPkgRes.code).toBe('UNAUTHENTICATED');
      }

      const listCatRes = await listCatalogueItemsAction({}, dbClient);
      expect(listCatRes.success).toBe(false);
      if (!listCatRes.success) {
        expect(listCatRes.code).toBe('UNAUTHENTICATED');
      }

      const getTaxRes = await getStudioTaxSettingsAction(dbClient);
      expect(getTaxRes.success).toBe(false);
      if (!getTaxRes.success) {
        expect(getTaxRes.code).toBe('UNAUTHENTICATED');
      }
    });

    it('AC-6: rejects non-owner authenticated user with FORBIDDEN across all actions', async () => {
      const clientUserId = '01920000-0000-7000-8000-000000000099';
      await dbClient.insert(user).values({
        id: clientUserId,
        name: 'Client User',
        email: 'client@example.org',
        role: 'client',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const clientSession = await createSession(clientUserId, dbClient);
      mockCookiesStore.set(SESSION_COOKIE_NAME, clientSession.token);

      const pkgRes = await savePackageAction({ name: 'Pkg', slug: 'pkg' }, dbClient);
      expect(pkgRes.success).toBe(false);
      if (!pkgRes.success) expect(pkgRes.code).toBe('FORBIDDEN');

      const archivePkgRes = await archivePackageAction(
        { id: '01920000-0000-7000-8000-000000000001' },
        dbClient,
      );
      expect(archivePkgRes.success).toBe(false);
      if (!archivePkgRes.success) expect(archivePkgRes.code).toBe('FORBIDDEN');

      const listPkgRes = await listPackagesAction({}, dbClient);
      expect(listPkgRes.success).toBe(false);
      if (!listPkgRes.success) expect(listPkgRes.code).toBe('FORBIDDEN');

      const catRes = await saveCatalogueItemAction(
        { name: 'Item', slug: 'item', category: 'service' },
        dbClient,
      );
      expect(catRes.success).toBe(false);
      if (!catRes.success) expect(catRes.code).toBe('FORBIDDEN');

      const archiveCatRes = await archiveCatalogueItemAction(
        { id: '01920000-0000-7000-8000-000000000001' },
        dbClient,
      );
      expect(archiveCatRes.success).toBe(false);
      if (!archiveCatRes.success) expect(archiveCatRes.code).toBe('FORBIDDEN');

      const listCatRes = await listCatalogueItemsAction({}, dbClient);
      expect(listCatRes.success).toBe(false);
      if (!listCatRes.success) expect(listCatRes.code).toBe('FORBIDDEN');

      const taxRes = await updateStudioTaxSettingsAction({ isKleinunternehmer: true }, dbClient);
      expect(taxRes.success).toBe(false);
      if (!taxRes.success) expect(taxRes.code).toBe('FORBIDDEN');

      const getTaxRes = await getStudioTaxSettingsAction(dbClient);
      expect(getTaxRes.success).toBe(false);
      if (!getTaxRes.success) expect(getTaxRes.code).toBe('FORBIDDEN');
    });

    it('AC-1 & AC-4: listPackagesAction and listCatalogueItemsAction return studio records for owner', async () => {
      mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
      const pkgList = await listPackagesAction({}, dbClient);
      expect(pkgList.success).toBe(true);
      if (pkgList.success) {
        expect(Array.isArray(pkgList.data)).toBe(true);
      }

      const catList = await listCatalogueItemsAction({}, dbClient);
      expect(catList.success).toBe(true);
      if (catList.success) {
        expect(Array.isArray(catList.data)).toBe(true);
      }
    });

    it('AC-5: getStudioTaxSettingsAction returns tax settings for authenticated owner', async () => {
      mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
      const res = await getStudioTaxSettingsAction(dbClient);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toBeDefined();
        expect(res.data.prices_include_tax).toBe(true);
      }
    });
  });

  describe('AC-7: Validation Failures', () => {
    it('AC-7: returns VALIDATION_FAILED when savePackageAction or saveCatalogueItemAction receives invalid payload', async () => {
      const invalidPkg = await savePackageAction({ name: '', slug: 'INVALID SLUG!' }, dbClient);
      expect(invalidPkg.success).toBe(false);
      if (!invalidPkg.success) {
        expect(invalidPkg.code).toBe('VALIDATION_FAILED');
      }

      const invalidCat = await saveCatalogueItemAction(
        { name: '', slug: 'cat', category: 'invalid' },
        dbClient,
      );
      expect(invalidCat.success).toBe(false);
      if (!invalidCat.success) {
        expect(invalidCat.code).toBe('VALIDATION_FAILED');
      }

      const invalidTax = await updateStudioTaxSettingsAction(
        { defaultTaxRateBasisPoints: -100 },
        dbClient,
      );
      expect(invalidTax.success).toBe(false);
      if (!invalidTax.success) {
        expect(invalidTax.code).toBe('VALIDATION_FAILED');
      }

      const invalidArchivePkg = await archivePackageAction({ id: 'not-a-uuid' }, dbClient);
      expect(invalidArchivePkg.success).toBe(false);
      if (!invalidArchivePkg.success) {
        expect(invalidArchivePkg.code).toBe('VALIDATION_FAILED');
      }

      const invalidArchiveCat = await archiveCatalogueItemAction({ id: 'not-a-uuid' }, dbClient);
      expect(invalidArchiveCat.success).toBe(false);
      if (!invalidArchiveCat.success) {
        expect(invalidArchiveCat.code).toBe('VALIDATION_FAILED');
      }
    });

    it('returns INTERNAL_ERROR when updating or archiving non-existent records', async () => {
      mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
      const nonExistentId = '01920000-0000-7000-8000-000000000999';

      const updateMissingPkg = await savePackageAction(
        { id: nonExistentId, name: 'Missing', slug: 'missing' },
        dbClient,
      );
      expect(updateMissingPkg.success).toBe(false);
      if (!updateMissingPkg.success) {
        expect(updateMissingPkg.code).toBe('INTERNAL_ERROR');
      }

      const archiveMissingPkg = await archivePackageAction(
        { id: nonExistentId, isActive: false },
        dbClient,
      );
      expect(archiveMissingPkg.success).toBe(false);
      if (!archiveMissingPkg.success) {
        expect(archiveMissingPkg.code).toBe('INTERNAL_ERROR');
      }

      const updateMissingCat = await saveCatalogueItemAction(
        { id: nonExistentId, name: 'Missing', slug: 'missing', category: 'service' },
        dbClient,
      );
      expect(updateMissingCat.success).toBe(false);
      if (!updateMissingCat.success) {
        expect(updateMissingCat.code).toBe('INTERNAL_ERROR');
      }

      const archiveMissingCat = await archiveCatalogueItemAction(
        { id: nonExistentId, isActive: false },
        dbClient,
      );
      expect(archiveMissingCat.success).toBe(false);
      if (!archiveMissingCat.success) {
        expect(archiveMissingCat.code).toBe('INTERNAL_ERROR');
      }
    });
  });
});
