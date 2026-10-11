'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { recordConsentAction } from '@/server/consents/actions';
import { getTodayDateString } from '@/server/consents/schema';
import type { ConsentPurpose, ConsentStatus, ConsentMethod } from '@/server/db/schema/consents';

export interface ConsentDialogContact {
  id: string;
  name: string;
}

export interface ConsentFormProps {
  clientId: string;
  contacts: ConsentDialogContact[];
  initialContactId?: string;
  studioTimezone: string;
  onClose: () => void;
  onSuccess: (statusMessage: string) => void;
}

export interface ConsentDialogProps {
  clientId: string;
  contacts: ConsentDialogContact[];
  initialContactId?: string;
  studioTimezone: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  onSuccess: (statusMessage: string) => void;
}

export function ConsentForm({
  clientId,
  contacts,
  initialContactId,
  studioTimezone,
  onClose,
  onSuccess,
}: ConsentFormProps) {
  const t = useTranslations('clients.consent');
  const tErrors = useTranslations('clients.errors');

  const todayStr = React.useMemo(() => getTodayDateString(studioTimezone), [studioTimezone]);

  const [contactId, setContactId] = React.useState<string>(() => {
    return initialContactId ?? contacts[0]?.id ?? '';
  });
  const [purpose, setPurpose] = React.useState<ConsentPurpose>('marketing');
  const [status, setStatus] = React.useState<ConsentStatus>('granted');
  const [effectiveOn, setEffectiveOn] = React.useState<string>(todayStr);
  const [method, setMethod] = React.useState<ConsentMethod>('in_person');
  const [scope, setScope] = React.useState<string>('');
  const [evidenceNote, setEvidenceNote] = React.useState<string>('');

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setErrorMessage(null);
    setFieldErrors({});

    const errors: Record<string, string> = {};

    if (!contactId) {
      errors.contactId = tErrors('nameRequired');
    }

    if (!effectiveOn) {
      errors.effectiveOn = tErrors('VALIDATION_FAILED');
    } else if (effectiveOn > todayStr) {
      errors.effectiveOn = t('errors.futureDate');
    }

    if (purpose === 'image_usage' && status === 'granted') {
      const trimmedScope = scope.trim();
      if (trimmedScope.length === 0) {
        errors.scope = t('errors.scopeRequired');
      } else if (trimmedScope.length > 500) {
        errors.scope = tErrors('VALIDATION_FAILED');
      }
    } else if (scope.length > 500) {
      errors.scope = tErrors('VALIDATION_FAILED');
    }

    if (evidenceNote.length > 500) {
      errors.evidenceNote = tErrors('VALIDATION_FAILED');
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setErrorMessage(tErrors('VALIDATION_FAILED'));
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await recordConsentAction({
        clientId,
        contactId,
        purpose,
        status,
        effectiveOn,
        method,
        scope: scope.trim() || null,
        evidenceNote: evidenceNote.trim() || null,
      });

      if (res.success) {
        onClose();
        onSuccess(t('dialog.successAnnounce'));
      } else {
        switch (res.code) {
          case 'CONSENT_NOT_GRANTED':
            setErrorMessage(t('errors.CONSENT_NOT_GRANTED'));
            break;
          case 'VALIDATION_FAILED': {
            setErrorMessage(tErrors('VALIDATION_FAILED'));
            if (res.fields) {
              const mapped: Record<string, string> = {};
              for (const f of res.fields) {
                if (f === 'scope') mapped.scope = t('errors.scopeRequired');
                else if (f === 'effectiveOn') mapped.effectiveOn = t('errors.futureDate');
                else if (f === 'contactId') mapped.contactId = tErrors('nameRequired');
                else if (f === 'purpose') mapped.purpose = tErrors('VALIDATION_FAILED');
                else if (f === 'status') mapped.status = tErrors('VALIDATION_FAILED');
                else if (f === 'method') mapped.method = tErrors('VALIDATION_FAILED');
              }
              setFieldErrors(mapped);
            }
            break;
          }
          case 'UNAUTHORIZED':
            setErrorMessage(tErrors('UNAUTHORIZED'));
            break;
          case 'FORBIDDEN':
            setErrorMessage(tErrors('FORBIDDEN'));
            break;
          case 'NOT_FOUND':
            setErrorMessage(tErrors('NOT_FOUND'));
            break;
          default:
            setErrorMessage(tErrors('GENERIC_ERROR'));
            break;
        }
      }
    } catch {
      setErrorMessage(tErrors('GENERIC_ERROR'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isScopeRequired = purpose === 'image_usage' && status === 'granted';

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      className="space-y-4 pt-2"
      data-testid="consent-form"
    >
      {/* General Error Alert */}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive flex items-start gap-2"
          data-testid="consent-dialog-error"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Contact Selector */}
      {contacts.length > 1 ? (
        <div className="space-y-1">
          <label htmlFor="consent-contact-select" className="text-sm font-medium text-foreground">
            {t('dialog.contactLabel')}
          </label>
          <select
            id="consent-contact-select"
            value={contactId}
            onChange={(e) => {
              setContactId(e.target.value);
            }}
            disabled={isSubmitting}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
            data-testid="consent-contact-select"
          >
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {fieldErrors.contactId && (
            <p className="text-xs text-destructive">{fieldErrors.contactId}</p>
          )}
        </div>
      ) : contacts[0] ? (
        <div className="space-y-1">
          <label htmlFor="consent-contact-display" className="text-sm font-medium text-foreground">
            {t('dialog.contactLabel')}
          </label>
          <input
            id="consent-contact-display"
            type="text"
            readOnly
            disabled
            value={contacts[0].name}
            className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground min-h-[44px]"
          />
        </div>
      ) : null}

      {/* Purpose Radio Group grouped with fieldset / legend (SC 1.3.1 / AC-13) */}
      <fieldset className="space-y-2 border-0 p-0 m-0">
        <legend className="text-sm font-medium text-foreground">{t('dialog.purposeLegend')}</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label
            htmlFor="purpose-marketing"
            className={`flex items-center gap-2.5 rounded-md border p-3 cursor-pointer text-sm min-h-[44px] transition-colors bg-background ${
              purpose === 'marketing'
                ? 'border-primary ring-1 ring-primary text-foreground font-medium'
                : 'border-input hover:bg-muted/50 text-foreground'
            }`}
          >
            <input
              type="radio"
              id="purpose-marketing"
              name="consent-purpose"
              value="marketing"
              checked={purpose === 'marketing'}
              onChange={() => {
                setPurpose('marketing');
              }}
              disabled={isSubmitting}
              className="h-4 w-4 text-primary focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="consent-purpose-marketing"
            />
            <span>{t('purposes.marketing')}</span>
          </label>

          <label
            htmlFor="purpose-image-usage"
            className={`flex items-center gap-2.5 rounded-md border p-3 cursor-pointer text-sm min-h-[44px] transition-colors bg-background ${
              purpose === 'image_usage'
                ? 'border-primary ring-1 ring-primary text-foreground font-medium'
                : 'border-input hover:bg-muted/50 text-foreground'
            }`}
          >
            <input
              type="radio"
              id="purpose-image-usage"
              name="consent-purpose"
              value="image_usage"
              checked={purpose === 'image_usage'}
              onChange={() => {
                setPurpose('image_usage');
              }}
              disabled={isSubmitting}
              className="h-4 w-4 text-primary focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="consent-purpose-image-usage"
            />
            <span>{t('purposes.image_usage')}</span>
          </label>
        </div>
      </fieldset>

      {/* Status Radio Group grouped with fieldset / legend (SC 1.3.1 / AC-13) */}
      <fieldset className="space-y-2 border-0 p-0 m-0">
        <legend className="text-sm font-medium text-foreground">{t('dialog.statusLegend')}</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label
            htmlFor="status-granted"
            className={`flex items-center gap-2.5 rounded-md border p-3 cursor-pointer text-sm min-h-[44px] transition-colors bg-background ${
              status === 'granted'
                ? 'border-emerald-600 ring-1 ring-emerald-600 text-foreground font-medium'
                : 'border-input hover:bg-muted/50 text-foreground'
            }`}
          >
            <input
              type="radio"
              id="status-granted"
              name="consent-status"
              value="granted"
              checked={status === 'granted'}
              onChange={() => {
                setStatus('granted');
              }}
              disabled={isSubmitting}
              className="h-4 w-4 text-emerald-600 focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="consent-status-granted"
            />
            <span>{t('statuses.granted')}</span>
          </label>

          <label
            htmlFor="status-withdrawn"
            className={`flex items-center gap-2.5 rounded-md border p-3 cursor-pointer text-sm min-h-[44px] transition-colors bg-background ${
              status === 'withdrawn'
                ? 'border-amber-600 ring-1 ring-amber-600 text-foreground font-medium'
                : 'border-input hover:bg-muted/50 text-foreground'
            }`}
          >
            <input
              type="radio"
              id="status-withdrawn"
              name="consent-status"
              value="withdrawn"
              checked={status === 'withdrawn'}
              onChange={() => {
                setStatus('withdrawn');
              }}
              disabled={isSubmitting}
              className="h-4 w-4 text-amber-600 focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="consent-status-withdrawn"
            />
            <span>{t('statuses.withdrawn')}</span>
          </label>
        </div>
      </fieldset>

      {/* Effective Date Input */}
      <div className="space-y-1">
        <label htmlFor="consent-effective-on" className="text-sm font-medium text-foreground">
          {t('dialog.dateLabel')} <span className="text-destructive">*</span>
        </label>
        <input
          id="consent-effective-on"
          type="date"
          max={todayStr}
          value={effectiveOn}
          onChange={(e) => {
            setEffectiveOn(e.target.value);
          }}
          disabled={isSubmitting}
          required
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="consent-effective-on-input"
        />
        {fieldErrors.effectiveOn && (
          <p className="text-xs text-destructive" data-testid="consent-date-error">
            {fieldErrors.effectiveOn}
          </p>
        )}
      </div>

      {/* Method Selector */}
      <div className="space-y-1">
        <label htmlFor="consent-method-select" className="text-sm font-medium text-foreground">
          {t('dialog.methodLabel')} <span className="text-destructive">*</span>
        </label>
        <select
          id="consent-method-select"
          value={method}
          onChange={(e) => {
            setMethod(e.target.value as ConsentMethod);
          }}
          disabled={isSubmitting}
          required
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="consent-method-select"
        >
          <option value="in_person">{t('methods.in_person')}</option>
          <option value="paper_form">{t('methods.paper_form')}</option>
          <option value="email">{t('methods.email')}</option>
          <option value="phone">{t('methods.phone')}</option>
          <option value="other">{t('methods.other')}</option>
        </select>
      </div>

      {/* Scope Input */}
      <div className="space-y-1">
        <label
          htmlFor="consent-scope-input"
          className="text-sm font-medium text-foreground flex items-center justify-between"
        >
          <span>
            {t('dialog.scopeLabel')}{' '}
            {isScopeRequired && <span className="text-destructive">*</span>}
          </span>
          <span className="text-xs text-muted-foreground">{scope.length}/500</span>
        </label>
        <input
          id="consent-scope-input"
          type="text"
          maxLength={500}
          placeholder={t('dialog.scopePlaceholder')}
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
          }}
          disabled={isSubmitting}
          required={isScopeRequired}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="consent-scope-input"
        />
        <p className="text-xs text-muted-foreground">{t('dialog.scopeHint')}</p>
        {fieldErrors.scope && (
          <p className="text-xs text-destructive" data-testid="consent-scope-error">
            {fieldErrors.scope}
          </p>
        )}
      </div>

      {/* Evidence Note Input */}
      <div className="space-y-1">
        <label
          htmlFor="consent-evidence-input"
          className="text-sm font-medium text-foreground flex items-center justify-between"
        >
          <span>{t('dialog.evidenceNoteLabel')}</span>
          <span className="text-xs text-muted-foreground">{evidenceNote.length}/500</span>
        </label>
        <input
          id="consent-evidence-input"
          type="text"
          maxLength={500}
          placeholder={t('dialog.evidenceNotePlaceholder')}
          value={evidenceNote}
          onChange={(e) => {
            setEvidenceNote(e.target.value);
          }}
          disabled={isSubmitting}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="consent-evidence-input"
        />
        <p className="text-xs text-muted-foreground">{t('dialog.evidenceNoteHint')}</p>
        {fieldErrors.evidenceNote && (
          <p className="text-xs text-destructive">{fieldErrors.evidenceNote}</p>
        )}
      </div>

      <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] w-full sm:w-auto"
          data-testid="consent-dialog-cancel-btn"
        >
          {t('dialog.cancel')}
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] w-full sm:w-auto"
          data-testid="consent-dialog-submit-btn"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
              <span>{t('dialog.saving')}</span>
            </>
          ) : (
            <span>{t('dialog.save')}</span>
          )}
        </button>
      </DialogFooter>
    </form>
  );
}

export function ConsentDialog({
  clientId,
  contacts,
  initialContactId,
  studioTimezone,
  isOpen,
  onOpenChange,
  triggerRef,
  onSuccess,
}: ConsentDialogProps) {
  const t = useTranslations('clients.consent');

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg w-full max-h-[90vh] overflow-y-auto"
        aria-describedby="consent-dialog-desc"
        data-testid="consent-dialog"
        onCloseAutoFocus={(e) => {
          if (triggerRef?.current) {
            e.preventDefault();
            triggerRef.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-foreground">
            {t('dialog.title')}
          </DialogTitle>
          <DialogDescription id="consent-dialog-desc" className="text-sm text-muted-foreground">
            {t('dialog.description')}
          </DialogDescription>
        </DialogHeader>

        {isOpen && (
          <ConsentForm
            key={initialContactId ?? contacts[0]?.id}
            clientId={clientId}
            contacts={contacts}
            initialContactId={initialContactId}
            studioTimezone={studioTimezone}
            onClose={() => {
              onOpenChange(false);
            }}
            onSuccess={onSuccess}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
