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
  usePathname: () => '/en/projects/01920000-0000-7000-8000-000000000071/proposals/new',
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
  usePathname: () => '/en/projects/01920000-0000-7000-8000-000000000071/proposals/new',
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogHeader: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props}>{children}</h2>
  ),
  DialogDescription: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{children}</p>
  ),
  DialogFooter: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

// Mock translations with STRICT missing key check
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
      if (typeof raw !== 'string') {
        throw new Error(`Missing translation key: "${fullPath}" for locale "${currentLocale}"`);
      }
      let text = raw;
      if (values) {
        for (const [vKey, vVal] of Object.entries(values)) {
          text = text.replace(new RegExp(`\\{${vKey}\\}`, 'g'), String(vVal));
        }
      }
      return text;
    };
  },
}));

import { ProposalBuilderView } from '@/components/proposals/proposal-builder-view';
import { SendProposalModal } from '@/components/proposals/send-proposal-modal';
import { PackageSelectorSection } from '@/components/proposals/package-selector-section';
import { AddonOptionsSection } from '@/components/proposals/addon-options-section';
import { FinancialSummarySection } from '@/components/proposals/financial-summary-section';
import {
  createInitialProposalState,
  type ProposalLineItemState,
} from '@/components/proposals/proposal-builder-helpers';
import type { PackageWithIncludedItems } from '@/server/packages/repo';
import type { CatalogueItem } from '@/server/db/schema/packages';
import type { StudioSettings } from '@/server/db/schema/studio-settings';
import type { ProposalWithLineItems } from '@/server/proposals/repo';

const mockPackage: PackageWithIncludedItems = {
  id: '01920000-0000-7000-8000-000000000101',
  name: 'Full Day Wedding Coverage',
  slug: 'wedding-full-day',
  description: 'Comprehensive 8-hour wedding photography',
  projectTypeKey: 'wedding',
  basePriceMinor: 280000,
  currency: 'EUR',
  taxRateBasisPoints: 1900,
  position: 1,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  includedItems: [
    {
      id: '01920000-0000-7000-8000-000000000111',
      packageId: '01920000-0000-7000-8000-000000000101',
      title: '8 Hours Continuous Coverage',
      description: 'Prep to first dance',
      quantity: 1,
      position: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
  ],
};

const mockCatalogueItem: CatalogueItem = {
  id: '01920000-0000-7000-8000-000000000301',
  name: 'Extra Hour Coverage',
  slug: 'extra-hour-coverage',
  description: 'Additional hour on location',
  category: 'service',
  unitPriceMinor: 25000,
  currency: 'EUR',
  taxRateBasisPoints: 1900,
  position: 1,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const mockStudioSettings: StudioSettings = {
  id: '01920000-0000-7000-8000-000000000001',
  studio_name: 'Studio Light',
  default_locale: 'en',
  timezone: 'UTC',
  currency: 'EUR',
  mfa_required: false,
  mfa_postponed_until: null,
  forms_pow_hmac_key: null,
  tax_number: '12/345/67890',
  vat_id: 'DE123456789',
  is_kleinunternehmer: false,
  kleinunternehmer_notice: null,
  default_tax_rate_basis_points: 1900,
  prices_include_tax: true,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

const mockProject = {
  id: '01920000-0000-7000-8000-000000000071',
  title: 'Emma & Liam Wedding',
  projectTypeKey: 'wedding',
  currency: 'EUR',
};

const mockClient = {
  id: '01920000-0000-7000-8000-000000000081',
  displayName: 'Emma Watson',
  email: 'emma@example.com',
  phone: '+49 30 123456',
};

const mockExistingProposal: ProposalWithLineItems = {
  id: '01920000-0000-7000-8000-000000000201',
  projectId: mockProject.id,
  clientId: mockClient.id,
  title: 'Wedding Photography Proposal — Emma & Liam (Draft)',
  status: 'draft',
  version: 1,
  currency: 'EUR',
  subtotalMinor: 280000,
  taxMinor: 44706,
  totalMinor: 280000,
  pricesIncludeTax: true,
  isKleinunternehmer: false,
  taxNotice: null,
  validUntil: new Date('2026-12-31T23:59:59.999Z'),
  tokenHash: 'tokenhash123',
  tokenRevokedAt: null,
  sentAt: null,
  acceptedAt: null,
  declinedAt: null,
  declineReason: null,
  acceptedByName: null,
  acceptedByEmail: null,
  acceptanceIpAnonymized: null,
  acceptanceUserAgent: null,
  acceptedOptionsSnapshot: null,
  internalNotes: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  lineItems: [
    {
      id: '01920000-0000-7000-8000-000000000211',
      proposalId: '01920000-0000-7000-8000-000000000201',
      packageId: mockPackage.id,
      catalogueItemId: null,
      itemType: 'base_package',
      name: 'Full Day Wedding Coverage',
      description: 'Comprehensive 8-hour wedding photography',
      unitPriceMinor: 280000,
      quantity: 1,
      minQuantity: 1,
      maxQuantity: 1,
      taxRateBasisPoints: 1900,
      isOptional: false,
      isSelected: true,
      position: 0,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: '01920000-0000-7000-8000-000000000212',
      proposalId: '01920000-0000-7000-8000-000000000201',
      packageId: null,
      catalogueItemId: mockCatalogueItem.id,
      itemType: 'addon',
      name: 'Extra Hour Coverage',
      description: null,
      unitPriceMinor: 25000,
      quantity: 1,
      minQuantity: 0,
      maxQuantity: 2,
      taxRateBasisPoints: 1900,
      isOptional: true,
      isSelected: true,
      position: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
  ],
};

describe('ProposalBuilderView Static Markup Rendering & i18n parity', () => {
  it('AC-1 & AC-7: renders ProposalBuilderView in new proposal mode without missing keys in English', () => {
    currentLocale = 'en';
    const html = renderToStaticMarkup(
      <ProposalBuilderView
        project={mockProject}
        client={mockClient}
        packages={[mockPackage]}
        catalogueItems={[mockCatalogueItem]}
        studioSettings={mockStudioSettings}
        proposal={null}
        locale="en"
      />,
    );

    expect(html).toContain('data-testid="proposal-builder-view"');
    expect(html).toContain('data-testid="package-selector-section"');
    expect(html).toContain('data-testid="addon-options-section"');
    expect(html).toContain('data-testid="financial-summary-section"');
    expect(html).toContain('data-testid="proposal-title-input"');
    expect(html).toContain('data-testid="client-review-card"');
    expect(html).toContain('Emma Watson');
    expect(html).toContain('Proposal Composer');
  });

  it('AC-7: renders ProposalBuilderView in German (/de/...) with zero missing translation keys', () => {
    currentLocale = 'de';
    const html = renderToStaticMarkup(
      <ProposalBuilderView
        project={mockProject}
        client={mockClient}
        packages={[mockPackage]}
        catalogueItems={[mockCatalogueItem]}
        studioSettings={mockStudioSettings}
        proposal={null}
        locale="de"
      />,
    );

    expect(html).toContain('data-testid="proposal-builder-view"');
    expect(html).toContain('Angebots-Editor');
    expect(html).toContain('1. Basispaket');
    expect(html).toContain('2. Zusatzoptionen &amp; Individuelle Positionen');
    expect(html).toContain('3. Finanzübersicht &amp; Versand');
  });

  it('renders ProposalBuilderView in edit mode with populated package deliverables and addons', () => {
    currentLocale = 'en';
    const html = renderToStaticMarkup(
      <ProposalBuilderView
        project={mockProject}
        client={mockClient}
        packages={[mockPackage]}
        catalogueItems={[mockCatalogueItem]}
        studioSettings={mockStudioSettings}
        proposal={mockExistingProposal}
        locale="en"
      />,
    );

    expect(html).toContain('data-testid="selected-package-banner"');
    expect(html).toContain('Full Day Wedding Coverage');
    expect(html).toContain('data-testid="addon-row-0"');
    expect(html).toContain('Extra Hour Coverage');
    expect(html).toContain('data-testid="financial-summary-total"');
  });

  it('AC-4 & AC-7: renders SendProposalModal with open=true in both English and German', () => {
    const initialState = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: {
        currency: mockStudioSettings.currency,
        isKleinunternehmer: mockStudioSettings.is_kleinunternehmer,
        pricesIncludeTax: mockStudioSettings.prices_include_tax,
        defaultTaxRateBasisPoints: mockStudioSettings.default_tax_rate_basis_points,
        kleinunternehmerNotice: mockStudioSettings.kleinunternehmer_notice,
      },
      packages: [mockPackage],
      proposal: mockExistingProposal,
    });

    const openState = {
      ...initialState,
      sendModalOpen: true,
    };

    // Render in English
    currentLocale = 'en';
    const htmlEn = renderToStaticMarkup(
      <SendProposalModal
        state={openState}
        errors={{}}
        onClose={vi.fn()}
        onDateChange={vi.fn()}
        onEmailChange={vi.fn()}
        onSubmit={vi.fn()}
        onCopyLink={vi.fn()}
      />,
    );
    expect(htmlEn).toContain('data-testid="send-proposal-modal"');
    expect(htmlEn).toContain('Send Proposal to Client');
    expect(htmlEn).toContain('data-testid="send-recipient-email-input"');
    expect(htmlEn).toContain('data-testid="send-valid-until-input"');

    // Render in German
    currentLocale = 'de';
    const htmlDe = renderToStaticMarkup(
      <SendProposalModal
        state={openState}
        errors={{}}
        onClose={vi.fn()}
        onDateChange={vi.fn()}
        onEmailChange={vi.fn()}
        onSubmit={vi.fn()}
        onCopyLink={vi.fn()}
      />,
    );
    expect(htmlDe).toContain('data-testid="send-proposal-modal"');
    expect(htmlDe).toContain('Angebot an Kunden senden');
  });

  it('AC-4: renders SendProposalModal in sent result state with copy link notification', () => {
    currentLocale = 'en';
    const initialState = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: {
        currency: mockStudioSettings.currency,
        isKleinunternehmer: mockStudioSettings.is_kleinunternehmer,
        pricesIncludeTax: mockStudioSettings.prices_include_tax,
        defaultTaxRateBasisPoints: mockStudioSettings.default_tax_rate_basis_points,
        kleinunternehmerNotice: mockStudioSettings.kleinunternehmer_notice,
      },
      packages: [mockPackage],
      proposal: mockExistingProposal,
    });

    const sentState = {
      ...initialState,
      sendModalOpen: false,
      sentResult: {
        proposalId: mockExistingProposal.id,
        rawToken: 'rawtokensecret',
        tokenUrl: 'http://localhost:3000/p/rawtokensecret',
      },
      linkCopied: true,
    };

    const html = renderToStaticMarkup(
      <SendProposalModal
        state={sentState}
        errors={{}}
        onClose={vi.fn()}
        onDateChange={vi.fn()}
        onEmailChange={vi.fn()}
        onSubmit={vi.fn()}
        onCopyLink={vi.fn()}
      />,
    );

    expect(html).toContain('data-testid="copy-link-notification"');
    expect(html).toContain('Proposal Sent Successfully!');
    expect(html).toContain('http://localhost:3000/p/rawtokensecret');
    expect(html).toContain('data-testid="link-copied-badge"');
  });

  it('renders PackageSelectorSection in unselected state and with deliverables', () => {
    currentLocale = 'en';
    const htmlEmpty = renderToStaticMarkup(
      <PackageSelectorSection
        packages={[mockPackage]}
        selectedPackageId={null}
        basePackageItem={null}
        deliverables={[]}
        currency="EUR"
        locale="en"
        errors={{}}
        onSelectPackage={vi.fn()}
        onUpdateBasePrice={vi.fn()}
        onUpdateTaxRate={vi.fn()}
        onAddDeliverable={vi.fn()}
        onUpdateDeliverableTitle={vi.fn()}
        onUpdateDeliverableQty={vi.fn()}
        onRemoveDeliverable={vi.fn()}
      />,
    );
    expect(htmlEmpty).toContain('data-testid="package-selector-section"');
    expect(htmlEmpty).toContain('data-testid="no-deliverables-msg"');

    const htmlWithDeliverables = renderToStaticMarkup(
      <PackageSelectorSection
        packages={[mockPackage]}
        selectedPackageId={mockPackage.id}
        basePackageItem={{
          id: 'bp-1',
          packageId: mockPackage.id,
          catalogueItemId: null,
          itemType: 'base_package',
          name: 'Package Name',
          unitPriceMinor: 280000,
          unitPriceMajor: '2800.00',
          quantity: 1,
          minQuantity: 1,
          maxQuantity: 1,
          taxRateBasisPoints: 1900,
          isOptional: false,
          isSelected: true,
          position: 0,
        }}
        deliverables={[
          { id: 'del-1', title: 'Deliverable 1', quantity: 1 },
          { id: 'del-2', title: 'Deliverable 2', quantity: 2 },
        ]}
        currency="EUR"
        locale="en"
        errors={{ basePackage: { unitPrice: 'Invalid price error' } }}
        onSelectPackage={vi.fn()}
        onUpdateBasePrice={vi.fn()}
        onUpdateTaxRate={vi.fn()}
        onAddDeliverable={vi.fn()}
        onUpdateDeliverableTitle={vi.fn()}
        onUpdateDeliverableQty={vi.fn()}
        onRemoveDeliverable={vi.fn()}
      />,
    );
    expect(htmlWithDeliverables).toContain('data-testid="deliverable-item-0"');
    expect(htmlWithDeliverables).toContain('data-testid="deliverable-item-1"');
    expect(htmlWithDeliverables).toContain('Invalid price error');
  });

  it('renders AddonOptionsSection in empty state and with configured items', () => {
    currentLocale = 'en';
    const htmlEmpty = renderToStaticMarkup(
      <AddonOptionsSection
        catalogueItems={[mockCatalogueItem]}
        addonItems={[]}
        currency="EUR"
        locale="en"
        errors={{}}
        onAddCatalogueItem={vi.fn()}
        onAddCustomItem={vi.fn()}
        onUpdateItemField={vi.fn()}
        onMoveItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    );
    expect(htmlEmpty).toContain('data-testid="no-addons-msg"');

    const htmlWithAddons = renderToStaticMarkup(
      <AddonOptionsSection
        catalogueItems={[mockCatalogueItem]}
        addonItems={[
          {
            id: 'addon-1',
            packageId: null,
            catalogueItemId: mockCatalogueItem.id,
            itemType: 'addon',
            name: 'Extra Hour',
            unitPriceMinor: 25000,
            unitPriceMajor: '250.00',
            quantity: 1,
            minQuantity: 0,
            maxQuantity: 2,
            taxRateBasisPoints: 1900,
            isOptional: true,
            isSelected: true,
            position: 1,
          },
          {
            id: 'addon-2',
            packageId: null,
            catalogueItemId: null,
            itemType: 'custom',
            name: 'Custom Service',
            unitPriceMinor: 50000,
            unitPriceMajor: '500.00',
            quantity: 1,
            minQuantity: 1,
            maxQuantity: 1,
            taxRateBasisPoints: 700,
            isOptional: false,
            isSelected: true,
            position: 2,
          },
          {
            id: undefined,
            packageId: null,
            catalogueItemId: null,
            itemType: 'custom',
            name: '',
            unitPriceMinor: 0,
            unitPriceMajor: '0.00',
            quantity: 1,
            minQuantity: 1,
            maxQuantity: 1,
            taxRateBasisPoints: 0,
            isOptional: false,
            isSelected: true,
            position: 3,
          },
        ]}
        currency="EUR"
        locale="en"
        errors={{
          items: {
            0: { unitPrice: 'Item price error' },
            1: { name: 'Item name error' },
          },
        }}
        onAddCatalogueItem={vi.fn()}
        onAddCustomItem={vi.fn()}
        onUpdateItemField={vi.fn()}
        onMoveItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    );
    expect(htmlWithAddons).toContain('data-testid="addon-row-0"');
    expect(htmlWithAddons).toContain('data-testid="addon-row-1"');
    expect(htmlWithAddons).toContain('data-testid="addon-row-2"');
    expect(htmlWithAddons).toContain('Item price error');
    expect(htmlWithAddons).toContain('Item name error');
    expect(htmlWithAddons).toContain('data-testid="addon-optional-badge-0"');
    expect(htmlWithAddons).toContain('data-testid="addon-optional-badge-1"');
  });

  it('renders FinancialSummarySection in Kleinunternehmer mode and net pricing mode', () => {
    currentLocale = 'en';
    const state = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: {
        currency: 'EUR',
        isKleinunternehmer: true,
        pricesIncludeTax: false,
        defaultTaxRateBasisPoints: 1900,
        kleinunternehmerNotice: 'Custom § 19 UStG notice text.',
      },
      packages: [mockPackage],
    });

    const kuState = {
      ...state,
      isKleinunternehmer: true,
      taxNotice: 'Custom § 19 UStG notice text.',
      saveSuccess: true,
    };

    const htmlKu = renderToStaticMarkup(
      <FinancialSummarySection
        state={kuState}
        errors={{}}
        locale="en"
        onSaveDraft={vi.fn()}
        onOpenSendModal={vi.fn()}
      />,
    );
    expect(htmlKu).toContain('data-testid="financial-summary-section"');
    expect(htmlKu).toContain('data-testid="kleinunternehmer-notice"');
    expect(htmlKu).toContain('Custom § 19 UStG notice text.');
    expect(htmlKu).toContain('data-testid="save-success-notification"');

    // FinancialSummarySection with isSaving and generalError
    const errorFinState = {
      ...state,
      isSaving: true,
      generalError: 'Server database failure',
    };
    const htmlFinErr = renderToStaticMarkup(
      <FinancialSummarySection
        state={errorFinState}
        errors={{}}
        locale="en"
        onSaveDraft={vi.fn()}
        onOpenSendModal={vi.fn()}
      />,
    );
    expect(htmlFinErr).toContain('data-testid="general-error-notification"');
    expect(htmlFinErr).toContain('Server database failure');
    expect(htmlFinErr).toContain('Saving Draft...');

    // SendProposalModal with validation errors
    const modalErrState = {
      ...state,
      sendModalOpen: true,
      sendModalEmail: 'bad-email',
      sendModalDate: '2020-01-01',
      isSending: true,
    };
    const htmlModalErr = renderToStaticMarkup(
      <SendProposalModal
        state={modalErrState}
        errors={{}}
        onClose={vi.fn()}
        onDateChange={vi.fn()}
        onEmailChange={vi.fn()}
        onSubmit={vi.fn()}
        onCopyLink={vi.fn()}
      />,
    );
    expect(htmlModalErr).toContain('data-testid="send-email-error"');
    expect(htmlModalErr).toContain('data-testid="send-date-error"');
    expect(htmlModalErr).toContain('Sending...');
  });

  it('I1-U01 & I1-V01 regression: renders localized tax rate options in package selector and addon options for both EN and DE', () => {
    const testBasePackage: ProposalLineItemState = {
      id: 'bp-1',
      packageId: mockPackage.id,
      catalogueItemId: null,
      name: 'Wedding Photography',
      description: null,
      itemType: 'base_package',
      unitPriceMajor: '2500.00',
      unitPriceMinor: 250000,
      taxRateBasisPoints: 1900,
      quantity: 1,
      minQuantity: 1,
      maxQuantity: 1,
      isOptional: false,
      isSelected: true,
      position: 0,
    };

    const testAddonItems: ProposalLineItemState[] = [
      {
        id: 'addon-1',
        packageId: null,
        catalogueItemId: mockCatalogueItem.id,
        name: 'Extra Hour',
        description: null,
        itemType: 'addon',
        unitPriceMajor: '150.00',
        unitPriceMinor: 15000,
        taxRateBasisPoints: 1900,
        quantity: 1,
        minQuantity: 0,
        maxQuantity: 2,
        isOptional: true,
        isSelected: true,
        position: 1,
      },
    ];

    // English rendering
    currentLocale = 'en';
    const htmlPkgEn = renderToStaticMarkup(
      <PackageSelectorSection
        packages={[mockPackage]}
        selectedPackageId={mockPackage.id}
        basePackageItem={testBasePackage}
        deliverables={[]}
        currency="EUR"
        locale="en"
        errors={{}}
        onSelectPackage={vi.fn()}
        onUpdateBasePrice={vi.fn()}
        onUpdateTaxRate={vi.fn()}
        onAddDeliverable={vi.fn()}
        onUpdateDeliverableTitle={vi.fn()}
        onUpdateDeliverableQty={vi.fn()}
        onRemoveDeliverable={vi.fn()}
      />,
    );
    expect(htmlPkgEn).toContain('19% Standard');
    expect(htmlPkgEn).toContain('7% Reduced');
    expect(htmlPkgEn).toContain('0% Tax Exempt');

    const htmlAddonEn = renderToStaticMarkup(
      <AddonOptionsSection
        addonItems={testAddonItems}
        catalogueItems={[mockCatalogueItem]}
        currency="EUR"
        locale="en"
        errors={{}}
        onAddCatalogueItem={vi.fn()}
        onAddCustomItem={vi.fn()}
        onUpdateItemField={vi.fn()}
        onRemoveItem={vi.fn()}
        onMoveItem={vi.fn()}
      />,
    );
    expect(htmlAddonEn).toContain('19% Standard');
    expect(htmlAddonEn).toContain('7% Reduced');
    expect(htmlAddonEn).toContain('0% Tax Exempt');

    // German rendering
    currentLocale = 'de';
    const htmlPkgDe = renderToStaticMarkup(
      <PackageSelectorSection
        packages={[mockPackage]}
        selectedPackageId={mockPackage.id}
        basePackageItem={testBasePackage}
        deliverables={[]}
        currency="EUR"
        locale="de"
        errors={{}}
        onSelectPackage={vi.fn()}
        onUpdateBasePrice={vi.fn()}
        onUpdateTaxRate={vi.fn()}
        onAddDeliverable={vi.fn()}
        onUpdateDeliverableTitle={vi.fn()}
        onUpdateDeliverableQty={vi.fn()}
        onRemoveDeliverable={vi.fn()}
      />,
    );
    expect(htmlPkgDe).toContain('19% (Regelsteuersatz)');
    expect(htmlPkgDe).toContain('7% (Ermäßigt)');
    expect(htmlPkgDe).toContain('0% (Steuerbefreit)');
    expect(htmlPkgDe).not.toContain('19% Standard');

    const htmlAddonDe = renderToStaticMarkup(
      <AddonOptionsSection
        addonItems={testAddonItems}
        catalogueItems={[mockCatalogueItem]}
        currency="EUR"
        locale="de"
        errors={{}}
        onAddCatalogueItem={vi.fn()}
        onAddCustomItem={vi.fn()}
        onUpdateItemField={vi.fn()}
        onRemoveItem={vi.fn()}
        onMoveItem={vi.fn()}
      />,
    );
    expect(htmlAddonDe).toContain('19% (Regelsteuersatz)');
    expect(htmlAddonDe).toContain('7% (Ermäßigt)');
    expect(htmlAddonDe).toContain('0% (Steuerbefreit)');
    expect(htmlAddonDe).not.toContain('19% Standard');

    // Reset locale
    currentLocale = 'en';
  });

  it('I1-U03 regression: renders visible text label for optional toggle on mobile viewports', () => {
    currentLocale = 'en';
    const testAddon: ProposalLineItemState[] = [
      {
        id: 'addon-opt-1',
        packageId: null,
        catalogueItemId: mockCatalogueItem.id,
        name: 'Extra Photobook',
        description: null,
        itemType: 'addon',
        unitPriceMajor: '250.00',
        unitPriceMinor: 25000,
        taxRateBasisPoints: 1900,
        quantity: 1,
        minQuantity: 0,
        maxQuantity: 2,
        isOptional: true,
        isSelected: true,
        position: 1,
      },
    ];

    const htmlAddon = renderToStaticMarkup(
      <AddonOptionsSection
        addonItems={testAddon}
        catalogueItems={[mockCatalogueItem]}
        currency="EUR"
        locale="en"
        errors={{}}
        onAddCatalogueItem={vi.fn()}
        onAddCustomItem={vi.fn()}
        onUpdateItemField={vi.fn()}
        onRemoveItem={vi.fn()}
        onMoveItem={vi.fn()}
      />,
    );
    // Label should be visible on mobile (md:sr-only cursor-pointer)
    expect(htmlAddon).toContain('for="addon-optional-toggle-0"');
    expect(htmlAddon).toContain('text-xs font-medium text-foreground md:sr-only cursor-pointer');
    expect(htmlAddon).toContain('Optional for Client');

    // In German
    currentLocale = 'de';
    const htmlAddonDe = renderToStaticMarkup(
      <AddonOptionsSection
        addonItems={testAddon}
        catalogueItems={[mockCatalogueItem]}
        currency="EUR"
        locale="de"
        errors={{}}
        onAddCatalogueItem={vi.fn()}
        onAddCustomItem={vi.fn()}
        onUpdateItemField={vi.fn()}
        onRemoveItem={vi.fn()}
        onMoveItem={vi.fn()}
      />,
    );
    expect(htmlAddonDe).toContain('Optional für Kunden');
    currentLocale = 'en';
  });

  it('I1-U04 regression: renders localized aria-labels for deliverable inputs in both EN and DE', () => {
    currentLocale = 'en';
    const testDeliverables = [
      {
        id: 'del-1',
        title: 'Full Day Coverage',
        quantity: 1,
        includedInPackage: true,
      },
    ];

    const htmlPkgEn = renderToStaticMarkup(
      <PackageSelectorSection
        packages={[mockPackage]}
        selectedPackageId={mockPackage.id}
        basePackageItem={null}
        deliverables={testDeliverables}
        currency="EUR"
        locale="en"
        errors={{}}
        onSelectPackage={vi.fn()}
        onUpdateBasePrice={vi.fn()}
        onUpdateTaxRate={vi.fn()}
        onAddDeliverable={vi.fn()}
        onUpdateDeliverableTitle={vi.fn()}
        onUpdateDeliverableQty={vi.fn()}
        onRemoveDeliverable={vi.fn()}
      />,
    );
    expect(htmlPkgEn).toContain('aria-label="Full Day Coverage quantity"');
    expect(htmlPkgEn).toContain('aria-label="Deliverable title 1"');

    // German
    currentLocale = 'de';
    const htmlPkgDe = renderToStaticMarkup(
      <PackageSelectorSection
        packages={[mockPackage]}
        selectedPackageId={mockPackage.id}
        basePackageItem={null}
        deliverables={testDeliverables}
        currency="EUR"
        locale="de"
        errors={{}}
        onSelectPackage={vi.fn()}
        onUpdateBasePrice={vi.fn()}
        onUpdateTaxRate={vi.fn()}
        onAddDeliverable={vi.fn()}
        onUpdateDeliverableTitle={vi.fn()}
        onUpdateDeliverableQty={vi.fn()}
        onRemoveDeliverable={vi.fn()}
      />,
    );
    expect(htmlPkgDe).toContain('aria-label="Full Day Coverage Anzahl"');
    expect(htmlPkgDe).toContain('aria-label="Leistungstitel 1"');
    expect(htmlPkgDe).not.toContain('quantity');
    expect(htmlPkgDe).not.toContain('Deliverable title');
    currentLocale = 'en';
  });
});
