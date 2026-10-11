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
import { setClientTagsAction } from '@/server/clients/actions';
import { parseTagsString, formatTagsString } from '@/lib/tags';
import { getClientErrorMessage } from '@/lib/client-errors';
import type { ClientTagItem } from '@/server/clients/repo';

export interface TagsDialogProps {
  clientId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currentTags: ClientTagItem[];
  triggerRef?: React.RefObject<HTMLElement | null>;
  onSuccess: (newTags: ClientTagItem[]) => void;
}

interface TagsFormProps {
  clientId: string;
  currentTags: ClientTagItem[];
  onClose: () => void;
  onSuccess: (newTags: ClientTagItem[]) => void;
}

export function TagsForm({ clientId, currentTags, onClose, onSuccess }: TagsFormProps) {
  const t = useTranslations('clients.form');
  const tErrors = useTranslations('clients.errors');

  const [tagsInput, setTagsInput] = React.useState(formatTagsString(currentTags));
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const parsed = parseTagsString(tagsInput);

    // Client-side quick check for >20 tags
    const normalizedSet = new Set(parsed.map((t) => t.toLowerCase()));
    if (normalizedSet.size > 20) {
      setErrorMessage(tErrors('LIMIT_EXCEEDED'));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await setClientTagsAction({
        clientId,
        tagNames: parsed,
      });

      if (!res.success) {
        setErrorMessage(getClientErrorMessage(res.code, tErrors));
        return;
      }

      onSuccess(res.data.tags);
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
          data-testid="tags-error"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="edit-tags-input" className="block text-sm font-medium text-foreground">
          {t('tagsLabel')}
        </label>
        <input
          id="edit-tags-input"
          name="tags"
          type="text"
          value={tagsInput}
          onChange={(e) => {
            setTagsInput(e.target.value);
          }}
          placeholder={t('tagsPlaceholder')}
          aria-describedby="edit-tags-hint"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="edit-tags-input"
        />
        <p id="edit-tags-hint" className="text-xs text-muted-foreground">
          {t('tagsHint')}
        </p>
      </div>

      <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="cancel-tags-btn"
        >
          {t('cancel')}
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
          data-testid="save-tags-btn"
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

export function TagsDialog({
  clientId,
  isOpen,
  onOpenChange,
  currentTags,
  triggerRef,
  onSuccess,
}: TagsDialogProps) {
  const t = useTranslations('clients.form');

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto sm:rounded-lg"
        data-testid="tags-dialog"
        onCloseAutoFocus={(e) => {
          if (triggerRef?.current) {
            e.preventDefault();
            triggerRef.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('editTagsTitle')}</DialogTitle>
          <DialogDescription>{t('editTagsDescription')}</DialogDescription>
        </DialogHeader>

        {isOpen && (
          <TagsForm
            key={formatTagsString(currentTags)}
            clientId={clientId}
            currentTags={currentTags}
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
