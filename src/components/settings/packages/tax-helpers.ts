import type { StudioSettings } from '@/server/db/schema/studio-settings';
import { DEFAULT_KLEINUNTERNEHMER_NOTICES } from '@/server/studio/tax-settings-schema';

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
export function validateTaxSettingsForm(data: TaxSettingsFormData): {
  isValid: boolean;
  errors: TaxSettingsFormErrors;
} {
  const errors: TaxSettingsFormErrors = {};

  if (data.taxNumber && data.taxNumber.trim().length > 50) {
    errors.taxNumber = 'Tax number cannot exceed 50 characters';
  }

  if (data.vatId && data.vatId.trim().length > 50) {
    errors.vatId = 'VAT ID cannot exceed 50 characters';
  }

  if (
    typeof data.defaultTaxRateBasisPoints !== 'number' ||
    !Number.isInteger(data.defaultTaxRateBasisPoints) ||
    data.defaultTaxRateBasisPoints < 0 ||
    data.defaultTaxRateBasisPoints > 10000
  ) {
    errors.defaultTaxRate = 'Default tax rate must be between 0% and 100%';
  }

  if (
    data.isKleinunternehmer &&
    data.kleinunternehmerNotice &&
    data.kleinunternehmerNotice.length > 1000
  ) {
    errors.kleinunternehmerNotice = 'Notice text cannot exceed 1000 characters';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}
