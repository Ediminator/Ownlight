import 'server-only';
import { eq, or, asc } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { appointments } from '@/server/db/schema/calendar';
import type { ExportProvider, ExportSubject } from '@/server/privacy/export/types';
import { escapeHtml } from '@/server/privacy/export/html';

export interface FormattedAppointmentExport {
  id: string;
  title: string;
  status: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  timezone: string;
  location_type: string;
  location_details: string | null;
  meet_url: string | null;
  attendee_name: string;
  attendee_email: string;
  attendee_phone: string | null;
  attendee_notes: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
}

/**
 * Localized table headers for appointments DSAR HTML rendering per AC-1.
 */
export const APPOINTMENT_EXPORT_HEADERS = {
  en: {
    title: 'Appointment',
    startsAt: 'Start Time',
    duration: 'Duration (min)',
    status: 'Status',
    locationType: 'Location Type',
    locationDetails: 'Location Details',
    meetUrl: 'Google Meet',
    attendee: 'Attendee',
  },
  de: {
    title: 'Termin',
    startsAt: 'Beginn',
    duration: 'Dauer (Min.)',
    status: 'Status',
    locationType: 'Ort / Typ',
    locationDetails: 'Ortsdetails',
    meetUrl: 'Google Meet',
    attendee: 'Teilnehmer',
  },
} as const;

/**
 * Formats a clean, accessible HTML table for appointments DSAR exports.
 */
export function formatAppointmentsHtml(
  items: FormattedAppointmentExport[],
  locale: 'en' | 'de' = 'en',
): string {
  if (items.length === 0) {
    return locale === 'de'
      ? '<p class="empty-notice">In dieser Kategorie sind derzeit keine Datensätze gespeichert.</p>'
      : '<p class="empty-notice">No records stored in this category.</p>';
  }

  const h = locale === 'de' ? APPOINTMENT_EXPORT_HEADERS.de : APPOINTMENT_EXPORT_HEADERS.en;
  const headers = [
    h.title,
    h.startsAt,
    h.duration,
    h.status,
    h.locationType,
    h.locationDetails,
    h.meetUrl,
    h.attendee,
  ];

  const thead = headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('');
  const tbody = items
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.title)}</td>
        <td>${escapeHtml(item.starts_at)}</td>
        <td>${escapeHtml(item.duration_minutes)}</td>
        <td>${escapeHtml(item.status)}</td>
        <td>${escapeHtml(item.location_type)}</td>
        <td>${escapeHtml(item.location_details ?? '-')}</td>
        <td>${escapeHtml(item.meet_url ?? '-')}</td>
        <td>${escapeHtml(item.attendee_name)} (${escapeHtml(item.attendee_email)})</td>
      </tr>`,
    )
    .join('');

  return `<div class="table-wrapper" tabindex="0" role="region" aria-label="${escapeHtml(locale === 'de' ? 'Termine' : 'Appointments')}">
  <table class="data-table">
    <thead>
      <tr>${thead}</tr>
    </thead>
    <tbody>
      ${tbody}
    </tbody>
  </table>
</div>`;
}

/**
 * DSAR Export Provider for appointments (TASK-0041 / GDPR Art. 15 / ADR-0017 §8.3).
 * Exports all appointments matching subject clientId, leadId, or attendeeEmail.
 */
export const appointmentsExportProvider: ExportProvider = {
  id: 'appointments',
  category: 'appointments',
  coveredTables: ['appointments'] as const,
  subjectKinds: ['client', 'contact', 'lead'] as const,

  collect: async (subject: ExportSubject, tx: DbClient): Promise<FormattedAppointmentExport[]> => {
    let rows: (typeof appointments.$inferSelect)[] = [];

    if (subject.kind === 'lead') {
      const email = subject.lead.email?.trim().toLowerCase();
      if (email) {
        rows = await tx
          .select()
          .from(appointments)
          .where(or(eq(appointments.leadId, subject.leadId), eq(appointments.attendeeEmail, email)))
          .orderBy(asc(appointments.startsAt));
      } else {
        rows = await tx
          .select()
          .from(appointments)
          .where(eq(appointments.leadId, subject.leadId))
          .orderBy(asc(appointments.startsAt));
      }
    } else {
      // client or contact
      const contactEmail = subject.contact.email?.trim().toLowerCase();
      if (contactEmail) {
        rows = await tx
          .select()
          .from(appointments)
          .where(
            or(
              eq(appointments.clientId, subject.clientId),
              eq(appointments.attendeeEmail, contactEmail),
            ),
          )
          .orderBy(asc(appointments.startsAt));
      } else {
        rows = await tx
          .select()
          .from(appointments)
          .where(eq(appointments.clientId, subject.clientId))
          .orderBy(asc(appointments.startsAt));
      }
    }

    // Deduplicate in case multiple conditions match the same appointment row
    const seen = new Set<string>();
    const deduplicated = rows.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    return deduplicated.map((a) => {
      const durationMinutes = Math.max(
        0,
        Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60000),
      );

      return {
        id: a.id,
        title: a.title,
        status: a.status,
        starts_at: a.startsAt.toISOString(),
        ends_at: a.endsAt.toISOString(),
        duration_minutes: durationMinutes,
        timezone: a.timezone,
        location_type: a.locationType,
        location_details: a.locationDetails ?? null,
        meet_url: a.meetUrl ?? null,
        attendee_name: a.attendeeName,
        attendee_email: a.attendeeEmail,
        attendee_phone: a.attendeePhone ?? null,
        attendee_notes: a.attendeeNotes ?? null,
        cancellation_reason: a.cancellationReason ?? null,
        cancelled_at: a.cancelledAt ? a.cancelledAt.toISOString() : null,
        created_at: a.createdAt.toISOString(),
      };
    });
  },
};
