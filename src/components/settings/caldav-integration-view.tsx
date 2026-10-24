'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  CalendarSync,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Loader2,
  ArrowLeft,
  RefreshCw,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  testCaldavConnectionAction,
  saveCaldavAccountAction,
  disconnectCaldavAccountAction,
  triggerManualCaldavSyncAction,
} from '@/server/integrations/caldav/actions';
import type { CaldavAccountStatus } from '@/server/integrations/caldav/repo';
import {
  validateCaldavCredentials,
  formatLastSynced,
  clearFieldError,
  togglePasswordVisibility,
  resolveSelectedCalendarName,
  type CaldavFormErrors,
} from './caldav-integration-helpers';

export interface DiscoveredCalendar {
  url: string;
  displayName: string;
  color?: string;
}

export interface CaldavIntegrationViewProps {
  initialStatus: CaldavAccountStatus;
  locale: string;
  initialStep?: 'credentials' | 'select_calendar';
  initialDiscoveredCalendars?: DiscoveredCalendar[];
  initialSelectedCalendarUrl?: string;
  initialNotification?: { type: 'success' | 'error'; message: string } | null;
  initialErrors?: CaldavFormErrors;
  initialShowPassword?: boolean;
}

export interface CaldavViewControllerOptions {
  serverUrl: string;
  setServerUrl: (val: string) => void;
  username: string;
  setUsername: (val: string) => void;
  password: string;
  setPassword: (val: string) => void;
  showPassword: boolean;
  setShowPassword: React.Dispatch<React.SetStateAction<boolean>>;
  errors: CaldavFormErrors;
  setErrors: React.Dispatch<React.SetStateAction<CaldavFormErrors>>;
  discoveredCalendars: DiscoveredCalendar[];
  setDiscoveredCalendars: (val: DiscoveredCalendar[]) => void;
  selectedCalendarUrl: string;
  setSelectedCalendarUrl: (val: string) => void;
  status: CaldavAccountStatus;
  setStatus: React.Dispatch<React.SetStateAction<CaldavAccountStatus>>;
  setStep: (step: 'credentials' | 'select_calendar') => void;
  setIsTesting: (val: boolean) => void;
  setIsSaving: (val: boolean) => void;
  setIsSyncing: (val: boolean) => void;
  setIsDisconnecting: (val: boolean) => void;
  setIsDisconnectDialogOpen: (val: boolean) => void;
  setNotification: (val: { type: 'success' | 'error'; message: string } | null) => void;
  t: (key: string, values?: Record<string, string | number | Date>) => string;
  testAction?: typeof testCaldavConnectionAction;
  saveAction?: typeof saveCaldavAccountAction;
  syncAction?: typeof triggerManualCaldavSyncAction;
  disconnectAction?: typeof disconnectCaldavAccountAction;
}

export interface CaldavViewController {
  showPassword: boolean;
  handleServerUrlChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleUsernameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handlePasswordChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleCalendarSelectChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  handleManualSyncClick: () => void;
  handleTestAndDiscoverSubmit: (e: React.SyntheticEvent) => void;
  handleSaveAndConnectClick: () => void;
  handleConfirmDisconnectClick: () => void;
  onTogglePasswordVisibility: () => void;
  onTestAndDiscover: (e?: React.SyntheticEvent) => Promise<void>;
  onSaveAndConnect: () => Promise<void>;
  onManualSync: () => Promise<void>;
  onOpenDisconnectDialog: () => void;
  onCloseDisconnectDialog: () => void;
  onConfirmDisconnect: () => Promise<void>;
  onBackToCredentials: () => void;
}

export function createCaldavViewController({
  serverUrl,
  setServerUrl,
  username,
  setUsername,
  password,
  setPassword,
  showPassword,
  setShowPassword,
  errors,
  setErrors,
  discoveredCalendars,
  setDiscoveredCalendars,
  selectedCalendarUrl,
  setSelectedCalendarUrl,
  setStatus,
  setStep,
  setIsTesting,
  setIsSaving,
  setIsSyncing,
  setIsDisconnecting,
  setIsDisconnectDialogOpen,
  setNotification,
  t,
  testAction = testCaldavConnectionAction,
  saveAction = saveCaldavAccountAction,
  syncAction = triggerManualCaldavSyncAction,
  disconnectAction = disconnectCaldavAccountAction,
}: CaldavViewControllerOptions): CaldavViewController {
  const onTestAndDiscover = async (e?: React.SyntheticEvent) => {
    if (e) e.preventDefault();
    setNotification(null);

    const validation = validateCaldavCredentials(
      { serverUrl, username, password },
      {
        serverUrlRequired: t('errorServerUrlRequired'),
        invalidServerUrl: t('errorInvalidServerUrl'),
        usernameRequired: t('errorUsernameRequired'),
        passwordRequired: t('errorPasswordRequired'),
      },
    );

    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }
    setErrors({});
    setIsTesting(true);

    try {
      const res = await testAction({
        serverUrl: serverUrl.trim(),
        username: username.trim(),
        password,
      });

      setIsTesting(false);
      if (res.success && res.data) {
        setDiscoveredCalendars(res.data.calendars);
        if (res.data.calendars.length > 0) {
          setSelectedCalendarUrl(res.data.calendars[0]?.url ?? '');
        }
        setStep('select_calendar');
        setNotification({
          type: 'success',
          message: t('successTested', { count: res.data.calendars.length }),
        });
      } else {
        setNotification({
          type: 'error',
          message: res.error ?? t('errorGeneric'),
        });
      }
    } catch {
      setIsTesting(false);
      setNotification({
        type: 'error',
        message: t('errorGeneric'),
      });
    }
  };

  const onSaveAndConnect = async () => {
    if (!selectedCalendarUrl) {
      setErrors({ calendar: t('errorCalendarRequired') });
      return;
    }

    setErrors({});
    setIsSaving(true);
    setNotification(null);

    const selectedCalendarName = resolveSelectedCalendarName(
      discoveredCalendars,
      selectedCalendarUrl,
    );

    try {
      const res = await saveAction({
        serverUrl: serverUrl.trim(),
        username: username.trim(),
        password,
        selectedCalendarUrl,
        selectedCalendarName,
      });

      setIsSaving(false);
      if (res.success) {
        setStatus({
          connected: true,
          serverUrl: serverUrl.trim(),
          username: username.trim(),
          selectedCalendarUrl,
          selectedCalendarName,
          lastSyncedAt: null,
          lastSyncStatus: null,
        });
        setPassword('');
        setNotification({
          type: 'success',
          message: t('successConnected'),
        });
      } else {
        setNotification({
          type: 'error',
          message: res.error ?? t('errorGeneric'),
        });
      }
    } catch {
      setIsSaving(false);
      setNotification({
        type: 'error',
        message: t('errorGeneric'),
      });
    }
  };

  const onManualSync = async () => {
    setIsSyncing(true);
    setNotification(null);

    try {
      const res = await syncAction();
      setIsSyncing(false);
      if (res.success && res.data) {
        setStatus((prev: CaldavAccountStatus) => ({
          ...prev,
          lastSyncedAt: new Date(),
          lastSyncStatus: 'COMPLETED',
          lastSyncError: null,
        }));
        setNotification({
          type: 'success',
          message: t('successSync', {
            outbound: res.data.syncedCount,
            inbound: res.data.inboundBusyCount ?? 0,
          }),
        });
      } else {
        setStatus((prev: CaldavAccountStatus) => ({
          ...prev,
          lastSyncStatus: 'FAILED',
          lastSyncError: res.error ?? t('errorGeneric'),
        }));
        setNotification({
          type: 'error',
          message: res.error ?? t('errorGeneric'),
        });
      }
    } catch {
      setIsSyncing(false);
      setNotification({
        type: 'error',
        message: t('errorGeneric'),
      });
    }
  };

  const onConfirmDisconnect = async () => {
    setIsDisconnecting(true);
    setNotification(null);

    try {
      const res = await disconnectAction();
      setIsDisconnecting(false);
      setIsDisconnectDialogOpen(false);

      if (res.success) {
        setStatus({
          connected: false,
        });
        setStep('credentials');
        setPassword('');
        setNotification({
          type: 'success',
          message: t('successDisconnected'),
        });
      } else {
        setNotification({
          type: 'error',
          message: res.error ?? t('errorGeneric'),
        });
      }
    } catch {
      setIsDisconnecting(false);
      setIsDisconnectDialogOpen(false);
      setNotification({
        type: 'error',
        message: t('errorGeneric'),
      });
    }
  };

  return {
    showPassword,
    handleServerUrlChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setServerUrl(e.target.value);
      if (errors.serverUrl) setErrors((prev) => clearFieldError(prev, 'serverUrl'));
    },
    handleUsernameChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setUsername(e.target.value);
      if (errors.username) setErrors((prev) => clearFieldError(prev, 'username'));
    },
    handlePasswordChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setPassword(e.target.value);
      if (errors.password) setErrors((prev) => clearFieldError(prev, 'password'));
    },
    handleCalendarSelectChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSelectedCalendarUrl(e.target.value);
      if (errors.calendar) setErrors((prev) => clearFieldError(prev, 'calendar'));
    },
    onTogglePasswordVisibility: () => {
      setShowPassword((prev) => togglePasswordVisibility(prev));
    },
    onOpenDisconnectDialog: () => {
      setIsDisconnectDialogOpen(true);
    },
    onCloseDisconnectDialog: () => {
      setIsDisconnectDialogOpen(false);
    },
    onBackToCredentials: () => {
      setStep('credentials');
    },
    onTestAndDiscover,
    onSaveAndConnect,
    onManualSync,
    onConfirmDisconnect,
    handleManualSyncClick: () => {
      void onManualSync();
    },
    handleTestAndDiscoverSubmit: (e: React.SyntheticEvent) => {
      void onTestAndDiscover(e);
    },
    handleSaveAndConnectClick: () => {
      void onSaveAndConnect();
    },
    handleConfirmDisconnectClick: () => {
      void onConfirmDisconnect();
    },
  };
}

export function CaldavIntegrationView({
  initialStatus,
  locale,
  initialStep,
  initialDiscoveredCalendars,
  initialSelectedCalendarUrl,
  initialNotification,
  initialErrors,
  initialShowPassword,
}: CaldavIntegrationViewProps) {
  const t = useTranslations('settings.integrations.caldav');

  const [status, setStatus] = React.useState<CaldavAccountStatus>(initialStatus);
  const [step, setStep] = React.useState<'credentials' | 'select_calendar'>(
    initialStep ?? 'credentials',
  );

  // Form states
  const [serverUrl, setServerUrl] = React.useState(initialStatus.serverUrl ?? '');
  const [username, setUsername] = React.useState(initialStatus.username ?? '');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(initialShowPassword ?? false);
  const [errors, setErrors] = React.useState<CaldavFormErrors>(initialErrors ?? {});

  // Wizard state
  const [discoveredCalendars, setDiscoveredCalendars] = React.useState<DiscoveredCalendar[]>(
    initialDiscoveredCalendars ?? [],
  );
  const [selectedCalendarUrl, setSelectedCalendarUrl] = React.useState(
    initialSelectedCalendarUrl ?? initialStatus.selectedCalendarUrl ?? '',
  );
  const [isTesting, setIsTesting] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  // Syncing & Disconnect state
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [isDisconnectDialogOpen, setIsDisconnectDialogOpen] = React.useState(false);
  const [isDisconnecting, setIsDisconnecting] = React.useState(false);

  // Notifications
  const [notification, setNotification] = React.useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(initialNotification ?? null);

  const controller = createCaldavViewController({
    serverUrl,
    setServerUrl,
    username,
    setUsername,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    errors,
    setErrors,
    discoveredCalendars,
    setDiscoveredCalendars,
    selectedCalendarUrl,
    setSelectedCalendarUrl,
    status,
    setStatus,
    setStep,
    setIsTesting,
    setIsSaving,
    setIsSyncing,
    setIsDisconnecting,
    setIsDisconnectDialogOpen,
    setNotification,
    t,
  });

  return (
    <div className="space-y-6">
      {/* Breadcrumb / Back button */}
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors min-h-[36px] py-1"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>{t('backToSettings')}</span>
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
            {status.connected ? (
              <span
                data-testid="caldav-status-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
              >
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                {t('badgeConnected')}
              </span>
            ) : (
              <span
                data-testid="caldav-status-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700"
              >
                {t('badgeDisconnected')}
              </span>
            )}
          </div>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
      </div>

      {/* Notification banner */}
      {notification && (
        <div
          role={notification.type === 'error' ? 'alert' : 'status'}
          data-testid={
            notification.type === 'error' ? 'caldav-error-alert' : 'caldav-success-alert'
          }
          className={`flex items-start gap-3 p-4 rounded-lg border ${
            notification.type === 'error'
              ? 'bg-destructive/10 border-destructive/30 text-destructive dark:text-red-400'
              : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
          }`}
        >
          {notification.type === 'error' ? (
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <p className="text-sm font-medium">{notification.message}</p>
        </div>
      )}

      {/* Main Content: Connected View OR Setup Wizard */}
      {status.connected ? (
        <div
          data-testid="caldav-active-card"
          className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-6"
        >
          <div className="flex items-center gap-3">
            <CalendarSync className="h-6 w-6 text-primary shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold">{t('activeCardTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('activeCardDescription')}</p>
            </div>
          </div>

          {status.lastSyncError && (
            <div
              role="alert"
              data-testid="caldav-sync-error-notice"
              className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive dark:text-red-400"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{status.lastSyncError}</span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t text-sm">
            <div>
              <span className="text-muted-foreground font-medium block">
                {t('serverUrlDisplayLabel')}
              </span>
              <span
                data-testid="caldav-display-server"
                className="font-mono text-xs break-all text-foreground"
              >
                {status.serverUrl}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground font-medium block">
                {t('usernameDisplayLabel')}
              </span>
              <span data-testid="caldav-display-username" className="text-foreground">
                {status.username}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground font-medium block">
                {t('calendarDisplayLabel')}
              </span>
              <span data-testid="caldav-display-calendar" className="font-medium text-foreground">
                {status.selectedCalendarName ?? status.selectedCalendarUrl}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground font-medium block">
                {t('lastSyncedLabel')}
              </span>
              <span data-testid="caldav-display-last-sync" className="text-foreground">
                {formatLastSynced(status.lastSyncedAt, locale, t('neverSynced'))}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-4 border-t">
            <button
              type="button"
              data-testid="caldav-sync-now-button"
              onClick={controller.handleManualSyncClick}
              disabled={isSyncing}
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 min-h-[36px] px-4 py-2 shadow-sm transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{isSyncing ? t('syncingButton') : t('syncNowButton')}</span>
            </button>

            <button
              type="button"
              data-testid="caldav-disconnect-button"
              onClick={controller.onOpenDisconnectDialog}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground text-foreground min-h-[36px] px-4 py-2 shadow-sm transition-colors"
            >
              <span>{t('disconnectButton')}</span>
            </button>
          </div>
        </div>
      ) : (
        <div
          data-testid="caldav-wizard-card"
          className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-6"
        >
          <div>
            <h2 className="text-lg font-semibold">{t('wizardTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('wizardDescription')}</p>
          </div>

          {step === 'credentials' ? (
            <form onSubmit={controller.handleTestAndDiscoverSubmit} className="space-y-4 max-w-xl">
              {/* Server URL field */}
              <div className="space-y-1.5">
                <label
                  htmlFor="caldav-server-url"
                  className="text-sm font-medium text-foreground block"
                >
                  {t('serverUrlLabel')}
                </label>
                <input
                  id="caldav-server-url"
                  data-testid="caldav-server-url-input"
                  type="text"
                  value={serverUrl}
                  onChange={controller.handleServerUrlChange}
                  placeholder={t('serverUrlPlaceholder')}
                  aria-invalid={Boolean(errors.serverUrl)}
                  aria-describedby={
                    errors.serverUrl ? 'caldav-server-url-error' : 'caldav-server-url-hint'
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p id="caldav-server-url-hint" className="text-xs text-muted-foreground">
                  {t('serverUrlHint')}
                </p>
                {errors.serverUrl && (
                  <p
                    id="caldav-server-url-error"
                    role="alert"
                    data-testid="caldav-server-url-error"
                    className="text-xs text-destructive dark:text-red-400 font-medium"
                  >
                    {errors.serverUrl}
                  </p>
                )}
              </div>

              {/* Username field */}
              <div className="space-y-1.5">
                <label
                  htmlFor="caldav-username"
                  className="text-sm font-medium text-foreground block"
                >
                  {t('usernameLabel')}
                </label>
                <input
                  id="caldav-username"
                  data-testid="caldav-username-input"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={controller.handleUsernameChange}
                  placeholder={t('usernamePlaceholder')}
                  aria-invalid={Boolean(errors.username)}
                  aria-describedby={errors.username ? 'caldav-username-error' : undefined}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
                {errors.username && (
                  <p
                    id="caldav-username-error"
                    role="alert"
                    data-testid="caldav-username-error"
                    className="text-xs text-destructive dark:text-red-400 font-medium"
                  >
                    {errors.username}
                  </p>
                )}
              </div>

              {/* Password field with reveal/hide toggle */}
              <div className="space-y-1.5">
                <label
                  htmlFor="caldav-password"
                  className="text-sm font-medium text-foreground block"
                >
                  {t('passwordLabel')}
                </label>
                <div className="relative">
                  <input
                    id="caldav-password"
                    data-testid="caldav-password-input"
                    type={controller.showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={controller.handlePasswordChange}
                    placeholder={t('passwordPlaceholder')}
                    aria-invalid={Boolean(errors.password)}
                    aria-describedby={
                      errors.password ? 'caldav-password-error' : 'caldav-password-hint'
                    }
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <button
                    type="button"
                    data-testid="caldav-password-toggle"
                    onClick={controller.onTogglePasswordVisibility}
                    aria-label={controller.showPassword ? t('hidePassword') : t('showPassword')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground focus:outline-none"
                  >
                    {controller.showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                <p id="caldav-password-hint" className="text-xs text-muted-foreground">
                  {t('passwordHint')}
                </p>
                {errors.password && (
                  <p
                    id="caldav-password-error"
                    role="alert"
                    data-testid="caldav-password-error"
                    className="text-xs text-destructive dark:text-red-400 font-medium"
                  >
                    {errors.password}
                  </p>
                )}
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  data-testid="caldav-test-connect-button"
                  disabled={isTesting}
                  className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 min-h-[36px] px-4 py-2 shadow-sm transition-colors disabled:opacity-50"
                >
                  {isTesting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  <span>{isTesting ? t('testingButton') : t('testAndDiscoverButton')}</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4 max-w-xl">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  {t('selectCalendarTitle')}
                </h3>
                <p className="text-sm text-muted-foreground">{t('selectCalendarDescription')}</p>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="caldav-calendar-picker"
                  className="text-sm font-medium text-foreground block"
                >
                  {t('calendarPickerLabel')}
                </label>
                <select
                  id="caldav-calendar-picker"
                  data-testid="caldav-calendar-select"
                  value={selectedCalendarUrl}
                  onChange={controller.handleCalendarSelectChange}
                  aria-invalid={Boolean(errors.calendar)}
                  aria-describedby={errors.calendar ? 'caldav-calendar-error' : undefined}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {discoveredCalendars.map((cal) => (
                    <option key={cal.url} value={cal.url}>
                      {cal.displayName || cal.url}
                    </option>
                  ))}
                </select>
                {errors.calendar && (
                  <p
                    id="caldav-calendar-error"
                    role="alert"
                    data-testid="caldav-calendar-error"
                    className="text-xs text-destructive dark:text-red-400 font-medium"
                  >
                    {errors.calendar}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  data-testid="caldav-save-connect-button"
                  onClick={controller.handleSaveAndConnectClick}
                  disabled={isSaving}
                  className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 min-h-[36px] px-4 py-2 shadow-sm transition-colors disabled:opacity-50"
                >
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  <span>{isSaving ? t('savingButton') : t('saveAndConnectButton')}</span>
                </button>

                <button
                  type="button"
                  data-testid="caldav-back-button"
                  onClick={controller.onBackToCredentials}
                  disabled={isSaving}
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground text-foreground min-h-[36px] px-4 py-2 shadow-sm transition-colors disabled:opacity-50"
                >
                  <span>{t('backToCredentialsButton')}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Privacy Notice */}
      <div className="rounded-lg border bg-muted/40 p-5 space-y-2 text-sm">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <ShieldCheck className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
          <span>{t('privacyNoticeTitle')}</span>
        </div>
        <p className="text-muted-foreground leading-relaxed">{t('privacyNoticeDescription')}</p>
      </div>

      {/* Disconnect Dialog */}
      <Dialog open={isDisconnectDialogOpen} onOpenChange={setIsDisconnectDialogOpen}>
        <DialogContent data-testid="caldav-disconnect-dialog">
          <DialogHeader>
            <DialogTitle>{t('disconnectDialogTitle')}</DialogTitle>
            <DialogDescription>{t('disconnectDialogDescription')}</DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4">
            <button
              type="button"
              data-testid="caldav-cancel-disconnect-button"
              onClick={controller.onCloseDisconnectDialog}
              disabled={isDisconnecting}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground text-foreground min-h-[36px] px-4 py-2 shadow-sm transition-colors"
            >
              <span>{t('cancelButton')}</span>
            </button>

            <button
              type="button"
              data-testid="caldav-confirm-disconnect-button"
              onClick={controller.handleConfirmDisconnectClick}
              disabled={isDisconnecting}
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 min-h-[36px] px-4 py-2 shadow-sm transition-colors disabled:opacity-50"
            >
              {isDisconnecting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              <span>
                {isDisconnecting ? t('disconnectingButton') : t('confirmDisconnectButton')}
              </span>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
