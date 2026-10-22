'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Camera,
  Calendar as CalendarIcon,
  ShieldAlert,
  MapPin,
  Mail,
  Phone,
  ExternalLink,
  Edit2,
  Trash2,
  AlertTriangle,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { UnifiedCalendarEvent } from '@/server/calendar/service';
import { EVENT_COLOR_TOKENS, getEventsForDate, formatEventTimeRange } from './calendar-view-model';
import { formatIsoDate } from '@/client/calendar/grid-math';

export interface DayViewProps {
  currentDate: Date;
  selectedDate: string; // 'YYYY-MM-DD'
  events: UnifiedCalendarEvent[];
  locale: string;
  onNewAppointment: () => void;
  onBlockTime: () => void;
  onEditAppointment: (event: UnifiedCalendarEvent) => void;
  onCancelAppointment: (event: UnifiedCalendarEvent) => void;
  onEditBlockedTime: (event: UnifiedCalendarEvent) => void;
  onDeleteBlockedTime: (event: UnifiedCalendarEvent) => void;
}

export function DayView({
  currentDate,
  selectedDate,
  events,
  locale,
  onNewAppointment,
  onBlockTime,
  onEditAppointment,
  onCancelAppointment,
  onEditBlockedTime,
  onDeleteBlockedTime,
}: DayViewProps) {
  const t = useTranslations('calendar');

  const activeDateKey = selectedDate || formatIsoDate(currentDate);
  const dayEvents = React.useMemo(() => {
    return getEventsForDate(events, activeDateKey);
  }, [events, activeDateKey]);

  return (
    <div
      className="w-full border rounded-lg overflow-hidden bg-card text-card-foreground shadow-sm p-4 sm:p-6"
      data-testid="calendar-day-view"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{t('inspector.title')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('aria.eventsSummary', { count: dayEvents.length })}
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            data-testid="day-view-block-time-btn"
            onClick={onBlockTime}
          >
            <ShieldAlert className="mr-1 h-3.5 w-3.5" />
            {t('inspector.blockTime')}
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs"
            data-testid="day-view-new-appointment-btn"
            onClick={onNewAppointment}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('inspector.newAppointment')}
          </Button>
        </div>
      </div>

      <div className="pt-6 space-y-4">
        {dayEvents.length === 0 ? (
          <div
            className="text-center py-12 px-4 text-sm text-muted-foreground"
            data-testid="day-view-empty-state"
          >
            <CalendarIcon className="mx-auto h-10 w-10 text-muted-foreground/30 mb-3" />
            <p>{t('inspector.empty')}</p>
          </div>
        ) : (
          dayEvents.map((evt) => {
            const token = EVENT_COLOR_TOKENS[evt.type];

            if (evt.type === 'shoot') {
              return (
                <div
                  key={evt.id}
                  data-testid={`day-shoot-${evt.id}`}
                  className={cn(
                    'rounded-lg border p-4 space-y-2.5 shadow-sm transition-all',
                    token.badgeClasses,
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-semibold text-sm">
                      <Camera className="h-4 w-4" />
                      {evt.title}
                    </span>
                    <span className="font-mono text-xs font-medium opacity-85">
                      {formatEventTimeRange(evt.startsAt, evt.endsAt, evt.allDay)}
                    </span>
                  </div>

                  {evt.projectTitle && (
                    <div className="text-xs opacity-90">
                      <span className="font-medium">Project:</span> {evt.projectTitle}
                    </div>
                  )}

                  {evt.locationName && (
                    <div className="flex items-center gap-1.5 text-xs opacity-85">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      {evt.locationName}
                    </div>
                  )}

                  {evt.projectId && (
                    <div className="pt-2">
                      <Link
                        href={`/${locale}/projects/${evt.projectId}`}
                        data-testid="day-shoot-project-link"
                        className="inline-flex items-center text-xs font-semibold underline underline-offset-2 hover:opacity-80"
                      >
                        {t('inspector.viewProject')}
                        <ExternalLink className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </div>
                  )}
                </div>
              );
            }

            if (evt.type === 'appointment') {
              return (
                <div
                  key={evt.id}
                  data-testid={`day-appointment-${evt.id}`}
                  className={cn(
                    'rounded-lg border p-4 space-y-2.5 shadow-sm transition-all',
                    token.badgeClasses,
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-semibold text-sm">
                      <CalendarIcon className="h-4 w-4" />
                      {evt.title}
                    </span>
                    <span className="font-mono text-xs font-medium opacity-85">
                      {formatEventTimeRange(evt.startsAt, evt.endsAt, evt.allDay)}
                    </span>
                  </div>

                  <div className="space-y-1 text-xs opacity-90">
                    <div className="font-medium">{evt.attendeeName}</div>
                    {evt.attendeeEmail && (
                      <div className="flex items-center gap-1.5 opacity-80">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        {evt.attendeeEmail}
                      </div>
                    )}
                    {evt.attendeePhone && (
                      <div className="flex items-center gap-1.5 opacity-80">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        {evt.attendeePhone}
                      </div>
                    )}
                  </div>

                  {evt.locationType && (
                    <div className="text-xs opacity-75 capitalize">
                      {evt.locationType.replace('_', ' ')}
                      {evt.locationDetails ? ` · ${evt.locationDetails}` : ''}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-amber-300 dark:border-amber-700">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2.5 text-xs hover:bg-amber-100 dark:hover:bg-amber-900"
                      data-testid="day-appointment-edit-btn"
                      onClick={() => {
                        onEditAppointment(evt);
                      }}
                    >
                      <Edit2 className="mr-1 h-3 w-3" />
                      {t('inspector.editAppointment')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2.5 text-xs text-destructive hover:bg-destructive/10"
                      data-testid="day-appointment-cancel-btn"
                      onClick={() => {
                        onCancelAppointment(evt);
                      }}
                    >
                      <AlertTriangle className="mr-1 h-3 w-3" />
                      {t('inspector.cancelAppointment')}
                    </Button>
                  </div>
                </div>
              );
            }

            // Blocked time
            return (
              <div
                key={evt.id}
                data-testid={`day-blocked-time-${evt.id}`}
                className={cn(
                  'rounded-lg border p-4 space-y-2.5 shadow-sm transition-all',
                  token.badgeClasses,
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-semibold text-sm">
                    <ShieldAlert className="h-4 w-4" />
                    {evt.title}
                  </span>
                  <span className="font-mono text-xs font-medium opacity-85">
                    {formatEventTimeRange(evt.startsAt, evt.endsAt, evt.allDay)}
                  </span>
                </div>

                {evt.notes && <p className="text-xs opacity-80">{evt.notes}</p>}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-300 dark:border-slate-700">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2.5 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
                    data-testid="day-blocked-time-edit-btn"
                    onClick={() => {
                      onEditBlockedTime(evt);
                    }}
                  >
                    <Edit2 className="mr-1 h-3 w-3" />
                    {t('inspector.editBlockedTime')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2.5 text-xs text-destructive hover:bg-destructive/10"
                    data-testid="day-blocked-time-delete-btn"
                    onClick={() => {
                      onDeleteBlockedTime(evt);
                    }}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    {t('inspector.deleteBlockedTime')}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
