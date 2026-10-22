'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { AvailabilityOverride } from '@/server/db/schema/calendar';
import { formatDateDisplay } from './availability-helpers';
import {
  getInitialOverrideFormState,
  validateDateOverrideFormState,
  filterAndSortUpcomingOverrides,
  submitDateOverrideCreate,
  submitDateOverrideDelete,
  type OverrideFormState,
} from './availability-view-model';
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
  defaultAddOpen?: boolean;
  defaultDeleteTarget?: AvailabilityOverride | null;
  initialNotification?: {
    type: 'success' | 'error';
    message: string;
  } | null;
}

export function DateOverridesManager({
  initialOverrides,
  locale,
  defaultAddOpen = false,
  defaultDeleteTarget = null,
  initialNotification = null,
}: DateOverridesManagerProps) {
  const t = useTranslations('settings.availability.overrides');

  const [overrides, setOverrides] = React.useState<AvailabilityOverride[]>(initialOverrides);
  const [isAddOpen, setIsAddOpen] = React.useState(defaultAddOpen);
  const [deleteTarget, setDeleteTarget] = React.useState<AvailabilityOverride | null>(
    defaultDeleteTarget,
  );

  // Form state
  const [formValues, setFormValues] = React.useState<OverrideFormState>(
    getInitialOverrideFormState,
  );
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [notification, setNotification] = React.useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(initialNotification);

  const resetForm = () => {
    setFormValues(getInitialOverrideFormState());
    setFormError(null);
  };

  const handleOpenAdd = () => {
    resetForm();
    setIsAddOpen(true);
  };

  const handleCloseAdd = () => {
    setIsAddOpen(false);
  };

  const handleCloseDelete = () => {
    setDeleteTarget(null);
  };

  const handleDismissNotification = () => {
    setNotification(null);
  };

  const handleCreateSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setFormError(null);

    const validation = validateDateOverrideFormState(formValues, {
      dateRequired: t('errorDateRequired'),
      invalidDate: t('errorInvalidDate'),
      invalidRange: t('errorInvalidRange'),
    });

    if (validation) {
      setFormError(validation);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await submitDateOverrideCreate(formValues);
      if (res.success && res.data) {
        const created = res.data;
        setOverrides((prev) =>
          filterAndSortUpcomingOverrides([...prev.filter((o) => o.id !== created.id), created]),
        );
        setIsAddOpen(false);
        resetForm();
        setNotification({
          type: 'success',
          message: t('successCreated'),
        });
      } else {
        setFormError(res.error ?? t('errorSaveFailed'));
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
      const res = await submitDateOverrideDelete(deleteTarget.id);
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
          message: res.error ?? t('errorDeleteFailed'),
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
    <div data-testid="date-overrides-manager" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Button
          type="button"
          data-testid="add-date-override-btn"
          onClick={handleOpenAdd}
          className="flex items-center gap-2 self-start sm:self-auto min-h-[38px]"
        >
          <Plus className="h-4 w-4" />
          <span>{t('addOverride')}</span>
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
            onClick={handleDismissNotification}
            className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/5"
            aria-label={t('dismissNotification')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Overrides Table */}
      {overrides.length === 0 ? (
        <div
          data-testid="date-overrides-empty"
          className="rounded-lg border border-dashed p-8 text-center bg-card/50"
        >
          <Calendar className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
          <p className="text-sm font-medium text-foreground">{t('emptyTitle')}</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{t('emptyDesc')}</p>
        </div>
      ) : (
        <div
          data-testid="date-overrides-table"
          className="rounded-lg border bg-card shadow-xs overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground font-medium border-b text-xs uppercase tracking-wider">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    {t('colDate')}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t('colType')}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t('colHours')}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t('colReason')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    {t('colActions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {overrides.map((item) => (
                  <tr
                    key={item.id}
                    data-testid={`override-row-${item.date}`}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium whitespace-nowrap text-foreground">
                      {formatDateDisplay(item.date, locale)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {item.isUnavailable ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-destructive/10 text-destructive border border-destructive/20">
                          {t('badgeUnavailable')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          {t('badgeCustomHours')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {item.isUnavailable
                        ? '—'
                        : `${item.startTime ?? '09:00'} – ${item.endTime ?? '17:00'}`}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
                      {item.reason ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        data-testid={`delete-override-${item.date}`}
                        onClick={() => {
                          setDeleteTarget(item);
                        }}
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        aria-label={`${t('deleteAria')} ${item.date}`}
                      >
                        <Trash2 className="h-4 w-4" />
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
        <DialogContent
          data-testid="add-override-dialog"
          className="sm:max-w-[480px]"
          aria-describedby="override-dialog-desc"
        >
          <form
            onSubmit={(e) => {
              void handleCreateSubmit(e);
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t('dialogAddTitle')}</DialogTitle>
              <DialogDescription id="override-dialog-desc">{t('dialogAddDesc')}</DialogDescription>
            </DialogHeader>

            {formError && (
              <div
                role="alert"
                data-testid="override-form-error"
                className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-xs font-medium text-destructive flex items-center gap-2"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-4 py-2">
              {/* Date Input */}
              <div className="space-y-1.5">
                <label
                  htmlFor="override-date-input"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {t('fieldDate')}
                </label>
                <input
                  type="date"
                  id="override-date-input"
                  data-testid="override-date-input"
                  required
                  value={formValues.date}
                  onChange={(e) => {
                    setFormValues((prev) => ({ ...prev, date: e.target.value }));
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              {/* Status Radio / Toggles */}
              <div className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('fieldStatus')}
                </span>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      id="override-unavailable-checkbox"
                      data-testid="override-unavailable-checkbox"
                      checked={formValues.isUnavailable}
                      onChange={(e) => {
                        setFormValues((prev) => ({ ...prev, isUnavailable: e.target.checked }));
                      }}
                      className="text-primary focus:ring-primary h-4 w-4 rounded"
                    />
                    <span>{t('typeUnavailable')}</span>
                  </label>
                </div>
              </div>

              {/* Custom Hours inputs if not unavailable */}
              {!formValues.isUnavailable && (
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex-1 space-y-1">
                    <label htmlFor="override-start-time" className="text-xs text-muted-foreground">
                      {t('startTime')}
                    </label>
                    <input
                      type="time"
                      id="override-start-time"
                      data-testid="override-start-time-input"
                      value={formValues.startTime}
                      onChange={(e) => {
                        setFormValues((prev) => ({ ...prev, startTime: e.target.value }));
                      }}
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <span className="text-muted-foreground mt-5" aria-hidden="true">
                    –
                  </span>
                  <div className="flex-1 space-y-1">
                    <label htmlFor="override-end-time" className="text-xs text-muted-foreground">
                      {t('endTime')}
                    </label>
                    <input
                      type="time"
                      id="override-end-time"
                      data-testid="override-end-time-input"
                      value={formValues.endTime}
                      onChange={(e) => {
                        setFormValues((prev) => ({ ...prev, endTime: e.target.value }));
                      }}
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </div>
              )}

              {/* Optional Reason */}
              <div className="space-y-1.5">
                <label
                  htmlFor="override-reason-input"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {t('fieldReason')}
                </label>
                <input
                  type="text"
                  id="override-reason-input"
                  data-testid="override-reason-input"
                  placeholder={t('reasonPlaceholder')}
                  maxLength={100}
                  value={formValues.reason}
                  onChange={(e) => {
                    setFormValues((prev) => ({ ...prev, reason: e.target.value }));
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={handleCloseAdd}
                data-testid="override-cancel-btn"
              >
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting} data-testid="override-save-btn">
                {isSubmitting ? t('saving') : t('create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent
          data-testid="delete-override-dialog"
          className="sm:max-w-[420px]"
          aria-describedby="delete-override-desc"
        >
          <DialogHeader>
            <DialogTitle>{t('dialogDeleteTitle')}</DialogTitle>
            <DialogDescription id="delete-override-desc">
              {t('dialogDeleteDesc', {
                date: deleteTarget ? formatDateDisplay(deleteTarget.date, locale) : '',
              })}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleCloseDelete}
              data-testid="cancel-delete-override-btn"
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isSubmitting}
              onClick={() => {
                void handleDeleteConfirm();
              }}
              data-testid="confirm-delete-override-btn"
            >
              {isSubmitting ? t('deleting') : t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
