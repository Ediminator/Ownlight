'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface IncompleteTaskItem {
  id: string;
  title: string;
}

export interface TaskWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStageName: string;
  targetStageName: string;
  incompleteTasks: IncompleteTaskItem[];
  onConfirm: () => void;
  onCancel: () => void;
  isConfirming?: boolean;
}

export function TaskWarningDialog({
  open,
  onOpenChange,
  currentStageName,
  targetStageName,
  incompleteTasks,
  onConfirm,
  onCancel,
  isConfirming = false,
}: TaskWarningDialogProps) {
  const t = useTranslations('projects.taskWarning');

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        data-testid="task-warning-dialog"
        className="max-w-md gap-6"
        closeAriaLabel={t('cancel')}
      >
        <DialogHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <DialogTitle className="text-lg font-semibold tracking-tight text-foreground">
              {t('title')}
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            {t('warning', {
              count: incompleteTasks.length,
              stage: currentStageName,
              targetStage: targetStageName,
            })}
          </DialogDescription>
        </DialogHeader>

        {incompleteTasks.length > 0 && (
          <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t('taskListHeading')}
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm text-foreground">
              {incompleteTasks.map((task) => (
                <li key={task.id} data-testid={`task-warning-item-${task.id}`}>
                  {task.title}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isConfirming}
            data-testid="task-warning-cancel-btn"
            className="min-h-[44px] sm:min-h-[36px]"
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={onConfirm}
            disabled={isConfirming}
            data-testid="task-warning-confirm-btn"
            className="min-h-[44px] sm:min-h-[36px]"
          >
            {isConfirming ? t('moving') : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
