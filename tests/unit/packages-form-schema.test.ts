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
  initPackageFormState,
  packageFormReducer,
  buildPackageSavePayload,
  createModalDialogHandlers,
  handleDeliverableFieldChange,
  handleDeliverableReorderOrRemove,
  createDeliverableRowHandlers,
  createPackageModalHandlers,
  createArchiveDialogHandlers,
  createPackagesSectionHandlers,
  createPackagesViewHandlers,
  createPackagesViewActionHandlers,
  type PackageFormData,
  type PackageFormAction,
} from '@/components/settings/packages/packages-helpers';
import {
  validateCatalogueItemForm,
  filterCatalogueItems,
  catalogueItemToFormData,
  getCategoryBadgeClasses,
  initCatalogueFormState,
  catalogueFormReducer,
  buildCatalogueItemSavePayload,
  createCatalogueItemModalHandlers,
  createCatalogueSectionHandlers,
  type CatalogueItemFormData,
  type CatalogueFormAction,
} from '@/components/settings/packages/catalogue-helpers';
import {
  validateTaxSettingsForm,
  studioSettingsToTaxFormData,
  taxSettingsFormReducer,
  buildTaxSettingsSavePayload,
  createTaxSettingsHandlers,
  type TaxSettingsFormData,
  type TaxSettingsFormAction,
  type TaxSettingsFormErrors,
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

    it('AC-1 & AC-2: packageFormReducer handles all field and deliverable mutations', () => {
      let state = initPackageFormState(null);
      expect(state.formData.name).toBe('');
      expect(state.isSlugManuallyEdited).toBe(false);

      // SET_TITLE updates name and auto-computes slug
      state = packageFormReducer(state, { type: 'SET_TITLE', title: 'Summer Wedding' });
      expect(state.formData.name).toBe('Summer Wedding');
      expect(state.formData.slug).toBe('summer-wedding');

      // SET_SLUG marks slug manually edited
      state = packageFormReducer(state, { type: 'SET_SLUG', slug: 'custom-slug' });
      expect(state.formData.slug).toBe('custom-slug');
      expect(state.isSlugManuallyEdited).toBe(true);

      // Title change preserves manual slug
      state = packageFormReducer(state, { type: 'SET_TITLE', title: 'Autumn Wedding' });
      expect(state.formData.name).toBe('Autumn Wedding');
      expect(state.formData.slug).toBe('custom-slug');

      // SET_PROJECT_TYPE
      state = packageFormReducer(state, { type: 'SET_PROJECT_TYPE', projectTypeKey: 'wedding' });
      expect(state.formData.projectTypeKey).toBe('wedding');

      // SET_BASE_PRICE
      state = packageFormReducer(state, { type: 'SET_BASE_PRICE', basePriceMajor: '2500' });
      expect(state.formData.basePriceMajor).toBe('2500');

      // SET_TAX_RATE_PRESET
      state = packageFormReducer(state, { type: 'SET_TAX_RATE_PRESET', preset: '700' });
      expect(state.formData.taxRateBasisPoints).toBe(700);
      expect(state.formData.taxRateCustomPercent).toBe('7');

      state = packageFormReducer(state, { type: 'SET_TAX_RATE_PRESET', preset: 'custom' });
      expect(state.formData.taxRateBasisPoints).toBe(1900);
      expect(state.formData.taxRateCustomPercent).toBe('19');

      // SET_CUSTOM_TAX_RATE
      state = packageFormReducer(state, { type: 'SET_CUSTOM_TAX_RATE', percent: '8.5' });
      expect(state.formData.taxRateBasisPoints).toBe(850);
      expect(state.formData.taxRateCustomPercent).toBe('8.5');

      // SET_DESCRIPTION
      state = packageFormReducer(state, { type: 'SET_DESCRIPTION', description: 'Full coverage' });
      expect(state.formData.description).toBe('Full coverage');

      // ADD_DELIVERABLE
      state = packageFormReducer(state, { type: 'ADD_DELIVERABLE' });
      expect(state.formData.includedItems.length).toBe(1);
      expect(state.formData.includedItems[0]?.position).toBe(0);

      // UPDATE_DELIVERABLE_TITLE
      state = packageFormReducer(state, {
        type: 'UPDATE_DELIVERABLE_TITLE',
        index: 0,
        title: '8 Hours',
      });
      expect(state.formData.includedItems[0]?.title).toBe('8 Hours');

      // UPDATE_DELIVERABLE_DESC
      state = packageFormReducer(state, {
        type: 'UPDATE_DELIVERABLE_DESC',
        index: 0,
        description: 'Ceremony & reception',
      });
      expect(state.formData.includedItems[0]?.description).toBe('Ceremony & reception');

      // UPDATE_DELIVERABLE_QTY
      state = packageFormReducer(state, {
        type: 'UPDATE_DELIVERABLE_QTY',
        index: 0,
        quantity: 2,
      });
      expect(state.formData.includedItems[0]?.quantity).toBe(2);

      // Add second deliverable and test MOVE_DELIVERABLE
      state = packageFormReducer(state, { type: 'ADD_DELIVERABLE' });
      state = packageFormReducer(state, {
        type: 'UPDATE_DELIVERABLE_TITLE',
        index: 1,
        title: 'Album',
      });
      expect(state.formData.includedItems.length).toBe(2);
      expect(state.formData.includedItems[0]?.title).toBe('8 Hours');
      expect(state.formData.includedItems[1]?.title).toBe('Album');

      state = packageFormReducer(state, { type: 'MOVE_DELIVERABLE', from: 0, to: 1 });
      expect(state.formData.includedItems[0]?.title).toBe('Album');
      expect(state.formData.includedItems[1]?.title).toBe('8 Hours');

      // REMOVE_DELIVERABLE
      state = packageFormReducer(state, { type: 'REMOVE_DELIVERABLE', index: 0 });
      expect(state.formData.includedItems.length).toBe(1);
      expect(state.formData.includedItems[0]?.title).toBe('8 Hours');
      expect(state.formData.includedItems[0]?.position).toBe(0);

      // SET_ERRORS & RESET
      state = packageFormReducer(state, {
        type: 'SET_ERRORS',
        errors: { name: 'Name required' },
      });
      expect(state.errors.name).toBe('Name required');

      state = packageFormReducer(state, { type: 'RESET', pkg: null });
      expect(state.formData.name).toBe('');
      expect(state.errors.name).toBeUndefined();

      // buildPackageSavePayload
      const payload = buildPackageSavePayload({
        ...state.formData,
        name: ' Summer Package ',
        slug: ' summer-pkg ',
        basePriceMajor: '1500.50',
        includedItems: [{ title: ' Item 1 ', description: ' Desc 1 ', quantity: 1, position: 0 }],
      });
      expect(payload.name).toBe('Summer Package');
      expect(payload.slug).toBe('summer-pkg');
      expect(payload.basePriceMinor).toBe(150050);
      expect(payload.includedItems[0]?.title).toBe('Item 1');
    });

    it('AC-1: handleDeliverableFieldChange and handleDeliverableReorderOrRemove dispatch correctly', () => {
      const dispatched: unknown[] = [];
      const dispatch = (action: PackageFormAction) => {
        dispatched.push(action);
      };

      handleDeliverableFieldChange(dispatch, 0, 'title', 'New Title');
      handleDeliverableFieldChange(dispatch, 0, 'description', 'New Desc');
      handleDeliverableFieldChange(dispatch, 0, 'quantity', 3);

      expect(dispatched).toEqual([
        { type: 'UPDATE_DELIVERABLE_TITLE', index: 0, title: 'New Title' },
        { type: 'UPDATE_DELIVERABLE_DESC', index: 0, description: 'New Desc' },
        { type: 'UPDATE_DELIVERABLE_QTY', index: 0, quantity: 3 },
      ]);

      const reorderDispatched: unknown[] = [];
      const reorderDispatch = (action: PackageFormAction) => {
        reorderDispatched.push(action);
      };

      handleDeliverableReorderOrRemove(reorderDispatch, 'up', 1);
      handleDeliverableReorderOrRemove(reorderDispatch, 'down', 1);
      handleDeliverableReorderOrRemove(reorderDispatch, 'remove', 1);

      expect(reorderDispatched).toEqual([
        { type: 'MOVE_DELIVERABLE', from: 1, to: 0 },
        { type: 'MOVE_DELIVERABLE', from: 1, to: 2 },
        { type: 'REMOVE_DELIVERABLE', index: 1 },
      ]);
    });

    it('AC-1: createModalDialogHandlers manages open changes and focus restoration', () => {
      let closed = false;
      let focused = false;
      const triggerRef = {
        current: {
          focus: () => {
            focused = true;
          },
        },
      };

      const handlers = createModalDialogHandlers(() => {
        closed = true;
      }, triggerRef);

      handlers.onOpenChange(false);
      expect(closed).toBe(true);

      let prevented = false;
      handlers.onCloseAutoFocus({
        preventDefault: () => {
          prevented = true;
        },
      });
      expect(prevented).toBe(true);
      expect(focused).toBe(true);
    });

    it('AC-4: catalogueFormReducer handles all field updates and resets', () => {
      let state = initCatalogueFormState(null);
      expect(state.formData.name).toBe('');
      expect(state.formData.category).toBe('service');

      state = catalogueFormReducer(state, { type: 'SET_NAME', name: 'Drone Photography' });
      expect(state.formData.name).toBe('Drone Photography');
      expect(state.formData.slug).toBe('drone-photography');

      state = catalogueFormReducer(state, { type: 'SET_SLUG', slug: 'drone-aerial' });
      expect(state.formData.slug).toBe('drone-aerial');

      state = catalogueFormReducer(state, { type: 'SET_CATEGORY', category: 'product' });
      expect(state.formData.category).toBe('product');

      state = catalogueFormReducer(state, { type: 'SET_PRICE', unitPriceMajor: '350' });
      expect(state.formData.unitPriceMajor).toBe('350');

      state = catalogueFormReducer(state, { type: 'SET_TAX_RATE_PRESET', preset: '1900' });
      expect(state.formData.taxRateBasisPoints).toBe(1900);

      state = catalogueFormReducer(state, { type: 'SET_TAX_RATE_PRESET', preset: 'custom' });
      expect(state.formData.taxRateBasisPoints).toBe(1900);

      state = catalogueFormReducer(state, { type: 'SET_CUSTOM_TAX_RATE', percent: '7.7' });
      expect(state.formData.taxRateBasisPoints).toBe(770);

      state = catalogueFormReducer(state, {
        type: 'SET_DESCRIPTION',
        description: '4K aerial shots',
      });
      expect(state.formData.description).toBe('4K aerial shots');

      state = catalogueFormReducer(state, { type: 'SET_ACTIVE', isActive: false });
      expect(state.formData.isActive).toBe(false);

      state = catalogueFormReducer(state, {
        type: 'SET_ERRORS',
        errors: { name: 'Name error' },
      });
      expect(state.errors.name).toBe('Name error');

      state = catalogueFormReducer(state, { type: 'RESET', item: null });
      expect(state.formData.name).toBe('');

      const payload = buildCatalogueItemSavePayload({
        ...state.formData,
        name: ' Print Album ',
        slug: ' print-album ',
        category: 'product',
        unitPriceMajor: '250',
        isActive: true,
      });
      expect(payload.name).toBe('Print Album');
      expect(payload.unitPriceMinor).toBe(25000);
      expect(payload.isActive).toBe(true);
    });

    it('AC-5: taxSettingsFormReducer handles all tax field updates and presets', () => {
      const baseRow: StudioSettings = {
        id: '01920000-0000-7000-8000-000000000001',
        studio_name: 'Studio Test',
        tax_number: '12/345/67890',
        vat_id: 'DE123456789',
        is_kleinunternehmer: false,
        kleinunternehmer_notice: null,
        default_tax_rate_basis_points: 1900,
        prices_include_tax: true,
        created_at: new Date(),
        updated_at: new Date(),
      } as StudioSettings;

      let state = studioSettingsToTaxFormData(baseRow, 'en');
      expect(state.taxNumber).toBe('12/345/67890');

      state = taxSettingsFormReducer(state, {
        type: 'SET_TAX_NUMBER',
        taxNumber: '99/888/77777',
      });
      expect(state.taxNumber).toBe('99/888/77777');

      state = taxSettingsFormReducer(state, { type: 'SET_VAT_ID', vatId: 'DE999999999' });
      expect(state.vatId).toBe('DE999999999');

      state = taxSettingsFormReducer(state, {
        type: 'TOGGLE_KLEINUNTERNEHMER',
        isKleinunternehmer: true,
      });
      expect(state.isKleinunternehmer).toBe(true);

      state = taxSettingsFormReducer(state, {
        type: 'SET_NOTICE',
        notice: 'Custom statutory notice text',
      });
      expect(state.kleinunternehmerNotice).toBe('Custom statutory notice text');

      state = taxSettingsFormReducer(state, {
        type: 'SET_RATE_PRESET',
        selection: '0',
      });
      expect(state.taxRateSelection).toBe('0');
      expect(state.defaultTaxRateBasisPoints).toBe(0);

      state = taxSettingsFormReducer(state, {
        type: 'SET_RATE_PRESET',
        selection: 'custom',
      });
      expect(state.taxRateSelection).toBe('custom');
      expect(state.defaultTaxRateBasisPoints).toBe(1900);

      state = taxSettingsFormReducer(state, {
        type: 'SET_CUSTOM_RATE',
        percent: '12.5',
      });
      expect(state.defaultTaxRateBasisPoints).toBe(1250);

      state = taxSettingsFormReducer(state, {
        type: 'TOGGLE_PRICES_INCLUDE_TAX',
        pricesIncludeTax: false,
      });
      expect(state.pricesIncludeTax).toBe(false);

      const payload = buildTaxSettingsSavePayload(state);
      expect(payload.taxNumber).toBe('99/888/77777');
      expect(payload.vatId).toBe('DE999999999');
      expect(payload.isKleinunternehmer).toBe(true);
      expect(payload.kleinunternehmerNotice).toBe('Custom statutory notice text');
      expect(payload.defaultTaxRateBasisPoints).toBe(1250);
      expect(payload.pricesIncludeTax).toBe(false);
    });
  });

  describe('Interactive View Handlers & Controllers', () => {
    it('exercises createDeliverableRowHandlers', () => {
      const dispatched: unknown[] = [];
      const dispatch = (action: PackageFormAction) => dispatched.push(action);
      const handlers = createDeliverableRowHandlers(dispatch, 1);

      handlers.onTitleChange({ target: { value: 'Edited Title' } });
      handlers.onQtyChange({ target: { value: '3' } });
      handlers.onDescChange({ target: { value: 'Edited Desc' } });
      handlers.onMoveUp();
      handlers.onMoveDown();
      handlers.onRemove();

      expect(dispatched).toHaveLength(6);
      expect(dispatched[0]).toEqual({
        type: 'UPDATE_DELIVERABLE_TITLE',
        index: 1,
        title: 'Edited Title',
      });
      expect(dispatched[1]).toEqual({ type: 'UPDATE_DELIVERABLE_QTY', index: 1, quantity: 3 });
      expect(dispatched[2]).toEqual({
        type: 'UPDATE_DELIVERABLE_DESC',
        index: 1,
        description: 'Edited Desc',
      });
      expect(dispatched[3]).toEqual({ type: 'MOVE_DELIVERABLE', from: 1, to: 0 });
      expect(dispatched[4]).toEqual({ type: 'MOVE_DELIVERABLE', from: 1, to: 2 });
      expect(dispatched[5]).toEqual({ type: 'REMOVE_DELIVERABLE', index: 1 });
    });

    it('exercises createPackageModalHandlers', async () => {
      const dispatched: unknown[] = [];
      const dispatch = (action: PackageFormAction) => dispatched.push(action);
      const onSave = vi.fn().mockResolvedValue(true);
      const onClose = vi.fn();

      const invalidFormData: PackageFormData = {
        name: '',
        slug: '',
        projectTypeKey: '',
        basePriceMajor: '',
        taxRateBasisPoints: 1900,
        taxRateCustomPercent: '19',
        description: '',
        includedItems: [],
      };

      const handlers = createPackageModalHandlers(dispatch, invalidFormData, onSave, onClose);
      handlers.handleTitleChange({ target: { value: 'New Package' } });
      handlers.handleSlugChange({ target: { value: 'new-package' } });
      handlers.handleProjectTypeChange({ target: { value: 'wedding' } });
      handlers.handleBasePriceChange({ target: { value: '1500' } });
      handlers.handleTaxRatePresetChange({ target: { value: '700' } });
      handlers.handleCustomTaxRateChange({ target: { value: '12' } });
      handlers.handleDescriptionChange({ target: { value: 'New Description' } });
      handlers.handleAddDeliverable();

      expect(dispatched).toHaveLength(8);

      const invalidOk = await handlers.handleSubmit({ preventDefault: vi.fn() });
      expect(invalidOk).toBe(false);
      expect(dispatched[8]).toMatchObject({ type: 'SET_ERRORS' });
      handlers.onSubmit({ preventDefault: vi.fn() });

      const validFormData: PackageFormData = {
        name: 'Wedding Collection',
        slug: 'wedding-collection',
        projectTypeKey: 'wedding',
        basePriceMajor: '2500',
        taxRateBasisPoints: 1900,
        taxRateCustomPercent: '19',
        description: 'Details',
        includedItems: [{ title: 'Album', quantity: 1, position: 0 }],
      };

      const validHandlers = createPackageModalHandlers(dispatch, validFormData, onSave, onClose);
      const validOk = await validHandlers.handleSubmit();
      expect(validOk).toBe(true);
      expect(onSave).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      validHandlers.onSubmit({ preventDefault: vi.fn() });
    });

    it('exercises createArchiveDialogHandlers', () => {
      const onClose = vi.fn();
      const onConfirm = vi.fn();
      const trigger = { focus: vi.fn() };
      const triggerRef = { current: trigger };

      const dummy = { id: 'pkg-1', name: 'Package 1' };
      const handlers = createArchiveDialogHandlers(onClose, onConfirm, dummy, triggerRef);

      handlers.onOpenChange(false);
      expect(onClose).toHaveBeenCalled();

      const preventDefault = vi.fn();
      handlers.onCloseAutoFocus({ preventDefault });
      expect(preventDefault).toHaveBeenCalled();
      expect(trigger.focus).toHaveBeenCalled();

      handlers.handleConfirm();
      expect(onConfirm).toHaveBeenCalledWith(dummy);

      const nullHandlers = createArchiveDialogHandlers(onClose, onConfirm, null);
      nullHandlers.handleConfirm();
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('exercises createPackagesSectionHandlers', async () => {
      const triggerRef = { current: null };
      const setEditingPackage = vi.fn();
      const setIsModalOpen = vi.fn();
      const setArchivingPackage = vi.fn();
      const setIsModalSubmitting = vi.fn();
      const setIsArchiveSubmitting = vi.fn();
      const setTypeFilter = vi.fn();
      const setShowArchived = vi.fn();
      const onSavePackage = vi.fn().mockResolvedValue(true);
      const onArchivePackage = vi.fn().mockResolvedValue(true);

      const samplePackage = {
        id: 'pkg-001',
        name: 'Test Package',
        slug: 'test-package',
        description: null,
        projectTypeKey: 'wedding',
        basePriceMinor: 10000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        includedItems: [],
      };

      const handlers = createPackagesSectionHandlers({
        triggerRef,
        setEditingPackage,
        setIsModalOpen,
        setArchivingPackage,
        setIsModalSubmitting,
        setIsArchiveSubmitting,
        setTypeFilter,
        setShowArchived,
        onSavePackage,
        onArchivePackage,
        initialPackages: [samplePackage],
      });

      const element = {
        dataset: { pkgId: 'pkg-001' },
        focus: vi.fn(),
      } as unknown as HTMLElement;

      handlers.handleOpenCreateModal({ currentTarget: element });
      expect(setEditingPackage).toHaveBeenCalledWith(null);
      expect(setIsModalOpen).toHaveBeenCalledWith(true);

      handlers.handleOpenEditModal(samplePackage, { currentTarget: element });
      expect(setEditingPackage).toHaveBeenCalledWith(samplePackage);

      handlers.handleOpenArchiveDialog(samplePackage, { currentTarget: element });
      expect(setArchivingPackage).toHaveBeenCalledWith(samplePackage);

      await handlers.handleSaveModal({} as never);
      expect(onSavePackage).toHaveBeenCalled();

      await handlers.handleConfirmArchive(samplePackage);
      expect(onArchivePackage).toHaveBeenCalledWith('pkg-001', false);

      handlers.onConfirmArchive(samplePackage);
      expect(onArchivePackage).toHaveBeenCalledWith('pkg-001', false);

      await handlers.handleRestore('pkg-001');
      expect(onArchivePackage).toHaveBeenCalledWith('pkg-001', true);

      handlers.onTypeFilterChange({ target: { value: 'portrait' } });
      expect(setTypeFilter).toHaveBeenCalledWith('portrait');

      handlers.onToggleShowArchived();
      expect(setShowArchived).toHaveBeenCalled();

      handlers.onCloseModal();
      expect(setIsModalOpen).toHaveBeenCalledWith(false);

      handlers.onCloseArchiveDialog();
      expect(setArchivingPackage).toHaveBeenCalledWith(null);

      handlers.onEditPackageClick({ currentTarget: element });
      expect(setEditingPackage).toHaveBeenCalledWith(samplePackage);

      handlers.onArchivePackageClick({ currentTarget: element });
      expect(setArchivingPackage).toHaveBeenCalledWith(samplePackage);

      handlers.onRestorePackageClick({ currentTarget: element });
      expect(onArchivePackage).toHaveBeenCalledWith('pkg-001', true);
    });

    it('exercises createPackagesViewHandlers tab keyboard roving and clicks', () => {
      const setActiveTab = vi.fn();
      const handlers = createPackagesViewHandlers(setActiveTab);

      handlers.onTabClick({ currentTarget: { dataset: { tab: 'catalogue' } } });
      expect(setActiveTab).toHaveBeenCalledWith('catalogue');

      handlers.onTabKeyDown({ key: 'ArrowRight', currentTarget: { dataset: { index: '0' } } });
      expect(setActiveTab).toHaveBeenCalledWith('catalogue');

      handlers.onTabKeyDown({ key: 'ArrowLeft', currentTarget: { dataset: { index: '0' } } });
      expect(setActiveTab).toHaveBeenCalledWith('tax');

      handlers.onTabKeyDown({ key: 'Home', currentTarget: { dataset: { index: '2' } } });
      expect(setActiveTab).toHaveBeenCalledWith('packages');

      handlers.onTabKeyDown({ key: 'End', currentTarget: { dataset: { index: '0' } } });
      expect(setActiveTab).toHaveBeenCalledWith('tax');

      handlers.onTabKeyDown({ key: 'Enter', currentTarget: { dataset: { index: '0' } } });
    });

    it('exercises createPackagesViewActionHandlers', async () => {
      const setPackagesList = vi.fn(
        (updater: (prev: PackageWithIncludedItems[]) => PackageWithIncludedItems[]) => updater([]),
      );
      const setCatalogueList = vi.fn((updater: (prev: CatalogueItem[]) => CatalogueItem[]) =>
        updater([]),
      );
      const setTaxSettings = vi.fn();
      const router = { refresh: vi.fn() };
      const samplePkg = {
        id: 'pkg-1',
        name: 'Pkg 1',
        isActive: true,
      } as unknown as PackageWithIncludedItems;
      const sampleCat = { id: 'cat-1', name: 'Cat 1', isActive: true } as unknown as CatalogueItem;
      const sampleTax = { id: 'tax-1' } as unknown as StudioSettings;

      const savePackageAction = vi.fn().mockResolvedValue({ success: true, data: samplePkg });
      const archivePackageAction = vi.fn().mockResolvedValue({ success: true });
      const saveCatalogueItemAction = vi.fn().mockResolvedValue({ success: true, data: sampleCat });
      const archiveCatalogueItemAction = vi.fn().mockResolvedValue({ success: true });
      const updateStudioTaxSettingsAction = vi
        .fn()
        .mockResolvedValue({ success: true, data: sampleTax });

      const actions = createPackagesViewActionHandlers({
        setPackagesList,
        setCatalogueList,
        setTaxSettings,
        router,
        savePackageAction,
        archivePackageAction,
        saveCatalogueItemAction,
        archiveCatalogueItemAction,
        updateStudioTaxSettingsAction,
      });

      const ok1 = await actions.handleSavePackage({} as never);
      expect(ok1).toBe(true);
      expect(router.refresh).toHaveBeenCalled();

      // Test updating existing package in array
      const setPackagesListExisting = vi.fn(
        (updater: (prev: PackageWithIncludedItems[]) => PackageWithIncludedItems[]) =>
          updater([samplePkg]),
      );
      const actions2 = createPackagesViewActionHandlers({
        setPackagesList: setPackagesListExisting,
        setCatalogueList,
        setTaxSettings,
        router,
        savePackageAction,
        archivePackageAction,
        saveCatalogueItemAction,
        archiveCatalogueItemAction,
        updateStudioTaxSettingsAction,
      });
      await actions2.handleSavePackage({} as never);
      expect(setPackagesListExisting).toHaveBeenCalled();

      const ok2 = await actions.handleArchivePackage('pkg-1', false);
      expect(ok2).toBe(true);

      const ok3 = await actions.handleSaveCatalogueItem({} as never);
      expect(ok3).toBe(true);

      const setCatalogueListExisting = vi.fn(
        (updater: (prev: CatalogueItem[]) => CatalogueItem[]) => updater([sampleCat]),
      );
      const actions3 = createPackagesViewActionHandlers({
        setPackagesList,
        setCatalogueList: setCatalogueListExisting,
        setTaxSettings,
        router,
        savePackageAction,
        archivePackageAction,
        saveCatalogueItemAction,
        archiveCatalogueItemAction,
        updateStudioTaxSettingsAction,
      });
      await actions3.handleSaveCatalogueItem({} as never);
      expect(setCatalogueListExisting).toHaveBeenCalled();

      const ok4 = await actions.handleArchiveCatalogueItem('cat-1', false);
      expect(ok4).toBe(true);

      const ok5 = await actions.handleUpdateTaxSettings({});
      expect(ok5).toBe(true);
      expect(setTaxSettings).toHaveBeenCalledWith(sampleTax);

      // Exercise failure paths
      const failActions = createPackagesViewActionHandlers({
        setPackagesList,
        setCatalogueList,
        setTaxSettings,
        router,
        savePackageAction: vi.fn().mockResolvedValue({ success: false }),
        archivePackageAction: vi.fn().mockResolvedValue({ success: false }),
        saveCatalogueItemAction: vi.fn().mockResolvedValue({ success: false }),
        archiveCatalogueItemAction: vi.fn().mockResolvedValue({ success: false }),
        updateStudioTaxSettingsAction: vi.fn().mockResolvedValue({ success: false }),
      });

      expect(await failActions.handleSavePackage({} as never)).toBe(false);
      expect(await failActions.handleArchivePackage('pkg-1', false)).toBe(false);
      expect(await failActions.handleSaveCatalogueItem({} as never)).toBe(false);
      expect(await failActions.handleArchiveCatalogueItem('cat-1', false)).toBe(false);
      expect(await failActions.handleUpdateTaxSettings({})).toBe(false);

      // Exercise map non-matching ids in updater callbacks
      const setPackagesListNonMatching = vi.fn(
        (updater: (prev: PackageWithIncludedItems[]) => PackageWithIncludedItems[]) =>
          updater([{ ...samplePkg, id: 'pkg-other' }]),
      );
      const setCatalogueListNonMatching = vi.fn(
        (updater: (prev: CatalogueItem[]) => CatalogueItem[]) =>
          updater([{ ...sampleCat, id: 'cat-other' }]),
      );
      const actionsNonMatching = createPackagesViewActionHandlers({
        setPackagesList: setPackagesListNonMatching,
        setCatalogueList: setCatalogueListNonMatching,
        setTaxSettings,
        router,
        savePackageAction,
        archivePackageAction,
        saveCatalogueItemAction,
        archiveCatalogueItemAction,
        updateStudioTaxSettingsAction,
      });
      await actionsNonMatching.handleArchivePackage('pkg-1', false);
      expect(setPackagesListNonMatching).toHaveBeenCalled();
      await actionsNonMatching.handleArchiveCatalogueItem('cat-1', false);
      expect(setCatalogueListNonMatching).toHaveBeenCalled();
    });

    it('exercises createCatalogueItemModalHandlers', async () => {
      const dispatched: unknown[] = [];
      const dispatch = (action: CatalogueFormAction) => dispatched.push(action);
      const onSave = vi.fn().mockResolvedValue(true);
      const onClose = vi.fn();

      const invalidFormData: CatalogueItemFormData = {
        name: '',
        slug: '',
        category: 'service',
        unitPriceMajor: '',
        taxRateBasisPoints: 1900,
        taxRateCustomPercent: '19',
        description: '',
        isActive: true,
      };

      const handlers = createCatalogueItemModalHandlers(dispatch, invalidFormData, onSave, onClose);
      handlers.handleNameChange({ target: { value: 'New Service' } });
      handlers.handleSlugChange({ target: { value: 'new-service' } });
      handlers.handleCategoryChange({ target: { value: 'product' } });
      handlers.handleUnitPriceChange({ target: { value: '75' } });
      handlers.handleTaxRatePresetChange({ target: { value: '700' } });
      handlers.handleCustomTaxRateChange({ target: { value: '8.5' } });
      handlers.handleDescriptionChange({ target: { value: 'Product details' } });

      expect(dispatched).toHaveLength(7);

      const invalidOk = await handlers.handleSubmit();
      expect(invalidOk).toBe(false);
      handlers.onSubmit({ preventDefault: vi.fn() });

      const validFormData: CatalogueItemFormData = {
        name: 'Fine Art Print',
        slug: 'fine-art-print',
        category: 'product',
        unitPriceMajor: '150',
        taxRateBasisPoints: 1900,
        taxRateCustomPercent: '19',
        description: 'Archival print',
        isActive: true,
      };

      const validHandlers = createCatalogueItemModalHandlers(
        dispatch,
        validFormData,
        onSave,
        onClose,
      );
      const validOk = await validHandlers.handleSubmit();
      expect(validOk).toBe(true);
      expect(onSave).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      validHandlers.onSubmit({ preventDefault: vi.fn() });
    });

    it('exercises createCatalogueSectionHandlers', async () => {
      const triggerRef = { current: null };
      const setEditingItem = vi.fn();
      const setIsModalOpen = vi.fn();
      const setIsModalSubmitting = vi.fn();
      const setCategoryFilter = vi.fn();
      const setShowArchived = vi.fn();
      const onSaveCatalogueItem = vi.fn().mockResolvedValue(true);
      const onArchiveCatalogueItem = vi.fn().mockResolvedValue(true);

      const sampleItem = {
        id: 'cat-001',
        name: 'Extra Hour',
        slug: 'extra-hour',
        description: null,
        category: 'service' as const,
        unitPriceMinor: 20000,
        currency: 'EUR',
        taxRateBasisPoints: 1900,
        position: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const handlers = createCatalogueSectionHandlers({
        triggerRef,
        setEditingItem,
        setIsModalOpen,
        setIsModalSubmitting,
        setCategoryFilter,
        setShowArchived,
        onSaveCatalogueItem,
        onArchiveCatalogueItem,
        initialItems: [sampleItem],
      });

      const element = {
        dataset: { itemId: 'cat-001' },
        focus: vi.fn(),
      } as unknown as HTMLElement;

      handlers.handleOpenCreateModal({ currentTarget: element });
      expect(setEditingItem).toHaveBeenCalledWith(null);
      expect(setIsModalOpen).toHaveBeenCalledWith(true);

      handlers.handleOpenEditModal(sampleItem, { currentTarget: element });
      expect(setEditingItem).toHaveBeenCalledWith(sampleItem);

      await handlers.handleSaveModal({} as never);
      expect(onSaveCatalogueItem).toHaveBeenCalled();

      await handlers.handleToggleArchive(sampleItem);
      expect(onArchiveCatalogueItem).toHaveBeenCalledWith('cat-001', false);

      handlers.onCategoryFilterChange({ target: { value: 'travel' } });
      expect(setCategoryFilter).toHaveBeenCalledWith('travel');

      handlers.onShowArchivedChange();
      expect(setShowArchived).toHaveBeenCalled();

      handlers.handleCloseModal();
      expect(setIsModalOpen).toHaveBeenCalledWith(false);

      handlers.onEditItemClick({ currentTarget: element });
      expect(setEditingItem).toHaveBeenCalledWith(sampleItem);

      handlers.onToggleArchiveClick({ currentTarget: element });
      expect(onArchiveCatalogueItem).toHaveBeenCalledWith('cat-001', false);
    });

    it('exercises createTaxSettingsHandlers', async () => {
      const dispatched: unknown[] = [];
      const dispatch = (action: TaxSettingsFormAction) => dispatched.push(action);
      const setErrors = vi.fn();
      const setSaveStatus = vi.fn();
      const setIsSubmitting = vi.fn();
      const onUpdateTaxSettings = vi.fn().mockResolvedValue(true);

      const invalidFormData: TaxSettingsFormData = {
        taxNumber: 'a'.repeat(55),
        vatId: '',
        isKleinunternehmer: true,
        kleinunternehmerNotice: 'b'.repeat(1005),
        taxRateSelection: 'custom',
        defaultTaxRateBasisPoints: -1,
        customTaxRatePercent: '-1',
        pricesIncludeTax: true,
      };

      const handlers = createTaxSettingsHandlers({
        dispatch,
        formData: invalidFormData,
        errors: {
          taxNumber: 'Err',
          vatId: 'Err',
          kleinunternehmerNotice: 'Err',
          defaultTaxRate: 'Err',
        },
        setErrors,
        setSaveStatus,
        setIsSubmitting,
        onUpdateTaxSettings,
      });

      handlers.handleTaxNumberChange({ target: { value: '11/222/33333' } });
      handlers.handleVatIdChange({ target: { value: 'DE111222333' } });
      handlers.handleKleinunternehmerToggle({ target: { checked: false } });
      handlers.handleNoticeChange({ target: { value: 'Statutory Notice' } });
      handlers.handleTaxRateSelectionChange({ target: { value: 'custom' } });
      handlers.handleCustomTaxRateChange({ target: { value: '15' } });
      handlers.handlePricingModeChange({ target: { value: 'net' } });

      expect(dispatched).toHaveLength(7);
      expect(setSaveStatus).toHaveBeenCalledWith('idle');

      const invalidOk = await handlers.handleSubmit();
      expect(invalidOk).toBe(false);
      expect(setErrors).toHaveBeenCalled();
      handlers.onSubmit({ preventDefault: vi.fn() });

      const validFormData: TaxSettingsFormData = {
        taxNumber: '11/222/33333',
        vatId: 'DE111222333',
        isKleinunternehmer: false,
        kleinunternehmerNotice: '',
        taxRateSelection: '1900',
        defaultTaxRateBasisPoints: 1900,
        customTaxRatePercent: '19',
        pricesIncludeTax: true,
      };

      const validHandlers = createTaxSettingsHandlers({
        dispatch,
        formData: validFormData,
        errors: {},
        setErrors,
        setSaveStatus,
        setIsSubmitting,
        onUpdateTaxSettings,
      });

      const validOk = await validHandlers.handleSubmit();
      expect(validOk).toBe(true);
      expect(onUpdateTaxSettings).toHaveBeenCalled();
      expect(setSaveStatus).toHaveBeenCalledWith('success');
      validHandlers.onSubmit({ preventDefault: vi.fn() });

      // Test when update fails (returns false)
      const failUpdateHandlers = createTaxSettingsHandlers({
        dispatch,
        formData: validFormData,
        errors: {},
        setErrors,
        setSaveStatus,
        setIsSubmitting,
        onUpdateTaxSettings: vi.fn().mockResolvedValue(false),
      });
      const failOk = await failUpdateHandlers.handleSubmit();
      expect(failOk).toBe(false);
      expect(setSaveStatus).toHaveBeenCalledWith('error');

      // Test when update throws
      const throwHandlers = createTaxSettingsHandlers({
        dispatch,
        formData: validFormData,
        errors: {},
        setErrors,
        setSaveStatus,
        setIsSubmitting,
        onUpdateTaxSettings: vi.fn().mockRejectedValue(new Error('Network error')),
      });
      const throwOk = await throwHandlers.handleSubmit();
      expect(throwOk).toBe(false);
      expect(setSaveStatus).toHaveBeenCalledWith('error');

      // Test clearing errors with functional updater
      let stateErrors: TaxSettingsFormErrors = {
        taxNumber: 'Err',
        vatId: 'Err',
        kleinunternehmerNotice: 'Err',
        defaultTaxRate: 'Err',
      };
      const mockSetErrors = vi.fn(
        (
          updater: TaxSettingsFormErrors | ((prev: TaxSettingsFormErrors) => TaxSettingsFormErrors),
        ) => {
          if (typeof updater === 'function') {
            stateErrors = updater(stateErrors);
          }
        },
      );
      const clearingHandlers = createTaxSettingsHandlers({
        dispatch,
        formData: validFormData,
        errors: {
          taxNumber: 'Err',
          vatId: 'Err',
          kleinunternehmerNotice: 'Err',
          defaultTaxRate: 'Err',
        },
        setErrors: mockSetErrors,
        setSaveStatus,
        setIsSubmitting,
        onUpdateTaxSettings,
      });
      clearingHandlers.handleTaxNumberChange({ target: { value: '123' } });
      clearingHandlers.handleVatIdChange({ target: { value: 'DE123' } });
      clearingHandlers.handleNoticeChange({ target: { value: 'Notice' } });
      clearingHandlers.handleTaxRateSelectionChange({ target: { value: '1900' } });
      clearingHandlers.handleCustomTaxRateChange({ target: { value: '10' } });
      expect(stateErrors.taxNumber).toBeUndefined();
      expect(stateErrors.vatId).toBeUndefined();
      expect(stateErrors.kleinunternehmerNotice).toBeUndefined();
      expect(stateErrors.defaultTaxRate).toBeUndefined();

      // Test taxSettingsFormReducer RESET
      const resetResult = taxSettingsFormReducer(validFormData, {
        type: 'RESET',
        settings: {
          id: 'settings-1',
          studio_name: 'Studio',
          currency: 'EUR',
          tax_number: '99/999/99999',
          vat_id: 'DE999999999',
          is_kleinunternehmer: false,
          kleinunternehmer_notice: null,
          default_tax_rate_basis_points: 1900,
          prices_include_tax: true,
          created_at: new Date(),
          updated_at: new Date(),
        } as unknown as StudioSettings,
        locale: 'en',
      });
      expect(resetResult.taxNumber).toBe('99/999/99999');

      // Test default branch of taxSettingsFormReducer
      const defaultTaxResult = taxSettingsFormReducer(validFormData, {
        type: 'UNKNOWN',
      } as unknown as Parameters<typeof taxSettingsFormReducer>[1]);
      expect(defaultTaxResult).toBe(validFormData);

      // Test default branch of packageFormReducer
      const defaultPkgResult = packageFormReducer(
        {
          formData: {
            name: '',
            slug: '',
            projectTypeKey: '',
            basePriceMajor: '',
            taxRateBasisPoints: 1900,
            taxRateCustomPercent: '19',
            description: '',
            includedItems: [],
          },
          errors: {},
          isSlugManuallyEdited: false,
        },
        { type: 'UNKNOWN' } as unknown as Parameters<typeof packageFormReducer>[1],
      );
      expect(defaultPkgResult.isSlugManuallyEdited).toBe(false);

      // Test default branch of catalogueFormReducer
      const defaultCatResult = catalogueFormReducer(
        {
          formData: {
            name: '',
            slug: '',
            category: 'service',
            unitPriceMajor: '',
            taxRateBasisPoints: 1900,
            taxRateCustomPercent: '19',
            description: '',
            isActive: true,
          },
          errors: {},
          isSlugManuallyEdited: false,
        },
        { type: 'UNKNOWN' } as unknown as Parameters<typeof catalogueFormReducer>[1],
      );
      expect(defaultCatResult.isSlugManuallyEdited).toBe(false);

      // Test createPackagesViewHandlers with mock document
      const mockFocus = vi.fn();
      const origDoc = (global as Record<string, unknown>).document;
      (global as Record<string, unknown>).document = {
        getElementById: vi.fn(() => ({ focus: mockFocus })),
      };
      try {
        const setActiveTab = vi.fn();
        const docHandlers = createPackagesViewHandlers(setActiveTab);
        docHandlers.onTabKeyDown({
          key: 'ArrowRight',
          currentTarget: { dataset: { index: '0' } },
        });
        expect(setActiveTab).toHaveBeenCalledWith('catalogue');
        expect(mockFocus).toHaveBeenCalled();
      } finally {
        if (origDoc !== undefined) {
          (global as Record<string, unknown>).document = origDoc;
        } else {
          delete (global as Record<string, unknown>).document;
        }
      }
    });
  });
});
