'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { ChevronRight, Package, Layers, Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PackagesSection } from './packages-section';
import { CatalogueSection } from './catalogue-section';
import { TaxSettingsSection } from './tax-settings-section';
import { savePackageAction, archivePackageAction } from '@/server/packages/actions';
import { saveCatalogueItemAction, archiveCatalogueItemAction } from '@/server/catalogue/actions';
import { updateStudioTaxSettingsAction } from '@/server/studio/actions';
import { createPackagesViewHandlers, createPackagesViewActionHandlers } from './packages-helpers';
import type { PackageWithIncludedItems } from '@/server/packages/repo';
import type { CatalogueItem } from '@/server/db/schema/packages';
import type { StudioSettings } from '@/server/db/schema/studio-settings';

export type PackagesTab = 'packages' | 'catalogue' | 'tax';

export interface PackagesViewProps {
  initialPackages: PackageWithIncludedItems[];
  initialCatalogueItems: CatalogueItem[];
  initialTaxSettings: StudioSettings;
  locale?: string;
  defaultTab?: PackagesTab;
}

export function PackagesView({
  initialPackages,
  initialCatalogueItems,
  initialTaxSettings,
  locale = 'en',
  defaultTab = 'packages',
}: PackagesViewProps) {
  const t = useTranslations('settings.packages');
  const router = useRouter();

  const [activeTab, setActiveTab] = React.useState<PackagesTab>(defaultTab);

  // Local state for immediate reactive UI updates
  const [packagesList, setPackagesList] =
    React.useState<PackageWithIncludedItems[]>(initialPackages);
  const [catalogueList, setCatalogueList] = React.useState<CatalogueItem[]>(initialCatalogueItems);
  const [taxSettings, setTaxSettings] = React.useState<StudioSettings>(initialTaxSettings);

  const tabs = [
    {
      id: 'packages' as const,
      testId: 'tab-packages',
      label: t('tabs.packages'),
      icon: Package,
    },
    {
      id: 'catalogue' as const,
      testId: 'tab-catalogue',
      label: t('tabs.catalogue'),
      icon: Layers,
    },
    {
      id: 'tax' as const,
      testId: 'tab-tax',
      label: t('tabs.tax'),
      icon: Landmark,
    },
  ];

  const { onTabClick, onTabKeyDown } = createPackagesViewHandlers(setActiveTab);
  const actionHandlers = createPackagesViewActionHandlers({
    setPackagesList,
    setCatalogueList,
    setTaxSettings,
    router,
    savePackageAction,
    archivePackageAction,
    saveCatalogueItemAction,
    archiveCatalogueItemAction,
    updateStudioTaxSettingsAction,
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="packages-settings-view">
      {/* Breadcrumbs */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Link
          href="/settings"
          className="hover:text-foreground transition-colors"
          data-testid="breadcrumb-settings"
        >
          {t('breadcrumbs.settings')}
        </Link>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />
        <span className="font-medium text-foreground select-none" aria-current="page">
          {t('breadcrumbs.packages')}
        </span>
      </nav>

      {/* Page Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground max-w-3xl">{t('description')}</p>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label={t('tabs.tablistAria')}
        className="flex border-b border-border space-x-2"
      >
        {tabs.map((tab, index) => {
          const Icon = tab.icon;
          const isSelected = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={isSelected}
              aria-controls={`tabpanel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              data-testid={tab.testId}
              data-tab={tab.id}
              data-index={index}
              onClick={onTabClick}
              onKeyDown={onTabKeyDown}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors min-h-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                isSelected
                  ? 'border-primary text-primary font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      {activeTab === 'packages' && (
        <div
          role="tabpanel"
          id="tabpanel-packages"
          data-testid="tabpanel-packages"
          aria-labelledby="tab-packages"
          className="pt-2 focus:outline-none"
        >
          <PackagesSection
            initialPackages={packagesList}
            locale={locale}
            onSavePackage={actionHandlers.handleSavePackage}
            onArchivePackage={actionHandlers.handleArchivePackage}
          />
        </div>
      )}

      {activeTab === 'catalogue' && (
        <div
          role="tabpanel"
          id="tabpanel-catalogue"
          data-testid="tabpanel-catalogue"
          aria-labelledby="tab-catalogue"
          className="pt-2 focus:outline-none"
        >
          <CatalogueSection
            initialItems={catalogueList}
            locale={locale}
            onSaveCatalogueItem={actionHandlers.handleSaveCatalogueItem}
            onArchiveCatalogueItem={actionHandlers.handleArchiveCatalogueItem}
          />
        </div>
      )}

      {activeTab === 'tax' && (
        <div
          role="tabpanel"
          id="tabpanel-tax"
          data-testid="tabpanel-tax"
          aria-labelledby="tab-tax"
          className="pt-2 focus:outline-none"
        >
          <TaxSettingsSection
            initialSettings={taxSettings}
            locale={locale}
            onUpdateTaxSettings={actionHandlers.handleUpdateTaxSettings}
          />
        </div>
      )}
    </div>
  );
}
