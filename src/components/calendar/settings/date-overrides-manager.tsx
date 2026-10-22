'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { AvailabilityOverride } from '@/server/db/schema/calendar';
import { formatDateDisplay } from './availability-helpers';
import {
  validateDateOverrideFormState,
  submitDateOverrideCreate,
  submitDateOverrideDelete,
  createInitialDateOverridesState,
  dateOverridesReducer,
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
  initialFormError?: string | null;
  initialFormValues?: Partial<OverrideFormState>;
}

export function DateOverridesManager({
  initialOverrides,
  locale,
  defaultAddOpen = false,
  defaultDeleteTarget = null,
  initialNotification = null,
  initialFormError = null,
  initialFormValues,
}: DateOverridesManagerProps) {
  const t = useTranslations('settings.availability.overrides');

  const [state, dispatch] = React.useReducer(dateOverridesReducer, undefined, () =>
    createInitialDateOverridesState(
      initialOverrides,
      defaultAddOpen,
      defaultDeleteTarget,
      initialNotification,
      initialFormError,
      initialFormValues,
    ),
  );

  const { overrides, isAddOpen, deleteTarget, formValues, formError, isSubmitting, notification } =
    state;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    dispatch({
      type: 'UPDATE_FORM_FIELD',
      name,
      value: type === 'checkbox' ? checked : value,
    });
  };

  const handleAction = (e: React.SyntheticEvent) => {
    const target = e.currentTarget as HTMLElement;
    const action = target.dataset.action;

    if (action === 'open-add') {
      dispatch({ type: 'OPEN_ADD' });
    } else if (action === 'close-add') {
      dispatch({ type: 'CLOSE_ADD' });
    } else if (action === 'open-delete') {
      const id = target.dataset.id;
      const item = overrides.find((o) => o.id === id) ?? null;
      dispatch({ type: 'OPEN_DELETE', item });
    } else if (action === 'close-delete') {
      dispatch({ type: 'CLOSE_DELETE' });
    } else if (action === 'dismiss') {
      dispatch({ type: 'SET_NOTIFICATION', notification: null });
    } else if (action === 'confirm-delete') {
      if (!deleteTarget) return;
      dispatch({ type: 'SET_SUBMITTING', isSubmitting: true });
      void (async () => {
        try {
          const res = await submitDateOverrideDelete(deleteTarget.id);
          if (res.success) {
            dispatch({
              type: 'DELETE_SUCCESS',
              id: deleteTarget.id,
              message: t('successDeleted'),
            });
          } else {
            dispatch({
              type: 'SET_NOTIFICATION',
              notification: { type: 'error', message: res.error ?? t('errorDeleteFailed') },
            });
          }
        } catch {
          dispatch({
            type: 'SET_NOTIFICATION',
            notification: { type: 'error', message: t('errorDeleteFailed') },
          });
        } finally {
          dispatch({ type: 'SET_SUBMITTING', isSubmitting: false });
        }
      })();
    } else if (action === 'create-submit') {
      e.preventDefault();
      const validation = validateDateOverrideFormState(formValues, {
        dateRequired: t('errorDateRequired'),
        invalidDate: t('errorInvalidDate'),
        invalidRange: t('errorInvalidRange'),
      });
      if (validation) {
        dispatch({ type: 'SET_FORM_ERROR', error: validation });
        return;
      }
      dispatch({ type: 'SET_SUBMITTING', isSubmitting: true });
      void (async () => {
        try {
          const res = await submitDateOverrideCreate(formValues);
          if (res.success && res.data) {
            dispatch({ type: 'CREATE_SUCCESS', item: res.data, message: t('successCreated') });
          } else {
            dispatch({ type: 'SET_FORM_ERROR', error: res.error ?? t('errorSaveFailed') });
          }
        } catch {
          dispatch({ type: 'SET_FORM_ERROR', error: t('errorSaveFailed') });
        } finally {
          dispatch({ type: 'SET_SUBMITTING', isSubmitting: false });
        }
      })();
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      if (isAddOpen) dispatch({ type: 'CLOSE_ADD' });
      if (deleteTarget) dispatch({ type: 'CLOSE_DELETE' });
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
          data-action="open-add"
          onClick={handleAction}
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
            data-action="dismiss"
            onClick={handleAction}
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
                        data-action="open-delete"
                        data-id={item.id}
                        onClick={handleAction}
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
      <Dialog open={isAddOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          data-testid="add-override-dialog"
          className="sm:max-w-[480px]"
          aria-describedby="override-dialog-desc"
        >
          <form data-action="create-submit" onSubmit={handleAction} className="space-y-4">
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
                  name="date"
                  data-testid="override-date-input"
                  required
                  value={formValues.date}
                  onChange={handleInputChange}
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
                      name="isUnavailable"
                      data-testid="override-unavailable-checkbox"
                      checked={formValues.isUnavailable}
                      onChange={handleInputChange}
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
                      name="startTime"
                      data-testid="override-start-time-input"
                      value={formValues.startTime}
                      onChange={handleInputChange}
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
                      name="endTime"
                      data-testid="override-end-time-input"
                      value={formValues.endTime}
                      onChange={handleInputChange}
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
                  name="reason"
                  data-testid="override-reason-input"
                  placeholder={t('reasonPlaceholder')}
                  maxLength={100}
                  value={formValues.reason}
                  onChange={handleInputChange}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                data-action="close-add"
                onClick={handleAction}
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
      <Dialog open={Boolean(deleteTarget)} onOpenChange={handleOpenChange}>
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
              data-action="close-delete"
              onClick={handleAction}
              data-testid="cancel-delete-override-btn"
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isSubmitting}
              data-action="confirm-delete"
              onClick={handleAction}
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
