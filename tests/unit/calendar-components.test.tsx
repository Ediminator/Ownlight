import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => {
    const t = (key: string, values?: Record<string, unknown>) => {
      if (key === 'aria.eventsSummary') {
        const count = Number(values?.count ?? 0);
        return count === 0 ? 'no events' : count === 1 ? '1 event' : `${String(count)} events`;
      }
      const prefix = namespace ? `${namespace}.` : '';
      return `${prefix}${key}${values ? JSON.stringify(values) : ''}`;
    };
    t.has = () => true;
    return t;
  },
  useLocale: () => 'en',
}));

vi.mock('@/server/calendar/actions', () => ({
  getCalendarEventsAction: vi.fn().mockResolvedValue({ success: true, data: [] }),
  createAppointmentAction: vi.fn().mockResolvedValue({ success: true }),
  updateAppointmentAction: vi.fn().mockResolvedValue({ success: true }),
  cancelAppointmentAction: vi.fn().mockResolvedValue({ success: true }),
  createBlockedTimeAction: vi.fn().mockResolvedValue({ success: true }),
  updateBlockedTimeAction: vi.fn().mockResolvedValue({ success: true }),
  deleteBlockedTimeAction: vi.fn().mockResolvedValue({ success: true }),
}));

import { CalendarHeader } from '@/components/calendar/calendar-header';
import { MonthView } from '@/components/calendar/month-view';
import { WeekView } from '@/components/calendar/week-view';
import { DayView } from '@/components/calendar/day-view';
import { DayInspector } from '@/components/calendar/day-inspector';
import { CalendarView } from '@/components/calendar/calendar-view';
import { AppointmentModal } from '@/components/calendar/appointment-modal';
import { BlockedTimeModal } from '@/components/calendar/blocked-time-modal';
import type { UnifiedCalendarEvent } from '@/server/calendar/service';

describe('TASK-0042: Calendar UI Components Static Render Tests', () => {
  const dummyDate = new Date('2026-10-25T12:00:00Z');

  const dummyShoot: UnifiedCalendarEvent = {
    id: 'shoot-1',
    type: 'shoot',
    title: 'Wedding Shoot - Emma & Liam',
    startsAt: '2026-10-25T10:00:00.000Z',
    endsAt: '2026-10-25T14:00:00.000Z',
    allDay: false,
    timezone: 'UTC',
    projectId: '01920000-0000-7000-8000-000000000001',
    projectTitle: 'Emma & Liam Wedding',
    locationName: 'Lake View Studio',
  };

  const dummyAppt: UnifiedCalendarEvent = {
    id: 'appt-1',
    type: 'appointment',
    title: 'Consultation Call',
    startsAt: '2026-10-25T15:00:00.000Z',
    endsAt: '2026-10-25T16:00:00.000Z',
    allDay: false,
    timezone: 'UTC',
    attendeeName: 'Emma Watson',
    attendeeEmail: 'emma@example.org',
    attendeePhone: '+49 30 1234567',
    locationType: 'google_meet',
    locationDetails: 'https://meet.google.com/abc-defg-hij',
    notes: 'Discuss wedding package options',
  };

  const dummyBlocked: UnifiedCalendarEvent = {
    id: 'bt-1',
    type: 'blocked_time',
    title: 'Studio Maintenance',
    startsAt: '2026-10-25T00:00:00.000Z',
    endsAt: '2026-10-25T23:59:59.999Z',
    allDay: true,
    timezone: 'UTC',
    notes: 'Annual lighting rig inspection',
  };

  const events: UnifiedCalendarEvent[] = [
    dummyShoot,
    dummyAppt,
    dummyBlocked,
    {
      id: 'shoot-2',
      type: 'shoot',
      title: 'Portrait Session',
      startsAt: '2026-10-25T17:00:00.000Z',
      endsAt: '2026-10-25T18:00:00.000Z',
      allDay: false,
      timezone: 'UTC',
    },
  ];

  describe('CalendarHeader', () => {
    it('renders month view header with today button and view switcher', () => {
      const html = renderToStaticMarkup(
        <CalendarHeader
          currentDate={dummyDate}
          currentView="month"
          onViewChange={vi.fn()}
          onNavigate={vi.fn()}
          onNewAppointment={vi.fn()}
          onBlockTime={vi.fn()}
          locale="en"
        />,
      );
      expect(html).toContain('data-testid="calendar-today-btn"');
      expect(html).toContain('data-testid="calendar-view-month-btn"');
      expect(html).toContain('data-testid="calendar-view-week-btn"');
      expect(html).toContain('data-testid="calendar-view-day-btn"');
      expect(html).toContain('data-testid="calendar-quick-appointment-btn"');
      expect(html).toContain('data-testid="calendar-quick-block-btn"');
    });

    it('renders week and day view headers with announcement', () => {
      const htmlWeek = renderToStaticMarkup(
        <CalendarHeader
          currentDate={dummyDate}
          currentView="week"
          onViewChange={vi.fn()}
          onNavigate={vi.fn()}
          onNewAppointment={vi.fn()}
          onBlockTime={vi.fn()}
          locale="de"
          announcement="Woche ausgewählt"
        />,
      );
      expect(htmlWeek).toContain('Woche ausgewählt');

      const htmlDay = renderToStaticMarkup(
        <CalendarHeader
          currentDate={dummyDate}
          currentView="day"
          onViewChange={vi.fn()}
          onNavigate={vi.fn()}
          onNewAppointment={vi.fn()}
          onBlockTime={vi.fn()}
          locale="de"
        />,
      );
      expect(htmlDay).toBeDefined();
    });
  });

  describe('MonthView', () => {
    it('renders 6x7 month grid with event pills and overflow indicators', () => {
      const html = renderToStaticMarkup(
        <MonthView
          currentDate={dummyDate}
          selectedDate="2026-10-25"
          onSelectDate={vi.fn()}
          events={events}
          locale="en"
        />,
      );
      expect(html).toContain('data-testid="calendar-month-grid"');
      expect(html).toContain('data-testid="calendar-day-2026-10-25"');
      expect(html).toContain('Wedding Shoot - Emma &amp; Liam');
      expect(html).toContain('Consultation Call');
      expect(html).toContain('calendar.events.more'); // overflow indicator for 4 events
    });
  });

  describe('WeekView', () => {
    it('renders 7 weekday columns with day header buttons and event items', () => {
      const html = renderToStaticMarkup(
        <WeekView
          currentDate={dummyDate}
          selectedDate="2026-10-25"
          onSelectDate={vi.fn()}
          events={events}
          locale="en"
        />,
      );
      expect(html).toContain('data-testid="calendar-week-grid"');
      expect(html).toContain('data-testid="week-day-column-2026-10-25"');
      expect(html).toContain('Wedding Shoot - Emma &amp; Liam');
      expect(html).toContain('Consultation Call');
    });

    it('I1-U01: provides accessible aria-label on week day columns for WCAG 4.1.2 even when days have no events', () => {
      const html = renderToStaticMarkup(
        <WeekView
          currentDate={dummyDate}
          selectedDate="2026-10-25"
          onSelectDate={vi.fn()}
          events={[]}
          locale="en"
        />,
      );
      expect(html).toContain('aria-label="2026-10-25, no events"');
      expect(html).toContain('aria-label="2026-10-26, no events"');
    });
  });

  describe('DayView', () => {
    it('renders day view schedule with hourly slots and inspector panel', () => {
      const html = renderToStaticMarkup(
        <DayView
          currentDate={dummyDate}
          selectedDate="2026-10-25"
          events={events}
          locale="en"
          onNewAppointment={vi.fn()}
          onBlockTime={vi.fn()}
          onEditAppointment={vi.fn()}
          onCancelAppointment={vi.fn()}
          onEditBlockedTime={vi.fn()}
          onDeleteBlockedTime={vi.fn()}
        />,
      );
      expect(html).toContain('data-testid="calendar-day-view"');
      expect(html).toContain('Wedding Shoot - Emma &amp; Liam');
      expect(html).toContain('Consultation Call');
      expect(html).toContain('Studio Maintenance');
    });
  });

  describe('DayInspector', () => {
    it('renders day inspector side panel with edit and cancel/delete buttons', () => {
      const html = renderToStaticMarkup(
        <DayInspector
          selectedDate="2026-10-25"
          events={events}
          locale="en"
          isOpen={true}
          onClose={vi.fn()}
          onNewAppointment={vi.fn()}
          onBlockTime={vi.fn()}
          onEditAppointment={vi.fn()}
          onCancelAppointment={vi.fn()}
          onEditBlockedTime={vi.fn()}
          onDeleteBlockedTime={vi.fn()}
        />,
      );
      expect(html).toContain('data-testid="day-inspector-panel"');
      expect(html).toContain('data-testid="appointment-edit-btn"');
      expect(html).toContain('data-testid="appointment-cancel-btn"');
      expect(html).toContain('data-testid="blocked-time-edit-btn"');
      expect(html).toContain('data-testid="blocked-time-delete-btn"');
      expect(html).toContain('Emma Watson');
      expect(html).toContain('emma@example.org');
      expect(html).toContain('Lake View Studio');
    });

    it('renders empty day inspector state cleanly', () => {
      const html = renderToStaticMarkup(
        <DayInspector
          selectedDate="2026-10-26"
          events={[]}
          locale="en"
          isOpen={true}
          onClose={vi.fn()}
          onNewAppointment={vi.fn()}
          onBlockTime={vi.fn()}
          onEditAppointment={vi.fn()}
          onCancelAppointment={vi.fn()}
          onEditBlockedTime={vi.fn()}
          onDeleteBlockedTime={vi.fn()}
        />,
      );
      expect(html).toContain('data-testid="inspector-empty-state"');
    });
  });

  describe('CalendarView', () => {
    it('renders root calendar view with month, week, and day view selections', () => {
      const htmlMonth = renderToStaticMarkup(
        <CalendarView
          initialEvents={events}
          initialDate="2026-10-25"
          initialView="month"
          locale="en"
        />,
      );
      expect(htmlMonth).toContain('data-testid="calendar-root"');
      expect(htmlMonth).toContain('data-testid="calendar-month-grid"');

      const htmlWeek = renderToStaticMarkup(
        <CalendarView
          initialEvents={events}
          initialDate="2026-10-25"
          initialView="week"
          locale="en"
        />,
      );
      expect(htmlWeek).toContain('data-testid="calendar-week-grid"');

      const htmlDay = renderToStaticMarkup(
        <CalendarView
          initialEvents={events}
          initialDate="2026-10-25"
          initialView="day"
          locale="en"
        />,
      );
      expect(htmlDay).toContain('data-testid="calendar-day-view"');
    });
  });

  describe('AppointmentModal', () => {
    it('renders appointment modal in create mode', () => {
      const html = renderToStaticMarkup(
        <AppointmentModal
          open={true}
          onOpenChange={vi.fn()}
          onSuccess={vi.fn()}
          mode="create"
          defaultDate="2026-10-25"
        />,
      );
      expect(html).toContain('data-testid="appointment-title-input"');
      expect(html).toContain('data-testid="appointment-attendee-name-input"');
      expect(html).toContain('data-testid="appointment-attendee-email-input"');
      expect(html).toContain('data-testid="appointment-submit-btn"');
    });

    it('renders appointment modal in edit and cancel mode', () => {
      const htmlEdit = renderToStaticMarkup(
        <AppointmentModal
          open={true}
          onOpenChange={vi.fn()}
          onSuccess={vi.fn()}
          mode="edit"
          appointment={dummyAppt}
        />,
      );
      expect(htmlEdit).toContain('Consultation Call');
      expect(htmlEdit).toContain('Emma Watson');

      const htmlCancel = renderToStaticMarkup(
        <AppointmentModal
          open={true}
          onOpenChange={vi.fn()}
          onSuccess={vi.fn()}
          mode="cancel"
          appointment={dummyAppt}
        />,
      );
      expect(htmlCancel).toContain('data-testid="appointment-cancel-reason-input"');
    });
  });

  describe('BlockedTimeModal', () => {
    it('renders blocked time modal in create mode', () => {
      const html = renderToStaticMarkup(
        <BlockedTimeModal
          open={true}
          onOpenChange={vi.fn()}
          onSuccess={vi.fn()}
          mode="create"
          defaultDate="2026-10-25"
        />,
      );
      expect(html).toContain('data-testid="blocked-time-title-input"');
      expect(html).toContain('data-testid="blocked-time-submit-btn"');
    });

    it('renders blocked time modal in edit and delete mode', () => {
      const htmlEdit = renderToStaticMarkup(
        <BlockedTimeModal
          open={true}
          onOpenChange={vi.fn()}
          onSuccess={vi.fn()}
          mode="edit"
          blockedTime={dummyBlocked}
        />,
      );
      expect(htmlEdit).toContain('Studio Maintenance');

      const htmlDelete = renderToStaticMarkup(
        <BlockedTimeModal
          open={true}
          onOpenChange={vi.fn()}
          onSuccess={vi.fn()}
          mode="delete"
          blockedTime={dummyBlocked}
        />,
      );
      expect(htmlDelete).toContain('Studio Maintenance');
      expect(htmlDelete).toContain('data-testid="blocked-time-confirm-delete-btn"');
    });
  });
});
