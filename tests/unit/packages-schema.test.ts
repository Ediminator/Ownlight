import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  createPackageSchema,
  updatePackageSchema,
  packageIncludedItemInputSchema,
} from '@/server/packages/schema';
import { createCatalogueItemSchema, updateCatalogueItemSchema } from '@/server/catalogue/schema';

describe('TASK-0056: Packages and Catalogue Schema Validation', () => {
  describe('Package Schema Validation (AC-1, AC-8)', () => {
    it('AC-1: validates and parses valid package payload with included items', () => {
      const validPayload = {
        name: 'Full Day Wedding Coverage',
        slug: 'wedding-full-day',
        description: 'Comprehensive 8-hour wedding photography',
        projectTypeKey: 'wedding',
        basePriceMinor: 280000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 1,
        isActive: true,
        includedItems: [
          {
            title: '8 Hours Coverage',
            description: 'Two locations',
            quantity: 1,
            position: 1,
          },
          {
            title: '400+ Edited High-Res Images',
            quantity: 400,
            position: 2,
          },
        ],
      };

      const parsed = createPackageSchema.parse(validPayload);
      expect(parsed.name).toBe('Full Day Wedding Coverage');
      expect(parsed.slug).toBe('wedding-full-day');
      expect(parsed.basePriceMinor).toBe(280000);
      expect(parsed.taxRateBasisPoints).toBe(1900);
      expect(parsed.includedItems).toHaveLength(2);
      expect(parsed.includedItems[0]?.title).toBe('8 Hours Coverage');
    });

    it('AC-1: accepts title as alias for name in createPackageSchema', () => {
      const payload = {
        title: 'Portrait Session Standard',
        slug: 'portrait-session-standard',
        basePriceMinor: 35000,
      };

      const parsed = createPackageSchema.parse(payload);
      expect(parsed.name).toBe('Portrait Session Standard');
    });

    it('AC-8: rejects negative base_price_minor with ZodError', () => {
      const invalidPayload = {
        name: 'Discounted Package',
        slug: 'discounted-package',
        basePriceMinor: -500,
      };

      expect(() => createPackageSchema.parse(invalidPayload)).toThrow(ZodError);
    });

    it('AC-8: rejects negative tax_rate_basis_points with ZodError', () => {
      const invalidPayload = {
        name: 'Invalid Tax Package',
        slug: 'invalid-tax-package',
        basePriceMinor: 10000,
        taxRateBasisPoints: -100,
      };

      expect(() => createPackageSchema.parse(invalidPayload)).toThrow(ZodError);
    });

    it('AC-8: rejects tax_rate_basis_points greater than 10000 (100%)', () => {
      const invalidPayload = {
        name: 'Excessive Tax Package',
        slug: 'excessive-tax-package',
        basePriceMinor: 10000,
        taxRateBasisPoints: 15000,
      };

      expect(() => createPackageSchema.parse(invalidPayload)).toThrow(ZodError);
    });

    it('AC-8: rejects missing or empty package name/title', () => {
      expect(() =>
        createPackageSchema.parse({
          name: '',
          slug: 'empty-name',
          basePriceMinor: 1000,
        }),
      ).toThrow(ZodError);

      expect(() =>
        createPackageSchema.parse({
          slug: 'missing-name',
          basePriceMinor: 1000,
        }),
      ).toThrow(ZodError);
    });

    it('AC-8: rejects malformed slugs (uppercase, spaces, special chars, leading/trailing dashes)', () => {
      const malformedSlugs = [
        'Invalid Slug',
        'UPPERCASE-SLUG',
        'slug_with_underscores',
        '-leading-dash',
        'trailing-dash-',
        'slug--double-dash',
        'special$chars!',
      ];

      for (const slug of malformedSlugs) {
        expect(() =>
          createPackageSchema.parse({
            name: 'Valid Name',
            slug,
            basePriceMinor: 10000,
          }),
        ).toThrow(ZodError);
      }
    });

    it('AC-8: rejects included deliverable item with empty title or non-positive quantity', () => {
      expect(() =>
        packageIncludedItemInputSchema.parse({
          title: '',
          quantity: 1,
        }),
      ).toThrow(ZodError);

      expect(() =>
        packageIncludedItemInputSchema.parse({
          title: 'Valid Title',
          quantity: 0,
        }),
      ).toThrow(ZodError);

      expect(() =>
        packageIncludedItemInputSchema.parse({
          title: 'Valid Title',
          quantity: -1,
        }),
      ).toThrow(ZodError);
    });
  });

  describe('Catalogue Schema Validation (AC-4, AC-8)', () => {
    it('AC-4: validates and parses valid catalogue items across all categories', () => {
      const categories = ['service', 'product', 'travel', 'licensing'] as const;

      for (const category of categories) {
        const item = {
          name: `Item for ${category}`,
          slug: `item-${category}`,
          category,
          unitPriceMinor: 15000,
          currency: 'EUR',
          taxRateBasisPoints: 1900,
          position: 0,
          isActive: true,
        };

        const parsed = createCatalogueItemSchema.parse(item);
        expect(parsed.name).toBe(`Item for ${category}`);
        expect(parsed.category).toBe(category);
        expect(parsed.unitPriceMinor).toBe(15000);
      }
    });

    it('AC-8: rejects negative catalogue unit_price_minor with ZodError', () => {
      expect(() =>
        createCatalogueItemSchema.parse({
          name: 'Negative Add-on',
          slug: 'negative-addon',
          category: 'service',
          unitPriceMinor: -100,
        }),
      ).toThrow(ZodError);
    });

    it('AC-8: rejects invalid catalogue category with ZodError', () => {
      expect(() =>
        createCatalogueItemSchema.parse({
          name: 'Invalid Category Item',
          slug: 'invalid-cat',
          category: 'unknown_category',
          unitPriceMinor: 5000,
        }),
      ).toThrow(ZodError);
    });

    it('AC-8: rejects missing or empty catalogue name', () => {
      expect(() =>
        createCatalogueItemSchema.parse({
          name: '   ',
          slug: 'empty-name-item',
          category: 'service',
          unitPriceMinor: 5000,
        }),
      ).toThrow(ZodError);
    });

    it('AC-5: updateCatalogueItemSchema parses partial and full update payloads', () => {
      const fullUpdate = {
        name: 'Updated Name',
        slug: 'updated-slug',
        description: 'New Description',
        category: 'licensing' as const,
        unitPriceMinor: 25000,
        currency: 'eur',
        taxRateBasisPoints: 700,
        position: 4,
        isActive: false,
      };

      const parsed = updateCatalogueItemSchema.parse(fullUpdate);
      expect(parsed.name).toBe('Updated Name');
      expect(parsed.slug).toBe('updated-slug');
      expect(parsed.description).toBe('New Description');
      expect(parsed.category).toBe('licensing');
      expect(parsed.unitPriceMinor).toBe(25000);
      expect(parsed.currency).toBe('EUR');
      expect(parsed.taxRateBasisPoints).toBe(700);
      expect(parsed.position).toBe(4);
      expect(parsed.isActive).toBe(false);

      const emptyParsed = updateCatalogueItemSchema.parse({});
      expect(emptyParsed).toEqual({});
    });
  });

  describe('updatePackageSchema Validation (AC-2, AC-8)', () => {
    it('AC-2: parses complete update payload including title fallback and all fields', () => {
      const fullUpdate = {
        title: 'Updated Package Title',
        slug: 'updated-package-title',
        description: 'Updated Description',
        projectTypeKey: 'portrait',
        basePriceMinor: 99000,
        currency: 'eur',
        taxRateBasisPoints: 1900,
        position: 3,
        isActive: false,
        includedItems: [
          {
            title: 'Included Item 1',
            quantity: 1,
            position: 1,
          },
        ],
      };

      const parsed = updatePackageSchema.parse(fullUpdate);
      expect(parsed.name).toBe('Updated Package Title');
      expect(parsed.slug).toBe('updated-package-title');
      expect(parsed.description).toBe('Updated Description');
      expect(parsed.projectTypeKey).toBe('portrait');
      expect(parsed.basePriceMinor).toBe(99000);
      expect(parsed.currency).toBe('EUR');
      expect(parsed.taxRateBasisPoints).toBe(1900);
      expect(parsed.position).toBe(3);
      expect(parsed.isActive).toBe(false);
      expect(parsed.includedItems).toHaveLength(1);

      const emptyParsed = updatePackageSchema.parse({});
      expect(emptyParsed).toEqual({});
    });
  });
});
