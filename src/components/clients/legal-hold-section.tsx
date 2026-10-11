'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Shield, ShieldAlert, Pencil, Unlock, AlertCircle, Loader2 } from 'lucide-react';
import { formatDate } from '@/lib/formatters';
import { setLegalHoldAction, releaseLegalHoldAction } from '@/server/clients/legal-hold-actions';
import { ConfirmDialog } from './confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export interface ClientLegalHoldData {
  id: string;
  clientId: string;
  reason: 'dispute' | 'statutory' | 'other';
  note: string | null;
  until: string | null;
  setByActorType: string;
  setByActorId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface LegalHoldSectionProps {
  clientId: string;
  initialHold?: ClientLegalHoldData | null;
  studioTimezone: string;
  locale: string;
  onHoldChange?: (hold: ClientLegalHoldData | null, isActive: boolean) => void;
}

export function isHoldActiveDate(
  until: string | null | undefined,
  studioTimezone = 'UTC',
): boolean {
  if (!until) return true;
  try {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: studioTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return until >= today;
  } catch {
    const todayIso = new Date().toISOString().slice(0, 10);
    return until >= todayIso;
  }
}

export function LegalHoldSection({
  clientId,
  initialHold,
  studioTimezone,
  locale,
  onHoldChange,
}: LegalHoldSectionProps) {
  const t = useTranslations('clients.legalHold');

  const [hold, setHold] = React.useState<ClientLegalHoldData | null>(initialHold ?? null);
  const isActive = hold ? isHoldActiveDate(hold.until, studioTimezone) : false;

  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [isReleaseConfirmOpen, setIsReleaseConfirmOpen] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isReleasing, setIsReleasing] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [releaseError, setReleaseError] = React.useState<string | null>(null);
  const [statusAnnouncement, setStatusAnnouncement] = React.useState<string | null>(null);

  // Form states
  const [reason, setReason] = React.useState<'dispute' | 'statutory' | 'other'>(
    hold?.reason ?? 'dispute',
  );
  const [note, setNote] = React.useState<string>(hold?.note ?? '');
  const [until, setUntil] = React.useState<string>(hold?.until ?? '');

  const switchRef = React.useRef<HTMLButtonElement>(null);

  const todayStr = React.useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: studioTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }, [studioTimezone]);

  const openSetDialog = React.useCallback((existing?: ClientLegalHoldData | null) => {
    setReason(existing?.reason ?? 'dispute');
    setNote(existing?.note ?? '');
    setUntil(existing?.until ?? '');
    setFormError(null);
    setIsDialogOpen(true);
  }, []);

  const handleToggleSwitch = () => {
    if (isActive) {
      setReleaseError(null);
      setIsReleaseConfirmOpen(true);
    } else {
      openSetDialog(hold);
    }
  };

  const handleSaveHold = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);

    if (until && until < todayStr) {
      setFormError(t('errorPastDate'));
      setIsSubmitting(false);
      return;
    }

    try {
      const isExisting = !!hold;
      const res = await setLegalHoldAction({
        clientId,
        reason,
        note: note.trim() ? note.trim() : undefined,
        until: until || undefined,
      });

      if (!res.success) {
        setFormError(res.error || t('errorGeneric'));
        setIsSubmitting(false);
        return;
      }

      const updatedHold: ClientLegalHoldData = {
        id: res.hold.id,
        clientId: res.hold.clientId,
        reason: res.hold.reason,
        note: res.hold.note,
        until: res.hold.until ?? null,
        setByActorType: res.hold.setByActorType,
        setByActorId: res.hold.setByActorId,
        createdAt: res.hold.createdAt,
        updatedAt: res.hold.updatedAt,
      };

      setHold(updatedHold);
      setIsDialogOpen(false);
      setIsSubmitting(false);

      const announcement = isExisting ? t('statusUpdatedAnnounce') : t('statusActiveAnnounce');
      setStatusAnnouncement(announcement);
      onHoldChange?.(updatedHold, true);

      setTimeout(() => {
        switchRef.current?.focus();
      }, 50);
    } catch {
      setFormError(t('errorGeneric'));
      setIsSubmitting(false);
    }
  };

  const handleConfirmRelease = async () => {
    setIsReleasing(true);
    setReleaseError(null);

    try {
      const res = await releaseLegalHoldAction({ clientId });

      if (!res.success) {
        setReleaseError(res.error || t('errorGeneric'));
        setIsReleasing(false);
        return;
      }

      setHold(null);
      setIsReleaseConfirmOpen(false);
      setIsReleasing(false);

      setStatusAnnouncement(t('statusReleasedAnnounce'));
      onHoldChange?.(null, false);

      setTimeout(() => {
        switchRef.current?.focus();
      }, 50);
    } catch {
      setReleaseError(t('errorGeneric'));
      setIsReleasing(false);
    }
  };

  return (
    <section
      aria-labelledby="legal-hold-heading"
      className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-4"
      data-testid="legal-hold-section"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {isActive ? (
              <ShieldAlert
                className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0"
                aria-hidden="true"
              />
            ) : (
              <Shield className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
            )}
            <h2
              id="legal-hold-heading"
              className="text-lg font-semibold text-foreground flex items-center gap-2"
            >
              <span>{t('title')}</span>
              {hold && (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    isActive
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                      : 'bg-muted text-muted-foreground'
                  }`}
                  data-testid="legal-hold-status-badge"
                >
                  {isActive ? t('activeBadge') : t('expiredBadge')}
                </span>
              )}
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">{t('description')}</p>
        </div>

        {/* Legal Hold Switch (AC-16, AC-18) */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">{t('switchLabel')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            aria-label={t('switchLabel')}
            ref={switchRef}
            onClick={handleToggleSwitch}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[24px] min-w-[44px] ${
              isActive ? 'bg-amber-600' : 'bg-muted-foreground/30'
            }`}
            data-testid="legal-hold-switch"
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                isActive ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Screen Reader Status Announcements (AC-16, AC-17) */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="legal-hold-status-announcement"
      >
        {statusAnnouncement}
      </div>

      {/* Active or Expired Hold Details */}
      {hold ? (
        <div
          className={`rounded-lg border p-4 space-y-3 ${
            isActive
              ? 'border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20'
              : 'border-muted bg-muted/20'
          }`}
          data-testid="legal-hold-details"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground block uppercase tracking-wider mb-0.5">
                {t('reasonLabel')}
              </span>
              <span className="font-medium text-foreground" data-testid="legal-hold-reason-display">
                {t(`reasons.${hold.reason}`)}
              </span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block uppercase tracking-wider mb-0.5">
                {t('sinceLabel')}
              </span>
              <span className="font-medium text-foreground" data-testid="legal-hold-since-display">
                {formatDate(hold.createdAt, locale)}
              </span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block uppercase tracking-wider mb-0.5">
                {t('untilDateLabel')}
              </span>
              <span className="font-medium text-foreground" data-testid="legal-hold-until-display">
                {hold.until ? formatDate(hold.until, locale) : t('indefinite')}
              </span>
            </div>
          </div>

          {hold.note && (
            <div className="pt-2 border-t border-border/50 text-xs">
              <span className="text-muted-foreground block uppercase tracking-wider mb-0.5">
                {t('noteDisplayLabel')}
              </span>
              <p
                className="text-foreground whitespace-pre-wrap font-sans"
                data-testid="legal-hold-note-display"
              >
                {hold.note}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50">
            <button
              type="button"
              onClick={() => {
                openSetDialog(hold);
              }}
              className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[36px]"
              data-testid="edit-legal-hold-btn"
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              <span>{t('edit')}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setReleaseError(null);
                setIsReleaseConfirmOpen(true);
              }}
              className="inline-flex items-center rounded-md border border-red-300 dark:border-red-800 bg-background px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 shadow-sm hover:bg-red-50 dark:hover:bg-red-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[36px]"
              data-testid="release-legal-hold-btn"
            >
              <Unlock className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              <span>{t('release')}</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* Set / Edit Legal Hold Dialog (AC-16) */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent
          className="w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-y-auto sm:rounded-lg"
          data-testid="legal-hold-dialog"
          onCloseAutoFocus={(e) => {
            if (switchRef.current) {
              e.preventDefault();
              switchRef.current.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{hold ? t('editDialogTitle') : t('dialogTitle')}</DialogTitle>
            <DialogDescription>{t('dialogDescription')}</DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              void handleSaveHold(e);
            }}
            className="space-y-4 pt-2"
          >
            {formError && (
              <div
                role="alert"
                className="rounded-md border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40 p-3 text-red-900 dark:text-red-200 text-sm font-medium flex items-center gap-2"
                data-testid="legal-hold-form-error"
              >
                <AlertCircle
                  className="h-4 w-4 shrink-0 text-red-700 dark:text-red-400"
                  aria-hidden="true"
                />
                <span>{formError}</span>
              </div>
            )}

            {/* Reason Select */}
            <div className="space-y-1.5">
              <label
                htmlFor="legal-hold-reason"
                className="text-sm font-medium text-foreground block"
              >
                {t('reasonLabel')} <span className="text-destructive">*</span>
              </label>
              <select
                id="legal-hold-reason"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value as 'dispute' | 'statutory' | 'other');
                }}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[40px]"
                required
                data-testid="legal-hold-reason-select"
              >
                <option value="dispute">{t('reasons.dispute')}</option>
                <option value="statutory">{t('reasons.statutory')}</option>
                <option value="other">{t('reasons.other')}</option>
              </select>
            </div>

            {/* Note Textarea */}
            <div className="space-y-1.5">
              <label
                htmlFor="legal-hold-note"
                className="text-sm font-medium text-foreground block"
              >
                {t('noteLabel')}
              </label>
              <p className="text-xs text-muted-foreground">{t('noteHint')}</p>
              <textarea
                id="legal-hold-note"
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
                maxLength={500}
                rows={3}
                placeholder={t('notePlaceholder')}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[80px]"
                data-testid="legal-hold-note-input"
              />
              <div className="text-right text-xs text-muted-foreground">{note.length} / 500</div>
            </div>

            {/* Until Date Input */}
            <div className="space-y-1.5">
              <label
                htmlFor="legal-hold-until"
                className="text-sm font-medium text-foreground block"
              >
                {t('untilLabel')}
              </label>
              <p className="text-xs text-muted-foreground">{t('untilHint')}</p>
              <input
                id="legal-hold-until"
                type="date"
                value={until}
                min={todayStr}
                onChange={(e) => {
                  setUntil(e.target.value);
                }}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[40px]"
                data-testid="legal-hold-until-input"
              />
            </div>

            <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsDialogOpen(false);
                }}
                disabled={isSubmitting}
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
                data-testid="legal-hold-cancel-btn"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
                data-testid="save-legal-hold-btn"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                    <span>{t('saving')}</span>
                  </>
                ) : (
                  <span>{t('save')}</span>
                )}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Release Confirmation Dialog (AC-17) */}
      <ConfirmDialog
        isOpen={isReleaseConfirmOpen}
        onOpenChange={setIsReleaseConfirmOpen}
        title={t('releaseConfirmTitle')}
        description={t('releaseConfirmDescription')}
        confirmLabel={t('confirmRelease')}
        isSubmitting={isReleasing}
        errorMessage={releaseError}
        triggerRef={switchRef}
        onConfirm={() => {
          void handleConfirmRelease();
        }}
      />
    </section>
  );
}
