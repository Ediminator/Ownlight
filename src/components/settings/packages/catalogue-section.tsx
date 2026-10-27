'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Plus, Edit, Archive, RefreshCw, Layers } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { formatTaxRateBasisPoints } from './packages-helpers';
import {
  filterCatalogueItems,
  getCategoryBadgeClasses,
  useCatalogueSectionHandlers,
  buildCatalogueItemSavePayload,
} from './catalogue-helpers';
import { CatalogueItemModal } from './catalogue-item-modal';
import type { CatalogueCategory, CatalogueItem } from '@/server/db/schema/packages';

export interface CatalogueSectionProps {
  initialItems: CatalogueItem[];
  locale?: string;
  onSaveCatalogueItem: (
    payload: ReturnType<typeof buildCatalogueItemSavePayload>,
  ) => Promise<boolean>;
  onArchiveCatalogueItem: (id: string, isActive?: boolean) => Promise<boolean>;
  initialShowArchived?: boolean;
}

const CATEGORY_NAMES: Record<
  CatalogueCategory,
  | 'catalogue.categories.service'
  | 'catalogue.categories.product'
  | 'catalogue.categories.travel'
  | 'catalogue.categories.licensing'
> = {
  service: 'catalogue.categories.service',
  product: 'catalogue.categories.product',
  travel: 'catalogue.categories.travel',
  licensing: 'catalogue.categories.licensing',
};

const CATEGORY_FILTER_OPTIONS: {
  value: string;
  labelKey:
    | 'catalogue.filterAll'
    | 'catalogue.categories.service'
    | 'catalogue.categories.product'
    | 'catalogue.categories.travel'
    | 'catalogue.categories.licensing';
}[] = [
  { value: 'all', labelKey: 'catalogue.filterAll' },
  { value: 'service', labelKey: 'catalogue.categories.service' },
  { value: 'product', labelKey: 'catalogue.categories.product' },
  { value: 'travel', labelKey: 'catalogue.categories.travel' },
  { value: 'licensing', labelKey: 'catalogue.categories.licensing' },
];

export function CatalogueSection({
  initialItems,
  locale = 'en',
  initialShowArchived = false,
  onSaveCatalogueItem,
  onArchiveCatalogueItem,
}: CatalogueSectionProps) {
  const t = useTranslations('settings.packages');

  const [categoryFilter, setCategoryFilter] = React.useState('all');
  const [showArchived, setShowArchived] = React.useState(initialShowArchived);

  // Modal states
  const [editingItem, setEditingItem] = React.useState<CatalogueItem | null>(null);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [isModalSubmitting, setIsModalSubmitting] = React.useState(false);

  // Trigger ref for accessible Radix focus restoration
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const filteredItems = React.useMemo(
    () => filterCatalogueItems(initialItems, categoryFilter, showArchived),
    [initialItems, categoryFilter, showArchived],
  );

  const handlers = useCatalogueSectionHandlers({
    triggerRef,
    setEditingItem,
    setIsModalOpen,
    setIsModalSubmitting,
    setCategoryFilter,
    setShowArchived,
    onSaveCatalogueItem,
    onArchiveCatalogueItem,
    initialItems,
  });

  return (
    <div className="space-y-6" data-testid="catalogue-section">
      {/* Header & Create Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b">
        <div className="space-y-1">
          <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {t('catalogue.title')}
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">{t('catalogue.description')}</p>
        </div>
        <Button
          type="button"
          onClick={handlers.handleOpenCreateModal}
          data-testid="create-catalogue-item-btn"
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 min-h-[36px] shadow-sm self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{t('catalogue.createButton')}</span>
        </Button>
      </div>

      {/* Filter and Archived Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label
            htmlFor="catalogue-category-filter"
            className="text-xs font-medium text-muted-foreground shrink-0"
          >
            Category:
          </label>
          <select
            id="catalogue-category-filter"
            data-testid="catalogue-category-filter"
            value={categoryFilter}
            onChange={handlers.onCategoryFilterChange}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[32px]"
          >
            {CATEGORY_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={handlers.onShowArchivedChange}
              data-testid="toggle-show-archived-catalogue"
              className="rounded border-input text-primary focus:ring-primary h-4 w-4"
            />
            <span>Show Archived</span>
          </label>
        </div>
      </div>

      {/* Items Table */}
      {filteredItems.length === 0 ? (
        <div
          data-testid="catalogue-empty-state"
          className="rounded-lg border border-dashed p-8 text-center bg-card/50"
        >
          <Layers className="mx-auto h-10 w-10 text-muted-foreground/60 mb-2" aria-hidden="true" />
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{t('catalogue.empty')}</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card shadow-xs overflow-x-auto">
          <table className="w-full text-sm text-left" data-testid="catalogue-items-table">
            <thead className="text-xs uppercase bg-muted/50 text-muted-foreground border-b font-medium">
              <tr>
                <th scope="col" className="px-4 py-3">
                  {t('catalogue.table.name')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('catalogue.table.category')}
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  {t('catalogue.table.unitPrice')}
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  {t('catalogue.table.taxRate')}
                </th>
                <th scope="col" className="px-4 py-3 text-center">
                  {t('catalogue.table.status')}
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  {t('catalogue.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredItems.map((item) => (
                <tr
                  key={item.id}
                  data-testid={`catalogue-item-row-${item.slug}`}
                  data-item-id={item.id}
                  className="hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    <div>
                      <span className="font-semibold">{item.name}</span>
                      <p className="text-xs text-muted-foreground font-mono">{item.slug}</p>
                      {item.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getCategoryBadgeClasses(item.category)}`}
                    >
                      {t(CATEGORY_NAMES[item.category])}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-foreground">
                    {formatCurrency(item.unitPriceMinor, item.currency, locale)}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {formatTaxRateBasisPoints(item.taxRateBasisPoints)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                        item.isActive
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 dark:bg-emerald-500/20'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {item.isActive ? t('catalogue.active') : t('catalogue.archived')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-item-id={item.id}
                        onClick={handlers.onEditItemClick}
                        data-testid={`edit-catalogue-item-${item.id}`}
                        className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Edit className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                        <span>{t('catalogue.edit')}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-item-id={item.id}
                        onClick={handlers.onToggleArchiveClick}
                        data-testid={`toggle-archive-catalogue-item-${item.id}`}
                        className={`h-8 px-2 text-xs ${
                          item.isActive
                            ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {item.isActive ? (
                          <>
                            <Archive className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                            <span>{t('catalogue.archive')}</span>
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                            <span>{t('catalogue.restore')}</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Item Modal */}
      <CatalogueItemModal
        key={editingItem?.id ?? 'new'}
        item={editingItem}
        isOpen={isModalOpen}
        isSubmitting={isModalSubmitting}
        triggerRef={triggerRef}
        onClose={handlers.handleCloseModal}
        onSave={handlers.handleSaveModal}
      />
    </div>
  );
}
