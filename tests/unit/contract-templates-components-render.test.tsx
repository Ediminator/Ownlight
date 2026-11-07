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
  usePathname: () => '/en/settings/contracts',
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
  usePathname: () => '/en/settings/contracts',
}));

// Mock translations with strict throw-on-missing
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
        throw new Error(`Missing translation key: ${fullPath} in locale: ${currentLocale}`);
      }
      let text = raw;
      if (values) {
        for (const [vKey, vVal] of Object.entries(values)) {
          text = text.replaceAll(`{${vKey}}`, String(vVal));
        }
      }
      return text;
    };
  },
  useLocale: () => currentLocale,
}));

import { ContractTemplatesList } from '@/components/settings/contract-templates-list';
import { ContractTemplateModal } from '@/components/settings/contract-template-modal';
import { StudioSigningSettingsCard } from '@/components/settings/studio-signing-settings-card';
import { ContractsSettingsView } from '@/components/settings/contracts-settings-view';
import { createContractTemplateModalController } from '@/components/settings/contracts-helpers';
import type { ContractTemplate } from '@/server/db/schema/contracts';
import type { StudioSettings } from '@/server/db/schema/studio-settings';

const mockActiveTemplate: ContractTemplate = {
  id: '01920000-0000-7000-8000-000000000001',
  name: 'Standard Wedding Agreement',
  slug: 'wedding-standard',
  description: 'Standard terms for 8-hour wedding coverage',
  projectTypeKey: 'wedding',
  contentEn: 'This Agreement is entered into by {{studio.owner_name}} and {{client.name}}.',
  contentDe: 'Dieser Vertrag wird geschlossen zwischen {{studio.owner_name}} und {{client.name}}.',
  isDefault: true,
  isActive: true,
  createdAt: new Date('2026-01-01T10:00:00Z'),
  updatedAt: new Date('2026-01-01T10:00:00Z'),
};

const mockArchivedTemplate: ContractTemplate = {
  id: '01920000-0000-7000-8000-000000000002',
  name: 'Portrait Session Agreement',
  slug: 'portrait-session',
  description: 'Old portrait session agreement',
  projectTypeKey: 'portrait',
  contentEn: 'Portrait session agreement for {{client.name}}.',
  contentDe: 'Porträt-Shooting Vereinbarung für {{client.name}}.',
  isDefault: false,
  isActive: false,
  createdAt: new Date('2026-01-01T10:00:00Z'),
  updatedAt: new Date('2026-01-01T10:00:00Z'),
};

const mockStudioSettings: StudioSettings = {
  id: '01920000-0000-7000-8000-000000000010',
  studio_name: 'Elena Rostova Photography',
  default_locale: 'en',
  timezone: 'Europe/Berlin',
  currency: 'EUR',
  mfa_required: false,
  mfa_postponed_until: null,
  forms_pow_hmac_key: null,
  tax_number: null,
  vat_id: null,
  is_kleinunternehmer: false,
  kleinunternehmer_notice: null,
  default_tax_rate_basis_points: 1900,
  prices_include_tax: true,
  contract_signatory_name: 'Elena Rostova',
  contract_signatory_title: 'Lead Photographer & Studio Owner',
  contract_countersignature_mode: 'pre_signed',
  studio_address_line1: 'Kastanienallee 71',
  studio_address_line2: 'Gewerbehof 3. OG',
  studio_postal_code: '10435',
  studio_city: 'Berlin',
  studio_country_code: 'DE',
  studio_phone: '+49 30 12345678',
  studio_email: 'elena@example.org',
  created_at: new Date('2026-01-01T10:00:00Z'),
  updated_at: new Date('2026-01-01T10:00:00Z'),
};

describe('TASK-0065: Contract Templates & Studio Signing Static Render Tests', () => {
  describe('ContractTemplatesList Static Rendering (AC-1, AC-8)', () => {
    it('AC-1: Renders empty templates list correctly in English', () => {
      currentLocale = 'en';
      const html = renderToStaticMarkup(
        <ContractTemplatesList
          templates={[]}
          onNewTemplate={vi.fn()}
          onEditTemplate={vi.fn()}
          onDuplicateTemplate={vi.fn()}
          onArchiveTemplate={vi.fn()}
          onRestoreTemplate={vi.fn()}
        />,
      );

      expect(html).toContain('data-testid="contract-templates-list-container"');
      expect(html).toContain('data-testid="create-template-button"');
      expect(html).toContain('data-testid="template-project-type-filter"');
      expect(html).toContain('data-testid="template-search-input"');
      expect(html).toContain('data-testid="templates-empty-state"');
      expect(html).toContain('No active contract templates configured yet');
    });

    it('AC-8: Renders empty templates list correctly in German with no missing keys', () => {
      currentLocale = 'de';
      const html = renderToStaticMarkup(
        <ContractTemplatesList
          templates={[]}
          onNewTemplate={vi.fn()}
          onEditTemplate={vi.fn()}
          onDuplicateTemplate={vi.fn()}
          onArchiveTemplate={vi.fn()}
          onRestoreTemplate={vi.fn()}
        />,
      );

      expect(html).toContain('data-testid="contract-templates-list-container"');
      expect(html).toContain('data-testid="templates-empty-state"');
      expect(html).toContain('Noch keine aktiven Vertragsvorlagen vorhanden');
    });

    it('AC-1: Renders populated templates list with badges and actions in English', () => {
      currentLocale = 'en';
      const html = renderToStaticMarkup(
        <ContractTemplatesList
          templates={[mockActiveTemplate, mockArchivedTemplate]}
          onNewTemplate={vi.fn()}
          onEditTemplate={vi.fn()}
          onDuplicateTemplate={vi.fn()}
          onArchiveTemplate={vi.fn()}
          onRestoreTemplate={vi.fn()}
        />,
      );

      expect(html).toContain('Standard Wedding Agreement');
      expect(html).toContain('wedding-standard');
      expect(html).toContain('data-testid="template-default-badge-wedding-standard"');
      expect(html).toContain('Default');
      expect(html).toContain('data-testid="template-type-wedding-standard"');
      expect(html).toContain('Wedding');
      expect(html).toContain('data-testid="template-active-badge-wedding-standard"');
      expect(html).toContain('Active');
      expect(html).toContain('data-testid="edit-template-wedding-standard"');
      expect(html).toContain('data-testid="duplicate-template-wedding-standard"');
      expect(html).toContain('data-testid="archive-template-wedding-standard"');
    });

    it('AC-8: Renders populated templates list with badges and actions in German', () => {
      currentLocale = 'de';
      const html = renderToStaticMarkup(
        <ContractTemplatesList
          templates={[mockActiveTemplate, mockArchivedTemplate]}
          onNewTemplate={vi.fn()}
          onEditTemplate={vi.fn()}
          onDuplicateTemplate={vi.fn()}
          onArchiveTemplate={vi.fn()}
          onRestoreTemplate={vi.fn()}
        />,
      );

      expect(html).toContain('Standard Wedding Agreement');
      expect(html).toContain('Standard');
      expect(html).toContain('Hochzeit');
      expect(html).toContain('Aktiv');
      expect(html).toContain('Vorlage bearbeiten');
      expect(html).toContain('Duplizieren');
      expect(html).toContain('Vorlage archivieren');
    });
  });

  describe('ContractTemplateModal Static Rendering (AC-2, AC-3, AC-8)', () => {
    it('AC-2: Does not render modal content when closed', () => {
      currentLocale = 'en';
      const html = renderToStaticMarkup(
        <ContractTemplateModal
          template={null}
          isOpen={false}
          isSubmitting={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );

      expect(html).not.toContain('data-testid="contract-template-modal"');
    });

    it('AC-2: Renders create modal with tabs, fields, tokens and preview in English', () => {
      currentLocale = 'en';
      const html = renderToStaticMarkup(
        <ContractTemplateModal
          template={null}
          isOpen={true}
          isSubmitting={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );

      expect(html).toContain('data-testid="contract-template-modal"');
      expect(html).toContain('Create Contract Template');
      expect(html).toContain('data-testid="contract-template-name-input"');
      expect(html).toContain('data-testid="contract-template-slug-input"');
      expect(html).toContain('data-testid="contract-template-project-type-select"');
      expect(html).toContain('data-testid="contract-template-default-toggle"');
      expect(html).toContain('id="clause-tab-en"');
      expect(html).toContain('id="clause-tab-de"');
      expect(html).toContain('data-testid="contract-template-content-en-input"');
      expect(html).toContain('data-testid="token-palette"');
      expect(html).toContain('data-testid="merge-field-preview-card"');
      expect(html).toContain('data-testid="save-template-btn"');
    });

    it('AC-8: Renders create modal with German localization with zero missing keys', () => {
      currentLocale = 'de';
      const html = renderToStaticMarkup(
        <ContractTemplateModal
          template={null}
          isOpen={true}
          isSubmitting={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );

      expect(html).toContain('data-testid="contract-template-modal"');
      expect(html).toContain('Vertragsvorlage erstellen');
      expect(html).toContain('Englische Klauseln (en)');
      expect(html).toContain('Deutsche Klauseln (de)');
      expect(html).toContain('data-testid="merge-field-preview-card"');
      expect(html).toContain('Vorlage speichern');
    });

    it('AC-3: Renders edit modal pre-filled with existing template', () => {
      currentLocale = 'en';
      const html = renderToStaticMarkup(
        <ContractTemplateModal
          template={mockActiveTemplate}
          isOpen={true}
          isSubmitting={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );

      expect(html).toContain('Edit Contract Template');
      expect(html).toContain('value="Standard Wedding Agreement"');
      expect(html).toContain('value="wedding-standard"');
      expect(html).toContain(
        'This Agreement is entered into by Elena Rostova and Sarah &amp; Michael Jenkins.',
      );
    });

    it('AC-3: Renders duplicate modal pre-filled with copy name and slug', () => {
      currentLocale = 'en';
      const html = renderToStaticMarkup(
        <ContractTemplateModal
          template={mockActiveTemplate}
          isDuplicate={true}
          isOpen={true}
          isSubmitting={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );

      expect(html).toContain('Duplicate Contract Template');
      expect(html).toContain('value="Standard Wedding Agreement (Copy)"');
      expect(html).toContain('value="wedding-standard-copy"');
    });
  });

  describe('StudioSigningSettingsCard Static Rendering (AC-6, AC-8)', () => {
    it('AC-6: Renders studio signing profile and pre-signed radio selection in English', () => {
      currentLocale = 'en';
      const html = renderToStaticMarkup(
        <StudioSigningSettingsCard initialSettings={mockStudioSettings} onSave={vi.fn()} />,
      );

      expect(html).toContain('data-testid="studio-signing-settings-card"');
      expect(html).toContain('Studio Signatory &amp; Countersignature Profile');
      expect(html).toContain('data-testid="signing-signatory-name-input"');
      expect(html).toContain('value="Elena Rostova"');
      expect(html).toContain('data-testid="signing-signatory-title-input"');
      expect(html).toContain('value="Lead Photographer &amp; Studio Owner"');
      expect(html).toContain('data-testid="countersignature-mode-presigned"');
      expect(html).toContain('data-testid="countersignature-mode-explicit"');
      expect(html).toContain('data-testid="signing-address-line1-input"');
      expect(html).toContain('value="Kastanienallee 71"');
      expect(html).toContain('data-testid="signing-city-input"');
      expect(html).toContain('value="Berlin"');
      expect(html).toContain('data-testid="signing-postal-code-input"');
      expect(html).toContain('value="10435"');
      expect(html).toContain('data-testid="signing-country-code-input"');
      expect(html).toContain('value="DE"');
      expect(html).toContain('data-testid="save-signing-settings-btn"');
    });

    it('AC-8: Renders studio signing settings in German with zero missing keys', () => {
      currentLocale = 'de';
      const html = renderToStaticMarkup(
        <StudioSigningSettingsCard initialSettings={mockStudioSettings} onSave={vi.fn()} />,
      );

      expect(html).toContain('data-testid="studio-signing-settings-card"');
      expect(html).toContain('Studio-Signatur &amp; Gegenzeichnungsprofil');
      expect(html).toContain('Rechtlicher Name des Unterzeichners');
      expect(html).toContain('Gegenzeichnungs-Modus');
      expect(html).toContain('Automatisch (Vorab gegengezeichnet)');
      expect(html).toContain('Explizit (Manuelle Gegenzeichnung)');
      expect(html).toContain('Signatur-Einstellungen speichern');
    });
  });

  describe('ContractsSettingsView Container Static Rendering (AC-1, AC-6, AC-8)', () => {
    it('AC-1: Renders templates tab by default in English', () => {
      currentLocale = 'en';
      const html = renderToStaticMarkup(
        <ContractsSettingsView
          initialTemplates={[mockActiveTemplate]}
          initialSigningSettings={mockStudioSettings}
          defaultTab="templates"
        />,
      );

      expect(html).toContain('data-testid="contracts-settings-view"');
      expect(html).toContain('data-testid="tab-templates"');
      expect(html).toContain('data-testid="tab-signing"');
      expect(html).toContain('data-testid="contract-templates-list-container"');
    });

    it('AC-6: Renders signing tab by default in English', () => {
      currentLocale = 'en';
      const html = renderToStaticMarkup(
        <ContractsSettingsView
          initialTemplates={[mockActiveTemplate]}
          initialSigningSettings={mockStudioSettings}
          defaultTab="signing"
        />,
      );

      expect(html).toContain('data-testid="contracts-settings-view"');
      expect(html).toContain('data-testid="studio-signing-settings-card"');
    });

    it('AC-8: Renders complete view in German with zero missing keys', () => {
      currentLocale = 'de';
      const html = renderToStaticMarkup(
        <ContractsSettingsView
          initialTemplates={[mockActiveTemplate]}
          initialSigningSettings={mockStudioSettings}
          defaultTab="templates"
        />,
      );

      expect(html).toContain('data-testid="contracts-settings-view"');
      expect(html).toContain('Vertragsvorlagen');
      expect(html).toContain('Studio-Signaturprofil');
    });

    it('Renders StudioSigningSettingsCard with success notification and validation error states', () => {
      currentLocale = 'en';
      const successHtml = renderToStaticMarkup(
        <StudioSigningSettingsCard
          initialSettings={mockStudioSettings}
          initialShowSuccess={true}
          onSave={vi.fn()}
        />,
      );
      expect(successHtml).toContain('data-testid="signing-success-notification"');

      const errorHtml = renderToStaticMarkup(
        <StudioSigningSettingsCard
          initialSettings={mockStudioSettings}
          initialErrors={{
            contractSignatoryName: 'Signatory name too long',
            contractSignatoryTitle: 'Title too long',
            studioCountryCode: 'Country code invalid',
            studioEmail: 'Email is invalid',
          }}
          onSave={vi.fn()}
        />,
      );
      expect(errorHtml).toContain('Signatory name too long');
      expect(errorHtml).toContain('Country code invalid');
      expect(errorHtml).toContain('aria-invalid="true"');
    });

    it('Renders ContractTemplateModal with duplicate mode, submitting state, German tab, and validation errors', () => {
      currentLocale = 'en';
      const dupHtml = renderToStaticMarkup(
        <ContractTemplateModal
          template={mockActiveTemplate}
          isOpen={true}
          isSubmitting={false}
          isDuplicate={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );
      expect(dupHtml).toContain('Standard Wedding Agreement (Copy)');
      expect(dupHtml).toContain('wedding-standard-copy');

      const submittingHtml = renderToStaticMarkup(
        <ContractTemplateModal
          template={null}
          isOpen={true}
          isSubmitting={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );
      expect(submittingHtml).toContain('disabled=""');

      const errorHtml = renderToStaticMarkup(
        <ContractTemplateModal
          template={null}
          isOpen={true}
          isSubmitting={false}
          initialErrors={{
            name: 'Name required',
            slug: 'Slug invalid',
            description: 'Description too long',
            contentEn: 'English content required',
            contentDe: 'German content required',
          }}
          initialClauseTab="de"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );
      expect(errorHtml).toContain('Name required');
      expect(errorHtml).toContain('German content required');
      expect(errorHtml).toContain('aria-invalid="true"');
    });

    it('Renders ContractTemplatesList with archive and restore dialog states open', () => {
      currentLocale = 'en';
      const archiveDialogHtml = renderToStaticMarkup(
        <ContractTemplatesList
          templates={[mockActiveTemplate, mockArchivedTemplate]}
          initialTemplateToArchive={mockActiveTemplate}
          onNewTemplate={vi.fn()}
          onEditTemplate={vi.fn()}
          onDuplicateTemplate={vi.fn()}
          onArchiveTemplate={vi.fn()}
          onRestoreTemplate={vi.fn()}
        />,
      );
      expect(archiveDialogHtml).toContain('data-testid="contract-template-archive-dialog"');
      expect(archiveDialogHtml).toContain('data-testid="confirm-archive-btn"');
      expect(archiveDialogHtml).toContain('Standard Wedding Agreement');

      const restoreDialogHtml = renderToStaticMarkup(
        <ContractTemplatesList
          templates={[mockActiveTemplate, mockArchivedTemplate]}
          initialTemplateToArchive={mockArchivedTemplate}
          onNewTemplate={vi.fn()}
          onEditTemplate={vi.fn()}
          onDuplicateTemplate={vi.fn()}
          onArchiveTemplate={vi.fn()}
          onRestoreTemplate={vi.fn()}
        />,
      );
      expect(restoreDialogHtml).toContain('data-testid="contract-template-archive-dialog"');
      expect(restoreDialogHtml).toContain('Portrait Session Agreement');
    });

    it('Renders ContractTemplatesList in archived mode and empty states', () => {
      currentLocale = 'en';
      // Archived view with archived template
      const archivedViewHtml = renderToStaticMarkup(
        <ContractTemplatesList
          templates={[mockActiveTemplate, mockArchivedTemplate]}
          initialShowArchived={true}
          onNewTemplate={vi.fn()}
          onEditTemplate={vi.fn()}
          onDuplicateTemplate={vi.fn()}
          onArchiveTemplate={vi.fn()}
          onRestoreTemplate={vi.fn()}
        />,
      );
      expect(archivedViewHtml).toContain('data-testid="contract-template-row-portrait-session"');
      expect(archivedViewHtml).toContain('data-testid="template-archived-badge-portrait-session"');
      expect(archivedViewHtml).toContain('data-testid="restore-template-portrait-session"');
      expect(archivedViewHtml).toContain('Hide Archived');

      // Empty active state
      const emptyActiveHtml = renderToStaticMarkup(
        <ContractTemplatesList
          templates={[]}
          initialShowArchived={false}
          onNewTemplate={vi.fn()}
          onEditTemplate={vi.fn()}
          onDuplicateTemplate={vi.fn()}
          onArchiveTemplate={vi.fn()}
          onRestoreTemplate={vi.fn()}
        />,
      );
      expect(emptyActiveHtml).toContain('data-testid="templates-empty-state"');
      expect(emptyActiveHtml).toContain('No active contract templates configured yet');

      // Empty archived state
      const emptyArchivedHtml = renderToStaticMarkup(
        <ContractTemplatesList
          templates={[]}
          initialShowArchived={true}
          onNewTemplate={vi.fn()}
          onEditTemplate={vi.fn()}
          onDuplicateTemplate={vi.fn()}
          onArchiveTemplate={vi.fn()}
          onRestoreTemplate={vi.fn()}
        />,
      );
      expect(emptyArchivedHtml).toContain('data-testid="templates-empty-state"');
      expect(emptyArchivedHtml).toContain('No archived contract templates.');
    });

    it('I1-U01: archive confirmation dialog renders interpolated template name without literal {name} in EN and DE', () => {
      // English
      currentLocale = 'en';
      const enHtml = renderToStaticMarkup(
        <ContractTemplatesList
          templates={[mockActiveTemplate]}
          initialTemplateToArchive={mockActiveTemplate}
          onNewTemplate={vi.fn()}
          onEditTemplate={vi.fn()}
          onDuplicateTemplate={vi.fn()}
          onArchiveTemplate={vi.fn()}
          onRestoreTemplate={vi.fn()}
        />,
      );
      expect(enHtml).not.toContain('{name}');
      expect(enHtml).toContain(
        'Are you sure you want to archive &quot;Standard Wedding Agreement&quot;?',
      );

      // German
      currentLocale = 'de';
      const deHtml = renderToStaticMarkup(
        <ContractTemplatesList
          templates={[mockActiveTemplate]}
          initialTemplateToArchive={mockActiveTemplate}
          onNewTemplate={vi.fn()}
          onEditTemplate={vi.fn()}
          onDuplicateTemplate={vi.fn()}
          onArchiveTemplate={vi.fn()}
          onRestoreTemplate={vi.fn()}
        />,
      );
      expect(deHtml).not.toContain('{name}');
      expect(deHtml).toContain(
        'Sind Sie sicher, dass Sie &quot;Standard Wedding Agreement&quot; archivieren möchten?',
      );
      currentLocale = 'en';
    });

    it('I1-U02: createContractTemplateModalController focuses and scrolls first invalid field on submission error', async () => {
      const mockFocus = vi.fn();
      const mockScrollIntoView = vi.fn();
      const dummyInput = {
        focus: mockFocus,
        scrollIntoView: mockScrollIntoView,
      } as unknown as HTMLElement;

      const mockQuerySelector = vi.fn().mockReturnValue(dummyInput);
      const mockContainer = {
        querySelector: mockQuerySelector,
      } as unknown as HTMLElement;

      const setErrors = vi.fn();
      const setActiveClauseTab = vi.fn();
      const setLiveAnnouncement = vi.fn();
      const onSave = vi.fn();
      const onClose = vi.fn();

      const controller = createContractTemplateModalController({
        formData: {
          name: '',
          slug: '',
          description: '',
          projectTypeKey: '',
          contentEn: '',
          contentDe: '',
          isDefault: false,
          isActive: true,
        },
        setFormData: vi.fn(),
        setErrors,
        activeClauseTab: 'en',
        setActiveClauseTab,
        setLiveAnnouncement,
        onClose,
        onSave,
        t: (k: string) => k,
      });

      const preventDefault = vi.fn();
      const syntheticEvent = {
        preventDefault,
        currentTarget: mockContainer,
      } as unknown as React.SyntheticEvent;
      controller.handleSubmit(syntheticEvent);

      expect(preventDefault).toHaveBeenCalled();
      expect(setErrors).toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();

      // Wait for setTimeout in handleSubmit
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockQuerySelector).toHaveBeenCalledWith('[aria-invalid="true"], :invalid');
      expect(mockFocus).toHaveBeenCalled();
      expect(mockScrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    });
  });
});
