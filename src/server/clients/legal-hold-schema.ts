import { z } from 'zod';
import { CLIENT_LEGAL_HOLD_REASONS } from '@/server/db/schema/client-legal-holds';

export const setLegalHoldInputSchema = z
  .object({
    clientId: z.string().uuid({ message: 'clientId must be a valid UUID' }),
    reason: z.enum(CLIENT_LEGAL_HOLD_REASONS, {
      errorMap: () => ({ message: 'Invalid or missing reason' }),
    }),
    note: z
      .string()
      .trim()
      .max(500, { message: 'note must be at most 500 characters' })
      .optional()
      .nullable()
      .transform((val) => (val && val.length > 0 ? val : null)),
    until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'until must be a valid date in YYYY-MM-DD format' })
      .optional()
      .nullable(),
  })
  .strict();

export type SetLegalHoldInput = z.input<typeof setLegalHoldInputSchema>;
export type SetLegalHoldOutput = z.output<typeof setLegalHoldInputSchema>;

export const releaseLegalHoldInputSchema = z
  .object({
    clientId: z.string().uuid({ message: 'clientId must be a valid UUID' }),
  })
  .strict();

export type ReleaseLegalHoldInput = z.input<typeof releaseLegalHoldInputSchema>;
