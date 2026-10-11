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

export interface ConfirmDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  errorMessage?: string | null;
  isSubmitting?: boolean;
  triggerRef?: React.RefObject<HTMLElement | null>;
  onConfirm: () => void;
  onCancel?: () => void;
}

export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  description,
  confirmLabel,
  errorMessage,
  isSubmitting = false,
  triggerRef,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useTranslations('clients.form');

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-y-auto sm:rounded-lg"
        data-testid="confirm-dialog"
        onCloseAutoFocus={(e) => {
          if (triggerRef?.current) {
            e.preventDefault();
            triggerRef.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {errorMessage && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm font-medium flex items-center gap-2"
            data-testid="confirm-dialog-error"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
            data-testid="confirm-dialog-cancel-btn"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground shadow-sm hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
            data-testid="confirm-dialog-confirm-btn"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                <span>{t('removing')}</span>
              </>
            ) : (
              <span>{confirmLabel ?? t('remove')}</span>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
