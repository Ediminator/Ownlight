import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  renderAppointmentConfirmationEmail,
  renderAppointmentCancellationEmail,
  getAppointmentEmailHeaders,
  APPOINTMENT_EMAIL_HEADERS,
  type AppointmentEmailPayload,
} from '@/server/email/templates/appointment';

describe('TASK-0041: Appointment Email Templates (AC-5, AC-6, AC-7)', () => {
  const baseAppointment: AppointmentEmailPayload = {
    id: '01920000-0000-7000-8000-000000000001',
    title: 'Wedding Consultation',
    startsAt: new Date('2026-06-15T14:30:00Z'),
    endsAt: new Date('2026-06-15T15:15:00Z'),
    timezone: 'Europe/Berlin',
    locationType: 'google_meet',
    locationDetails: 'Online video consultation',
    meetUrl: 'https://meet.google.com/abc-defg-hij',
    attendeeName: 'Emma Watson',
    attendeeEmail: 'emma@example.com',
    attendeePhone: '+49 170 1234567',
    attendeeNotes: 'Discussing summer wedding package.',
  };

  it('AC-5: getAppointmentEmailHeaders provides RFC 3834 auto-submitted headers', () => {
    const headers = getAppointmentEmailHeaders();
    expect(headers['Auto-Submitted']).toBe('auto-generated');
    expect(headers.Precedence).toBe('bulk');
    expect(headers['X-Auto-Response-Suppress']).toBe('All');

    expect(APPOINTMENT_EMAIL_HEADERS['Auto-Submitted']).toBe('auto-generated');
    expect(APPOINTMENT_EMAIL_HEADERS.Precedence).toBe('bulk');
  });

  it('AC-5: renderAppointmentConfirmationEmail renders plain-text English confirmation with all details', () => {
    const rendered = renderAppointmentConfirmationEmail({
      appointment: baseAppointment,
      studioName: 'Lumos Photography',
      locale: 'en',
    });

    // Subject checks
    expect(rendered.subject).toContain(
      'Appointment Confirmation: Wedding Consultation with Lumos Photography',
    );

    // Body checks
    expect(rendered.text).toContain('Hello Emma Watson,');
    expect(rendered.text).toContain('Your appointment has been confirmed.');
    expect(rendered.text).toContain('Appointment: Wedding Consultation');
    expect(rendered.text).toContain('Duration: 45 minutes');
    expect(rendered.text).toContain('Google Meet (Video Call)');
    expect(rendered.text).toContain('https://meet.google.com/abc-defg-hij');
    expect(rendered.text).toContain('Online video consultation');
    expect(rendered.text).toContain('Discussing summer wedding package.');
    expect(rendered.text).toContain(
      'If you have any questions or need to make changes, please contact Lumos Photography.',
    );
    expect(rendered.text).toContain('This is an automated transactional notification.');

    // Plain text only - no HTML tags
    expect(rendered.text).not.toContain('<html');
    expect(rendered.text).not.toContain('<div>');
    expect(rendered.text).not.toContain('</a>');
  });

  it('AC-5: renderAppointmentConfirmationEmail handles in-person location and phone location types', () => {
    const inPersonAppt: AppointmentEmailPayload = {
      ...baseAppointment,
      locationType: 'in_person',
      locationDetails: 'Studio Berlin, Unter den Linden 1',
      meetUrl: null,
      attendeeNotes: null,
    };

    const rendered = renderAppointmentConfirmationEmail({
      appointment: inPersonAppt,
      studioName: 'Berlin Light',
      locale: 'en',
    });

    expect(rendered.text).toContain('Location: In Person');
    expect(rendered.text).toContain('Location Details: Studio Berlin, Unter den Linden 1');
    expect(rendered.text).not.toContain('Google Meet Link:');
    expect(rendered.text).not.toContain('Notes:');
  });

  it('AC-6: renderAppointmentCancellationEmail renders plain-text English cancellation with reason and date', () => {
    const cancelledAppt: AppointmentEmailPayload = {
      ...baseAppointment,
      cancellationReason: 'Schedule conflict with client travel',
      cancelledAt: new Date('2026-06-10T09:00:00Z'),
    };

    const rendered = renderAppointmentCancellationEmail({
      appointment: cancelledAppt,
      studioName: 'Lumos Photography',
      locale: 'en',
    });

    expect(rendered.subject).toContain(
      'Appointment Cancelled: Wedding Consultation with Lumos Photography',
    );
    expect(rendered.text).toContain('Hello Emma Watson,');
    expect(rendered.text).toContain('Your appointment has been cancelled.');
    expect(rendered.text).toContain('Appointment: Wedding Consultation');
    expect(rendered.text).toContain('Cancellation Reason: Schedule conflict with client travel');
    expect(rendered.text).toContain(
      'If you would like to reschedule or have questions, please contact Lumos Photography.',
    );
    expect(rendered.text).toContain('This is an automated transactional notification.');
    expect(rendered.text).not.toContain('<div');
  });

  it('AC-6: renderAppointmentCancellationEmail falls back gracefully when reason is omitted', () => {
    const noReasonAppt: AppointmentEmailPayload = {
      ...baseAppointment,
      cancellationReason: null,
    };

    const renderedEn = renderAppointmentCancellationEmail({
      appointment: noReasonAppt,
      studioName: 'Lumos Photography',
      locale: 'en',
    });
    expect(renderedEn.text).toContain('Cancellation Reason: No reason provided');

    const renderedDe = renderAppointmentCancellationEmail({
      appointment: noReasonAppt,
      studioName: 'Lumos Fotostudio',
      locale: 'de',
    });
    expect(renderedDe.text).toContain('Grund der Absage: Keine Angabe');
  });

  it('AC-7: renders German confirmation and cancellation with 24-hour time formatting and correct umlauts', () => {
    const confDe = renderAppointmentConfirmationEmail({
      appointment: baseAppointment,
      studioName: 'Foto Atelier Müller',
      locale: 'de',
    });

    expect(confDe.subject).toBe('Terminbestätigung: Wedding Consultation bei Foto Atelier Müller');
    expect(confDe.text).toContain('Hallo Emma Watson,');
    expect(confDe.text).toContain('Ihr Termin wurde erfolgreich bestätigt.');
    expect(confDe.text).toContain('Termin: Wedding Consultation');
    expect(confDe.text).toContain('Dauer: 45 Minuten');
    expect(confDe.text).toContain('Art des Termins: Google Meet (Videogespräch)');
    expect(confDe.text).toContain('Ortsdetails: Online video consultation');
    expect(confDe.text).toContain(
      'Bei Fragen oder Änderungswünschen wenden Sie sich bitte an Foto Atelier Müller.',
    );

    // German cancellation
    const cancelDe = renderAppointmentCancellationEmail({
      appointment: {
        ...baseAppointment,
        cancellationReason: 'Terminverschiebung auf Wunsch der Kundin',
      },
      studioName: 'Foto Atelier Müller',
      locale: 'de',
    });

    expect(cancelDe.subject).toBe('Termin abgesagt: Wedding Consultation bei Foto Atelier Müller');
    expect(cancelDe.text).toContain('Ihr Termin wurde abgesagt.');
    expect(cancelDe.text).toContain('Grund der Absage: Terminverschiebung auf Wunsch der Kundin');
    expect(cancelDe.text).toContain(
      'Wenn Sie einen neuen Termin vereinbaren möchten oder Fragen haben',
    );
  });

  it('AC-7: formats dates and times correctly across timezones and daylight saving time boundaries', () => {
    // Summer date (DST): UTC 14:30 -> Berlin CEST (UTC+2) is 16:30
    const summerAppt: AppointmentEmailPayload = {
      ...baseAppointment,
      startsAt: new Date('2026-07-20T14:30:00Z'),
      timezone: 'Europe/Berlin',
    };

    const renderedSummerDe = renderAppointmentConfirmationEmail({
      appointment: summerAppt,
      studioName: 'Studio',
      locale: 'de',
    });

    // In German 24h format, 14:30 UTC in CEST is 16:30
    expect(renderedSummerDe.text).toContain('16:30');
    expect(renderedSummerDe.text).toContain('Europe/Berlin');

    // Winter date (standard time): UTC 14:30 -> Berlin CET (UTC+1) is 15:30
    const winterAppt: AppointmentEmailPayload = {
      ...baseAppointment,
      startsAt: new Date('2026-01-15T14:30:00Z'),
      timezone: 'Europe/Berlin',
    };

    const renderedWinterDe = renderAppointmentConfirmationEmail({
      appointment: winterAppt,
      studioName: 'Studio',
      locale: 'de',
    });

    expect(renderedWinterDe.text).toContain('15:30');
    expect(renderedWinterDe.text).toContain('Europe/Berlin');

    // US Eastern Time (UTC-4 in summer): UTC 14:30 -> America/New_York is 10:30 AM
    const nyAppt: AppointmentEmailPayload = {
      ...baseAppointment,
      startsAt: new Date('2026-07-20T14:30:00Z'),
      timezone: 'America/New_York',
    };

    const renderedNyEn = renderAppointmentConfirmationEmail({
      appointment: nyAppt,
      studioName: 'Studio',
      locale: 'en',
    });

    expect(renderedNyEn.text).toContain('10:30 AM');
    expect(renderedNyEn.text).toContain('America/New_York');
  });

  it('AC-5, AC-6: prevents header injection via attendee name or appointment title', () => {
    const maliciousAppt: AppointmentEmailPayload = {
      ...baseAppointment,
      title: 'Consultation\r\nBcc: evil@example.com\nSubject: Injected',
      attendeeName: 'Emma Watson\r\nBcc: evil@example.com',
      cancellationReason: 'Reason\r\nEvil Header: Injected',
    };

    const conf = renderAppointmentConfirmationEmail({
      appointment: maliciousAppt,
      studioName: 'Clean Studio\r\nBcc: evil@example.com',
      locale: 'en',
    });

    // Subject must not contain carriage return or newline
    expect(conf.subject).not.toContain('\r');
    expect(conf.subject).not.toContain('\n');
    expect(conf.subject).toBe(
      'Appointment Confirmation: Consultation Bcc: evil@example.com Subject: Injected with Clean Studio Bcc: evil@example.com',
    );

    const cancel = renderAppointmentCancellationEmail({
      appointment: maliciousAppt,
      studioName: 'Clean Studio',
      locale: 'en',
    });

    expect(cancel.subject).not.toContain('\r');
    expect(cancel.subject).not.toContain('\n');
    expect(cancel.text).toContain('Reason Evil Header: Injected');
  });

  it('AC-5, AC-6: handles empty strings and unusual location types gracefully', () => {
    const emptyAppt: AppointmentEmailPayload = {
      ...baseAppointment,
      title: '   ',
      attendeeName: '   ',
      locationType: 'custom_heli_pad',
      cancellationReason: '   ',
    };

    const conf = renderAppointmentConfirmationEmail({
      appointment: emptyAppt,
      studioName: '',
      locale: 'en',
    });
    expect(conf.text).toContain('Hello Client,');
    expect(conf.text).toContain('Location: custom_heli_pad');

    const cancel = renderAppointmentCancellationEmail({
      appointment: emptyAppt,
      studioName: '',
      locale: 'de',
    });
    expect(cancel.text).toContain('Hallo Client,');
    expect(cancel.text).toContain('Grund der Absage: Keine Angabe');
  });
});
