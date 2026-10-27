'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  catalogueItemToFormData,
  validateCatalogueItemForm,
  type CatalogueItemFormData,
  type CatalogueItemFormErrors,
} from './catalogue-helpers';
import { computeSlugFromTitle, parseTaxRateToBasisPoints } from './packages-helpers';
import { convertPriceMajorToMinor } from '@/lib/currency';
import type { CatalogueCategory, CatalogueItem } from '@/server/db/schema/packages';

export interface CatalogueItemModalProps {
  item: CatalogueItem | null;
  isOpen: boolean;
  isSubmitting: boolean;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSave: (payload: {
    id?: string;
    name: string;
    slug: string;
    category: CatalogueCategory;
    unitPriceMinor: number;
    taxRateBasisPoints: number;
    description: string | null;
    isActive: boolean;
  }) => Promise<boolean>;
}

const CATEGORY_OPTIONS: {
  value: CatalogueCategory;
  labelKey:
    | 'catalogue.categories.service'
    | 'catalogue.categories.product'
    | 'catalogue.categories.travel'
    | 'catalogue.categories.licensing';
}[] = [
  { value: 'service', labelKey: 'catalogue.categories.service' },
  { value: 'product', labelKey: 'catalogue.categories.product' },
  { value: 'travel', labelKey: 'catalogue.categories.travel' },
  { value: 'licensing', labelKey: 'catalogue.categories.licensing' },
];

export function CatalogueItemModal({
  item,
  isOpen,
  isSubmitting,
  triggerRef,
  onClose,
  onSave,
}: CatalogueItemModalProps) {
  const t = useTranslations('settings.packages');
  const [formData, setFormData] = React.useState<CatalogueItemFormData>(() =>
    catalogueItemToFormData(item),
  );
  const [errors, setErrors] = React.useState<CatalogueItemFormErrors>({});
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = React.useState(Boolean(item?.slug));

  const [prevItem, setPrevItem] = React.useState(item);
  const [prevIsOpen, setPrevIsOpen] = React.useState(isOpen);

  if (item !== prevItem || isOpen !== prevIsOpen) {
    setPrevItem(item);
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setFormData(catalogueItemToFormData(item));
      setErrors({});
      setIsSlugManuallyEdited(Boolean(item?.slug));
    }
  }

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    const computedSlug = computeSlugFromTitle(newName, formData.slug, isSlugManuallyEdited);
    setFormData((prev) => ({
      ...prev,
      name: newName,
      slug: computedSlug,
    }));
    if (errors.name) {
      setErrors((prev) => ({ ...prev, name: undefined }));
    }
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsSlugManuallyEdited(true);
    setFormData((prev) => ({ ...prev, slug: e.target.value }));
    if (errors.slug) {
      setErrors((prev) => ({ ...prev, slug: undefined }));
    }
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFormData((prev) => ({
      ...prev,
      category: e.target.value as CatalogueCategory,
    }));
  };

  const handleUnitPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, unitPriceMajor: e.target.value }));
    if (errors.unitPrice) {
      setErrors((prev) => ({ ...prev, unitPrice: undefined }));
    }
  };

  const handleTaxRateSelectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'custom') {
      setFormData((prev) => ({
        ...prev,
        taxRateBasisPoints: 1900,
        taxRateCustomPercent: '19',
      }));
    } else {
      const bps = parseInt(val, 10);
      setFormData((prev) => ({
        ...prev,
        taxRateBasisPoints: bps,
        taxRateCustomPercent: (bps / 100).toString(),
      }));
    }
    if (errors.taxRate) {
      setErrors((prev) => ({ ...prev, taxRate: undefined }));
    }
  };

  const handleCustomTaxRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputVal = e.target.value;
    const bps = parseTaxRateToBasisPoints(inputVal);
    setFormData((prev) => ({
      ...prev,
      taxRateCustomPercent: inputVal,
      taxRateBasisPoints: bps ?? -1,
    }));
    if (errors.taxRate) {
      setErrors((prev) => ({ ...prev, taxRate: undefined }));
    }
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFormData((prev) => ({ ...prev, description: e.target.value }));
  };

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();

    const validation = validateCatalogueItemForm(formData);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    const minor = convertPriceMajorToMinor(formData.unitPriceMajor) ?? 0;

    const payload = {
      id: formData.id,
      name: formData.name.trim(),
      slug: formData.slug.trim(),
      category: formData.category,
      unitPriceMinor: minor,
      taxRateBasisPoints: formData.taxRateBasisPoints,
      description: formData.description.trim() || null,
      isActive: formData.isActive,
    };

    const ok = await onSave(payload);
    if (ok) {
      onClose();
    }
  };

  const isCustomTaxRate =
    formData.taxRateBasisPoints !== 1900 &&
    formData.taxRateBasisPoints !== 700 &&
    formData.taxRateBasisPoints !== 0;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="max-w-lg"
        data-testid="catalogue-item-modal"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          triggerRef?.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {item ? t('catalogue.modal.editTitle') : t('catalogue.modal.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('catalogue.modal.description')}</DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4"
        >
          {/* Item Name */}
          <div className="space-y-1.5">
            <label htmlFor="catalogue-item-name" className="text-sm font-medium text-foreground">
              {t('catalogue.modal.nameLabel')} <span className="text-destructive">*</span>
            </label>
            <input
              id="catalogue-item-name"
              name="name"
              type="text"
              required
              data-testid="catalogue-item-name-input"
              value={formData.name}
              onChange={handleNameChange}
              placeholder={t('catalogue.modal.namePlaceholder')}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'catalogue-item-name-error' : undefined}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
            />
            {errors.name && (
              <p id="catalogue-item-name-error" role="alert" className="text-xs text-destructive">
                {errors.name}
              </p>
            )}
          </div>

          {/* Slug & Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="catalogue-item-slug" className="text-sm font-medium text-foreground">
                {t('catalogue.modal.slugLabel')} <span className="text-destructive">*</span>
              </label>
              <input
                id="catalogue-item-slug"
                name="slug"
                type="text"
                required
                data-testid="catalogue-item-slug-input"
                value={formData.slug}
                onChange={handleSlugChange}
                placeholder={t('catalogue.modal.slugPlaceholder')}
                aria-invalid={Boolean(errors.slug)}
                aria-describedby={errors.slug ? 'catalogue-item-slug-error' : undefined}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
              />
              {errors.slug && (
                <p id="catalogue-item-slug-error" role="alert" className="text-xs text-destructive">
                  {errors.slug}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="catalogue-item-category"
                className="text-sm font-medium text-foreground"
              >
                {t('catalogue.modal.categoryLabel')} <span className="text-destructive">*</span>
              </label>
              <select
                id="catalogue-item-category"
                name="category"
                data-testid="catalogue-item-category-select"
                value={formData.category}
                onChange={handleCategoryChange}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Unit Price & Tax Rate */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="catalogue-item-price" className="text-sm font-medium text-foreground">
                {t('catalogue.modal.unitPriceLabel')} (€){' '}
                <span className="text-destructive">*</span>
              </label>
              <input
                id="catalogue-item-price"
                name="unitPrice"
                type="text"
                inputMode="decimal"
                required
                data-testid="catalogue-item-price-input"
                value={formData.unitPriceMajor}
                onChange={handleUnitPriceChange}
                placeholder={t('catalogue.modal.unitPricePlaceholder')}
                aria-invalid={Boolean(errors.unitPrice)}
                aria-describedby={errors.unitPrice ? 'catalogue-item-price-error' : undefined}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
              />
              {errors.unitPrice && (
                <p
                  id="catalogue-item-price-error"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {errors.unitPrice}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="catalogue-item-tax-rate"
                className="text-sm font-medium text-foreground"
              >
                {t('catalogue.modal.taxRateLabel')} <span className="text-destructive">*</span>
              </label>
              <div className="flex gap-2">
                <select
                  id="catalogue-item-tax-rate"
                  name="taxRatePreset"
                  data-testid="catalogue-item-tax-rate-select"
                  value={isCustomTaxRate ? 'custom' : formData.taxRateBasisPoints.toString()}
                  onChange={handleTaxRateSelectionChange}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
                >
                  <option value="1900">{t('modal.taxRateStandard')}</option>
                  <option value="700">{t('modal.taxRateReduced')}</option>
                  <option value="0">{t('modal.taxRateZero')}</option>
                  <option value="custom">{t('modal.taxRateCustom')}</option>
                </select>

                {isCustomTaxRate && (
                  <input
                    id="catalogue-item-tax-rate-custom"
                    name="customTaxRate"
                    type="text"
                    inputMode="decimal"
                    aria-label={t('modal.taxRateCustomLabel')}
                    data-testid="catalogue-custom-tax-input"
                    value={formData.taxRateCustomPercent}
                    onChange={handleCustomTaxRateChange}
                    placeholder="%"
                    className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
                  />
                )}
              </div>
              {errors.taxRate && (
                <p id="catalogue-item-tax-error" role="alert" className="text-xs text-destructive">
                  {errors.taxRate}
                </p>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label htmlFor="catalogue-item-desc" className="text-sm font-medium text-foreground">
              {t('catalogue.modal.descriptionLabel')}
            </label>
            <textarea
              id="catalogue-item-desc"
              name="description"
              rows={2}
              data-testid="catalogue-item-desc-input"
              value={formData.description}
              onChange={handleDescriptionChange}
              placeholder={t('catalogue.modal.descriptionPlaceholder')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          <DialogFooter className="border-t pt-4 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              data-testid="catalogue-item-cancel-btn"
            >
              {t('catalogue.modal.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              data-testid="save-catalogue-item-btn"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isSubmitting ? t('catalogue.modal.saving') : t('catalogue.modal.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
