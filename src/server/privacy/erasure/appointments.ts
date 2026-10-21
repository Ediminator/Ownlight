import 'server-only';
import { eq, or, inArray, and } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { appointments, calendarSyncOutbox } from '@/server/db/schema/calendar';
import { clientContacts } from '@/server/db/schema/clients';
import { leads } from '@/server/db/schema/leads';
import type { ErasureProvider, ErasureSubject } from '@/server/privacy/erasure/types';

export const ERASED_ATTENDEE_NAME = 'Erased Attendee';
export const ERASED_ATTENDEE_EMAIL = 'erased@redacted.local';
export const ERASURE_CANCELLATION_REASON = 'Data subject erasure request';

/**
 * Helper to fetch matching appointment IDs for an erasure subject.
 */
async function getSubjectAppointmentIds(subject: ErasureSubject, tx: DbClient): Promise<string[]> {
  if (subject.kind === 'lead') {
    const [leadRow] = await tx
      .select({ id: leads.id, email: leads.email })
      .from(leads)
      .where(eq(leads.id, subject.leadId))
      .limit(1);

    const email = leadRow?.email?.trim().toLowerCase();
    const condition = email
      ? or(eq(appointments.leadId, subject.leadId), eq(appointments.attendeeEmail, email))
      : eq(appointments.leadId, subject.leadId);

    const rows = await tx.select({ id: appointments.id }).from(appointments).where(condition);
    return Array.from(new Set(rows.map((r) => r.id)));
  }

  if (subject.kind === 'client') {
    // Client subject: match clientId or all client contacts' emails
    const contacts = await tx
      .select({ email: clientContacts.email })
      .from(clientContacts)
      .where(eq(clientContacts.clientId, subject.clientId));

    const contactEmails = contacts
      .map((c) => c.email?.trim().toLowerCase())
      .filter((e): e is string => Boolean(e));

    const condition =
      contactEmails.length > 0
        ? or(
            eq(appointments.clientId, subject.clientId),
            inArray(appointments.attendeeEmail, contactEmails),
          )
        : eq(appointments.clientId, subject.clientId);

    const rows = await tx.select({ id: appointments.id }).from(appointments).where(condition);
    return Array.from(new Set(rows.map((r) => r.id)));
  }

  // Contact subject
  const [contactRow] = await tx
    .select({ email: clientContacts.email })
    .from(clientContacts)
    .where(
      and(eq(clientContacts.id, subject.contactId), eq(clientContacts.clientId, subject.clientId)),
    )
    .limit(1);

  const contactEmail = contactRow?.email?.trim().toLowerCase();
  if (!contactEmail) {
    return [];
  }

  const rows = await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.clientId, subject.clientId),
        eq(appointments.attendeeEmail, contactEmail),
      ),
    );

  return Array.from(new Set(rows.map((r) => r.id)));
}

/**
 * GDPR Art. 17 Erasure Provider for appointments (TASK-0041 / ADR-0017 §8.4).
 * Enforces right to be forgotten:
 * - Anonymizes past/completed appointments while retaining temporal slots for continuity.
 * - Cancels upcoming scheduled appointments, anonymizes attendee PII, and cleans up pending sync outbox items.
 */
export const appointmentsErasureProvider: ErasureProvider = {
  id: 'appointments',
  category: 'appointments',
  coveredTables: ['appointments'] as const,
  subjectKinds: ['client', 'contact', 'lead'] as const,

  plan: async (subject: ErasureSubject, tx: DbClient): Promise<number> => {
    const ids = await getSubjectAppointmentIds(subject, tx);
    return ids.length;
  },

  erase: async (subject: ErasureSubject, tx: DbClient): Promise<number> => {
    const appointmentIds = await getSubjectAppointmentIds(subject, tx);
    if (appointmentIds.length === 0) {
      return 0;
    }

    const appts = await tx
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        status: appointments.status,
      })
      .from(appointments)
      .where(inArray(appointments.id, appointmentIds));

    const now = new Date();
    const pastIds: string[] = [];
    const upcomingScheduledIds: string[] = [];

    for (const appt of appts) {
      const isPastOrNotScheduled = appt.startsAt < now || appt.status !== 'scheduled';
      if (isPastOrNotScheduled) {
        pastIds.push(appt.id);
      } else {
        upcomingScheduledIds.push(appt.id);
      }
    }

    let modifiedCount = 0;

    // 1. Past / Completed: Anonymize personal data (AC-2)
    if (pastIds.length > 0) {
      const updatedPast = await tx
        .update(appointments)
        .set({
          attendeeName: ERASED_ATTENDEE_NAME,
          attendeeEmail: ERASED_ATTENDEE_EMAIL,
          attendeePhone: null,
          attendeeNotes: null,
          locationDetails: null,
          updatedAt: now,
        })
        .where(inArray(appointments.id, pastIds))
        .returning({ id: appointments.id });

      modifiedCount += updatedPast.length;
    }

    // 2. Upcoming Scheduled: Cancel, set reason, anonymize attendee PII, and cancel pending calendar sync items (AC-3)
    if (upcomingScheduledIds.length > 0) {
      const updatedUpcoming = await tx
        .update(appointments)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancellationReason: ERASURE_CANCELLATION_REASON,
          attendeeName: ERASED_ATTENDEE_NAME,
          attendeeEmail: ERASED_ATTENDEE_EMAIL,
          attendeePhone: null,
          attendeeNotes: null,
          locationDetails: null,
          updatedAt: now,
        })
        .where(inArray(appointments.id, upcomingScheduledIds))
        .returning({ id: appointments.id });

      modifiedCount += updatedUpcoming.length;

      // Mark linked pending sync tasks in calendar_sync_outbox as CANCELLED (or remove)
      await tx
        .update(calendarSyncOutbox)
        .set({
          status: 'CANCELLED',
          updatedAt: now,
        })
        .where(
          and(
            eq(calendarSyncOutbox.entityType, 'appointment'),
            inArray(calendarSyncOutbox.entityId, upcomingScheduledIds),
            inArray(calendarSyncOutbox.status, ['PENDING', 'PROCESSING']),
          ),
        );
    }

    return modifiedCount;
  },
};
