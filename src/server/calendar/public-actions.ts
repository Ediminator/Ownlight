'use server';

import 'server-only';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, and, lt, gt, or, isNull } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { resolveClientIp } from '@/server/http/client-ip';
import { consumeBookingRateLimit, consumeRateLimit, anonymizeIp } from '@/server/auth/rate-limiter';
import {
  getOrCreatePowSecret,
  verifyPowPayload,
  createFormChallenge,
  POW_MAX_NUMBER,
} from '@/server/inquiry-forms/pow';
import { generateUuidV7 } from '@/lib/id';
import { audit } from '@/server/audit';
import { recordTimelineEvent } from '@/server/timeline/service';
import { enqueueAppointmentEmail } from '@/server/email/outbox';
import { getStudioSettings } from '@/server/settings/repo';
import { findDuplicateEmails } from '@/server/clients/repo';
import { calculateAvailableSlots, type AvailableSlot } from './availability';
import { findBookingTypeBySlug } from './repo';
import {
  publicBookingSubmissionSchema,
  getPublicAvailableSlotsSchema,
  type PublicBookingSubmissionInput,
} from './schema';
import {
  appointments,
  blockedTime,
  calendarSyncOutbox,
  type BookingType,
} from '@/server/db/schema/calendar';
import { shoots } from '@/server/db/schema/projects';
import { leads } from '@/server/db/schema/leads';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';

export interface PublicBookingActionResult<T = unknown> {
  success: boolean;
  data?: T;
  code?: string;
  error?: string;
  fields?: string[];
  fieldErrors?: Record<string, string>;
  collision?: boolean;
}

export interface ConfirmedBookingSummary {
  appointmentId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  locationType: string;
  locationDetails: string | null;
  meetUrl: string | null;
  attendeeName: string;
  attendeeEmail: string;
  bookingTypeTitle: string;
  durationMinutes: number;
}

function safeRevalidate(path: string): void {
  try {
    revalidatePath(path);
  } catch {
    // Outside Next.js request context (tests)
  }
}

/**
 * Retrieves an existing inquiry form or seeds a default booking scheduler form
 * to satisfy the foreign key and notice version constraints on the leads table.
 */
async function getOrCreateBookingInquiryForm(
  tx: DbClient = defaultDb,
): Promise<{ formId: string; noticeVersionId: string }> {
  // 1. Look for any published inquiry form with an active notice version
  const published = await tx
    .select({
      id: inquiryForms.id,
      noticeVersionId: inquiryForms.currentNoticeVersionId,
    })
    .from(inquiryForms)
    .where(eq(inquiryForms.status, 'published'))
    .limit(1);

  if (published[0]?.id && published[0].noticeVersionId) {
    return {
      formId: published[0].id,
      noticeVersionId: published[0].noticeVersionId,
    };
  }

  // 2. Otherwise seed an idempotent booking scheduler form record
  const formId = generateUuidV7();
  const noticeId = generateUuidV7();
  const now = new Date();

  await tx.insert(inquiryForms).values({
    id: formId,
    slug: 'booking-sched',
    name: 'Booking Scheduler',
    status: 'published',
    defaultLocale: 'en',
    fields: [
      { key: 'given_name', enabled: true, required: true, order: 0 },
      { key: 'email', enabled: true, required: true, order: 1 },
      { key: 'phone', enabled: true, required: false, order: 2 },
      { key: 'message', enabled: true, required: false, order: 3 },
    ],
    eventTypes: [
      { key: 'booking_scheduler', label_en: 'Booking Scheduler', label_de: 'Buchungskalender' },
    ],
    currentNoticeVersionId: null,
    autoReplyEnabled: false,
    acceptUnverified: false,
    createdAt: now,
    updatedAt: now,
  });

  await tx.insert(inquiryFormNoticeVersions).values({
    id: noticeId,
    formId,
    version: 1,
    acknowledgementTextEn: 'I acknowledge the privacy notice for scheduling consultations.',
    acknowledgementTextDe: 'Ich nehme die Datenschutzerklärung zur Terminbuchung zur Kenntnis.',
    privacyPolicyUrl: '/privacy',
    createdByActorId: 'system',
    createdAt: now,
  });

  await tx
    .update(inquiryForms)
    .set({ currentNoticeVersionId: noticeId })
    .where(eq(inquiryForms.id, formId));

  return { formId, noticeVersionId: noticeId };
}

/**
 * Public server action for querying available slots for an active booking type (AC-1, AC-2).
 * Unauthenticated and rate-limited.
 */
export async function getPublicAvailableSlotsAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<
  PublicBookingActionResult<{
    slots: AvailableSlot[];
    bookingType: BookingType;
    studioTimezone: string;
  }>
> {
  const parsed = getPublicAvailableSlotsSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues[0]?.message ?? 'Invalid slots query input',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  const { slug, startDate, endDate, timezone } = parsed.data;

  const bookingType = await findBookingTypeBySlug(slug, client);
  if (!bookingType?.isActive) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Booking type not found or currently closed',
    };
  }

  let studioTimezone = 'Europe/Berlin';
  try {
    const settings = await getStudioSettings(client);
    if (settings.timezone) {
      studioTimezone = settings.timezone;
    }
  } catch {
    studioTimezone = 'Europe/Berlin';
  }

  const slots = await calculateAvailableSlots({
    bookingTypeId: bookingType.id,
    startDate,
    endDate,
    timezone,
    db: client,
    studioTimezone,
  });

  return {
    success: true,
    data: {
      slots,
      bookingType,
      studioTimezone,
    },
  };
}

/**
 * Public server action to fetch an ALTCHA PoW challenge for the public booking page.
 */
export async function getPublicBookingChallengeAction(
  slug: string,
  client: DbClient = defaultDb,
): Promise<PublicBookingActionResult<import('@/server/inquiry-forms/pow').FormChallenge>> {
  let clientIp: string | null = null;
  try {
    const reqHeaders = await headers();
    clientIp = resolveClientIp(reqHeaders);
  } catch {
    clientIp = null;
  }

  const ipBucket = clientIp ? anonymizeIp(clientIp) : 'unknown';
  const rateLimitKey = `challenge_ip:${ipBucket}`;

  const limitResult = await consumeRateLimit(rateLimitKey, 30, 10 * 60 * 1000, client);
  if (!limitResult.allowed) {
    return {
      success: false,
      code: 'RATE_LIMITED',
      error: 'Too many challenge requests. Please try again later.',
    };
  }

  const secret = await getOrCreatePowSecret(client);
  const challenge = await createFormChallenge(secret, {
    maxnumber: POW_MAX_NUMBER,
  });

  return {
    success: true,
    data: challenge,
  };
}

/**
 * Normalizes input from either a FormData object, plain JavaScript object, or action prevState.
 */
function normalizeBookingInput(
  rawInputOrPrevState: unknown,
  formDataOrClient?: unknown,
): { rawInput: Record<string, unknown>; isFormData: boolean } {
  if (rawInputOrPrevState instanceof FormData) {
    const raw: Record<string, unknown> = {};
    for (const [key, value] of rawInputOrPrevState.entries()) {
      if (!key.startsWith('$') && !key.startsWith('_$') && typeof value === 'string') {
        raw[key] = value;
      }
    }
    return { rawInput: raw, isFormData: true };
  }

  if (formDataOrClient instanceof FormData) {
    const raw: Record<string, unknown> = {};
    for (const [key, value] of formDataOrClient.entries()) {
      if (!key.startsWith('$') && !key.startsWith('_$') && typeof value === 'string') {
        raw[key] = value;
      }
    }
    return { rawInput: raw, isFormData: true };
  }

  if (typeof rawInputOrPrevState === 'object' && rawInputOrPrevState !== null) {
    return {
      rawInput: { ...(rawInputOrPrevState as Record<string, unknown>) },
      isFormData: false,
    };
  }

  return { rawInput: {}, isFormData: false };
}

/**
 * Public server action for reserving an appointment slot (AC-3, AC-4, AC-5, AC-6, AC-7, AC-8).
 * Executes inside a PostgreSQL serializable transaction to prevent concurrent race conditions.
 */
export async function submitPublicBookingAction(
  rawInputOrPrevState: unknown,
  formDataOrClient?: unknown,
  maybeClient?: DbClient,
): Promise<PublicBookingActionResult<ConfirmedBookingSummary>> {
  let client: DbClient = defaultDb;
  if (maybeClient) {
    client = maybeClient;
  } else if (
    formDataOrClient &&
    typeof formDataOrClient === 'object' &&
    !(formDataOrClient instanceof FormData)
  ) {
    client = formDataOrClient as DbClient;
  }

  const { rawInput } = normalizeBookingInput(rawInputOrPrevState, formDataOrClient);

  // 1. Resolve client IP and enforce IP rate limiting (AC-8)
  let clientIp: string | null = null;
  try {
    const reqHeaders = await headers();
    clientIp = resolveClientIp(reqHeaders);
  } catch {
    clientIp = null;
  }

  if (clientIp) {
    const rateLimit = await consumeBookingRateLimit(clientIp, client);
    if (!rateLimit.allowed) {
      const isGerman = rawInput.locale === 'de';
      return {
        success: false,
        code: 'RATE_LIMITED',
        error: isGerman
          ? 'Zu viele Buchungsversuche. Bitte versuchen Sie es in 15 Minuten erneut.'
          : 'Too many booking attempts. Please try again in 15 minutes.',
      };
    }
  }

  // 2. Honeypot check (AC-7)
  const honeypotVal = rawInput.website_url;
  if (typeof honeypotVal === 'string' && honeypotVal.trim().length > 0) {
    return {
      success: false,
      code: 'BOT_DETECTED',
      error: 'Submission rejected',
    };
  }

  // 3. Validate input schema with Zod
  const parsed = publicBookingSubmissionSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const fieldKey = String(issue.path[0] ?? 'form');
      fieldErrors[fieldKey] ??= issue.message;
    }
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues[0]?.message ?? 'Validation failed',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
      fieldErrors,
    };
  }

  const input: PublicBookingSubmissionInput = parsed.data;
  const isGerman = input.locale === 'de';

  // 4. Verify ALTCHA Proof-of-Work challenge (AC-7)
  const powSecret = await getOrCreatePowSecret(client);
  const powVerification = await verifyPowPayload(input.altcha_payload, powSecret, client);
  if (!powVerification.verified) {
    return {
      success: false,
      code: 'POW_INVALID',
      error: isGerman
        ? 'Sicherheitsüberprüfung fehlgeschlagen. Bitte aktualisieren und erneut versuchen.'
        : 'Security check failed. Please refresh and try again.',
    };
  }

  // 5. Execute atomic serializable transaction (AC-3, AC-4, AC-5, AC-6)
  try {
    const result = await client.transaction(
      async (tx) => {
        // Step 5a: Fetch booking type
        const bookingType = await findBookingTypeBySlug(input.slug, tx);
        if (!bookingType?.isActive) {
          return {
            success: false,
            code: 'NOT_FOUND',
            error: isGerman
              ? 'Dieser Termin ist derzeit geschlossen.'
              : 'This booking type is currently closed.',
          } as const;
        }

        // Step 5b: Re-query slot availability and detect concurrent double-booking (AC-6)
        const startsAt = new Date(input.startsAt);
        const endsAt = new Date(input.endsAt);

        const bufferBeforeMs = bookingType.bufferBeforeMinutes * 60 * 1000;
        const bufferAfterMs = bookingType.bufferAfterMinutes * 60 * 1000;

        const protectedStart = new Date(startsAt.getTime() - bufferBeforeMs);
        const protectedEnd = new Date(endsAt.getTime() + bufferAfterMs);

        // Check active appointments
        const collidingAppointments = await tx
          .select({ id: appointments.id })
          .from(appointments)
          .where(
            and(
              eq(appointments.status, 'scheduled'),
              lt(appointments.startsAt, protectedEnd),
              gt(appointments.endsAt, protectedStart),
            ),
          )
          .limit(1);

        if (collidingAppointments.length > 0) {
          return {
            success: false,
            code: 'COLLISION',
            collision: true,
            error: isGerman
              ? 'Dieser Termin wurde gerade von einem anderen Kunden gebucht. Bitte wählen Sie einen anderen Termin.'
              : 'This time slot was just booked by another client. Please select another time.',
          } as const;
        }

        // Check blocked time
        const collidingBlocked = await tx
          .select({ id: blockedTime.id })
          .from(blockedTime)
          .where(
            and(lt(blockedTime.startsAt, protectedEnd), gt(blockedTime.endsAt, protectedStart)),
          )
          .limit(1);

        if (collidingBlocked.length > 0) {
          return {
            success: false,
            code: 'COLLISION',
            collision: true,
            error: isGerman
              ? 'Dieser Termin wurde gerade von einem anderen Kunden gebucht. Bitte wählen Sie einen anderen Termin.'
              : 'This time slot was just booked by another client. Please select another time.',
          } as const;
        }

        // Check shoots
        const collidingShoots = await tx
          .select({ id: shoots.id, startsAt: shoots.startsAt, endsAt: shoots.endsAt })
          .from(shoots)
          .where(
            and(
              lt(shoots.startsAt, protectedEnd),
              or(isNull(shoots.endsAt), gt(shoots.endsAt, protectedStart)),
            ),
          )
          .limit(1);

        if (collidingShoots.length > 0) {
          return {
            success: false,
            code: 'COLLISION',
            collision: true,
            error: isGerman
              ? 'Dieser Termin wurde gerade von einem anderen Kunden gebucht. Bitte wählen Sie einen anderen Termin.'
              : 'This time slot was just booked by another client. Please select another time.',
          } as const;
        }

        // Step 5c: Smart Lead/Client Association (Decision D4, AC-4, AC-5)
        const normalizedEmail = input.attendeeEmail.trim().toLowerCase();
        let clientId: string | null = null;
        let leadId: string | null = null;

        // 1. Check if attendee email matches an existing client (AC-4)
        const clientMatches = await findDuplicateEmails(normalizedEmail, null, tx);
        if (clientMatches.length > 0 && clientMatches[0]?.clientId) {
          clientId = clientMatches[0].clientId;
        } else {
          // 2. Check if matches existing lead
          const existingLeads = await tx
            .select({ id: leads.id })
            .from(leads)
            .where(eq(leads.emailNormalized, normalizedEmail))
            .limit(1);

          if (existingLeads.length > 0 && existingLeads[0]?.id) {
            leadId = existingLeads[0].id;
          } else {
            // 3. Create new lead in 'new' state with 'verified' badge and 'booking_scheduler' event type (AC-5)
            const { formId, noticeVersionId } = await getOrCreateBookingInquiryForm(tx);

            const nameParts = input.attendeeName.trim().split(/\s+/);
            const givenName = nameParts[0] ?? input.attendeeName.trim();
            const familyName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

            const [createdLead] = await tx
              .insert(leads)
              .values({
                id: generateUuidV7(),
                formId,
                noticeVersionId,
                noticeAcknowledgedAt: new Date(),
                status: 'new',
                verification: 'verified',
                deliveryMode: 'hosted',
                locale: input.locale,
                givenName,
                familyName,
                email: input.attendeeEmail.trim(),
                emailNormalized: normalizedEmail,
                phone: input.attendeePhone?.trim() ?? null,
                eventTypeKey: 'booking_scheduler',
                message: input.attendeeNotes?.trim() ?? null,
                autoReplyStatus: 'not_applicable',
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning({ id: leads.id });

            if (createdLead?.id) {
              leadId = createdLead.id;
            }
          }
        }

        // Step 5d: Insert appointment in 'scheduled' status (AC-3)
        const appointmentId = generateUuidV7();
        const now = new Date();

        await tx.insert(appointments).values({
          id: appointmentId,
          bookingTypeId: bookingType.id,
          clientId,
          leadId,
          title: `${bookingType.title}: ${input.attendeeName}`,
          status: 'scheduled',
          startsAt,
          endsAt,
          timezone: input.timezone,
          attendeeName: input.attendeeName,
          attendeeEmail: input.attendeeEmail,
          attendeePhone: input.attendeePhone?.trim() ?? null,
          attendeeNotes: input.attendeeNotes?.trim() ?? null,
          locationType: bookingType.locationType,
          locationDetails: bookingType.locationDetails ?? null,
          meetUrl: null,
          createdAt: now,
          updatedAt: now,
        });

        // Step 5e: If linked to client, emit appointment.scheduled on client timeline (AC-4)
        if (clientId) {
          await recordTimelineEvent(tx, {
            clientId,
            type: 'appointment.scheduled',
            occurredAt: now,
            actorType: 'system',
            actorId: 'public-booking',
            subjectType: 'appointment',
            subjectId: appointmentId,
            data: {
              appointment_id: appointmentId,
              starts_at: startsAt.toISOString(),
              location_type: bookingType.locationType,
            },
          });
        }

        // Step 5f: Enqueue confirmation email in email_outbox (AC-3)
        await enqueueAppointmentEmail({
          appointmentId,
          kind: 'appointment_confirmation',
          recipient: input.attendeeEmail,
          tx,
        });

        // Step 5g: Enqueue outbound sync task in calendar_sync_outbox (AC-3)
        await tx.insert(calendarSyncOutbox).values({
          id: generateUuidV7(),
          entityType: 'appointment',
          entityId: appointmentId,
          action: 'create',
          status: 'PENDING',
          attempts: 0,
          maxAttempts: 5,
          nextAttemptAt: now,
          createdAt: now,
          updatedAt: now,
        });

        // Step 5h: Emit appointment.created audit log event (AC-3)
        await audit(
          {
            action: 'appointment.created',
            actorType: 'system',
            actorId: 'public-booking',
            targetType: 'appointment',
            targetId: appointmentId,
            outcome: 'success',
            metadata: {
              appointment_id: appointmentId,
              booking_type_id: bookingType.id,
              starts_at: startsAt.toISOString(),
              location_type: bookingType.locationType,
              client_id: clientId,
              lead_id: leadId,
            },
          },
          tx,
        );

        return {
          success: true,
          data: {
            appointmentId,
            title: `${bookingType.title}: ${input.attendeeName}`,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            timezone: input.timezone,
            locationType: bookingType.locationType,
            locationDetails: bookingType.locationDetails ?? null,
            meetUrl: null,
            attendeeName: input.attendeeName,
            attendeeEmail: input.attendeeEmail,
            bookingTypeTitle: bookingType.title,
            durationMinutes: bookingType.durationMinutes,
          },
        } as const;
      },
      { isolationLevel: 'serializable' },
    );

    if (result.success) {
      safeRevalidate(`/book/${input.slug}`);
      safeRevalidate('/calendar');
    }

    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Detect PostgreSQL serialization failure (40001) or concurrency deadlock (AC-6)
    if (
      message.includes('40001') ||
      message.includes('could not serialize') ||
      message.includes('deadlock')
    ) {
      return {
        success: false,
        code: 'COLLISION',
        collision: true,
        error: isGerman
          ? 'Dieser Termin wurde gerade von einem anderen Kunden gebucht. Bitte wählen Sie einen anderen Termin.'
          : 'This time slot was just booked by another client. Please select another time.',
      };
    }

    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: isGerman
        ? 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.'
        : 'An error occurred while booking. Please try again.',
    };
  }
}
