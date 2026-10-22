'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  X,
  Plus,
  ShieldAlert,
  Camera,
  Calendar as CalendarIcon,
  MapPin,
  Mail,
  Phone,
  ExternalLink,
  Edit2,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { UnifiedCalendarEvent } from '@/server/calendar/service';
import { EVENT_COLOR_TOKENS, getEventsForDate, formatEventTimeRange } from './calendar-view-model';
import { parseIsoDate } from '@/client/calendar/grid-math';

export interface DayInspectorProps {
  selectedDate: string; // 'YYYY-MM-DD'
  events: UnifiedCalendarEvent[];
  isOpen: boolean;
  onClose: () => void;
  onNewAppointment: (dateStr: string) => void;
  onBlockTime: (dateStr: string) => void;
  onEditAppointment: (event: UnifiedCalendarEvent) => void;
  onCancelAppointment: (event: UnifiedCalendarEvent) => void;
  onEditBlockedTime: (event: UnifiedCalendarEvent) => void;
  onDeleteBlockedTime: (event: UnifiedCalendarEvent) => void;
  locale: string;
}

export function DayInspector({
  selectedDate,
  events,
  isOpen,
  onClose,
  onNewAppointment,
  onBlockTime,
  onEditAppointment,
  onCancelAppointment,
  onEditBlockedTime,
  onDeleteBlockedTime,
  locale,
}: DayInspectorProps) {
  const t = useTranslations('calendar');

  const dateEvents = React.useMemo(() => {
    return getEventsForDate(events, selectedDate);
  }, [events, selectedDate]);

  const formattedDate = React.useMemo(() => {
    try {
      const date = parseIsoDate(selectedDate);
      const loc = locale === 'de' ? 'de-DE' : 'en-US';
      return new Intl.DateTimeFormat(loc, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }).format(date);
    } catch {
      return selectedDate;
    }
  }, [selectedDate, locale]);

  if (!isOpen) {
    return null;
  }

  return (
    <aside
      className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l bg-card text-card-foreground flex flex-col shrink-0"
      aria-label={t('inspector.title')}
      data-testid="day-inspector-panel"
    >
      {/* Header */}
      <div className="p-4 border-b flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground tracking-tight">
            {t('inspector.title')}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{formattedDate}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          aria-label={t('inspector.close')}
          data-testid="inspector-close-btn"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Quick Action Buttons */}
      <div className="p-3 border-b bg-muted/30 grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs w-full"
          data-testid="inspector-new-appointment-btn"
          onClick={() => {
            onNewAppointment(selectedDate);
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('inspector.newAppointment')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs w-full"
          data-testid="inspector-block-time-btn"
          onClick={() => {
            onBlockTime(selectedDate);
          }}
        >
          <ShieldAlert className="mr-1 h-3.5 w-3.5" />
          {t('inspector.blockTime')}
        </Button>
      </div>

      {/* Event List */}
      <div className="flex-1 p-3 overflow-y-auto space-y-3">
        {dateEvents.length === 0 ? (
          <div
            className="text-center py-8 px-4 text-xs text-muted-foreground"
            data-testid="inspector-empty-state"
          >
            <CalendarIcon className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
            <p>{t('inspector.empty')}</p>
          </div>
        ) : (
          dateEvents.map((evt) => {
            const token = EVENT_COLOR_TOKENS[evt.type];

            if (evt.type === 'shoot') {
              return (
                <div
                  key={evt.id}
                  data-testid={`inspector-shoot-${evt.id}`}
                  className={cn(
                    'rounded-lg border p-3 text-xs space-y-2 shadow-sm transition-all',
                    token.badgeClasses,
                  )}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span className="flex items-center gap-1.5 truncate">
                      <Camera className="h-3.5 w-3.5 shrink-0" />
                      {evt.title}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] font-medium">
                      {formatEventTimeRange(evt.startsAt, evt.endsAt, evt.allDay)}
                    </span>
                  </div>

                  {evt.projectTitle && (
                    <div className="text-[11px] truncate">
                      <span className="font-medium">Project:</span> {evt.projectTitle}
                    </div>
                  )}

                  {evt.locationName && (
                    <div className="flex items-center gap-1 text-[11px] truncate">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {evt.locationName}
                    </div>
                  )}

                  {evt.projectId && (
                    <div className="pt-1">
                      <Link
                        href={`/${locale}/projects/${evt.projectId}`}
                        data-testid="shoot-project-link"
                        className="inline-flex items-center text-[11px] font-semibold underline underline-offset-2 hover:opacity-80"
                      >
                        {t('inspector.viewProject')}
                        <ExternalLink className="ml-1 h-3 w-3" />
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
                  data-testid={`inspector-appointment-${evt.id}`}
                  className={cn(
                    'rounded-lg border p-3 text-xs space-y-2 shadow-sm transition-all',
                    token.badgeClasses,
                  )}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span className="flex items-center gap-1.5 truncate">
                      <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
                      {evt.title}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] font-medium">
                      {formatEventTimeRange(evt.startsAt, evt.endsAt, evt.allDay)}
                    </span>
                  </div>

                  <div className="space-y-1 text-[11px]">
                    <div className="font-semibold truncate">{evt.attendeeName}</div>
                    {evt.attendeeEmail && (
                      <div className="flex items-center gap-1 truncate font-medium">
                        <Mail className="h-3 w-3 shrink-0" />
                        {evt.attendeeEmail}
                      </div>
                    )}
                    {evt.attendeePhone && (
                      <div className="flex items-center gap-1 truncate font-medium">
                        <Phone className="h-3 w-3 shrink-0" />
                        {evt.attendeePhone}
                      </div>
                    )}
                  </div>

                  {evt.locationType && (
                    <div className="text-[10px] font-medium capitalize">
                      {evt.locationType.replace('_', ' ')}
                      {evt.locationDetails ? ` · ${evt.locationDetails}` : ''}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-amber-300 dark:border-amber-700">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] hover:bg-amber-100 dark:hover:bg-amber-900"
                      data-testid="appointment-edit-btn"
                      onClick={() => {
                        onEditAppointment(evt);
                      }}
                    >
                      <Edit2 className="mr-1 h-2.5 w-2.5" />
                      {t('inspector.editAppointment')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] font-semibold text-red-700 dark:text-red-400 hover:bg-destructive/10"
                      data-testid="appointment-cancel-btn"
                      onClick={() => {
                        onCancelAppointment(evt);
                      }}
                    >
                      <AlertTriangle className="mr-1 h-2.5 w-2.5" />
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
                data-testid={`inspector-blocked-time-${evt.id}`}
                className={cn(
                  'rounded-lg border p-3 text-xs space-y-2 shadow-sm transition-all',
                  token.badgeClasses,
                )}
              >
                <div className="flex items-center justify-between font-semibold">
                  <span className="flex items-center gap-1.5 truncate">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                    {evt.title}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] font-medium">
                    {formatEventTimeRange(evt.startsAt, evt.endsAt, evt.allDay)}
                  </span>
                </div>

                {evt.notes && <p className="text-[11px] font-medium line-clamp-2">{evt.notes}</p>}

                <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-slate-300 dark:border-slate-700">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] hover:bg-slate-200 dark:hover:bg-slate-700"
                    data-testid="blocked-time-edit-btn"
                    onClick={() => {
                      onEditBlockedTime(evt);
                    }}
                  >
                    <Edit2 className="mr-1 h-2.5 w-2.5" />
                    {t('inspector.editBlockedTime')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] font-semibold text-red-700 dark:text-red-400 hover:bg-destructive/10"
                    data-testid="blocked-time-delete-btn"
                    onClick={() => {
                      onDeleteBlockedTime(evt);
                    }}
                  >
                    <Trash2 className="mr-1 h-2.5 w-2.5" />
                    {t('inspector.deleteBlockedTime')}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
