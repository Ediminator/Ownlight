'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Lock,
  History,
  Send,
  EyeOff,
  Archive,
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
  updateInquiryFormAction,
  createNoticeVersionAction,
  publishInquiryFormAction,
  unpublishInquiryFormAction,
  archiveInquiryFormAction,
} from '@/server/inquiry-forms/actions';
import type {
  InquiryForm,
  InquiryFormNoticeVersion,
  InquiryFormFieldConfig,
  InquiryFormEventType,
} from '@/server/db/schema/inquiry-forms';

export function swapArrayItems<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return [...items];
  }
  const fromItem = items.at(fromIndex);
  const toItem = items.at(toIndex);
  if (!fromItem || !toItem) return [...items];

  return items.map((item, idx) => {
    if (idx === fromIndex) return toItem;
    if (idx === toIndex) return fromItem;
    return item;
  });
}

interface InquiryFormEditViewProps {
  form: InquiryForm;
  noticeVersions: InquiryFormNoticeVersion[];
  locale: string;
}

export function InquiryFormEditView({
  form: initialForm,
  noticeVersions: initialNoticeVersions,
  locale,
}: InquiryFormEditViewProps) {
  const t = useTranslations('settings.inquiryForms');
  const tLabels = useTranslations('settings.inquiryForms.fields.labels');

  // Form state
  const [form, setForm] = React.useState<InquiryForm>(initialForm);
  const [versions, setVersions] = React.useState<InquiryFormNoticeVersion[]>(initialNoticeVersions);

  // Section 1: General state
  const [name, setName] = React.useState(form.name);
  const [defaultLocale, setDefaultLocale] = React.useState<'en' | 'de'>(
    form.defaultLocale === 'de' ? 'de' : 'en',
  );
  const [autoReplyEnabled, setAutoReplyEnabled] = React.useState(form.autoReplyEnabled);
  const [acceptUnverified, setAcceptUnverified] = React.useState(form.acceptUnverified);
  const [successRedirectUrl, setSuccessRedirectUrl] = React.useState(form.successRedirectUrl ?? '');

  // Section 2: Fields state
  const [fields, setFields] = React.useState<InquiryFormFieldConfig[]>(() => {
    return [...form.fields].sort((a, b) => a.order - b.order);
  });

  // Section 3: Event types state
  const [eventTypes, setEventTypes] = React.useState<InquiryFormEventType[]>(() => {
    return [...form.eventTypes];
  });
  const [newKey, setNewKey] = React.useState('');
  const [newLabelEn, setNewLabelEn] = React.useState('');
  const [newLabelDe, setNewLabelDe] = React.useState('');
  const [eventTypeInputError, setEventTypeInputError] = React.useState<string | null>(null);

  // Section 4: Privacy Notice state
  const currentNotice = React.useMemo(() => {
    return versions.find((v) => v.id === form.currentNoticeVersionId) ?? versions[0] ?? null;
  }, [versions, form.currentNoticeVersionId]);

  const [newPolicyUrl, setNewPolicyUrl] = React.useState(currentNotice?.privacyPolicyUrl ?? '');
  const [newAckEn, setNewAckEn] = React.useState(currentNotice?.acknowledgementTextEn ?? '');
  const [newAckDe, setNewAckDe] = React.useState(currentNotice?.acknowledgementTextDe ?? '');

  // UI status state
  const [isSavingGeneral, setIsSavingGeneral] = React.useState(false);
  const [isSavingFields, setIsSavingFields] = React.useState(false);
  const [isSavingEventTypes, setIsSavingEventTypes] = React.useState(false);
  const [isSavingNotice, setIsSavingNotice] = React.useState(false);
  const [isPublishing, setIsPublishing] = React.useState(false);
  const [isUnpublishing, setIsUnpublishing] = React.useState(false);
  const [isArchiving, setIsArchiving] = React.useState(false);
  const [isArchiveDialogOpen, setIsArchiveDialogOpen] = React.useState(false);

  const [notification, setNotification] = React.useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const [errorSummary, setErrorSummary] = React.useState<{
    title: string;
    errors: { fieldId: string; message: string }[];
  } | null>(null);

  const [publishPreconditionError, setPublishPreconditionError] = React.useState<string | null>(
    null,
  );

  const errorSummaryRef = React.useRef<HTMLDivElement | null>(null);
  const archiveTriggerRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (errorSummary && errorSummaryRef.current) {
      errorSummaryRef.current.focus();
    }
  }, [errorSummary]);

  const formatDate = React.useCallback(
    (date: Date | string) => {
      try {
        return new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(date));
      } catch {
        return String(date);
      }
    },
    [locale],
  );

  const getFieldLabel = (key: string): string => {
    switch (key) {
      case 'given_name':
        return tLabels('given_name');
      case 'email':
        return tLabels('email');
      case 'family_name':
        return tLabels('family_name');
      case 'phone':
        return tLabels('phone');
      case 'event_type':
        return tLabels('event_type');
      case 'event_date':
        return tLabels('event_date');
      case 'event_location':
        return tLabels('event_location');
      case 'message':
        return tLabels('message');
      default:
        return key;
    }
  };

  // 1. General save handler
  const handleSaveGeneral = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setErrorSummary(null);
    setPublishPreconditionError(null);
    setNotification(null);

    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 100) {
      setErrorSummary({
        title: t('edit.errorSummaryTitle'),
        errors: [{ fieldId: 'edit-form-name', message: t('errors.nameRequired') }],
      });
      return;
    }

    setIsSavingGeneral(true);
    try {
      const res = await updateInquiryFormAction({
        id: form.id,
        name: trimmedName,
        default_locale: defaultLocale,
        auto_reply_enabled: autoReplyEnabled,
        accept_unverified: acceptUnverified,
        success_redirect_url: successRedirectUrl.trim() ? successRedirectUrl.trim() : null,
      });

      setIsSavingGeneral(false);
      if (res.success) {
        setForm(res.data);
        setNotification({ type: 'success', message: t('edit.savedSuccess') });
      } else {
        setErrorSummary({
          title: t('edit.errorSummaryTitle'),
          errors: [{ fieldId: 'general-section', message: res.error || t('errors.generic') }],
        });
      }
    } catch {
      setIsSavingGeneral(false);
      setErrorSummary({
        title: t('edit.errorSummaryTitle'),
        errors: [{ fieldId: 'general-section', message: t('errors.generic') }],
      });
    }
  };

  // 2. Fields helpers & save handler
  const handleToggleFieldEnabled = (key: string, enabled: boolean) => {
    if (key === 'given_name' || key === 'email') return;
    setFields((prev) =>
      prev.map((f) =>
        f.key === key ? { ...f, enabled, required: enabled ? f.required : false } : f,
      ),
    );
  };

  const handleToggleFieldRequired = (key: string, required: boolean) => {
    if (key === 'given_name' || key === 'email') return;
    setFields((prev) => prev.map((f) => (f.key === key ? { ...f, required } : f)));
  };

  const handleMoveField = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= fields.length) return;

    setFields((prev) => {
      const swapped = swapArrayItems(prev, index, targetIndex);
      return swapped.map((f, i) => ({ ...f, order: i }));
    });
  };

  const handleSaveFields = async () => {
    setErrorSummary(null);
    setPublishPreconditionError(null);
    setNotification(null);

    // AC-3: If event_type is enabled and eventTypes.length === 0, show error summary linked to event types
    const eventTypeEnabled = fields.some((f) => f.key === 'event_type' && f.enabled);
    if (eventTypeEnabled && eventTypes.length === 0) {
      setErrorSummary({
        title: t('edit.errorSummaryTitle'),
        errors: [{ fieldId: 'event-types-section', message: t('errors.missingEventTypes') }],
      });
      return;
    }

    setIsSavingFields(true);
    try {
      const res = await updateInquiryFormAction({
        id: form.id,
        fields,
      });

      setIsSavingFields(false);
      if (res.success) {
        setForm(res.data);
        setFields([...res.data.fields].sort((a, b) => a.order - b.order));
        setNotification({ type: 'success', message: t('edit.savedSuccess') });
      } else {
        setErrorSummary({
          title: t('edit.errorSummaryTitle'),
          errors: [{ fieldId: 'fields-section', message: res.error || t('errors.generic') }],
        });
      }
    } catch {
      setIsSavingFields(false);
      setErrorSummary({
        title: t('edit.errorSummaryTitle'),
        errors: [{ fieldId: 'fields-section', message: t('errors.generic') }],
      });
    }
  };

  // 3. Event types helpers & save handler
  const handleAddEventType = (e: React.SyntheticEvent) => {
    e.preventDefault();
    setEventTypeInputError(null);

    const trimmedKey = newKey.trim().toLowerCase();
    const trimmedEn = newLabelEn.trim();
    const trimmedDe = newLabelDe.trim();

    if (!trimmedKey || !/^[a-z0-9-]{1,40}$/.test(trimmedKey)) {
      setEventTypeInputError(
        'Key must match /^[a-z0-9-]{1,40}$/ (lowercase letters, numbers, hyphens).',
      );
      return;
    }

    if (!trimmedEn || trimmedEn.length > 60) {
      setEventTypeInputError('English label must be between 1 and 60 characters.');
      return;
    }

    if (!trimmedDe || trimmedDe.length > 60) {
      setEventTypeInputError('German label must be between 1 and 60 characters.');
      return;
    }

    if (eventTypes.some((et) => et.key === trimmedKey)) {
      setEventTypeInputError(`Duplicate key "${trimmedKey}".`);
      return;
    }

    setEventTypes((prev) => [
      ...prev,
      { key: trimmedKey, label_en: trimmedEn, label_de: trimmedDe },
    ]);
    setNewKey('');
    setNewLabelEn('');
    setNewLabelDe('');
  };

  const handleRemoveEventType = (key: string) => {
    setEventTypes((prev) => prev.filter((et) => et.key !== key));
  };

  const handleMoveEventType = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= eventTypes.length) return;

    setEventTypes((prev) => swapArrayItems(prev, index, targetIndex));
  };

  const handleSaveEventTypes = async () => {
    setErrorSummary(null);
    setPublishPreconditionError(null);
    setNotification(null);

    const eventTypeEnabled = fields.some((f) => f.key === 'event_type' && f.enabled);
    if (eventTypeEnabled && eventTypes.length === 0) {
      setErrorSummary({
        title: t('edit.errorSummaryTitle'),
        errors: [{ fieldId: 'event-types-section', message: t('errors.missingEventTypes') }],
      });
      return;
    }

    setIsSavingEventTypes(true);
    try {
      const res = await updateInquiryFormAction({
        id: form.id,
        event_types: eventTypes,
      });

      setIsSavingEventTypes(false);
      if (res.success) {
        setForm(res.data);
        setEventTypes([...res.data.eventTypes]);
        setNotification({ type: 'success', message: t('edit.savedSuccess') });
      } else {
        setErrorSummary({
          title: t('edit.errorSummaryTitle'),
          errors: [{ fieldId: 'event-types-section', message: res.error || t('errors.generic') }],
        });
      }
    } catch {
      setIsSavingEventTypes(false);
      setErrorSummary({
        title: t('edit.errorSummaryTitle'),
        errors: [{ fieldId: 'event-types-section', message: t('errors.generic') }],
      });
    }
  };

  // 4. Privacy Notice version save handler (AC-4)
  const handleSaveNoticeVersion = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setErrorSummary(null);
    setPublishPreconditionError(null);
    setNotification(null);

    const trimmedUrl = newPolicyUrl.trim();
    const trimmedEn = newAckEn.trim();
    const trimmedDe = newAckDe.trim();

    if (!trimmedUrl.startsWith('https://')) {
      setErrorSummary({
        title: t('edit.errorSummaryTitle'),
        errors: [{ fieldId: 'notice-policy-url', message: t('errors.invalidPolicyUrl') }],
      });
      return;
    }

    if (
      !trimmedEn ||
      trimmedEn.length > 500 ||
      trimmedEn.includes('<') ||
      trimmedEn.includes('>') ||
      !trimmedDe ||
      trimmedDe.length > 500 ||
      trimmedDe.includes('<') ||
      trimmedDe.includes('>')
    ) {
      setErrorSummary({
        title: t('edit.errorSummaryTitle'),
        errors: [{ fieldId: 'notice-ack-en', message: t('errors.invalidNoticeText') }],
      });
      return;
    }

    setIsSavingNotice(true);
    try {
      const res = await createNoticeVersionAction({
        formId: form.id,
        privacy_policy_url: trimmedUrl,
        acknowledgement_text_en: trimmedEn,
        acknowledgement_text_de: trimmedDe,
      });

      setIsSavingNotice(false);
      if (res.success) {
        const newVersion = res.data;
        setForm((prev) => ({ ...prev, currentNoticeVersionId: newVersion.id }));
        setVersions((prev) => [newVersion, ...prev]);
        setNotification({ type: 'success', message: t('edit.savedSuccess') });
      } else {
        setErrorSummary({
          title: t('edit.errorSummaryTitle'),
          errors: [
            { fieldId: 'privacy-notice-section', message: res.error || t('errors.generic') },
          ],
        });
      }
    } catch {
      setIsSavingNotice(false);
      setErrorSummary({
        title: t('edit.errorSummaryTitle'),
        errors: [{ fieldId: 'privacy-notice-section', message: t('errors.generic') }],
      });
    }
  };

  // Status Actions: Publish (AC-5), Unpublish, Archive
  const handlePublish = async () => {
    setErrorSummary(null);
    setPublishPreconditionError(null);
    setNotification(null);

    setIsPublishing(true);
    try {
      const res = await publishInquiryFormAction({ id: form.id });
      setIsPublishing(false);

      if (res.success) {
        setForm(res.data);
        setNotification({ type: 'success', message: t('edit.publishSuccess') });
      } else if (res.code === 'PUBLISH_PRECONDITION_FAILED') {
        setPublishPreconditionError(t('edit.publishPreconditionError'));
      } else {
        setErrorSummary({
          title: t('edit.errorSummaryTitle'),
          errors: [{ fieldId: 'status-actions-bar', message: res.error || t('errors.generic') }],
        });
      }
    } catch {
      setIsPublishing(false);
      setErrorSummary({
        title: t('edit.errorSummaryTitle'),
        errors: [{ fieldId: 'status-actions-bar', message: t('errors.generic') }],
      });
    }
  };

  const handleUnpublish = async () => {
    setErrorSummary(null);
    setPublishPreconditionError(null);
    setNotification(null);

    setIsUnpublishing(true);
    try {
      const res = await unpublishInquiryFormAction({ id: form.id });
      setIsUnpublishing(false);

      if (res.success) {
        setForm(res.data);
        setNotification({ type: 'success', message: t('edit.unpublishSuccess') });
      } else {
        setErrorSummary({
          title: t('edit.errorSummaryTitle'),
          errors: [{ fieldId: 'status-actions-bar', message: res.error || t('errors.generic') }],
        });
      }
    } catch {
      setIsUnpublishing(false);
      setErrorSummary({
        title: t('edit.errorSummaryTitle'),
        errors: [{ fieldId: 'status-actions-bar', message: t('errors.generic') }],
      });
    }
  };

  const handleConfirmArchive = async () => {
    setIsArchiving(true);
    setErrorSummary(null);
    setPublishPreconditionError(null);
    setNotification(null);

    try {
      const res = await archiveInquiryFormAction({ id: form.id });
      setIsArchiving(false);
      setIsArchiveDialogOpen(false);

      if (res.success) {
        setForm(res.data);
        setNotification({ type: 'success', message: t('edit.archiveSuccess') });
      } else {
        setErrorSummary({
          title: t('edit.errorSummaryTitle'),
          errors: [{ fieldId: 'status-actions-bar', message: res.error || t('errors.generic') }],
        });
      }
    } catch {
      setIsArchiving(false);
      setIsArchiveDialogOpen(false);
      setErrorSummary({
        title: t('edit.errorSummaryTitle'),
        errors: [{ fieldId: 'status-actions-bar', message: t('errors.generic') }],
      });
    }
  };

  return (
    <div className="space-y-8 max-w-5xl w-full min-w-0" data-testid="inquiry-form-edit-view">
      {/* Back Link */}
      <div>
        <Link
          href="/settings/inquiry-forms"
          data-testid="back-to-forms-link"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors min-h-[36px] py-1"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>{t('backToList')}</span>
        </Link>
      </div>

      {/* Header and Status Actions Bar */}
      <div
        data-testid="status-actions-bar"
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-6"
      >
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1
              data-testid="edit-form-title"
              className="text-xl sm:text-2xl font-bold tracking-tight text-foreground break-words"
            >
              {form.name}
            </h1>
            <div>
              {form.status === 'published' && (
                <span
                  data-testid="status-badge-published"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                  {t('status.published')}
                </span>
              )}
              {form.status === 'draft' && (
                <span
                  data-testid="status-badge-draft"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
                >
                  <span className="h-2 w-2 rounded-full bg-amber-600 dark:bg-amber-400" />
                  {t('status.draft')}
                </span>
              )}
              {form.status === 'archived' && (
                <span
                  data-testid="status-badge-archived"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border"
                >
                  <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                  {t('status.archived')}
                </span>
              )}
            </div>
          </div>
          <p className="text-sm text-muted-foreground break-words">{t('edit.description')}</p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {form.status === 'draft' && (
            <button
              type="button"
              data-testid="publish-form-button"
              disabled={isPublishing}
              onClick={() => {
                void handlePublish();
              }}
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 min-h-[38px] px-4 py-2 shadow-xs transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {isPublishing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{isPublishing ? t('edit.publishingButton') : t('edit.publishButton')}</span>
            </button>
          )}

          {form.status === 'published' && (
            <button
              type="button"
              data-testid="unpublish-form-button"
              disabled={isUnpublishing}
              onClick={() => {
                void handleUnpublish();
              }}
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground min-h-[38px] px-4 py-2 shadow-xs transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {isUnpublishing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              )}
              <span>
                {isUnpublishing ? t('edit.unpublishingButton') : t('edit.unpublishButton')}
              </span>
            </button>
          )}

          {form.status !== 'archived' && (
            <button
              ref={archiveTriggerRef}
              type="button"
              data-testid="archive-form-button"
              onClick={() => {
                setIsArchiveDialogOpen(true);
              }}
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium text-destructive hover:bg-destructive/10 border border-destructive/20 min-h-[38px] px-3.5 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Archive className="h-4 w-4" aria-hidden="true" />
              <span>{t('edit.archiveButton')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline Publish Precondition Error (AC-5) */}
      {publishPreconditionError && (
        <div
          role="alert"
          data-testid="publish-precondition-error"
          className="flex items-start gap-3 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 text-sm text-amber-900 dark:text-amber-200"
        >
          <AlertTriangle
            className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <p className="font-semibold">{publishPreconditionError}</p>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              <a href="#privacy-notice-section" className="underline font-medium">
                {t('privacyNotice.title')}
              </a>
            </p>
          </div>
        </div>
      )}

      {/* Error Summary linked to invalid section/fields (SC 3.3.1, AC-3) */}
      {errorSummary && (
        <div
          ref={errorSummaryRef}
          tabIndex={-1}
          role="alert"
          aria-labelledby="error-summary-title"
          data-testid="error-summary"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive focus:outline-none focus:ring-2 focus:ring-destructive space-y-2"
        >
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
            <h2 id="error-summary-title">{errorSummary.title}</h2>
          </div>
          <ul className="list-disc pl-6 space-y-1">
            {errorSummary.errors.map((err, idx) => (
              <li key={idx}>
                <a href={`#${err.fieldId}`} className="underline hover:opacity-80 font-medium">
                  {err.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Notification banner (role="status") */}
      {notification && (
        <div
          role="status"
          aria-live="polite"
          data-testid="save-notification"
          className="flex items-center gap-3 rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-sm text-emerald-900 dark:text-emerald-200"
        >
          <CheckCircle2
            className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          <p>{notification.message}</p>
        </div>
      )}

      {/* SECTION 1: General Settings */}
      <section
        id="general-section"
        data-testid="general-section"
        aria-labelledby="general-heading"
        className="rounded-lg border bg-card p-6 text-card-foreground shadow-xs space-y-6"
      >
        <div className="border-b pb-4">
          <h2 id="general-heading" className="text-lg font-semibold tracking-tight">
            {t('general.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('general.description')}</p>
        </div>

        <form
          data-testid="general-form"
          onSubmit={(e) => {
            void handleSaveGeneral(e);
          }}
          className="space-y-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor="edit-form-name"
                className="text-sm font-medium leading-none text-foreground"
              >
                {t('general.nameLabel')} <span className="text-destructive">*</span>
              </label>
              <input
                id="edit-form-name"
                data-testid="general-name-input"
                type="text"
                required
                minLength={1}
                maxLength={100}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="edit-default-locale"
                className="text-sm font-medium leading-none text-foreground"
              >
                {t('general.languageLabel')}
              </label>
              <select
                id="edit-default-locale"
                data-testid="general-locale-select"
                value={defaultLocale}
                onChange={(e) => {
                  setDefaultLocale(e.target.value as 'en' | 'de');
                }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="en">{t('new.languageEn')}</option>
                <option value="de">{t('new.languageDe')}</option>
              </select>
            </div>
          </div>

          <div className="space-y-4 pt-2">
            {/* Auto-reply toggle */}
            <div className="flex items-start gap-3">
              <input
                id="auto-reply-toggle"
                data-testid="general-auto-reply-toggle"
                type="checkbox"
                checked={autoReplyEnabled}
                onChange={(e) => {
                  setAutoReplyEnabled(e.target.checked);
                }}
                className="h-4 w-4 mt-0.5 rounded-sm border-input text-primary focus:ring-primary"
                aria-describedby="auto-reply-help"
              />
              <div className="space-y-0.5">
                <label
                  htmlFor="auto-reply-toggle"
                  className="text-sm font-medium text-foreground cursor-pointer"
                >
                  {t('general.autoReplyLabel')}
                </label>
                <p id="auto-reply-help" className="text-xs text-muted-foreground">
                  {t('general.autoReplyHelp')}
                </p>
              </div>
            </div>

            {/* Accept unverified toggle */}
            <div className="flex items-start gap-3">
              <input
                id="accept-unverified-toggle"
                data-testid="general-accept-unverified-toggle"
                type="checkbox"
                checked={acceptUnverified}
                onChange={(e) => {
                  setAcceptUnverified(e.target.checked);
                }}
                className="h-4 w-4 mt-0.5 rounded-sm border-input text-primary focus:ring-primary"
                aria-describedby="accept-unverified-help"
              />
              <div className="space-y-0.5">
                <label
                  htmlFor="accept-unverified-toggle"
                  className="text-sm font-medium text-foreground cursor-pointer"
                >
                  {t('general.acceptUnverifiedLabel')}
                </label>
                <p
                  id="accept-unverified-help"
                  data-testid="accept-unverified-help"
                  className="text-xs text-muted-foreground"
                >
                  {t('general.acceptUnverifiedHelp')}
                </p>
              </div>
            </div>

            {/* Success redirect url */}
            <div className="space-y-2 pt-2">
              <label
                htmlFor="success-redirect-url"
                className="text-sm font-medium leading-none text-foreground"
              >
                {t('general.successRedirectUrlLabel')}
              </label>
              <input
                id="success-redirect-url"
                data-testid="general-redirect-url-input"
                type="url"
                value={successRedirectUrl}
                onChange={(e) => {
                  setSuccessRedirectUrl(e.target.value);
                }}
                placeholder="https://example.com/thank-you"
                aria-describedby="success-redirect-url-help"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <p id="success-redirect-url-help" className="text-xs text-muted-foreground">
                {t('general.successRedirectUrlHelp')}
              </p>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              data-testid="save-general-button"
              disabled={isSavingGeneral}
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 min-h-[38px] px-4 py-2 shadow-xs transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {isSavingGeneral && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              <span>{isSavingGeneral ? t('edit.saving') : t('general.saveButton')}</span>
            </button>
          </div>
        </form>
      </section>

      {/* SECTION 2: Fields Catalogue (AC-2) */}
      <section
        id="fields-section"
        data-testid="fields-section"
        aria-labelledby="fields-heading"
        className="rounded-lg border bg-card p-6 text-card-foreground shadow-xs space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
          <div>
            <h2 id="fields-heading" className="text-lg font-semibold tracking-tight">
              {t('fields.title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('fields.description')}</p>
          </div>
          <div>
            <button
              type="button"
              data-testid="save-fields-button"
              disabled={isSavingFields}
              onClick={() => {
                void handleSaveFields();
              }}
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 min-h-[38px] px-4 py-2 shadow-xs transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {isSavingFields && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              <span>{isSavingFields ? t('edit.saving') : t('fields.saveButton')}</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table data-testid="fields-table" className="w-full text-sm text-left border-collapse">
            <caption className="sr-only">{t('fields.title')}</caption>
            <thead className="bg-muted/50 text-muted-foreground border-b text-xs uppercase font-medium">
              <tr>
                <th scope="col" className="px-4 py-3 sm:px-6">
                  {t('fields.tableHeaderField')}
                </th>
                <th scope="col" className="px-4 py-3 sm:px-6 text-center">
                  {t('fields.tableHeaderEnabled')}
                </th>
                <th scope="col" className="px-4 py-3 sm:px-6 text-center">
                  {t('fields.tableHeaderRequired')}
                </th>
                <th scope="col" className="px-4 py-3 sm:px-6 text-right">
                  {t('fields.tableHeaderOrder')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {fields.map((field, idx) => {
                const isLocked = field.key === 'given_name' || field.key === 'email';

                return (
                  <tr
                    key={field.key}
                    data-testid={`field-row-${field.key}`}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 sm:px-6 font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        {isLocked && (
                          <Lock
                            className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        <span>{getFieldLabel(field.key)}</span>
                      </div>
                    </td>

                    <td className="px-4 py-3 sm:px-6 text-center">
                      {isLocked ? (
                        <span
                          data-testid={`locked-badge-${field.key}`}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground font-medium"
                        >
                          {t('fields.lockedField')}
                        </span>
                      ) : (
                        <div className="flex justify-center items-center">
                          <label htmlFor={`field-enabled-${field.key}`} className="sr-only">
                            {t('fields.tableHeaderEnabled')} {getFieldLabel(field.key)}
                          </label>
                          <input
                            id={`field-enabled-${field.key}`}
                            data-testid={`field-enabled-${field.key}`}
                            type="checkbox"
                            checked={field.enabled}
                            onChange={(e) => {
                              handleToggleFieldEnabled(field.key, e.target.checked);
                            }}
                            className="h-4 w-4 rounded-sm border-input text-primary focus:ring-primary min-h-[24px] min-w-[24px] cursor-pointer"
                          />
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 sm:px-6 text-center">
                      {isLocked ? (
                        <span
                          data-testid={`locked-required-${field.key}`}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground font-medium"
                        >
                          {t('fields.lockedField')}
                        </span>
                      ) : (
                        <div className="flex justify-center items-center">
                          <label htmlFor={`field-required-${field.key}`} className="sr-only">
                            {t('fields.tableHeaderRequired')} {getFieldLabel(field.key)}
                          </label>
                          <input
                            id={`field-required-${field.key}`}
                            data-testid={`field-required-${field.key}`}
                            type="checkbox"
                            disabled={!field.enabled}
                            checked={field.required}
                            onChange={(e) => {
                              handleToggleFieldRequired(field.key, e.target.checked);
                            }}
                            className="h-4 w-4 rounded-sm border-input text-primary focus:ring-primary min-h-[24px] min-w-[24px] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          />
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 sm:px-6 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          data-testid={`field-move-up-${field.key}`}
                          disabled={idx === 0}
                          onClick={() => {
                            handleMoveField(idx, 'up');
                          }}
                          aria-label={`${t('fields.moveUp')}: ${getFieldLabel(field.key)}`}
                          className="inline-flex items-center justify-center rounded-md p-1.5 min-h-[32px] min-w-[32px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-20 disabled:pointer-events-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ArrowUp className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          data-testid={`field-move-down-${field.key}`}
                          disabled={idx === fields.length - 1}
                          onClick={() => {
                            handleMoveField(idx, 'down');
                          }}
                          aria-label={`${t('fields.moveDown')}: ${getFieldLabel(field.key)}`}
                          className="inline-flex items-center justify-center rounded-md p-1.5 min-h-[32px] min-w-[32px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-20 disabled:pointer-events-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ArrowDown className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* SECTION 3: Event Types (AC-3, AC-10, D7) */}
      <section
        id="event-types-section"
        data-testid="event-types-section"
        aria-labelledby="event-types-heading"
        className="rounded-lg border bg-card p-6 text-card-foreground shadow-xs space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
          <div>
            <h2 id="event-types-heading" className="text-lg font-semibold tracking-tight">
              {t('eventTypes.title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('eventTypes.description')}</p>
          </div>
          <div>
            <button
              type="button"
              data-testid="save-event-types-button"
              disabled={isSavingEventTypes}
              onClick={() => {
                void handleSaveEventTypes();
              }}
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 min-h-[38px] px-4 py-2 shadow-xs transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {isSavingEventTypes && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              <span>{isSavingEventTypes ? t('edit.saving') : t('eventTypes.saveButton')}</span>
            </button>
          </div>
        </div>

        {/* AC-10: Sensitive Information Warning Notice (D7) */}
        <div
          role="note"
          data-testid="sensitive-event-types-warning"
          className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 p-4 space-y-1"
        >
          <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200 text-sm">
            <AlertTriangle
              className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <h3>{t('eventTypes.sensitiveWarningTitle')}</h3>
          </div>
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            {t('eventTypes.sensitiveWarningText')}
          </p>
        </div>

        {/* Event types list / table */}
        {eventTypes.length === 0 ? (
          <p
            data-testid="no-event-types-message"
            className="text-sm text-muted-foreground italic py-2"
          >
            {t('eventTypes.noEventTypes')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              data-testid="event-types-table"
              className="w-full text-sm text-left border-collapse"
            >
              <caption className="sr-only">{t('eventTypes.title')}</caption>
              <thead className="bg-muted/50 text-muted-foreground border-b text-xs uppercase font-medium">
                <tr>
                  <th scope="col" className="px-4 py-3 sm:px-6">
                    {t('eventTypes.keyHeader')}
                  </th>
                  <th scope="col" className="px-4 py-3 sm:px-6">
                    {t('eventTypes.labelEnHeader')}
                  </th>
                  <th scope="col" className="px-4 py-3 sm:px-6">
                    {t('eventTypes.labelDeHeader')}
                  </th>
                  <th scope="col" className="px-4 py-3 sm:px-6 text-right">
                    {t('fields.tableHeaderOrder')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {eventTypes.map((et, idx) => (
                  <tr
                    key={et.key}
                    data-testid={`event-type-row-${et.key}`}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 sm:px-6 font-mono text-xs text-muted-foreground">
                      {et.key}
                    </td>
                    <td className="px-4 py-3 sm:px-6 font-medium text-foreground">{et.label_en}</td>
                    <td className="px-4 py-3 sm:px-6 text-foreground">{et.label_de}</td>
                    <td className="px-4 py-3 sm:px-6 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          data-testid={`event-type-move-up-${et.key}`}
                          disabled={idx === 0}
                          onClick={() => {
                            handleMoveEventType(idx, 'up');
                          }}
                          aria-label={`${t('eventTypes.moveUp')}: ${et.label_en}`}
                          className="inline-flex items-center justify-center rounded-md p-1.5 min-h-[32px] min-w-[32px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-20 disabled:pointer-events-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ArrowUp className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          data-testid={`event-type-move-down-${et.key}`}
                          disabled={idx === eventTypes.length - 1}
                          onClick={() => {
                            handleMoveEventType(idx, 'down');
                          }}
                          aria-label={`${t('eventTypes.moveDown')}: ${et.label_en}`}
                          className="inline-flex items-center justify-center rounded-md p-1.5 min-h-[32px] min-w-[32px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-20 disabled:pointer-events-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ArrowDown className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          data-testid={`event-type-remove-${et.key}`}
                          onClick={() => {
                            handleRemoveEventType(et.key);
                          }}
                          aria-label={`${t('eventTypes.removeButton')}: ${et.label_en}`}
                          className="inline-flex items-center justify-center rounded-md p-1.5 min-h-[32px] min-w-[32px] text-destructive hover:bg-destructive/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add Event Type Form */}
        <form
          onSubmit={(e) => {
            handleAddEventType(e);
          }}
          data-testid="add-event-type-form"
          className="rounded-md border p-4 bg-muted/20 space-y-4"
        >
          <h3 className="text-sm font-semibold">{t('eventTypes.addTypeButton')}</h3>

          {eventTypeInputError && <p className="text-xs text-destructive">{eventTypeInputError}</p>}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor="new-et-key" className="text-xs font-medium text-muted-foreground">
                {t('eventTypes.keyLabel')}
              </label>
              <input
                id="new-et-key"
                data-testid="new-event-type-key"
                type="text"
                required
                value={newKey}
                onChange={(e) => {
                  setNewKey(e.target.value);
                }}
                placeholder={t('eventTypes.keyPlaceholder')}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="new-et-label-en"
                className="text-xs font-medium text-muted-foreground"
              >
                {t('eventTypes.labelEnLabel')}
              </label>
              <input
                id="new-et-label-en"
                data-testid="new-event-type-label-en"
                type="text"
                required
                value={newLabelEn}
                onChange={(e) => {
                  setNewLabelEn(e.target.value);
                }}
                placeholder={t('eventTypes.labelEnPlaceholder')}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="new-et-label-de"
                className="text-xs font-medium text-muted-foreground"
              >
                {t('eventTypes.labelDeLabel')}
              </label>
              <input
                id="new-et-label-de"
                data-testid="new-event-type-label-de"
                type="text"
                required
                value={newLabelDe}
                onChange={(e) => {
                  setNewLabelDe(e.target.value);
                }}
                placeholder={t('eventTypes.labelDePlaceholder')}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              data-testid="add-event-type-button"
              className="inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground min-h-[32px] px-3 py-1.5 shadow-2xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('eventTypes.addTypeButton')}</span>
            </button>
          </div>
        </form>
      </section>

      {/* SECTION 4: Privacy Notice & Versioning (AC-4) */}
      <section
        id="privacy-notice-section"
        data-testid="privacy-notice-section"
        aria-labelledby="privacy-heading"
        className="rounded-lg border bg-card p-6 text-card-foreground shadow-xs space-y-6"
      >
        <div className="border-b pb-4">
          <h2 id="privacy-heading" className="text-lg font-semibold tracking-tight">
            {t('privacyNotice.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('privacyNotice.description')}</p>
        </div>

        {/* Current Version Box */}
        {currentNotice && (
          <div
            data-testid="current-notice-version"
            className="rounded-md border bg-muted/30 p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span
                data-testid="current-version-number"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20"
              >
                {t('privacyNotice.currentVersionHeading', { version: currentNotice.version })}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDate(currentNotice.createdAt)}
              </span>
            </div>

            <div className="space-y-1 text-xs">
              <span className="font-semibold text-foreground">
                {t('privacyNotice.policyUrlLabel')}:
              </span>{' '}
              <span
                data-testid="current-policy-url"
                className="font-mono text-muted-foreground break-all"
              >
                {currentNotice.privacyPolicyUrl || '—'}
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 text-xs">
              <div className="space-y-1 rounded-sm border bg-background p-2.5">
                <span className="font-semibold text-foreground block">
                  {t('privacyNotice.ackEnLabel')}
                </span>
                <p data-testid="current-ack-en" className="text-muted-foreground">
                  {currentNotice.acknowledgementTextEn}
                </p>
              </div>

              <div className="space-y-1 rounded-sm border bg-background p-2.5">
                <span className="font-semibold text-foreground block">
                  {t('privacyNotice.ackDeLabel')}
                </span>
                <p data-testid="current-ack-de" className="text-muted-foreground">
                  {currentNotice.acknowledgementTextDe}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Create New Version Form */}
        <form
          data-testid="notice-version-form"
          onSubmit={(e) => {
            void handleSaveNoticeVersion(e);
          }}
          className="space-y-4 pt-2"
        >
          <h3 className="text-sm font-semibold">{t('privacyNotice.saveNewVersionButton')}</h3>

          <div className="space-y-2">
            <label htmlFor="notice-policy-url" className="text-xs font-medium text-foreground">
              {t('privacyNotice.policyUrlLabel')} <span className="text-destructive">*</span>
            </label>
            <input
              id="notice-policy-url"
              data-testid="notice-policy-url-input"
              type="url"
              required
              value={newPolicyUrl}
              onChange={(e) => {
                setNewPolicyUrl(e.target.value);
              }}
              placeholder="https://example.com/privacy"
              aria-describedby="notice-policy-url-help"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p id="notice-policy-url-help" className="text-2xs text-muted-foreground">
              {t('privacyNotice.policyUrlHelp')}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="notice-ack-en" className="text-xs font-medium text-foreground">
                {t('privacyNotice.ackEnLabel')} <span className="text-destructive">*</span>
              </label>
              <textarea
                id="notice-ack-en"
                data-testid="notice-ack-en-input"
                required
                maxLength={500}
                rows={3}
                value={newAckEn}
                onChange={(e) => {
                  setNewAckEn(e.target.value);
                }}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="notice-ack-de" className="text-xs font-medium text-foreground">
                {t('privacyNotice.ackDeLabel')} <span className="text-destructive">*</span>
              </label>
              <textarea
                id="notice-ack-de"
                data-testid="notice-ack-de-input"
                required
                maxLength={500}
                rows={3}
                value={newAckDe}
                onChange={(e) => {
                  setNewAckDe(e.target.value);
                }}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              data-testid="save-notice-version-button"
              disabled={isSavingNotice}
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 min-h-[38px] px-4 py-2 shadow-xs transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {isSavingNotice && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              <span>
                {isSavingNotice
                  ? t('privacyNotice.savingNewVersion')
                  : t('privacyNotice.saveNewVersionButton')}
              </span>
            </button>
          </div>
        </form>

        {/* Versions History Table */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-sm font-semibold">{t('privacyNotice.historyHeading')}</h3>
          </div>

          <div
            data-testid="notice-versions-history"
            className="rounded-md border divide-y bg-card text-card-foreground shadow-2xs"
          >
            {versions.map((ver) => {
              const isCurrent = ver.id === form.currentNoticeVersionId;

              return (
                <div
                  key={ver.id}
                  data-testid={`history-version-row-${String(ver.version)}`}
                  className="p-3 text-xs space-y-1.5 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      data-testid={`history-version-${String(ver.version)}`}
                      className="font-semibold text-foreground inline-flex items-center gap-1.5"
                    >
                      v{String(ver.version)}
                      {isCurrent && (
                        <span className="text-2xs font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                          {t('privacyNotice.currentBadge')}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground">{formatDate(ver.createdAt)}</span>
                  </div>

                  <div className="text-muted-foreground break-all">
                    <span className="font-medium text-foreground">
                      {t('privacyNotice.tableHeaderPolicyUrl')}:{' '}
                    </span>
                    {ver.privacyPolicyUrl || '—'}
                  </div>

                  <div className="space-y-1 text-muted-foreground">
                    <p className="break-words">
                      <span className="font-medium text-foreground">EN: </span>
                      {ver.acknowledgementTextEn}
                    </p>
                    <p className="break-words">
                      <span className="font-medium text-foreground">DE: </span>
                      {ver.acknowledgementTextDe}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Archive Confirmation Dialog (SC 2.1.1, 2.4.3) */}
      <Dialog
        open={isArchiveDialogOpen}
        onOpenChange={(open) => {
          setIsArchiveDialogOpen(open);
          if (!open && archiveTriggerRef.current) {
            archiveTriggerRef.current.focus();
          }
        }}
      >
        <DialogContent data-testid="archive-dialog" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('archiveDialog.title')}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground pt-2">
              {t('archiveDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 pt-4">
            <button
              type="button"
              data-testid="cancel-archive-button"
              onClick={() => {
                setIsArchiveDialogOpen(false);
              }}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground min-h-[38px] px-4 py-2 shadow-2xs transition-colors"
            >
              {t('archiveDialog.cancelButton')}
            </button>
            <button
              type="button"
              data-testid="confirm-archive-button"
              disabled={isArchiving}
              onClick={() => {
                void handleConfirmArchive();
              }}
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 min-h-[38px] px-4 py-2 shadow-xs transition-colors disabled:opacity-50"
            >
              {isArchiving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              <span>{t('archiveDialog.confirmButton')}</span>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
