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
  buildCatalogueItemSavePayload,
  createCatalogueItemModalHandlers,
  catalogueFormReducer,
  initCatalogueFormState,
  type CatalogueItemFormErrors,
} from './catalogue-helpers';
import { createModalDialogHandlers } from './packages-helpers';
import type { CatalogueCategory, CatalogueItem } from '@/server/db/schema/packages';

export interface CatalogueItemModalProps {
  item: CatalogueItem | null;
  isOpen: boolean;
  isSubmitting: boolean;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  initialErrors?: CatalogueItemFormErrors;
  onClose: () => void;
  onSave: (payload: ReturnType<typeof buildCatalogueItemSavePayload>) => Promise<boolean>;
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
  initialErrors,
  onClose,
  onSave,
}: CatalogueItemModalProps) {
  const t = useTranslations('settings.packages');
  const [state, dispatch] = React.useReducer(catalogueFormReducer, item, (it) => ({
    ...initCatalogueFormState(it),
    errors: initialErrors ?? {},
  }));
  const { formData, errors } = state;

  const dialogHandlers = createModalDialogHandlers(onClose, triggerRef);
  const handlers = createCatalogueItemModalHandlers(dispatch, formData, onSave, onClose, t);

  const isCustomTaxRate =
    formData.taxRateBasisPoints !== 1900 &&
    formData.taxRateBasisPoints !== 700 &&
    formData.taxRateBasisPoints !== 0;

  return (
    <Dialog open={isOpen} onOpenChange={dialogHandlers.onOpenChange}>
      <DialogContent
        className="max-w-lg"
        data-testid="catalogue-item-modal"
        onCloseAutoFocus={dialogHandlers.onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>
            {item ? t('catalogue.modal.editTitle') : t('catalogue.modal.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('catalogue.modal.description')}</DialogDescription>
        </DialogHeader>

        <form noValidate onSubmit={handlers.onSubmit} className="space-y-4">
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
              onChange={handlers.handleNameChange}
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
                onChange={handlers.handleSlugChange}
                placeholder={t('catalogue.modal.slugPlaceholder')}
                aria-invalid={Boolean(errors.slug)}
                aria-describedby={
                  errors.slug ? 'catalogue-item-slug-error' : 'catalogue-item-slug-help'
                }
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
              />
              {errors.slug ? (
                <p id="catalogue-item-slug-error" role="alert" className="text-xs text-destructive">
                  {errors.slug}
                </p>
              ) : (
                <p id="catalogue-item-slug-help" className="text-xs text-muted-foreground">
                  {t('catalogue.modal.slugHelp')}
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
                onChange={handlers.handleCategoryChange}
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

          {/* Pricing & Tax Rate */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="catalogue-item-unit-price"
                className="text-sm font-medium text-foreground"
              >
                {t('catalogue.modal.unitPriceLabel')} (€){' '}
                <span className="text-destructive">*</span>
              </label>
              <input
                id="catalogue-item-unit-price"
                name="unitPrice"
                type="text"
                inputMode="decimal"
                required
                data-testid="catalogue-item-price-input"
                value={formData.unitPriceMajor}
                onChange={handlers.handleUnitPriceChange}
                placeholder={t('catalogue.modal.unitPricePlaceholder')}
                aria-invalid={Boolean(errors.unitPrice)}
                aria-describedby={errors.unitPrice ? 'catalogue-price-error' : undefined}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
              />
              {errors.unitPrice && (
                <p id="catalogue-price-error" role="alert" className="text-xs text-destructive">
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
                  data-testid="catalogue-tax-rate-select"
                  value={isCustomTaxRate ? 'custom' : formData.taxRateBasisPoints.toString()}
                  onChange={handlers.handleTaxRatePresetChange}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
                >
                  <option value="1900">{t('catalogue.modal.taxRateStandard')}</option>
                  <option value="700">{t('catalogue.modal.taxRateReduced')}</option>
                  <option value="0">{t('catalogue.modal.taxRateZero')}</option>
                  <option value="custom">{t('catalogue.modal.taxRateCustom')}</option>
                </select>

                {isCustomTaxRate && (
                  <input
                    id="catalogue-item-tax-rate-custom"
                    name="customTaxRate"
                    type="text"
                    inputMode="decimal"
                    aria-label={t('catalogue.modal.taxRateCustomLabel')}
                    data-testid="catalogue-custom-tax-input"
                    value={formData.taxRateCustomPercent}
                    onChange={handlers.handleCustomTaxRateChange}
                    placeholder="%"
                    className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
                  />
                )}
              </div>
              {errors.taxRate && (
                <p id="catalogue-tax-error" role="alert" className="text-xs text-destructive">
                  {errors.taxRate}
                </p>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label
              htmlFor="catalogue-item-description"
              className="text-sm font-medium text-foreground"
            >
              {t('catalogue.modal.descriptionLabel')}
            </label>
            <textarea
              id="catalogue-item-description"
              name="description"
              rows={3}
              data-testid="catalogue-description-input"
              value={formData.description}
              onChange={handlers.handleDescriptionChange}
              placeholder={t('catalogue.modal.descriptionPlaceholder')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-4 border-t">
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
              className="min-h-[36px]"
            >
              {isSubmitting ? t('catalogue.modal.saving') : t('catalogue.modal.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
