'use client';

import React, { useState } from 'react';
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
import {
  createBlockedTimeAction,
  updateBlockedTimeAction,
  deleteBlockedTimeAction,
} from '@/server/calendar/actions';
import type { UnifiedCalendarEvent } from '@/server/calendar/service';

export interface BlockedTimeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit' | 'delete';
  blockedTime?: UnifiedCalendarEvent | null;
  defaultDate?: string; // 'YYYY-MM-DD'
  onSuccess: () => void;
}

export function BlockedTimeModal({
  open,
  onOpenChange,
  mode,
  blockedTime,
  defaultDate,
  onSuccess,
}: BlockedTimeModalProps) {
  const t = useTranslations('calendar.modals.blockedTime');

  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [notes, setNotes] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [prevOpen, setPrevOpen] = useState(open);
  const [prevBlockedTime, setPrevBlockedTime] = useState(blockedTime);
  const [prevMode, setPrevMode] = useState(mode);

  if (open !== prevOpen || blockedTime !== prevBlockedTime || mode !== prevMode) {
    setPrevOpen(open);
    setPrevBlockedTime(blockedTime);
    setPrevMode(mode);
    setErrorMessage(null);

    if (blockedTime && (mode === 'edit' || mode === 'delete')) {
      setTitle(blockedTime.title);
      setStartsAt(
        blockedTime.startsAt ? new Date(blockedTime.startsAt).toISOString().slice(0, 16) : '',
      );
      setEndsAt(blockedTime.endsAt ? new Date(blockedTime.endsAt).toISOString().slice(0, 16) : '');
      setAllDay(blockedTime.allDay);
      setNotes(blockedTime.notes ?? '');
    } else {
      // Create mode
      const baseDate = defaultDate ? new Date(defaultDate) : new Date();
      baseDate.setHours(9, 0, 0, 0);
      const endDefault = new Date(baseDate.getTime() + 8 * 60 * 60 * 1000);

      setTitle('Studio Maintenance');
      setStartsAt(baseDate.toISOString().slice(0, 16));
      setEndsAt(endDefault.toISOString().slice(0, 16));
      setAllDay(false);
      setNotes('');
    }
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (mode === 'delete') {
        if (!blockedTime) return;
        const res = await deleteBlockedTimeAction(blockedTime.id);
        if (!res.success) {
          setErrorMessage(res.error);
          return;
        }
      } else if (mode === 'edit') {
        if (!blockedTime) return;
        const res = await updateBlockedTimeAction(blockedTime.id, {
          title,
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          allDay,
          notes: notes || null,
        });
        if (!res.success) {
          setErrorMessage(res.error);
          return;
        }
      } else {
        // Create mode
        const res = await createBlockedTimeAction({
          title: title || 'Blocked Time',
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          allDay,
          notes: notes || undefined,
        });
        if (!res.success) {
          setErrorMessage(res.error);
          return;
        }
      }

      onSuccess();
      onOpenChange(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="blocked-time-modal">
        <DialogHeader>
          <DialogTitle>
            {mode === 'delete'
              ? t('deleteTitle')
              : mode === 'edit'
                ? t('editTitle')
                : t('createTitle')}
          </DialogTitle>
          {mode === 'delete' && <DialogDescription>{t('deleteDescription')}</DialogDescription>}
        </DialogHeader>

        {errorMessage && (
          <div
            className="rounded-md bg-destructive/15 p-3 text-sm text-destructive font-medium"
            role="alert"
          >
            {errorMessage}
          </div>
        )}

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4"
        >
          {mode === 'delete' ? (
            <p className="text-sm text-muted-foreground">
              {blockedTime?.title} (
              {blockedTime?.startsAt ? new Date(blockedTime.startsAt).toLocaleDateString() : ''})
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <label htmlFor="blocked-time-title" className="text-sm font-medium leading-none">
                  {t('titleLabel')} <span className="text-destructive">*</span>
                </label>
                <input
                  id="blocked-time-title"
                  data-testid="blocked-time-title-input"
                  type="text"
                  required
                  placeholder={t('titlePlaceholder')}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="blocked-time-starts-at"
                    className="text-sm font-medium leading-none"
                  >
                    {t('startsAtLabel')} <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="blocked-time-starts-at"
                    data-testid="blocked-time-starts-at-input"
                    type="datetime-local"
                    required
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={startsAt}
                    onChange={(e) => {
                      setStartsAt(e.target.value);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="blocked-time-ends-at"
                    className="text-sm font-medium leading-none"
                  >
                    {t('endsAtLabel')} <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="blocked-time-ends-at"
                    data-testid="blocked-time-ends-at-input"
                    type="datetime-local"
                    required
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={endsAt}
                    onChange={(e) => {
                      setEndsAt(e.target.value);
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  id="blocked-time-allday"
                  data-testid="blocked-time-allday-input"
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  checked={allDay}
                  onChange={(e) => {
                    setAllDay(e.target.checked);
                  }}
                />
                <label
                  htmlFor="blocked-time-allday"
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  {t('allDayLabel')}
                </label>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="blocked-time-notes" className="text-sm font-medium leading-none">
                  {t('notesLabel')}
                </label>
                <textarea
                  id="blocked-time-notes"
                  data-testid="blocked-time-notes-input"
                  placeholder={t('notesPlaceholder')}
                  className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                  }}
                />
              </div>
            </>
          )}

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              data-testid="blocked-time-modal-close-btn"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={isSubmitting}
            >
              {t('cancel')}
            </Button>
            {mode === 'delete' ? (
              <Button
                type="submit"
                variant="destructive"
                data-testid="blocked-time-confirm-delete-btn"
                disabled={isSubmitting}
              >
                {isSubmitting ? t('deleting') : t('deleteConfirm')}
              </Button>
            ) : (
              <Button type="submit" data-testid="blocked-time-submit-btn" disabled={isSubmitting}>
                {isSubmitting ? t('saving') : t('save')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
