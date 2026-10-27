import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Mock server-only
vi.mock('server-only', () => ({}));

// Mock next/navigation
const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
  }),
  usePathname: () => '/en/settings/packages',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
  }),
  usePathname: () => '/en/settings/packages',
}));

// Mock translations
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = Reflect.get(current, part);
    } else {
      return undefined;
    }
  }
  return current;
}

let currentLocale: 'en' | 'de' = 'en';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => {
    return (key: string, values?: Record<string, unknown>) => {
      const messages = currentLocale === 'de' ? deMessages : enMessages;
      const fullPath = namespace ? `${namespace}.${key}` : key;
      const raw = getNestedValue(messages, fullPath);
      let text = typeof raw === 'string' ? raw : `[${fullPath}]`;
      if (values) {
        for (const [vKey, vVal] of Object.entries(values)) {
          text = text.replace(new RegExp(`\\{${vKey}\\}`, 'g'), String(vVal));
        }
      }
      return text;
    };
  },
}));

import { PackagesView } from '@/components/settings/packages/packages-view';
import { PackagesSection } from '@/components/settings/packages/packages-section';
import { PackageModal, PackageDeliverableRow } from '@/components/settings/packages/package-modal';
import { PackageArchiveDialog } from '@/components/settings/packages/package-archive-dialog';
import { CatalogueSection } from '@/components/settings/packages/catalogue-section';
import { CatalogueItemModal } from '@/components/settings/packages/catalogue-item-modal';
import { TaxSettingsSection } from '@/components/settings/packages/tax-settings-section';
import type { PackageWithIncludedItems } from '@/server/packages/repo';
import type { CatalogueItem } from '@/server/db/schema/packages';
import type { StudioSettings } from '@/server/db/schema/studio-settings';

const mockPackage: PackageWithIncludedItems = {
  id: '01920000-0000-7000-8000-000000000001',
  name: 'Gold Wedding Collection',
  slug: 'gold-wedding-collection',
  description: 'Full day coverage with album',
  projectTypeKey: 'wedding',
  basePriceMinor: 350000,
  currency: 'EUR',
  taxRateBasisPoints: 1900,
  position: 0,
  isActive: true,
  createdAt: new Date('2026-01-01T10:00:00Z'),
  updatedAt: new Date('2026-01-01T10:00:00Z'),
  includedItems: [
    {
      id: '01920000-0000-7000-8000-000000000010',
      packageId: '01920000-0000-7000-8000-000000000001',
      title: '8 Hours Coverage',
      description: 'Continuous coverage',
      quantity: 1,
      position: 0,
      createdAt: new Date('2026-01-01T10:00:00Z'),
      updatedAt: new Date('2026-01-01T10:00:00Z'),
    },
    {
      id: '01920000-0000-7000-8000-000000000011',
      packageId: '01920000-0000-7000-8000-000000000001',
      title: 'Photo Album',
      description: null,
      quantity: 1,
      position: 1,
      createdAt: new Date('2026-01-01T10:00:00Z'),
      updatedAt: new Date('2026-01-01T10:00:00Z'),
    },
  ],
};

const mockArchivedPackage: PackageWithIncludedItems = {
  ...mockPackage,
  id: '01920000-0000-7000-8000-000000000002',
  name: 'Archived Mini Session',
  slug: 'archived-mini-session',
  isActive: false,
  includedItems: [],
};

const mockCatalogueItem: CatalogueItem = {
  id: '01920000-0000-7000-8000-000000000003',
  name: 'Extra Hour Coverage',
  slug: 'extra-hour-coverage',
  description: 'Additional hour of shooting on location',
  category: 'service',
  unitPriceMinor: 20000,
  currency: 'EUR',
  taxRateBasisPoints: 1900,
  position: 0,
  isActive: true,
  createdAt: new Date('2026-01-01T10:00:00Z'),
  updatedAt: new Date('2026-01-01T10:00:00Z'),
};

const mockArchivedCatalogueItem: CatalogueItem = {
  ...mockCatalogueItem,
  id: '01920000-0000-7000-8000-000000000004',
  name: 'Vintage Print Box',
  slug: 'vintage-print-box',
  category: 'product',
  isActive: false,
};

const mockTaxSettings: StudioSettings = {
  id: '01920000-0000-7000-8000-000000000000',
  studio_name: 'Lumiere Studios',
  default_locale: 'en',
  timezone: 'UTC',
  currency: 'EUR',
  mfa_required: false,
  mfa_postponed_until: null,
  forms_pow_hmac_key: null,
  tax_number: '133/5815/0011',
  vat_id: 'DE312345678',
  is_kleinunternehmer: false,
  kleinunternehmer_notice: null,
  default_tax_rate_basis_points: 1900,
  prices_include_tax: true,
  created_at: new Date('2026-01-01T10:00:00Z'),
  updated_at: new Date('2026-01-01T10:00:00Z'),
};

const mockAsyncTrue = () => Promise.resolve(true);
const noop = () => {
  // test no-op
};

describe('Packages and Catalogue Component Static Render Tests', () => {
  it('renders PackagesView container with initial active packages', () => {
    currentLocale = 'en';
    const html = renderToStaticMarkup(
      <PackagesView
        initialPackages={[mockPackage, mockArchivedPackage]}
        initialCatalogueItems={[mockCatalogueItem, mockArchivedCatalogueItem]}
        initialTaxSettings={mockTaxSettings}
        locale="en"
      />,
    );

    expect(html).toContain('data-testid="packages-settings-view"');
    expect(html).toContain('data-testid="tab-packages"');
    expect(html).toContain('data-testid="tab-catalogue"');
    expect(html).toContain('data-testid="tab-tax"');
    expect(html).toContain('Gold Wedding Collection');
    expect(html).toContain('gold-wedding-collection');
  });

  it('renders PackagesView in German locale without raw translation keys', () => {
    currentLocale = 'de';
    const html = renderToStaticMarkup(
      <PackagesView
        initialPackages={[mockPackage]}
        initialCatalogueItems={[mockCatalogueItem]}
        initialTaxSettings={mockTaxSettings}
        locale="de"
      />,
    );

    expect(html).not.toContain('settings.packages.');
    expect(html).not.toContain('settings.tax.');
    expect(html).toContain('Leistungspakete');
    expect(html).toContain('Gold Wedding Collection');
  });

  it('renders PackagesSection in empty state when no packages exist', () => {
    currentLocale = 'en';
    const html = renderToStaticMarkup(
      <PackagesSection
        initialPackages={[]}
        locale="en"
        onSavePackage={mockAsyncTrue}
        onArchivePackage={mockAsyncTrue}
      />,
    );

    expect(html).toContain('data-testid="packages-empty-state"');
    expect(html).toContain('data-testid="create-package-button"');
  });

  it('renders PackagesSection with both active and archived packages', () => {
    currentLocale = 'en';
    const html = renderToStaticMarkup(
      <PackagesSection
        initialPackages={[mockPackage, mockArchivedPackage]}
        locale="en"
        onSavePackage={mockAsyncTrue}
        onArchivePackage={mockAsyncTrue}
      />,
    );

    expect(html).toContain('data-testid="package-card-gold-wedding-collection"');
    expect(html).toContain('data-testid="toggle-archived-packages"');
    expect(html).toContain('8 Hours Coverage');
  });

  it('renders PackageModal in open create mode', () => {
    currentLocale = 'en';
    const html = renderToStaticMarkup(
      <PackageModal
        pkg={null}
        isOpen={true}
        isSubmitting={false}
        triggerRef={{ current: null }}
        onClose={noop}
        onSave={mockAsyncTrue}
      />,
    );

    expect(html).toContain('data-testid="package-modal"');
    expect(html).toContain('data-testid="package-name-input"');
    expect(html).toContain('data-testid="package-slug-input"');
    expect(html).toContain('data-testid="save-package-btn"');
  });

  it('renders PackageModal in open edit mode with populated package deliverables', () => {
    currentLocale = 'en';
    const html = renderToStaticMarkup(
      <PackageModal
        pkg={mockPackage}
        isOpen={true}
        isSubmitting={false}
        triggerRef={{ current: null }}
        onClose={noop}
        onSave={mockAsyncTrue}
      />,
    );

    expect(html).toContain('data-testid="package-modal"');
    expect(html).toContain('Gold Wedding Collection');
    expect(html).toContain('data-testid="deliverable-row-0"');
    expect(html).toContain('data-testid="deliverable-row-1"');
    expect(html).toContain('8 Hours Coverage');
  });

  it('renders PackageArchiveDialog in open state', () => {
    currentLocale = 'en';
    const html = renderToStaticMarkup(
      <PackageArchiveDialog
        pkg={mockPackage}
        isOpen={true}
        isSubmitting={false}
        triggerRef={{ current: null }}
        onClose={noop}
        onConfirm={noop}
      />,
    );

    expect(html).toContain('data-testid="package-archive-dialog"');
    expect(html).toContain('data-testid="confirm-archive-btn"');
    expect(html).toContain('data-testid="cancel-archive-btn"');
  });

  it('renders CatalogueSection in empty state', () => {
    currentLocale = 'en';
    const html = renderToStaticMarkup(
      <CatalogueSection
        initialItems={[]}
        locale="en"
        onSaveCatalogueItem={mockAsyncTrue}
        onArchiveCatalogueItem={mockAsyncTrue}
      />,
    );

    expect(html).toContain('data-testid="catalogue-empty-state"');
    expect(html).toContain('data-testid="create-catalogue-item-btn"');
  });

  it('renders CatalogueSection with populated add-on items', () => {
    currentLocale = 'en';
    const html = renderToStaticMarkup(
      <CatalogueSection
        initialItems={[mockCatalogueItem, mockArchivedCatalogueItem]}
        locale="en"
        onSaveCatalogueItem={mockAsyncTrue}
        onArchiveCatalogueItem={mockAsyncTrue}
      />,
    );

    expect(html).toContain('data-testid="catalogue-item-row-extra-hour-coverage"');
    expect(html).toContain('Extra Hour Coverage');
    expect(html).toContain('Service');
    expect(html).toContain('data-testid="catalogue-category-filter"');
  });

  it('renders CatalogueItemModal in open create and edit modes', () => {
    currentLocale = 'en';
    const createHtml = renderToStaticMarkup(
      <CatalogueItemModal
        item={null}
        isOpen={true}
        isSubmitting={false}
        triggerRef={{ current: null }}
        onClose={noop}
        onSave={mockAsyncTrue}
      />,
    );

    expect(createHtml).toContain('data-testid="catalogue-item-modal"');
    expect(createHtml).toContain('data-testid="catalogue-item-name-input"');
    expect(createHtml).toContain('data-testid="save-catalogue-item-btn"');

    const editHtml = renderToStaticMarkup(
      <CatalogueItemModal
        item={mockCatalogueItem}
        isOpen={true}
        isSubmitting={false}
        triggerRef={{ current: null }}
        onClose={noop}
        onSave={mockAsyncTrue}
      />,
    );

    expect(editHtml).toContain('Extra Hour Coverage');
    expect(editHtml).toContain('extra-hour-coverage');
  });

  it('renders TaxSettingsSection with Kleinunternehmer enabled and disabled', () => {
    currentLocale = 'en';
    const standardHtml = renderToStaticMarkup(
      <TaxSettingsSection
        initialSettings={mockTaxSettings}
        locale="en"
        onUpdateTaxSettings={mockAsyncTrue}
      />,
    );

    expect(standardHtml).toContain('data-testid="tax-settings-section"');
    expect(standardHtml).toContain('data-testid="tax-number-input"');
    expect(standardHtml).toContain('data-testid="vat-id-input"');
    expect(standardHtml).toContain('data-testid="toggle-kleinunternehmer"');
    expect(standardHtml).toContain('data-testid="save-tax-settings-btn"');

    const kleinunternehmerSettings: StudioSettings = {
      ...mockTaxSettings,
      is_kleinunternehmer: true,
      kleinunternehmer_notice: 'Gemäß § 19 UStG wird keine USt berechnet.',
      prices_include_tax: false,
    };

    const kuHtml = renderToStaticMarkup(
      <TaxSettingsSection
        initialSettings={kleinunternehmerSettings}
        locale="en"
        onUpdateTaxSettings={mockAsyncTrue}
      />,
    );

    expect(kuHtml).toContain('data-testid="kleinunternehmer-notice-textarea"');
    expect(kuHtml).toContain('Gemäß § 19 UStG wird keine USt berechnet.');
  });

  it('renders PackagesView with defaultTab="catalogue"', () => {
    currentLocale = 'en';
    const html = renderToStaticMarkup(
      <PackagesView
        initialPackages={[mockPackage]}
        initialCatalogueItems={[mockCatalogueItem]}
        initialTaxSettings={mockTaxSettings}
        locale="en"
        defaultTab="catalogue"
      />,
    );

    expect(html).toContain('data-testid="catalogue-section"');
    expect(html).toContain('Extra Hour Coverage');
  });

  it('renders PackagesView with defaultTab="tax"', () => {
    currentLocale = 'en';
    const html = renderToStaticMarkup(
      <PackagesView
        initialPackages={[mockPackage]}
        initialCatalogueItems={[mockCatalogueItem]}
        initialTaxSettings={mockTaxSettings}
        locale="en"
        defaultTab="tax"
      />,
    );

    expect(html).toContain('data-testid="tax-settings-section"');
    expect(html).toContain('data-testid="tax-number-input"');
  });

  it('renders PackageArchiveDialog as empty when pkg is null', () => {
    const html = renderToStaticMarkup(
      <PackageArchiveDialog
        pkg={null}
        isOpen={true}
        isSubmitting={false}
        triggerRef={{ current: null }}
        onClose={noop}
        onConfirm={noop}
      />,
    );

    expect(html).toBe('');
  });

  it('renders PackageDeliverableRow directly with validation errors', () => {
    currentLocale = 'en';
    const html = renderToStaticMarkup(
      <PackageDeliverableRow
        item={{ title: '', quantity: 0, position: 0 }}
        index={0}
        total={2}
        errors={{ 0: { title: 'Title is required', quantity: 'Quantity must be at least 1' } }}
        disabled={false}
        t={(k) => k}
        dispatch={noop}
      />,
    );

    expect(html).toContain('data-testid="deliverable-row-0"');
    expect(html).toContain('data-testid="deliverable-title-input-0"');
    expect(html).toContain('data-testid="deliverable-quantity-input-0"');
    expect(html).toContain('Title is required');
    expect(html).toContain('Quantity must be at least 1');
    expect(html).toContain('data-testid="deliverable-move-up-0"');
    expect(html).toContain('data-testid="deliverable-move-down-0"');
    expect(html).toContain('data-testid="deliverable-remove-0"');
  });

  it('renders PackageModal with custom tax rate preset', () => {
    currentLocale = 'en';
    const customTaxPackage: PackageWithIncludedItems = {
      ...mockPackage,
      taxRateBasisPoints: 850,
    };

    const html = renderToStaticMarkup(
      <PackageModal
        pkg={customTaxPackage}
        isOpen={true}
        isSubmitting={false}
        triggerRef={{ current: null }}
        onClose={noop}
        onSave={mockAsyncTrue}
      />,
    );

    expect(html).toContain('data-testid="package-custom-tax-input"');
    expect(html).toContain('8.5');
  });

  it('renders TaxSettingsSection with custom tax rate preset', () => {
    currentLocale = 'en';
    const customTaxSettings: StudioSettings = {
      ...mockTaxSettings,
      default_tax_rate_basis_points: 850,
    };

    const html = renderToStaticMarkup(
      <TaxSettingsSection
        initialSettings={customTaxSettings}
        locale="en"
        onUpdateTaxSettings={mockAsyncTrue}
      />,
    );

    expect(html).toContain('data-testid="default-custom-tax-input"');
    expect(html).toContain('8.5');
  });

  it('renders PackagesView with catalogue and tax default tabs', () => {
    currentLocale = 'en';
    const catHtml = renderToStaticMarkup(
      <PackagesView
        initialPackages={[mockPackage]}
        initialCatalogueItems={[mockCatalogueItem]}
        initialTaxSettings={mockTaxSettings}
        locale="en"
        defaultTab="catalogue"
      />,
    );
    expect(catHtml).toContain('aria-selected="true"');
    expect(catHtml).toContain('data-testid="tab-catalogue"');

    const taxHtml = renderToStaticMarkup(
      <PackagesView
        initialPackages={[mockPackage]}
        initialCatalogueItems={[mockCatalogueItem]}
        initialTaxSettings={mockTaxSettings}
        locale="en"
        defaultTab="tax"
      />,
    );
    expect(taxHtml).toContain('data-testid="tab-tax"');
  });

  it('renders PackagesSection with archived packages section', () => {
    currentLocale = 'en';
    const archivedPkg: PackageWithIncludedItems = {
      ...mockPackage,
      id: '01920000-0000-7000-8000-000000000099',
      name: 'Archived Mini Session',
      slug: 'archived-mini-session',
      isActive: false,
    };

    const html = renderToStaticMarkup(
      <PackagesSection
        initialPackages={[mockPackage, archivedPkg]}
        initialShowArchived={true}
        onSavePackage={mockAsyncTrue}
        onArchivePackage={mockAsyncTrue}
      />,
    );
    expect(html).toContain('data-testid="toggle-archived-packages"');
    expect(html).toContain('data-testid="archived-package-01920000-0000-7000-8000-000000000099"');
  });

  it('renders PackageModal in create mode and submitting state', () => {
    currentLocale = 'en';
    const html = renderToStaticMarkup(
      <PackageModal
        pkg={null}
        isOpen={true}
        isSubmitting={true}
        triggerRef={{ current: null }}
        onClose={noop}
        onSave={mockAsyncTrue}
      />,
    );
    expect(html).toContain('data-testid="save-package-btn"');
    expect(html).toContain('disabled=""');
  });

  it('renders PackageArchiveDialog in restore mode and submitting state', () => {
    currentLocale = 'en';
    const archivedPkg: PackageWithIncludedItems = {
      ...mockPackage,
      isActive: false,
    };

    const html = renderToStaticMarkup(
      <PackageArchiveDialog
        pkg={archivedPkg}
        isOpen={true}
        isSubmitting={true}
        triggerRef={{ current: null }}
        onClose={noop}
        onConfirm={noop}
      />,
    );
    expect(html).toContain('data-testid="confirm-archive-btn"');
    expect(html).toContain('disabled=""');
  });

  it('renders CatalogueSection with archived item and category filtering', () => {
    currentLocale = 'en';
    const archivedItem: CatalogueItem = {
      ...mockCatalogueItem,
      id: '01920000-0000-7000-8000-000000000088',
      name: 'Archived Travel Fee',
      category: 'travel',
      isActive: false,
    };

    const html = renderToStaticMarkup(
      <CatalogueSection
        initialItems={[mockCatalogueItem, archivedItem]}
        initialShowArchived={true}
        onSaveCatalogueItem={mockAsyncTrue}
        onArchiveCatalogueItem={mockAsyncTrue}
      />,
    );
    expect(html).toContain('data-testid="toggle-show-archived-catalogue"');
    expect(html).toContain(
      'data-testid="toggle-archive-catalogue-item-01920000-0000-7000-8000-000000000088"',
    );
  });

  it('renders TaxSettingsSection with success banner, error banner, and inline field errors', () => {
    currentLocale = 'en';
    const successHtml = renderToStaticMarkup(
      <TaxSettingsSection
        initialSettings={mockTaxSettings}
        locale="en"
        initialSaveStatus="success"
        onUpdateTaxSettings={mockAsyncTrue}
      />,
    );
    expect(successHtml).toContain('data-testid="tax-save-success-banner"');

    const errorHtml = renderToStaticMarkup(
      <TaxSettingsSection
        initialSettings={mockTaxSettings}
        locale="en"
        initialSaveStatus="error"
        initialErrors={{
          taxNumber: 'Invalid tax number',
          vatId: 'Invalid VAT ID',
          defaultTaxRate: 'Invalid default tax rate',
          kleinunternehmerNotice: 'Notice too long',
        }}
        onUpdateTaxSettings={mockAsyncTrue}
      />,
    );
    expect(errorHtml).toContain('data-testid="tax-settings-save-error"');
    expect(errorHtml).toContain('Invalid tax number');
    expect(errorHtml).toContain('Invalid VAT ID');
    expect(errorHtml).toContain('Invalid default tax rate');
  });

  it('renders CatalogueItemModal in create mode, submitting state, and custom tax rate', () => {
    currentLocale = 'en';
    const customItem: CatalogueItem = {
      ...mockCatalogueItem,
      taxRateBasisPoints: 850,
    };

    const html = renderToStaticMarkup(
      <CatalogueItemModal
        item={customItem}
        isOpen={true}
        isSubmitting={true}
        triggerRef={{ current: null }}
        onClose={noop}
        onSave={mockAsyncTrue}
      />,
    );
    expect(html).toContain('data-testid="catalogue-custom-tax-input"');
    expect(html).toContain('8.5');
    expect(html).toContain('disabled=""');

    const createHtml = renderToStaticMarkup(
      <CatalogueItemModal
        item={null}
        isOpen={true}
        isSubmitting={false}
        triggerRef={{ current: null }}
        onClose={noop}
        onSave={mockAsyncTrue}
      />,
    );
    expect(createHtml).toContain('data-testid="catalogue-item-name-input"');
  });

  it('renders TaxSettingsSection with net pricing display mode and Kleinunternehmer enabled in German', () => {
    currentLocale = 'de';
    const netTaxSettings: StudioSettings = {
      ...mockTaxSettings,
      prices_include_tax: false,
      is_kleinunternehmer: true,
      kleinunternehmer_notice: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    };

    const html = renderToStaticMarkup(
      <TaxSettingsSection
        initialSettings={netTaxSettings}
        locale="de"
        onUpdateTaxSettings={mockAsyncTrue}
      />,
    );
    expect(html).toContain('data-testid="pricing-mode-net"');
    expect(html).toContain('checked=""');
    expect(html).toContain('data-testid="toggle-kleinunternehmer"');
  });

  it('renders PackageModal with validation errors and aria-describedby alerts', () => {
    currentLocale = 'en';
    const html = renderToStaticMarkup(
      <PackageModal
        pkg={mockPackage}
        isOpen={true}
        isSubmitting={false}
        initialErrors={{
          name: 'Title is required',
          slug: 'Invalid slug format',
          basePrice: 'Price must be positive',
          taxRate: 'Tax rate invalid',
        }}
        triggerRef={{ current: null }}
        onClose={noop}
        onSave={mockAsyncTrue}
      />,
    );
    expect(html).toContain('data-testid="package-modal"');
    expect(html).toContain('Title is required');
    expect(html).toContain('Invalid slug format');
    expect(html).toContain('Price must be positive');
    expect(html).toContain('Tax rate invalid');
  });

  it('renders CatalogueItemModal with validation errors and aria-describedby alerts', () => {
    currentLocale = 'en';
    const html = renderToStaticMarkup(
      <CatalogueItemModal
        item={mockCatalogueItem}
        isOpen={true}
        isSubmitting={false}
        initialErrors={{
          name: 'Name is required',
          slug: 'Invalid slug',
          unitPrice: 'Price invalid',
          taxRate: 'Tax rate invalid',
        }}
        triggerRef={{ current: null }}
        onClose={noop}
        onSave={mockAsyncTrue}
      />,
    );
    expect(html).toContain('data-testid="catalogue-item-modal"');
    expect(html).toContain('Name is required');
    expect(html).toContain('Invalid slug');
    expect(html).toContain('Price invalid');
    expect(html).toContain('Tax rate invalid');
  });

  describe('Iteration 1 Review Feedback Regressions (I1-U01, I1-U02, I1-U04, I1-U05)', () => {
    it('I1-U01 regression: CatalogueItemModal renders localized tax rates and slug help in German without raw translation keys', () => {
      currentLocale = 'de';
      const html = renderToStaticMarkup(
        <CatalogueItemModal
          item={mockCatalogueItem}
          isOpen={true}
          isSubmitting={false}
          triggerRef={{ current: null }}
          onClose={noop}
          onSave={mockAsyncTrue}
        />,
      );
      expect(html).toContain('Wird in Kundenangebots-URLs und Vertragszusammenfassungen verwendet');
      expect(html).not.toContain('settings.packages.catalogue.modal.slugHelp');
      expect(html).not.toContain('settings.packages.catalogue.modal.taxRateStandard');
      expect(html).toContain('Standard (19%)');
      expect(html).toContain('Ermäßigt (7%)');
      expect(html).toContain('Befreit / Kleinunternehmer (0%)');
      expect(html).toContain('Individueller Steuersatz');
      currentLocale = 'en';
    });

    it('I1-U02 regression: CatalogueSection and TaxSettingsSection render localized category filter and custom tax option in German', () => {
      currentLocale = 'de';
      const catHtml = renderToStaticMarkup(
        <CatalogueSection
          initialItems={[mockCatalogueItem]}
          locale="de"
          onSaveCatalogueItem={mockAsyncTrue}
          onArchiveCatalogueItem={mockAsyncTrue}
        />,
      );
      expect(catHtml).toContain('Kategorie:');
      expect(catHtml).not.toContain('>Category:<');
      expect(catHtml).toContain('Archivierte anzeigen');
      expect(catHtml).not.toContain('>Show Archived<');

      const taxHtml = renderToStaticMarkup(
        <TaxSettingsSection
          initialSettings={{ ...mockTaxSettings, default_tax_rate_basis_points: 1250 }}
          locale="de"
          onUpdateTaxSettings={mockAsyncTrue}
        />,
      );
      expect(taxHtml).toContain('Benutzerdefinierter Steuersatz');
      expect(taxHtml).not.toContain('>Custom Tax Rate<');
      expect(taxHtml).toContain('aria-label="Benutzerdefinierter USt-Satz in Prozent"');
      expect(taxHtml).not.toContain('aria-label="Custom VAT rate percentage"');
      currentLocale = 'en';
    });

    it('I1-U04 regression: TaxSettingsSection renders German VAT rates with proper German terminology (Regelsteuersatz)', () => {
      currentLocale = 'de';
      const taxHtml = renderToStaticMarkup(
        <TaxSettingsSection
          initialSettings={mockTaxSettings}
          locale="de"
          onUpdateTaxSettings={mockAsyncTrue}
        />,
      );
      expect(taxHtml).toContain('19% (Regelsteuersatz)');
      expect(taxHtml).toContain('7% (Ermäßigter Steuersatz)');
      expect(taxHtml).not.toContain('19% (Standard rate)');
      expect(taxHtml).not.toContain('7% (Reduced rate)');
      currentLocale = 'en';
    });

    it('I1-U05 regression: PackageDeliverableRow renders localized aria-labels for reordering and removal buttons in German', () => {
      currentLocale = 'de';
      const tMock = (key: string, values?: Record<string, string | number | Date>) => {
        const fullPath = `settings.packages.${key}`;
        const raw = getNestedValue(deMessages, fullPath);
        let text = typeof raw === 'string' ? raw : `[${fullPath}]`;
        if (values) {
          for (const [vKey, vVal] of Object.entries(values)) {
            text = text.replace(new RegExp(`\\{${vKey}\\}`, 'g'), String(vVal));
          }
        }
        return text;
      };

      const html = renderToStaticMarkup(
        <PackageDeliverableRow
          item={{ id: 'd-1', title: 'Test Leistung', quantity: 1, position: 1 }}
          index={1}
          total={3}
          disabled={false}
          dispatch={noop}
          t={tMock}
        />,
      );
      expect(html).toContain('aria-label="Leistungsbestandteil 2 nach oben verschieben"');
      expect(html).toContain('aria-label="Leistungsbestandteil 2 nach unten verschieben"');
      expect(html).toContain('aria-label="Leistungsbestandteil 2 entfernen"');
      expect(html).not.toContain('Move deliverable 2 up');
      expect(html).not.toContain('Remove deliverable 2');
      currentLocale = 'en';
    });
  });
});
