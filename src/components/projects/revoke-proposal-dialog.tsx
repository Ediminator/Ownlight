'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ProjectDetailProposal } from '@/server/projects/service';
import { createRevokeProposalDialogController } from './proposals-section-helpers';

export interface RevokeProposalDialogProps {
  proposal: ProjectDetailProposal | null;
  isOpen: boolean;
  isRevoking: boolean;
  revokeError: string | null;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

export function RevokeProposalDialog({
  isOpen,
  isRevoking,
  revokeError,
  triggerRef,
  onClose,
  onConfirm,
}: RevokeProposalDialogProps) {
  const t = useTranslations('projects.detail.proposals');
  const controller = createRevokeProposalDialogController(onClose, onConfirm, triggerRef);

  return (
    <Dialog open={isOpen} onOpenChange={controller.handleOpenChange}>
      <DialogContent
        data-testid="revoke-proposal-dialog"
        className="max-w-md"
        onCloseAutoFocus={controller.handleCloseAutoFocus}
      >
        <div className="space-y-4">
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>
              <DialogTitle
                data-testid="revoke-dialog-title"
                className="text-lg font-bold text-foreground"
              >
                {t('revokeDialog.title')}
              </DialogTitle>
            </div>
            <DialogDescription
              data-testid="revoke-dialog-description"
              className="text-sm text-muted-foreground leading-relaxed pt-2"
            >
              {t('revokeDialog.description')}
            </DialogDescription>
          </DialogHeader>

          {revokeError && (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive font-medium"
            >
              {revokeError}
            </div>
          )}

          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              data-testid="revoke-cancel-btn"
              onClick={controller.handleCancelClick}
              disabled={isRevoking}
              className="min-h-[44px] sm:min-h-[36px]"
            >
              {t('revokeDialog.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="revoke-confirm-btn"
              onClick={controller.handleConfirmClick}
              disabled={isRevoking}
              className="min-h-[44px] sm:min-h-[36px]"
            >
              {isRevoking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  {t('revokeDialog.revoking')}
                </>
              ) : (
                t('revokeDialog.confirm')
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
