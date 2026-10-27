import type { StudioSettings } from '@/server/db/schema/studio-settings';
import { DEFAULT_KLEINUNTERNEHMER_NOTICES } from '@/server/studio/tax-settings-schema';
import { parseTaxRateToBasisPoints } from './packages-helpers';

export interface TaxSettingsFormData {
  taxNumber: string;
  vatId: string;
  isKleinunternehmer: boolean;
  kleinunternehmerNotice: string;
  defaultTaxRateBasisPoints: number;
  taxRateSelection: '1900' | '700' | '0' | 'custom';
  customTaxRatePercent: string;
  pricesIncludeTax: boolean;
}

export interface TaxSettingsFormErrors {
  taxNumber?: string;
  vatId?: string;
  defaultTaxRate?: string;
  kleinunternehmerNotice?: string;
  general?: string;
}

export const TAX_RATE_PRESETS = [
  { value: '1900', bps: 1900, labelKey: 'rates.standard' },
  { value: '700', bps: 700, labelKey: 'rates.reduced' },
  { value: '0', bps: 0, labelKey: 'rates.zero' },
] as const;

/**
 * Maps a StudioSettings DB row to component form state.
 */
export function studioSettingsToTaxFormData(
  settings: StudioSettings,
  locale = 'en',
): TaxSettingsFormData {
  const currentBps = settings.default_tax_rate_basis_points;
  let selection: '1900' | '700' | '0' | 'custom' = 'custom';
  if (currentBps === 1900) selection = '1900';
  else if (currentBps === 700) selection = '700';
  else if (currentBps === 0) selection = '0';

  const defaultNotice =
    locale === 'de' ? DEFAULT_KLEINUNTERNEHMER_NOTICES.de : DEFAULT_KLEINUNTERNEHMER_NOTICES.en;

  const customNotice = settings.kleinunternehmer_notice?.trim();
  const notice = customNotice && customNotice.length > 0 ? customNotice : defaultNotice;

  return {
    taxNumber: settings.tax_number ?? '',
    vatId: settings.vat_id ?? '',
    isKleinunternehmer: settings.is_kleinunternehmer,
    kleinunternehmerNotice: notice,
    defaultTaxRateBasisPoints: currentBps,
    taxRateSelection: selection,
    customTaxRatePercent: (currentBps / 100).toString(),
    pricesIncludeTax: settings.prices_include_tax,
  };
}

/**
 * Validates tax settings form data before submitting to server action.
 */
export function validateTaxSettingsForm(
  data: TaxSettingsFormData,
  t?: (key: string) => string,
): {
  isValid: boolean;
  errors: TaxSettingsFormErrors;
} {
  const errors: TaxSettingsFormErrors = {};

  if (data.taxNumber && data.taxNumber.trim().length > 50) {
    errors.taxNumber = t ? t('errors.taxNumberTooLong') : 'Tax number cannot exceed 50 characters';
  }

  if (data.vatId && data.vatId.trim().length > 50) {
    errors.vatId = t ? t('errors.vatIdTooLong') : 'VAT ID cannot exceed 50 characters';
  }

  if (
    typeof data.defaultTaxRateBasisPoints !== 'number' ||
    !Number.isInteger(data.defaultTaxRateBasisPoints) ||
    data.defaultTaxRateBasisPoints < 0 ||
    data.defaultTaxRateBasisPoints > 10000
  ) {
    errors.defaultTaxRate = t
      ? t('errors.defaultTaxRateInvalid')
      : 'Default tax rate must be between 0% and 100%';
  }

  if (
    data.isKleinunternehmer &&
    data.kleinunternehmerNotice &&
    data.kleinunternehmerNotice.length > 1000
  ) {
    errors.kleinunternehmerNotice = t
      ? t('errors.noticeTooLong')
      : 'Notice text cannot exceed 1000 characters';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export type TaxSettingsFormAction =
  | { type: 'SET_TAX_NUMBER'; taxNumber: string }
  | { type: 'SET_VAT_ID'; vatId: string }
  | { type: 'TOGGLE_KLEINUNTERNEHMER'; isKleinunternehmer: boolean }
  | { type: 'SET_NOTICE'; notice: string }
  | { type: 'SET_RATE_PRESET'; selection: '1900' | '700' | '0' | 'custom' }
  | { type: 'SET_CUSTOM_RATE'; percent: string }
  | { type: 'TOGGLE_PRICES_INCLUDE_TAX'; pricesIncludeTax: boolean }
  | { type: 'RESET'; settings: StudioSettings; locale: string };

export function taxSettingsFormReducer(
  state: TaxSettingsFormData,
  action: TaxSettingsFormAction,
): TaxSettingsFormData {
  switch (action.type) {
    case 'SET_TAX_NUMBER':
      return { ...state, taxNumber: action.taxNumber };
    case 'SET_VAT_ID':
      return { ...state, vatId: action.vatId };
    case 'TOGGLE_KLEINUNTERNEHMER':
      return { ...state, isKleinunternehmer: action.isKleinunternehmer };
    case 'SET_NOTICE':
      return { ...state, kleinunternehmerNotice: action.notice };
    case 'SET_RATE_PRESET': {
      if (action.selection === 'custom') {
        return {
          ...state,
          taxRateSelection: 'custom',
          defaultTaxRateBasisPoints: 1900,
          customTaxRatePercent: '19',
        };
      }
      const bps = parseInt(action.selection, 10);
      return {
        ...state,
        taxRateSelection: action.selection,
        defaultTaxRateBasisPoints: bps,
        customTaxRatePercent: (bps / 100).toString(),
      };
    }
    case 'SET_CUSTOM_RATE': {
      const bps = parseTaxRateToBasisPoints(action.percent);
      return {
        ...state,
        customTaxRatePercent: action.percent,
        defaultTaxRateBasisPoints: bps ?? -1,
      };
    }
    case 'TOGGLE_PRICES_INCLUDE_TAX':
      return { ...state, pricesIncludeTax: action.pricesIncludeTax };
    case 'RESET':
      return studioSettingsToTaxFormData(action.settings, action.locale);
    default:
      return state;
  }
}

export function buildTaxSettingsSavePayload(formData: TaxSettingsFormData) {
  return {
    taxNumber: formData.taxNumber.trim() ? formData.taxNumber.trim() : null,
    vatId: formData.vatId.trim() ? formData.vatId.trim() : null,
    isKleinunternehmer: formData.isKleinunternehmer,
    kleinunternehmerNotice: formData.isKleinunternehmer
      ? formData.kleinunternehmerNotice.trim()
      : null,
    defaultTaxRateBasisPoints: formData.defaultTaxRateBasisPoints,
    pricesIncludeTax: formData.pricesIncludeTax,
  };
}

export function createTaxSettingsHandlers(params: {
  dispatch: (action: TaxSettingsFormAction) => void;
  formData: TaxSettingsFormData;
  errors: TaxSettingsFormErrors;
  setErrors: (
    updater: TaxSettingsFormErrors | ((prev: TaxSettingsFormErrors) => TaxSettingsFormErrors),
  ) => void;
  setSaveStatus: (status: 'idle' | 'success' | 'error') => void;
  setIsSubmitting: (submitting: boolean) => void;
  onUpdateTaxSettings: (
    payload: ReturnType<typeof buildTaxSettingsSavePayload>,
  ) => Promise<boolean>;
  t?: (key: string) => string;
}) {
  return {
    handleTaxNumberChange: (e: { target: { value: string } }) => {
      params.dispatch({ type: 'SET_TAX_NUMBER', taxNumber: e.target.value });
      if (params.errors.taxNumber) {
        params.setErrors((prev) => ({ ...prev, taxNumber: undefined }));
      }
      params.setSaveStatus('idle');
    },
    handleVatIdChange: (e: { target: { value: string } }) => {
      params.dispatch({ type: 'SET_VAT_ID', vatId: e.target.value });
      if (params.errors.vatId) {
        params.setErrors((prev) => ({ ...prev, vatId: undefined }));
      }
      params.setSaveStatus('idle');
    },
    handleKleinunternehmerToggle: (e: { target: { checked: boolean } }) => {
      params.dispatch({
        type: 'TOGGLE_KLEINUNTERNEHMER',
        isKleinunternehmer: e.target.checked,
      });
      params.setSaveStatus('idle');
    },
    handleNoticeChange: (e: { target: { value: string } }) => {
      params.dispatch({ type: 'SET_NOTICE', notice: e.target.value });
      if (params.errors.kleinunternehmerNotice) {
        params.setErrors((prev) => ({ ...prev, kleinunternehmerNotice: undefined }));
      }
      params.setSaveStatus('idle');
    },
    handleTaxRateSelectionChange: (e: { target: { value: string } }) => {
      params.dispatch({
        type: 'SET_RATE_PRESET',
        selection: e.target.value as '1900' | '700' | '0' | 'custom',
      });
      if (params.errors.defaultTaxRate) {
        params.setErrors((prev) => ({ ...prev, defaultTaxRate: undefined }));
      }
      params.setSaveStatus('idle');
    },
    handleCustomTaxRateChange: (e: { target: { value: string } }) => {
      params.dispatch({ type: 'SET_CUSTOM_RATE', percent: e.target.value });
      if (params.errors.defaultTaxRate) {
        params.setErrors((prev) => ({ ...prev, defaultTaxRate: undefined }));
      }
      params.setSaveStatus('idle');
    },
    handlePricingModeChange: (e: { target: { value: string } }) => {
      params.dispatch({
        type: 'TOGGLE_PRICES_INCLUDE_TAX',
        pricesIncludeTax: e.target.value === 'gross',
      });
      params.setSaveStatus('idle');
    },
    handleSubmit: async (e?: { preventDefault: () => void }) => {
      e?.preventDefault();
      const validation = validateTaxSettingsForm(params.formData, params.t);
      if (!validation.isValid) {
        params.setErrors(validation.errors);
        return false;
      }
      params.setIsSubmitting(true);
      params.setSaveStatus('idle');
      try {
        const payload = buildTaxSettingsSavePayload(params.formData);
        const ok = await params.onUpdateTaxSettings(payload);
        params.setSaveStatus(ok ? 'success' : 'error');
        return ok;
      } catch {
        params.setSaveStatus('error');
        return false;
      } finally {
        params.setIsSubmitting(false);
      }
    },
    onSubmit: (e?: { preventDefault: () => void }) => {
      e?.preventDefault();
      void (async () => {
        const validation = validateTaxSettingsForm(params.formData, params.t);
        if (!validation.isValid) {
          params.setErrors(validation.errors);
          return;
        }
        params.setIsSubmitting(true);
        params.setSaveStatus('idle');
        try {
          const payload = buildTaxSettingsSavePayload(params.formData);
          const ok = await params.onUpdateTaxSettings(payload);
          params.setSaveStatus(ok ? 'success' : 'error');
        } catch {
          params.setSaveStatus('error');
        } finally {
          params.setIsSubmitting(false);
        }
      })();
    },
  };
}
