'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertCircle, Landmark } from 'lucide-react';
import {
  studioSettingsToTaxFormData,
  createTaxSettingsHandlers,
  taxSettingsFormReducer,
  TAX_RATE_PRESETS,
  type TaxSettingsFormErrors,
} from './tax-helpers';
import type { StudioSettings } from '@/server/db/schema/studio-settings';

export interface TaxSettingsSectionProps {
  initialSettings: StudioSettings;
  locale?: string;
  onUpdateTaxSettings: (payload: {
    taxNumber?: string | null;
    vatId?: string | null;
    isKleinunternehmer?: boolean;
    kleinunternehmerNotice?: string | null;
    defaultTaxRateBasisPoints?: number;
    pricesIncludeTax?: boolean;
  }) => Promise<boolean>;
  initialSaveStatus?: 'idle' | 'success' | 'error';
  initialErrors?: TaxSettingsFormErrors;
}

export function TaxSettingsSection({
  initialSettings,
  locale = 'en',
  initialSaveStatus = 'idle',
  initialErrors = {},
  onUpdateTaxSettings,
}: TaxSettingsSectionProps) {
  const t = useTranslations('settings.tax');

  const [formData, dispatch] = React.useReducer(taxSettingsFormReducer, initialSettings, (s) =>
    studioSettingsToTaxFormData(s, locale),
  );
  const [errors, setErrors] = React.useState<TaxSettingsFormErrors>(initialErrors);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [saveStatus, setSaveStatus] = React.useState<'idle' | 'success' | 'error'>(
    initialSaveStatus,
  );

  const handlers = createTaxSettingsHandlers({
    dispatch,
    formData,
    errors,
    setErrors,
    setSaveStatus,
    setIsSubmitting,
    onUpdateTaxSettings,
  });

  return (
    <div className="space-y-6 max-w-4xl" data-testid="tax-settings-section">
      {/* Header */}
      <div className="space-y-1 pb-4 border-b">
        <div className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {t('title')}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {saveStatus === 'success' && (
        <div
          data-testid="tax-save-success-banner"
          role="status"
          className="flex items-center gap-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-700 dark:text-emerald-300"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('saveSuccess')}</span>
        </div>
      )}

      {saveStatus === 'error' && (
        <div
          data-testid="tax-settings-save-error"
          role="alert"
          className="flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('saveError')}</span>
        </div>
      )}

      <form noValidate onSubmit={handlers.onSubmit} className="space-y-6">
        {/* Tax IDs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 rounded-lg border bg-card p-5 text-card-foreground shadow-xs">
          <div className="space-y-1.5">
            <label htmlFor="tax-number" className="text-sm font-medium text-foreground">
              {t('taxNumberLabel')}
            </label>
            <input
              id="tax-number"
              name="taxNumber"
              type="text"
              data-testid="tax-number-input"
              value={formData.taxNumber}
              onChange={handlers.handleTaxNumberChange}
              placeholder={t('taxNumberPlaceholder')}
              aria-invalid={Boolean(errors.taxNumber)}
              aria-describedby={errors.taxNumber ? 'tax-number-error' : 'tax-number-help'}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
            />
            {errors.taxNumber ? (
              <p id="tax-number-error" role="alert" className="text-xs text-destructive">
                {errors.taxNumber}
              </p>
            ) : (
              <p id="tax-number-help" className="text-xs text-muted-foreground">
                {t('taxNumberHelp')}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="vat-id" className="text-sm font-medium text-foreground">
              {t('vatIdLabel')}
            </label>
            <input
              id="vat-id"
              name="vatId"
              type="text"
              data-testid="vat-id-input"
              value={formData.vatId}
              onChange={handlers.handleVatIdChange}
              placeholder={t('vatIdPlaceholder')}
              aria-invalid={Boolean(errors.vatId)}
              aria-describedby={errors.vatId ? 'vat-id-error' : 'vat-id-help'}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
            />
            {errors.vatId ? (
              <p id="vat-id-error" role="alert" className="text-xs text-destructive">
                {errors.vatId}
              </p>
            ) : (
              <p id="vat-id-help" className="text-xs text-muted-foreground">
                {t('vatIdHelp')}
              </p>
            )}
          </div>
        </div>

        {/* §19 UStG Kleinunternehmer Card */}
        <div className="rounded-lg border bg-card p-5 text-card-foreground shadow-xs space-y-4">
          <div className="flex items-start gap-3">
            <input
              id="kleinunternehmer-toggle"
              name="isKleinunternehmer"
              type="checkbox"
              data-testid="toggle-kleinunternehmer"
              checked={formData.isKleinunternehmer}
              onChange={handlers.handleKleinunternehmerToggle}
              className="h-5 w-5 mt-0.5 rounded border-input text-primary focus:ring-primary shrink-0"
            />
            <div className="space-y-1">
              <label
                htmlFor="kleinunternehmer-toggle"
                className="text-sm font-semibold text-foreground cursor-pointer"
              >
                {t('kleinunternehmerToggleLabel')}
              </label>
              <p className="text-xs text-muted-foreground">{t('kleinunternehmerHelp')}</p>
            </div>
          </div>

          {formData.isKleinunternehmer && (
            <div className="pt-3 border-t space-y-2 pl-8">
              <label
                htmlFor="statutory-notice"
                className="text-xs font-semibold text-foreground block"
              >
                {t('statutoryNoticeLabel')}
              </label>
              <textarea
                id="statutory-notice"
                name="kleinunternehmerNotice"
                rows={2}
                data-testid="kleinunternehmer-notice-textarea"
                value={formData.kleinunternehmerNotice}
                onChange={handlers.handleNoticeChange}
                placeholder={t('statutoryNoticePlaceholder')}
                aria-describedby="statutory-notice-help"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p id="statutory-notice-help" className="text-[11px] text-muted-foreground">
                {t('statutoryNoticeHelp')}
              </p>
            </div>
          )}
        </div>

        {/* VAT Rate & Gross/Net Display Preference */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 rounded-lg border bg-card p-5 text-card-foreground shadow-xs">
          {/* Default VAT Rate */}
          <div className="space-y-1.5">
            <label htmlFor="default-tax-rate" className="text-sm font-medium text-foreground">
              {t('defaultTaxRateLabel')}
            </label>
            <div className="flex gap-2">
              <select
                id="default-tax-rate"
                name="defaultTaxRate"
                data-testid="default-tax-rate-select"
                value={formData.taxRateSelection}
                onChange={handlers.handleTaxRateSelectionChange}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
              >
                {TAX_RATE_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {t(preset.labelKey)}
                  </option>
                ))}
                <option value="custom">Custom Tax Rate</option>
              </select>

              {formData.taxRateSelection === 'custom' && (
                <input
                  id="default-tax-rate-custom"
                  name="customTaxRate"
                  type="text"
                  inputMode="decimal"
                  aria-label="Custom VAT rate percentage"
                  data-testid="default-custom-tax-input"
                  value={formData.customTaxRatePercent}
                  onChange={handlers.handleCustomTaxRateChange}
                  placeholder="%"
                  className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
                />
              )}
            </div>
            {errors.defaultTaxRate ? (
              <p id="tax-rate-error" role="alert" className="text-xs text-destructive">
                {errors.defaultTaxRate}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('defaultTaxRateHelp')}</p>
            )}
          </div>

          {/* Pricing Display Mode */}
          <div className="space-y-2">
            <span className="text-sm font-medium text-foreground block">
              {t('pricingDisplayModeLabel')}
            </span>
            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2.5 text-xs text-foreground cursor-pointer select-none">
                <input
                  type="radio"
                  name="pricingDisplayMode"
                  value="gross"
                  data-testid="pricing-mode-gross"
                  checked={formData.pricesIncludeTax}
                  onChange={handlers.handlePricingModeChange}
                  className="h-4 w-4 border-input text-primary focus:ring-primary"
                />
                <span>{t('displayGross')}</span>
              </label>
              <label className="flex items-center gap-2.5 text-xs text-foreground cursor-pointer select-none">
                <input
                  type="radio"
                  name="pricingDisplayMode"
                  value="net"
                  data-testid="pricing-mode-net"
                  checked={!formData.pricesIncludeTax}
                  onChange={handlers.handlePricingModeChange}
                  className="h-4 w-4 border-input text-primary focus:ring-primary"
                />
                <span>{t('displayNet')}</span>
              </label>
            </div>
            <p className="text-xs text-muted-foreground pt-1">{t('pricingDisplayModeHelp')}</p>
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end pt-2">
          <Button
            type="submit"
            disabled={isSubmitting}
            data-testid="save-tax-settings-btn"
            className="bg-primary text-primary-foreground hover:bg-primary/90 min-h-[36px] px-6 shadow-sm"
          >
            {isSubmitting ? t('savingButton') : t('saveButton')}
          </Button>
        </div>
      </form>
    </div>
  );
}
