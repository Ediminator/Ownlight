'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, UserPlus, Loader2 } from 'lucide-react';
import Link from 'next/link';
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
import { convertPriceMajorToMinor } from '@/lib/currency';
import type { PipelineStage } from '@/server/db/schema/projects';

export interface CreateProjectDialogProps {
  clients: { id: string; displayName: string }[];
  stages?: PipelineStage[] | { id: string; name: string; key: string; position: number }[];
  locale?: string;
  defaultOpen?: boolean;
  trigger?: React.ReactNode;
  onSuccess?: (projectId: string) => void;
}

export function CreateProjectDialog({
  clients,
  stages = [],
  locale = 'en',
  defaultOpen = false,
  trigger,
  onSuccess,
}: CreateProjectDialogProps) {
  const t = useTranslations('projects');
  const router = useRouter();

  const [open, setOpen] = React.useState(defaultOpen);
  const [title, setTitle] = React.useState('');
  const [clientId, setClientId] = React.useState(clients[0]?.id ?? '');
  const [projectTypeKey, setProjectTypeKey] = React.useState('wedding');

  // Initial stage defaults to first stage (position 1, Inquiry)
  const sortedStages = React.useMemo(() => {
    return [...stages].sort((a, b) => a.position - b.position);
  }, [stages]);

  const [stageId, setStageId] = React.useState<string>(sortedStages[0]?.id ?? '');
  const [priceMajor, setPriceMajor] = React.useState('');
  const [shootDate, setShootDate] = React.useState('');
  const [shootLocation, setShootLocation] = React.useState('');
  const [notes, setNotes] = React.useState('');

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const resetForm = React.useCallback(() => {
    setTitle('');
    setClientId(clients[0]?.id ?? '');
    setProjectTypeKey('wedding');
    setStageId(sortedStages[0]?.id ?? '');
    setPriceMajor('');
    setShootDate('');
    setShootLocation('');
    setNotes('');
    setErrorMessage(null);
  }, [clients, sortedStages]);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMessage(t('create.errorTitleRequired'));
      return;
    }
    if (trimmedTitle.length > 200) {
      setErrorMessage(
        t('create.errorTitleTooLong') || 'Project title cannot exceed 200 characters',
      );
      return;
    }
    if (!clientId) {
      setErrorMessage(t('create.errorClientRequired'));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const priceMinor = convertPriceMajorToMinor(priceMajor);
    const parsedShootDate = shootDate.trim() ? new Date(shootDate) : undefined;

    try {
      const res = await createProjectAction({
        title: trimmedTitle,
        clientId,
        projectTypeKey,
        stageId: stageId || undefined,
        priceMinor,
        currency: 'EUR',
        shootStartsAt: parsedShootDate,
        shootTimezone: 'Europe/Berlin',
        shootLocation: shootLocation.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      if (res.success) {
        setOpen(false);
        resetForm();
        if (onSuccess) {
          onSuccess(res.data.projectId);
        } else {
          router.push(`/${locale}/projects/${res.data.projectId}`);
        }
      } else {
        setErrorMessage(res.error || t('create.errorGeneric'));
      }
    } catch {
      setErrorMessage(t('create.errorGeneric'));
    } finally {
      setIsSubmitting(false);
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
        {trigger ?? (
          <Button
            type="button"
            data-testid="new-project-btn"
            className="inline-flex items-center gap-2 min-h-[44px] sm:min-h-[36px]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>{t('newProject')}</span>
          </Button>
        )}
      </DialogTrigger>

      <DialogContent
        data-testid="new-project-dialog"
        className="max-w-lg max-h-[90vh] overflow-y-auto"
      >
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
            {/* Project Title */}
            <div>
              <label
                htmlFor="new-project-title"
                className="block text-xs font-semibold text-foreground mb-1"
              >
                {t('create.projectTitle')} <span className="text-destructive">*</span>
              </label>
              <input
                id="new-project-title"
                type="text"
                maxLength={200}
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

            {/* Client Picker with quick action */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="new-project-client"
                  className="block text-xs font-semibold text-foreground"
                >
                  {t('create.client')} <span className="text-destructive">*</span>
                </label>
                <Link
                  href={`/${locale}/clients?create=true`}
                  data-testid="create-client-quick-link"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                >
                  <UserPlus className="h-3 w-3" aria-hidden="true" />
                  <span>{t('create.createNewClient')}</span>
                </Link>
              </div>
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

            {/* Project Type & Initial Stage */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="new-project-type"
                  className="block text-xs font-semibold text-foreground mb-1"
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
                  htmlFor="new-project-stage"
                  className="block text-xs font-semibold text-foreground mb-1"
                >
                  {t('create.stage')}
                </label>
                <select
                  id="new-project-stage"
                  value={stageId}
                  onChange={(e) => {
                    setStageId(e.target.value);
                  }}
                  data-testid="new-project-stage-select"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                >
                  {sortedStages.length === 0 ? (
                    <option value="">{t('stages.inquiry')}</option>
                  ) : (
                    sortedStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            {/* Price & Primary Shoot Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="new-project-price"
                  className="block text-xs font-semibold text-foreground mb-1"
                >
                  {t('create.price')}
                </label>
                <input
                  id="new-project-price"
                  type="text"
                  inputMode="decimal"
                  value={priceMajor}
                  onChange={(e) => {
                    setPriceMajor(e.target.value);
                  }}
                  placeholder={t('create.pricePlaceholder')}
                  data-testid="new-project-price-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>

              <div>
                <label
                  htmlFor="new-project-shoot-date"
                  className="block text-xs font-semibold text-foreground mb-1"
                >
                  {t('create.shootDate')}
                </label>
                <input
                  id="new-project-shoot-date"
                  type="datetime-local"
                  value={shootDate}
                  onChange={(e) => {
                    setShootDate(e.target.value);
                  }}
                  data-testid="new-project-shoot-date-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>
            </div>

            {/* Primary Shoot Location */}
            <div>
              <label
                htmlFor="new-project-shoot-location"
                className="block text-xs font-semibold text-foreground mb-1"
              >
                {t('create.shootLocation')}
              </label>
              <input
                id="new-project-shoot-location"
                type="text"
                maxLength={200}
                value={shootLocation}
                onChange={(e) => {
                  setShootLocation(e.target.value);
                }}
                placeholder={t('create.shootLocationPlaceholder')}
                data-testid="new-project-shoot-location-input"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
              />
            </div>

            {/* Internal Notes */}
            <div>
              <label
                htmlFor="new-project-notes"
                className="block text-xs font-semibold text-foreground mb-1"
              >
                {t('create.notes')}
              </label>
              <textarea
                id="new-project-notes"
                rows={3}
                maxLength={5000}
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                }}
                placeholder={t('create.notesPlaceholder')}
                data-testid="new-project-notes-input"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[80px]"
              />
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
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" aria-hidden="true" />
                  <span>{t('create.submitting')}</span>
                </>
              ) : (
                t('create.submit')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
