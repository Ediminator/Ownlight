'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { updateNoteAction } from '@/server/timeline/actions';
import { getClientErrorMessage } from '@/lib/client-errors';

export interface EditNoteDialogProps {
  clientId: string;
  noteId: string;
  initialBody: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  onSuccess: (updatedBody: string) => void;
}

interface EditNoteFormProps {
  clientId: string;
  noteId: string;
  initialBody: string;
  onClose: () => void;
  onSuccess: (updatedBody: string) => void;
}

export function EditNoteForm({
  clientId,
  noteId,
  initialBody,
  onClose,
  onSuccess,
}: EditNoteFormProps) {
  const t = useTranslations('clients.timeline');
  const tErrors = useTranslations('clients.errors');

  const [body, setBody] = React.useState(initialBody);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmed = body.trim();
    if (trimmed.length === 0 || body.length > 5000) {
      setErrorMessage(tErrors('VALIDATION_FAILED'));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await updateNoteAction({
        clientId,
        noteId,
        body,
      });

      if (!res.success) {
        setErrorMessage(getClientErrorMessage(res.code, tErrors));
        return;
      }

      onSuccess(body);
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
      <DialogHeader>
        <DialogTitle>{t('note.edit')}</DialogTitle>
      </DialogHeader>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40 p-3 text-red-900 dark:text-red-200 text-sm font-medium flex items-center gap-2"
          data-testid="edit-note-error"
        >
          <AlertCircle
            className="h-4 w-4 shrink-0 text-red-700 dark:text-red-400"
            aria-hidden="true"
          />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="edit-note-body" className="text-sm font-medium text-foreground block">
          {t('note.bodyLabel')}
        </label>
        <textarea
          id="edit-note-body"
          aria-describedby="edit-note-counter"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
          }}
          maxLength={5000}
          rows={5}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[100px]"
          data-testid="edit-note-textarea"
        />
        <div className="flex justify-end">
          <span id="edit-note-counter" className="text-xs text-muted-foreground" aria-live="polite">
            {t('composer.counter', { count: body.length, max: '5,000' })}
          </span>
        </div>
      </div>

      <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={() => {
            onClose();
          }}
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="edit-note-cancel-btn"
        >
          {t('note.cancel')}
        </button>
        <button
          type="submit"
          disabled={isSubmitting || body.trim().length === 0}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="edit-note-save-btn"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
              <span>{t('note.saving')}</span>
            </>
          ) : (
            <span>{t('note.save')}</span>
          )}
        </button>
      </DialogFooter>
    </form>
  );
}

export function EditNoteDialog({
  clientId,
  noteId,
  initialBody,
  isOpen,
  onOpenChange,
  triggerRef,
  onSuccess,
}: EditNoteDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto sm:rounded-lg"
        data-testid="edit-note-dialog"
        onCloseAutoFocus={(e) => {
          if (triggerRef?.current) {
            e.preventDefault();
            triggerRef.current.focus();
          }
        }}
      >
        {isOpen && (
          <EditNoteForm
            clientId={clientId}
            noteId={noteId}
            initialBody={initialBody}
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
