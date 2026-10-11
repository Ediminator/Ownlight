import { z } from 'zod';
import { CONSENT_PURPOSES, CONSENT_STATUSES, CONSENT_METHODS } from '@/server/db/schema/consents';

export const dateStringRegex = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(val: string): boolean {
  if (!dateStringRegex.test(val)) return false;
  const parts = val.split('-');
  const yearStr = parts[0];
  const monthStr = parts[1];
  const dayStr = parts[2];
  if (!yearStr || !monthStr || !dayStr) return false;
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  if (month < 1 || month > 12) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function getTodayDateString(timezone = 'UTC', now = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(now);
  } catch {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(now);
  }
}

export const recordConsentInputSchema = z
  .object({
    clientId: z.string().uuid({ message: 'clientId must be a valid UUID.' }),
    contactId: z.string().uuid({ message: 'contactId must be a valid UUID.' }),
    purpose: z.enum(CONSENT_PURPOSES, {
      errorMap: () => ({ message: 'purpose must be marketing or image_usage.' }),
    }),
    status: z.enum(CONSENT_STATUSES, {
      errorMap: () => ({ message: 'status must be granted or withdrawn.' }),
    }),
    effectiveOn: z.string().refine(isValidIsoDate, {
      message: 'effectiveOn must be a valid date in YYYY-MM-DD format.',
    }),
    method: z.enum(CONSENT_METHODS, {
      errorMap: () => ({ message: 'method must be a recognized consent method.' }),
    }),
    scope: z
      .string()
      .max(500, { message: 'scope must not exceed 500 characters.' })
      .optional()
      .nullable(),
    evidenceNote: z
      .string()
      .max(500, { message: 'evidenceNote must not exceed 500 characters.' })
      .optional()
      .nullable(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // AC-4: scope is required (1 to 500 characters) for image_usage grants
    if (data.purpose === 'image_usage' && data.status === 'granted') {
      const trimmed = (data.scope ?? '').trim();
      if (trimmed.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scope'],
          message: 'scope is required for image_usage grants.',
        });
      }
    }
  });

export type RecordConsentInput = z.infer<typeof recordConsentInputSchema>;

export const listConsentsInputSchema = z
  .object({
    clientId: z.string().uuid({ message: 'clientId must be a valid UUID.' }),
  })
  .strict();

export type ListConsentsInput = z.infer<typeof listConsentsInputSchema>;
