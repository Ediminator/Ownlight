import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import {
  packages,
  packageIncludedItems,
  catalogueItems,
  type NewPackage,
  type NewPackageIncludedItem,
  type NewCatalogueItem,
} from '@/server/db/schema/packages';

export const DEFAULT_PACKAGES: readonly (NewPackage & {
  includedItems: Omit<NewPackageIncludedItem, 'packageId'>[];
})[] = [
  {
    id: '01920000-0000-7000-8000-000000000101',
    name: 'Full Day Wedding Coverage',
    slug: 'wedding-full-day',
    description: 'Comprehensive 8-hour wedding photography from prep to dance floor.',
    projectTypeKey: 'wedding',
    basePriceMinor: 280000,
    currency: 'EUR',
    taxRateBasisPoints: 1900,
    position: 1,
    isActive: true,
    includedItems: [
      {
        id: '01920000-0000-7000-8000-000000000111',
        title: '8 Hours Continuous Coverage',
        description: 'Bridal prep to first dance',
        quantity: 1,
        position: 1,
      },
      {
        id: '01920000-0000-7000-8000-000000000112',
        title: '400+ Edited High-Resolution Images',
        description: 'Delivered in full resolution without watermarks',
        quantity: 400,
        position: 2,
      },
      {
        id: '01920000-0000-7000-8000-000000000113',
        title: 'Private Online Client Gallery',
        description: 'High-speed cloud gallery with 12 months hosting',
        quantity: 1,
        position: 3,
      },
      {
        id: '01920000-0000-7000-8000-000000000114',
        title: 'Pre-Wedding Consultation & Timeline Planning',
        description: '1-hour video or in-person session',
        quantity: 1,
        position: 4,
      },
    ],
  },
  {
    id: '01920000-0000-7000-8000-000000000102',
    name: 'Portrait Session Classic',
    slug: 'portrait-classic',
    description: 'On-location portrait photography session for couples or individuals.',
    projectTypeKey: 'portrait',
    basePriceMinor: 35000,
    currency: 'EUR',
    taxRateBasisPoints: 1900,
    position: 2,
    isActive: true,
    includedItems: [
      {
        id: '01920000-0000-7000-8000-000000000121',
        title: '60 Minutes On-Location Shoot',
        description: 'Natural light portrait shoot',
        quantity: 1,
        position: 1,
      },
      {
        id: '01920000-0000-7000-8000-000000000122',
        title: '25 High-Resolution Retouched Images',
        description: 'Hand-edited color and skin toning',
        quantity: 25,
        position: 2,
      },
      {
        id: '01920000-0000-7000-8000-000000000123',
        title: 'Wardrobe & Styling Guide',
        description: 'Digital guide with outfit inspirations',
        quantity: 1,
        position: 3,
      },
    ],
  },
  {
    id: '01920000-0000-7000-8000-000000000103',
    name: 'Commercial Production Half-Day',
    slug: 'commercial-half-day',
    description: 'Half-day commercial and branding shoot for businesses.',
    projectTypeKey: 'commercial',
    basePriceMinor: 120000,
    currency: 'EUR',
    taxRateBasisPoints: 1900,
    position: 3,
    isActive: true,
    includedItems: [
      {
        id: '01920000-0000-7000-8000-000000000131',
        title: '4 Hours Studio / Location Production',
        description: 'Tethered shooting with client preview',
        quantity: 1,
        position: 1,
      },
      {
        id: '01920000-0000-7000-8000-000000000132',
        title: 'Standard Commercial Licensing',
        description: 'Worldwide digital & print marketing rights (2 years)',
        quantity: 1,
        position: 2,
      },
      {
        id: '01920000-0000-7000-8000-000000000133',
        title: 'High-End Retouching (10 Images)',
        description: 'Detailed commercial compositing and clean-up',
        quantity: 10,
        position: 3,
      },
    ],
  },
];

export const DEFAULT_CATALOGUE_ITEMS: readonly NewCatalogueItem[] = [
  {
    id: '01920000-0000-7000-8000-000000000201',
    name: 'Additional Coverage Hour',
    slug: 'extra-hour-coverage',
    description: 'Extra hour of photography coverage beyond the package allowance.',
    category: 'service',
    unitPriceMinor: 25000,
    currency: 'EUR',
    taxRateBasisPoints: 1900,
    position: 1,
    isActive: true,
  },
  {
    id: '01920000-0000-7000-8000-000000000202',
    name: 'Second Photographer (Half Day)',
    slug: 'second-shooter-half-day',
    description: 'Dedicated second shooter for up to 4 hours.',
    category: 'service',
    unitPriceMinor: 50000,
    currency: 'EUR',
    taxRateBasisPoints: 1900,
    position: 2,
    isActive: true,
  },
  {
    id: '01920000-0000-7000-8000-000000000203',
    name: 'Fine-Art Heirloom Album 30x30cm',
    slug: 'fine-art-album-30x30',
    description: 'Handcrafted leather-bound album with 30 fine-art matte pages.',
    category: 'product',
    unitPriceMinor: 65000,
    currency: 'EUR',
    taxRateBasisPoints: 1900,
    position: 3,
    isActive: true,
  },
  {
    id: '01920000-0000-7000-8000-000000000204',
    name: 'Standard Travel Fee per km beyond 50km',
    slug: 'travel-fee-per-km',
    description: 'Per-kilometer travel surcharge outside the 50km studio radius.',
    category: 'travel',
    unitPriceMinor: 50,
    currency: 'EUR',
    taxRateBasisPoints: 1900,
    position: 4,
    isActive: true,
  },
  {
    id: '01920000-0000-7000-8000-000000000205',
    name: 'Extended Commercial Advertising License',
    slug: 'extended-advertising-license',
    description: 'Unlimited print and national billboard licensing rights.',
    category: 'licensing',
    unitPriceMinor: 80000,
    currency: 'EUR',
    taxRateBasisPoints: 700,
    position: 5,
    isActive: true,
  },
];

export interface SeedResult {
  seededPackages: number;
  seededDeliverables: number;
  seededCatalogueItems: number;
}

/**
 * Idempotently seeds default packages, included deliverables, and catalogue items.
 */
export async function seedPackagesAndCatalogue(tx: DbClient): Promise<SeedResult> {
  const now = new Date();
  let seededPackages = 0;
  let seededDeliverables = 0;
  let seededCatalogueItems = 0;

  for (const pkgDef of DEFAULT_PACKAGES) {
    const [existing] = await tx
      .select({ id: packages.id })
      .from(packages)
      .where(eq(packages.slug, pkgDef.slug))
      .limit(1);

    let pkgId = existing?.id;

    if (!existing) {
      const [inserted] = await tx
        .insert(packages)
        .values({
          id: pkgDef.id,
          name: pkgDef.name,
          slug: pkgDef.slug,
          description: pkgDef.description,
          projectTypeKey: pkgDef.projectTypeKey,
          basePriceMinor: pkgDef.basePriceMinor,
          currency: pkgDef.currency,
          taxRateBasisPoints: pkgDef.taxRateBasisPoints,
          position: pkgDef.position,
          isActive: pkgDef.isActive,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      pkgId = inserted?.id ?? pkgDef.id;
      seededPackages++;
    } else {
      seededPackages++;
    }

    if (pkgId) {
      for (const item of pkgDef.includedItems) {
        const itemId = item.id;
        if (!itemId) {
          continue;
        }

        const [existingItem] = await tx
          .select({ id: packageIncludedItems.id })
          .from(packageIncludedItems)
          .where(eq(packageIncludedItems.id, itemId))
          .limit(1);

        if (!existingItem) {
          await tx.insert(packageIncludedItems).values({
            id: itemId,
            packageId: pkgId,
            title: item.title,
            description: item.description,
            quantity: item.quantity,
            position: item.position,
            createdAt: now,
            updatedAt: now,
          });

          seededDeliverables++;
        } else {
          seededDeliverables++;
        }
      }
    }
  }

  for (const itemDef of DEFAULT_CATALOGUE_ITEMS) {
    const [existing] = await tx
      .select({ id: catalogueItems.id })
      .from(catalogueItems)
      .where(eq(catalogueItems.slug, itemDef.slug))
      .limit(1);

    if (!existing) {
      await tx.insert(catalogueItems).values({
        id: itemDef.id,
        name: itemDef.name,
        slug: itemDef.slug,
        description: itemDef.description,
        category: itemDef.category,
        unitPriceMinor: itemDef.unitPriceMinor,
        currency: itemDef.currency,
        taxRateBasisPoints: itemDef.taxRateBasisPoints,
        position: itemDef.position,
        isActive: itemDef.isActive,
        createdAt: now,
        updatedAt: now,
      });

      seededCatalogueItems++;
    } else {
      seededCatalogueItems++;
    }
  }

  return {
    seededPackages,
    seededDeliverables,
    seededCatalogueItems,
  };
}
