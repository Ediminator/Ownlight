import 'server-only';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';
import { logger } from '@/server/log';
import { emailOutbox, type EmailOutboxItem } from '@/server/db/schema/email-outbox';
import { formatDateTime } from '@/lib/formatters';
import { sanitizeStudioName, type RenderedEmail } from '@/server/email/templates';
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

export interface AppointmentEmailPayload {
  id: string;
  title: string;
  startsAt: Date | string;
  endsAt: Date | string;
  timezone?: string | null;
  locationType?: string | null;
  locationDetails?: string | null;
  meetUrl?: string | null;
  attendeeName: string;
  attendeeEmail: string;
  attendeePhone?: string | null;
  attendeeNotes?: string | null;
  cancellationReason?: string | null;
  cancelledAt?: Date | string | null;
}

export interface RenderAppointmentConfirmationParams {
  appointment: AppointmentEmailPayload;
  studioName?: string | null;
  locale?: string | null;
  studioContactInfo?: string | null;
}

export interface RenderAppointmentCancellationParams {
  appointment: AppointmentEmailPayload;
  studioName?: string | null;
  locale?: string | null;
  studioContactInfo?: string | null;
}

export interface EnqueueAppointmentEmailParams {
  appointmentId: string;
  kind: 'appointment_confirmation' | 'appointment_cancellation';
  recipient?: string | null;
  tx?: DbClient;
}

/**
 * Standard RFC 3834 auto-submitted headers for automated transactional emails (AC-5, AC-6).
 */
export const APPOINTMENT_EMAIL_HEADERS = {
  'Auto-Submitted': 'auto-generated',
  Precedence: 'bulk',
  'X-Auto-Response-Suppress': 'All',
} as const;

/**
 * Returns RFC 3834 auto-submitted headers for appointment transactional notifications.
 */
export function getAppointmentEmailHeaders(): Record<string, string> {
  return {
    'Auto-Submitted': 'auto-generated',
    Precedence: 'bulk',
    'X-Auto-Response-Suppress': 'All',
  };
}

function resolveLocationLabel(
  dict: { google_meet: string; in_person: string; phone: string },
  locType?: string | null,
): string {
  if (locType === 'google_meet') return dict.google_meet;
  if (locType === 'in_person') return dict.in_person;
  if (locType === 'phone') return dict.phone;
  return locType ?? 'Online';
}

/**
 * Sanitizes single-line fields (e.g. attendee name, title) against header/CRLF injection.
 */
function sanitizeSingleLine(input?: string | null, fallback = ''): string {
  if (!input || typeof input !== 'string') {
    return fallback;
  }
  return input.replace(/[\r\n\x00]+/g, ' ').trim() || fallback;
}

/**
 * Renders the localized plain-text appointment confirmation email (AC-5, AC-7).
 */
export function renderAppointmentConfirmationEmail({
  appointment,
  studioName,
  locale = 'en',
}: RenderAppointmentConfirmationParams): RenderedEmail {
  const isGerman = locale?.toLowerCase().startsWith('de');
  const activeLocale = isGerman ? 'de' : 'en';
  const dict = isGerman ? deMessages.emails.appointment : enMessages.emails.appointment;
  const strings = dict.confirmation;
  const locationsDict = dict.locations;

  const sanitizedStudio = sanitizeStudioName(studioName);
  const sanitizedTitle = sanitizeSingleLine(appointment.title, 'Consultation');
  const sanitizedAttendee = sanitizeSingleLine(appointment.attendeeName, 'Client');
  const timezone = appointment.timezone ?? 'Europe/Berlin';

  const startsAtDate =
    appointment.startsAt instanceof Date ? appointment.startsAt : new Date(appointment.startsAt);
  const endsAtDate =
    appointment.endsAt instanceof Date ? appointment.endsAt : new Date(appointment.endsAt);

  const formattedDateTime = formatDateTime(startsAtDate, activeLocale, { timeZone: timezone });
  const durationMinutes = Math.max(
    0,
    Math.round((endsAtDate.getTime() - startsAtDate.getTime()) / 60000),
  );

  const locationLabel = resolveLocationLabel(locationsDict, appointment.locationType);

  const subject = strings.subject
    .replace('{title}', sanitizedTitle)
    .replace('{studioName}', sanitizedStudio)
    .replace(/[\r\n\x00]+/g, ' ')
    .trim();

  const lines: string[] = [
    strings.greeting.replace('{attendeeName}', sanitizedAttendee),
    '',
    strings.intro,
    '',
    strings.appointmentTitle.replace('{title}', sanitizedTitle),
    strings.dateTime.replace('{dateTime}', formattedDateTime).replace('{timezone}', timezone),
    strings.duration.replace('{duration}', String(durationMinutes)),
    strings.locationType.replace('{locationType}', locationLabel),
  ];

  if (appointment.locationDetails?.trim()) {
    lines.push(
      strings.locationDetails.replace('{locationDetails}', appointment.locationDetails.trim()),
    );
  }

  if (appointment.meetUrl?.trim()) {
    lines.push(strings.meetUrl.replace('{meetUrl}', appointment.meetUrl.trim()));
  }

  if (appointment.attendeeNotes?.trim()) {
    lines.push(strings.notes.replace('{notes}', appointment.attendeeNotes.trim()));
  }

  lines.push('');
  lines.push(strings.contactInfo.replace('{studioName}', sanitizedStudio));
  lines.push('');
  lines.push(strings.footer);

  return {
    subject,
    text: lines.join('\n'),
  };
}

/**
 * Renders the localized plain-text appointment cancellation email (AC-6, AC-7).
 */
export function renderAppointmentCancellationEmail({
  appointment,
  studioName,
  locale = 'en',
}: RenderAppointmentCancellationParams): RenderedEmail {
  const isGerman = locale?.toLowerCase().startsWith('de');
  const activeLocale = isGerman ? 'de' : 'en';
  const dict = isGerman ? deMessages.emails.appointment : enMessages.emails.appointment;
  const strings = dict.cancellation;

  const sanitizedStudio = sanitizeStudioName(studioName);
  const sanitizedTitle = sanitizeSingleLine(appointment.title, 'Consultation');
  const sanitizedAttendee = sanitizeSingleLine(appointment.attendeeName, 'Client');
  const timezone = appointment.timezone ?? 'Europe/Berlin';

  const startsAtDate =
    appointment.startsAt instanceof Date ? appointment.startsAt : new Date(appointment.startsAt);
  const formattedDateTime = formatDateTime(startsAtDate, activeLocale, { timeZone: timezone });

  const reason = sanitizeSingleLine(
    appointment.cancellationReason,
    isGerman ? 'Keine Angabe' : 'No reason provided',
  );

  const subject = strings.subject
    .replace('{title}', sanitizedTitle)
    .replace('{studioName}', sanitizedStudio)
    .replace(/[\r\n\x00]+/g, ' ')
    .trim();

  const lines: string[] = [
    strings.greeting.replace('{attendeeName}', sanitizedAttendee),
    '',
    strings.intro,
    '',
    strings.appointmentTitle.replace('{title}', sanitizedTitle),
    strings.dateTime.replace('{dateTime}', formattedDateTime).replace('{timezone}', timezone),
    strings.reason.replace('{reason}', reason),
    '',
    strings.contactInfo.replace('{studioName}', sanitizedStudio),
    '',
    strings.footer,
  ];

  return {
    subject,
    text: lines.join('\n'),
  };
}

/**
 * Enqueues an appointment transactional email in `email_outbox` (TASK-0041 / AC-5, AC-6, AC-8).
 * Adheres strictly to AC-8 by logging only appointmentId and outboxId without PII.
 */
export async function enqueueAppointmentEmail({
  appointmentId,
  kind,
  recipient,
  tx = defaultDb,
}: EnqueueAppointmentEmailParams): Promise<EmailOutboxItem> {
  const now = new Date();
  const [created] = await tx
    .insert(emailOutbox)
    .values({
      id: generateUuidV7(),
      kind,
      appointmentId,
      recipient: recipient ?? null,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!created) {
    throw new Error('Failed to enqueue appointment email outbox record');
  }

  // AC-8: Log appointment ID and outbox ID only. Never log attendee email, phone, or notes.
  logger.info(
    {
      appointmentId,
      outboxId: created.id,
      kind,
    },
    'Appointment transactional email enqueued',
  );

  return created;
}
