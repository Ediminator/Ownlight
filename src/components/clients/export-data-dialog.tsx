'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Code2, AlertTriangle, ShieldCheck, Download, Loader2 } from 'lucide-react';
import type { ClientContact } from '@/server/db/schema/clients';
import { reauthenticateAction } from '@/server/auth/mfa-actions';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export interface ExportDataDialogProps {
  contact: (Partial<ClientContact> & { id: string }) | null;
  clientDisplayName: string;
  preferredLocale?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownloadStarted?: () => void;
}

interface ExportDataDialogContentProps {
  contact: Partial<ClientContact> & { id: string };
  clientDisplayName: string;
  preferredLocale?: string;
  onOpenChange: (open: boolean) => void;
  onDownloadStarted?: () => void;
}

function ExportDataDialogInner({
  contact,
  clientDisplayName,
  preferredLocale = 'en',
  onOpenChange,
  onDownloadStarted,
}: ExportDataDialogContentProps) {
  const t = useTranslations('privacy.export');

  const [format, setFormat] = React.useState<'html' | 'json'>('html');
  const [locale, setLocale] = React.useState<'en' | 'de'>(preferredLocale === 'de' ? 'de' : 'en');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Re-authentication state
  const [reauthRequired, setReauthRequired] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [isReauthenticating, setIsReauthenticating] = React.useState(false);

  const contactName =
    [contact.givenName, contact.familyName].filter(Boolean).join(' ') || clientDisplayName;

  const executeDownload = async (): Promise<boolean> => {
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/privacy/exports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contactId: contact.id,
          format,
          locale,
        }),
      });

      if (res.status === 403) {
        let code: unknown;
        let errorMsg: unknown;
        try {
          const raw: unknown = await res.json();
          if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
            const record = raw as Record<string, unknown>;
            code = record.code;
            errorMsg = record.error;
          }
        } catch {
          // Ignore parse errors
        }

        if (code === 'REAUTH_REQUIRED' || errorMsg === 'REAUTH_REQUIRED') {
          setReauthRequired(true);
          setIsSubmitting(false);
          return false;
        }

        setError(t('errorGeneric'));
        setIsSubmitting(false);
        return false;
      }

      if (!res.ok) {
        setError(t('errorGeneric'));
        setIsSubmitting(false);
        return false;
      }

      // Download received file
      const blob = await res.blob();
      const contentDisposition = res.headers.get('content-disposition');
      let filename = `ownlight-data-export-${contact.id}-${new Date().toISOString().slice(0, 10)}.${format}`;

      if (contentDisposition) {
        const match = /filename="?([^";]+)"?/i.exec(contentDisposition);
        if (match?.[1]) {
          filename = match[1];
        }
      }

      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

      setIsSubmitting(false);
      onDownloadStarted?.();
      onOpenChange(false);
      return true;
    } catch {
      setError(t('errorGeneric'));
      setIsSubmitting(false);
      return false;
    }
  };

  const handleReauthSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!password.trim() || isReauthenticating) return;

    setIsReauthenticating(true);
    setError(null);

    void (async () => {
      try {
        const res = await reauthenticateAction({ password });
        if (!res.success) {
          setError(res.error || t('errorReauth'));
          setIsReauthenticating(false);
          return;
        }

        // Reauth succeeded: dismiss reauth screen and proceed to download
        setReauthRequired(false);
        setPassword('');
        setIsReauthenticating(false);
        await executeDownload();
      } catch {
        setError(t('errorReauth'));
        setIsReauthenticating(false);
      }
    })();
  };

  return (
    <DialogContent
      className="w-full max-w-md sm:max-w-lg p-5 sm:p-6 overflow-y-auto max-h-[90vh]"
      data-testid="export-data-dialog"
    >
      <DialogHeader>
        <DialogTitle className="text-lg sm:text-xl font-semibold text-foreground flex items-center gap-2">
          <Download className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
          <span>{t('title')}</span>
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground pt-1">
          {t('description', { name: contactName })}
        </DialogDescription>
      </DialogHeader>

      {error && (
        <div
          role="alert"
          className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive font-medium"
          data-testid="export-error-alert"
        >
          {error}
        </div>
      )}

      {reauthRequired ? (
        // Re-authentication Form View
        <form onSubmit={handleReauthSubmit} className="space-y-4 pt-2">
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3.5 space-y-1">
            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-semibold text-sm">
              <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
              <h4>{t('reauthTitle')}</h4>
            </div>
            <p className="text-xs text-amber-800 dark:text-amber-300">{t('reauthDescription')}</p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="export-reauth-password"
              className="block text-xs font-semibold text-foreground uppercase tracking-wider"
            >
              {t('passwordLabel')}
            </label>
            <input
              id="export-reauth-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              placeholder={t('passwordPlaceholder')}
              required
              autoComplete="current-password"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[40px]"
              data-testid="export-password-input"
            />
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setReauthRequired(false);
              }}
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground min-h-[40px]"
              data-testid="export-reauth-cancel-btn"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={isReauthenticating || !password.trim()}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 min-h-[40px]"
              data-testid="export-reauth-submit-btn"
            >
              {isReauthenticating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>{t('reauthenticating')}</span>
                </>
              ) : (
                <span>{t('confirmPassword')}</span>
              )}
            </button>
          </DialogFooter>
        </form>
      ) : (
        // Main Export Options View
        <div className="space-y-4 pt-1">
          {/* Format Selection */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-foreground uppercase tracking-wider">
              {t('formatLabel')}
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setFormat('html');
                }}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors min-h-[56px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  format === 'html'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-input hover:bg-accent text-foreground'
                }`}
                data-testid="export-format-html-btn"
              >
                <FileText className="h-5 w-5 mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <div className="font-semibold text-sm">{t('formatHtml')}</div>
                  <div className="text-xs text-muted-foreground">HTML / Printable</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setFormat('json');
                }}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors min-h-[56px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  format === 'json'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-input hover:bg-accent text-foreground'
                }`}
                data-testid="export-format-json-btn"
              >
                <Code2 className="h-5 w-5 mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <div className="font-semibold text-sm">{t('formatJson')}</div>
                  <div className="text-xs text-muted-foreground">JSON (Art. 20)</div>
                </div>
              </button>
            </div>
          </div>

          {/* Language Selection */}
          <div className="space-y-1.5">
            <label
              htmlFor="export-locale-select"
              className="block text-xs font-semibold text-foreground uppercase tracking-wider"
            >
              {t('localeLabel')}
            </label>
            <select
              id="export-locale-select"
              value={locale}
              onChange={(e) => {
                setLocale(e.target.value as 'en' | 'de');
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[40px]"
              data-testid="export-locale-select"
            >
              <option value="en">{t('localeEn')}</option>
              <option value="de">{t('localeDe')}</option>
            </select>
          </div>

          {/* GDPR Art. 15(4) Review Notice */}
          <div
            className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3.5 space-y-1 text-xs"
            data-testid="export-review-notice"
          >
            <div className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200">
              <AlertTriangle
                className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden="true"
              />
              <span>{t('reviewNoticeTitle')}</span>
            </div>
            <p className="text-amber-800 dark:text-amber-300 leading-relaxed">
              {t('reviewNotice')}
            </p>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
              }}
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground min-h-[40px]"
              data-testid="export-cancel-btn"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                void executeDownload();
              }}
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 min-h-[40px]"
              data-testid="export-submit-btn"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>{t('generating')}</span>
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                  <span>{t('submit')}</span>
                </>
              )}
            </button>
          </DialogFooter>
        </div>
      )}
    </DialogContent>
  );
}

export function ExportDataDialog({
  contact,
  clientDisplayName,
  preferredLocale = 'en',
  open,
  onOpenChange,
  onDownloadStarted,
}: ExportDataDialogProps) {
  if (!open || !contact) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ExportDataDialogInner
        key={contact.id}
        contact={contact}
        clientDisplayName={clientDisplayName}
        preferredLocale={preferredLocale}
        onOpenChange={onOpenChange}
        onDownloadStarted={onDownloadStarted}
      />
    </Dialog>
  );
}
