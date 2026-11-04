'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  type AcceptanceFormErrors,
  createInitialModalFormState,
  modalFormReducer,
  createAcceptanceModalController,
} from './public-proposal-helpers';

export interface AcceptProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  proposalTitle: string;
  formattedTotal: string;
  isSubmitting: boolean;
  serverError?: string | null;
  defaultName?: string;
  defaultEmail?: string;
  initialErrors?: AcceptanceFormErrors;
  onSubmit: (data: { name: string; email: string }) => Promise<void> | void;
}

export function AcceptProposalModal({
  isOpen,
  onClose,
  triggerRef,
  proposalTitle,
  formattedTotal,
  isSubmitting,
  serverError,
  defaultName = '',
  defaultEmail = '',
  initialErrors,
  onSubmit,
}: AcceptProposalModalProps) {
  const t = useTranslations('proposals.public');

  const [state, dispatch] = React.useReducer(modalFormReducer, {
    ...createInitialModalFormState(defaultName, defaultEmail),
    errors: initialErrors ?? {},
  });

  React.useEffect(() => {
    dispatch({ type: 'SET_DEFAULTS', defaultName, defaultEmail });
  }, [defaultName, defaultEmail]);

  const translateValidation = React.useCallback((k: string) => t(`validation.${k}` as const), [t]);

  const controller = React.useMemo(() => {
    return createAcceptanceModalController({
      state,
      dispatch,
      t: translateValidation,
      triggerRef,
      onClose,
      onSubmit,
    });
  }, [state, dispatch, translateValidation, triggerRef, onClose, onSubmit]);

  return (
    <Dialog open={isOpen} onOpenChange={controller.handleOpenChange}>
      <DialogContent
        data-testid="accept-proposal-dialog"
        onCloseAutoFocus={controller.handleCloseAutoFocus}
        className="sm:max-w-lg"
      >
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            <DialogTitle className="text-lg font-semibold text-foreground">
              {t('modal.title')}
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            {proposalTitle
              ? `${proposalTitle} — ${t('modal.description')}`
              : t('modal.description')}
          </DialogDescription>
        </DialogHeader>

        {serverError && (
          <div
            data-testid="accept-proposal-error"
            role="alert"
            className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{serverError}</span>
          </div>
        )}

        <form
          onSubmit={(e) => {
            void controller.handleSubmit(e);
          }}
          noValidate
          className="space-y-4 pt-2"
        >
          {/* Full Name Field */}
          <div>
            <label htmlFor="accepted-by-name" className="block text-sm font-medium text-foreground">
              {t('modal.fullNameLabel')}{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="accepted-by-name"
              name="acceptedByName"
              type="text"
              autoComplete="name"
              required
              data-testid="accepted-name-input"
              value={state.name}
              onChange={controller.handleNameChange}
              placeholder={t('modal.fullNamePlaceholder')}
              aria-invalid={Boolean(state.errors.name)}
              aria-describedby={state.errors.name ? 'accepted-by-name-error' : undefined}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              disabled={isSubmitting}
            />
            {state.errors.name && (
              <p id="accepted-by-name-error" role="alert" className="mt-1 text-xs text-destructive">
                {state.errors.name}
              </p>
            )}
          </div>

          {/* Email Address Field */}
          <div>
            <label
              htmlFor="accepted-by-email"
              className="block text-sm font-medium text-foreground"
            >
              {t('modal.emailLabel')}{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="accepted-by-email"
              name="acceptedByEmail"
              type="email"
              autoComplete="email"
              required
              data-testid="accepted-email-input"
              value={state.email}
              onChange={controller.handleEmailChange}
              placeholder={t('modal.emailPlaceholder')}
              aria-invalid={Boolean(state.errors.email)}
              aria-describedby={state.errors.email ? 'accepted-by-email-error' : undefined}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              disabled={isSubmitting}
            />
            {state.errors.email && (
              <p
                id="accepted-by-email-error"
                role="alert"
                className="mt-1 text-xs text-destructive"
              >
                {state.errors.email}
              </p>
            )}
          </div>

          {/* Agreement Checkbox */}
          <div className="pt-2">
            <div className="flex items-start gap-3">
              <input
                id="agreement-confirmed"
                name="agreementConfirmed"
                type="checkbox"
                required
                data-testid="agreement-checkbox"
                checked={state.agreement}
                onChange={controller.handleAgreementChange}
                aria-invalid={Boolean(state.errors.agreement)}
                aria-describedby={state.errors.agreement ? 'agreement-error' : undefined}
                className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
                disabled={isSubmitting}
              />
              <label
                htmlFor="agreement-confirmed"
                className="text-xs text-foreground leading-relaxed cursor-pointer"
              >
                {t('modal.agreementCheckbox', { total: formattedTotal })}
              </label>
            </div>
            {state.errors.agreement && (
              <p id="agreement-error" role="alert" className="mt-1 text-xs text-destructive ml-7">
                {state.errors.agreement}
              </p>
            )}
          </div>

          <DialogFooter className="pt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              data-testid="cancel-accept-btn"
              onClick={onClose}
              disabled={isSubmitting}
            >
              {t('modal.cancelButton')}
            </Button>
            <Button
              type="submit"
              data-testid="confirm-accept-btn"
              disabled={isSubmitting}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  {t('accepting')}
                </>
              ) : (
                t('modal.confirmButton')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
