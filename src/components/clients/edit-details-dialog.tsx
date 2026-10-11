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
import { updateClientAction } from '@/server/clients/actions';
import { getClientErrorMessage } from '@/lib/client-errors';
import type { Client, ClientKind, ClientLocale } from '@/server/db/schema/clients';

export interface EditDetailsDialogProps {
  client: Client;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  onSuccess: (updated: {
    kind: ClientKind;
    displayName: string;
    preferredLocale: ClientLocale;
  }) => void;
}

interface EditDetailsFormProps {
  client: Client;
  onClose: () => void;
  onSuccess: (updated: {
    kind: ClientKind;
    displayName: string;
    preferredLocale: ClientLocale;
  }) => void;
}

function EditDetailsForm({ client, onClose, onSuccess }: EditDetailsFormProps) {
  const t = useTranslations('clients.form');
  const tErrors = useTranslations('clients.errors');

  const [kind, setKind] = React.useState<ClientKind>(client.kind);
  const [displayName, setDisplayName] = React.useState(client.displayName);
  const [preferredLocale, setPreferredLocale] = React.useState<ClientLocale>(
    client.preferredLocale,
  );
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [displayNameError, setDisplayNameError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedName = displayName.trim();
    if (trimmedName.length === 0) {
      setDisplayNameError(tErrors('displayNameRequired'));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setDisplayNameError(null);

    try {
      const res = await updateClientAction({
        clientId: client.id,
        kind,
        displayName: trimmedName,
        preferredLocale,
      });

      if (!res.success) {
        setErrorMessage(getClientErrorMessage(res.code, tErrors));
        return;
      }

      onSuccess({ kind, displayName: trimmedName, preferredLocale });
      onClose();
    } catch {
      setErrorMessage(tErrors('GENERIC_ERROR'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      className="space-y-4"
    >
      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm font-medium flex items-center gap-2"
          data-testid="edit-details-error"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Kind Radio Group */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">{t('kindLabel')}</legend>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer min-h-[44px]">
            <input
              type="radio"
              name="edit-kind"
              value="person"
              checked={kind === 'person'}
              onChange={() => {
                setKind('person');
              }}
              className="h-4 w-4 text-primary focus:ring-primary border-input"
              data-testid="edit-kind-person-radio"
            />
            <span>{t('kindPerson')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer min-h-[44px]">
            <input
              type="radio"
              name="edit-kind"
              value="company"
              checked={kind === 'company'}
              onChange={() => {
                setKind('company');
              }}
              className="h-4 w-4 text-primary focus:ring-primary border-input"
              data-testid="edit-kind-company-radio"
            />
            <span>{t('kindCompany')}</span>
          </label>
        </div>
      </fieldset>

      {/* Display Name */}
      <div className="space-y-1.5">
        <label htmlFor="edit-displayName" className="block text-sm font-medium text-foreground">
          {t('displayNameLabel')} <span className="text-destructive">*</span>
        </label>
        <input
          id="edit-displayName"
          name="displayName"
          type="text"
          required
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
          }}
          placeholder={t('displayNamePlaceholder')}
          aria-invalid={Boolean(displayNameError)}
          aria-describedby={displayNameError ? 'edit-displayName-error' : undefined}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="edit-display-name-input"
        />
        {displayNameError && (
          <p
            id="edit-displayName-error"
            className="text-sm text-destructive font-medium"
            data-testid="edit-display-name-error"
          >
            {displayNameError}
          </p>
        )}
      </div>

      {/* Preferred Language */}
      <div className="space-y-1.5">
        <label htmlFor="edit-preferredLocale" className="block text-sm font-medium text-foreground">
          {t('preferredLanguageLabel')}
        </label>
        <select
          id="edit-preferredLocale"
          name="preferredLocale"
          value={preferredLocale}
          onChange={(e) => {
            setPreferredLocale(e.target.value as ClientLocale);
          }}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="edit-preferred-locale-select"
        >
          <option value="en">English</option>
          <option value="de">Deutsch</option>
        </select>
      </div>

      <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="cancel-edit-details-btn"
        >
          {t('cancel')}
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="save-details-btn"
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
  );
}

export function EditDetailsDialog({
  client,
  isOpen,
  onOpenChange,
  triggerRef,
  onSuccess,
}: EditDetailsDialogProps) {
  const t = useTranslations('clients.form');

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto sm:rounded-lg"
        data-testid="edit-details-dialog"
        onCloseAutoFocus={(e) => {
          if (triggerRef?.current) {
            e.preventDefault();
            triggerRef.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('editDetailsTitle')}</DialogTitle>
          <DialogDescription>{t('editDetailsDescription')}</DialogDescription>
        </DialogHeader>

        {isOpen && (
          <EditDetailsForm
            key={`${client.id}-${client.displayName}-${client.preferredLocale}`}
            client={client}
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
