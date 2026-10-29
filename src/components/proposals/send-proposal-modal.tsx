'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Send, Check, Copy, CheckCircle2 } from 'lucide-react';
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
  type ProposalBuilderState,
  type ProposalBuilderErrors,
  validateSendModal,
  createSendModalController,
} from './proposal-builder-helpers';

export interface SendProposalModalProps {
  state: ProposalBuilderState;
  errors: ProposalBuilderErrors;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onDateChange: (date: string) => void;
  onEmailChange: (email: string) => void;
  onSubmit: () => void | Promise<void>;
  onCopyLink: () => void | Promise<void>;
}

export function SendProposalModal({
  state,
  triggerRef,
  onClose,
  onDateChange,
  onEmailChange,
  onSubmit,
  onCopyLink,
}: SendProposalModalProps) {
  const t = useTranslations('proposals.builder');
  const modalErrors = validateSendModal(state, t).errors;
  const isFormValid = !modalErrors.sendDate && !modalErrors.sendEmail;
  const controller = createSendModalController(onClose, onDateChange, onEmailChange, triggerRef);

  return (
    <Dialog
      open={state.sendModalOpen || Boolean(state.sentResult)}
      onOpenChange={controller.handleOpenChange}
    >
      <DialogContent
        data-testid="send-proposal-modal"
        onCloseAutoFocus={controller.handleCloseAutoFocus}
        className="sm:max-w-md"
      >
        {state.sentResult ? (
          // Success State with Copy Link
          <div className="space-y-4" data-testid="copy-link-notification">
            <DialogHeader>
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
                <DialogTitle className="text-lg font-semibold text-foreground">
                  {t('linkCopied.title')}
                </DialogTitle>
              </div>
              <DialogDescription className="text-sm text-muted-foreground">
                {t('linkCopied.description')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 pt-2">
              <label
                htmlFor="proposal-token-url"
                className="block text-xs font-medium text-foreground"
              >
                {t('linkCopied.urlLabel')}
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="proposal-token-url"
                  data-testid="proposal-token-url"
                  type="text"
                  readOnly
                  value={state.sentResult.tokenUrl}
                  className="flex-1 rounded-md border border-input bg-muted px-3 py-1.5 text-xs text-foreground font-mono select-all"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="copy-link-button"
                  onClick={() => {
                    void onCopyLink();
                  }}
                  className="shrink-0 flex items-center gap-1.5"
                >
                  {state.linkCopied ? (
                    <>
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <span data-testid="link-copied-badge">{t('linkCopied.copied')}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      <span>{t('linkCopied.copyButton')}</span>
                    </>
                  )}
                </Button>
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-border sm:justify-end">
              <Button
                type="button"
                variant="default"
                data-testid="done-send-modal-btn"
                onClick={onClose}
              >
                {t('linkCopied.close')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          // Form State
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold text-foreground">
                {t('sendModal.title')}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {t('sendModal.description')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Recipient Email */}
              <div className="space-y-1.5">
                <label
                  htmlFor="send-recipient-email-input"
                  className="block text-sm font-medium text-foreground"
                >
                  {t('sendModal.recipientEmailLabel')}
                </label>
                <input
                  id="send-recipient-email-input"
                  data-testid="send-recipient-email-input"
                  type="email"
                  placeholder={t('sendModal.recipientEmailPlaceholder')}
                  value={state.sendModalEmail}
                  onChange={controller.handleEmailChange}
                  aria-invalid={Boolean(modalErrors.sendEmail)}
                  aria-describedby={modalErrors.sendEmail ? 'send-email-error' : undefined}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {modalErrors.sendEmail && (
                  <p
                    id="send-email-error"
                    role="alert"
                    data-testid="send-email-error"
                    className="text-xs text-red-600 dark:text-red-400 font-medium"
                  >
                    {modalErrors.sendEmail}
                  </p>
                )}
              </div>

              {/* Validity Expiration Date */}
              <div className="space-y-1.5">
                <label
                  htmlFor="send-valid-until-input"
                  className="block text-sm font-medium text-foreground"
                >
                  {t('sendModal.validUntilLabel')}
                </label>
                <input
                  id="send-valid-until-input"
                  data-testid="send-valid-until-input"
                  type="date"
                  value={state.sendModalDate}
                  onChange={controller.handleDateChange}
                  aria-invalid={Boolean(modalErrors.sendDate)}
                  aria-describedby={modalErrors.sendDate ? 'send-date-error' : 'send-date-help'}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {modalErrors.sendDate ? (
                  <p
                    id="send-date-error"
                    role="alert"
                    data-testid="send-date-error"
                    className="text-xs text-red-600 dark:text-red-400 font-medium"
                  >
                    {modalErrors.sendDate}
                  </p>
                ) : (
                  <p id="send-date-help" className="text-xs text-muted-foreground">
                    {t('sendModal.validUntilHelp')}
                  </p>
                )}
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                data-testid="cancel-send-proposal-btn"
                onClick={onClose}
                disabled={state.isSending}
              >
                {t('sendModal.cancelButton')}
              </Button>
              <Button
                type="button"
                data-testid="submit-send-proposal-btn"
                disabled={!isFormValid || state.isSending}
                onClick={() => {
                  void onSubmit();
                }}
                className="flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                {state.isSending ? t('sendModal.sending') : t('sendModal.submitButton')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
