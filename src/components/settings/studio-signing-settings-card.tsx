'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { CheckCircle2, ShieldCheck, Building, PenTool } from 'lucide-react';
import {
  createStudioSigningController,
  initialSigningFormDataFromSettings,
  type StudioSigningFormData,
  type StudioSigningFormErrors,
} from './contracts-helpers';
import type { StudioSettings } from '@/server/db/schema/studio-settings';

export interface StudioSigningSettingsCardProps {
  initialSettings: StudioSettings;
  onSave: (payload: StudioSigningFormData) => Promise<boolean>;
  initialShowSuccess?: boolean;
  initialErrors?: StudioSigningFormErrors;
}

export function StudioSigningSettingsCard({
  initialSettings,
  onSave,
  initialShowSuccess = false,
  initialErrors = {},
}: StudioSigningSettingsCardProps) {
  const t = useTranslations('settings.contracts');

  const [formData, setFormData] = React.useState<StudioSigningFormData>(() =>
    initialSigningFormDataFromSettings(initialSettings),
  );
  const [errors, setErrors] = React.useState<StudioSigningFormErrors>(initialErrors);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [showSuccess, setShowSuccess] = React.useState(initialShowSuccess);

  const controller = createStudioSigningController({
    formData,
    setFormData,
    setErrors,
    setIsSubmitting,
    setShowSuccess,
    onSave,
    t,
  });

  return (
    <div
      data-testid="studio-signing-settings-card"
      className="rounded-lg border bg-card p-4 sm:p-6 text-card-foreground shadow-sm space-y-6"
    >
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {t('signing.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('signing.description')}</p>
      </div>

      {/* Success Notification Banner */}
      {showSuccess && (
        <div
          role="status"
          data-testid="signing-success-notification"
          className="flex items-center gap-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-800 dark:text-emerald-300"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{t('signing.successNotification')}</span>
        </div>
      )}

      <form onSubmit={controller.handleSubmit} className="space-y-6">
        {/* Section 1: Legal Signatory Profile */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b pb-2">
            <PenTool className="h-4 w-4 text-primary" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-foreground">
              {t('signing.signatorySectionTitle')}
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Signatory Name */}
            <div>
              <label
                htmlFor="signing-signatory-name-input"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t('signing.signatoryNameLabel')}
              </label>
              <input
                id="signing-signatory-name-input"
                type="text"
                data-testid="signing-signatory-name-input"
                value={formData.contractSignatoryName}
                onChange={controller.handleSignatoryNameChange}
                placeholder={t('signing.signatoryNamePlaceholder')}
                aria-invalid={Boolean(errors.contractSignatoryName)}
                aria-describedby={
                  errors.contractSignatoryName ? 'signatory-name-error' : 'signatory-name-help'
                }
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px]"
              />
              {errors.contractSignatoryName ? (
                <p id="signatory-name-error" role="alert" className="text-xs text-destructive mt-1">
                  {errors.contractSignatoryName}
                </p>
              ) : (
                <p id="signatory-name-help" className="text-xs text-muted-foreground mt-1">
                  {t('signing.signatoryNameHelp')}
                </p>
              )}
            </div>

            {/* Signatory Title */}
            <div>
              <label
                htmlFor="signing-signatory-title-input"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t('signing.signatoryTitleLabel')}
              </label>
              <input
                id="signing-signatory-title-input"
                type="text"
                data-testid="signing-signatory-title-input"
                value={formData.contractSignatoryTitle}
                onChange={controller.handleSignatoryTitleChange}
                placeholder={t('signing.signatoryTitlePlaceholder')}
                aria-invalid={Boolean(errors.contractSignatoryTitle)}
                aria-describedby={
                  errors.contractSignatoryTitle ? 'signatory-title-error' : 'signatory-title-help'
                }
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px]"
              />
              {errors.contractSignatoryTitle ? (
                <p
                  id="signatory-title-error"
                  role="alert"
                  className="text-xs text-destructive mt-1"
                >
                  {errors.contractSignatoryTitle}
                </p>
              ) : (
                <p id="signatory-title-help" className="text-xs text-muted-foreground mt-1">
                  {t('signing.signatoryTitleHelp')}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Section 2: Countersignature Mode */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b pb-2">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-foreground">
              {t('signing.modeSectionTitle')}
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">{t('signing.modeSectionHelp')}</p>

          <fieldset
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            aria-label={t('signing.modeSectionTitle')}
          >
            {/* Automatic (Pre-signed) */}
            <div
              className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                formData.contractCountersignatureMode === 'pre_signed'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-input hover:bg-muted/40'
              }`}
            >
              <input
                type="radio"
                id="mode-presigned"
                name="countersignatureMode"
                value="pre_signed"
                data-testid="countersignature-mode-presigned"
                checked={formData.contractCountersignatureMode === 'pre_signed'}
                onChange={controller.handleSelectPreSigned}
                className="mt-0.5 h-4 w-4 border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
              />
              <label htmlFor="mode-presigned" className="text-sm cursor-pointer select-none">
                <span className="font-medium text-foreground block">
                  {t('signing.modes.preSigned.label')}
                </span>
                <span className="text-xs text-muted-foreground block mt-0.5">
                  {t('signing.modes.preSigned.description')}
                </span>
              </label>
            </div>

            {/* Explicit Manual Countersignature */}
            <div
              className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                formData.contractCountersignatureMode === 'explicit'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-input hover:bg-muted/40'
              }`}
            >
              <input
                type="radio"
                id="mode-explicit"
                name="countersignatureMode"
                value="explicit"
                data-testid="countersignature-mode-explicit"
                checked={formData.contractCountersignatureMode === 'explicit'}
                onChange={controller.handleSelectExplicit}
                className="mt-0.5 h-4 w-4 border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
              />
              <label htmlFor="mode-explicit" className="text-sm cursor-pointer select-none">
                <span className="font-medium text-foreground block">
                  {t('signing.modes.explicit.label')}
                </span>
                <span className="text-xs text-muted-foreground block mt-0.5">
                  {t('signing.modes.explicit.description')}
                </span>
              </label>
            </div>
          </fieldset>
        </div>

        {/* Section 3: Physical Studio Address & Statutory Notices */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b pb-2">
            <Building className="h-4 w-4 text-primary" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-foreground">
              {t('signing.addressSectionTitle')}
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">{t('signing.addressSectionHelp')}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Address Line 1 */}
            <div>
              <label
                htmlFor="signing-address-line1-input"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t('signing.addressLine1Label')}
              </label>
              <input
                id="signing-address-line1-input"
                type="text"
                data-testid="signing-address-line1-input"
                value={formData.studioAddressLine1}
                onChange={controller.handleAddressLine1Change}
                placeholder={t('signing.addressLine1Placeholder')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px]"
              />
            </div>

            {/* Address Line 2 */}
            <div>
              <label
                htmlFor="signing-address-line2-input"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t('signing.addressLine2Label')}
              </label>
              <input
                id="signing-address-line2-input"
                type="text"
                data-testid="signing-address-line2-input"
                value={formData.studioAddressLine2}
                onChange={controller.handleAddressLine2Change}
                placeholder={t('signing.addressLine2Placeholder')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px]"
              />
            </div>

            {/* Postal Code */}
            <div>
              <label
                htmlFor="signing-postal-code-input"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t('signing.postalCodeLabel')}
              </label>
              <input
                id="signing-postal-code-input"
                type="text"
                data-testid="signing-postal-code-input"
                value={formData.studioPostalCode}
                onChange={controller.handlePostalCodeChange}
                placeholder={t('signing.postalCodePlaceholder')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px]"
              />
            </div>

            {/* City */}
            <div>
              <label
                htmlFor="signing-city-input"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t('signing.cityLabel')}
              </label>
              <input
                id="signing-city-input"
                type="text"
                data-testid="signing-city-input"
                value={formData.studioCity}
                onChange={controller.handleCityChange}
                placeholder={t('signing.cityPlaceholder')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px]"
              />
            </div>

            {/* Country Code */}
            <div>
              <label
                htmlFor="signing-country-code-input"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t('signing.countryCodeLabel')}
              </label>
              <input
                id="signing-country-code-input"
                type="text"
                maxLength={2}
                data-testid="signing-country-code-input"
                value={formData.studioCountryCode}
                onChange={controller.handleCountryCodeChange}
                placeholder={t('signing.countryCodePlaceholder')}
                aria-invalid={Boolean(errors.studioCountryCode)}
                aria-describedby={errors.studioCountryCode ? 'country-code-error' : undefined}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono uppercase text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px]"
              />
              {errors.studioCountryCode && (
                <p id="country-code-error" role="alert" className="text-xs text-destructive mt-1">
                  {errors.studioCountryCode}
                </p>
              )}
            </div>

            {/* Phone */}
            <div>
              <label
                htmlFor="signing-phone-input"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t('signing.phoneLabel')}
              </label>
              <input
                id="signing-phone-input"
                type="text"
                data-testid="signing-phone-input"
                value={formData.studioPhone}
                onChange={controller.handlePhoneChange}
                placeholder={t('signing.phonePlaceholder')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px]"
              />
            </div>

            {/* Email */}
            <div className="sm:col-span-2">
              <label
                htmlFor="signing-email-input"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t('signing.emailLabel')}
              </label>
              <input
                id="signing-email-input"
                type="email"
                data-testid="signing-email-input"
                value={formData.studioEmail}
                onChange={controller.handleEmailChange}
                placeholder={t('signing.emailPlaceholder')}
                aria-invalid={Boolean(errors.studioEmail)}
                aria-describedby={errors.studioEmail ? 'signing-email-error' : undefined}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px]"
              />
              {errors.studioEmail && (
                <p id="signing-email-error" role="alert" className="text-xs text-destructive mt-1">
                  {errors.studioEmail}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div className="pt-4 border-t flex justify-end">
          <Button
            type="submit"
            data-testid="save-signing-settings-btn"
            disabled={isSubmitting}
            className="w-full sm:w-auto bg-primary text-primary-foreground min-h-[38px] shadow-sm"
          >
            {isSubmitting ? t('signing.savingButton') : t('signing.saveButton')}
          </Button>
        </div>
      </form>
    </div>
  );
}
