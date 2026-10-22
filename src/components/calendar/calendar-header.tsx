'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Plus, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface CalendarHeaderProps {
  currentDate: Date;
  currentView: 'month' | 'week' | 'day';
  onViewChange: (view: 'month' | 'week' | 'day') => void;
  onNavigate: (direction: 'prev' | 'next' | 'today') => void;
  onNewAppointment: () => void;
  onBlockTime: () => void;
  locale: string;
  announcement?: string;
}

export function CalendarHeader({
  currentDate,
  currentView,
  onViewChange,
  onNavigate,
  onNewAppointment,
  onBlockTime,
  locale,
  announcement,
}: CalendarHeaderProps) {
  const t = useTranslations('calendar');

  // Format header period label based on currentView and locale
  const periodLabel = React.useMemo(() => {
    const loc = locale === 'de' ? 'de-DE' : 'en-US';
    if (currentView === 'month') {
      return new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }).format(currentDate);
    }
    if (currentView === 'day') {
      return new Intl.DateTimeFormat(loc, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(currentDate);
    }
    // Week
    return new Intl.DateTimeFormat(loc, { month: 'short', year: 'numeric' }).format(currentDate);
  }, [currentDate, currentView, locale]);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-4 border-b">
      {/* Live region for accessibility (AC-3, WCAG SC 4.1.3) */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="calendar-aria-live"
      >
        {announcement ?? t('aria.currentPeriod', { period: periodLabel })}
      </div>

      {/* Left: Navigation and Period Heading */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-1">
          <Button
            variant="outline"
            size="sm"
            data-testid="calendar-today-btn"
            onClick={() => {
              onNavigate('today');
            }}
            aria-label={t('nav.todayAria')}
          >
            {t('nav.today')}
          </Button>

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            data-testid="calendar-prev-btn"
            onClick={() => {
              onNavigate('prev');
            }}
            aria-label={t('nav.prevPeriodAria')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            data-testid="calendar-next-btn"
            onClick={() => {
              onNavigate('next');
            }}
            aria-label={t('nav.nextPeriodAria')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <h2
          className="text-lg font-semibold tracking-tight text-foreground min-w-[140px]"
          data-testid="calendar-period-heading"
        >
          {periodLabel}
        </h2>
      </div>

      {/* Right: View Switcher and Quick Action Modals */}
      <div className="flex flex-wrap items-center gap-2">
        {/* View Switcher (AC-4) */}
        <div
          role="group"
          aria-label={t('views.toggleAria')}
          className="inline-flex rounded-md border bg-muted p-0.5"
          data-testid="calendar-view-toggle-group"
        >
          <button
            type="button"
            data-testid="calendar-view-month-btn"
            onClick={() => {
              onViewChange('month');
            }}
            aria-pressed={currentView === 'month'}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-sm transition-all',
              currentView === 'month'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('views.month')}
          </button>
          <button
            type="button"
            data-testid="calendar-view-week-btn"
            onClick={() => {
              onViewChange('week');
            }}
            aria-pressed={currentView === 'week'}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-sm transition-all',
              currentView === 'week'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('views.week')}
          </button>
          <button
            type="button"
            data-testid="calendar-view-day-btn"
            onClick={() => {
              onViewChange('day');
            }}
            aria-pressed={currentView === 'day'}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-sm transition-all',
              currentView === 'day'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('views.day')}
          </button>
        </div>

        {/* Quick Actions (AC-5, AC-7) */}
        <Button
          size="sm"
          variant="outline"
          data-testid="calendar-quick-block-btn"
          onClick={onBlockTime}
          className="h-8 text-xs"
        >
          <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
          {t('inspector.blockTime')}
        </Button>

        <Button
          size="sm"
          data-testid="calendar-quick-appointment-btn"
          onClick={onNewAppointment}
          className="h-8 text-xs"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t('inspector.newAppointment')}
        </Button>
      </div>
    </div>
  );
}
