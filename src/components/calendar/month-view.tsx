'use client';

import React, { useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { UnifiedCalendarEvent } from '@/server/calendar/service';
import { getFirstDayOfWeek, getMonthGrid, type MonthGridCell } from '@/client/calendar/grid-math';
import {
  EVENT_COLOR_TOKENS,
  groupEventsByDate,
  calculateNextGridFocus,
} from './calendar-view-model';

export interface MonthViewProps {
  currentDate: Date;
  selectedDate: string; // 'YYYY-MM-DD'
  events: UnifiedCalendarEvent[];
  locale: string;
  onSelectDate: (dateStr: string) => void;
}

export function MonthView({
  currentDate,
  selectedDate,
  events,
  locale,
  onSelectDate,
}: MonthViewProps) {
  const t = useTranslations('calendar');

  const firstDayOfWeek = React.useMemo(() => getFirstDayOfWeek(locale), [locale]);
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const grid = React.useMemo(() => {
    return getMonthGrid(year, month, firstDayOfWeek);
  }, [year, month, firstDayOfWeek]);

  const eventsByDate = React.useMemo(() => {
    return groupEventsByDate(events);
  }, [events]);

  // Focused cell state for roving tabindex (AC-3)
  const [prevSelectedDate, setPrevSelectedDate] = useState(selectedDate);
  const [focusedCoords, setFocusedCoords] = useState<{ row: number; col: number }>(() => {
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < 7; c++) {
        if (grid[r]?.[c]?.dateString === selectedDate) {
          return { row: r, col: c };
        }
      }
    }
    return { row: 0, col: 0 };
  });

  // Adjust focus coordinates during render when selectedDate prop changes
  if (prevSelectedDate !== selectedDate) {
    setPrevSelectedDate(selectedDate);
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < 7; c++) {
        if (grid[r]?.[c]?.dateString === selectedDate) {
          setFocusedCoords({ row: r, col: c });
          break;
        }
      }
    }
  }

  const cellRefs = useRef<(HTMLDivElement | null)[][]>([[], [], [], [], [], [], []]);

  // Weekday column headers based on firstDayOfWeek and locale
  const weekdayNames = React.useMemo(() => {
    const names = [
      t('weekdays.sun'),
      t('weekdays.mon'),
      t('weekdays.tue'),
      t('weekdays.wed'),
      t('weekdays.thu'),
      t('weekdays.fri'),
      t('weekdays.sat'),
    ];
    const ordered: string[] = [];
    for (let i = 0; i < 7; i++) {
      ordered.push(names[(firstDayOfWeek + i) % 7] ?? '');
    }
    return ordered;
  }, [firstDayOfWeek, t]);

  function handleKeyDown(e: React.KeyboardEvent, row: number, col: number, cell: MonthGridCell) {
    if (
      e.key === 'ArrowRight' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowUp'
    ) {
      e.preventDefault();
      const next = calculateNextGridFocus(row, col, e.key);
      setFocusedCoords(next);
      cellRefs.current[next.row]?.[next.col]?.focus();
      return;
    }

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectDate(cell.dateString);
    }
  }

  return (
    <div
      role="grid"
      aria-label={t('aria.gridLabel')}
      className="w-full select-none border rounded-lg overflow-hidden bg-card text-card-foreground shadow-sm"
      data-testid="calendar-month-grid"
    >
      {/* Weekday Column Header Row */}
      <div
        role="row"
        className="grid grid-cols-7 border-b bg-muted/40 text-muted-foreground text-xs font-semibold text-center py-2.5"
      >
        {weekdayNames.map((dayName, idx) => (
          <div key={idx} role="columnheader" className="truncate px-1">
            {dayName}
          </div>
        ))}
      </div>

      {/* Month Weeks and Day Cells */}
      <div className="divide-y divide-border">
        {grid.map((week, rowIdx) => (
          <div
            key={rowIdx}
            role="row"
            className="grid grid-cols-7 divide-x divide-border min-h-[96px] sm:min-h-[112px]"
          >
            {week.map((cell, colIdx) => {
              const dayEvents = eventsByDate.get(cell.dateString) ?? [];
              const isSelected = cell.dateString === selectedDate;
              const isFocused = focusedCoords.row === rowIdx && focusedCoords.col === colIdx;

              const visibleEvents = dayEvents.slice(0, 3);
              const extraCount = dayEvents.length - visibleEvents.length;

              return (
                <div
                  key={cell.dateString}
                  ref={(el) => {
                    (cellRefs.current[rowIdx] ??= [])[colIdx] = el;
                  }}
                  role="gridcell"
                  tabIndex={isFocused ? 0 : -1}
                  aria-selected={isSelected}
                  aria-label={`${cell.dateString}, ${t('aria.eventsSummary', { count: dayEvents.length })}`}
                  data-testid={`calendar-day-${cell.dateString}`}
                  onClick={() => {
                    setFocusedCoords({ row: rowIdx, col: colIdx });
                    onSelectDate(cell.dateString);
                  }}
                  onKeyDown={(e) => {
                    handleKeyDown(e, rowIdx, colIdx, cell);
                  }}
                  className={cn(
                    'p-1.5 sm:p-2 flex flex-col justify-between cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                    cell.isCurrentMonth
                      ? 'bg-card text-card-foreground hover:bg-muted/30'
                      : 'bg-muted/10 text-muted-foreground/60 hover:bg-muted/20',
                    isSelected && 'ring-2 ring-primary ring-inset bg-primary/5',
                    cell.isToday && 'font-bold',
                  )}
                >
                  {/* Day Number Header */}
                  <div className="flex items-center justify-between text-xs">
                    <span
                      className={cn(
                        'inline-flex items-center justify-center h-6 w-6 rounded-full',
                        cell.isToday
                          ? 'bg-primary text-primary-foreground font-semibold'
                          : isSelected
                            ? 'font-bold text-primary'
                            : 'text-foreground',
                      )}
                    >
                      {cell.day}
                    </span>

                    {dayEvents.length > 0 && (
                      <span className="text-[10px] text-muted-foreground font-mono hidden sm:inline">
                        {dayEvents.length}
                      </span>
                    )}
                  </div>

                  {/* Event Badges (AC-2) */}
                  <div className="mt-1 space-y-1 flex-1">
                    {visibleEvents.map((evt) => {
                      const token = EVENT_COLOR_TOKENS[evt.type];
                      return (
                        <div
                          key={evt.id}
                          data-testid={`event-badge-${evt.type}-${evt.id}`}
                          className={cn(
                            'text-[10px] sm:text-[11px] px-1.5 py-0.5 rounded border font-medium truncate leading-tight shadow-2xs',
                            token.badgeClasses,
                          )}
                          title={`${evt.title} (${evt.type})`}
                        >
                          <span className="truncate">{evt.title}</span>
                        </div>
                      );
                    })}

                    {extraCount > 0 && (
                      <div
                        className="text-[10px] font-medium text-muted-foreground px-1"
                        aria-label={t('events.moreAria', { count: extraCount })}
                      >
                        {t('events.more', { count: extraCount })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
