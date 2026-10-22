'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type {
  AvailabilitySchedule,
  AvailabilityOverride,
  BookingType,
} from '@/server/db/schema/calendar';
import { WeeklyScheduleEditor } from './weekly-schedule-editor';
import { DateOverridesManager } from './date-overrides-manager';
import { BookingTypesManager } from './booking-types-manager';
import { ChevronRight, Calendar, Clock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AvailabilityTab = 'schedules' | 'overrides' | 'booking-types';

interface AvailabilitySettingsViewProps {
  initialSchedules: AvailabilitySchedule[];
  initialOverrides: AvailabilityOverride[];
  initialBookingTypes: BookingType[];
  locale: string;
  defaultTab?: AvailabilityTab;
}

export function AvailabilitySettingsView({
  initialSchedules,
  initialOverrides,
  initialBookingTypes,
  locale,
  defaultTab = 'schedules',
}: AvailabilitySettingsViewProps) {
  const t = useTranslations('settings.availability');
  const [activeTab, setActiveTab] = React.useState<AvailabilityTab>(defaultTab);

  const tabs = [
    {
      id: 'schedules' as const,
      testId: 'tab-weekly-schedule',
      label: t('tabs.weeklySchedule'),
      icon: Clock,
    },
    {
      id: 'overrides' as const,
      testId: 'tab-date-overrides',
      label: t('tabs.dateOverrides'),
      icon: Calendar,
    },
    {
      id: 'booking-types' as const,
      testId: 'tab-booking-types',
      label: t('tabs.bookingTypes'),
      icon: Sparkles,
    },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Breadcrumbs (AC-1) */}
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
          {t('breadcrumbs.availability')}
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
      <div className="space-y-6">
        <div
          role="tablist"
          aria-label={t('tablistAria')}
          className="flex border-b border-border gap-2 overflow-x-auto"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={isSelected}
                aria-controls={`panel-${tab.id}`}
                tabIndex={isSelected ? 0 : -1}
                data-testid={tab.testId}
                onClick={() => {
                  setActiveTab(tab.id);
                }}
                className={cn(
                  'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isSelected
                    ? 'border-primary text-foreground font-semibold'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Panels */}
        <div
          id="panel-schedules"
          role="tabpanel"
          aria-labelledby="tab-schedules"
          hidden={activeTab !== 'schedules'}
          className={activeTab === 'schedules' ? 'block' : 'hidden'}
        >
          {activeTab === 'schedules' && (
            <WeeklyScheduleEditor initialSchedules={initialSchedules} locale={locale} />
          )}
        </div>

        <div
          id="panel-overrides"
          role="tabpanel"
          aria-labelledby="tab-overrides"
          hidden={activeTab !== 'overrides'}
          className={activeTab === 'overrides' ? 'block' : 'hidden'}
        >
          {activeTab === 'overrides' && (
            <DateOverridesManager initialOverrides={initialOverrides} locale={locale} />
          )}
        </div>

        <div
          id="panel-booking-types"
          role="tabpanel"
          aria-labelledby="tab-booking-types"
          hidden={activeTab !== 'booking-types'}
          className={activeTab === 'booking-types' ? 'block' : 'hidden'}
        >
          {activeTab === 'booking-types' && (
            <BookingTypesManager initialBookingTypes={initialBookingTypes} locale={locale} />
          )}
        </div>
      </div>
    </div>
  );
}
