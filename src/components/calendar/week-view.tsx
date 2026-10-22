'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { UnifiedCalendarEvent } from '@/server/calendar/service';
import { getFirstDayOfWeek, getWeekDays } from '@/client/calendar/grid-math';
import { EVENT_COLOR_TOKENS, groupEventsByDate, formatEventTimeRange } from './calendar-view-model';

export interface WeekViewProps {
  currentDate: Date;
  selectedDate: string; // 'YYYY-MM-DD'
  events: UnifiedCalendarEvent[];
  locale: string;
  onSelectDate: (dateStr: string) => void;
}

export function WeekView({
  currentDate,
  selectedDate,
  events,
  locale,
  onSelectDate,
}: WeekViewProps) {
  const firstDayOfWeek = React.useMemo(() => getFirstDayOfWeek(locale), [locale]);
  const weekDays = React.useMemo(() => {
    return getWeekDays(currentDate, firstDayOfWeek);
  }, [currentDate, firstDayOfWeek]);

  const eventsByDate = React.useMemo(() => {
    return groupEventsByDate(events);
  }, [events]);

  return (
    <div
      className="w-full border rounded-lg overflow-hidden bg-card text-card-foreground shadow-sm"
      data-testid="calendar-week-grid"
    >
      <div className="grid grid-cols-7 divide-x divide-border border-b bg-muted/40 text-center py-2.5">
        {weekDays.map((cell) => {
          const isSelected = cell.dateString === selectedDate;
          const loc = locale === 'de' ? 'de-DE' : 'en-US';
          const weekdayStr = new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(cell.date);

          return (
            <button
              type="button"
              key={cell.dateString}
              onClick={() => {
                onSelectDate(cell.dateString);
              }}
              className={cn(
                'px-1 cursor-pointer transition-colors w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                isSelected && 'font-bold text-primary',
              )}
            >
              <div className="text-xs text-muted-foreground font-medium">{weekdayStr}</div>
              <div
                className={cn(
                  'inline-flex items-center justify-center h-6 w-6 mt-0.5 rounded-full text-xs font-semibold',
                  cell.isToday
                    ? 'bg-primary text-primary-foreground'
                    : isSelected
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground',
                )}
              >
                {cell.day}
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-7 divide-x divide-border min-h-[350px]">
        {weekDays.map((cell) => {
          const dayEvents = eventsByDate.get(cell.dateString) ?? [];
          const isSelected = cell.dateString === selectedDate;

          return (
            <button
              type="button"
              key={cell.dateString}
              data-testid={`week-day-column-${cell.dateString}`}
              onClick={() => {
                onSelectDate(cell.dateString);
              }}
              className={cn(
                'p-1.5 sm:p-2 space-y-1.5 cursor-pointer hover:bg-muted/20 transition-colors text-left flex flex-col justify-start w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                isSelected && 'bg-primary/5',
              )}
            >
              {dayEvents.map((evt) => {
                const token = EVENT_COLOR_TOKENS[evt.type];
                return (
                  <div
                    key={evt.id}
                    data-testid={`week-event-card-${evt.id}`}
                    className={cn(
                      'p-1.5 rounded border text-xs shadow-2xs space-y-0.5 transition-all',
                      token.badgeClasses,
                    )}
                  >
                    <div className="font-semibold truncate">{evt.title}</div>
                    <div className="text-[10px] font-mono opacity-80">
                      {formatEventTimeRange(evt.startsAt, evt.endsAt, evt.allDay)}
                    </div>
                  </div>
                );
              })}
            </button>
          );
        })}
      </div>
    </div>
  );
}
