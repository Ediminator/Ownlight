'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { upsertAddressAction } from '@/server/clients/actions';
import { getLocalizedCountries, type CountryCode } from '@/lib/countries';
import { getClientErrorMessage } from '@/lib/client-errors';
import type { ClientAddress, AddressType } from '@/server/db/schema/clients';

export interface AddressDialogProps {
  clientId: string;
  locale: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  addressToEdit?: ClientAddress | null;
  defaultType?: AddressType;
  triggerRef?: React.RefObject<HTMLElement | null>;
  onSuccess: () => void;
}

interface AddressFormProps {
  clientId: string;
  locale: string;
  addressToEdit?: ClientAddress | null;
  defaultType: AddressType;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddressForm({
  clientId,
  locale,
  addressToEdit,
  defaultType,
  onClose,
  onSuccess,
}: AddressFormProps) {
  const isEditing = Boolean(addressToEdit);
  const t = useTranslations('clients.form');
  const tErrors = useTranslations('clients.errors');

  const countries = React.useMemo(() => getLocalizedCountries(locale), [locale]);

  const [type, setType] = React.useState<AddressType>(addressToEdit?.type ?? defaultType);
  const [line1, setLine1] = React.useState(addressToEdit?.line1 ?? '');
  const [line2, setLine2] = React.useState(addressToEdit?.line2 ?? '');
  const [postalCode, setPostalCode] = React.useState(addressToEdit?.postalCode ?? '');
  const [city, setCity] = React.useState(addressToEdit?.city ?? '');
  const [region, setRegion] = React.useState(addressToEdit?.region ?? '');
  const [countryCode, setCountryCode] = React.useState<CountryCode | ''>(
    (addressToEdit?.countryCode as CountryCode | undefined) ?? 'DE',
  );

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedLine1 = line1.trim();
    const trimmedPostal = postalCode.trim();
    const trimmedCity = city.trim();

    const errors: Record<string, string> = {};
    if (trimmedLine1.length === 0) {
      errors.line1 = tErrors('line1Required');
    }
    if (trimmedPostal.length === 0) {
      errors.postalCode = tErrors('postalCodeRequired');
    }
    if (trimmedCity.length === 0) {
      errors.city = tErrors('cityRequired');
    }
    if (!countryCode) {
      errors.country = tErrors('countryRequired');
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setFieldErrors({});

    try {
      const res = await upsertAddressAction({
        clientId,
        type,
        line1: trimmedLine1,
        line2: line2.trim().length > 0 ? line2.trim() : null,
        postalCode: trimmedPostal,
        city: trimmedCity,
        region: region.trim().length > 0 ? region.trim() : null,
        countryCode,
      });

      if (!res.success) {
        setErrorMessage(getClientErrorMessage(res.code, tErrors));
        return;
      }

      onSuccess();
      onClose();
    } catch {
      setErrorMessage(tErrors('GENERIC_ERROR'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      className="space-y-4"
    >
      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm font-medium flex items-center gap-2"
          data-testid="address-error"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Address Type Selection */}
      <div className="space-y-1.5">
        <label htmlFor="address-type-select" className="block text-sm font-medium text-foreground">
          {t('addressTypeLabel')}
        </label>
        <select
          id="address-type-select"
          name="type"
          value={type}
          disabled={isEditing}
          onChange={(e) => {
            setType(e.target.value as AddressType);
          }}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="address-type-select"
        >
          <option value="postal">{t('addressTypePostal')}</option>
          <option value="billing">{t('addressTypeBilling')}</option>
        </select>
      </div>

      {/* Line 1 */}
      <div className="space-y-1.5">
        <label htmlFor="address-line1" className="block text-sm font-medium text-foreground">
          {t('line1Label')} <span className="text-destructive">*</span>
        </label>
        <input
          id="address-line1"
          name="line1"
          type="text"
          required
          value={line1}
          onChange={(e) => {
            setLine1(e.target.value);
          }}
          placeholder={t('line1Placeholder')}
          aria-invalid={Boolean(fieldErrors.line1)}
          aria-describedby={fieldErrors.line1 ? 'address-line1-error' : undefined}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="address-line1-input"
        />
        {fieldErrors.line1 && (
          <p
            id="address-line1-error"
            className="text-sm text-destructive font-medium"
            data-testid="address-line1-error"
          >
            {fieldErrors.line1}
          </p>
        )}
      </div>

      {/* Line 2 */}
      <div className="space-y-1.5">
        <label htmlFor="address-line2" className="block text-sm font-medium text-foreground">
          {t('line2Label')}
        </label>
        <input
          id="address-line2"
          name="line2"
          type="text"
          value={line2}
          onChange={(e) => {
            setLine2(e.target.value);
          }}
          placeholder={t('line2Placeholder')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="address-line2-input"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Postal Code */}
        <div className="space-y-1.5">
          <label htmlFor="address-postalCode" className="block text-sm font-medium text-foreground">
            {t('postalCodeLabel')} <span className="text-destructive">*</span>
          </label>
          <input
            id="address-postalCode"
            name="postalCode"
            type="text"
            required
            value={postalCode}
            onChange={(e) => {
              setPostalCode(e.target.value);
            }}
            placeholder={t('postalCodePlaceholder')}
            aria-invalid={Boolean(fieldErrors.postalCode)}
            aria-describedby={fieldErrors.postalCode ? 'address-postal-error' : undefined}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
            data-testid="address-postal-code-input"
          />
          {fieldErrors.postalCode && (
            <p
              id="address-postal-error"
              className="text-sm text-destructive font-medium"
              data-testid="address-postal-error"
            >
              {fieldErrors.postalCode}
            </p>
          )}
        </div>

        {/* City */}
        <div className="space-y-1.5">
          <label htmlFor="address-city" className="block text-sm font-medium text-foreground">
            {t('cityLabel')} <span className="text-destructive">*</span>
          </label>
          <input
            id="address-city"
            name="city"
            type="text"
            required
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
            }}
            placeholder={t('cityPlaceholder')}
            aria-invalid={Boolean(fieldErrors.city)}
            aria-describedby={fieldErrors.city ? 'address-city-error' : undefined}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
            data-testid="address-city-input"
          />
          {fieldErrors.city && (
            <p
              id="address-city-error"
              className="text-sm text-destructive font-medium"
              data-testid="address-city-error"
            >
              {fieldErrors.city}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Region / State */}
        <div className="space-y-1.5">
          <label htmlFor="address-region" className="block text-sm font-medium text-foreground">
            {t('regionLabel')}
          </label>
          <input
            id="address-region"
            name="region"
            type="text"
            value={region}
            onChange={(e) => {
              setRegion(e.target.value);
            }}
            placeholder={t('regionPlaceholder')}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
            data-testid="address-region-input"
          />
        </div>

        {/* Country (ISO 3166-1 alpha-2 select) */}
        <div className="space-y-1.5">
          <label
            htmlFor="address-countryCode"
            className="block text-sm font-medium text-foreground"
          >
            {t('countryLabel')} <span className="text-destructive">*</span>
          </label>
          <select
            id="address-countryCode"
            name="countryCode"
            value={countryCode}
            onChange={(e) => {
              setCountryCode(e.target.value as CountryCode);
            }}
            aria-invalid={Boolean(fieldErrors.country)}
            aria-describedby={fieldErrors.country ? 'address-country-error' : undefined}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
            data-testid="address-country-select"
          >
            <option value="">{t('selectCountry')}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          {fieldErrors.country && (
            <p
              id="address-country-error"
              className="text-sm text-destructive font-medium"
              data-testid="address-country-error"
            >
              {fieldErrors.country}
            </p>
          )}
        </div>
      </div>

      <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="cancel-address-btn"
        >
          {t('cancel')}
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="save-address-btn"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
              <span>{t('saving')}</span>
            </>
          ) : (
            <span>{t('save')}</span>
          )}
        </button>
      </DialogFooter>
    </form>
  );
}

export function AddressDialog({
  clientId,
  locale,
  isOpen,
  onOpenChange,
  addressToEdit,
  defaultType = 'postal',
  triggerRef,
  onSuccess,
}: AddressDialogProps) {
  const isEditing = Boolean(addressToEdit);
  const t = useTranslations('clients.form');

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto sm:rounded-lg"
        data-testid="address-dialog"
        onCloseAutoFocus={(e) => {
          if (triggerRef?.current) {
            e.preventDefault();
            triggerRef.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{isEditing ? t('editAddressTitle') : t('addAddressTitle')}</DialogTitle>
          <DialogDescription>
            {isEditing ? t('editAddressDescription') : t('addAddressDescription')}
          </DialogDescription>
        </DialogHeader>

        {isOpen && (
          <AddressForm
            key={addressToEdit?.id ?? defaultType}
            clientId={clientId}
            locale={locale}
            addressToEdit={addressToEdit}
            defaultType={defaultType}
            onClose={() => {
              onOpenChange(false);
            }}
            onSuccess={onSuccess}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
