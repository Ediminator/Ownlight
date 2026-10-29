'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Package, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/formatters';
import type { PackageWithIncludedItems } from '@/server/packages/repo';
import {
  type ProposalLineItemState,
  type DeliverableItemState,
  type ProposalBuilderErrors,
  createDeliverableRowHandlers,
  createPackageSectionController,
} from './proposal-builder-helpers';

export interface PackageSelectorSectionProps {
  packages: PackageWithIncludedItems[];
  selectedPackageId: string | null;
  basePackageItem: ProposalLineItemState | null;
  deliverables: DeliverableItemState[];
  currency: string;
  locale: string;
  errors: ProposalBuilderErrors;
  projectTypeKey?: string | null;
  onSelectPackage: (pkg: PackageWithIncludedItems | null) => void;
  onUpdateBasePrice: (priceMajor: string) => void;
  onUpdateTaxRate: (taxRateBasisPoints: number) => void;
  onAddDeliverable: (title: string, quantity?: number) => void;
  onUpdateDeliverableTitle: (index: number, title: string) => void;
  onUpdateDeliverableQty: (index: number, quantity: number) => void;
  onRemoveDeliverable: (index: number) => void;
}

export function PackageSelectorSection({
  packages,
  selectedPackageId,
  basePackageItem,
  deliverables,
  currency,
  locale,
  errors,
  projectTypeKey,
  onSelectPackage,
  onUpdateBasePrice,
  onUpdateTaxRate,
  onAddDeliverable,
  onUpdateDeliverableTitle,
  onUpdateDeliverableQty,
  onRemoveDeliverable,
}: PackageSelectorSectionProps) {
  const t = useTranslations('proposals.builder');
  const [newDeliverableTitle, setNewDeliverableTitle] = React.useState('');
  const [newDeliverableQty, setNewDeliverableQty] = React.useState('1');

  // Filter packages: if projectTypeKey is given, prioritize or show matching packages
  const filteredPackages = React.useMemo(() => {
    if (!projectTypeKey) return packages;
    return packages.filter((p) => !p.projectTypeKey || p.projectTypeKey === projectTypeKey);
  }, [packages, projectTypeKey]);

  const displayPackages = filteredPackages.length > 0 ? filteredPackages : packages;

  const controller = createPackageSectionController(
    onSelectPackage,
    onUpdateBasePrice,
    onUpdateTaxRate,
    onAddDeliverable,
    packages,
    setNewDeliverableTitle,
    setNewDeliverableQty,
  );

  return (
    <section
      aria-labelledby="package-section-title"
      className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6"
      data-testid="package-selector-section"
    >
      <div className="flex flex-col gap-1 border-b border-border pb-4">
        <h2
          id="package-section-title"
          className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2"
        >
          <Package className="h-5 w-5 text-primary" aria-hidden="true" />
          {t('packageSection.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('packageSection.subtitle')}</p>
      </div>

      {/* Package Selector */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label
              htmlFor="package-select-input"
              className="block text-sm font-medium text-foreground"
            >
              {t('packageSection.title')}
            </label>
            <select
              id="package-select-input"
              data-testid="package-select"
              value={selectedPackageId ?? ''}
              onChange={controller.handlePackageSelectChange}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring"
            >
              <option value="">{t('packageSection.selectPlaceholder')}</option>
              {displayPackages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.name} — {formatCurrency(pkg.basePriceMinor, currency, locale)}
                </option>
              ))}
            </select>
          </div>

          {basePackageItem && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="base-package-price-input"
                  className="block text-sm font-medium text-foreground"
                >
                  {t('packageSection.basePriceLabel')}
                </label>
                <div className="relative">
                  <input
                    id="base-package-price-input"
                    data-testid="base-package-price-input"
                    type="text"
                    inputMode="decimal"
                    value={basePackageItem.unitPriceMajor}
                    onChange={controller.handleBasePriceChange}
                    aria-invalid={Boolean(errors.basePackage?.unitPrice)}
                    aria-describedby={
                      errors.basePackage?.unitPrice ? 'base-package-price-error' : undefined
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring"
                  />
                </div>
                {errors.basePackage?.unitPrice && (
                  <p
                    id="base-package-price-error"
                    role="alert"
                    data-testid="base-package-price-error"
                    className="text-xs text-red-600 dark:text-red-400 font-medium"
                  >
                    {errors.basePackage.unitPrice}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="base-package-tax-rate-input"
                  className="block text-sm font-medium text-foreground"
                >
                  {t('packageSection.taxRateLabel')}
                </label>
                <select
                  id="base-package-tax-rate-input"
                  data-testid="base-package-tax-rate-select"
                  value={basePackageItem.taxRateBasisPoints}
                  onChange={controller.handleTaxRateChange}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring"
                >
                  <option value={1900}>{t('taxRates.standard')}</option>
                  <option value={700}>{t('taxRates.reduced')}</option>
                  <option value={0}>{t('taxRates.exempt')}</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Selected Package Details Banner */}
        {basePackageItem && (
          <div
            className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border"
            data-testid="selected-package-banner"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span
                className="text-sm font-medium text-foreground"
                data-testid="selected-package-title"
              >
                {basePackageItem.name}
              </span>
            </div>
            <span
              className="text-sm font-semibold text-foreground"
              data-testid="selected-package-price"
            >
              {formatCurrency(basePackageItem.unitPriceMinor, currency, locale)}
            </span>
          </div>
        )}

        {/* Deliverables Sub-section */}
        <div className="space-y-3 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <h3 className="text-sm font-semibold text-foreground">
              {t('packageSection.includedDeliverablesTitle')}
            </h3>
            <span className="text-xs text-muted-foreground">
              {t('packageSection.deliverablesSubtitle')}
            </span>
          </div>

          {/* List of deliverables */}
          <div className="space-y-2" data-testid="deliverables-list">
            {deliverables.length === 0 ? (
              <p
                className="text-sm text-muted-foreground italic py-2"
                data-testid="no-deliverables-msg"
              >
                {t('packageSection.noPackages')}
              </p>
            ) : (
              deliverables.map((item, index) => {
                const rowHandlers = createDeliverableRowHandlers(
                  index,
                  onUpdateDeliverableTitle,
                  onUpdateDeliverableQty,
                  onRemoveDeliverable,
                );
                return (
                  <div
                    key={item.id}
                    data-testid={`deliverable-item-${String(index)}`}
                    className="flex items-center gap-2 p-2 rounded-md bg-background border border-border"
                  >
                    <input
                      type="number"
                      min="1"
                      aria-label={t('packageSection.deliverableQtyAria', { title: item.title })}
                      data-testid={`deliverable-qty-input-${String(index)}`}
                      value={item.quantity}
                      onChange={rowHandlers.handleQtyChange}
                      className="w-16 rounded border border-input bg-background px-2 py-1 text-xs text-foreground text-center"
                    />
                    <input
                      type="text"
                      aria-label={t('packageSection.deliverableTitleAria', { number: index + 1 })}
                      data-testid={`deliverable-title-input-${String(index)}`}
                      value={item.title}
                      onChange={rowHandlers.handleTitleChange}
                      className="flex-1 rounded border border-input bg-background px-2 py-1 text-sm text-foreground"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid={`remove-deliverable-${String(index)}`}
                      aria-label={`${t('packageSection.removeDeliverable')} ${item.title}`}
                      onClick={rowHandlers.handleRemove}
                      className="text-muted-foreground hover:text-destructive h-8 w-8 p-0"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                );
              })
            )}
          </div>

          {/* Add custom deliverable form */}
          <form
            onSubmit={controller.handleAddDeliverableSubmit(newDeliverableTitle, newDeliverableQty)}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1"
            data-testid="add-deliverable-form"
          >
            <div className="flex items-center gap-2 flex-1">
              <input
                type="number"
                min="1"
                aria-label={t('packageSection.deliverableQty')}
                placeholder={t('packageSection.deliverableQty')}
                data-testid="new-deliverable-qty-input"
                value={newDeliverableQty}
                onChange={controller.handleQtyInputChange}
                className="w-16 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground text-center shadow-sm shrink-0"
              />
              <input
                type="text"
                placeholder={t('packageSection.deliverableTitlePlaceholder')}
                aria-label={t('packageSection.deliverableTitlePlaceholder')}
                data-testid="new-deliverable-title-input"
                value={newDeliverableTitle}
                onChange={controller.handleTitleInputChange}
                className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-sm"
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              data-testid="add-deliverable-btn"
              onClick={controller.handleAddDeliverableSubmit(
                newDeliverableTitle,
                newDeliverableQty,
              )}
              className="w-full sm:w-auto shrink-0 flex items-center justify-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('packageSection.addDeliverable')}
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
