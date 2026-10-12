import { z } from 'zod';
import enMessages from '../../../messages/en.json';
import deMessages from '../../../messages/de.json';
import type {
  InquiryFormFieldConfig,
  InquiryFormEventType,
} from '@/server/db/schema/inquiry-forms';

export const FIXED_FIELD_KEYS = [
  'given_name',
  'email',
  'family_name',
  'phone',
  'event_type',
  'event_date',
  'event_location',
  'message',
] as const;

export type FixedFieldKey = (typeof FIXED_FIELD_KEYS)[number];

export const MANDATORY_FIELD_KEYS = ['given_name', 'email'] as const;

export const DEFAULT_FORM_FIELDS: InquiryFormFieldConfig[] = [
  { key: 'given_name', enabled: true, required: true, order: 0 },
  { key: 'family_name', enabled: true, required: false, order: 1 },
  { key: 'email', enabled: true, required: true, order: 2 },
  { key: 'phone', enabled: true, required: false, order: 3 },
  { key: 'event_type', enabled: false, required: false, order: 4 },
  { key: 'event_date', enabled: false, required: false, order: 5 },
  { key: 'event_location', enabled: false, required: false, order: 6 },
  { key: 'message', enabled: true, required: false, order: 7 },
];

export const DEFAULT_ACKNOWLEDGEMENT_TEXT_EN: string =
  enMessages.inquiryForms.defaultAcknowledgement;

export const DEFAULT_ACKNOWLEDGEMENT_TEXT_DE: string =
  deMessages.inquiryForms.defaultAcknowledgement;

export const EVENT_TYPE_KEY_REGEX = /^[a-z0-9-]{1,40}$/;

/**
 * Validates individual field entry.
 */
export const inquiryFormFieldConfigSchema = z
  .object({
    key: z.string().min(1),
    enabled: z.boolean(),
    required: z.boolean(),
    order: z.number().int().min(0).default(0),
  })
  .strict();

/**
 * Validates array of form fields against fixed catalogue rules (AC-2).
 */
export function validateFormFields(
  fields: unknown,
):
  | { success: true; data: InquiryFormFieldConfig[] }
  | { success: false; error: string; field: string } {
  if (!Array.isArray(fields)) {
    return { success: false, error: 'Fields must be an array', field: 'fields' };
  }

  const seenKeys = new Set<string>();
  const parsedFields: InquiryFormFieldConfig[] = [];

  for (const raw of fields) {
    const parsed = inquiryFormFieldConfigSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: 'Invalid field configuration',
        field: 'fields',
      };
    }

    const { key, enabled, required, order } = parsed.data;

    // 1. Unknown key check
    if (!FIXED_FIELD_KEYS.includes(key as FixedFieldKey)) {
      return {
        success: false,
        error: `Unknown field key "${key}" is not in the fixed catalogue`,
        field: key,
      };
    }

    // 2. Duplicate key check
    if (seenKeys.has(key)) {
      return {
        success: false,
        error: `Duplicate field key "${key}" in configuration`,
        field: key,
      };
    }
    seenKeys.add(key);

    // 3. Mandatory field check: email and given_name must be enabled and required
    if (key === 'email' || key === 'given_name') {
      if (!enabled) {
        return {
          success: false,
          error: `Field "${key}" cannot be disabled`,
          field: key,
        };
      }
      if (!required) {
        return {
          success: false,
          error: `Field "${key}" cannot be made optional`,
          field: key,
        };
      }
    }

    parsedFields.push({ key, enabled, required, order });
  }

  // 4. Ensure mandatory fields are present in the configuration
  for (const mandatory of MANDATORY_FIELD_KEYS) {
    if (!seenKeys.has(mandatory)) {
      return {
        success: false,
        error: `Mandatory field "${mandatory}" must be present in fields configuration`,
        field: mandatory,
      };
    }
  }

  return { success: true, data: parsedFields };
}

/**
 * Validates single event type entry.
 */
export const inquiryFormEventTypeSchema = z
  .object({
    key: z.string().regex(EVENT_TYPE_KEY_REGEX, 'Event type key must match /^[a-z0-9-]{1,40}$/'),
    label_en: z
      .string()
      .min(1, 'English label must be 1–60 characters')
      .max(60, 'English label cannot exceed 60 characters'),
    label_de: z
      .string()
      .min(1, 'German label must be 1–60 characters')
      .max(60, 'German label cannot exceed 60 characters'),
  })
  .strict();

/**
 * Validates array of event types (AC-3).
 */
export function validateEventTypes(
  eventTypes: unknown,
  eventTypeFieldEnabled = false,
):
  | { success: true; data: InquiryFormEventType[] }
  | { success: false; error: string; field?: string } {
  if (!Array.isArray(eventTypes)) {
    return { success: false, error: 'Event types must be an array', field: 'event_types' };
  }

  if (eventTypes.length > 20) {
    return { success: false, error: 'Cannot have more than 20 event types', field: 'event_types' };
  }

  if (eventTypeFieldEnabled && eventTypes.length === 0) {
    return {
      success: false,
      error: 'When event_type field is enabled, at least one event type is required',
      field: 'event_types',
    };
  }

  const seenKeys = new Set<string>();
  const parsedTypes: InquiryFormEventType[] = [];

  for (const raw of eventTypes) {
    const parsed = inquiryFormEventTypeSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const issueMsg = issue?.message ?? 'Invalid event type';
      return { success: false, error: issueMsg, field: 'event_types' };
    }

    const { key, label_en, label_de } = parsed.data;
    if (seenKeys.has(key)) {
      return { success: false, error: `Duplicate event type key "${key}"`, field: 'event_types' };
    }
    seenKeys.add(key);
    parsedTypes.push({ key, label_en, label_de });
  }

  return { success: true, data: parsedTypes };
}

/**
 * Validates notice version text and policy URL (AC-6).
 */
export const noticeVersionInputSchema = z
  .object({
    acknowledgement_text_en: z
      .string()
      .min(1, 'English acknowledgement text must be 1–500 characters')
      .max(500, 'English acknowledgement text cannot exceed 500 characters')
      .refine((text) => !text.includes('<') && !text.includes('>'), {
        message: 'Notice text must be plain text without HTML tags (< or >)',
      }),
    acknowledgement_text_de: z
      .string()
      .min(1, 'German acknowledgement text must be 1–500 characters')
      .max(500, 'German acknowledgement text cannot exceed 500 characters')
      .refine((text) => !text.includes('<') && !text.includes('>'), {
        message: 'Notice text must be plain text without HTML tags (< or >)',
      }),
    privacy_policy_url: z
      .string()
      .min(1, 'Privacy policy URL is required')
      .max(2048, 'Privacy policy URL cannot exceed 2048 characters')
      .refine(
        (url) => {
          if (!url.startsWith('https://')) return false;
          try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:';
          } catch {
            return false;
          }
        },
        {
          message: 'Privacy policy URL must be an absolute https:// URL',
        },
      ),
  })
  .strict();

export type NoticeVersionInput = z.infer<typeof noticeVersionInputSchema>;

/**
 * Validates success_redirect_url format.
 */
export const successRedirectUrlSchema = z
  .string()
  .max(2048)
  .refine(
    (url) => {
      if (!url.startsWith('https://')) return false;
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    {
      message: 'Success redirect URL must be an absolute https:// URL',
    },
  )
  .nullable()
  .optional();

export const createInquiryFormActionInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Form name is required')
      .max(100, 'Form name cannot exceed 100 characters'),
    default_locale: z.enum(['en', 'de']).optional(),
  })
  .strict();

export type CreateInquiryFormActionInput = z.infer<typeof createInquiryFormActionInputSchema>;

export const updateInquiryFormActionInputSchema = z
  .object({
    id: z.string().min(1, 'Form ID is required'),
    name: z
      .string()
      .trim()
      .min(1, 'Form name must be between 1 and 100 characters')
      .max(100, 'Form name cannot exceed 100 characters')
      .optional(),
    default_locale: z.enum(['en', 'de']).optional(),
    fields: z.array(inquiryFormFieldConfigSchema).optional(),
    event_types: z.array(inquiryFormEventTypeSchema).optional(),
    auto_reply_enabled: z.boolean().optional(),
    accept_unverified: z.boolean().optional(),
    success_redirect_url: successRedirectUrlSchema,
  })
  .strict();

export type UpdateInquiryFormActionInput = z.infer<typeof updateInquiryFormActionInputSchema>;

export const createNoticeVersionActionInputSchema = z
  .object({
    formId: z.string().min(1, 'Form ID is required'),
    acknowledgement_text_en: z
      .string()
      .min(1, 'English acknowledgement text must be 1–500 characters')
      .max(500, 'English acknowledgement text cannot exceed 500 characters')
      .refine((text) => !text.includes('<') && !text.includes('>'), {
        message: 'Notice text must be plain text without HTML tags (< or >)',
      })
      .optional(),
    acknowledgement_text_de: z
      .string()
      .min(1, 'German acknowledgement text must be 1–500 characters')
      .max(500, 'German acknowledgement text cannot exceed 500 characters')
      .refine((text) => !text.includes('<') && !text.includes('>'), {
        message: 'Notice text must be plain text without HTML tags (< or >)',
      })
      .optional(),
    privacy_policy_url: z
      .string()
      .min(1, 'Privacy policy URL is required')
      .max(2048, 'Privacy policy URL cannot exceed 2048 characters')
      .refine(
        (url) => {
          if (!url.startsWith('https://')) return false;
          try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:';
          } catch {
            return false;
          }
        },
        {
          message: 'Privacy policy URL must be an absolute https:// URL',
        },
      ),
  })
  .strict();

export type CreateNoticeVersionActionInput = z.infer<typeof createNoticeVersionActionInputSchema>;

export const publishInquiryFormActionInputSchema = z
  .object({
    id: z.string().min(1, 'Form ID is required'),
  })
  .strict();

export type PublishInquiryFormActionInput = z.infer<typeof publishInquiryFormActionInputSchema>;

export const unpublishInquiryFormActionInputSchema = z
  .object({
    id: z.string().min(1, 'Form ID is required'),
  })
  .strict();

export type UnpublishInquiryFormActionInput = z.infer<typeof unpublishInquiryFormActionInputSchema>;

export const archiveInquiryFormActionInputSchema = z
  .object({
    id: z.string().min(1, 'Form ID is required'),
  })
  .strict();

export type ArchiveInquiryFormActionInput = z.infer<typeof archiveInquiryFormActionInputSchema>;
