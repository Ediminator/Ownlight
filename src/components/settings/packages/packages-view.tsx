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
import type { PackageWithIncludedItems } from '@/server/packages/repo';
import type { CatalogueCategory, CatalogueItem } from '@/server/db/schema/packages';
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

  const [prevPackages, setPrevPackages] = React.useState(initialPackages);
  if (initialPackages !== prevPackages) {
    setPrevPackages(initialPackages);
    setPackagesList(initialPackages);
  }

  const [prevCatalogue, setPrevCatalogue] = React.useState(initialCatalogueItems);
  if (initialCatalogueItems !== prevCatalogue) {
    setPrevCatalogue(initialCatalogueItems);
    setCatalogueList(initialCatalogueItems);
  }

  const [prevTax, setPrevTax] = React.useState(initialTaxSettings);
  if (initialTaxSettings !== prevTax) {
    setPrevTax(initialTaxSettings);
    setTaxSettings(initialTaxSettings);
  }

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

  // Roving keyboard navigation for tabs
  const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') {
      nextIndex = (index + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex !== null) {
      e.preventDefault();
      const target = tabs.find((_, i) => i === nextIndex);
      if (target) {
        setActiveTab(target.id);
        const button = document.getElementById(`tab-${target.id}`);
        button?.focus();
      }
    }
  };

  // Package Server Action Handlers
  const handleSavePackage = async (payload: {
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
  }) => {
    const res = await savePackageAction(payload);
    if (res.success) {
      const saved = res.data;
      setPackagesList((prev) => {
        const index = prev.findIndex((p) => p.id === saved.id);
        if (index >= 0) {
          return prev.map((p, i) => (i === index ? saved : p));
        }
        return [saved, ...prev];
      });
      router.refresh();
      return true;
    }
    return false;
  };

  const handleArchivePackage = async (id: string, isActive = false) => {
    const res = await archivePackageAction({ id, isActive });
    if (res.success) {
      setPackagesList((prev) => prev.map((pkg) => (pkg.id === id ? { ...pkg, isActive } : pkg)));
      router.refresh();
      return true;
    }
    return false;
  };

  // Catalogue Server Action Handlers
  const handleSaveCatalogueItem = async (payload: {
    id?: string;
    name: string;
    slug: string;
    category: CatalogueCategory;
    unitPriceMinor: number;
    taxRateBasisPoints: number;
    description: string | null;
    isActive: boolean;
  }) => {
    const res = await saveCatalogueItemAction(payload);
    if (res.success) {
      const saved = res.data;
      setCatalogueList((prev) => {
        const index = prev.findIndex((i) => i.id === saved.id);
        if (index >= 0) {
          return prev.map((item, i) => (i === index ? saved : item));
        }
        return [saved, ...prev];
      });
      router.refresh();
      return true;
    }
    return false;
  };

  const handleArchiveCatalogueItem = async (id: string, isActive = false) => {
    const res = await archiveCatalogueItemAction({ id, isActive });
    if (res.success) {
      setCatalogueList((prev) =>
        prev.map((item) => (item.id === id ? { ...item, isActive } : item)),
      );
      router.refresh();
      return true;
    }
    return false;
  };

  // Tax Settings Server Action Handler
  const handleUpdateTaxSettings = async (payload: {
    taxNumber?: string | null;
    vatId?: string | null;
    isKleinunternehmer?: boolean;
    kleinunternehmerNotice?: string | null;
    defaultTaxRateBasisPoints?: number;
    pricesIncludeTax?: boolean;
  }) => {
    const res = await updateStudioTaxSettingsAction(payload);
    if (res.success) {
      setTaxSettings(res.data);
      router.refresh();
      return true;
    }
    return false;
  };

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
              onClick={() => {
                setActiveTab(tab.id);
              }}
              onKeyDown={(e) => {
                handleTabKeyDown(e, index);
              }}
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
            onSavePackage={handleSavePackage}
            onArchivePackage={handleArchivePackage}
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
            onSaveCatalogueItem={handleSaveCatalogueItem}
            onArchiveCatalogueItem={handleArchiveCatalogueItem}
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
            onUpdateTaxSettings={handleUpdateTaxSettings}
          />
        </div>
      )}
    </div>
  );
}
