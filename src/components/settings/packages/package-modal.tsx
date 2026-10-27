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
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import {
  buildPackageSavePayload,
  createModalDialogHandlers,
  createDeliverableRowHandlers,
  createPackageModalHandlers,
  packageFormReducer,
  initPackageFormState,
  type PackageFormAction,
  type PackageFormErrors,
} from './packages-helpers';
import type { PackageWithIncludedItems } from '@/server/packages/repo';
import type { PackageIncludedItemInput } from '@/server/packages/schema';

export interface PackageModalProps {
  pkg: PackageWithIncludedItems | null;
  isOpen: boolean;
  isSubmitting: boolean;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  initialErrors?: PackageFormErrors;
  onClose: () => void;
  onSave: (payload: ReturnType<typeof buildPackageSavePayload>) => Promise<boolean>;
}

const PROJECT_TYPE_OPTIONS = [
  { value: '', labelKey: 'modal.projectTypeNone' },
  { value: 'wedding', label: 'Wedding' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'event', label: 'Event' },
  { value: 'video', label: 'Video' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'editorial', label: 'Editorial' },
];

export function PackageDeliverableRow({
  item,
  index,
  total,
  errors,
  disabled,
  t,
  dispatch,
}: {
  item: PackageIncludedItemInput;
  index: number;
  total: number;
  errors?: Record<number, { title?: string; quantity?: string }>;
  disabled: boolean;
  t: (key: string, values?: Record<string, string | number | Date>) => string;
  dispatch: React.Dispatch<PackageFormAction>;
}) {
  const idxStr = String(index);
  const posStr = String(index + 1);
  const itemError = errors?.[index];
  const handlers = createDeliverableRowHandlers(dispatch, index);

  return (
    <div
      data-testid={`deliverable-row-${idxStr}`}
      className="rounded-md border p-2.5 bg-muted/40 space-y-2"
    >
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <input
            type="text"
            required
            aria-label={`${t('modal.deliverableTitleLabel')} ${posStr}`}
            data-testid={`deliverable-title-input-${idxStr}`}
            value={item.title}
            onChange={handlers.onTitleChange}
            placeholder={t('modal.deliverableTitlePlaceholder')}
            aria-invalid={Boolean(itemError?.title)}
            aria-describedby={itemError?.title ? `deliverable-${idxStr}-title-error` : undefined}
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[32px]"
          />
          {itemError?.title && (
            <p
              id={`deliverable-${idxStr}-title-error`}
              role="alert"
              className="text-xs text-destructive mt-1"
            >
              {itemError.title}
            </p>
          )}
        </div>

        <div className="w-20">
          <input
            type="number"
            min={1}
            required
            aria-label={`${t('modal.deliverableQuantityLabel')} ${posStr}`}
            data-testid={`deliverable-quantity-input-${idxStr}`}
            value={item.quantity}
            onChange={handlers.onQtyChange}
            aria-invalid={Boolean(itemError?.quantity)}
            aria-describedby={itemError?.quantity ? `deliverable-${idxStr}-qty-error` : undefined}
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[32px]"
          />
          {itemError?.quantity && (
            <p
              id={`deliverable-${idxStr}-qty-error`}
              role="alert"
              className="text-xs text-destructive mt-1"
            >
              {itemError.quantity}
            </p>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled || index === 0}
            onClick={handlers.onMoveUp}
            data-testid={`deliverable-move-up-${idxStr}`}
            aria-label={t('modal.moveDeliverableUp', { position: posStr })}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled || index === total - 1}
            onClick={handlers.onMoveDown}
            data-testid={`deliverable-move-down-${idxStr}`}
            aria-label={t('modal.moveDeliverableDown', { position: posStr })}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            onClick={handlers.onRemove}
            data-testid={`deliverable-remove-${idxStr}`}
            aria-label={t('modal.removeDeliverable', { position: posStr })}
            className="h-8 w-8 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <textarea
        rows={1}
        aria-label={`${t('modal.deliverableDescriptionLabel')} ${posStr}`}
        data-testid={`deliverable-desc-input-${idxStr}`}
        value={item.description ?? ''}
        onChange={handlers.onDescChange}
        placeholder={t('modal.deliverableDescriptionPlaceholder')}
        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

export function PackageModal({
  pkg,
  isOpen,
  isSubmitting,
  triggerRef,
  initialErrors,
  onClose,
  onSave,
}: PackageModalProps) {
  const t = useTranslations('settings.packages');
  const [state, dispatch] = React.useReducer(packageFormReducer, pkg, (p) => ({
    ...initPackageFormState(p),
    errors: initialErrors ?? {},
  }));
  const { formData, errors } = state;

  const dialogHandlers = createModalDialogHandlers(onClose, triggerRef);
  const handlers = createPackageModalHandlers(dispatch, formData, onSave, onClose, t);

  const isCustomTaxRate =
    formData.taxRateBasisPoints !== 1900 &&
    formData.taxRateBasisPoints !== 700 &&
    formData.taxRateBasisPoints !== 0;

  return (
    <Dialog open={isOpen} onOpenChange={dialogHandlers.onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        data-testid="package-modal"
        onCloseAutoFocus={dialogHandlers.onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{pkg ? t('modal.editTitle') : t('modal.createTitle')}</DialogTitle>
          <DialogDescription>{t('modal.description')}</DialogDescription>
        </DialogHeader>

        <form noValidate onSubmit={handlers.onSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <label htmlFor="package-name" className="text-sm font-medium text-foreground">
              {t('modal.nameLabel')} <span className="text-destructive">*</span>
            </label>
            <input
              id="package-name"
              name="title"
              type="text"
              required
              data-testid="package-name-input"
              value={formData.name}
              onChange={handlers.handleTitleChange}
              placeholder={t('modal.namePlaceholder')}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'package-name-error' : undefined}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
            />
            {errors.name && (
              <p id="package-name-error" role="alert" className="text-xs text-destructive">
                {errors.name}
              </p>
            )}
          </div>

          {/* Slug & Project Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="package-slug" className="text-sm font-medium text-foreground">
                {t('modal.slugLabel')} <span className="text-destructive">*</span>
              </label>
              <input
                id="package-slug"
                name="slug"
                type="text"
                required
                data-testid="package-slug-input"
                value={formData.slug}
                onChange={handlers.handleSlugChange}
                placeholder={t('modal.slugPlaceholder')}
                aria-invalid={Boolean(errors.slug)}
                aria-describedby={errors.slug ? 'package-slug-error' : 'package-slug-help'}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
              />
              {errors.slug ? (
                <p id="package-slug-error" role="alert" className="text-xs text-destructive">
                  {errors.slug}
                </p>
              ) : (
                <p id="package-slug-help" className="text-xs text-muted-foreground">
                  {t('modal.slugHelp')}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="package-project-type" className="text-sm font-medium text-foreground">
                {t('modal.projectTypeLabel')}
              </label>
              <select
                id="package-project-type"
                name="projectTypeKey"
                data-testid="package-project-type-select"
                value={formData.projectTypeKey}
                onChange={handlers.handleProjectTypeChange}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
              >
                {PROJECT_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.value === '' ? t('modal.projectTypeNone') : opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Pricing & Tax Rate */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="package-base-price" className="text-sm font-medium text-foreground">
                {t('modal.basePriceLabel')} (€) <span className="text-destructive">*</span>
              </label>
              <input
                id="package-base-price"
                name="basePrice"
                type="text"
                inputMode="decimal"
                required
                data-testid="package-price-input"
                value={formData.basePriceMajor}
                onChange={handlers.handleBasePriceChange}
                placeholder={t('modal.basePricePlaceholder')}
                aria-invalid={Boolean(errors.basePrice)}
                aria-describedby={errors.basePrice ? 'package-price-error' : undefined}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
              />
              {errors.basePrice && (
                <p id="package-price-error" role="alert" className="text-xs text-destructive">
                  {errors.basePrice}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="package-tax-rate" className="text-sm font-medium text-foreground">
                {t('modal.taxRateLabel')} <span className="text-destructive">*</span>
              </label>
              <div className="flex gap-2">
                <select
                  id="package-tax-rate"
                  name="taxRatePreset"
                  data-testid="package-tax-rate-select"
                  value={isCustomTaxRate ? 'custom' : formData.taxRateBasisPoints.toString()}
                  onChange={handlers.handleTaxRatePresetChange}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
                >
                  <option value="1900">{t('modal.taxRateStandard')}</option>
                  <option value="700">{t('modal.taxRateReduced')}</option>
                  <option value="0">{t('modal.taxRateZero')}</option>
                  <option value="custom">{t('modal.taxRateCustom')}</option>
                </select>

                {isCustomTaxRate && (
                  <input
                    id="package-tax-rate-custom"
                    name="customTaxRate"
                    type="text"
                    inputMode="decimal"
                    aria-label={t('modal.taxRateCustomLabel')}
                    data-testid="package-custom-tax-input"
                    value={formData.taxRateCustomPercent}
                    onChange={handlers.handleCustomTaxRateChange}
                    placeholder="%"
                    className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]"
                  />
                )}
              </div>
              {errors.taxRate && (
                <p id="package-tax-error" role="alert" className="text-xs text-destructive">
                  {errors.taxRate}
                </p>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label htmlFor="package-description" className="text-sm font-medium text-foreground">
              {t('modal.descriptionLabel')}
            </label>
            <textarea
              id="package-description"
              name="description"
              rows={2}
              data-testid="package-description-input"
              value={formData.description}
              onChange={handlers.handleDescriptionChange}
              placeholder={t('modal.descriptionPlaceholder')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          {/* Included Deliverables Section */}
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {t('modal.deliverablesTitle')}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {t('modal.deliverablesDescription')}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlers.handleAddDeliverable}
                data-testid="add-deliverable-btn"
                className="gap-1 min-h-[36px]"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('modal.addDeliverable')}</span>
              </Button>
            </div>

            {formData.includedItems.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-2">
                No deliverables added yet. Click &quot;Add Deliverable&quot; to include items.
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {formData.includedItems.map((item, index) => (
                  <PackageDeliverableRow
                    key={item.id ?? 'temp-' + index.toString()}
                    item={item}
                    index={index}
                    total={formData.includedItems.length}
                    errors={errors.deliverables}
                    disabled={isSubmitting}
                    t={t}
                    dispatch={dispatch}
                  />
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              data-testid="package-modal-cancel-btn"
            >
              {t('modal.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              data-testid="save-package-btn"
              className="min-h-[36px]"
            >
              {isSubmitting ? t('modal.saving') : t('modal.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
