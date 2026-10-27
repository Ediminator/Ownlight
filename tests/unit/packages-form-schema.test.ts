import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import fs from 'node:fs';
import path from 'node:path';
import {
  savePackageActionInputSchema,
  archivePackageActionInputSchema,
} from '@/server/packages/schema';
import {
  saveCatalogueItemActionInputSchema,
  archiveCatalogueItemActionInputSchema,
} from '@/server/catalogue/schema';
import { updateStudioTaxSettingsSchema } from '@/server/studio/tax-settings-schema';
import {
  formatTaxRateBasisPoints,
  parseTaxRateToBasisPoints,
  computeSlugFromTitle,
  splitPackagesByActiveStatus,
  filterPackagesByProjectType,
  moveDeliverable,
  validatePackageForm,
  packageToFormData,
  type PackageFormData,
} from '@/components/settings/packages/packages-helpers';
import {
  validateCatalogueItemForm,
  filterCatalogueItems,
  catalogueItemToFormData,
  getCategoryBadgeClasses,
  type CatalogueItemFormData,
} from '@/components/settings/packages/catalogue-helpers';
import {
  validateTaxSettingsForm,
  studioSettingsToTaxFormData,
  type TaxSettingsFormData,
} from '@/components/settings/packages/tax-helpers';
import {
  getEffectiveKleinunternehmerNotice,
  DEFAULT_KLEINUNTERNEHMER_NOTICES,
} from '@/server/studio/tax-settings-schema';
import type { PackageWithIncludedItems } from '@/server/packages/repo';
import type { CatalogueItem } from '@/server/db/schema/packages';
import type { StudioSettings } from '@/server/db/schema/studio-settings';

describe('TASK-0057: Packages and Catalogue Studio Settings Form Schemas & Helpers', () => {
  describe('Package Validation Schemas (AC-7)', () => {
    it('AC-7: validates a valid package creation input payload', () => {
      const valid = {
        name: 'Full Day Wedding Coverage',
        slug: 'wedding-full-day',
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
            quantity: 400,
            position: 1,
          },
        ],
      };

      const parsed = savePackageActionInputSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.name).toBe('Full Day Wedding Coverage');
        expect(parsed.data.includedItems.length).toBe(2);
      }
    });

    it('AC-7: rejects empty package title and name', () => {
      const invalid = {
        name: '   ',
        title: '',
        slug: 'wedding-full-day',
        basePriceMinor: 10000,
      };

      const result = savePackageActionInputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = result.error.flatten().fieldErrors;
        expect(errors.title ?? errors.name).toBeDefined();
      }
    });

    it('AC-7: rejects invalid package slug formats (uppercase, spaces, special chars)', () => {
      const invalidSlugs = [
        'Wedding-Day',
        'wedding day',
        'wedding--day',
        '-wedding-',
        'wedding_day',
        '',
      ];
      for (const slug of invalidSlugs) {
        const result = savePackageActionInputSchema.safeParse({
          name: 'Wedding Coverage',
          slug,
          basePriceMinor: 10000,
        });
        expect(result.success).toBe(false);
      }
    });

    it('AC-7: rejects negative package base price', () => {
      const invalid = {
        name: 'Wedding Coverage',
        slug: 'wedding-coverage',
        basePriceMinor: -500,
      };

      const result = savePackageActionInputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('AC-7: rejects tax rate exceeding 10000 basis points or negative', () => {
      const overMax = savePackageActionInputSchema.safeParse({
        name: 'Wedding Coverage',
        slug: 'wedding-coverage',
        basePriceMinor: 10000,
        taxRateBasisPoints: 10001,
      });
      expect(overMax.success).toBe(false);

      const negative = savePackageActionInputSchema.safeParse({
        name: 'Wedding Coverage',
        slug: 'wedding-coverage',
        basePriceMinor: 10000,
        taxRateBasisPoints: -100,
      });
      expect(negative.success).toBe(false);
    });

    it('AC-7: rejects included deliverable with empty title or quantity < 1', () => {
      const emptyTitle = savePackageActionInputSchema.safeParse({
        name: 'Wedding Coverage',
        slug: 'wedding-coverage',
        basePriceMinor: 10000,
        includedItems: [{ title: '   ', quantity: 1 }],
      });
      expect(emptyTitle.success).toBe(false);

      const zeroQuantity = savePackageActionInputSchema.safeParse({
        name: 'Wedding Coverage',
        slug: 'wedding-coverage',
        basePriceMinor: 10000,
        includedItems: [{ title: 'Coverage', quantity: 0 }],
      });
      expect(zeroQuantity.success).toBe(false);
    });

    it('AC-7: archivePackageActionInputSchema requires valid UUID', () => {
      const valid = archivePackageActionInputSchema.safeParse({
        id: '01920000-0000-7000-8000-000000000001',
        isActive: false,
      });
      expect(valid.success).toBe(true);

      const invalid = archivePackageActionInputSchema.safeParse({
        id: 'not-a-uuid',
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe('Catalogue Validation Schemas (AC-7)', () => {
    it('AC-7: validates a valid catalogue item creation input payload', () => {
      const valid = {
        name: 'Additional Coverage Hour',
        slug: 'additional-coverage-hour',
        category: 'service',
        unitPriceMinor: 15000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 0,
        isActive: true,
      };

      const parsed = saveCatalogueItemActionInputSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
    });

    it('AC-7: rejects empty catalogue item name', () => {
      const invalid = {
        name: '   ',
        slug: 'extra-hour',
        category: 'service',
        unitPriceMinor: 15000,
      };

      const result = saveCatalogueItemActionInputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('AC-7: rejects catalogue item with invalid category enum', () => {
      const invalid = {
        name: 'Extra Hour',
        slug: 'extra-hour',
        category: 'invalid-category',
        unitPriceMinor: 15000,
      };

      const result = saveCatalogueItemActionInputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('AC-7: rejects negative unit price for catalogue item', () => {
      const invalid = {
        name: 'Extra Hour',
        slug: 'extra-hour',
        category: 'service',
        unitPriceMinor: -1,
      };

      const result = saveCatalogueItemActionInputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('AC-7: archiveCatalogueItemActionInputSchema requires valid UUID', () => {
      const valid = archiveCatalogueItemActionInputSchema.safeParse({
        id: '01920000-0000-7000-8000-000000000001',
        isActive: false,
      });
      expect(valid.success).toBe(true);

      const invalid = archiveCatalogueItemActionInputSchema.safeParse({
        id: 'invalid-uuid',
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe('Studio Tax Settings Schema & Helpers (AC-5)', () => {
    it('AC-5: validates tax settings update schema', () => {
      const valid = {
        taxNumber: '12/345/67890',
        vatId: 'DE123456789',
        isKleinunternehmer: true,
        kleinunternehmerNotice: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
        defaultTaxRateBasisPoints: 0,
        pricesIncludeTax: true,
      };

      const parsed = updateStudioTaxSettingsSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
    });

    it('AC-5: rejects tax numbers or VAT IDs exceeding 50 characters', () => {
      const invalid = {
        taxNumber: 'A'.repeat(51),
      };

      const result = updateStudioTaxSettingsSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('AC-5: resolves effective Kleinunternehmer notice with locale fallback', () => {
      expect(getEffectiveKleinunternehmerNotice({ is_kleinunternehmer: false }, 'de')).toBeNull();
      expect(getEffectiveKleinunternehmerNotice({ is_kleinunternehmer: true }, 'de')).toBe(
        DEFAULT_KLEINUNTERNEHMER_NOTICES.de,
      );
      expect(getEffectiveKleinunternehmerNotice({ is_kleinunternehmer: true }, 'en')).toBe(
        DEFAULT_KLEINUNTERNEHMER_NOTICES.en,
      );
      expect(
        getEffectiveKleinunternehmerNotice(
          { is_kleinunternehmer: true, kleinunternehmer_notice: 'Custom Notice' },
          'de',
        ),
      ).toBe('Custom Notice');
    });

    it('AC-5: maps StudioSettings DB model to tax form data', () => {
      const fakeSettings: StudioSettings = {
        id: '01920000-0000-7000-8000-000000000001',
        studio_name: 'Studio Test',
        default_locale: 'de',
        timezone: 'Europe/Berlin',
        currency: 'EUR',
        mfa_required: false,
        mfa_postponed_until: null,
        forms_pow_hmac_key: null,
        tax_number: '12/345/67890',
        vat_id: 'DE123456789',
        is_kleinunternehmer: true,
        kleinunternehmer_notice: null,
        default_tax_rate_basis_points: 0,
        prices_include_tax: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const formData = studioSettingsToTaxFormData(fakeSettings, 'de');
      expect(formData.taxNumber).toBe('12/345/67890');
      expect(formData.vatId).toBe('DE123456789');
      expect(formData.isKleinunternehmer).toBe(true);
      expect(formData.taxRateSelection).toBe('0');
      expect(formData.kleinunternehmerNotice).toBe(DEFAULT_KLEINUNTERNEHMER_NOTICES.de);
    });

    it('AC-5: validates tax settings form helper', () => {
      const validForm: TaxSettingsFormData = {
        taxNumber: '12/345/67890',
        vatId: 'DE123456789',
        isKleinunternehmer: true,
        kleinunternehmerNotice: 'Notice',
        defaultTaxRateBasisPoints: 1900,
        taxRateSelection: '1900',
        customTaxRatePercent: '19',
        pricesIncludeTax: true,
      };

      const result = validateTaxSettingsForm(validForm);
      expect(result.isValid).toBe(true);
      expect(Object.keys(result.errors).length).toBe(0);

      const invalidForm = {
        ...validForm,
        taxNumber: 'X'.repeat(51),
        defaultTaxRateBasisPoints: -10,
      };
      const invalidResult = validateTaxSettingsForm(invalidForm);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors.taxNumber).toBeDefined();
      expect(invalidResult.errors.defaultTaxRate).toBeDefined();
    });
  });

  describe('Packages View-Model Helpers (AC-1, AC-2, AC-7)', () => {
    it('AC-1: formatTaxRateBasisPoints formats basis points to percent string', () => {
      expect(formatTaxRateBasisPoints(1900)).toBe('19%');
      expect(formatTaxRateBasisPoints(700)).toBe('7%');
      expect(formatTaxRateBasisPoints(0)).toBe('0%');
      expect(formatTaxRateBasisPoints(1950)).toBe('19.5%');
    });

    it('AC-1: parseTaxRateToBasisPoints parses user inputs accurately', () => {
      expect(parseTaxRateToBasisPoints('19')).toBe(1900);
      expect(parseTaxRateToBasisPoints('19%')).toBe(1900);
      expect(parseTaxRateToBasisPoints('7.5')).toBe(750);
      expect(parseTaxRateToBasisPoints('7,5%')).toBe(750);
      expect(parseTaxRateToBasisPoints(19)).toBe(1900);
      expect(parseTaxRateToBasisPoints(0)).toBe(0);
      expect(parseTaxRateToBasisPoints('-5')).toBeNull();
      expect(parseTaxRateToBasisPoints('105')).toBeNull();
      expect(parseTaxRateToBasisPoints('abc')).toBeNull();
      expect(parseTaxRateToBasisPoints('')).toBeNull();
    });

    it('AC-1: computeSlugFromTitle generates slug unless overridden by user', () => {
      expect(computeSlugFromTitle('Full Day Wedding Coverage', '')).toBe(
        'full-day-wedding-coverage',
      );
      expect(computeSlugFromTitle('Hochzeits-Paket Große Feier', '')).toBe(
        'hochzeits-paket-grosse-feier',
      );
      expect(computeSlugFromTitle('New Title', 'custom-slug', true)).toBe('custom-slug');
    });

    it('AC-3: splitPackagesByActiveStatus separates active and archived packages', () => {
      const mockPkgs: PackageWithIncludedItems[] = [
        {
          id: '1',
          name: 'Active 1',
          slug: 'active-1',
          description: null,
          projectTypeKey: 'wedding',
          basePriceMinor: 1000,
          currency: 'EUR',
          taxRateBasisPoints: 1900,
          position: 0,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          includedItems: [],
        },
        {
          id: '2',
          name: 'Archived 1',
          slug: 'archived-1',
          description: null,
          projectTypeKey: 'wedding',
          basePriceMinor: 2000,
          currency: 'EUR',
          taxRateBasisPoints: 1900,
          position: 1,
          isActive: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          includedItems: [],
        },
      ];

      const { active, archived } = splitPackagesByActiveStatus(mockPkgs);
      expect(active.length).toBe(1);
      expect(active[0]?.id).toBe('1');
      expect(archived.length).toBe(1);
      expect(archived[0]?.id).toBe('2');
    });

    it('AC-1: filterPackagesByProjectType filters packages by key', () => {
      const mockPkgs: PackageWithIncludedItems[] = [
        {
          id: '1',
          name: 'Wedding',
          slug: 'wedding',
          description: null,
          projectTypeKey: 'wedding',
          basePriceMinor: 1000,
          currency: 'EUR',
          taxRateBasisPoints: 1900,
          position: 0,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          includedItems: [],
        },
        {
          id: '2',
          name: 'Portrait',
          slug: 'portrait',
          description: null,
          projectTypeKey: 'portrait',
          basePriceMinor: 1000,
          currency: 'EUR',
          taxRateBasisPoints: 1900,
          position: 1,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          includedItems: [],
        },
      ];

      expect(filterPackagesByProjectType(mockPkgs, 'all').length).toBe(2);
      expect(filterPackagesByProjectType(mockPkgs, 'wedding').length).toBe(1);
      expect(filterPackagesByProjectType(mockPkgs, 'commercial').length).toBe(0);
    });

    it('AC-2: moveDeliverable immutably moves item and updates sequential positions', () => {
      const items = [
        { id: 'a', title: 'First', position: 0 },
        { id: 'b', title: 'Second', position: 1 },
        { id: 'c', title: 'Third', position: 2 },
      ];

      const reordered = moveDeliverable(items, 0, 2);
      expect(reordered.map((i) => i.id)).toEqual(['b', 'c', 'a']);
      expect(reordered.map((i) => i.position)).toEqual([0, 1, 2]);

      // Out of bounds safety
      expect(moveDeliverable(items, -1, 2)).toEqual(items);
      expect(moveDeliverable(items, 0, 5)).toEqual(items);
    });

    it('AC-7: validatePackageForm checks all required fields and child deliverables', () => {
      const validForm: PackageFormData = {
        name: 'Wedding Package',
        slug: 'wedding-package',
        projectTypeKey: 'wedding',
        basePriceMajor: '2500.00',
        taxRateBasisPoints: 1900,
        taxRateCustomPercent: '19',
        description: 'Details',
        includedItems: [{ title: 'Coverage', quantity: 1, position: 0 }],
      };

      const validResult = validatePackageForm(validForm);
      expect(validResult.isValid).toBe(true);

      const invalidForm: PackageFormData = {
        name: '',
        slug: 'INVALID SLUG',
        projectTypeKey: '',
        basePriceMajor: '-10.00',
        taxRateBasisPoints: 12000,
        taxRateCustomPercent: '120',
        description: '',
        includedItems: [{ title: '', quantity: 0, position: 0 }],
      };

      const invalidResult = validatePackageForm(invalidForm);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors.name).toBeDefined();
      expect(invalidResult.errors.slug).toBeDefined();
      expect(invalidResult.errors.basePrice).toBeDefined();
      expect(invalidResult.errors.taxRate).toBeDefined();
      expect(invalidResult.errors.deliverables?.[0]?.title).toBeDefined();
      expect(invalidResult.errors.deliverables?.[0]?.quantity).toBeDefined();
    });

    it('AC-1: packageToFormData initializes empty form or maps existing package', () => {
      const emptyForm = packageToFormData(null);
      expect(emptyForm.name).toBe('');
      expect(emptyForm.includedItems).toEqual([]);

      const mockPkg: PackageWithIncludedItems = {
        id: 'pkg-1',
        name: 'Classic Portrait',
        slug: 'classic-portrait',
        description: 'Studio session',
        projectTypeKey: 'portrait',
        basePriceMinor: 35000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        includedItems: [
          {
            id: 'del-1',
            packageId: 'pkg-1',
            title: '1 Hour Shoot',
            description: null,
            quantity: 1,
            position: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      };

      const populated = packageToFormData(mockPkg);
      expect(populated.id).toBe('pkg-1');
      expect(populated.name).toBe('Classic Portrait');
      expect(populated.basePriceMajor).toBe('350.00');
      expect(populated.includedItems.length).toBe(1);
    });
  });

  describe('Catalogue View-Model Helpers (AC-4, AC-7)', () => {
    it('AC-7: validateCatalogueItemForm checks item name, slug, price, tax', () => {
      const valid: CatalogueItemFormData = {
        name: 'Extra Hour',
        slug: 'extra-hour',
        category: 'service',
        unitPriceMajor: '150.00',
        taxRateBasisPoints: 1900,
        taxRateCustomPercent: '19',
        description: '',
        isActive: true,
      };

      expect(validateCatalogueItemForm(valid).isValid).toBe(true);

      const invalid: CatalogueItemFormData = {
        ...valid,
        name: '',
        slug: 'Invalid Slug!',
        unitPriceMajor: 'not a number',
      };

      const invalidResult = validateCatalogueItemForm(invalid);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors.name).toBeDefined();
      expect(invalidResult.errors.slug).toBeDefined();
      expect(invalidResult.errors.unitPrice).toBeDefined();
    });

    it('AC-4: filterCatalogueItems filters by category and active status', () => {
      const items: CatalogueItem[] = [
        {
          id: '1',
          name: 'Hour',
          slug: 'hour',
          description: null,
          category: 'service',
          unitPriceMinor: 15000,
          currency: 'EUR',
          taxRateBasisPoints: 1900,
          position: 0,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          name: 'Album',
          slug: 'album',
          description: null,
          category: 'product',
          unitPriceMinor: 65000,
          currency: 'EUR',
          taxRateBasisPoints: 1900,
          position: 1,
          isActive: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      expect(filterCatalogueItems(items, 'all', false).length).toBe(1);
      expect(filterCatalogueItems(items, 'all', true).length).toBe(2);
      expect(filterCatalogueItems(items, 'product', true).length).toBe(1);
      expect(filterCatalogueItems(items, 'travel', true).length).toBe(0);
    });

    it('AC-4: catalogueItemToFormData maps item or empty defaults', () => {
      const empty = catalogueItemToFormData(null);
      expect(empty.name).toBe('');
      expect(empty.category).toBe('service');

      const item: CatalogueItem = {
        id: '1',
        name: 'Travel Fee',
        slug: 'travel-fee',
        description: 'Per km',
        category: 'travel',
        unitPriceMinor: 50,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mapped = catalogueItemToFormData(item);
      expect(mapped.id).toBe('1');
      expect(mapped.name).toBe('Travel Fee');
      expect(mapped.unitPriceMajor).toBe('0.50');
      expect(mapped.category).toBe('travel');
    });

    it('AC-4: getCategoryBadgeClasses returns styling per category', () => {
      expect(getCategoryBadgeClasses('service')).toContain('primary');
      expect(getCategoryBadgeClasses('product')).toContain('blue');
      expect(getCategoryBadgeClasses('travel')).toContain('amber');
      expect(getCategoryBadgeClasses('licensing')).toContain('purple');
    });
  });

  describe('Translation Key Parity Check (AC-8)', () => {
    it('AC-8: checks complete parity between en.json and de.json for settings.packages and settings.tax', () => {
      const enPath = path.resolve(process.cwd(), 'messages/en.json');
      const dePath = path.resolve(process.cwd(), 'messages/de.json');

      interface MessagesStructure {
        settings: {
          packages: Record<string, unknown>;
          tax: Record<string, unknown>;
        };
      }
      const enJson = JSON.parse(fs.readFileSync(enPath, 'utf8')) as MessagesStructure;
      const deJson = JSON.parse(fs.readFileSync(dePath, 'utf8')) as MessagesStructure;

      expect(enJson.settings.packages).toBeDefined();
      expect(deJson.settings.packages).toBeDefined();
      expect(enJson.settings.tax).toBeDefined();
      expect(deJson.settings.tax).toBeDefined();

      function getKeys(obj: Record<string, unknown>, prefix = ''): string[] {
        let keys: string[] = [];
        for (const [key, value] of Object.entries(obj)) {
          const fullKey = prefix ? `${prefix}.${key}` : key;
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            keys = keys.concat(getKeys(value as Record<string, unknown>, fullKey));
          } else {
            keys.push(fullKey);
          }
        }
        return keys;
      }

      const enPackageKeys = getKeys(enJson.settings.packages).sort();
      const dePackageKeys = getKeys(deJson.settings.packages).sort();
      expect(enPackageKeys).toEqual(dePackageKeys);

      const enTaxKeys = getKeys(enJson.settings.tax).sort();
      const deTaxKeys = getKeys(deJson.settings.tax).sort();
      expect(enTaxKeys).toEqual(deTaxKeys);
    });
  });

  describe('Edge-case Helper Validation Branches', () => {
    it('AC-5: validates tax settings form edge-cases (oversized inputs, out of range rates)', () => {
      const oversizedTaxNo = validateTaxSettingsForm({
        taxNumber: 'A'.repeat(55),
        vatId: '',
        isKleinunternehmer: false,
        kleinunternehmerNotice: '',
        defaultTaxRateBasisPoints: 1900,
        taxRateSelection: '1900',
        customTaxRatePercent: '19',
        pricesIncludeTax: true,
      });
      expect(oversizedTaxNo.isValid).toBe(false);
      expect(oversizedTaxNo.errors.taxNumber).toBeDefined();

      const oversizedVat = validateTaxSettingsForm({
        taxNumber: '',
        vatId: 'DE'.padEnd(55, '9'),
        isKleinunternehmer: false,
        kleinunternehmerNotice: '',
        defaultTaxRateBasisPoints: 1900,
        taxRateSelection: '1900',
        customTaxRatePercent: '19',
        pricesIncludeTax: true,
      });
      expect(oversizedVat.isValid).toBe(false);
      expect(oversizedVat.errors.vatId).toBeDefined();

      const invalidBps = validateTaxSettingsForm({
        taxNumber: '',
        vatId: '',
        isKleinunternehmer: false,
        kleinunternehmerNotice: '',
        defaultTaxRateBasisPoints: -1,
        taxRateSelection: 'custom',
        customTaxRatePercent: '-0.01',
        pricesIncludeTax: true,
      });
      expect(invalidBps.isValid).toBe(false);
      expect(invalidBps.errors.defaultTaxRate).toBeDefined();

      const oversizedNotice = validateTaxSettingsForm({
        taxNumber: '',
        vatId: '',
        isKleinunternehmer: true,
        kleinunternehmerNotice: 'X'.repeat(1050),
        defaultTaxRateBasisPoints: 1900,
        taxRateSelection: '1900',
        customTaxRatePercent: '19',
        pricesIncludeTax: true,
      });
      expect(oversizedNotice.isValid).toBe(false);
      expect(oversizedNotice.errors.kleinunternehmerNotice).toBeDefined();
    });

    it('AC-4: validates catalogue form edge-cases (empty slug, invalid category, out of range tax)', () => {
      const emptySlug = validateCatalogueItemForm({
        name: 'Item',
        slug: '   ',
        category: 'service',
        unitPriceMajor: '10.00',
        taxRateBasisPoints: 1900,
        taxRateCustomPercent: '19',
        description: '',
        isActive: true,
      });
      expect(emptySlug.isValid).toBe(false);
      expect(emptySlug.errors.slug).toBe('Slug is required');

      const invalidCat = validateCatalogueItemForm({
        name: 'Item',
        slug: 'item',
        category: 'unsupported' as unknown as CatalogueItemFormData['category'],
        unitPriceMajor: '10.00',
        taxRateBasisPoints: 1900,
        taxRateCustomPercent: '19',
        description: '',
        isActive: true,
      });
      expect(invalidCat.isValid).toBe(false);
      expect(invalidCat.errors.category).toBe('Invalid catalogue category');

      const invalidTax = validateCatalogueItemForm({
        name: 'Item',
        slug: 'item',
        category: 'service',
        unitPriceMajor: '10.00',
        taxRateBasisPoints: 12000,
        taxRateCustomPercent: '120',
        description: '',
        isActive: true,
      });
      expect(invalidTax.isValid).toBe(false);
      expect(invalidTax.errors.taxRate).toBe('Tax rate must be between 0% and 100%');

      // Test badge classes fallback
      expect(
        getCategoryBadgeClasses('unknown' as unknown as CatalogueItemFormData['category']),
      ).toContain('border-border');
    });

    it('AC-7: validates package form edge-cases (out-of-range tax rate, deliverable errors)', () => {
      const outOfRangeTax = validatePackageForm({
        name: 'Pkg',
        slug: 'pkg',
        projectTypeKey: '',
        basePriceMajor: '100',
        taxRateBasisPoints: 10500,
        taxRateCustomPercent: '105',
        description: '',
        includedItems: [],
      });
      expect(outOfRangeTax.isValid).toBe(false);
      expect(outOfRangeTax.errors.taxRate).toBe('Tax rate must be between 0% and 100%');

      const invalidDeliverable = validatePackageForm({
        name: 'Pkg',
        slug: 'pkg',
        projectTypeKey: '',
        basePriceMajor: '100',
        taxRateBasisPoints: 1900,
        taxRateCustomPercent: '19',
        description: '',
        includedItems: [
          {
            title: '',
            quantity: 0,
            position: 0,
          },
        ],
      });
      expect(invalidDeliverable.isValid).toBe(false);
      expect(invalidDeliverable.errors.deliverables?.[0]?.title).toBe(
        'Deliverable title is required',
      );
      expect(invalidDeliverable.errors.deliverables?.[0]?.quantity).toBe(
        'Quantity must be at least 1',
      );

      const emptySlugPkg = validatePackageForm({
        name: 'Pkg',
        slug: '   ',
        projectTypeKey: '',
        basePriceMajor: '100',
        taxRateBasisPoints: 1900,
        taxRateCustomPercent: '19',
        description: '',
        includedItems: [],
      });
      expect(emptySlugPkg.isValid).toBe(false);
      expect(emptySlugPkg.errors.slug).toBe('Slug is required');
    });

    it('AC-5: studioSettingsToTaxFormData maps all tax presets, German locale, and custom notices', () => {
      const baseRow: StudioSettings = {
        id: '01920000-0000-7000-8000-000000000001',
        studio_name: 'Test Studio',
        default_locale: 'en',
        timezone: 'UTC',
        currency: 'EUR',
        mfa_required: false,
        mfa_postponed_until: null,
        forms_pow_hmac_key: null,
        tax_number: '123/456',
        vat_id: 'DE123456789',
        default_tax_rate_basis_points: 700,
        is_kleinunternehmer: true,
        kleinunternehmer_notice: 'Custom statutory note',
        prices_include_tax: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const deForm = studioSettingsToTaxFormData(baseRow, 'de');
      expect(deForm.taxRateSelection).toBe('700');
      expect(deForm.kleinunternehmerNotice).toBe('Custom statutory note');

      const zeroBpsRow = {
        ...baseRow,
        default_tax_rate_basis_points: 0,
        kleinunternehmer_notice: null,
      };
      const zeroForm = studioSettingsToTaxFormData(zeroBpsRow, 'de');
      expect(zeroForm.taxRateSelection).toBe('0');
      expect(zeroForm.kleinunternehmerNotice).toBe(DEFAULT_KLEINUNTERNEHMER_NOTICES.de);

      const customBpsRow = {
        ...baseRow,
        default_tax_rate_basis_points: 1250,
        kleinunternehmer_notice: '',
      };
      const customForm = studioSettingsToTaxFormData(customBpsRow, 'en');
      expect(customForm.taxRateSelection).toBe('custom');
      expect(customForm.kleinunternehmerNotice).toBe(DEFAULT_KLEINUNTERNEHMER_NOTICES.en);

      const standardBpsRow = {
        ...baseRow,
        default_tax_rate_basis_points: 1900,
        tax_number: null,
        vat_id: null,
      };
      const standardForm = studioSettingsToTaxFormData(standardBpsRow, 'en');
      expect(standardForm.taxRateSelection).toBe('1900');
      expect(standardForm.taxNumber).toBe('');
      expect(standardForm.vatId).toBe('');
    });

    it('AC-1: packageToFormData and filterPackagesByProjectType handle null values', () => {
      const pkgWithNulls: PackageWithIncludedItems = {
        id: '01920000-0000-7000-8000-000000000001',
        name: 'Null Test',
        slug: 'null-test',
        description: null,
        projectTypeKey: null,
        basePriceMinor: 5000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        includedItems: [],
      };

      const formData = packageToFormData(pkgWithNulls);
      expect(formData.projectTypeKey).toBe('');
      expect(formData.description).toBe('');

      const filtered = filterPackagesByProjectType([pkgWithNulls], 'wedding');
      expect(filtered.length).toBe(0);
    });
  });
});
