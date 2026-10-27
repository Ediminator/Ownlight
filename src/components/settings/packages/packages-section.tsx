'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Plus, Package as PackageIcon, Archive, RefreshCw, Edit, Sparkles } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import {
  formatTaxRateBasisPoints,
  splitPackagesByActiveStatus,
  filterPackagesByProjectType,
} from './packages-helpers';
import { PackageModal } from './package-modal';
import { PackageArchiveDialog } from './package-archive-dialog';
import type { PackageWithIncludedItems } from '@/server/packages/repo';

export interface PackagesSectionProps {
  initialPackages: PackageWithIncludedItems[];
  locale?: string;
  onSavePackage: (payload: {
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
  onArchivePackage: (id: string, isActive?: boolean) => Promise<boolean>;
}

const PROJECT_TYPE_FILTER_OPTIONS: {
  value: string;
  labelKey?: 'list.filterAll';
  label?: string;
}[] = [
  { value: 'all', labelKey: 'list.filterAll' },
  { value: 'wedding', label: 'Wedding' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'event', label: 'Event' },
  { value: 'video', label: 'Video' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'editorial', label: 'Editorial' },
];

export function PackagesSection({
  initialPackages,
  locale = 'en',
  onSavePackage,
  onArchivePackage,
}: PackagesSectionProps) {
  const t = useTranslations('settings.packages');

  const [typeFilter, setTypeFilter] = React.useState('all');
  const [showArchived, setShowArchived] = React.useState(false);

  // Modal states
  const [editingPackage, setEditingPackage] = React.useState<PackageWithIncludedItems | null>(null);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [isModalSubmitting, setIsModalSubmitting] = React.useState(false);

  // Archive dialog states
  const [archivingPackage, setArchivingPackage] = React.useState<PackageWithIncludedItems | null>(
    null,
  );
  const [isArchiveSubmitting, setIsArchiveSubmitting] = React.useState(false);

  // Trigger ref for accessible Radix focus restoration
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const { active, archived } = React.useMemo(
    () => splitPackagesByActiveStatus(initialPackages),
    [initialPackages],
  );

  const filteredActive = React.useMemo(
    () => filterPackagesByProjectType(active, typeFilter),
    [active, typeFilter],
  );

  const filteredArchived = React.useMemo(
    () => filterPackagesByProjectType(archived, typeFilter),
    [archived, typeFilter],
  );

  const handleOpenCreateModal = (e: React.MouseEvent<HTMLButtonElement>) => {
    triggerRef.current = e.currentTarget;
    setEditingPackage(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (
    pkg: PackageWithIncludedItems,
    e: React.MouseEvent<HTMLButtonElement>,
  ) => {
    triggerRef.current = e.currentTarget;
    setEditingPackage(pkg);
    setIsModalOpen(true);
  };

  const handleOpenArchiveDialog = (
    pkg: PackageWithIncludedItems,
    e: React.MouseEvent<HTMLButtonElement>,
  ) => {
    triggerRef.current = e.currentTarget;
    setArchivingPackage(pkg);
  };

  const handleSaveModal = async (payload: Parameters<typeof onSavePackage>[0]) => {
    setIsModalSubmitting(true);
    try {
      const ok = await onSavePackage(payload);
      return ok;
    } finally {
      setIsModalSubmitting(false);
    }
  };

  const handleConfirmArchive = async (pkg: PackageWithIncludedItems) => {
    setIsArchiveSubmitting(true);
    try {
      await onArchivePackage(pkg.id, false);
      setArchivingPackage(null);
    } finally {
      setIsArchiveSubmitting(false);
    }
  };

  const handleRestore = async (pkgId: string) => {
    await onArchivePackage(pkgId, true);
  };

  return (
    <div className="space-y-6" data-testid="packages-section">
      {/* Header & Create Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b">
        <div className="space-y-1">
          <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {t('list.title')}
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">{t('list.description')}</p>
        </div>
        <Button
          type="button"
          onClick={handleOpenCreateModal}
          data-testid="create-package-button"
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 min-h-[36px] shadow-sm self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{t('list.createButton')}</span>
        </Button>
      </div>

      {/* Filter and Count Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label
            htmlFor="package-type-filter"
            className="text-xs font-medium text-muted-foreground shrink-0"
          >
            {t('list.filterByType')}:
          </label>
          <select
            id="package-type-filter"
            data-testid="package-type-filter"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
            }}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[32px]"
          >
            {PROJECT_TYPE_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.labelKey ? t(opt.labelKey) : opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{t('list.activeCount', { count: active.length })}</span>
          {archived.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowArchived((prev) => !prev);
              }}
              data-testid="toggle-archived-packages"
              className="text-xs text-muted-foreground hover:text-foreground h-8 px-2"
            >
              <Archive className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              <span>
                {showArchived
                  ? t('list.hideArchived')
                  : t('list.showArchived', { count: archived.length })}
              </span>
            </Button>
          )}
        </div>
      </div>

      {/* Active Packages List */}
      {filteredActive.length === 0 ? (
        <div
          data-testid="packages-empty-state"
          className="rounded-lg border border-dashed p-8 text-center bg-card/50"
        >
          <PackageIcon
            className="mx-auto h-10 w-10 text-muted-foreground/60 mb-2"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{t('list.emptyActive')}</p>
        </div>
      ) : (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="active-packages-list"
        >
          {filteredActive.map((pkg) => (
            <div
              key={pkg.id}
              data-testid={`package-card-${pkg.slug}`}
              data-package-id={pkg.id}
              className="rounded-lg border bg-card p-5 text-card-foreground shadow-xs flex flex-col justify-between space-y-4 hover:border-border/80 transition-colors"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <h3 className="font-semibold text-foreground text-base tracking-tight leading-snug">
                      {pkg.name}
                    </h3>
                    <p className="text-xs text-muted-foreground font-mono">{pkg.slug}</p>
                  </div>
                  {pkg.projectTypeKey && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground shrink-0 capitalize">
                      {pkg.projectTypeKey}
                    </span>
                  )}
                </div>

                {pkg.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{pkg.description}</p>
                )}

                <div className="pt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                  <div>
                    <span className="text-muted-foreground mr-1">{t('list.basePrice')}:</span>
                    <span className="font-semibold text-foreground text-sm">
                      {formatCurrency(pkg.basePriceMinor, pkg.currency, locale)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground mr-1">{t('list.taxRate')}:</span>
                    <span className="font-medium text-foreground">
                      {formatTaxRateBasisPoints(pkg.taxRateBasisPoints)}
                    </span>
                  </div>
                </div>

                {/* Included Deliverables preview */}
                <div className="pt-2 border-t">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    <span>{t('list.deliverablesCount', { count: pkg.includedItems.length })}</span>
                  </div>
                  {pkg.includedItems.length > 0 && (
                    <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                      {pkg.includedItems.slice(0, 3).map((item) => (
                        <li key={item.id} className="truncate">
                          {item.quantity > 1 ? `${String(item.quantity)}× ` : ''}
                          {item.title}
                        </li>
                      ))}
                      {pkg.includedItems.length > 3 && (
                        <li className="list-none text-[11px] text-muted-foreground/80 pl-2">
                          +{pkg.includedItems.length - 3} more...
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    handleOpenEditModal(pkg, e);
                  }}
                  data-testid={`edit-package-${pkg.id}`}
                  className="h-8 px-2.5 text-xs gap-1.5 min-h-[32px]"
                >
                  <Edit className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t('list.editAction')}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    handleOpenArchiveDialog(pkg, e);
                  }}
                  data-testid={`archive-package-${pkg.id}`}
                  className="h-8 px-2.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 min-h-[32px]"
                >
                  <Archive className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                  <span>{t('list.archiveAction')}</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Archived Packages Section (if toggled open) */}
      {showArchived && (
        <div
          data-testid="archived-packages-section"
          className="rounded-lg border bg-muted/20 p-5 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="font-semibold text-foreground text-sm tracking-tight">
              {t('list.archivedCount', { count: filteredArchived.length })}
            </h3>
          </div>

          {filteredArchived.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">{t('list.emptyArchived')}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredArchived.map((pkg) => (
                <div
                  key={pkg.id}
                  data-testid={`archived-package-${pkg.id}`}
                  className="rounded-md border bg-card p-4 text-card-foreground opacity-85 flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-medium text-foreground text-sm">{pkg.name}</h4>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                        {t('list.archivedBadge')}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">{pkg.slug}</p>
                    <p className="text-xs font-semibold text-foreground pt-1">
                      {formatCurrency(pkg.basePriceMinor, pkg.currency, locale)}
                    </p>
                  </div>

                  <div className="flex items-center justify-end pt-2 border-t">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void handleRestore(pkg.id);
                      }}
                      data-testid={`restore-package-${pkg.id}`}
                      className="h-8 px-2.5 text-xs gap-1.5 min-h-[32px]"
                    >
                      <RefreshCw className="h-3 w-3" aria-hidden="true" />
                      <span>{t('list.restoreAction')}</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Package Creation & Edit Modal */}
      <PackageModal
        pkg={editingPackage}
        isOpen={isModalOpen}
        isSubmitting={isModalSubmitting}
        triggerRef={triggerRef}
        onClose={() => {
          setIsModalOpen(false);
        }}
        onSave={handleSaveModal}
      />

      {/* Package Archive Confirmation Dialog */}
      <PackageArchiveDialog
        pkg={archivingPackage}
        isOpen={Boolean(archivingPackage)}
        isSubmitting={isArchiveSubmitting}
        triggerRef={triggerRef}
        onClose={() => {
          setArchivingPackage(null);
        }}
        onConfirm={(pkg) => {
          void handleConfirmArchive(pkg);
        }}
      />
    </div>
  );
}
