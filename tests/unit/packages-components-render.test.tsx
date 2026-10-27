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
import { PackageModal } from '@/components/settings/packages/package-modal';
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
});
