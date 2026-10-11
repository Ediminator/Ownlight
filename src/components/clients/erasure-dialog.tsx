'use client';

import * as React from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { AlertTriangle, ShieldAlert, Trash2, UserX, Loader2, KeyRound } from 'lucide-react';
import type { ErasureSubject, ErasureHold } from '@/server/privacy/erasure/types';
import { formatDate } from '@/lib/formatters';
import { planErasureAction, executeErasureAction } from '@/server/privacy/erasure/actions';
import { reauthenticateAction } from '@/server/auth/mfa-actions';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export interface ErasureDialogProps {
  subject: ErasureSubject | null;
  clientDisplayName: string;
  contactName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  onSuccess?: (subjectKind: 'client' | 'contact') => void;
}

interface ErasureDialogContentProps {
  subject: ErasureSubject;
  clientDisplayName: string;
  contactName?: string;
  triggerRef?: React.RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (subjectKind: 'client' | 'contact') => void;
}

export function ErasureDialogInner({
  subject,
  clientDisplayName,
  contactName,
  triggerRef,
  onOpenChange,
  onSuccess,
}: ErasureDialogContentProps) {
  const t = useTranslations('privacy.erasure');
  const locale = useLocale();

  const [isLoadingPlan, setIsLoadingPlan] = React.useState(true);
  const [categoryCounts, setCategoryCounts] = React.useState<Record<string, number>>({});
  const [holds, setHolds] = React.useState<ErasureHold[]>([]);
  const [notesMayMentionPerson, setNotesMayMentionPerson] = React.useState(false);
  const [targetDisplayName, setTargetDisplayName] = React.useState(clientDisplayName);

  const [confirmation, setConfirmation] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Re-authentication state
  const [reauthRequired, setReauthRequired] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [isReauthenticating, setIsReauthenticating] = React.useState(false);

  // Fetch plan on open
  React.useEffect(() => {
    let cancelled = false;

    async function loadPlan() {
      setIsLoadingPlan(true);
      setError(null);

      try {
        const res = await planErasureAction({ subject });
        if (cancelled) return;

        if (!res.success) {
          if (res.code === 'NOT_FOUND') {
            setError(t('errorNotFound'));
          } else {
            setError(t('errorGeneric'));
          }
          setIsLoadingPlan(false);
          return;
        }

        setCategoryCounts(res.plan.categoryCounts);
        setHolds(res.plan.holds);
        setNotesMayMentionPerson(res.plan.notesMayMentionPerson);
        if (res.plan.clientDisplayName) {
          setTargetDisplayName(res.plan.clientDisplayName);
        }
        setIsLoadingPlan(false);
      } catch {
        if (!cancelled) {
          setError(t('errorGeneric'));
          setIsLoadingPlan(false);
        }
      }
    }

    void loadPlan();

    return () => {
      cancelled = true;
    };
  }, [subject, t]);

  const hasHolds = holds.length > 0;
  const isClientErasure = subject.kind === 'client';

  const executeErasure = async (): Promise<boolean> => {
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await executeErasureAction({
        subject,
        confirmation,
      });

      if (!res.success) {
        if (res.code === 'REAUTH_REQUIRED') {
          setReauthRequired(true);
          setIsSubmitting(false);
          return false;
        }

        if (res.code === 'ERASURE_BLOCKED') {
          setHolds(res.holds);
          setError(t('errorBlocked'));
          setIsSubmitting(false);
          return false;
        }

        if (res.code === 'CONFIRMATION_MISMATCH') {
          setError(t('errorConfirmationMismatch'));
          setIsSubmitting(false);
          return false;
        }

        if (res.code === 'NOT_FOUND') {
          setError(t('errorNotFound'));
          setIsSubmitting(false);
          return false;
        }

        setError(t('errorGeneric'));
        setIsSubmitting(false);
        return false;
      }

      setIsSubmitting(false);
      onOpenChange(false);
      onSuccess?.(res.subjectKind);
      return true;
    } catch {
      setError(t('errorGeneric'));
      setIsSubmitting(false);
      return false;
    }
  };

  const handleReauthSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!password.trim() || isReauthenticating) return;

    setIsReauthenticating(true);
    setError(null);

    void (async () => {
      try {
        const res = await reauthenticateAction({ password });
        if (!res.success) {
          setError(t('errorReauth'));
          setIsReauthenticating(false);
          return;
        }

        // Reauth succeeded: dismiss reauth view and proceed with erasure
        setReauthRequired(false);
        setPassword('');
        setIsReauthenticating(false);
        await executeErasure();
      } catch {
        setError(t('errorReauth'));
        setIsReauthenticating(false);
      }
    })();
  };

  const isConfirmationMatching = confirmation.trim() === targetDisplayName.trim();

  return (
    <DialogContent
      className="w-full max-w-md sm:max-w-lg p-5 sm:p-6 overflow-y-auto max-h-[90vh]"
      data-testid="erasure-dialog"
      onCloseAutoFocus={(e) => {
        if (triggerRef?.current) {
          e.preventDefault();
          triggerRef.current.focus();
        }
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-lg sm:text-xl font-semibold text-red-700 dark:text-red-400 flex items-center gap-2">
          {isClientErasure ? (
            <Trash2
              className="h-5 w-5 text-red-700 dark:text-red-400 shrink-0"
              aria-hidden="true"
            />
          ) : (
            <UserX className="h-5 w-5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
          )}
          <span>{isClientErasure ? t('titleClient') : t('titleContact')}</span>
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground mt-1">
          {isClientErasure
            ? t('descriptionClient')
            : t('descriptionContact', { name: contactName ?? targetDisplayName })}
        </DialogDescription>
      </DialogHeader>

      {error && (
        <div
          role="alert"
          className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive dark:text-red-300 font-medium flex items-center gap-2"
          data-testid="erasure-error"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {isLoadingPlan ? (
        <div className="py-8 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2
            className="h-6 w-6 animate-spin text-primary"
            aria-hidden="true"
            data-testid="erasure-loading-spinner"
          />
          <p className="text-sm">{t('loading')}</p>
        </div>
      ) : hasHolds ? (
        /* Erasure Blocked by Active Retention Holds (AC-4, AC-10) */
        <div className="space-y-4 py-2" data-testid="erasure-holds-alert">
          <div className="rounded-lg border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <ShieldAlert
                className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  {t('holdsTitle')}
                </h4>
                <p className="text-xs text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">
                  {t('holdsDescription')}
                </p>
              </div>
            </div>

            <ul className="space-y-2 pt-2 border-t border-amber-200/60 dark:border-amber-800/40 text-xs text-foreground">
              {holds.map((h, idx) => (
                <li
                  key={idx}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 p-2 rounded bg-background/60 border"
                  data-testid="erasure-hold-item"
                >
                  <span className="font-mono font-medium">{h.reason}</span>
                  <span className="text-muted-foreground">
                    {t('retainUntil', {
                      date: formatDate(h.retainUntil, locale),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : reauthRequired ? (
        /* Re-authentication Step (AC-7) */
        <form
          onSubmit={handleReauthSubmit}
          className="space-y-4 py-2"
          data-testid="erasure-reauth-form"
        >
          <div className="rounded-lg border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-2">
            <div className="flex items-start gap-2">
              <KeyRound
                className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  {t('reauthTitle')}
                </h4>
                <p className="text-xs text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">
                  {t('reauthDescription')}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="erasure-password" className="text-sm font-medium text-foreground block">
              {t('passwordLabel')}
            </label>
            <input
              id="erasure-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              placeholder={t('passwordPlaceholder')}
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[40px]"
              data-testid="erasure-password-input"
            />
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
              }}
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground min-h-[38px]"
              data-testid="erasure-cancel-btn"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={!password.trim() || isReauthenticating}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 min-h-[38px]"
              data-testid="erasure-confirm-password-btn"
            >
              {isReauthenticating && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {isReauthenticating ? t('reauthenticating') : t('confirmPassword')}
            </button>
          </DialogFooter>
        </form>
      ) : (
        /* Normal Erasure Confirmation View */
        <div className="space-y-4 py-2">
          {/* Plan: Category Counts */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2.5" data-testid="erasure-plan">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('planTitle')}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              {Object.entries(categoryCounts).map(([cat, count]) => {
                if (count <= 0) return null;
                const catTranslationKey =
                  cat === 'client'
                    ? 'categoryClient'
                    : cat === 'contacts'
                      ? 'categoryContacts'
                      : cat === 'addresses'
                        ? 'categoryAddresses'
                        : cat === 'tags'
                          ? 'categoryTags'
                          : cat === 'notes'
                            ? 'categoryNotes'
                            : cat === 'timeline'
                              ? 'categoryTimeline'
                              : cat === 'consents'
                                ? 'categoryConsents'
                                : null;
                const label = catTranslationKey ? t(catTranslationKey) : cat;
                return (
                  <div
                    key={cat}
                    className="flex items-center justify-between bg-background/80 px-2.5 py-1.5 rounded border text-xs sm:text-sm"
                    data-testid={`erasure-count-${cat}`}
                  >
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-semibold text-foreground">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Notes Warning (AC-3) */}
          {notesMayMentionPerson && (
            <div
              role="alert"
              className="rounded-lg border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 p-3.5 space-y-1 text-xs text-amber-900 dark:text-amber-200"
              data-testid="erasure-notes-warning"
            >
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle
                  className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0"
                  aria-hidden="true"
                />
                <span>{t('warningNotesTitle')}</span>
              </div>
              <p className="text-amber-800 dark:text-amber-300 pl-6 leading-relaxed">
                {t('warningNotesMayMention')}
              </p>
            </div>
          )}

          {/* Confirmation Input Field (AC-13) */}
          <div className="space-y-1.5 pt-1">
            <label
              htmlFor="erasure-confirmation"
              className="text-xs sm:text-sm font-medium text-foreground block"
            >
              {t('confirmationPrompt', { name: `"${targetDisplayName}"` })}
            </label>
            <input
              id="erasure-confirmation"
              type="text"
              value={confirmation}
              onChange={(e) => {
                setConfirmation(e.target.value);
              }}
              placeholder={t('confirmationPlaceholder')}
              autoComplete="off"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive min-h-[40px]"
              data-testid="erasure-confirmation-input"
            />
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
              }}
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground min-h-[38px]"
              data-testid="erasure-cancel-btn"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              disabled={!isConfirmationMatching || isSubmitting}
              onClick={() => void executeErasure()}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground shadow hover:bg-destructive/90 disabled:opacity-40 min-h-[38px]"
              data-testid="erasure-submit-btn"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>{t('erasing')}</span>
                </>
              ) : isClientErasure ? (
                <>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span>{t('confirmDeleteClient')}</span>
                </>
              ) : (
                <>
                  <UserX className="h-4 w-4" aria-hidden="true" />
                  <span>{t('confirmEraseContact')}</span>
                </>
              )}
            </button>
          </DialogFooter>
        </div>
      )}

      {hasHolds && (
        <DialogFooter className="pt-2">
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
            }}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground min-h-[38px] w-full sm:w-auto"
            data-testid="erasure-close-btn"
          >
            {t('close')}
          </button>
        </DialogFooter>
      )}
    </DialogContent>
  );
}

export function ErasureDialog({
  subject,
  clientDisplayName,
  contactName,
  open,
  onOpenChange,
  triggerRef,
  onSuccess,
}: ErasureDialogProps) {
  if (!subject) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <ErasureDialogInner
          subject={subject}
          clientDisplayName={clientDisplayName}
          contactName={contactName}
          triggerRef={triggerRef}
          onOpenChange={onOpenChange}
          onSuccess={onSuccess}
        />
      )}
    </Dialog>
  );
}
