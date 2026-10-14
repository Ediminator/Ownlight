'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import {
  ArrowLeft,
  Mail,
  Calendar,
  ShieldCheck,
  ShieldAlert,
  Download,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Archive,
  UserPlus,
  ExternalLink,
  Shield,
  Info,
  Loader2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  changeLeadStatusAction,
  deleteLeadsAction,
  exportLeadDsarAction,
  convertLeadToClientAction,
  getLeadDuplicatesAction,
} from '@/server/leads/actions';
import { reauthenticateAction } from '@/server/auth/mfa-actions';
import type { Lead, LeadStatus } from '@/server/db/schema/leads';
import type { LeadWithDetails } from '@/server/leads/service';
import type { DuplicateEmailMatch } from '@/server/clients/repo';

/**
 * Restores focus to the invoking trigger element upon modal dismissal (WCAG 2.4.3 / I1-U01).
 */
export function restoreFocusToTrigger(
  lastTrigger: HTMLElement | null,
  fallbackTrigger: HTMLElement | null,
  e?: { preventDefault?: () => void },
): boolean {
  const target = lastTrigger ?? fallbackTrigger;
  if (target) {
    e?.preventDefault?.();
    target.focus();
    return true;
  }
  return false;
}

/**
 * Formats lead conversion date localized with medium style (ADR-0015 §6).
 */
export function formatLeadConvertedDate(
  date: Date | string | null | undefined,
  locale: string,
): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString(locale, { dateStyle: 'medium' });
}

export interface LeadDetailViewProps {
  leadWithDetails: LeadWithDetails;
  locale: string;
  initialConvertModalOpen?: boolean;
  initialConvertMode?: 'new_client' | 'existing_client';
  initialConvertError?: string | null;
  initialDeleteModalOpen?: boolean;
  initialDeleteError?: string | null;
  initialReauthModalOpen?: boolean;
  initialReauthError?: string | null;
  initialIsConverting?: boolean;
}

export function LeadDetailView({
  leadWithDetails,
  locale,
  initialConvertModalOpen,
  initialConvertMode,
  initialConvertError,
  initialDeleteModalOpen,
  initialDeleteError,
  initialReauthModalOpen,
  initialReauthError,
  initialIsConverting,
}: LeadDetailViewProps) {
  const t = useTranslations('leads');
  const router = useRouter();

  const [lead, setLead] = React.useState<Lead>(leadWithDetails.lead);
  const [deleteModalOpen, setDeleteModalOpen] = React.useState(initialDeleteModalOpen ?? false);
  const [reauthModalOpen, setReauthModalOpen] = React.useState(initialReauthModalOpen ?? false);
  const [convertModalOpen, setConvertModalOpen] = React.useState(initialConvertModalOpen ?? false);
  const [reauthPassword, setReauthPassword] = React.useState('');
  const [reauthError, setReauthError] = React.useState<string | null>(initialReauthError ?? null);
  const [isReauthenticating, setIsReauthenticating] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(initialDeleteError ?? null);

  // Conversion state (TASK-0032)
  const [duplicates, setDuplicates] = React.useState<DuplicateEmailMatch[]>(
    leadWithDetails.duplicates ?? [],
  );
  const [convertMode, setConvertMode] = React.useState<'new_client' | 'existing_client'>(
    initialConvertMode ?? 'new_client',
  );
  const [selectedExistingClientId, setSelectedExistingClientId] = React.useState<string>(
    leadWithDetails.duplicates?.[0]?.clientId ?? '',
  );
  const [convertError, setConvertError] = React.useState<string | null>(
    initialConvertError ?? null,
  );
  const [isConverting, setIsConverting] = React.useState(initialIsConverting ?? false);

  // Focus restoration trigger refs (WCAG 2.4.3 / I1-U01)
  const convertHeaderTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const convertFooterTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const lastConvertTriggerRef = React.useRef<HTMLButtonElement | null>(null);

  const fullName = [lead.givenName, lead.familyName].filter(Boolean).join(' ') || '—';
  const receivedFormatted = new Date(lead.receivedAt).toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const acknowledgedFormatted = new Date(lead.noticeAcknowledgedAt).toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const noticeVersion = leadWithDetails.noticeVersion;
  const noticeText =
    locale === 'de' ? noticeVersion?.acknowledgementTextDe : noticeVersion?.acknowledgementTextEn;

  // Event type resolution
  let eventTypeLabel = lead.eventTypeKey ? t(`eventTypes.${lead.eventTypeKey}`) : null;
  if (leadWithDetails.formEventTypes && lead.eventTypeKey) {
    const matched = leadWithDetails.formEventTypes.find((e) => e.key === lead.eventTypeKey);
    if (matched) {
      eventTypeLabel = locale === 'de' ? matched.label_de : matched.label_en;
    }
  }

  // Status transitions
  const handleStatusChange = async (targetStatus: LeadStatus) => {
    const res = await changeLeadStatusAction({ leadId: lead.id, targetStatus });
    if (res.success) {
      setLead((prev) => ({ ...prev, status: targetStatus, lastActivityAt: new Date() }));
      router.refresh();
    }
  };

  // Delete lead
  const handleDeleteLead = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await deleteLeadsAction({ leadIds: [lead.id] });
      if (res.success) {
        setDeleteModalOpen(false);
        router.push(`/${locale}/leads`);
      } else {
        if (res.code === 'CONVERTED_LEAD') {
          setDeleteError(t('dialogs.errorConverted'));
        } else {
          setDeleteError(res.error || 'Failed to delete lead');
        }
      }
    } finally {
      setIsDeleting(false);
    }
  };

  // Trigger file download helper
  const triggerDownload = (content: string, filename: string, contentType: string) => {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Export DSAR data
  const handleExportDsar = async () => {
    const res = await exportLeadDsarAction({ leadId: lead.id });
    if (!res.success) {
      if (res.code === 'REAUTH_REQUIRED') {
        setReauthPassword('');
        setReauthError(null);
        setReauthModalOpen(true);
      }
      return;
    }

    triggerDownload(res.data.content, res.data.filename, res.data.contentType);
  };

  // Reauth form submission
  const handleReauthSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!reauthPassword.trim()) return;

    setIsReauthenticating(true);
    setReauthError(null);

    try {
      const reauthRes = await reauthenticateAction({ password: reauthPassword });
      if (!reauthRes.success) {
        setReauthError(t('reauth.invalidPassword'));
        return;
      }

      // Re-authenticated! Now export
      const exportRes = await exportLeadDsarAction({ leadId: lead.id });
      if (exportRes.success) {
        setReauthModalOpen(false);
        setReauthPassword('');
        triggerDownload(
          exportRes.data.content,
          exportRes.data.filename,
          exportRes.data.contentType,
        );
      } else {
        setReauthError(exportRes.error || 'Export failed');
      }
    } finally {
      setIsReauthenticating(false);
    }
  };

  // Open conversion modal and check duplicates (AC-1, AC-2, I1-U01)
  const handleOpenConvertModal = (e?: React.MouseEvent<HTMLButtonElement>) => {
    if (e?.currentTarget) {
      lastConvertTriggerRef.current = e.currentTarget;
    }
    setConvertError(null);
    setConvertModalOpen(true);
    void (async () => {
      try {
        const res = await getLeadDuplicatesAction({ leadId: lead.id });
        if (res.success) {
          setDuplicates(res.duplicates);
          if (res.duplicates.length > 0) {
            if (!selectedExistingClientId && res.duplicates[0]) {
              setSelectedExistingClientId(res.duplicates[0].clientId);
            }
          }
        }
      } catch {
        // Keep existing state
      }
    })();
  };

  const handleConvertCloseAutoFocus = (e: Event) => {
    restoreFocusToTrigger(lastConvertTriggerRef.current, convertHeaderTriggerRef.current, e);
  };

  // Confirm conversion execution (AC-1, AC-2, AC-3)
  const handleConfirmConvert = async () => {
    if (convertMode === 'existing_client' && !selectedExistingClientId) {
      setConvertError(t('convert.errorRequiredClient'));
      return;
    }

    setIsConverting(true);
    setConvertError(null);

    try {
      const res = await convertLeadToClientAction({
        leadId: lead.id,
        mode: convertMode,
        existingClientId: convertMode === 'existing_client' ? selectedExistingClientId : null,
      });

      if (!res.success) {
        setConvertError(res.error || t('convert.errorGeneric'));
        return;
      }

      setConvertModalOpen(false);
      router.push(`/${locale}/clients/${res.clientId}`);
    } catch {
      setConvertError(t('convert.errorGeneric'));
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Back Link */}
      <div>
        <Link
          href="/leads"
          data-testid="back-to-leads-link"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground font-medium transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>{t('detail.backToLeads')}</span>
        </Link>
      </div>

      {/* Converted Banner (ADR-0015 §6, TASK-0032) */}
      {lead.status === 'converted' && (
        <div
          data-testid="lead-converted-banner"
          className="p-4 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-emerald-950 dark:text-emerald-100 shadow-sm"
        >
          <div className="flex items-center gap-2.5 font-semibold text-sm">
            <CheckCircle
              className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0"
              aria-hidden="true"
            />
            <span>
              {t('convert.convertedBanner', {
                date: formatLeadConvertedDate(lead.convertedAt, locale),
              })}
            </span>
          </div>
          {lead.clientId && (
            <Link
              href={`/clients/${lead.clientId}`}
              data-testid="converted-client-link"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-800 hover:bg-emerald-900 text-white dark:bg-emerald-700 dark:hover:bg-emerald-600 text-xs font-semibold shadow-sm transition-colors shrink-0"
            >
              <span>{t('convert.viewClient')}</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}

      {/* Header Card */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1
              data-testid="lead-full-name"
              className="text-2xl font-bold tracking-tight text-foreground"
            >
              {fullName}
            </h1>
            <span
              data-testid="lead-status-badge"
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                lead.status === 'contacted'
                  ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                  : lead.status === 'converted'
                    ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                    : lead.status === 'spam'
                      ? 'bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-300 border-rose-300 dark:border-rose-800'
                      : lead.status === 'archived'
                        ? 'bg-muted text-foreground border-border'
                        : 'bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-300 border-blue-300 dark:border-blue-800'
              }`}
            >
              {t(`status.${lead.status}`)}
            </span>
            <span
              data-testid="lead-verification-badge"
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                lead.verification === 'verified'
                  ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                  : 'bg-muted text-foreground border-border'
              }`}
            >
              {lead.verification === 'verified' ? (
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{t(`verification.${lead.verification}`)}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span data-testid="lead-received-at">
              {t('table.receivedAt')}: {receivedFormatted}
            </span>
            <span>•</span>
            <span data-testid="lead-delivery-mode">
              {t('table.deliveryMode')}:{' '}
              <strong className="capitalize">{t(`deliveryMode.${lead.deliveryMode}`)}</strong>
            </span>
            {leadWithDetails.formName && (
              <>
                <span>•</span>
                <span>{t('detail.formLabel', { name: leadWithDetails.formName })}</span>
              </>
            )}
          </div>
        </div>

        {/* Hygiene & Status Actions */}
        {lead.status !== 'converted' && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              ref={convertHeaderTriggerRef}
              type="button"
              data-testid="convert-lead-btn"
              onClick={handleOpenConvertModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('actions.convertToClient')}</span>
            </button>

            {lead.status !== 'contacted' && (
              <button
                type="button"
                data-testid="mark-contacted-btn"
                onClick={() => {
                  void handleStatusChange('contacted');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                <CheckCircle className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                <span>{t('actions.markContacted')}</span>
              </button>
            )}

            {lead.status !== 'spam' && (
              <button
                type="button"
                data-testid="mark-spam-btn"
                onClick={() => {
                  void handleStatusChange('spam');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                <span>{t('actions.markSpam')}</span>
              </button>
            )}

            {lead.status !== 'archived' && (
              <button
                type="button"
                data-testid="mark-archived-btn"
                onClick={() => {
                  void handleStatusChange('archived');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                <Archive className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <span>{t('actions.archive')}</span>
              </button>
            )}

            <button
              type="button"
              data-testid="delete-lead-btn"
              onClick={() => {
                setDeleteModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-destructive/10 text-destructive dark:text-red-400 hover:bg-destructive/20 border border-destructive/20 dark:border-red-900/40 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('actions.delete')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Grid of details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Contact Details Card */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" aria-hidden="true" />
            <span>{t('detail.contactCardTitle')}</span>
          </h2>

          <dl className="grid grid-cols-1 gap-3 text-sm">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">{t('detail.givenName')}</dt>
              <dd className="font-semibold text-foreground">{lead.givenName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                {t('detail.familyName')}
              </dt>
              <dd className="font-semibold text-foreground">{lead.familyName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">{t('detail.email')}</dt>
              <dd>
                {lead.email ? (
                  <a
                    href={`mailto:${lead.email}`}
                    data-testid="lead-email-link"
                    className="text-primary hover:underline font-medium inline-flex items-center gap-1"
                  >
                    <span>{lead.email}</span>
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">{t('detail.phone')}</dt>
              <dd>
                {lead.phone ? (
                  <a
                    href={`tel:${lead.phone}`}
                    data-testid="lead-phone-link"
                    className="text-primary hover:underline font-medium inline-flex items-center gap-1"
                  >
                    <span>{lead.phone}</span>
                  </a>
                ) : (
                  <span className="text-muted-foreground text-xs">{t('detail.notSpecified')}</span>
                )}
              </dd>
            </div>
          </dl>
        </div>

        {/* Shoot Details Card */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" aria-hidden="true" />
            <span>{t('detail.shootCardTitle')}</span>
          </h2>

          <dl className="grid grid-cols-1 gap-3 text-sm">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">{t('detail.eventType')}</dt>
              <dd data-testid="lead-event-type" className="font-semibold text-foreground">
                {eventTypeLabel ?? t('detail.notSpecified')}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">{t('detail.eventDate')}</dt>
              <dd data-testid="lead-event-date" className="font-semibold text-foreground">
                {lead.eventDate ?? (
                  <span className="text-muted-foreground text-xs">{t('detail.notSpecified')}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                {t('detail.eventLocation')}
              </dt>
              <dd data-testid="lead-event-location" className="font-semibold text-foreground">
                {lead.eventLocation ?? (
                  <span className="text-muted-foreground text-xs">{t('detail.notSpecified')}</span>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Inquiry Message Card (D7) */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Info className="h-5 w-5 text-primary" aria-hidden="true" />
          <span>{t('detail.messageCardTitle')}</span>
        </h2>

        {/* Discretion Notice */}
        <div
          data-testid="discretion-notice"
          className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 font-medium"
        >
          {t('detail.discretionNotice')}
        </div>

        {/* Message body strictly escaped & rendered as text (AC-9) */}
        <div className="p-4 rounded-lg bg-muted/40 border border-border min-h-[5rem]">
          {lead.message ? (
            <p
              data-testid="lead-message-content"
              className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed break-words"
            >
              {lead.message}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">{t('detail.notSpecified')}</p>
          )}
        </div>
      </div>

      {/* Compliance & Notice Card */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" aria-hidden="true" />
          <span>{t('detail.complianceCardTitle')}</span>
        </h2>

        <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">
              {t('detail.noticeVersion')}
            </dt>
            <dd data-testid="notice-version" className="font-semibold text-foreground">
              {noticeVersion ? `v${String(noticeVersion.version)}` : 'v1'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">
              {t('detail.acknowledgedAt')}
            </dt>
            <dd data-testid="notice-acknowledged-at" className="font-semibold text-foreground">
              {acknowledgedFormatted}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{t('table.autoReply')}</dt>
            <dd
              data-testid="auto-reply-status"
              className="font-semibold capitalize text-foreground"
            >
              {t(`autoReplyStatus.${lead.autoReplyStatus}`)}
            </dd>
          </div>
          {noticeVersion?.privacyPolicyUrl && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                {t('detail.privacyPolicy')}
              </dt>
              <dd>
                <a
                  href={noticeVersion.privacyPolicyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="privacy-policy-link"
                  className="text-primary hover:underline font-medium text-xs inline-flex items-center gap-1"
                >
                  <span>{noticeVersion.privacyPolicyUrl}</span>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </dd>
            </div>
          )}
        </dl>

        {noticeText && (
          <div className="pt-2 border-t border-border">
            <span className="text-xs font-medium text-muted-foreground block mb-1">
              {t('detail.noticeText')}
            </span>
            <p
              data-testid="notice-text"
              className="text-xs text-muted-foreground italic bg-muted/30 p-2.5 rounded border border-border"
            >
              &ldquo;{noticeText}&rdquo;
            </p>
          </div>
        )}
      </div>

      {/* Footer Management Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {/* DSAR Export */}
          <button
            type="button"
            data-testid="export-dsar-btn"
            onClick={() => {
              void handleExportDsar();
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 text-sm font-medium transition-colors"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>{t('actions.exportDsar')}</span>
          </button>

          {/* Convert to client button */}
          {lead.status !== 'converted' && (
            <button
              ref={convertFooterTriggerRef}
              type="button"
              data-testid="convert-to-client-btn"
              onClick={handleOpenConvertModal}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium transition-colors"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              <span>{t('actions.convertToClient')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Step-Up Re-Authentication Modal (AC-8) */}
      <Dialog open={reauthModalOpen} onOpenChange={setReauthModalOpen}>
        <DialogContent data-testid="reauth-modal">
          <DialogHeader>
            <DialogTitle>{t('reauth.title')}</DialogTitle>
            <DialogDescription className="text-sm text-zinc-700 dark:text-zinc-300">
              {t('reauth.description')}
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              void handleReauthSubmit(e);
            }}
            className="space-y-4"
          >
            <div className="space-y-1">
              <label
                htmlFor="reauth-password-input"
                className="text-xs font-medium text-foreground"
              >
                {t('reauth.passwordLabel')}
              </label>
              <input
                id="reauth-password-input"
                data-testid="reauth-password-input"
                type="password"
                required
                value={reauthPassword}
                onChange={(e) => {
                  setReauthPassword(e.target.value);
                }}
                placeholder={t('reauth.passwordPlaceholder')}
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {reauthError && (
              <div
                role="alert"
                className="p-3 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 font-medium"
              >
                {reauthError}
              </div>
            )}

            <DialogFooter>
              <button
                type="button"
                disabled={isReauthenticating}
                onClick={() => {
                  setReauthModalOpen(false);
                }}
                className="px-4 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-medium"
              >
                {t('reauth.cancel')}
              </button>
              <button
                type="submit"
                data-testid="reauth-submit-btn"
                disabled={isReauthenticating || !reauthPassword.trim()}
                className="px-4 py-2 text-sm rounded-md bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 font-medium disabled:opacity-50"
              >
                {isReauthenticating ? t('reauth.confirming') : t('reauth.confirm')}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Lead Dialog */}
      <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <DialogContent data-testid="delete-lead-modal">
          <DialogHeader>
            <DialogTitle>{t('dialogs.deleteSingleTitle')}</DialogTitle>
            <DialogDescription className="text-sm text-zinc-700 dark:text-zinc-300">
              {t('dialogs.deleteSingleDescription')}
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <div
              role="alert"
              className="p-3 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 font-medium"
            >
              {deleteError}
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => {
                setDeleteModalOpen(false);
              }}
              className="px-4 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-medium"
            >
              {t('dialogs.cancel')}
            </button>
            <button
              type="button"
              data-testid="confirm-delete-lead-btn"
              disabled={isDeleting}
              onClick={() => {
                void handleDeleteLead();
              }}
              className="px-4 py-2 text-sm rounded-md bg-red-700 hover:bg-red-800 dark:bg-red-700 dark:hover:bg-red-800 text-white font-semibold"
            >
              {isDeleting ? t('dialogs.deleting') : t('dialogs.confirmDelete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lead Conversion Dialog (TASK-0032) */}
      <Dialog open={convertModalOpen} onOpenChange={setConvertModalOpen}>
        <DialogContent
          data-testid="convert-lead-dialog"
          className="max-w-xl max-h-[90vh] overflow-y-auto"
          onCloseAutoFocus={handleConvertCloseAutoFocus}
        >
          <DialogHeader>
            <DialogTitle>{t('convert.title')}</DialogTitle>
            <DialogDescription className="text-sm text-zinc-700 dark:text-zinc-300">
              {t('convert.description')}
            </DialogDescription>
          </DialogHeader>

          {/* Duplicate Alert if matches found (AC-2) */}
          {duplicates.length > 0 && (
            <div
              role="alert"
              data-testid="duplicate-alert"
              className="p-3.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100 space-y-1.5 text-xs"
            >
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle
                  className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0"
                  aria-hidden="true"
                />
                <span>{t('convert.duplicateAlertTitle')}</span>
              </div>
              <p className="leading-relaxed">
                {t('convert.duplicateAlertMessage', { email: lead.email ?? '' })}
              </p>
              <div className="font-medium text-amber-900 dark:text-amber-200">
                {t('convert.matchingClientName', {
                  name: duplicates.map((d) => d.displayName).join(', '),
                })}
              </div>
            </div>
          )}

          {/* Mode Selection */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-foreground block">
              {t('convert.modeLabel')}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label
                data-testid="convert-mode-new-label"
                className={`relative flex flex-col p-3 rounded-lg border cursor-pointer transition-colors ${
                  convertMode === 'new_client'
                    ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary'
                    : 'border-border bg-card hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">
                    {t('convert.newClient')}
                  </span>
                  <input
                    type="radio"
                    name="convert-mode"
                    data-testid="convert-mode-new"
                    value="new_client"
                    checked={convertMode === 'new_client'}
                    onChange={() => {
                      setConvertMode('new_client');
                    }}
                    className="h-4 w-4 text-primary focus:ring-primary border-border"
                  />
                </div>
                <span className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                  {t('convert.newClientDescription')}
                </span>
              </label>

              <label
                data-testid="convert-mode-existing-label"
                className={`relative flex flex-col p-3 rounded-lg border cursor-pointer transition-colors ${
                  convertMode === 'existing_client'
                    ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary'
                    : 'border-border bg-card hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">
                    {t('convert.existingClient')}
                  </span>
                  <input
                    type="radio"
                    name="convert-mode"
                    data-testid="mode-existing-client"
                    value="existing_client"
                    checked={convertMode === 'existing_client'}
                    onChange={() => {
                      setConvertMode('existing_client');
                    }}
                    className="h-4 w-4 text-primary focus:ring-primary border-border"
                  />
                </div>
                <span className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                  {t('convert.existingClientDescription')}
                </span>
              </label>
            </div>
          </div>

          {/* Existing client picker if existing_client chosen */}
          {convertMode === 'existing_client' && (
            <div className="space-y-1.5">
              <label
                htmlFor="existing-client-select"
                className="text-xs font-semibold text-foreground"
              >
                {t('convert.selectClient')}
              </label>
              <select
                id="existing-client-select"
                data-testid="existing-client-select"
                value={selectedExistingClientId}
                onChange={(e) => {
                  setSelectedExistingClientId(e.target.value);
                }}
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
              >
                {duplicates.length > 0 ? (
                  duplicates.map((dup) => (
                    <option key={dup.clientId} value={dup.clientId}>
                      {dup.displayName} ({dup.clientId.slice(0, 8)}…)
                    </option>
                  ))
                ) : (
                  <option value="">{t('convert.selectClientPlaceholder')}</option>
                )}
              </select>
            </div>
          )}

          {/* Preview Card */}
          <div
            data-testid="conversion-preview"
            className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 space-y-3 text-xs"
          >
            <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
              {t('convert.previewTitle')}
            </h3>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <dt className="text-zinc-800 dark:text-zinc-200 font-medium">
                  {t('convert.clientName')}
                </dt>
                <dd className="font-bold text-zinc-950 dark:text-zinc-50">{fullName}</dd>
              </div>
              <div>
                <dt className="text-zinc-800 dark:text-zinc-200 font-medium">
                  {t('convert.primaryContact')}
                </dt>
                <dd className="font-bold text-zinc-950 dark:text-zinc-50">
                  {lead.email ?? '—'}
                  {lead.phone ? ` • ${lead.phone}` : ''}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-zinc-800 dark:text-zinc-200 font-medium">
                  {t('convert.retainedDetails')}
                </dt>
                <dd className="font-bold text-zinc-950 dark:text-zinc-50">
                  {[eventTypeLabel, lead.eventDate, lead.eventLocation]
                    .filter(Boolean)
                    .join(' • ') || '—'}
                </dd>
              </div>
              {lead.message && (
                <div className="sm:col-span-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                  <dt className="text-zinc-800 dark:text-zinc-200 font-medium mb-1">
                    {t('convert.inquiryNote')}
                  </dt>
                  <dd className="p-2.5 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 text-xs leading-relaxed font-sans max-h-24 overflow-y-auto whitespace-pre-wrap">
                    <strong className="block text-zinc-800 dark:text-zinc-200 font-semibold mb-1">
                      Inquiry message ({leadWithDetails.formName ?? 'Inquiry form'},{' '}
                      {new Date(lead.receivedAt).toISOString().slice(0, 10)})
                    </strong>
                    {lead.message}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {convertError && (
            <div
              role="alert"
              data-testid="convert-error"
              className="p-3 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 font-medium"
            >
              {convertError}
            </div>
          )}

          <DialogFooter className="flex gap-2">
            <button
              type="button"
              data-testid="cancel-convert-btn"
              disabled={isConverting}
              onClick={() => {
                setConvertModalOpen(false);
              }}
              className="px-4 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-medium shadow-sm transition-colors"
            >
              {t('convert.cancel')}
            </button>
            <button
              type="button"
              data-testid="confirm-convert-btn"
              disabled={
                isConverting || (convertMode === 'existing_client' && !selectedExistingClientId)
              }
              onClick={() => {
                void handleConfirmConvert();
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 font-medium disabled:opacity-50"
            >
              {isConverting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden="true" />
                  <span>{t('convert.confirming')}</span>
                </>
              ) : (
                <span>{t('convert.confirm')}</span>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
