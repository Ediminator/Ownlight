import { describe, it, expect, vi } from 'vitest';
import type * as React from 'react';
import {
  generateTemplateSlug,
  insertTokenAtCursor,
  interpolateContractPreview,
  filterContractTemplates,
  validateContractTemplateForm,
  validateStudioSigningForm,
  initialSigningFormDataFromSettings,
  initialTemplateFormData,
  createStudioSigningController,
  createContractTemplateModalController,
  createContractTemplatesListController,
  createContractsSettingsViewController,
  getProjectTypeLabelKey,
  PROJECT_TYPE_LABELS,
  createModalDialogHandlers,
  SAMPLE_COMMISSION_DATA_DE,
  TOKEN_CATEGORIES,
  EMPTY_TEMPLATE_FORM_DATA,
  type StudioSigningFormData,
  type ContractTemplateFormData,
} from '@/components/settings/contracts-helpers';
import type { ContractTemplate } from '@/server/db/schema/contracts';
import type { StudioSettings } from '@/server/db/schema/studio-settings';

const dummyT = (key: string) => `mocked_${key}`;

describe('TASK-0065: Contract Template View-Model & Form Helpers Unit Tests', () => {
  describe('Slug Generation & Token Insertion (AC-2, AC-3)', () => {
    it('AC-2: generateTemplateSlug converts template name to lowercase kebab-case', () => {
      expect(generateTemplateSlug('Full Day Wedding Agreement')).toBe('full-day-wedding-agreement');
      expect(generateTemplateSlug('Commercial Model & Property Release 2026!')).toBe(
        'commercial-model-property-release-2026',
      );
      expect(generateTemplateSlug('   Portrait -- Agreement   ')).toBe('portrait-agreement');
      expect(generateTemplateSlug('Künstlervertrag & Übertragung')).toBe(
        'kunstlervertrag-ubertragung',
      );
    });

    it('AC-3: insertTokenAtCursor inserts token formatted with double braces at cursor position', () => {
      const original = 'Agreement between  and client';
      const result = insertTokenAtCursor(original, 'studio.name', 18, 18);
      expect(result.newText).toBe('Agreement between {{studio.name}} and client');
      expect(result.newCursorPos).toBe(18 + '{{studio.name}}'.length);
    });

    it('AC-3: insertTokenAtCursor replaces selected text when selectionStart < selectionEnd', () => {
      const original = 'Client: [INSERT_NAME_HERE]';
      const start = original.indexOf('[INSERT_NAME_HERE]');
      const end = start + '[INSERT_NAME_HERE]'.length;
      const result = insertTokenAtCursor(original, 'client.name', start, end);
      expect(result.newText).toBe('Client: {{client.name}}');
      expect(result.newCursorPos).toBe(start + '{{client.name}}'.length);
    });

    it('AC-3: insertTokenAtCursor appends token at the end when selection is undefined', () => {
      const original = 'Notes: ';
      const result = insertTokenAtCursor(original, 'project.notes');
      expect(result.newText).toBe('Notes: {{project.notes}}');
      expect(result.newCursorPos).toBe(original.length + '{{project.notes}}'.length);
    });

    it('AC-3: TOKEN_CATEGORIES palette contains all 6 required namespaces', () => {
      const categoryIds = TOKEN_CATEGORIES.map((c) => c.id);
      expect(categoryIds).toContain('client');
      expect(categoryIds).toContain('project');
      expect(categoryIds).toContain('shoot');
      expect(categoryIds).toContain('package');
      expect(categoryIds).toContain('studio');
      expect(categoryIds).toContain('contract');

      const allTokens = TOKEN_CATEGORIES.flatMap((c) => c.tokens.map((t) => t.token));
      expect(allTokens).toContain('client.name');
      expect(allTokens).toContain('project.title');
      expect(allTokens).toContain('shoot.date');
      expect(allTokens).toContain('package.total');
      expect(allTokens).toContain('studio.name');
      expect(allTokens).toContain('contract.number');
    });
  });

  describe('Live Merge Preview Interpolation (AC-3)', () => {
    it('AC-3: interpolateContractPreview replaces merge tokens with synthetic sample values', () => {
      const template =
        'Contract {{contract.number}} for {{client.name}} by {{studio.name}} on {{shoot.date}} for {{package.total}}.';
      const preview = interpolateContractPreview(template);
      expect(preview).toContain('CTR-2026-0042');
      expect(preview).toContain('Sarah & Michael Jenkins');
      expect(preview).toContain('Lumière Photography Studio');
      expect(preview).toContain('August 15, 2026');
      expect(preview).toContain('€2,800.00');
    });

    it('AC-3: interpolateContractPreview safely removes unknown or unmapped tokens', () => {
      const template = 'Hello {{client.name}}, {{unmapped.field}} and {{  spaces.token  }}!';
      const preview = interpolateContractPreview(template);
      expect(preview).toBe('Hello Sarah & Michael Jenkins,  and !');
      expect(preview).not.toContain('{{');
      expect(preview).not.toContain('}}');
    });

    it('AC-3: interpolateContractPreview handles German sample commission data', () => {
      const template = 'Termin: {{shoot.date}}, Typ: {{project.type}}, Land: {{client.country}}';
      const preview = interpolateContractPreview(template, SAMPLE_COMMISSION_DATA_DE);
      expect(preview).toContain('15. August 2026');
      expect(preview).toContain('Hochzeit');
      expect(preview).toContain('Deutschland');
    });

    it('AC-3: interpolateContractPreview handles empty template text gracefully', () => {
      expect(interpolateContractPreview('')).toBe('');
    });
  });

  describe('Template Filtering & Sorting (AC-1, AC-5)', () => {
    const mockTemplates: ContractTemplate[] = [
      {
        id: '1',
        name: 'Wedding Photography Standard',
        slug: 'wedding-standard',
        description: 'Standard wedding contract',
        projectTypeKey: 'wedding',
        contentEn: 'Wedding clauses EN',
        contentDe: 'Wedding clauses DE',
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '2',
        name: 'Portrait Session Agreement',
        slug: 'portrait-session',
        description: 'Portrait contract',
        projectTypeKey: 'portrait',
        contentEn: 'Portrait clauses EN',
        contentDe: 'Portrait clauses DE',
        isDefault: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '3',
        name: 'Commercial Agreement (Archived)',
        slug: 'commercial-archived',
        description: 'Old commercial license terms',
        projectTypeKey: 'commercial',
        contentEn: 'Commercial clauses EN',
        contentDe: 'Commercial clauses DE',
        isDefault: false,
        isActive: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '4',
        name: 'All-Day Wedding Deluxe',
        slug: 'wedding-deluxe',
        description: 'Deluxe package agreement',
        projectTypeKey: 'wedding',
        contentEn: 'Deluxe clauses EN',
        contentDe: 'Deluxe clauses DE',
        isDefault: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    it('AC-1: filterContractTemplates returns only active templates by default, sorted with defaults first', () => {
      const result = filterContractTemplates(mockTemplates);
      expect(result.length).toBe(3);
      expect(result[0]?.slug).toBe('wedding-standard'); // isDefault: true
      expect(result.some((t) => t.slug === 'commercial-archived')).toBe(false);
    });

    it('AC-1: filterContractTemplates filters by projectTypeKey', () => {
      const weddingTemplates = filterContractTemplates(mockTemplates, {
        projectTypeKey: 'wedding',
      });
      expect(weddingTemplates.length).toBe(2);
      expect(weddingTemplates.every((t) => t.projectTypeKey === 'wedding')).toBe(true);

      const portraitTemplates = filterContractTemplates(mockTemplates, {
        projectTypeKey: 'portrait',
      });
      expect(portraitTemplates.length).toBe(1);
      expect(portraitTemplates[0]?.slug).toBe('portrait-session');
    });

    it('AC-5: filterContractTemplates filters archived templates when showArchived is true', () => {
      const archived = filterContractTemplates(mockTemplates, { showArchived: true });
      expect(archived.length).toBe(1);
      expect(archived[0]?.slug).toBe('commercial-archived');
      expect(archived[0]?.isActive).toBe(false);
    });

    it('AC-1: filterContractTemplates filters by search query matching name, slug, or description', () => {
      const searched = filterContractTemplates(mockTemplates, { searchQuery: 'deluxe' });
      expect(searched.length).toBe(1);
      expect(searched[0]?.slug).toBe('wedding-deluxe');

      const searchedSlug = filterContractTemplates(mockTemplates, {
        searchQuery: 'portrait-session',
      });
      expect(searchedSlug.length).toBe(1);
      expect(searchedSlug[0]?.name).toBe('Portrait Session Agreement');
    });

    it('AC-1: filterContractTemplates sorts default templates before non-default templates', () => {
      const t0 = mockTemplates[0];
      const t1 = mockTemplates[1];
      if (!t0 || !t1) throw new Error('Missing mock templates');
      const nonDefaultFirst: ContractTemplate[] = [
        { ...t1, isDefault: false },
        { ...t0, isDefault: true },
      ];
      const sorted = filterContractTemplates(nonDefaultFirst);
      expect(sorted[0]?.isDefault).toBe(true);
      expect(sorted[1]?.isDefault).toBe(false);
    });

    it('AC-1: filterContractTemplates filters by search query matching description', () => {
      const searched = filterContractTemplates(mockTemplates, { searchQuery: 'license terms' });
      expect(searched.length).toBe(0);
      // In mockTemplates, 'license terms' is in commercial-archived, so when showArchived is true:
      const searchedArchived = filterContractTemplates(mockTemplates, {
        showArchived: true,
        searchQuery: 'license terms',
      });
      expect(searchedArchived.length).toBe(1);
      expect(searchedArchived[0]?.slug).toBe('commercial-archived');

      // Search matching nothing
      const noMatch = filterContractTemplates(mockTemplates, { searchQuery: 'nonexistent-xyz' });
      expect(noMatch.length).toBe(0);
    });
  });

  describe('Form Validation Schema Helpers (AC-4, AC-6)', () => {
    it('AC-4: validateContractTemplateForm reports errors on missing required fields', () => {
      const errors = validateContractTemplateForm(EMPTY_TEMPLATE_FORM_DATA, dummyT);
      expect(errors.name).toBe('mocked_modal.errors.nameRequired');
      expect(errors.slug).toBe('mocked_modal.errors.slugRequired');
      expect(errors.contentEn).toBe('mocked_modal.errors.contentEnRequired');
      expect(errors.contentDe).toBe('mocked_modal.errors.contentDeRequired');
    });

    it('AC-4: validateContractTemplateForm reports error on overly long name, slug, or description', () => {
      const errors = validateContractTemplateForm(
        {
          name: 'A'.repeat(151),
          slug: 'valid-slug-' + 'a'.repeat(95),
          description: 'D'.repeat(1001),
          projectTypeKey: '',
          contentEn: 'EN text',
          contentDe: 'DE text',
          isDefault: false,
          isActive: true,
        },
        dummyT,
      );
      expect(errors.name).toBe('mocked_modal.errors.nameTooLong');
      expect(errors.slug).toBe('mocked_modal.errors.slugTooLong');
      expect(errors.description).toBe('mocked_modal.errors.descriptionTooLong');
    });

    it('AC-4: validateContractTemplateForm reports error on invalid slug characters or length', () => {
      const errors = validateContractTemplateForm(
        {
          name: 'Valid Name',
          slug: 'Invalid Slug with Spaces!',
          description: '',
          projectTypeKey: '',
          contentEn: 'EN text',
          contentDe: 'DE text',
          isDefault: false,
          isActive: true,
        },
        dummyT,
      );
      expect(errors.slug).toBe('mocked_modal.errors.slugInvalid');
    });

    it('AC-4: validateContractTemplateForm accepts valid form data', () => {
      const errors = validateContractTemplateForm(
        {
          name: 'Standard Agreement',
          slug: 'standard-agreement',
          description: 'A valid description',
          projectTypeKey: 'portrait',
          contentEn: 'EN text',
          contentDe: 'DE text',
          isDefault: true,
          isActive: true,
        },
        dummyT,
      );
      expect(Object.keys(errors).length).toBe(0);
    });

    it('AC-6: validateStudioSigningForm validates country code, email, and max lengths', () => {
      const errors = validateStudioSigningForm(
        {
          contractSignatoryName: 'Elena Rostova',
          contractSignatoryTitle: 'Owner',
          contractCountersignatureMode: 'explicit',
          studioAddressLine1: 'Musterweg 1',
          studioAddressLine2: '',
          studioPostalCode: '10115',
          studioCity: 'Berlin',
          studioCountryCode: 'GERMANY_TOO_LONG',
          studioPhone: '+49 30 12345',
          studioEmail: 'not-an-email',
        },
        dummyT,
      );

      expect(errors.studioCountryCode).toBe('mocked_signing.errors.countryCodeInvalid');
      expect(errors.studioEmail).toBe('mocked_signing.errors.emailInvalid');

      // Test name and title length caps
      const lengthErrors = validateStudioSigningForm(
        {
          contractSignatoryName: 'N'.repeat(201),
          contractSignatoryTitle: 'T'.repeat(101),
          contractCountersignatureMode: 'pre_signed',
          studioAddressLine1: '',
          studioAddressLine2: '',
          studioPostalCode: '',
          studioCity: '',
          studioCountryCode: 'DE',
          studioPhone: '',
          studioEmail: 'valid@example.org',
        },
        dummyT,
      );
      expect(lengthErrors.contractSignatoryName).toBe('mocked_signing.errors.signatoryNameTooLong');
      expect(lengthErrors.contractSignatoryTitle).toBe(
        'mocked_signing.errors.signatoryTitleTooLong',
      );
    });

    it('AC-6: initialSigningFormDataFromSettings maps StudioSettings to form state', () => {
      const settings: StudioSettings = {
        id: '01920000-0000-7000-8000-000000000001',
        studio_name: 'Studio Lumiere',
        default_locale: 'en',
        timezone: 'UTC',
        currency: 'EUR',
        mfa_required: false,
        mfa_postponed_until: null,
        forms_pow_hmac_key: null,
        tax_number: '123/456',
        vat_id: 'DE123',
        is_kleinunternehmer: false,
        kleinunternehmer_notice: null,
        default_tax_rate_basis_points: 1900,
        prices_include_tax: true,
        contract_signatory_name: 'Elena Rostova',
        contract_signatory_title: 'Lead Photographer',
        contract_countersignature_mode: 'explicit',
        studio_address_line1: 'Kastanienallee 71',
        studio_address_line2: 'Studio 4B',
        studio_postal_code: '10435',
        studio_city: 'Berlin',
        studio_country_code: 'DE',
        studio_phone: '+49 30 98765',
        studio_email: 'elena@lumiere.example.com',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const formData = initialSigningFormDataFromSettings(settings);
      expect(formData.contractSignatoryName).toBe('Elena Rostova');
      expect(formData.contractSignatoryTitle).toBe('Lead Photographer');
      expect(formData.contractCountersignatureMode).toBe('explicit');
      expect(formData.studioAddressLine1).toBe('Kastanienallee 71');
      expect(formData.studioAddressLine2).toBe('Studio 4B');
      expect(formData.studioPostalCode).toBe('10435');
      expect(formData.studioCity).toBe('Berlin');
      expect(formData.studioCountryCode).toBe('DE');
      expect(formData.studioPhone).toBe('+49 30 98765');
      expect(formData.studioEmail).toBe('elena@lumiere.example.com');
    });

    it('AC-6: initialSigningFormDataFromSettings handles settings with null fields', () => {
      const emptySettings: StudioSettings = {
        id: '01920000-0000-7000-8000-000000000002',
        studio_name: 'Empty Studio',
        default_locale: 'en',
        timezone: 'UTC',
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
        contract_signatory_name: null,
        contract_signatory_title: null,
        contract_countersignature_mode: 'pre_signed',
        studio_address_line1: null,
        studio_address_line2: null,
        studio_postal_code: null,
        studio_city: null,
        studio_country_code: 'DE',
        studio_phone: null,
        studio_email: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const formData = initialSigningFormDataFromSettings(emptySettings);
      expect(formData.contractSignatoryName).toBe('');
      expect(formData.contractSignatoryTitle).toBe('');
      expect(formData.studioAddressLine1).toBe('');
      expect(formData.studioPostalCode).toBe('');
      expect(formData.studioCity).toBe('');
      expect(formData.studioPhone).toBe('');
      expect(formData.studioEmail).toBe('');
    });

    it('AC-6: validateStudioSigningForm allows valid empty optional fields', () => {
      const validEmpty: StudioSigningFormData = {
        contractSignatoryName: '',
        contractSignatoryTitle: '',
        contractCountersignatureMode: 'pre_signed',
        studioAddressLine1: '',
        studioAddressLine2: '',
        studioPostalCode: '',
        studioCity: '',
        studioCountryCode: '',
        studioPhone: '',
        studioEmail: '',
      };
      const errors = validateStudioSigningForm(validEmpty, dummyT);
      expect(Object.keys(errors).length).toBe(0);
    });

    it('AC-6: initialSigningFormDataFromSettings handles null or undefined settings', () => {
      const formData = initialSigningFormDataFromSettings(null);
      expect(formData.contractCountersignatureMode).toBe('pre_signed');
      expect(formData.studioCountryCode).toBe('DE');
      expect(formData.contractSignatoryName).toBe('');
    });
  });

  describe('Template Form Initialization & Controllers (AC-2, AC-3, AC-6)', () => {
    const mockTmpl: ContractTemplate = {
      id: '01920000-0000-7000-8000-000000000001',
      name: 'Wedding Standard',
      slug: 'wedding-standard',
      description: 'Standard wedding agreement',
      projectTypeKey: 'wedding',
      isDefault: true,
      isActive: true,
      contentEn: 'Wedding English Agreement',
      contentDe: 'Hochzeit Deutsche Vereinbarung',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('initialTemplateFormData initializes new, existing, and duplicate template forms', () => {
      // New template
      const empty = initialTemplateFormData(null);
      expect(empty.name).toBe('');
      expect(empty.slug).toBe('');
      expect(empty.isActive).toBe(true);

      // Existing template
      const existing = initialTemplateFormData(mockTmpl);
      expect(existing.id).toBe(mockTmpl.id);
      expect(existing.name).toBe('Wedding Standard');
      expect(existing.isDefault).toBe(true);

      // Duplicate template
      const duplicate = initialTemplateFormData(mockTmpl, true);
      expect(duplicate.id).toBeUndefined();
      expect(duplicate.name).toBe('Wedding Standard (Copy)');
      expect(duplicate.slug).toBe('wedding-standard-copy');
      expect(duplicate.isDefault).toBe(false);
    });

    it('createStudioSigningController manages form field updates and validation/save lifecycle', async () => {
      let state: StudioSigningFormData = {
        contractSignatoryName: '',
        contractSignatoryTitle: '',
        contractCountersignatureMode: 'pre_signed',
        studioAddressLine1: '',
        studioAddressLine2: '',
        studioPostalCode: '',
        studioCity: '',
        studioCountryCode: 'DE',
        studioPhone: '',
        studioEmail: '',
      };
      let errors: Record<string, string> = {};
      let showSuccess = false;

      const setFormData = vi.fn((updater: unknown) => {
        state =
          typeof updater === 'function'
            ? (updater as (prev: StudioSigningFormData) => StudioSigningFormData)(state)
            : (updater as StudioSigningFormData);
      });
      const setErrors = vi.fn((errs: unknown) => {
        errors = errs as Record<string, string>;
      });
      const setShowSuccess = vi.fn((val: boolean) => {
        showSuccess = val;
      });
      const setIsSubmitting = vi.fn();
      const onSave = vi.fn().mockResolvedValue(true);

      const controller = createStudioSigningController({
        formData: state,
        setFormData,
        setErrors,
        setIsSubmitting,
        setShowSuccess,
        onSave,
        t: dummyT,
      });

      // Field changes
      controller.handleSignatoryNameChange({
        target: { value: 'Elena Rostova' },
      } as React.ChangeEvent<HTMLInputElement>);
      controller.handleSignatoryTitleChange({
        target: { value: 'Principal' },
      } as React.ChangeEvent<HTMLInputElement>);
      controller.handleAddressLine1Change({
        target: { value: 'Torstraße 1' },
      } as React.ChangeEvent<HTMLInputElement>);
      controller.handleAddressLine2Change({
        target: { value: 'VH 3' },
      } as React.ChangeEvent<HTMLInputElement>);
      controller.handlePostalCodeChange({
        target: { value: '10119' },
      } as React.ChangeEvent<HTMLInputElement>);
      controller.handleCityChange({
        target: { value: 'Berlin' },
      } as React.ChangeEvent<HTMLInputElement>);
      controller.handleCountryCodeChange({
        target: { value: 'DE' },
      } as React.ChangeEvent<HTMLSelectElement>);
      controller.handlePhoneChange({
        target: { value: '+49 30 123' },
      } as React.ChangeEvent<HTMLInputElement>);
      controller.handleEmailChange({
        target: { value: 'elena@example.com' },
      } as React.ChangeEvent<HTMLInputElement>);
      controller.handleSelectExplicit();
      controller.handleSelectPreSigned();

      expect(setFormData).toHaveBeenCalled();
      expect(setShowSuccess).toHaveBeenCalledWith(false);

      // Submit with valid data
      const preventDefault = vi.fn();
      const e = { preventDefault } as unknown as React.SyntheticEvent;
      controller.handleSubmit(e);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(preventDefault).toHaveBeenCalled();
      expect(onSave).toHaveBeenCalled();
      expect(setShowSuccess).toHaveBeenCalledWith(true);
      expect(showSuccess).toBe(true);

      // Submit with invalid data
      const invalidController = createStudioSigningController({
        formData: { ...state, studioCountryCode: 'TOO_LONG' },
        setFormData,
        setErrors,
        setIsSubmitting,
        setShowSuccess,
        onSave,
        t: dummyT,
      });
      invalidController.handleSubmit(e);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(setErrors).toHaveBeenCalled();
      expect(Object.keys(errors).length).toBeGreaterThan(0);
    });

    it('createContractTemplateModalController handles token insertion, tabs, and save lifecycle', async () => {
      let state: ContractTemplateFormData = {
        name: '',
        slug: '',
        description: '',
        projectTypeKey: '',
        isDefault: false,
        contentEn: 'Hello World',
        contentDe: 'Hallo Welt',
        isActive: true,
      };
      let errors: Record<string, string> = {};
      let activeClauseTab: 'en' | 'de' = 'en';
      let announcement = '';

      const setFormData = vi.fn((updater: unknown) => {
        state =
          typeof updater === 'function'
            ? (updater as (prev: ContractTemplateFormData) => ContractTemplateFormData)(state)
            : (updater as ContractTemplateFormData);
      });
      const setErrors = vi.fn((errs: unknown) => {
        errors = errs as Record<string, string>;
      });
      const setActiveClauseTab = vi.fn((tab: 'en' | 'de') => {
        activeClauseTab = tab;
      });
      const setLiveAnnouncement = vi.fn((msg: string) => {
        announcement = msg;
      });
      const onClose = vi.fn();
      const onSave = vi.fn().mockResolvedValue(true);

      const controller = createContractTemplateModalController({
        formData: state,
        setFormData,
        setErrors,
        activeClauseTab,
        setActiveClauseTab,
        setLiveAnnouncement,
        onClose,
        onSave,
        t: dummyT,
      });

      // Field changes (including auto-slug generation on name change)
      controller.handleNameChange({
        target: { value: 'New Portrait' },
      } as React.ChangeEvent<HTMLInputElement>);
      controller.handleSlugChange({
        target: { value: 'custom-portrait' },
      } as React.ChangeEvent<HTMLInputElement>);
      controller.handleDescriptionChange({
        target: { value: 'Portrait desc' },
      } as React.ChangeEvent<HTMLTextAreaElement>);
      controller.handleProjectTypeChange({
        target: { value: 'portrait' },
      } as React.ChangeEvent<HTMLSelectElement>);
      controller.handleDefaultChange({
        target: { checked: true },
      } as React.ChangeEvent<HTMLInputElement>);
      controller.handleContentEnChange({
        target: { value: 'Updated EN' },
      } as React.ChangeEvent<HTMLTextAreaElement>);
      controller.handleContentDeChange({
        target: { value: 'Updated DE' },
      } as React.ChangeEvent<HTMLTextAreaElement>);

      // Tab controls
      controller.handleSelectEnClauseTab();
      controller.handleSelectDeClauseTab();
      expect(setActiveClauseTab).toHaveBeenCalledWith('de');

      // Token insertion in EN and DE
      controller.handleInsertToken('client.name');
      expect(setLiveAnnouncement).toHaveBeenCalled();
      expect(announcement).toBeDefined();

      // Submit with invalid data
      const preventDefault = vi.fn();
      const e = { preventDefault } as unknown as React.SyntheticEvent;
      controller.handleSubmit(e);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(setErrors).toHaveBeenCalled();
      expect(Object.keys(errors).length).toBeGreaterThan(0);

      // Submit with valid data
      const validController = createContractTemplateModalController({
        formData: {
          ...state,
          name: 'Valid Name',
          slug: 'valid-slug',
          contentEn: 'Valid EN',
          contentDe: 'Valid DE',
        },
        setFormData,
        setErrors,
        activeClauseTab: 'en',
        setActiveClauseTab,
        setLiveAnnouncement,
        onClose,
        onSave,
        t: dummyT,
      });
      validController.handleSubmit(e);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onSave).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('createContractTemplatesListController handles filtering, archiving, and restore lifecycle', async () => {
      let showArchived = false;

      const setProjectTypeKey = vi.fn();
      const setSearchQuery = vi.fn();
      const setShowArchived = vi.fn((updater: unknown) => {
        showArchived =
          typeof updater === 'function'
            ? (updater as (prev: boolean) => boolean)(showArchived)
            : (updater as boolean);
      });
      const setTemplateToArchive = vi.fn();
      const setIsArchiving = vi.fn();
      const onArchiveTemplate = vi.fn().mockResolvedValue(true);
      const onRestoreTemplate = vi.fn().mockResolvedValue(true);

      const controller = createContractTemplatesListController({
        setProjectTypeKey,
        setSearchQuery,
        showArchived,
        setShowArchived,
        setTemplateToArchive,
        setIsArchiving,
        onArchiveTemplate,
        onRestoreTemplate,
      });

      controller.handleProjectTypeChange({
        target: { value: 'wedding' },
      } as React.ChangeEvent<HTMLSelectElement>);
      expect(setProjectTypeKey).toHaveBeenCalledWith('wedding');

      controller.handleSearchChange({
        target: { value: 'query' },
      } as React.ChangeEvent<HTMLInputElement>);
      expect(setSearchQuery).toHaveBeenCalledWith('query');

      controller.handleToggleArchived();
      expect(setShowArchived).toHaveBeenCalled();

      controller.handleOpenArchiveDialog(mockTmpl);
      expect(setTemplateToArchive).toHaveBeenCalledWith(mockTmpl);

      controller.handleCloseArchiveDialog();
      expect(setTemplateToArchive).toHaveBeenCalledWith(null);

      // Confirm archive on active template
      await controller.handleConfirmArchiveOrRestore(mockTmpl);
      expect(onArchiveTemplate).toHaveBeenCalledWith(mockTmpl);

      // Confirm restore on archived template
      await controller.handleConfirmArchiveOrRestore({ ...mockTmpl, isActive: false });
      expect(onRestoreTemplate).toHaveBeenCalled();

      // Null template confirm is a no-op
      await controller.handleConfirmArchiveOrRestore(null);
    });

    it('createContractsSettingsViewController handles tabs, keyboard roving, modal transitions, and CRUD actions', async () => {
      const setActiveTab = vi.fn();
      const setEditingTemplate = vi.fn();
      const setIsDuplicate = vi.fn();
      const setIsModalOpen = vi.fn();
      const setIsSubmittingTemplate = vi.fn();
      const setTemplates = vi.fn();
      const setSigningSettings = vi.fn();
      const router = { refresh: vi.fn() };

      const updateContractAction = vi
        .fn()
        .mockResolvedValue({ success: true, data: { ...mockTmpl, name: 'Updated' } });
      const createContractAction = vi
        .fn()
        .mockResolvedValue({ success: true, data: { ...mockTmpl, id: 'new-id' } });
      const archiveContractAction = vi
        .fn()
        .mockResolvedValue({ success: true, data: { id: mockTmpl.id, isActive: false } });
      const updateSigningAction = vi
        .fn()
        .mockResolvedValue({ success: true, data: { contract_signatory_name: 'Elena' } });

      const controller = createContractsSettingsViewController({
        setActiveTab,
        setEditingTemplate,
        setIsDuplicate,
        setIsModalOpen,
        setIsSubmittingTemplate,
        setTemplates,
        setSigningSettings,
        router,
        updateContractAction,
        createContractAction,
        archiveContractAction,
        updateSigningAction,
      });

      // Tab selection & roving keyboard navigation
      controller.handleSelectTemplatesTab();
      expect(setActiveTab).toHaveBeenCalledWith('templates');

      controller.handleSelectSigningTab();
      expect(setActiveTab).toHaveBeenCalledWith('signing');

      const mockKeyEvent = (key: string) =>
        ({ key, preventDefault: vi.fn() }) as unknown as React.KeyboardEvent;
      controller.handleTabKeyDown(mockKeyEvent('ArrowRight'), 'templates');
      controller.handleTabKeyDown(mockKeyEvent('ArrowLeft'), 'signing');
      controller.handleTabKeyDown(mockKeyEvent('Home'), 'signing');
      controller.handleTabKeyDown(mockKeyEvent('End'), 'templates');
      controller.handleTabKeyDown(mockKeyEvent('Tab'), 'templates');

      // Modal open/close actions
      controller.handleNewTemplate();
      expect(setIsModalOpen).toHaveBeenCalledWith(true);
      expect(setIsDuplicate).toHaveBeenCalledWith(false);

      controller.handleEditTemplate(mockTmpl);
      expect(setEditingTemplate).toHaveBeenCalledWith(mockTmpl);

      controller.handleDuplicateTemplate(mockTmpl);
      expect(setIsDuplicate).toHaveBeenCalledWith(true);

      controller.handleCloseModal();
      expect(setIsModalOpen).toHaveBeenCalledWith(false);

      // Save new template
      const createRes = await controller.handleSaveTemplate({
        name: 'New',
        slug: 'new',
        description: '',
        projectTypeKey: '',
        isDefault: false,
        contentEn: 'EN',
        contentDe: 'DE',
        isActive: true,
      });
      expect(createRes).toBe(true);
      expect(createContractAction).toHaveBeenCalled();

      // Save existing template
      const updateRes = await controller.handleSaveTemplate({
        id: mockTmpl.id,
        name: 'Updated',
        slug: 'updated',
        description: '',
        projectTypeKey: '',
        isDefault: false,
        contentEn: 'EN',
        contentDe: 'DE',
        isActive: true,
      });
      expect(updateRes).toBe(true);
      expect(updateContractAction).toHaveBeenCalled();

      // Archive & Restore
      await controller.handleArchiveTemplate(mockTmpl);
      expect(archiveContractAction).toHaveBeenCalled();

      await controller.handleRestoreTemplate(mockTmpl);
      expect(archiveContractAction).toHaveBeenCalled();

      // Signing settings save
      await controller.handleSaveSigningSettings({
        contractSignatoryName: 'Elena',
        contractSignatoryTitle: 'Owner',
        contractCountersignatureMode: 'explicit',
        studioAddressLine1: '',
        studioAddressLine2: '',
        studioPostalCode: '',
        studioCity: '',
        studioCountryCode: 'DE',
        studioPhone: '',
        studioEmail: '',
      });
      expect(updateSigningAction).toHaveBeenCalled();

      // Negative branches & missing actions
      const failingUpdateAction = vi.fn().mockResolvedValue({ success: false, error: 'fail' });
      const failingCreateAction = vi.fn().mockResolvedValue({ success: false, error: 'fail' });
      const failingArchiveAction = vi.fn().mockResolvedValue({ success: false, error: 'fail' });
      const failingSigningAction = vi.fn().mockResolvedValue({ success: false, error: 'fail' });

      const failingController = createContractsSettingsViewController({
        setActiveTab: vi.fn(),
        setEditingTemplate: vi.fn(),
        setIsDuplicate: vi.fn(),
        setIsModalOpen: vi.fn(),
        setIsSubmittingTemplate: vi.fn(),
        setTemplates: vi.fn(),
        setSigningSettings: vi.fn(),
        router: { refresh: vi.fn() },
        updateContractAction: failingUpdateAction,
        createContractAction: failingCreateAction,
        archiveContractAction: failingArchiveAction,
        updateSigningAction: failingSigningAction,
      });

      expect(
        await failingController.handleSaveTemplate({
          id: '123',
        } as unknown as ContractTemplateFormData),
      ).toBe(false);
      expect(
        await failingController.handleSaveTemplate({} as unknown as ContractTemplateFormData),
      ).toBe(false);
      expect(await failingController.handleArchiveTemplate(mockTmpl)).toBe(false);
      expect(await failingController.handleRestoreTemplate(mockTmpl)).toBe(false);
      expect(
        await failingController.handleSaveSigningSettings({} as unknown as StudioSigningFormData),
      ).toBe(false);

      const emptyActionController = createContractsSettingsViewController({
        setActiveTab: vi.fn(),
        setEditingTemplate: vi.fn(),
        setIsDuplicate: vi.fn(),
        setIsModalOpen: vi.fn(),
        setIsSubmittingTemplate: vi.fn(),
        setTemplates: vi.fn(),
        setSigningSettings: vi.fn(),
        router: { refresh: vi.fn() },
      });

      expect(
        await emptyActionController.handleSaveTemplate({
          id: '123',
        } as unknown as ContractTemplateFormData),
      ).toBe(false);
      expect(
        await emptyActionController.handleSaveTemplate({} as unknown as ContractTemplateFormData),
      ).toBe(false);
      expect(await emptyActionController.handleArchiveTemplate(mockTmpl)).toBe(false);
      expect(await emptyActionController.handleRestoreTemplate(mockTmpl)).toBe(false);
      expect(
        await emptyActionController.handleSaveSigningSettings(
          {} as unknown as StudioSigningFormData,
        ),
      ).toBe(false);

      // Tab keydown handling
      const tabTarget = vi.fn();
      const tabController = createContractsSettingsViewController({
        setActiveTab: tabTarget,
        setEditingTemplate: vi.fn(),
        setIsDuplicate: vi.fn(),
        setIsModalOpen: vi.fn(),
        setIsSubmittingTemplate: vi.fn(),
        setTemplates: vi.fn(),
        setSigningSettings: vi.fn(),
        router: { refresh: vi.fn() },
      });

      const preventDefault = vi.fn();
      tabController.handleTabKeyDown(
        { key: 'ArrowRight', preventDefault } as unknown as React.KeyboardEvent,
        'templates',
      );
      expect(tabTarget).toHaveBeenCalledWith('signing');

      tabController.handleTabKeyDown(
        { key: 'ArrowLeft', preventDefault } as unknown as React.KeyboardEvent,
        'signing',
      );
      expect(tabTarget).toHaveBeenCalledWith('templates');

      tabController.handleTabKeyDown(
        { key: 'Home', preventDefault } as unknown as React.KeyboardEvent,
        'signing',
      );
      expect(tabTarget).toHaveBeenCalledWith('templates');

      tabController.handleTabKeyDown(
        { key: 'End', preventDefault } as unknown as React.KeyboardEvent,
        'templates',
      );
      expect(tabTarget).toHaveBeenCalledWith('signing');

      tabController.handleTabKeyDown(
        { key: 'Enter', preventDefault } as unknown as React.KeyboardEvent,
        'templates',
      );
      tabController.handleTemplatesTabKeyDown({
        key: 'ArrowRight',
        preventDefault,
      } as unknown as React.KeyboardEvent);
      tabController.handleSigningTabKeyDown({
        key: 'ArrowLeft',
        preventDefault,
      } as unknown as React.KeyboardEvent);
    });

    it('AC-1: getProjectTypeLabelKey resolves all supported project types and fallbacks', () => {
      expect(getProjectTypeLabelKey('wedding')).toBe('list.projectTypes.wedding');
      expect(getProjectTypeLabelKey('portrait')).toBe('list.projectTypes.portrait');
      expect(getProjectTypeLabelKey('commercial')).toBe('list.projectTypes.commercial');
      expect(getProjectTypeLabelKey('event')).toBe('list.projectTypes.event');
      expect(getProjectTypeLabelKey('video')).toBe('list.projectTypes.video');
      expect(getProjectTypeLabelKey('engagement')).toBe('list.projectTypes.engagement');
      expect(getProjectTypeLabelKey('editorial')).toBe('list.projectTypes.editorial');
      expect(getProjectTypeLabelKey(null)).toBe('list.projectTypeNone');
      expect(getProjectTypeLabelKey(undefined)).toBe('list.projectTypeNone');
      expect(getProjectTypeLabelKey('custom_type')).toBe('list.projectTypeNone');
      expect(PROJECT_TYPE_LABELS.wedding).toBe('list.projectTypes.wedding');
    });

    it('AC-2: createModalDialogHandlers handles openChange and focus restoration', () => {
      const onClose = vi.fn();
      const focusFn = vi.fn();
      const mockBtn = {
        focus: () => {
          focusFn();
        },
      } as unknown as HTMLButtonElement;
      const triggerRef = { current: mockBtn };
      const handlers = createModalDialogHandlers(onClose, triggerRef);

      handlers.onOpenChange(true);
      expect(onClose).not.toHaveBeenCalled();

      handlers.onOpenChange(false);
      expect(onClose).toHaveBeenCalled();

      const preventDefault = vi.fn();
      handlers.onCloseAutoFocus({ preventDefault } as unknown as Event);
      expect(preventDefault).toHaveBeenCalled();
      expect(focusFn).toHaveBeenCalled();

      // Without triggerRef
      const handlersNoRef = createModalDialogHandlers(onClose);
      handlersNoRef.onCloseAutoFocus({ preventDefault } as unknown as Event);
    });

    it('AC-1, AC-5: createContractTemplatesListController handles row action clicks and archive flows', async () => {
      const onEdit = vi.fn();
      const onDuplicate = vi.fn();
      const onArchive = vi.fn().mockResolvedValue(true);
      const onRestore = vi.fn().mockResolvedValue(true);
      const setTemplateToArchive = vi.fn();
      const setIsArchiving = vi.fn();
      const focusFn = vi.fn();
      const mockBtn = {
        focus: () => {
          focusFn();
        },
      } as unknown as HTMLButtonElement;

      const activeTmpl: ContractTemplate = {
        ...mockTmpl,
        id: '1',
        slug: 'active-slug',
        isActive: true,
      };
      const inactiveTmpl: ContractTemplate = {
        ...mockTmpl,
        id: '2',
        slug: 'inactive-slug',
        isActive: false,
      };

      const controller = createContractTemplatesListController({
        templates: [activeTmpl, inactiveTmpl],
        onEditTemplate: onEdit,
        onDuplicateTemplate: onDuplicate,
        setProjectTypeKey: vi.fn(),
        setSearchQuery: vi.fn(),
        showArchived: false,
        setShowArchived: vi.fn(),
        templateToArchive: activeTmpl,
        setTemplateToArchive,
        setIsArchiving,
        onArchiveTemplate: onArchive,
        onRestoreTemplate: onRestore,
      });

      // Row edit click
      controller.handleEditRowClick({
        currentTarget: { getAttribute: () => 'active-slug' },
      } as unknown as React.MouseEvent<HTMLButtonElement>);
      expect(onEdit).toHaveBeenCalledWith(activeTmpl);

      // Non-matching slug
      controller.handleEditRowClick({
        currentTarget: { getAttribute: () => 'nonexistent' },
      } as unknown as React.MouseEvent<HTMLButtonElement>);

      // Row duplicate click
      controller.handleDuplicateRowClick({
        currentTarget: { getAttribute: () => 'active-slug' },
      } as unknown as React.MouseEvent<HTMLButtonElement>);
      expect(onDuplicate).toHaveBeenCalledWith(activeTmpl);

      // Row archive click
      controller.handleArchiveRowClick({
        currentTarget: {
          getAttribute: () => 'active-slug',
          focus: () => {
            focusFn();
          },
        },
      } as unknown as React.MouseEvent<HTMLButtonElement>);
      expect(setTemplateToArchive).toHaveBeenCalledWith(activeTmpl);

      // Row restore click
      controller.handleRestoreRowClick({
        currentTarget: { getAttribute: () => 'inactive-slug' },
      } as unknown as React.MouseEvent<HTMLButtonElement>);
      expect(onRestore).toHaveBeenCalledWith(inactiveTmpl);

      // Archive dialog events
      controller.handleArchiveDialogOpenChange(true);
      expect(setTemplateToArchive).not.toHaveBeenCalledWith(null);
      controller.handleArchiveDialogOpenChange(false);
      expect(setTemplateToArchive).toHaveBeenCalledWith(null);

      const originalDoc = globalThis.document;
      globalThis.document = {
        querySelector: vi.fn().mockReturnValue(mockBtn),
      } as unknown as Document;
      try {
        const preventDefault = vi.fn();
        controller.handleArchiveDialogCloseAutoFocus({ preventDefault } as unknown as Event);
        expect(preventDefault).toHaveBeenCalled();
        expect(focusFn).toHaveBeenCalled();
      } finally {
        globalThis.document = originalDoc;
      }

      // Confirm archive active
      await controller.handleConfirmArchiveOrRestore(activeTmpl);
      expect(onArchive).toHaveBeenCalledWith(activeTmpl);

      // Confirm restore inactive
      await controller.handleConfirmArchiveOrRestore(inactiveTmpl);
      expect(onRestore).toHaveBeenCalledWith(inactiveTmpl);

      // Confirm with null
      await controller.handleConfirmArchiveOrRestore(null);

      // Failure branches
      const failArchive = vi.fn().mockResolvedValue(false);
      const failRestore = vi.fn().mockResolvedValue(false);
      const failingListController = createContractTemplatesListController({
        templates: [activeTmpl, inactiveTmpl],
        onEditTemplate: onEdit,
        onDuplicateTemplate: onDuplicate,
        setProjectTypeKey: vi.fn(),
        setSearchQuery: vi.fn(),
        showArchived: false,
        setShowArchived: vi.fn(),
        templateToArchive: null,
        setTemplateToArchive,
        setIsArchiving,
        onArchiveTemplate: failArchive,
        onRestoreTemplate: failRestore,
      });

      await failingListController.handleConfirmArchiveOrRestore(activeTmpl);
      await failingListController.handleConfirmArchiveOrRestore(inactiveTmpl);
      failingListController.handleConfirmArchiveClick();
    });

    it('AC-2, AC-3: createContractTemplateModalController token click and submit branches', async () => {
      const setFormData = vi.fn();
      const setErrors = vi.fn();
      const setLiveAnnouncement = vi.fn();
      const onClose = vi.fn();
      const onSaveSuccess = vi.fn().mockResolvedValue(true);
      const onSaveFail = vi.fn().mockResolvedValue(false);

      const validData: ContractTemplateFormData = {
        name: 'Wedding Standard',
        slug: 'wedding-standard',
        description: 'Desc',
        projectTypeKey: 'wedding',
        contentEn: 'En content {{client.name}}',
        contentDe: 'De inhalt {{client.name}}',
        isDefault: false,
        isActive: true,
      };

      const controller = createContractTemplateModalController({
        formData: validData,
        setFormData,
        setErrors,
        activeClauseTab: 'en',
        setActiveClauseTab: vi.fn(),
        setLiveAnnouncement,
        onClose,
        onSave: onSaveSuccess,
        t: dummyT,
      });

      // Token button click with token
      controller.handleTokenButtonClick({
        currentTarget: { getAttribute: () => 'client.name' },
      } as unknown as React.MouseEvent<HTMLButtonElement>);
      expect(setLiveAnnouncement).toHaveBeenCalled();

      // Token button click without token
      controller.handleTokenButtonClick({
        currentTarget: { getAttribute: () => null },
      } as unknown as React.MouseEvent<HTMLButtonElement>);

      // Submit valid form -> onSave success -> onClose
      const preventDefault = vi.fn();
      controller.handleSubmit({ preventDefault } as unknown as React.SyntheticEvent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onSaveSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();

      // Submit invalid form
      const invalidController = createContractTemplateModalController({
        formData: { ...validData, name: '' },
        setFormData,
        setErrors,
        activeClauseTab: 'en',
        setActiveClauseTab: vi.fn(),
        setLiveAnnouncement,
        onClose,
        onSave: onSaveSuccess,
        t: dummyT,
      });
      invalidController.handleSubmit({ preventDefault } as unknown as React.SyntheticEvent);
      expect(setErrors).toHaveBeenCalled();

      // Submit valid form -> onSave failure
      const failingSaveController = createContractTemplateModalController({
        formData: validData,
        setFormData,
        setErrors,
        activeClauseTab: 'de',
        setActiveClauseTab: vi.fn(),
        setLiveAnnouncement,
        onClose,
        onSave: onSaveFail,
        t: dummyT,
      });
      failingSaveController.handleSubmit({ preventDefault } as unknown as React.SyntheticEvent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onSaveFail).toHaveBeenCalled();
    });

    it('AC-6: createStudioSigningController submit validation and error branches', async () => {
      const setErrors = vi.fn();
      const setShowSuccess = vi.fn();
      const onSaveSuccess = vi.fn().mockResolvedValue(true);
      const onSaveFail = vi.fn().mockResolvedValue(false);

      const validSigningData: StudioSigningFormData = {
        contractSignatoryName: 'Elena Rostova',
        contractSignatoryTitle: 'Owner & Lead Photographer',
        contractCountersignatureMode: 'pre_signed',
        studioAddressLine1: 'Musterstraße 1',
        studioAddressLine2: '',
        studioPostalCode: '10115',
        studioCity: 'Berlin',
        studioCountryCode: 'DE',
        studioPhone: '+49 30 1234567',
        studioEmail: 'studio@example.com',
      };

      const controller = createStudioSigningController({
        formData: validSigningData,
        setFormData: vi.fn(),
        setErrors,
        setIsSubmitting: vi.fn(),
        setShowSuccess,
        onSave: onSaveSuccess,
        t: dummyT,
      });

      const preventDefault = vi.fn();
      controller.handleSubmit({ preventDefault } as unknown as React.SyntheticEvent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onSaveSuccess).toHaveBeenCalled();
      expect(setShowSuccess).toHaveBeenCalledWith(true);

      // Invalid form
      const invalidSigningController = createStudioSigningController({
        formData: { ...validSigningData, studioEmail: 'invalid-email' },
        setFormData: vi.fn(),
        setErrors,
        setIsSubmitting: vi.fn(),
        setShowSuccess,
        onSave: onSaveSuccess,
        t: dummyT,
      });
      invalidSigningController.handleSubmit({ preventDefault } as unknown as React.SyntheticEvent);
      expect(setErrors).toHaveBeenCalled();

      // onSave returns false
      const failingSigningController = createStudioSigningController({
        formData: validSigningData,
        setFormData: vi.fn(),
        setErrors,
        setIsSubmitting: vi.fn(),
        setShowSuccess,
        onSave: onSaveFail,
        t: dummyT,
      });
      failingSigningController.handleSubmit({ preventDefault } as unknown as React.SyntheticEvent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onSaveFail).toHaveBeenCalled();
    });
  });
});
