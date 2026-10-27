'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { createArchiveDialogHandlers } from './packages-helpers';
import type { PackageWithIncludedItems } from '@/server/packages/repo';

export interface PackageArchiveDialogProps {
  pkg: PackageWithIncludedItems | null;
  isOpen: boolean;
  isSubmitting: boolean;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onConfirm: (pkg: PackageWithIncludedItems) => void;
}

export function PackageArchiveDialog({
  pkg,
  isOpen,
  isSubmitting,
  triggerRef,
  onClose,
  onConfirm,
}: PackageArchiveDialogProps) {
  const t = useTranslations('settings.packages.archiveDialog');

  if (!pkg) return null;

  const dialogHandlers = createArchiveDialogHandlers(onClose, onConfirm, pkg, triggerRef);

  return (
    <Dialog open={isOpen} onOpenChange={dialogHandlers.onOpenChange}>
      <DialogContent
        data-testid="package-archive-dialog"
        onCloseAutoFocus={dialogHandlers.onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { title: pkg.name })}</DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
            data-testid="cancel-archive-btn"
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={dialogHandlers.handleConfirm}
            disabled={isSubmitting}
            data-testid="confirm-archive-btn"
          >
            {isSubmitting ? t('archiving') : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
