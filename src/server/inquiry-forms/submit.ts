import 'server-only';
import { z } from 'zod';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { getPublishedFormBySlug } from './service';
import { getStudioSettings } from '@/server/settings/repo';
import { consumeRateLimit, anonymizeIp } from '@/server/auth/rate-limiter';
import { createLead } from '@/server/leads/service';
import { logger, getRequestId } from '@/server/log';
import type {
  InquiryFormFieldConfig,
  InquiryFormEventType,
} from '@/server/db/schema/inquiry-forms';
import type { LeadVerification, LeadDeliveryMode, LeadLocale } from '@/server/db/schema/leads';

// Rate limit thresholds (ADR-0015 §4 / security-baseline.md)
export const INQUIRY_IP_MAX_ATTEMPTS = 5;
export const INQUIRY_IP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export const INQUIRY_FORM_MAX_ATTEMPTS = 100;
export const INQUIRY_FORM_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export interface SubmitInquiryContext {
  slug: string;
  locale: LeadLocale;
  deliveryMode: LeadDeliveryMode;
  verification: LeadVerification;
  clientIp: string | null;
}

export type SubmitInquiryOutcome =
  | 'success'
  | 'accepted_silently'
  | 'not_found'
  | 'rate_limited'
  | 'unavailable'
  | 'validation_failed'
  | 'unverified_rejected';

export interface SubmitInquirySuccess {
  success: true;
  outcome: 'success' | 'accepted_silently';
  leadId?: string;
  redirectUrl?: string;
  code?: never;
  error?: never;
  fields?: never;
  fieldErrors?: never;
}

export interface SubmitInquiryFailure {
  success: false;
  outcome:
    'not_found' | 'rate_limited' | 'unavailable' | 'validation_failed' | 'unverified_rejected';
  code: 'NOT_FOUND' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'VALIDATION_FAILED' | 'UNVERIFIED_REJECTED';
  error: string;
  fields?: string[];
  fieldErrors?: Record<string, string>;
  leadId?: never;
  redirectUrl?: never;
}

export type SubmitInquiryResult = SubmitInquirySuccess | SubmitInquiryFailure;

/**
 * Validates whether dateStr is within [today, today + 5 years] in the studio timezone.
 */
export function validateEventDate(dateStr: string, timezone: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }

  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return false;

  const dateObj = new Date(Date.UTC(y, m - 1, d));
  if (
    dateObj.getUTCFullYear() !== y ||
    dateObj.getUTCMonth() !== m - 1 ||
    dateObj.getUTCDate() !== d
  ) {
    return false;
  }

  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const minDateStr = formatter.format(now);

    const future = new Date(now.getTime());
    future.setUTCFullYear(future.getUTCFullYear() + 5);
    const maxDateStr = formatter.format(future);

    return dateStr >= minDateStr && dateStr <= maxDateStr;
  } catch {
    const now = new Date();
    const minDateStr = now.toISOString().slice(0, 10);
    const future = new Date(now.getTime());
    future.setUTCFullYear(future.getUTCFullYear() + 5);
    const maxDateStr = future.toISOString().slice(0, 10);
    return dateStr >= minDateStr && dateStr <= maxDateStr;
  }
}

/**
 * Dynamically constructs a Zod schema from the form's field catalogue (AC-9).
 * Unknown keys are strictly rejected (.strict()).
 */
const SCHEMA_ERROR_MESSAGES = {
  en: {
    fieldRequired: 'This field is required',
    invalidEmail: 'Please enter a valid email address',
    emailNoCrlf: 'Email address cannot contain line breaks',
    invalidPhone: 'Please enter a valid phone number (3–32 characters, numbers and basic symbols)',
    invalidEventType: 'Please select a valid event type',
    invalidEventDate: 'Event date must be a valid date between today and 5 years ahead',
    invalidLocation: 'Location must not exceed 200 characters',
    messageTooLong: 'Message must not exceed 2,000 characters',
    acknowledgementRequired: 'You must acknowledge the privacy notice to submit an inquiry',
    nameTooLong: 'Field cannot exceed 100 characters',
    phoneTooLong: 'Phone number cannot exceed 32 characters',
    emailTooLong: 'Email cannot exceed 254 characters',
  },
  de: {
    fieldRequired: 'Dieses Feld ist erforderlich',
    invalidEmail: 'Bitte geben Sie eine gültige E-Mail-Adresse ein',
    emailNoCrlf: 'E-Mail-Adresse darf keine Zeilenumbrüche enthalten',
    invalidPhone:
      'Bitte geben Sie eine gültige Telefonnummer ein (3–32 Zeichen, Ziffern und Symbole)',
    invalidEventType: 'Bitte wählen Sie eine gültige Veranstaltungsart aus',
    invalidEventDate: 'Das Veranstaltungsdatum muss zwischen heute und in 5 Jahren liegen',
    invalidLocation: 'Der Veranstaltungsort darf maximal 200 Zeichen lang sein',
    messageTooLong: 'Die Nachricht darf maximal 2.000 Zeichen lang sein',
    acknowledgementRequired: 'Sie müssen die Datenschutzerklärung zur Kenntnis nehmen',
    nameTooLong: 'Feld darf maximal 100 Zeichen lang sein',
    phoneTooLong: 'Telefonnummer darf maximal 32 Zeichen lang sein',
    emailTooLong: 'E-Mail-Adresse darf maximal 254 Zeichen lang sein',
  },
} as const;

/**
 * Dynamically constructs a Zod schema from the form's field catalogue (AC-9, AC-12).
 * Unknown keys are strictly rejected (.strict()).
 * Emits error messages matching the specified locale catalogue.
 */
export function buildDynamicInquirySchema(
  fields: InquiryFormFieldConfig[],
  eventTypes: InquiryFormEventType[],
  timezone: string,
  locale = 'en',
) {
  const shape: Record<string, z.ZodTypeAny> = {};
  const msgs = locale === 'de' ? SCHEMA_ERROR_MESSAGES.de : SCHEMA_ERROR_MESSAGES.en;

  // Find enabled fields
  for (const field of fields) {
    if (!field.enabled) continue;

    switch (field.key) {
      case 'given_name':
        shape.given_name = z
          .string({ required_error: msgs.fieldRequired })
          .trim()
          .min(1, msgs.fieldRequired)
          .max(100, msgs.nameTooLong);
        break;

      case 'family_name':
        if (field.required) {
          shape.family_name = z
            .string({ required_error: msgs.fieldRequired })
            .trim()
            .min(1, msgs.fieldRequired)
            .max(100, msgs.nameTooLong);
        } else {
          shape.family_name = z.preprocess(
            (val) => (val === '' || val === null || val === undefined ? null : val),
            z.string().trim().max(100, msgs.nameTooLong).nullable().optional(),
          );
        }
        break;

      case 'email':
        shape.email = z
          .string({ required_error: msgs.fieldRequired })
          .trim()
          .min(1, msgs.fieldRequired)
          .max(254, msgs.emailTooLong)
          .email(msgs.invalidEmail)
          .refine((val) => !val.includes('\r') && !val.includes('\n'), {
            message: msgs.emailNoCrlf,
          });
        break;

      case 'phone':
        if (field.required) {
          shape.phone = z
            .string({ required_error: msgs.fieldRequired })
            .trim()
            .regex(/^[+0-9 ()\-/]{3,32}$/, msgs.invalidPhone)
            .max(32, msgs.phoneTooLong);
        } else {
          shape.phone = z.preprocess(
            (val) => (val === '' || val === null || val === undefined ? null : val),
            z
              .string()
              .trim()
              .regex(/^[+0-9 ()\-/]{3,32}$/, msgs.invalidPhone)
              .max(32, msgs.phoneTooLong)
              .nullable()
              .optional(),
          );
        }
        break;

      case 'event_type': {
        const allowedKeys = eventTypes.map((t) => t.key);
        if (field.required) {
          shape.event_type = z
            .string({ required_error: msgs.fieldRequired })
            .refine((val) => allowedKeys.includes(val), {
              message: msgs.invalidEventType,
            });
        } else {
          shape.event_type = z.preprocess(
            (val) => (val === '' || val === null || val === undefined ? null : val),
            z
              .string()
              .refine((val) => allowedKeys.includes(val), {
                message: msgs.invalidEventType,
              })
              .nullable()
              .optional(),
          );
        }
        break;
      }

      case 'event_date':
        if (field.required) {
          shape.event_date = z
            .string({ required_error: msgs.fieldRequired })
            .refine((val) => validateEventDate(val, timezone), {
              message: msgs.invalidEventDate,
            });
        } else {
          shape.event_date = z.preprocess(
            (val) => (val === '' || val === null || val === undefined ? null : val),
            z
              .string()
              .refine((val) => validateEventDate(val, timezone), {
                message: msgs.invalidEventDate,
              })
              .nullable()
              .optional(),
          );
        }
        break;

      case 'event_location':
        if (field.required) {
          shape.event_location = z
            .string({ required_error: msgs.fieldRequired })
            .trim()
            .min(1, msgs.fieldRequired)
            .max(200, msgs.invalidLocation);
        } else {
          shape.event_location = z.preprocess(
            (val) => (val === '' || val === null || val === undefined ? null : val),
            z.string().trim().max(200, msgs.invalidLocation).nullable().optional(),
          );
        }
        break;

      case 'message':
        if (field.required) {
          shape.message = z
            .string({ required_error: msgs.fieldRequired })
            .min(1, msgs.fieldRequired)
            .max(2000, msgs.messageTooLong);
        } else {
          shape.message = z.preprocess(
            (val) => (val === '' || val === null || val === undefined ? null : val),
            z.string().max(2000, msgs.messageTooLong).nullable().optional(),
          );
        }
        break;
    }
  }

  // Acknowledgement checkbox is always required
  shape.notice_acknowledged = z.preprocess(
    (val) => val === true || val === 'true' || val === 'on' || val === 1 || val === '1',
    z.literal(true, {
      errorMap: () => ({ message: msgs.acknowledgementRequired }),
    }),
  );

  return z.object(shape).strict();
}

/**
 * Shared domain service for public inquiry form submissions.
 * Handles honeypot, rate limiting, dynamic schema validation, unverified rule, and lead creation.
 */
export async function submitInquiry(
  rawInput: unknown,
  ctx: SubmitInquiryContext,
  client: DbClient = defaultDb,
): Promise<SubmitInquiryResult> {
  const startTime = Date.now();
  const requestId = getRequestId();

  // Step 1: Load published form by slug (AC-8: 404 parity for unknown, draft, archived)
  const form = await getPublishedFormBySlug(ctx.slug, client);
  if (!form) {
    return {
      success: false,
      outcome: 'not_found',
      code: 'NOT_FOUND',
      error: 'Inquiry form not found',
    };
  }

  // Normalise input object, stripping internal framework keys ($ACTION_*, etc.)
  const inputRecord: Record<string, unknown> = {};
  if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    for (const [k, v] of Object.entries(rawInput as Record<string, unknown>)) {
      if (!k.startsWith('$') && !k.startsWith('_$')) {
        inputRecord[k] = v;
      }
    }
  }

  // Step 2: Honeypot check (AC-3)
  // If field 'website' is non-empty string, return accepted_silently, persist nothing, no audit event
  const websiteValue = inputRecord.website;
  if (typeof websiteValue === 'string' && websiteValue.trim().length > 0) {
    logger.info(
      {
        request_id: requestId,
        form_id: form.id,
        outcome: 'accepted_silently',
        reason: 'honeypot',
        verification: ctx.verification,
        delivery_mode: ctx.deliveryMode,
        duration_ms: Date.now() - startTime,
      },
      'Inquiry submission accepted silently (honeypot triggered)',
    );

    return {
      success: true,
      outcome: 'accepted_silently',
      redirectUrl: `/${ctx.locale}/f/${ctx.slug}/thanks`,
    };
  }

  // Remove honeypot field from validation input so .strict() doesn't reject it
  delete inputRecord.website;

  // Support alias 'acknowledged' if provided
  if ('acknowledged' in inputRecord && !('notice_acknowledged' in inputRecord)) {
    inputRecord.notice_acknowledged = inputRecord.acknowledged;
    delete inputRecord.acknowledged;
  }

  // Step 3: Rate limits via consumeRateLimit (AC-4, AC-5, AC-6)
  const ipBucket = ctx.clientIp ? anonymizeIp(ctx.clientIp) : 'unknown';
  const ipKey = `inquiry_ip:${form.id}:${ipBucket}`;
  const formKey = `inquiry_form:${form.id}`;

  try {
    // 3a. IP bucket limit: 5 per 10 min
    const ipLimitRes = await consumeRateLimit(
      ipKey,
      INQUIRY_IP_MAX_ATTEMPTS,
      INQUIRY_IP_WINDOW_MS,
      client,
    );
    if (!ipLimitRes.allowed) {
      logger.warn(
        {
          request_id: requestId,
          form_id: form.id,
          outcome: 'rate_limited',
          reason: 'rate_limited',
          bucket: `inquiry_ip:${form.id}`,
          verification: ctx.verification,
          delivery_mode: ctx.deliveryMode,
          duration_ms: Date.now() - startTime,
        },
        'Inquiry submission rate limited (IP bucket exceeded)',
      );

      return {
        success: false,
        outcome: 'rate_limited',
        code: 'RATE_LIMITED',
        error: 'Too many attempts, please try again later',
      };
    }

    // 3b. Form breaker limit: 100 per 1 hour
    const formLimitRes = await consumeRateLimit(
      formKey,
      INQUIRY_FORM_MAX_ATTEMPTS,
      INQUIRY_FORM_WINDOW_MS,
      client,
    );
    if (!formLimitRes.allowed) {
      logger.warn(
        {
          request_id: requestId,
          form_id: form.id,
          outcome: 'rate_limited',
          reason: 'rate_limited',
          bucket: `inquiry_form:${form.id}`,
          verification: ctx.verification,
          delivery_mode: ctx.deliveryMode,
          duration_ms: Date.now() - startTime,
        },
        'Inquiry submission rate limited (form breaker exceeded)',
      );

      return {
        success: false,
        outcome: 'rate_limited',
        code: 'RATE_LIMITED',
        error: 'Too many attempts, please try again later',
      };
    }
  } catch {
    // Fail closed: catch RateLimitUnavailableError or DB error (AC-6)
    logger.error(
      {
        request_id: requestId,
        form_id: form.id,
        outcome: 'unavailable',
        reason: 'rate_limit_unavailable',
        verification: ctx.verification,
        delivery_mode: ctx.deliveryMode,
        duration_ms: Date.now() - startTime,
      },
      'Rate limit store unavailable; failing closed',
    );

    return {
      success: false,
      outcome: 'unavailable',
      code: 'UNAVAILABLE',
      error: 'Service temporarily unavailable. Please try again later.',
    };
  }

  // Step 4: Dynamic Zod schema validation (AC-9)
  let studioTimezone = 'UTC';
  try {
    const settings = await getStudioSettings(client);
    studioTimezone = settings.timezone;
  } catch {
    studioTimezone = 'UTC';
  }

  const schema = buildDynamicInquirySchema(
    form.fields,
    form.eventTypes,
    studioTimezone,
    ctx.locale,
  );
  const parsed = schema.safeParse(inputRecord);

  if (!parsed.success) {
    const fieldKeys = parsed.error.issues.map((i) =>
      i.code === 'unrecognized_keys'
        ? (i as z.ZodUnrecognizedKeysIssue).keys.join(', ')
        : String(i.path[0] ?? 'form'),
    );
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const fieldKey =
        issue.code === 'unrecognized_keys'
          ? ((issue as z.ZodUnrecognizedKeysIssue).keys[0] ?? 'unknown')
          : String(issue.path[0] ?? 'form');
      fieldErrors[fieldKey] ??= issue.message;
    }

    logger.warn(
      {
        request_id: requestId,
        form_id: form.id,
        outcome: 'validation_failed',
        reason: 'invalid',
        field_keys: fieldKeys,
        verification: ctx.verification,
        delivery_mode: ctx.deliveryMode,
        duration_ms: Date.now() - startTime,
      },
      'Inquiry submission validation failed',
    );

    return {
      success: false,
      outcome: 'validation_failed',
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues[0]?.message ?? 'Validation failed',
      fields: fieldKeys,
      fieldErrors,
    };
  }

  interface ValidatedInquiryData {
    given_name?: string | null;
    family_name?: string | null;
    email: string;
    phone?: string | null;
    event_type?: string | null;
    event_date?: string | null;
    event_location?: string | null;
    message?: string | null;
    notice_acknowledged: boolean;
  }

  const validated = parsed.data as ValidatedInquiryData;

  // Step 5: Verification check (AC-7)
  if (ctx.verification === 'unverified' && !form.acceptUnverified) {
    logger.warn(
      {
        request_id: requestId,
        form_id: form.id,
        outcome: 'unverified_rejected',
        reason: 'unverified_rejected',
        verification: ctx.verification,
        delivery_mode: ctx.deliveryMode,
        duration_ms: Date.now() - startTime,
      },
      'Inquiry submission rejected: form does not accept unverified submissions',
    );

    return {
      success: false,
      outcome: 'unverified_rejected',
      code: 'UNVERIFIED_REJECTED',
      error: 'We could not verify your submission. Please enable JavaScript and try again.',
    };
  }

  // Step 6: Create lead via createLead (AC-1)
  if (!form.currentNoticeVersionId) {
    return {
      success: false,
      outcome: 'unavailable',
      code: 'UNAVAILABLE',
      error: 'Form configuration invalid: missing notice version',
    };
  }

  const leadResult = await createLead(
    {
      formId: form.id,
      noticeVersionId: form.currentNoticeVersionId,
      noticeAcknowledgedAt: new Date(),
      locale: ctx.locale,
      verification: ctx.verification,
      deliveryMode: ctx.deliveryMode,
      givenName: validated.given_name ?? null,
      familyName: validated.family_name ?? null,
      email: validated.email,
      phone: validated.phone ?? null,
      eventTypeKey: validated.event_type ?? null,
      eventDate: validated.event_date ?? null,
      eventLocation: validated.event_location ?? null,
      message: validated.message ?? null,
      autoReplyStatus: 'not_applicable',
    },
    {
      deliveryMode: ctx.deliveryMode,
      verification: ctx.verification,
    },
    client,
  );

  if (!leadResult.success) {
    return {
      success: false,
      outcome: 'validation_failed',
      code: 'VALIDATION_FAILED',
      error: leadResult.error,
      fields: leadResult.fields,
    };
  }

  logger.info(
    {
      request_id: requestId,
      form_id: form.id,
      lead_id: leadResult.data.id,
      outcome: 'success',
      verification: ctx.verification,
      delivery_mode: ctx.deliveryMode,
      duration_ms: Date.now() - startTime,
    },
    'Inquiry submission succeeded and lead created',
  );

  return {
    success: true,
    outcome: 'success',
    leadId: leadResult.data.id,
    redirectUrl: `/${ctx.locale}/f/${ctx.slug}/thanks`,
  };
}
