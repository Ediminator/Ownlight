'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Layers, Plus, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/formatters';
import type { CatalogueItem } from '@/server/db/schema/packages';
import {
  type ProposalLineItemState,
  type ProposalBuilderErrors,
  createAddonRowHandlers,
  createAddonSectionController,
} from './proposal-builder-helpers';

export interface AddonOptionsSectionProps {
  catalogueItems: CatalogueItem[];
  addonItems: ProposalLineItemState[];
  currency: string;
  locale: string;
  errors: ProposalBuilderErrors;
  onAddCatalogueItem: (item: CatalogueItem) => void;
  onAddCustomItem: () => void;
  onUpdateItemField: (index: number, field: keyof ProposalLineItemState, value: unknown) => void;
  onMoveItem: (from: number, to: number) => void;
  onRemoveItem: (index: number) => void;
}

export function AddonOptionsSection({
  catalogueItems,
  addonItems,
  currency,
  locale,
  errors,
  onAddCatalogueItem,
  onAddCustomItem,
  onUpdateItemField,
  onMoveItem,
  onRemoveItem,
}: AddonOptionsSectionProps) {
  const t = useTranslations('proposals.builder');
  const [selectedCatalogueId, setSelectedCatalogueId] = React.useState<string>('');

  const controller = createAddonSectionController(
    catalogueItems,
    onAddCatalogueItem,
    setSelectedCatalogueId,
  );

  return (
    <section
      aria-labelledby="addon-section-title"
      className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6"
      data-testid="addon-options-section"
    >
      <div className="flex flex-col gap-1 border-b border-border pb-4">
        <h2
          id="addon-section-title"
          className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2"
        >
          <Layers className="h-5 w-5 text-primary" aria-hidden="true" />
          {t('addonSection.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('addonSection.subtitle')}</p>
      </div>

      {/* Item Addition Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <label htmlFor="catalogue-addon-select" className="sr-only">
            {t('addonSection.cataloguePlaceholder')}
          </label>
          <select
            id="catalogue-addon-select"
            data-testid="catalogue-addon-select"
            value={selectedCatalogueId}
            onChange={controller.handleCatalogueSelectChange}
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring"
          >
            <option value="">{t('addonSection.cataloguePlaceholder')}</option>
            {catalogueItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({formatCurrency(item.unitPriceMinor, currency, locale)})
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="add-catalogue-addon-btn"
            disabled={!selectedCatalogueId}
            onClick={controller.handleAddCatalogueClick(selectedCatalogueId)}
            className="w-full sm:w-auto shrink-0 flex items-center justify-center gap-1.5"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('addonSection.addCatalogueAddon')}
          </Button>
        </div>

        <div className="flex items-center w-full sm:w-auto">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="add-custom-item-btn"
            onClick={onAddCustomItem}
            className="w-full sm:w-auto flex items-center justify-center gap-1.5"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('addonSection.addCustomItem')}
          </Button>
        </div>
      </div>

      {/* Attached Line Items Table / List */}
      <div className="space-y-3" data-testid="addon-items-list">
        {addonItems.length === 0 ? (
          <div
            className="text-center py-8 rounded-lg border border-dashed border-border p-4 bg-muted/20"
            data-testid="no-addons-msg"
          >
            <p className="text-sm text-muted-foreground">{t('addonSection.noAddonsAttached')}</p>
          </div>
        ) : (
          addonItems.map((item, index) => {
            const itemErrors = errors.items;
            // eslint-disable-next-line security/detect-object-injection -- index is bounded numeric array index from map
            const itemError = itemErrors ? itemErrors[index] : undefined;
            const rowHandlers = createAddonRowHandlers(
              index,
              onUpdateItemField,
              onMoveItem,
              onRemoveItem,
            );

            return (
              <div
                key={item.id ?? `addon-${String(index)}`}
                data-testid={`addon-row-${String(index)}`}
                className="rounded-lg border border-border bg-background p-4 shadow-sm space-y-3"
              >
                {/* Header row: Name, Type Badge, Optional Badge, Reorder & Remove Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider">
                      {item.itemType === 'addon'
                        ? t('addonSection.types.addon')
                        : t('addonSection.types.custom')}
                    </span>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${
                        item.isOptional
                          ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                          : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                      }`}
                      data-testid={`addon-optional-badge-${String(index)}`}
                    >
                      {item.isOptional
                        ? t('addonSection.optionalBadge')
                        : t('addonSection.mandatoryBadge')}
                    </span>
                  </div>

                  {/* Actions: Move Up, Move Down, Delete */}
                  <div className="flex items-center gap-1 self-end sm:self-auto">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={index === 0}
                      aria-label={`${t('addonSection.moveUp')} ${item.name || String(index + 1)}`}
                      data-testid={`addon-move-up-${String(index)}`}
                      onClick={rowHandlers.handleMoveUp}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={index === addonItems.length - 1}
                      aria-label={`${t('addonSection.moveDown')} ${item.name || String(index + 1)}`}
                      data-testid={`addon-move-down-${String(index)}`}
                      onClick={rowHandlers.handleMoveDown}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`${t('addonSection.removeItem')} ${item.name || String(index + 1)}`}
                      data-testid={`addon-remove-${String(index)}`}
                      onClick={rowHandlers.handleRemove}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                {/* Form Inputs Grid */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                  {/* Name field */}
                  <div className="md:col-span-5 space-y-1">
                    <label
                      htmlFor={`addon-name-${String(index)}`}
                      className="block text-xs font-medium text-foreground"
                    >
                      {t('addonSection.table.item')}
                    </label>
                    <input
                      id={`addon-name-${String(index)}`}
                      data-testid={`addon-name-${String(index)}`}
                      type="text"
                      placeholder={t('addonSection.namePlaceholder')}
                      value={item.name}
                      onChange={rowHandlers.handleNameChange}
                      aria-invalid={Boolean(itemError?.name)}
                      aria-describedby={
                        itemError?.name ? `addon-name-error-${String(index)}` : undefined
                      }
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    {itemError?.name && (
                      <p
                        id={`addon-name-error-${String(index)}`}
                        role="alert"
                        data-testid={`addon-name-error-${String(index)}`}
                        className="text-xs text-red-600 dark:text-red-400 font-medium"
                      >
                        {itemError.name}
                      </p>
                    )}
                  </div>

                  {/* Price input */}
                  <div className="md:col-span-2 space-y-1">
                    <label
                      htmlFor={`addon-price-${String(index)}`}
                      className="block text-xs font-medium text-foreground"
                    >
                      {t('addonSection.table.price')}
                    </label>
                    <input
                      id={`addon-price-${String(index)}`}
                      data-testid={`addon-price-${String(index)}`}
                      type="text"
                      inputMode="decimal"
                      value={item.unitPriceMajor}
                      onChange={rowHandlers.handlePriceChange}
                      aria-invalid={Boolean(itemError?.unitPrice)}
                      aria-describedby={
                        itemError?.unitPrice ? `addon-price-error-${String(index)}` : undefined
                      }
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    {itemError?.unitPrice && (
                      <p
                        id={`addon-price-error-${String(index)}`}
                        role="alert"
                        data-testid={`addon-price-error-${String(index)}`}
                        className="text-xs text-red-600 dark:text-red-400 font-medium"
                      >
                        {itemError.unitPrice}
                      </p>
                    )}
                  </div>

                  {/* Quantity input */}
                  <div className="md:col-span-1 space-y-1">
                    <label
                      htmlFor={`addon-quantity-${String(index)}`}
                      className="block text-xs font-medium text-foreground"
                    >
                      {t('addonSection.table.quantity')}
                    </label>
                    <input
                      id={`addon-quantity-${String(index)}`}
                      data-testid={`addon-quantity-${String(index)}`}
                      type="number"
                      min="0"
                      value={item.quantity}
                      onChange={rowHandlers.handleQuantityChange}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground text-center shadow-sm"
                    />
                  </div>

                  {/* Max quantity input */}
                  <div className="md:col-span-1 space-y-1">
                    <label
                      htmlFor={`addon-max-quantity-${String(index)}`}
                      className="block text-xs font-medium text-foreground"
                    >
                      {t('addonSection.table.maxQuantity')}
                    </label>
                    <input
                      id={`addon-max-quantity-${String(index)}`}
                      data-testid={`addon-max-quantity-${String(index)}`}
                      type="number"
                      min="1"
                      value={item.maxQuantity}
                      onChange={rowHandlers.handleMaxQuantityChange}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground text-center shadow-sm"
                    />
                  </div>

                  {/* Tax Rate select */}
                  <div className="md:col-span-2 space-y-1">
                    <label
                      htmlFor={`addon-tax-rate-${String(index)}`}
                      className="block text-xs font-medium text-foreground"
                    >
                      {t('addonSection.table.taxRate')}
                    </label>
                    <select
                      id={`addon-tax-rate-${String(index)}`}
                      data-testid={`addon-tax-rate-${String(index)}`}
                      value={item.taxRateBasisPoints}
                      onChange={rowHandlers.handleTaxRateChange}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground shadow-sm"
                    >
                      <option value={1900}>{t('taxRates.standard')}</option>
                      <option value={700}>{t('taxRates.reduced')}</option>
                      <option value={0}>{t('taxRates.exempt')}</option>
                    </select>
                  </div>

                  {/* Optional Toggle Checkbox */}
                  <div className="md:col-span-1 flex flex-row md:flex-col items-center justify-start md:justify-center gap-2 pt-2 md:pt-5">
                    <input
                      id={`addon-optional-toggle-${String(index)}`}
                      data-testid={`addon-optional-toggle-${String(index)}`}
                      type="checkbox"
                      checked={item.isOptional}
                      onChange={rowHandlers.handleOptionalChange}
                      className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                    />
                    <label
                      htmlFor={`addon-optional-toggle-${String(index)}`}
                      className="text-xs font-medium text-foreground md:sr-only cursor-pointer"
                    >
                      {t('addonSection.table.optional')}
                    </label>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
