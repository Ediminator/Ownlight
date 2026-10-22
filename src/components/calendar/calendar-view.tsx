'use client';

import React, { useState, useCallback, useTransition, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import type { UnifiedCalendarEvent } from '@/server/calendar/service';
import { CalendarHeader } from './calendar-header';
import { MonthView } from './month-view';
import { WeekView } from './week-view';
import { DayView } from './day-view';
import { DayInspector } from './day-inspector';
import { AppointmentModal } from './appointment-modal';
import { BlockedTimeModal } from './blocked-time-modal';
import {
  formatIsoDate,
  parseIsoDate,
  navigateDate,
  getMonthBoundaries,
} from '@/client/calendar/grid-math';
import { getCalendarEventsAction } from '@/server/calendar/actions';

export interface CalendarViewProps {
  initialEvents: UnifiedCalendarEvent[];
  locale: string;
  initialDate?: string; // 'YYYY-MM-DD'
  initialView?: 'month' | 'week' | 'day';
}

export function CalendarView({
  initialEvents,
  locale,
  initialDate,
  initialView = 'month',
}: CalendarViewProps) {
  const t = useTranslations('calendar');

  const [currentDate, setCurrentDate] = useState<Date>(() => {
    return initialDate ? parseIsoDate(initialDate) : new Date();
  });

  const [currentView, setCurrentView] = useState<'month' | 'week' | 'day'>(initialView);

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return initialDate ?? formatIsoDate(new Date());
  });

  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [events, setEvents] = useState<UnifiedCalendarEvent[]>(initialEvents);
  const [announcement, setAnnouncement] = useState('');
  const [, startTransition] = useTransition();

  // Modal States
  const [appointmentModal, setAppointmentModal] = useState<{
    open: boolean;
    mode: 'create' | 'edit' | 'cancel';
    appointment?: UnifiedCalendarEvent | null;
  }>({
    open: false,
    mode: 'create',
    appointment: null,
  });

  const [blockedTimeModal, setBlockedTimeModal] = useState<{
    open: boolean;
    mode: 'create' | 'edit' | 'delete';
    blockedTime?: UnifiedCalendarEvent | null;
  }>({
    open: false,
    mode: 'create',
    blockedTime: null,
  });

  // Re-fetch calendar events for visible window
  const refreshEvents = useCallback(
    (targetDate: Date = currentDate) => {
      const year = targetDate.getFullYear();
      const month = targetDate.getMonth();
      const firstDay = locale === 'de' ? 1 : 0;
      const bounds = getMonthBoundaries(year, month, firstDay);

      startTransition(async () => {
        const res = await getCalendarEventsAction({
          startDate: bounds.gridStart.toISOString(),
          endDate: bounds.gridEnd.toISOString(),
        });
        if (res.success) {
          setEvents(res.data);
        }
      });
    },
    [currentDate, locale],
  );

  // Navigation Handler (AC-4)
  const handleNavigate = useCallback(
    (direction: 'prev' | 'next' | 'today') => {
      if (direction === 'today') {
        const today = new Date();
        setCurrentDate(today);
        setSelectedDate(formatIsoDate(today));
        setAnnouncement(t('aria.selectedDate', { date: formatIsoDate(today) }));
        refreshEvents(today);
      } else {
        const next = navigateDate(currentDate, currentView, direction);
        setCurrentDate(next);
        const nextStr = formatIsoDate(next);
        setSelectedDate(nextStr);
        setAnnouncement(t('aria.selectedDate', { date: nextStr }));
        refreshEvents(next);
      }
    },
    [currentDate, currentView, refreshEvents, t],
  );

  // View Switcher Handler (AC-4)
  const handleViewChange = useCallback((newView: 'month' | 'week' | 'day') => {
    setCurrentView(newView);
  }, []);

  // Day Selection Handler (AC-3)
  const handleSelectDate = useCallback(
    (dateStr: string) => {
      setSelectedDate(dateStr);
      setIsInspectorOpen(true);
      setAnnouncement(t('aria.selectedDate', { date: dateStr }));
    },
    [t],
  );

  // Keyboard Shortcuts (AC-4: 'm' -> month, 'w' -> week, 'd' -> day, 't' -> today)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (appointmentModal.open || blockedTimeModal.open) {
        return;
      }

      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setCurrentView('month');
      } else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        setCurrentView('week');
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        setCurrentView('day');
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        handleNavigate('today');
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [appointmentModal.open, blockedTimeModal.open, handleNavigate]);

  return (
    <div className="space-y-4" data-testid="calendar-root">
      {/* Calendar Header with Navigation and View Switcher */}
      <CalendarHeader
        currentDate={currentDate}
        currentView={currentView}
        onViewChange={handleViewChange}
        onNavigate={handleNavigate}
        onNewAppointment={() => {
          setAppointmentModal({ open: true, mode: 'create', appointment: null });
        }}
        onBlockTime={() => {
          setBlockedTimeModal({ open: true, mode: 'create', blockedTime: null });
        }}
        locale={locale}
        announcement={announcement}
      />

      {/* Main Calendar Grid and Day Inspector Layout */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="flex-1 w-full min-w-0">
          {currentView === 'month' && (
            <MonthView
              currentDate={currentDate}
              selectedDate={selectedDate}
              events={events}
              locale={locale}
              onSelectDate={handleSelectDate}
            />
          )}

          {currentView === 'week' && (
            <WeekView
              currentDate={currentDate}
              selectedDate={selectedDate}
              events={events}
              locale={locale}
              onSelectDate={handleSelectDate}
            />
          )}

          {currentView === 'day' && (
            <DayView
              currentDate={currentDate}
              selectedDate={selectedDate}
              events={events}
              locale={locale}
              onNewAppointment={() => {
                setAppointmentModal({ open: true, mode: 'create', appointment: null });
              }}
              onBlockTime={() => {
                setBlockedTimeModal({ open: true, mode: 'create', blockedTime: null });
              }}
              onEditAppointment={(evt) => {
                setAppointmentModal({ open: true, mode: 'edit', appointment: evt });
              }}
              onCancelAppointment={(evt) => {
                setAppointmentModal({ open: true, mode: 'cancel', appointment: evt });
              }}
              onEditBlockedTime={(evt) => {
                setBlockedTimeModal({ open: true, mode: 'edit', blockedTime: evt });
              }}
              onDeleteBlockedTime={(evt) => {
                setBlockedTimeModal({ open: true, mode: 'delete', blockedTime: evt });
              }}
            />
          )}
        </div>

        {/* Day Inspector Panel (AC-3, AC-5, AC-6, AC-7, AC-8) */}
        {currentView !== 'day' && isInspectorOpen && (
          <DayInspector
            selectedDate={selectedDate}
            events={events}
            isOpen={isInspectorOpen}
            onClose={() => {
              setIsInspectorOpen(false);
            }}
            onNewAppointment={() => {
              setAppointmentModal({ open: true, mode: 'create', appointment: null });
            }}
            onBlockTime={() => {
              setBlockedTimeModal({ open: true, mode: 'create', blockedTime: null });
            }}
            onEditAppointment={(evt) => {
              setAppointmentModal({ open: true, mode: 'edit', appointment: evt });
            }}
            onCancelAppointment={(evt) => {
              setAppointmentModal({ open: true, mode: 'cancel', appointment: evt });
            }}
            onEditBlockedTime={(evt) => {
              setBlockedTimeModal({ open: true, mode: 'edit', blockedTime: evt });
            }}
            onDeleteBlockedTime={(evt) => {
              setBlockedTimeModal({ open: true, mode: 'delete', blockedTime: evt });
            }}
            locale={locale}
          />
        )}
      </div>

      {/* Appointment Modals (Create, Edit, Cancel) */}
      <AppointmentModal
        open={appointmentModal.open}
        onOpenChange={(open) => {
          setAppointmentModal((prev) => ({ ...prev, open }));
        }}
        mode={appointmentModal.mode}
        appointment={appointmentModal.appointment}
        defaultDate={selectedDate}
        onSuccess={() => {
          refreshEvents();
        }}
      />

      {/* Blocked Time Modals (Create, Edit, Delete) */}
      <BlockedTimeModal
        open={blockedTimeModal.open}
        onOpenChange={(open) => {
          setBlockedTimeModal((prev) => ({ ...prev, open }));
        }}
        mode={blockedTimeModal.mode}
        blockedTime={blockedTimeModal.blockedTime}
        defaultDate={selectedDate}
        onSuccess={() => {
          refreshEvents();
        }}
      />
    </div>
  );
}
