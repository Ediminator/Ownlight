'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { AvailabilitySchedule } from '@/server/db/schema/calendar';
import { WEEKDAY_ORDER, WEEKDAY_KEY_MAP } from './availability-helpers';
import {
  buildInitialScheduleMap,
  toggleWeekdayActive,
  updateWeekdayTime,
  validateWeeklyScheduleRanges,
  submitWeeklyScheduleUpdate,
  type DayScheduleState,
} from './availability-view-model';
import { Button } from '@/components/ui/button';
import { Check, AlertCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WeeklyScheduleEditorProps {
  initialSchedules: AvailabilitySchedule[];
  locale?: string;
  initialNotification?: {
    type: 'success' | 'error';
    message: string;
  } | null;
  initialClientErrors?: Record<number, string>;
}

export function WeeklyScheduleEditor({
  initialSchedules,
  initialNotification = null,
  initialClientErrors = {},
}: WeeklyScheduleEditorProps) {
  const t = useTranslations('settings.availability.schedules');
  const tWeekdays = useTranslations('calendar.weekdays');

  // Initialize schedule map from 0 to 6
  const [schedules, setSchedules] = React.useState<Record<number, DayScheduleState>>(() =>
    buildInitialScheduleMap(initialSchedules),
  );

  const [clientErrors, setClientErrors] =
    React.useState<Record<number, string>>(initialClientErrors);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [notification, setNotification] = React.useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(initialNotification);

  const handleActiveToggleClick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const day = Number(e.currentTarget.dataset.day);
    setSchedules((prev) => {
      const updated = toggleWeekdayActive(prev, day);
      setClientErrors(validateWeeklyScheduleRanges(updated, t('errorInvalidRange')));
      return updated;
    });
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const day = Number(e.currentTarget.dataset.day);
    const field = e.currentTarget.dataset.field as 'startTime' | 'endTime';
    const value = e.target.value;
    setSchedules((prev) => {
      const updated = updateWeekdayTime(prev, day, field, value);
      setClientErrors(validateWeeklyScheduleRanges(updated, t('errorInvalidRange')));
      return updated;
    });
  };

  const handleDismissNotification = () => {
    setNotification(null);
  };

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setNotification(null);

    const validation = validateWeeklyScheduleRanges(schedules, t('errorInvalidRange'));
    setClientErrors(validation);

    if (Object.keys(validation).length > 0) {
      setNotification({
        type: 'error',
        message: t('errorValidationGeneral'),
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await submitWeeklyScheduleUpdate(schedules);
      if (res.success) {
        setNotification({
          type: 'success',
          message: t('successSaved'),
        });
      } else {
        setNotification({
          type: 'error',
          message: res.error ?? t('errorSaveFailed'),
        });
      }
    } catch {
      setNotification({
        type: 'error',
        message: t('errorSaveFailed'),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div data-testid="weekly-schedule-editor" className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
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

      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="space-y-4"
      >
        <div
          className="rounded-lg border bg-card divide-y shadow-xs"
          role="region"
          aria-label={t('scheduleGridAria')}
        >
          {WEEKDAY_ORDER.map((dayOfWeek) => {
            const dayKey = String(dayOfWeek);
            const item = schedules[dayOfWeek] ?? {
              dayOfWeek,
              startTime: '09:00',
              endTime: '17:00',
              isActive: false,
            };
            const weekdayKey = (WEEKDAY_KEY_MAP[dayOfWeek] ?? 'monday') as
              'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
            const weekdayName = tWeekdays(weekdayKey);
            const error = clientErrors[dayOfWeek];

            return (
              <div
                key={dayKey}
                data-testid={`schedule-row-${dayKey}`}
                className={cn(
                  'flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 transition-colors',
                  !item.isActive && 'bg-muted/30 text-muted-foreground',
                )}
              >
                {/* Active Toggle & Day Label */}
                <div className="flex items-center gap-3 min-w-[140px]">
                  <input
                    type="checkbox"
                    id={`schedule-active-toggle-${dayKey}`}
                    data-testid={`schedule-active-toggle-${dayKey}`}
                    data-day={dayOfWeek}
                    checked={item.isActive}
                    onChange={handleActiveToggleClick}
                    aria-label={`${weekdayName} active status`}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-primary focus:ring-offset-background"
                  />
                  <label
                    htmlFor={`schedule-active-toggle-${dayKey}`}
                    className="font-medium text-sm select-none cursor-pointer"
                  >
                    {weekdayName}
                  </label>
                </div>

                {/* Time Selectors or Inactive Label */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 flex-1 justify-end">
                  {item.isActive ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <label htmlFor={`schedule-start-time-${dayKey}`} className="sr-only">
                          {`${weekdayName} ${t('startTimeLabel')}`}
                        </label>
                        <input
                          type="time"
                          id={`schedule-start-time-${dayKey}`}
                          data-testid={`schedule-start-time-${dayKey}`}
                          data-day={dayOfWeek}
                          data-field="startTime"
                          value={item.startTime}
                          onChange={handleTimeChange}
                          aria-invalid={Boolean(error)}
                          aria-describedby={error ? `schedule-error-${dayKey}` : undefined}
                          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </div>

                      <span className="text-muted-foreground select-none" aria-hidden="true">
                        –
                      </span>

                      <div className="flex items-center gap-1.5">
                        <label htmlFor={`schedule-end-time-${dayKey}`} className="sr-only">
                          {`${weekdayName} ${t('endTimeLabel')}`}
                        </label>
                        <input
                          type="time"
                          id={`schedule-end-time-${dayKey}`}
                          data-testid={`schedule-end-time-${dayKey}`}
                          data-day={dayOfWeek}
                          data-field="endTime"
                          value={item.endTime}
                          onChange={handleTimeChange}
                          aria-invalid={Boolean(error)}
                          aria-describedby={error ? `schedule-error-${dayKey}` : undefined}
                          className={cn(
                            'rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            error && 'border-destructive focus-visible:ring-destructive',
                          )}
                        />
                      </div>

                      {error && (
                        <p
                          id={`schedule-error-${dayKey}`}
                          data-testid={`schedule-error-${dayKey}`}
                          role="alert"
                          className="text-xs font-medium text-destructive mt-1 sm:mt-0 sm:ml-2"
                        >
                          {error}
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium py-1">
                      {t('unavailable')}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            data-testid="save-weekly-schedule-btn"
            disabled={isSubmitting || Object.keys(clientErrors).length > 0}
            className="min-h-[38px] px-5"
          >
            {isSubmitting ? t('saving') : t('save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
