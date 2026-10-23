'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Calendar, CheckCircle2, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import {
  startGoogleCalendarAuthAction,
  toggleGoogleCalendarSyncAction,
  selectGoogleCalendarAction,
  triggerManualCalendarSyncAction,
  getGoogleCalendarSettingsAction,
} from '@/server/integrations/google/calendar-actions';
import {
  formatCalendarSyncDate,
  getCalendarSyncState,
  formatCalendarOptions,
  type CalendarOption,
} from './google-calendar-sync-helper';

export interface GoogleCalendarSyncCardProps {
  configured: boolean;
  connected: boolean;
  hasCalendarScope?: boolean;
  calendarSyncEnabled?: boolean;
  selectedCalendarId?: string | null;
  lastCalendarSyncAt?: Date | string | null;
  lastCalendarSyncError?: string | null;
  locale: string;
}

export function GoogleCalendarSyncCard({
  configured,
  connected,
  hasCalendarScope: initialHasCalendarScope = false,
  calendarSyncEnabled: initialCalendarSyncEnabled = false,
  selectedCalendarId: initialSelectedCalendarId = 'primary',
  lastCalendarSyncAt: initialLastCalendarSyncAt = null,
  lastCalendarSyncError: initialLastCalendarSyncError = null,
  locale,
}: GoogleCalendarSyncCardProps) {
  const t = useTranslations('settings.integrations.google');

  const [hasCalendarScope, setHasCalendarScope] = React.useState(initialHasCalendarScope);
  const [calendarSyncEnabled, setCalendarSyncEnabled] = React.useState(initialCalendarSyncEnabled);
  const [selectedCalendarId, setSelectedCalendarId] = React.useState(
    initialSelectedCalendarId ?? 'primary',
  );
  const [lastCalendarSyncAt, setLastCalendarSyncAt] = React.useState<Date | string | null>(
    initialLastCalendarSyncAt,
  );
  const [lastCalendarSyncError, setLastCalendarSyncError] = React.useState<string | null>(
    initialLastCalendarSyncError,
  );
  const [calendars, setCalendars] = React.useState<CalendarOption[]>([
    { id: 'primary', label: t('calendarSelectorPrimary'), isPrimary: true },
  ]);

  const [isAuthorizing, setIsAuthorizing] = React.useState(false);
  const [isToggling, setIsToggling] = React.useState(false);
  const [isSelectingCalendar, setIsSelectingCalendar] = React.useState(false);
  const [isSyncing, setIsSyncing] = React.useState(false);

  const [feedback, setFeedback] = React.useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Fetch full calendar settings & calendar list when connected and scoped
  React.useEffect(() => {
    let isMounted = true;
    if (connected && hasCalendarScope) {
      void getGoogleCalendarSettingsAction().then((res) => {
        if (isMounted && res.success && res.data) {
          setHasCalendarScope(res.data.hasCalendarScope);
          setCalendarSyncEnabled(res.data.calendarSyncEnabled);
          setSelectedCalendarId(res.data.selectedCalendarId);
          setLastCalendarSyncAt(res.data.lastCalendarSyncAt);
          setLastCalendarSyncError(res.data.lastCalendarSyncError);
          setCalendars(formatCalendarOptions(res.data.calendars, t('calendarSelectorPrimary')));
        }
      });
    }
    return () => {
      isMounted = false;
    };
  }, [connected, hasCalendarScope, t]);

  const handleAuthorizeCalendar = async () => {
    setIsAuthorizing(true);
    setFeedback(null);
    try {
      const res = await startGoogleCalendarAuthAction();
      if (res.success && res.data?.url) {
        window.location.href = res.data.url;
      } else {
        setIsAuthorizing(false);
        setFeedback({
          type: 'error',
          message: res.error ?? t('errorGeneric'),
        });
      }
    } catch {
      setIsAuthorizing(false);
      setFeedback({
        type: 'error',
        message: t('errorGeneric'),
      });
    }
  };

  const handleToggleSync = async (enabled: boolean) => {
    setIsToggling(true);
    setFeedback(null);
    try {
      const res = await toggleGoogleCalendarSyncAction({ enabled });
      setIsToggling(false);
      if (res.success && res.data) {
        setCalendarSyncEnabled(res.data.enabled);
      } else {
        setFeedback({
          type: 'error',
          message: res.error ?? t('errorGeneric'),
        });
      }
    } catch {
      setIsToggling(false);
      setFeedback({
        type: 'error',
        message: t('errorGeneric'),
      });
    }
  };

  const handleSelectCalendar = async (calId: string) => {
    setIsSelectingCalendar(true);
    setFeedback(null);
    try {
      const res = await selectGoogleCalendarAction({ calendarId: calId });
      setIsSelectingCalendar(false);
      if (res.success && res.data) {
        setSelectedCalendarId(res.data.calendarId);
      } else {
        setFeedback({
          type: 'error',
          message: res.error ?? t('errorGeneric'),
        });
      }
    } catch {
      setIsSelectingCalendar(false);
      setFeedback({
        type: 'error',
        message: t('errorGeneric'),
      });
    }
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    setFeedback(null);
    try {
      const res = await triggerManualCalendarSyncAction();
      setIsSyncing(false);
      if (res.success && res.data) {
        const now = new Date();
        setLastCalendarSyncAt(now);
        setLastCalendarSyncError(null);
        setFeedback({
          type: 'success',
          message: t('calendarSyncSuccessFeedback'),
        });
      } else {
        const errorMsg = res.error ?? t('errorGeneric');
        setLastCalendarSyncError(errorMsg);
        setFeedback({
          type: 'error',
          message: t('calendarSyncErrorFeedback', { error: errorMsg }),
        });
      }
    } catch {
      setIsSyncing(false);
      const errorMsg = t('errorGeneric');
      setLastCalendarSyncError(errorMsg);
      setFeedback({
        type: 'error',
        message: t('calendarSyncErrorFeedback', { error: errorMsg }),
      });
    }
  };

  const syncState = getCalendarSyncState({
    connected,
    hasCalendarScope,
    syncEnabled: calendarSyncEnabled,
  });

  const formattedLastSynced = formatCalendarSyncDate(lastCalendarSyncAt, locale);

  return (
    <div
      data-testid="google-calendar-card"
      className="rounded-lg border bg-card p-4 sm:p-6 text-card-foreground shadow-sm space-y-6 min-w-0 max-w-full overflow-hidden"
    >
      {/* Header and Scope Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <Calendar className="h-6 w-6 text-primary shrink-0" aria-hidden="true" />
            <h2 className="text-lg font-bold tracking-tight text-foreground break-words">
              {t('calendarTitle')}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground break-words">{t('calendarDescription')}</p>
        </div>

        <div className="shrink-0">
          <span
            data-testid="calendar-scope-indicator"
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
              hasCalendarScope && connected
                ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                : 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300 border-amber-300 dark:border-amber-800'
            }`}
          >
            {hasCalendarScope && connected ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('calendarScopeIndicatorGranted')}</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('calendarScopeIndicatorNeedsAuth')}</span>
              </>
            )}
          </span>
        </div>
      </div>

      {/* Immediate User Feedback Notification */}
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          data-testid="calendar-sync-feedback"
          className={`p-3.5 rounded-lg border text-sm flex items-start gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900'
              : 'bg-destructive/10 text-destructive border-destructive/20'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2
              className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5"
              aria-hidden="true"
            />
          ) : (
            <AlertTriangle
              className="h-4 w-4 shrink-0 text-destructive mt-0.5"
              aria-hidden="true"
            />
          )}
          <span className="font-medium text-xs sm:text-sm">{feedback.message}</span>
        </div>
      )}

      {/* Unconnected or Needs Scope Banner */}
      {!hasCalendarScope && (
        <div className="rounded-md border p-4 bg-muted/40 space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              {t('calendarScopeIndicatorNeedsAuth')}
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('calendarScopeIndicatorNeedsAuthDesc')}
            </p>
          </div>
          <div>
            <button
              type="button"
              disabled={isAuthorizing || !configured}
              onClick={() => {
                void handleAuthorizeCalendar();
              }}
              data-testid="calendar-authorize-button"
              className="inline-flex items-center justify-center gap-2 rounded-md text-xs sm:text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[36px] px-4 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {isAuthorizing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <span>{t('authorizingCalendarButton')}</span>
                </>
              ) : (
                <>
                  <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t('authorizeCalendarButton')}</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Settings Grid: Toggle & Calendar Dropdown */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Toggle Switch */}
        <div className="rounded-lg border p-4 bg-muted/20 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor="calendar-sync-toggle"
              className="text-sm font-semibold text-foreground cursor-pointer"
            >
              {t('calendarSyncToggleLabel')}
            </label>
            <input
              id="calendar-sync-toggle"
              data-testid="calendar-sync-toggle"
              type="checkbox"
              role="switch"
              checked={calendarSyncEnabled}
              disabled={isToggling || !hasCalendarScope || !connected}
              onChange={(e) => {
                void handleToggleSync(e.target.checked);
              }}
              className="h-5 w-5 rounded border-border text-primary focus:ring-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('calendarSyncToggleDescription')}
          </p>
        </div>

        {/* Calendar Selector Dropdown */}
        <div className="rounded-lg border p-4 bg-muted/20 space-y-2">
          <label htmlFor="calendar-select" className="text-sm font-semibold text-foreground block">
            {t('calendarSelectorLabel')}
          </label>
          <select
            id="calendar-select"
            data-testid="calendar-select-dropdown"
            value={selectedCalendarId}
            disabled={isSelectingCalendar || !hasCalendarScope || !connected}
            onChange={(e) => {
              void handleSelectCalendar(e.target.value);
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {calendars.map((cal) => (
              <option key={cal.id} value={cal.id}>
                {cal.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('calendarSelectorDescription')}
          </p>
        </div>
      </div>

      {/* Status & Manual Sync Section */}
      <div className="rounded-lg border p-4 bg-muted/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t('syncStatusTitle')}:
            </span>
            <span
              data-testid="calendar-connection-status"
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                syncState === 'active'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {syncState === 'active'
                ? t('calendarStatusActive')
                : syncState === 'inactive'
                  ? t('calendarStatusInactive')
                  : t('calendarStatusDisconnected')}
            </span>
          </div>

          <div data-testid="calendar-last-synced" className="text-xs text-muted-foreground">
            {formattedLastSynced
              ? t('calendarLastSyncedAt', { date: formattedLastSynced })
              : t('calendarNeverSynced')}
          </div>

          {lastCalendarSyncError && (
            <div
              role="alert"
              data-testid="calendar-last-error"
              className="text-xs text-destructive dark:text-red-400 font-medium break-words"
            >
              {t('calendarLastSyncError', { error: lastCalendarSyncError })}
            </div>
          )}
        </div>

        <div>
          <button
            type="button"
            disabled={isSyncing || !hasCalendarScope || !connected}
            onClick={() => {
              void handleManualSync();
            }}
            data-testid="calendar-sync-now-button"
            className="inline-flex items-center justify-center gap-2 rounded-md text-xs sm:text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px] px-4 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 shadow-sm"
          >
            {isSyncing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span>{t('calendarSyncingButton')}</span>
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('calendarSyncNowButton')}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
