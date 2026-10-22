'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { AvailabilityOverride } from '@/server/db/schema/calendar';
import {
  createDateOverrideAction,
  deleteDateOverrideAction,
} from '@/server/calendar/availability-actions';
import { formatDateDisplay, isTimeRangeValid } from './availability-helpers';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Trash2, Calendar, AlertCircle, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DateOverridesManagerProps {
  initialOverrides: AvailabilityOverride[];
  locale: string;
}

export function DateOverridesManager({ initialOverrides, locale }: DateOverridesManagerProps) {
  const t = useTranslations('settings.availability.overrides');

  const [overrides, setOverrides] = React.useState<AvailabilityOverride[]>(initialOverrides);
  const [isAddOpen, setIsAddOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<AvailabilityOverride | null>(null);

  // Form state
  const [date, setDate] = React.useState('');
  const [isUnavailable, setIsUnavailable] = React.useState(true);
  const [startTime, setStartTime] = React.useState('09:00');
  const [endTime, setEndTime] = React.useState('17:00');
  const [reason, setReason] = React.useState('');

  const [formError, setFormError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [notification, setNotification] = React.useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const resetForm = () => {
    setDate('');
    setIsUnavailable(true);
    setStartTime('09:00');
    setEndTime('17:00');
    setReason('');
    setFormError(null);
  };

  const handleOpenAdd = () => {
    resetForm();
    setIsAddOpen(true);
  };

  const handleCreateSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setFormError(t('errorDateRequired'));
      return;
    }

    if (!isUnavailable && !isTimeRangeValid(startTime, endTime)) {
      setFormError(t('errorInvalidRange'));
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await createDateOverrideAction({
        date,
        isUnavailable,
        startTime: isUnavailable ? undefined : startTime,
        endTime: isUnavailable ? undefined : endTime,
        reason: reason.trim() ? reason.trim() : undefined,
      });

      if (res.success) {
        setOverrides((prev) =>
          [...prev.filter((o) => o.id !== res.data.id), res.data].sort((a, b) =>
            a.date.localeCompare(b.date),
          ),
        );
        setIsAddOpen(false);
        resetForm();
        setNotification({
          type: 'success',
          message: t('successCreated'),
        });
      } else {
        setFormError(res.error || t('errorSaveFailed'));
      }
    } catch {
      setFormError(t('errorSaveFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;

    setIsSubmitting(true);
    try {
      const res = await deleteDateOverrideAction(deleteTarget.id);
      if (res.success) {
        setOverrides((prev) => prev.filter((o) => o.id !== deleteTarget.id));
        setNotification({
          type: 'success',
          message: t('successDeleted'),
        });
        setDeleteTarget(null);
      } else {
        setNotification({
          type: 'error',
          message: res.error || t('errorDeleteFailed'),
        });
      }
    } catch {
      setNotification({
        type: 'error',
        message: t('errorDeleteFailed'),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Button
          type="button"
          onClick={handleOpenAdd}
          data-testid="add-date-override-btn"
          className="inline-flex items-center gap-2 self-start min-h-[38px]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{t('addOverrideBtn')}</span>
        </Button>
      </div>

      {notification && (
        <div
          role="status"
          aria-live="polite"
          data-testid="availability-notification"
          className={cn(
            'rounded-md p-4 flex items-center justify-between text-sm transition-all',
            notification.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800'
              : 'bg-destructive/10 text-destructive border border-destructive/20',
          )}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? (
              <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
            )}
            <span>{notification.message}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setNotification(null);
            }}
            className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/5"
            aria-label={t('dismissNotification')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {overrides.length === 0 ? (
        <div
          data-testid="date-overrides-empty"
          className="rounded-lg border border-dashed p-8 text-center bg-card/50"
        >
          <Calendar
            className="mx-auto h-10 w-10 text-muted-foreground/60 mb-3"
            aria-hidden="true"
          />
          <h3 className="text-base font-medium text-foreground">{t('emptyTitle')}</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            {t('emptyDescription')}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table
              data-testid="date-overrides-table"
              className="w-full text-left text-sm"
              aria-label={t('tableAriaLabel')}
            >
              <thead className="bg-muted/50 border-b text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    {t('thDate')}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t('thStatus')}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t('thHours')}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t('thReason')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    {t('thActions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {overrides.map((item) => (
                  <tr
                    key={item.id}
                    data-testid={`override-row-${item.date}`}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                      {formatDateDisplay(item.date, locale)}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {item.date}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {item.isUnavailable ? (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                          {t('statusUnavailable')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          {t('statusCustomHours')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {item.isUnavailable
                        ? '—'
                        : `${item.startTime ?? '09:00'} – ${item.endTime ?? '17:00'}`}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
                      {item.reason ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDeleteTarget(item);
                        }}
                        data-testid={`delete-override-${item.date}`}
                        aria-label={`${t('deleteBtnAria')} ${item.date}`}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 px-2"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Date Override Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(e) => {
              void handleCreateSubmit(e);
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t('dialogAddTitle')}</DialogTitle>
              <DialogDescription>{t('dialogAddDescription')}</DialogDescription>
            </DialogHeader>

            {formError && (
              <div
                role="alert"
                data-testid="override-form-error"
                className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive flex items-center gap-2"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-4">
              {/* Date Input */}
              <div className="space-y-1.5">
                <label
                  htmlFor="override-date-input"
                  className="text-sm font-medium text-foreground"
                >
                  {t('labelDate')} *
                </label>
                <input
                  type="date"
                  id="override-date-input"
                  data-testid="override-date-input"
                  required
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              {/* Entire day unavailable toggle */}
              <div className="flex items-center gap-3 pt-1">
                <input
                  type="checkbox"
                  id="override-unavailable-checkbox"
                  data-testid="override-unavailable-checkbox"
                  checked={isUnavailable}
                  onChange={(e) => {
                    setIsUnavailable(e.target.checked);
                  }}
                  className="h-4 w-4 rounded border-input text-primary focus:ring-primary focus:ring-offset-background"
                />
                <label
                  htmlFor="override-unavailable-checkbox"
                  className="text-sm font-medium text-foreground cursor-pointer select-none"
                >
                  {t('labelUnavailableAllDay')}
                </label>
              </div>

              {/* Custom Hours fields (visible when not unavailable) */}
              {!isUnavailable && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="override-start-time-input"
                      className="text-sm font-medium text-foreground"
                    >
                      {t('labelStartTime')}
                    </label>
                    <input
                      type="time"
                      id="override-start-time-input"
                      data-testid="override-start-time-input"
                      value={startTime}
                      onChange={(e) => {
                        setStartTime(e.target.value);
                      }}
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="override-end-time-input"
                      className="text-sm font-medium text-foreground"
                    >
                      {t('labelEndTime')}
                    </label>
                    <input
                      type="time"
                      id="override-end-time-input"
                      data-testid="override-end-time-input"
                      value={endTime}
                      onChange={(e) => {
                        setEndTime(e.target.value);
                      }}
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </div>
              )}

              {/* Reason input */}
              <div className="space-y-1.5">
                <label
                  htmlFor="override-reason-input"
                  className="text-sm font-medium text-foreground"
                >
                  {t('labelReason')}
                </label>
                <input
                  type="text"
                  id="override-reason-input"
                  data-testid="override-reason-input"
                  maxLength={150}
                  placeholder={t('reasonPlaceholder')}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsAddOpen(false);
                }}
                data-testid="override-cancel-btn"
              >
                {t('cancelBtn')}
              </Button>
              <Button type="submit" disabled={isSubmitting} data-testid="override-save-btn">
                {isSubmitting ? t('saving') : t('saveBtn')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('dialogDeleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('dialogDeleteDescription', {
                date: deleteTarget ? formatDateDisplay(deleteTarget.date, locale) : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
              }}
              data-testid="cancel-delete-override-btn"
            >
              {t('cancelBtn')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void handleDeleteConfirm();
              }}
              disabled={isSubmitting}
              data-testid="confirm-delete-override-btn"
            >
              {isSubmitting ? t('deleting') : t('confirmDeleteBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
