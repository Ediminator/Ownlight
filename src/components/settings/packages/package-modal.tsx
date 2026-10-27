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
  packageToFormData,
  validatePackageForm,
  computeSlugFromTitle,
  moveDeliverable,
  parseTaxRateToBasisPoints,
  type PackageFormData,
  type PackageFormErrors,
} from './packages-helpers';
import { convertPriceMajorToMinor } from '@/lib/currency';
import type { PackageWithIncludedItems } from '@/server/packages/repo';

export interface PackageModalProps {
  pkg: PackageWithIncludedItems | null;
  isOpen: boolean;
  isSubmitting: boolean;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSave: (payload: {
    id?: string;
    name: string;
    slug: string;
    projectTypeKey: string | null;
    basePriceMinor: number;
    taxRateBasisPoints: number;
    description: string | null;
    includedItems: {
      id?: string;
      title: string;
      description?: string | null;
      quantity: number;
      position: number;
    }[];
  }) => Promise<boolean>;
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

export function PackageModal({
  pkg,
  isOpen,
  isSubmitting,
  triggerRef,
  onClose,
  onSave,
}: PackageModalProps) {
  const t = useTranslations('settings.packages');
  const [formData, setFormData] = React.useState<PackageFormData>(() => packageToFormData(pkg));
  const [errors, setErrors] = React.useState<PackageFormErrors>({});
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = React.useState(Boolean(pkg?.slug));

  const [prevPkg, setPrevPkg] = React.useState(pkg);
  const [prevIsOpen, setPrevIsOpen] = React.useState(isOpen);

  if (pkg !== prevPkg || isOpen !== prevIsOpen) {
    setPrevPkg(pkg);
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setFormData(packageToFormData(pkg));
      setErrors({});
      setIsSlugManuallyEdited(Boolean(pkg?.slug));
    }
  }

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    const computedSlug = computeSlugFromTitle(newTitle, formData.slug, isSlugManuallyEdited);
    setFormData((prev) => ({
      ...prev,
      name: newTitle,
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

  const handleProjectTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFormData((prev) => ({ ...prev, projectTypeKey: e.target.value }));
  };

  const handleBasePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, basePriceMajor: e.target.value }));
    if (errors.basePrice) {
      setErrors((prev) => ({ ...prev, basePrice: undefined }));
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

  const handleAddDeliverable = () => {
    setFormData((prev) => ({
      ...prev,
      includedItems: [
        ...prev.includedItems,
        {
          title: '',
          description: '',
          quantity: 1,
          position: prev.includedItems.length,
        },
      ],
    }));
  };

  const handleDeliverableTitleChange = (index: number, value: string) => {
    setFormData((prev) => ({
      ...prev,
      includedItems: prev.includedItems.map((item, i) =>
        i === index ? { ...item, title: value } : item,
      ),
    }));
    if (errors.deliverables) {
      setErrors((prev) => {
        if (!prev.deliverables) return prev;
        const remaining = Object.entries(prev.deliverables).filter(
          ([key]) => Number(key) !== index,
        );
        return {
          ...prev,
          deliverables: Object.fromEntries(remaining),
        };
      });
    }
  };

  const handleDeliverableDescChange = (index: number, value: string) => {
    setFormData((prev) => ({
      ...prev,
      includedItems: prev.includedItems.map((item, i) =>
        i === index ? { ...item, description: value } : item,
      ),
    }));
  };

  const handleDeliverableQtyChange = (index: number, value: number) => {
    setFormData((prev) => ({
      ...prev,
      includedItems: prev.includedItems.map((item, i) =>
        i === index ? { ...item, quantity: value } : item,
      ),
    }));
  };

  const handleRemoveDeliverable = (index: number) => {
    setFormData((prev) => {
      const copy = prev.includedItems.filter((_, i) => i !== index);
      return {
        ...prev,
        includedItems: copy.map((item, idx) => ({ ...item, position: idx })),
      };
    });
  };

  const handleMoveDeliverable = (from: number, to: number) => {
    setFormData((prev) => ({
      ...prev,
      includedItems: moveDeliverable(prev.includedItems, from, to),
    }));
  };

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();

    const validation = validatePackageForm(formData);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    const minor = convertPriceMajorToMinor(formData.basePriceMajor) ?? 0;

    const payload = {
      id: formData.id,
      name: formData.name.trim(),
      slug: formData.slug.trim(),
      projectTypeKey: formData.projectTypeKey.trim() ? formData.projectTypeKey.trim() : null,
      basePriceMinor: minor,
      taxRateBasisPoints: formData.taxRateBasisPoints,
      description: formData.description.trim() ? formData.description.trim() : null,
      includedItems: formData.includedItems.map((item, idx) => ({
        id: item.id,
        title: item.title.trim(),
        description: item.description?.trim() ? item.description.trim() : null,
        quantity: item.quantity,
        position: idx,
      })),
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
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        data-testid="package-modal"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          triggerRef?.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{pkg ? t('modal.editTitle') : t('modal.createTitle')}</DialogTitle>
          <DialogDescription>{t('modal.description')}</DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4"
        >
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
              onChange={handleTitleChange}
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
                onChange={handleSlugChange}
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
                onChange={handleProjectTypeChange}
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
                onChange={handleBasePriceChange}
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
                    id="package-tax-rate-custom"
                    name="customTaxRate"
                    type="text"
                    inputMode="decimal"
                    aria-label={t('modal.taxRateCustomLabel')}
                    data-testid="package-custom-tax-input"
                    value={formData.taxRateCustomPercent}
                    onChange={handleCustomTaxRateChange}
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
              onChange={handleDescriptionChange}
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
                onClick={handleAddDeliverable}
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
                {formData.includedItems.map((item, index) => {
                  const idxStr = String(index);
                  const posStr = String(index + 1);
                  const itemError = errors.deliverables
                    ? Object.entries(errors.deliverables).find(([k]) => k === idxStr)?.[1]
                    : undefined;
                  return (
                    <div
                      key={item.id ?? `temp-${idxStr}`}
                      data-testid={`deliverable-row-${idxStr}`}
                      className="rounded-md border p-2.5 bg-muted/40 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        {/* Title input */}
                        <div className="flex-1">
                          <input
                            type="text"
                            required
                            aria-label={`${t('modal.deliverableTitleLabel')} ${posStr}`}
                            data-testid={`deliverable-title-input-${idxStr}`}
                            value={item.title}
                            onChange={(e) => {
                              handleDeliverableTitleChange(index, e.target.value);
                            }}
                            placeholder={t('modal.deliverableTitlePlaceholder')}
                            aria-invalid={Boolean(itemError?.title)}
                            aria-describedby={
                              itemError?.title ? `deliverable-${idxStr}-title-error` : undefined
                            }
                            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[32px]"
                          />
                          {itemError?.title && (
                            <p
                              id={`deliverable-${idxStr}-title-error`}
                              role="alert"
                              className="text-xs text-destructive mt-0.5"
                            >
                              {itemError.title}
                            </p>
                          )}
                        </div>

                        {/* Quantity input */}
                        <div className="w-16">
                          <input
                            type="number"
                            min={1}
                            aria-label={`${t('modal.deliverableQuantityLabel')} ${posStr}`}
                            data-testid={`deliverable-quantity-input-${idxStr}`}
                            value={item.quantity}
                            onChange={(e) => {
                              handleDeliverableQtyChange(index, parseInt(e.target.value, 10) || 1);
                            }}
                            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-center text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[32px]"
                          />
                        </div>

                        {/* Reorder Buttons */}
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('modal.moveUp')}
                            disabled={index === 0}
                            onClick={() => {
                              handleMoveDeliverable(index, index - 1);
                            }}
                            data-testid={`deliverable-move-up-${idxStr}`}
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          >
                            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('modal.moveDown')}
                            disabled={index === formData.includedItems.length - 1}
                            onClick={() => {
                              handleMoveDeliverable(index, index + 1);
                            }}
                            data-testid={`deliverable-move-down-${idxStr}`}
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          >
                            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('modal.removeDeliverable')}
                            onClick={() => {
                              handleRemoveDeliverable(index);
                            }}
                            data-testid={`deliverable-remove-${idxStr}`}
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>

                      {/* Optional deliverable details/description */}
                      <input
                        type="text"
                        aria-label={`${t('modal.deliverableDescriptionLabel')} ${posStr}`}
                        data-testid={`deliverable-desc-input-${idxStr}`}
                        value={item.description ?? ''}
                        onChange={(e) => {
                          handleDeliverableDescChange(index, e.target.value);
                        }}
                        placeholder={t('modal.deliverableDescriptionPlaceholder')}
                        className="w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="border-t pt-4 gap-2 sm:gap-0">
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
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isSubmitting ? t('modal.saving') : t('modal.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
