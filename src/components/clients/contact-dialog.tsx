'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, AlertCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { addContactAction, updateContactAction } from '@/server/clients/actions';
import { getClientErrorMessage } from '@/lib/client-errors';
import type { ClientContact } from '@/server/db/schema/clients';
import type { DuplicateEmailMatch } from '@/server/clients/repo';

export interface ContactDialogProps {
  clientId: string;
  locale: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  contactToEdit?: ClientContact | null;
  triggerRef?: React.RefObject<HTMLElement | null>;
  onSuccess: () => void;
}

interface ContactFormProps {
  clientId: string;
  locale: string;
  contactToEdit?: ClientContact | null;
  onClose: () => void;
  onSuccess: () => void;
}

function ContactForm({ clientId, locale, contactToEdit, onClose, onSuccess }: ContactFormProps) {
  const isEditing = Boolean(contactToEdit);
  const t = useTranslations('clients.form');
  const tErrors = useTranslations('clients.errors');

  const [givenName, setGivenName] = React.useState(contactToEdit?.givenName ?? '');
  const [familyName, setFamilyName] = React.useState(contactToEdit?.familyName ?? '');
  const [email, setEmail] = React.useState(contactToEdit?.email ?? '');
  const [phone, setPhone] = React.useState(contactToEdit?.phone ?? '');
  const [isPrimary, setIsPrimary] = React.useState(contactToEdit?.isPrimary ?? false);

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [duplicateMatches, setDuplicateMatches] = React.useState<DuplicateEmailMatch[] | null>(
    null,
  );

  const handleSubmit = async (e?: React.SyntheticEvent, acknowledgeDuplicates = false) => {
    if (e) e.preventDefault();
    if (isSubmitting) return;

    const trimmedGiven = givenName.trim();
    const trimmedFamily = familyName.trim();
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();

    const errors: Record<string, string> = {};
    if (trimmedGiven.length === 0 && trimmedFamily.length === 0) {
      errors.name = tErrors('nameRequired');
    }

    if (trimmedEmail.length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        errors.email = tErrors('emailInvalid');
      }
    }

    if (trimmedPhone.length > 0) {
      const phoneRegex = /^\+?[0-9][0-9 ()/.-]{2,31}$/;
      if (!phoneRegex.test(trimmedPhone)) {
        errors.phone = tErrors('phoneInvalid');
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setFieldErrors({});

    try {
      if (isEditing && contactToEdit) {
        const res = await updateContactAction({
          clientId,
          contactId: contactToEdit.id,
          givenName: trimmedGiven.length > 0 ? trimmedGiven : null,
          familyName: trimmedFamily.length > 0 ? trimmedFamily : null,
          email: trimmedEmail.length > 0 ? trimmedEmail : null,
          phone: trimmedPhone.length > 0 ? trimmedPhone : null,
          isPrimary,
          acknowledgeDuplicates,
        });

        if (!res.success) {
          if (res.code === 'DUPLICATE_EMAIL') {
            setDuplicateMatches(res.duplicates ?? res.data?.duplicates ?? []);
            return;
          }
          setErrorMessage(getClientErrorMessage(res.code, tErrors));
          return;
        }
      } else {
        const res = await addContactAction({
          clientId,
          givenName: trimmedGiven.length > 0 ? trimmedGiven : null,
          familyName: trimmedFamily.length > 0 ? trimmedFamily : null,
          email: trimmedEmail.length > 0 ? trimmedEmail : null,
          phone: trimmedPhone.length > 0 ? trimmedPhone : null,
          isPrimary,
          acknowledgeDuplicates,
        });

        if (!res.success) {
          if (res.code === 'DUPLICATE_EMAIL') {
            setDuplicateMatches(res.duplicates ?? res.data?.duplicates ?? []);
            return;
          }
          setErrorMessage(getClientErrorMessage(res.code, tErrors));
          return;
        }
      }

      onSuccess();
      onClose();
    } catch {
      setErrorMessage(tErrors('GENERIC_ERROR'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm font-medium flex items-center gap-2"
          data-testid="contact-error"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Duplicate Email Warning inside Dialog (AC-3, AC-5) */}
      {duplicateMatches && duplicateMatches.length > 0 && (
        <div
          role="region"
          aria-labelledby="contact-duplicate-title"
          className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-amber-950 dark:text-amber-200 space-y-2 text-sm"
          data-testid="contact-duplicate-warning"
        >
          <div className="flex items-center gap-2 font-semibold" id="contact-duplicate-title">
            <AlertTriangle
              className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0"
              aria-hidden="true"
            />
            <span>{t('duplicateWarningTitle')}</span>
          </div>
          <p>{t('duplicateWarningDescription')}</p>
          <ul className="list-disc list-inside space-y-1 font-medium">
            {duplicateMatches.map((m) => (
              <li key={m.clientId}>
                <a
                  href={`/${locale}/clients/${m.clientId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-amber-800 dark:hover:text-amber-100 inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  <span>{m.displayName}</span>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  <span className="text-xs text-muted-foreground ml-1">{t('opensInNewTab')}</span>
                </a>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                void handleSubmit(undefined, true);
              }}
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[36px]"
              data-testid="contact-create-anyway-btn"
            >
              {t('createAnyway')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDuplicateMatches(null);
              }}
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[36px]"
              data-testid="contact-cancel-duplicate-btn"
            >
              {t('cancelDuplicate')}
            </button>
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          void handleSubmit(e, false);
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Given Name */}
          <div className="space-y-1.5">
            <label
              htmlFor="contact-givenName"
              className="block text-sm font-medium text-foreground"
            >
              {t('givenNameLabel')}
            </label>
            <input
              id="contact-givenName"
              name="givenName"
              type="text"
              autoComplete="off"
              value={givenName}
              onChange={(e) => {
                setGivenName(e.target.value);
              }}
              placeholder={t('givenNamePlaceholder')}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? 'contact-name-error' : undefined}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
              data-testid="contact-given-name-input"
            />
          </div>

          {/* Family Name */}
          <div className="space-y-1.5">
            <label
              htmlFor="contact-familyName"
              className="block text-sm font-medium text-foreground"
            >
              {t('familyNameLabel')}
            </label>
            <input
              id="contact-familyName"
              name="familyName"
              type="text"
              autoComplete="off"
              value={familyName}
              onChange={(e) => {
                setFamilyName(e.target.value);
              }}
              placeholder={t('familyNamePlaceholder')}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? 'contact-name-error' : undefined}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
              data-testid="contact-family-name-input"
            />
          </div>
        </div>

        {fieldErrors.name && (
          <p
            id="contact-name-error"
            className="text-sm text-destructive font-medium"
            data-testid="contact-name-error"
          >
            {fieldErrors.name}
          </p>
        )}

        {/* Email */}
        <div className="space-y-1.5">
          <label htmlFor="contact-email" className="block text-sm font-medium text-foreground">
            {t('emailLabel')}
          </label>
          <input
            id="contact-email"
            name="email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            placeholder={t('emailPlaceholder')}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? 'contact-email-error' : undefined}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
            data-testid="contact-email-input"
          />
          {fieldErrors.email && (
            <p
              id="contact-email-error"
              className="text-sm text-destructive font-medium"
              data-testid="contact-email-error"
            >
              {fieldErrors.email}
            </p>
          )}
        </div>

        {/* Phone */}
        <div className="space-y-1.5">
          <label htmlFor="contact-phone" className="block text-sm font-medium text-foreground">
            {t('phoneLabel')}
          </label>
          <input
            id="contact-phone"
            name="phone"
            type="tel"
            autoComplete="off"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
            }}
            placeholder={t('phonePlaceholder')}
            aria-invalid={Boolean(fieldErrors.phone)}
            aria-describedby={fieldErrors.phone ? 'contact-phone-error' : undefined}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
            data-testid="contact-phone-input"
          />
          {fieldErrors.phone && (
            <p
              id="contact-phone-error"
              className="text-sm text-destructive font-medium"
              data-testid="contact-phone-error"
            >
              {fieldErrors.phone}
            </p>
          )}
        </div>

        {/* Make Primary Checkbox */}
        <div className="pt-1">
          <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer min-h-[44px]">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => {
                setIsPrimary(e.target.checked);
              }}
              className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
              data-testid="contact-is-primary-checkbox"
            />
            <span>{t('isPrimaryLabel')}</span>
          </label>
        </div>

        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
            data-testid="cancel-contact-btn"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
            data-testid="save-contact-btn"
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
    </div>
  );
}

export function ContactDialog({
  clientId,
  locale,
  isOpen,
  onOpenChange,
  contactToEdit,
  triggerRef,
  onSuccess,
}: ContactDialogProps) {
  const isEditing = Boolean(contactToEdit);
  const t = useTranslations('clients.form');

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto sm:rounded-lg"
        data-testid="contact-dialog"
        onCloseAutoFocus={(e) => {
          if (triggerRef?.current) {
            e.preventDefault();
            triggerRef.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{isEditing ? t('editContactTitle') : t('addContactTitle')}</DialogTitle>
          <DialogDescription>
            {isEditing ? t('editContactDescription') : t('addContactDescription')}
          </DialogDescription>
        </DialogHeader>

        {isOpen && (
          <ContactForm
            key={contactToEdit?.id ?? 'new'}
            clientId={clientId}
            locale={locale}
            contactToEdit={contactToEdit}
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
