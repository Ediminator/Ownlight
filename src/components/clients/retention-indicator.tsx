'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Clock, ShieldAlert, AlertTriangle } from 'lucide-react';
import { formatDate } from '@/lib/formatters';

export interface RetentionIndicatorProps {
  lastActivityAt: Date | string;
  hasActiveHold: boolean;
  retentionMonths?: number;
  locale: string;
}

export function RetentionIndicator({
  lastActivityAt,
  hasActiveHold,
  retentionMonths = 36,
  locale,
}: RetentionIndicatorProps) {
  const t = useTranslations('clients.retentionIndicator');

  const scheduledDate = React.useMemo(() => {
    const d = new Date(lastActivityAt);
    d.setMonth(d.getMonth() + retentionMonths);
    return d;
  }, [lastActivityAt, retentionMonths]);

  const isPastCutoff = React.useMemo(() => {
    return new Date().getTime() >= scheduledDate.getTime();
  }, [scheduledDate]);

  return (
    <div
      className="rounded-lg border bg-muted/20 p-4 space-y-1.5 text-sm"
      data-testid="retention-indicator"
    >
      <div className="flex items-center gap-2 font-medium text-foreground">
        {hasActiveHold ? (
          <ShieldAlert
            className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0"
            aria-hidden="true"
          />
        ) : isPastCutoff ? (
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />
        ) : (
          <Clock className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
        )}
        <span>{t('title')}</span>
      </div>

      <p className="text-xs text-muted-foreground" data-testid="retention-status">
        {hasActiveHold ? (
          <span className="text-amber-700 dark:text-amber-300 font-medium">
            {t('pausedByHold')}
          </span>
        ) : isPastCutoff ? (
          <span className="text-destructive font-medium">{t('pendingErasure')}</span>
        ) : (
          <span>
            {t('scheduledAutomaticErasure', {
              date: formatDate(scheduledDate, locale),
            })}
          </span>
        )}
      </p>
    </div>
  );
}
