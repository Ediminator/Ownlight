import type * as React from 'react';
import type { ContractTemplate } from '@/server/db/schema/contracts';
import type {
  ContractCountersignatureMode,
  StudioSettings,
} from '@/server/db/schema/studio-settings';
import type {
  CreateContractTemplateInput,
  UpdateContractTemplateActionInput,
  ArchiveContractTemplateActionInput,
  UpdateStudioSigningProfileInput,
  ContractActionResult,
} from '@/server/contracts/actions';

/**
 * Realistic synthetic commission data for live template merge preview (AC-3).
 * Fixed synthetic values (no real personal data).
 */
export const SAMPLE_COMMISSION_DATA: Record<string, string> = {
  // client namespace
  'client.name': 'Sarah & Michael Jenkins',
  'client.company': 'Jenkins Design Studio',
  'client.email': 'sarah.jenkins@example.com',
  'client.phone': '+49 30 12345678',
  'client.address': 'Musterstraße 42',
  'client.city': 'Berlin',
  'client.postal_code': '10115',
  'client.country': 'Germany',

  // project namespace
  'project.title': 'Jenkins Wedding & Celebration',
  'project.type': 'Wedding',
  'project.price': '€2,800.00',
  'project.currency': 'EUR',
  'project.notes': 'Full-day coverage including ceremony, reception, and couple portraits',

  // shoot namespace
  'shoot.date': 'August 15, 2026',
  'shoot.time': '14:00 - 22:00',
  'shoot.timezone': 'Europe/Berlin',
  'shoot.location': 'Schloss Charlottenburg Orangery',
  'shoot.address': 'Spandauer Damm 10-22, 14059 Berlin',

  // package namespace
  'package.name': 'Full Day Wedding Collection',
  'package.deliverables': '8 Hours Coverage, 400+ Edited High-Res Images, Online Gallery',
  'package.total': '€2,800.00',
  'package.subtotal': '€2,352.94',
  'package.tax': '€447.06',
  'package.addons': 'Handcrafted Fine Art Album (30x30cm)',

  // studio namespace
  'studio.name': 'Lumière Photography Studio',
  'studio.owner_name': 'Elena Rostova',
  'studio.email': 'hello@lumiere-studio.example.com',
  'studio.phone': '+49 30 98765432',
  'studio.address': 'Kastanienallee 71, 10435 Berlin',
  'studio.tax_number': '34/567/89012',
  'studio.vat_id': 'DE123456789',

  // contract namespace
  'contract.number': 'CTR-2026-0042',
  'contract.issue_date': 'June 1, 2026',
  'contract.valid_until': 'June 15, 2026',
};

/**
 * German synthetic commission data for German live merge preview.
 */
export const SAMPLE_COMMISSION_DATA_DE: Record<string, string> = {
  ...SAMPLE_COMMISSION_DATA,
  'shoot.date': '15. August 2026',
  'contract.issue_date': '1. Juni 2026',
  'contract.valid_until': '15. Juni 2026',
  'project.type': 'Hochzeit',
  'client.country': 'Deutschland',
};

export interface TokenItem {
  token: string;
  chipText: string;
  labelKey: string;
}

export interface TokenCategory {
  id: string;
  nameKey: string;
  tokens: TokenItem[];
}

/**
 * Categorized merge tokens palette definition.
 */
export const TOKEN_CATEGORIES: TokenCategory[] = [
  {
    id: 'client',
    nameKey: 'tokens.categories.client',
    tokens: [
      { token: 'client.name', chipText: '{{client.name}}', labelKey: 'tokens.client.name' },
      {
        token: 'client.company',
        chipText: '{{client.company}}',
        labelKey: 'tokens.client.company',
      },
      { token: 'client.email', chipText: '{{client.email}}', labelKey: 'tokens.client.email' },
      { token: 'client.phone', chipText: '{{client.phone}}', labelKey: 'tokens.client.phone' },
      {
        token: 'client.address',
        chipText: '{{client.address}}',
        labelKey: 'tokens.client.address',
      },
      { token: 'client.city', chipText: '{{client.city}}', labelKey: 'tokens.client.city' },
      {
        token: 'client.postal_code',
        chipText: '{{client.postal_code}}',
        labelKey: 'tokens.client.postal_code',
      },
      {
        token: 'client.country',
        chipText: '{{client.country}}',
        labelKey: 'tokens.client.country',
      },
    ],
  },
  {
    id: 'project',
    nameKey: 'tokens.categories.project',
    tokens: [
      { token: 'project.title', chipText: '{{project.title}}', labelKey: 'tokens.project.title' },
      { token: 'project.type', chipText: '{{project.type}}', labelKey: 'tokens.project.type' },
      { token: 'project.price', chipText: '{{project.price}}', labelKey: 'tokens.project.price' },
      {
        token: 'project.currency',
        chipText: '{{project.currency}}',
        labelKey: 'tokens.project.currency',
      },
      { token: 'project.notes', chipText: '{{project.notes}}', labelKey: 'tokens.project.notes' },
    ],
  },
  {
    id: 'shoot',
    nameKey: 'tokens.categories.shoot',
    tokens: [
      { token: 'shoot.date', chipText: '{{shoot.date}}', labelKey: 'tokens.shoot.date' },
      { token: 'shoot.time', chipText: '{{shoot.time}}', labelKey: 'tokens.shoot.time' },
      {
        token: 'shoot.timezone',
        chipText: '{{shoot.timezone}}',
        labelKey: 'tokens.shoot.timezone',
      },
      {
        token: 'shoot.location',
        chipText: '{{shoot.location}}',
        labelKey: 'tokens.shoot.location',
      },
      { token: 'shoot.address', chipText: '{{shoot.address}}', labelKey: 'tokens.shoot.address' },
    ],
  },
  {
    id: 'package',
    nameKey: 'tokens.categories.package',
    tokens: [
      { token: 'package.name', chipText: '{{package.name}}', labelKey: 'tokens.package.name' },
      {
        token: 'package.deliverables',
        chipText: '{{package.deliverables}}',
        labelKey: 'tokens.package.deliverables',
      },
      { token: 'package.total', chipText: '{{package.total}}', labelKey: 'tokens.package.total' },
      {
        token: 'package.subtotal',
        chipText: '{{package.subtotal}}',
        labelKey: 'tokens.package.subtotal',
      },
      { token: 'package.tax', chipText: '{{package.tax}}', labelKey: 'tokens.package.tax' },
      {
        token: 'package.addons',
        chipText: '{{package.addons}}',
        labelKey: 'tokens.package.addons',
      },
    ],
  },
  {
    id: 'studio',
    nameKey: 'tokens.categories.studio',
    tokens: [
      { token: 'studio.name', chipText: '{{studio.name}}', labelKey: 'tokens.studio.name' },
      {
        token: 'studio.owner_name',
        chipText: '{{studio.owner_name}}',
        labelKey: 'tokens.studio.owner_name',
      },
      { token: 'studio.email', chipText: '{{studio.email}}', labelKey: 'tokens.studio.email' },
      { token: 'studio.phone', chipText: '{{studio.phone}}', labelKey: 'tokens.studio.phone' },
      {
        token: 'studio.address',
        chipText: '{{studio.address}}',
        labelKey: 'tokens.studio.address',
      },
      {
        token: 'studio.tax_number',
        chipText: '{{studio.tax_number}}',
        labelKey: 'tokens.studio.tax_number',
      },
      { token: 'studio.vat_id', chipText: '{{studio.vat_id}}', labelKey: 'tokens.studio.vat_id' },
    ],
  },
  {
    id: 'contract',
    nameKey: 'tokens.categories.contract',
    tokens: [
      {
        token: 'contract.number',
        chipText: '{{contract.number}}',
        labelKey: 'tokens.contract.number',
      },
      {
        token: 'contract.issue_date',
        chipText: '{{contract.issue_date}}',
        labelKey: 'tokens.contract.issue_date',
      },
      {
        token: 'contract.valid_until',
        chipText: '{{contract.valid_until}}',
        labelKey: 'tokens.contract.valid_until',
      },
    ],
  },
];

/**
 * Automatically converts human-readable template name into kebab-case slug.
 */
export function generateTemplateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumeric to hyphens
    .replace(/^-+|-+$/g, ''); // strip leading/trailing hyphens
}

/**
 * Inserts token chip into text at current cursor/selection and computes new cursor offset.
 */
export function insertTokenAtCursor(
  text: string,
  token: string,
  selectionStart?: number,
  selectionEnd?: number,
): { newText: string; newCursorPos: number } {
  const tokenFormatted = `{{${token}}}`;
  const start = selectionStart ?? text.length;
  const end = selectionEnd ?? text.length;

  const before = text.slice(0, start);
  const after = text.slice(end);

  const newText = `${before}${tokenFormatted}${after}`;
  const newCursorPos = start + tokenFormatted.length;

  return { newText, newCursorPos };
}

/**
 * Interpolates template text against synthetic sample commission data for live preview (AC-3).
 * Sanitizes input and clears unmapped tokens safely.
 */
export function interpolateContractPreview(
  templateText: string,
  sampleData: Record<string, string> = SAMPLE_COMMISSION_DATA,
): string {
  if (!templateText) {
    return '';
  }

  const sampleMap = new Map<string, string>(Object.entries(sampleData));

  return templateText.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawToken: string) => {
    const token = rawToken.trim();
    return sampleMap.get(token) ?? '';
  });
}

export interface ContractTemplateFilterOptions {
  projectTypeKey?: string;
  showArchived?: boolean;
  searchQuery?: string;
}

/**
 * Filters contract templates by project type, active/archived state, and search query.
 */
export function filterContractTemplates(
  templates: ContractTemplate[],
  options: ContractTemplateFilterOptions = {},
): ContractTemplate[] {
  const { projectTypeKey = '', showArchived = false, searchQuery = '' } = options;
  const query = searchQuery.trim().toLowerCase();

  return templates
    .filter((template) => {
      // 1. Active vs Archived filter
      if (!showArchived && !template.isActive) {
        return false;
      }
      if (showArchived && template.isActive) {
        return false;
      }

      // 2. Project type key filter
      if (projectTypeKey && template.projectTypeKey !== projectTypeKey) {
        return false;
      }

      // 3. Search query filter
      if (query) {
        const matchesName = template.name.toLowerCase().includes(query);
        const matchesSlug = template.slug.toLowerCase().includes(query);
        const matchesDesc = (template.description ?? '').toLowerCase().includes(query);
        if (!matchesName && !matchesSlug && !matchesDesc) {
          return false;
        }
      }

      return true;
    })
    .sort((a, b) => {
      // Default templates first, then alphabetical by name
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
}

export interface ContractTemplateFormData {
  id?: string;
  name: string;
  slug: string;
  description: string;
  projectTypeKey: string;
  contentEn: string;
  contentDe: string;
  isDefault: boolean;
  isActive: boolean;
}

export type ContractTemplateFormErrors = Record<string, string>;

/**
 * Validates contract template modal form inputs with localized error messages.
 */
export function validateContractTemplateForm(
  data: ContractTemplateFormData,
  t: (key: string) => string,
): ContractTemplateFormErrors {
  const errors: ContractTemplateFormErrors = {};

  const trimmedName = data.name.trim();
  if (!trimmedName) {
    errors.name = t('modal.errors.nameRequired');
  } else if (trimmedName.length > 150) {
    errors.name = t('modal.errors.nameTooLong');
  }

  const trimmedSlug = data.slug.trim();
  const isValidSlug =
    /^[a-z0-9-]+$/.test(trimmedSlug) &&
    !trimmedSlug.startsWith('-') &&
    !trimmedSlug.endsWith('-') &&
    !trimmedSlug.includes('--');
  if (!trimmedSlug) {
    errors.slug = t('modal.errors.slugRequired');
  } else if (!isValidSlug) {
    errors.slug = t('modal.errors.slugInvalid');
  } else if (trimmedSlug.length > 100) {
    errors.slug = t('modal.errors.slugTooLong');
  }

  if (data.description && data.description.length > 1000) {
    errors.description = t('modal.errors.descriptionTooLong');
  }

  if (!data.contentEn.trim()) {
    errors.contentEn = t('modal.errors.contentEnRequired');
  }

  if (!data.contentDe.trim()) {
    errors.contentDe = t('modal.errors.contentDeRequired');
  }

  return errors;
}

export function initialTemplateFormData(
  template?: ContractTemplate | null,
  isDuplicate?: boolean,
): ContractTemplateFormData {
  if (template) {
    if (isDuplicate) {
      return {
        id: undefined,
        name: `${template.name} (Copy)`,
        slug: `${template.slug}-copy`,
        description: template.description ?? '',
        projectTypeKey: template.projectTypeKey ?? '',
        isDefault: false,
        contentEn: template.contentEn,
        contentDe: template.contentDe,
        isActive: true,
      };
    }
    return {
      id: template.id,
      name: template.name,
      slug: template.slug,
      description: template.description ?? '',
      projectTypeKey: template.projectTypeKey ?? '',
      isDefault: template.isDefault,
      contentEn: template.contentEn,
      contentDe: template.contentDe,
      isActive: template.isActive,
    };
  }
  return {
    name: '',
    slug: '',
    description: '',
    projectTypeKey: '',
    isDefault: false,
    contentEn: '',
    contentDe: '',
    isActive: true,
  };
}

export interface StudioSigningFormData {
  contractSignatoryName: string;
  contractSignatoryTitle: string;
  contractCountersignatureMode: ContractCountersignatureMode;
  studioAddressLine1: string;
  studioAddressLine2: string;
  studioPostalCode: string;
  studioCity: string;
  studioCountryCode: string;
  studioPhone: string;
  studioEmail: string;
}

export type StudioSigningFormErrors = Record<string, string>;

/**
 * Validates studio signing profile form fields.
 */
export function validateStudioSigningForm(
  data: StudioSigningFormData,
  t: (key: string) => string,
): StudioSigningFormErrors {
  const errors: StudioSigningFormErrors = {};

  if (data.contractSignatoryName && data.contractSignatoryName.trim().length > 200) {
    errors.contractSignatoryName = t('signing.errors.signatoryNameTooLong');
  }

  if (data.contractSignatoryTitle && data.contractSignatoryTitle.trim().length > 100) {
    errors.contractSignatoryTitle = t('signing.errors.signatoryTitleTooLong');
  }

  if (data.studioCountryCode) {
    const code = data.studioCountryCode.trim().toUpperCase();
    if (code.length !== 2) {
      errors.studioCountryCode = t('signing.errors.countryCodeInvalid');
    }
  }

  if (data.studioEmail.trim()) {
    const email = data.studioEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.studioEmail = t('signing.errors.emailInvalid');
    }
  }

  return errors;
}

export const EMPTY_TEMPLATE_FORM_DATA: ContractTemplateFormData = {
  name: '',
  slug: '',
  description: '',
  projectTypeKey: '',
  contentEn: '',
  contentDe: '',
  isDefault: false,
  isActive: true,
};

export const EMPTY_SIGNING_FORM_DATA: StudioSigningFormData = {
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

export function initialSigningFormDataFromSettings(
  settings?: StudioSettings | null,
): StudioSigningFormData {
  if (!settings) {
    return { ...EMPTY_SIGNING_FORM_DATA };
  }

  return {
    contractSignatoryName: settings.contract_signatory_name ?? '',
    contractSignatoryTitle: settings.contract_signatory_title ?? '',
    contractCountersignatureMode: settings.contract_countersignature_mode,
    studioAddressLine1: settings.studio_address_line1 ?? '',
    studioAddressLine2: settings.studio_address_line2 ?? '',
    studioPostalCode: settings.studio_postal_code ?? '',
    studioCity: settings.studio_city ?? '',
    studioCountryCode: settings.studio_country_code,
    studioPhone: settings.studio_phone ?? '',
    studioEmail: settings.studio_email ?? '',
  };
}

const PROJECT_TYPE_MAP = new Map<string, string>([
  ['wedding', 'list.projectTypes.wedding'],
  ['portrait', 'list.projectTypes.portrait'],
  ['commercial', 'list.projectTypes.commercial'],
  ['event', 'list.projectTypes.event'],
  ['video', 'list.projectTypes.video'],
  ['engagement', 'list.projectTypes.engagement'],
  ['editorial', 'list.projectTypes.editorial'],
]);

export const PROJECT_TYPE_LABELS: Record<string, string> = Object.fromEntries(PROJECT_TYPE_MAP);

export function getProjectTypeLabelKey(projectTypeKey: string | null | undefined): string {
  return (
    (projectTypeKey ? PROJECT_TYPE_MAP.get(projectTypeKey) : undefined) ?? 'list.projectTypeNone'
  );
}

export function createModalDialogHandlers(
  onClose: () => void,
  triggerRef?: React.RefObject<HTMLButtonElement | null>,
) {
  return {
    onOpenChange: (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault();
      triggerRef?.current?.focus();
    },
  };
}

export type TranslationFunction = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

export interface StudioSigningControllerParams {
  formData: StudioSigningFormData;
  setFormData: React.Dispatch<React.SetStateAction<StudioSigningFormData>>;
  setErrors: React.Dispatch<React.SetStateAction<StudioSigningFormErrors>>;
  setIsSubmitting: (val: boolean) => void;
  setShowSuccess: (val: boolean) => void;
  onSave: (payload: StudioSigningFormData) => Promise<boolean>;
  t: TranslationFunction;
}

export function createStudioSigningController(params: StudioSigningControllerParams) {
  const { formData, setFormData, setErrors, setIsSubmitting, setShowSuccess, onSave, t } = params;

  const handleFieldChange = (field: keyof StudioSigningFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setShowSuccess(false);
  };

  const handleSignatoryNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFieldChange('contractSignatoryName', e.target.value);
  };

  const handleSignatoryTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFieldChange('contractSignatoryTitle', e.target.value);
  };

  const handleAddressLine1Change = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFieldChange('studioAddressLine1', e.target.value);
  };

  const handleAddressLine2Change = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFieldChange('studioAddressLine2', e.target.value);
  };

  const handlePostalCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFieldChange('studioPostalCode', e.target.value);
  };

  const handleCityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFieldChange('studioCity', e.target.value);
  };

  const handleCountryCodeChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    handleFieldChange('studioCountryCode', e.target.value);
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFieldChange('studioPhone', e.target.value);
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFieldChange('studioEmail', e.target.value);
  };

  const handleSelectPreSigned = () => {
    setFormData((prev) => ({ ...prev, contractCountersignatureMode: 'pre_signed' }));
    setShowSuccess(false);
  };

  const handleSelectExplicit = () => {
    setFormData((prev) => ({ ...prev, contractCountersignatureMode: 'explicit' }));
    setShowSuccess(false);
  };

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    void (async () => {
      const validationErrors = validateStudioSigningForm(formData, t);
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        return;
      }
      setErrors({});
      setIsSubmitting(true);
      try {
        const success = await onSave(formData);
        if (success) {
          setShowSuccess(true);
        }
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  return {
    handleFieldChange,
    handleSignatoryNameChange,
    handleSignatoryTitleChange,
    handleAddressLine1Change,
    handleAddressLine2Change,
    handlePostalCodeChange,
    handleCityChange,
    handleCountryCodeChange,
    handlePhoneChange,
    handleEmailChange,
    handleSelectPreSigned,
    handleSelectExplicit,
    handleSubmit,
  };
}

export interface ContractTemplateModalControllerParams {
  formData: ContractTemplateFormData;
  setFormData: React.Dispatch<React.SetStateAction<ContractTemplateFormData>>;
  setErrors: React.Dispatch<React.SetStateAction<ContractTemplateFormErrors>>;
  activeClauseTab: 'en' | 'de';
  setActiveClauseTab: (tab: 'en' | 'de') => void;
  setLiveAnnouncement: (msg: string) => void;
  onClose: () => void;
  onSave: (payload: ContractTemplateFormData) => Promise<boolean>;
  t: TranslationFunction;
}

export function createContractTemplateModalController(
  params: ContractTemplateModalControllerParams,
) {
  const {
    formData,
    setFormData,
    setErrors,
    activeClauseTab,
    setActiveClauseTab,
    setLiveAnnouncement,
    onClose,
    onSave,
    t,
  } = params;

  const handleFieldChange = (field: keyof ContractTemplateFormData, value: unknown) => {
    setFormData((prev) => {
      const updated = { ...prev, [field]: value };
      if (field === 'name' && (!prev.id || prev.slug === '')) {
        updated.slug = generateTemplateSlug(String(value));
      }
      return updated;
    });
    setErrors((prev) => {
      const errorKey = field as keyof ContractTemplateFormErrors;
      if (!(errorKey in prev)) return prev;
      const next: ContractTemplateFormErrors = { ...prev };
      Reflect.deleteProperty(next, errorKey);
      return next;
    });
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFieldChange('name', e.target.value);
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFieldChange('slug', e.target.value);
  };

  const handleDescriptionChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    handleFieldChange('description', e.target.value);
  };

  const handleProjectTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    handleFieldChange('projectTypeKey', e.target.value);
  };

  const handleDefaultChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFieldChange('isDefault', e.target.checked);
  };

  const handleContentEnChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    handleFieldChange('contentEn', e.target.value);
  };

  const handleContentDeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    handleFieldChange('contentDe', e.target.value);
  };

  const handleSelectEnClauseTab = () => {
    setActiveClauseTab('en');
  };
  const handleSelectDeClauseTab = () => {
    setActiveClauseTab('de');
  };

  const handleInsertToken = (token: string) => {
    const textarea =
      typeof document !== 'undefined'
        ? (document.getElementById(
            activeClauseTab === 'en' ? 'content-en-textarea' : 'content-de-textarea',
          ) as HTMLTextAreaElement | null)
        : null;
    const currentText = activeClauseTab === 'en' ? formData.contentEn : formData.contentDe;

    const start = textarea?.selectionStart ?? currentText.length;
    const end = textarea?.selectionEnd ?? currentText.length;

    const { newText, newCursorPos } = insertTokenAtCursor(currentText, token, start, end);

    if (activeClauseTab === 'en') {
      handleFieldChange('contentEn', newText);
    } else {
      handleFieldChange('contentDe', newText);
    }

    setLiveAnnouncement(t('modal.tokenInsertedAnnouncement', { token }));

    if (textarea) {
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
  };

  const handleTokenButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const token = e.currentTarget.getAttribute('data-token');
    if (token) {
      handleInsertToken(token);
    }
  };

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    const container =
      (e.currentTarget as HTMLElement | null) ??
      (typeof document !== 'undefined' ? document : null);
    void (async () => {
      const validationErrors = validateContractTemplateForm(formData, t);
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        if (
          validationErrors.contentEn &&
          !validationErrors.contentDe &&
          !validationErrors.name &&
          !validationErrors.slug &&
          !validationErrors.description &&
          !validationErrors.projectTypeKey
        ) {
          setActiveClauseTab('en');
        } else if (
          validationErrors.contentDe &&
          !validationErrors.contentEn &&
          !validationErrors.name &&
          !validationErrors.slug &&
          !validationErrors.description &&
          !validationErrors.projectTypeKey
        ) {
          setActiveClauseTab('de');
        }
        if (container) {
          setTimeout(() => {
            const firstInvalid = container.querySelector<HTMLElement>(
              '[aria-invalid="true"], :invalid',
            );
            if (firstInvalid) {
              firstInvalid.focus();
              firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 0);
        }
        return;
      }
      setErrors({});
      try {
        const success = await onSave(formData);
        if (success) {
          onClose();
        }
      } catch {
        // Handled by onSave
      }
    })();
  };

  return {
    handleFieldChange,
    handleNameChange,
    handleSlugChange,
    handleDescriptionChange,
    handleProjectTypeChange,
    handleDefaultChange,
    handleContentEnChange,
    handleContentDeChange,
    handleSelectEnClauseTab,
    handleSelectDeClauseTab,
    handleInsertToken,
    handleTokenButtonClick,
    handleSubmit,
  };
}

export interface ContractTemplatesListControllerParams {
  templates?: ContractTemplate[];
  onEditTemplate?: (template: ContractTemplate) => void;
  onDuplicateTemplate?: (template: ContractTemplate) => void;
  setProjectTypeKey: (val: string) => void;
  setSearchQuery: (val: string) => void;
  showArchived: boolean;
  setShowArchived: React.Dispatch<React.SetStateAction<boolean>>;
  templateToArchive?: ContractTemplate | null;
  setTemplateToArchive: (val: ContractTemplate | null) => void;
  setIsArchiving: (val: boolean) => void;
  onArchiveTemplate: (template: ContractTemplate) => Promise<boolean>;
  onRestoreTemplate: (template: ContractTemplate) => Promise<boolean>;
}

export function createContractTemplatesListController(
  params: ContractTemplatesListControllerParams,
) {
  const {
    templates = [],
    onEditTemplate,
    onDuplicateTemplate,
    setProjectTypeKey,
    setSearchQuery,
    showArchived,
    setShowArchived,
    templateToArchive = null,
    setTemplateToArchive,
    setIsArchiving,
    onArchiveTemplate,
    onRestoreTemplate,
  } = params;

  const handleProjectTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setProjectTypeKey(e.target.value);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleToggleArchived = () => {
    setShowArchived(!showArchived);
  };

  const handleOpenArchiveDialog = (template: ContractTemplate) => {
    setTemplateToArchive(template);
  };

  const handleCloseArchiveDialog = () => {
    setTemplateToArchive(null);
  };

  const handleConfirmArchiveOrRestore = async (targetTemplate: ContractTemplate | null) => {
    if (!targetTemplate) return;
    setIsArchiving(true);
    try {
      const success = targetTemplate.isActive
        ? await onArchiveTemplate(targetTemplate)
        : await onRestoreTemplate(targetTemplate);
      if (success) {
        setTemplateToArchive(null);
      }
    } finally {
      setIsArchiving(false);
    }
  };

  const handleEditRowClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const slug = e.currentTarget.getAttribute('data-slug');
    const target = templates.find((t) => t.slug === slug);
    if (target && onEditTemplate) onEditTemplate(target);
  };

  const handleDuplicateRowClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const slug = e.currentTarget.getAttribute('data-slug');
    const target = templates.find((t) => t.slug === slug);
    if (target && onDuplicateTemplate) onDuplicateTemplate(target);
  };

  const handleArchiveRowClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const slug = e.currentTarget.getAttribute('data-slug');
    const target = templates.find((t) => t.slug === slug);
    if (target) handleOpenArchiveDialog(target);
  };

  const handleRestoreRowClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const slug = e.currentTarget.getAttribute('data-slug');
    const target = templates.find((t) => t.slug === slug);
    if (target) void onRestoreTemplate(target);
  };

  const handleArchiveDialogOpenChange = (open: boolean) => {
    if (!open) {
      handleCloseArchiveDialog();
    }
  };

  const handleArchiveDialogCloseAutoFocus = (e: Event) => {
    e.preventDefault();
    if (typeof document !== 'undefined' && templateToArchive?.slug) {
      const triggerBtn = document.querySelector<HTMLButtonElement>(
        `[data-testid="archive-template-${templateToArchive.slug}"]`,
      );
      triggerBtn?.focus();
    }
  };

  const handleConfirmArchiveClick = () => {
    void handleConfirmArchiveOrRestore(templateToArchive);
  };

  return {
    handleProjectTypeChange,
    handleSearchChange,
    handleToggleArchived,
    handleOpenArchiveDialog,
    handleCloseArchiveDialog,
    handleConfirmArchiveOrRestore,
    handleEditRowClick,
    handleDuplicateRowClick,
    handleArchiveRowClick,
    handleRestoreRowClick,
    handleArchiveDialogOpenChange,
    handleArchiveDialogCloseAutoFocus,
    handleConfirmArchiveClick,
  };
}

export interface ContractsSettingsViewControllerParams {
  setActiveTab: (tab: 'templates' | 'signing') => void;
  setEditingTemplate: (t: ContractTemplate | null) => void;
  setIsDuplicate: (val: boolean) => void;
  setIsModalOpen: (val: boolean) => void;
  setIsSubmittingTemplate: (val: boolean) => void;
  setTemplates: React.Dispatch<React.SetStateAction<ContractTemplate[]>>;
  setSigningSettings: React.Dispatch<React.SetStateAction<StudioSettings>>;
  router: { refresh: () => void };
  updateContractAction?: (
    input: UpdateContractTemplateActionInput,
  ) => Promise<ContractActionResult<ContractTemplate>>;
  createContractAction?: (
    input: CreateContractTemplateInput,
  ) => Promise<ContractActionResult<ContractTemplate>>;
  archiveContractAction?: (
    input: ArchiveContractTemplateActionInput,
  ) => Promise<ContractActionResult<{ id: string; isActive: boolean }>>;
  updateSigningAction?: (
    input: UpdateStudioSigningProfileInput,
  ) => Promise<ContractActionResult<StudioSettings>>;
}

export function createContractsSettingsViewController(
  params: ContractsSettingsViewControllerParams,
) {
  const {
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
  } = params;

  const handleSelectTemplatesTab = () => {
    setActiveTab('templates');
  };
  const handleSelectSigningTab = () => {
    setActiveTab('signing');
  };

  const handleTabKeyDown = (e: React.KeyboardEvent, currentTab: 'templates' | 'signing') => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const nextTab = currentTab === 'templates' ? 'signing' : 'templates';
      setActiveTab(nextTab);
      if (typeof document !== 'undefined') {
        const nextTabEl = document.getElementById(`contracts-tab-${nextTab}`);
        nextTabEl?.focus();
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveTab('templates');
      if (typeof document !== 'undefined') {
        document.getElementById('contracts-tab-templates')?.focus();
      }
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveTab('signing');
      if (typeof document !== 'undefined') {
        document.getElementById('contracts-tab-signing')?.focus();
      }
    }
  };

  const handleNewTemplate = () => {
    setEditingTemplate(null);
    setIsDuplicate(false);
    setIsModalOpen(true);
  };

  const handleEditTemplate = (template: ContractTemplate) => {
    setEditingTemplate(template);
    setIsDuplicate(false);
    setIsModalOpen(true);
  };

  const handleDuplicateTemplate = (template: ContractTemplate) => {
    setEditingTemplate(template);
    setIsDuplicate(true);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingTemplate(null);
    setIsDuplicate(false);
  };

  const handleSaveTemplate = async (data: ContractTemplateFormData): Promise<boolean> => {
    setIsSubmittingTemplate(true);
    try {
      if (data.id) {
        if (!updateContractAction) return false;
        const result = await updateContractAction({ ...data, id: data.id });
        if (result.success) {
          setTemplates((prev) =>
            prev.map((item) => (item.id === result.data.id ? result.data : item)),
          );
          router.refresh();
          return true;
        }
      } else {
        if (!createContractAction) return false;
        const result = await createContractAction(data);
        if (result.success) {
          setTemplates((prev) => [result.data, ...prev]);
          router.refresh();
          return true;
        }
      }
      return false;
    } finally {
      setIsSubmittingTemplate(false);
    }
  };

  const handleArchiveTemplate = async (template: ContractTemplate): Promise<boolean> => {
    if (!archiveContractAction) return false;
    const result = await archiveContractAction({ id: template.id, isActive: false });
    if (result.success) {
      setTemplates((prev) =>
        prev.map((item) => (item.id === template.id ? { ...item, isActive: false } : item)),
      );
      router.refresh();
      return true;
    }
    return false;
  };

  const handleRestoreTemplate = async (template: ContractTemplate): Promise<boolean> => {
    if (!archiveContractAction) return false;
    const result = await archiveContractAction({ id: template.id, isActive: true });
    if (result.success) {
      setTemplates((prev) =>
        prev.map((item) => (item.id === template.id ? { ...item, isActive: true } : item)),
      );
      router.refresh();
      return true;
    }
    return false;
  };

  const handleSaveSigningSettings = async (data: StudioSigningFormData): Promise<boolean> => {
    if (!updateSigningAction) return false;
    const result = await updateSigningAction(data);
    if (result.success) {
      setSigningSettings(result.data);
      router.refresh();
      return true;
    }
    return false;
  };

  const handleTemplatesTabKeyDown = (e: React.KeyboardEvent) => {
    handleTabKeyDown(e, 'templates');
  };
  const handleSigningTabKeyDown = (e: React.KeyboardEvent) => {
    handleTabKeyDown(e, 'signing');
  };

  return {
    handleSelectTemplatesTab,
    handleSelectSigningTab,
    handleTabKeyDown,
    handleTemplatesTabKeyDown,
    handleSigningTabKeyDown,
    handleNewTemplate,
    handleEditTemplate,
    handleDuplicateTemplate,
    handleCloseModal,
    handleSaveTemplate,
    handleArchiveTemplate,
    handleRestoreTemplate,
    handleSaveSigningSettings,
  };
}
