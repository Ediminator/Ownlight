'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { createProjectAction } from '@/server/projects/actions';

export interface NewProjectDialogProps {
  clients: { id: string; displayName: string }[];
  defaultOpen?: boolean;
}

export function NewProjectDialog({ clients, defaultOpen = false }: NewProjectDialogProps) {
  const t = useTranslations('projects');
  const router = useRouter();

  const [open, setOpen] = React.useState(defaultOpen);
  const [title, setTitle] = React.useState('');
  const [clientId, setClientId] = React.useState(clients[0]?.id ?? '');
  const [projectTypeKey, setProjectTypeKey] = React.useState('wedding');
  const [priceEuro, setPriceEuro] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const resetForm = React.useCallback(() => {
    setTitle('');
    setClientId(clients[0]?.id ?? '');
    setProjectTypeKey('wedding');
    setPriceEuro('');
    setErrorMessage(null);
  }, [clients]);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMessage(t('create.errorTitleRequired'));
      return;
    }
    if (!clientId) {
      setErrorMessage(t('create.errorClientRequired'));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const priceMinor = priceEuro.trim()
      ? Math.round(parseFloat(priceEuro.replace(',', '.')) * 100)
      : undefined;

    const res = await createProjectAction({
      title: title.trim(),
      clientId,
      projectTypeKey,
      priceMinor: Number.isNaN(priceMinor) ? undefined : priceMinor,
      currency: 'EUR',
    });

    setIsSubmitting(false);

    if (res.success) {
      setOpen(false);
      router.refresh();
    } else {
      setErrorMessage(res.error || 'Failed to create project');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          resetForm();
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          data-testid="new-project-btn"
          className="inline-flex items-center gap-2 min-h-[44px] sm:min-h-[36px]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{t('newProject')}</span>
        </Button>
      </DialogTrigger>

      <DialogContent data-testid="new-project-dialog" className="max-w-md">
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{t('create.title')}</DialogTitle>
            <DialogDescription>{t('create.description')}</DialogDescription>
          </DialogHeader>

          {errorMessage && (
            <div
              role="alert"
              className="rounded-md bg-destructive/15 p-3 text-sm text-destructive"
              data-testid="new-project-error"
            >
              {errorMessage}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label
                htmlFor="new-project-title"
                className="block text-xs font-medium text-foreground mb-1"
              >
                {t('create.projectTitle')}
              </label>
              <input
                id="new-project-title"
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
                placeholder={t('create.projectTitlePlaceholder')}
                required
                data-testid="new-project-title-input"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
              />
            </div>

            <div>
              <label
                htmlFor="new-project-client"
                className="block text-xs font-medium text-foreground mb-1"
              >
                {t('create.client')}
              </label>
              <select
                id="new-project-client"
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                }}
                required
                data-testid="new-project-client-select"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
              >
                {clients.length === 0 ? (
                  <option value="">{t('create.selectClient')}</option>
                ) : (
                  clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="new-project-type"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('create.projectType')}
                </label>
                <select
                  id="new-project-type"
                  value={projectTypeKey}
                  onChange={(e) => {
                    setProjectTypeKey(e.target.value);
                  }}
                  data-testid="new-project-type-select"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                >
                  <option value="wedding">{t('types.wedding')}</option>
                  <option value="portrait">{t('types.portrait')}</option>
                  <option value="commercial">{t('types.commercial')}</option>
                  <option value="event">{t('types.event')}</option>
                  <option value="video">{t('types.video')}</option>
                  <option value="general">{t('types.general')}</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="new-project-price"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('create.price')}
                </label>
                <input
                  id="new-project-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={priceEuro}
                  onChange={(e) => {
                    setPriceEuro(e.target.value);
                  }}
                  placeholder={t('create.pricePlaceholder')}
                  data-testid="new-project-price-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              data-testid="new-project-cancel-btn"
              onClick={() => {
                setOpen(false);
              }}
              disabled={isSubmitting}
              className="min-h-[44px] sm:min-h-[36px]"
            >
              {t('create.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              data-testid="new-project-submit-btn"
              className="min-h-[44px] sm:min-h-[36px]"
            >
              {isSubmitting ? t('create.submitting') : t('create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
