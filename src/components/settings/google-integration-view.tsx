'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Cloud,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Loader2,
  ArrowLeft,
  PhoneCall,
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
  initiateGoogleConnectAction,
  disconnectGoogleAction,
} from '@/server/integrations/google/actions';
import type { GoogleIntegrationDetails } from '@/server/integrations/google/service';

interface GoogleIntegrationViewProps {
  initialStatus: GoogleIntegrationDetails;
  locale: string;
  redirectUri: string;
  initialNotification?: { type: 'success' | 'error'; code: string } | null;
}

export function GoogleIntegrationView({
  initialStatus,
  redirectUri,
  initialNotification,
}: GoogleIntegrationViewProps) {
  const t = useTranslations('settings.integrations.google');

  const [status, setStatus] = React.useState<GoogleIntegrationDetails>(initialStatus);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [isDisconnectDialogOpen, setIsDisconnectDialogOpen] = React.useState(false);
  const [deleteSyncedContacts, setDeleteSyncedContacts] = React.useState(true);
  const [isDisconnecting, setIsDisconnecting] = React.useState(false);

  const [notification, setNotification] = React.useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(() => {
    if (!initialNotification) return null;
    if (initialNotification.type === 'success' && initialNotification.code === 'connected') {
      return { type: 'success', message: t('successConnectedAlert') };
    }
    return { type: 'error', message: t('errorGeneric') };
  });

  const disconnectButtonRef = React.useRef<HTMLButtonElement | null>(null);

  const handleConnect = async () => {
    if (!status.configured) return;

    setIsConnecting(true);
    setNotification(null);

    try {
      const res = await initiateGoogleConnectAction();
      if (res.success && res.data?.url) {
        window.location.href = res.data.url;
      } else {
        setIsConnecting(false);
        setNotification({
          type: 'error',
          message: res.error ?? t('errorGeneric'),
        });
      }
    } catch {
      setIsConnecting(false);
      setNotification({
        type: 'error',
        message: t('errorGeneric'),
      });
    }
  };

  const handleConfirmDisconnect = async () => {
    setIsDisconnecting(true);
    setNotification(null);

    try {
      const res = await disconnectGoogleAction({ deleteSyncedContacts });
      setIsDisconnecting(false);
      setIsDisconnectDialogOpen(false);

      if (res.success) {
        setStatus({
          status: 'disconnected',
          configured: true,
          connected: false,
        });
        setNotification({
          type: 'success',
          message: t('successDisconnectedAlert'),
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

  const formattedDate = React.useMemo(() => {
    if (!status.connectedAt) return '';
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(status.connectedAt));
    } catch {
      return String(status.connectedAt);
    }
  }, [status.connectedAt]);

  return (
    <div className="space-y-6 max-w-4xl" data-testid="google-integration-view">
      {/* Back navigation */}
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors min-h-[36px] py-1"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to Settings</span>
        </Link>
      </div>

      {/* Header and status badge */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Cloud className="h-7 w-7 text-primary shrink-0" aria-hidden="true" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>

        <div>
          {status.status === 'unconfigured' && (
            <span
              data-testid="status-badge-unconfigured"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('badgeUnconfigured')}</span>
            </span>
          )}
          {status.status === 'disconnected' && (
            <span
              data-testid="status-badge-disconnected"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border"
            >
              <span>{t('badgeDisconnected')}</span>
            </span>
          )}
          {status.status === 'connected' && (
            <span
              data-testid="status-badge-connected"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('badgeConnected')}</span>
            </span>
          )}
        </div>
      </div>

      {/* Localized feedback notifications */}
      {notification && (
        <div
          role="status"
          aria-live="polite"
          data-testid={`notification-${notification.type}`}
          className={`p-4 rounded-lg border text-sm flex items-start gap-3 ${
            notification.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900'
              : 'bg-destructive/10 text-destructive border-destructive/20'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2
              className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5"
              aria-hidden="true"
            />
          ) : (
            <AlertTriangle
              className="h-5 w-5 shrink-0 text-destructive mt-0.5"
              aria-hidden="true"
            />
          )}
          <span className="font-medium">{notification.message}</span>
        </div>
      )}

      {/* Main card state rendering */}
      {status.status === 'unconfigured' && (
        <div
          data-testid="unconfigured-card"
          className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-6"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">
                {t('unconfiguredAlertTitle')}
              </h2>
              <p className="text-sm text-muted-foreground">{t('unconfiguredAlertDescription')}</p>
            </div>
          </div>

          <div className="rounded-md bg-muted/60 p-4 space-y-4 text-sm">
            <div className="space-y-1">
              <h3 className="font-medium text-foreground">{t('step1Title')}</h3>
              <p className="text-muted-foreground">{t('step1Description')}</p>
            </div>

            <div className="space-y-1">
              <h3 className="font-medium text-foreground">{t('step2Title')}</h3>
              <p className="text-muted-foreground">{t('step2Description', { redirectUri })}</p>
              <div className="mt-1">
                <code
                  data-testid="redirect-uri-display"
                  className="block rounded bg-background px-3 py-2 font-mono text-xs text-foreground border overflow-x-auto"
                >
                  {redirectUri}
                </code>
              </div>
            </div>

            <div className="space-y-1">
              <h3 className="font-medium text-foreground">{t('step3Title')}</h3>
              <p className="text-muted-foreground">{t('step3Description')}</p>
            </div>
          </div>

          <div>
            <button
              type="button"
              disabled
              aria-disabled="true"
              data-testid="connect-button-disabled"
              className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-muted text-muted-foreground cursor-not-allowed opacity-60 min-h-[40px] px-5 py-2 shadow-sm"
            >
              {t('connectButton')}
            </button>
          </div>
        </div>
      )}

      {status.status === 'disconnected' && (
        <div
          data-testid="disconnected-card"
          className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-6"
        >
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
            <p className="text-sm text-muted-foreground">{t('description')}</p>
          </div>

          <div className="rounded-md border p-4 bg-muted/30 space-y-2 text-sm">
            <span className="font-medium text-foreground block">{t('grantedScopes')}:</span>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>
                {t('contactsScopeLabel')} (
                <code className="text-xs">https://www.googleapis.com/auth/contacts</code>)
              </li>
            </ul>
          </div>

          <div>
            <button
              type="button"
              onClick={() => {
                void handleConnect();
              }}
              disabled={isConnecting}
              data-testid="connect-button"
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[40px] px-5 py-2 shadow-sm transition-colors"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>{t('connectingButton')}</span>
                </>
              ) : (
                <>
                  <Cloud className="h-4 w-4" aria-hidden="true" />
                  <span>{t('connectButton')}</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {status.status === 'connected' && (
        <div
          data-testid="connected-card"
          className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
              {status.connectedAt && (
                <p className="text-sm text-muted-foreground" data-testid="connected-since-text">
                  {t('connectedSince', { date: formattedDate })}
                </p>
              )}
            </div>

            <div>
              <button
                type="button"
                ref={disconnectButtonRef}
                onClick={() => {
                  setIsDisconnectDialogOpen(true);
                }}
                data-testid="disconnect-button"
                className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-destructive/30 text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 min-h-[40px] px-4 py-2 transition-colors shadow-sm"
              >
                {t('disconnectButton')}
              </button>
            </div>
          </div>

          <div className="rounded-md border p-4 bg-muted/30 space-y-2 text-sm">
            <span className="font-medium text-foreground block">{t('grantedScopes')}:</span>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>
                {t('contactsScopeLabel')} (
                <code className="text-xs">
                  {status.scope ?? 'https://www.googleapis.com/auth/contacts'}
                </code>
                )
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* Feature & Privacy Highlights */}
      <div className="grid gap-6 md:grid-cols-2 pt-2">
        <div className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-primary font-semibold text-sm">
            <PhoneCall className="h-4 w-4" aria-hidden="true" />
            <h3>{t('featureCallerIdTitle')}</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('featureCallerIdDescription')}
          </p>
        </div>

        <div className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-primary font-semibold text-sm">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            <h3>{t('privacyNoticeTitle')}</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('privacyNoticeDescription')}
          </p>
        </div>
      </div>

      {/* Accessible Disconnect Confirmation Dialog */}
      <Dialog
        open={isDisconnectDialogOpen}
        onOpenChange={(open) => {
          if (!isDisconnecting) {
            setIsDisconnectDialogOpen(open);
          }
        }}
      >
        <DialogContent
          data-testid="disconnect-dialog"
          className="w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-y-auto sm:rounded-lg"
          onCloseAutoFocus={(e) => {
            if (disconnectButtonRef.current) {
              e.preventDefault();
              disconnectButtonRef.current.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('disconnectDialogTitle')}</DialogTitle>
            <DialogDescription>{t('disconnectDialogDescription')}</DialogDescription>
          </DialogHeader>

          <div className="py-3 space-y-3">
            <label
              htmlFor="delete-synced-contacts-checkbox"
              className="flex items-start gap-3 cursor-pointer select-none"
            >
              <input
                id="delete-synced-contacts-checkbox"
                type="checkbox"
                checked={deleteSyncedContacts}
                onChange={(e) => {
                  setDeleteSyncedContacts(e.target.checked);
                }}
                className="h-4 w-4 mt-1 rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium text-foreground block">
                {t('disconnectDeleteContactsLabel')}
                <span className="text-xs text-muted-foreground block font-normal mt-0.5">
                  {t('disconnectDeleteContactsHint')}
                </span>
              </span>
            </label>
          </div>

          <DialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:gap-0 pt-2">
            <button
              type="button"
              disabled={isDisconnecting}
              onClick={() => {
                setIsDisconnectDialogOpen(false);
              }}
              data-testid="cancel-disconnect-button"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground min-h-[40px] px-4 py-2 text-sm font-medium transition-colors"
            >
              {t('cancelButton')}
            </button>
            <button
              type="button"
              disabled={isDisconnecting}
              onClick={() => {
                void handleConfirmDisconnect();
              }}
              data-testid="confirm-disconnect-button"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 min-h-[40px] px-4 py-2 text-sm font-medium transition-colors shadow-sm"
            >
              {isDisconnecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>{t('disconnectingButton')}</span>
                </>
              ) : (
                <span>{t('confirmDisconnectButton')}</span>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
