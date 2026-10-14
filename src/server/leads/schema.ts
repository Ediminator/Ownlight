import { z } from 'zod';
import {
  LEAD_STATUSES,
  LEAD_VERIFICATIONS,
  LEAD_DELIVERY_MODES,
  LEAD_LOCALES,
  LEAD_AUTO_REPLY_STATUSES,
} from '@/server/db/schema/leads';

export const createLeadInputSchema = z
  .object({
    formId: z.string().uuid({ message: 'formId must be a valid UUID' }),
    noticeVersionId: z.string().uuid({ message: 'noticeVersionId must be a valid UUID' }),
    noticeAcknowledgedAt: z.coerce.date().optional(),
    locale: z.enum(LEAD_LOCALES),
    verification: z.enum(LEAD_VERIFICATIONS).default('unverified'),
    deliveryMode: z.enum(LEAD_DELIVERY_MODES).default('hosted'),
    givenName: z.string().trim().min(1).max(100).nullable().optional(),
    familyName: z.string().trim().max(100).nullable().optional(),
    email: z
      .string()
      .trim()
      .email({ message: 'Invalid email address' })
      .max(255)
      .nullable()
      .optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    eventTypeKey: z.string().trim().max(40).nullable().optional(),
    eventDate: z.string().trim().max(100).nullable().optional(),
    eventLocation: z.string().trim().max(200).nullable().optional(),
    message: z
      .string()
      .max(2000, { message: 'Message must not exceed 2000 characters' })
      .nullable()
      .optional(),
    autoReplyStatus: z.enum(LEAD_AUTO_REPLY_STATUSES).default('not_applicable'),
  })
  .refine((data) => Boolean(data.givenName && data.email), {
    message: 'New leads must provide both given_name and email',
    path: ['givenName'],
  });

export type CreateLeadInput = z.input<typeof createLeadInputSchema>;
export type CreateLeadParsed = z.output<typeof createLeadInputSchema>;

export const listLeadsQuerySchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  verification: z.enum(LEAD_VERIFICATIONS).optional(),
  emailQuery: z.string().trim().max(255).optional(),
  cursor: z
    .object({
      receivedAt: z.union([z.string(), z.date()]),
      id: z.string().uuid(),
    })
    .optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListLeadsQuery = z.input<typeof listLeadsQuerySchema>;
export type ListLeadsParsed = z.output<typeof listLeadsQuerySchema>;

export const changeLeadStatusActionInputSchema = z.object({
  leadId: z.string().uuid({ message: 'leadId must be a valid UUID' }),
  targetStatus: z.enum(LEAD_STATUSES),
});

export type ChangeLeadStatusActionInput = z.infer<typeof changeLeadStatusActionInputSchema>;

export const deleteLeadsActionInputSchema = z.object({
  leadIds: z
    .array(z.string().uuid({ message: 'leadId must be a valid UUID' }))
    .optional()
    .default([]),
  deleteAllSpam: z.boolean().optional().default(false),
});

export type DeleteLeadsActionInput = z.infer<typeof deleteLeadsActionInputSchema>;

export const exportLeadDsarActionInputSchema = z.object({
  leadId: z.string().uuid({ message: 'leadId must be a valid UUID' }),
  format: z.enum(['json', 'html']).optional().default('json'),
});

export type ExportLeadDsarActionInput = z.infer<typeof exportLeadDsarActionInputSchema>;

export const convertLeadToClientActionInputSchema = z
  .object({
    leadId: z.string().uuid({ message: 'leadId must be a valid UUID' }),
    mode: z.enum(['new_client', 'existing_client']),
    existingClientId: z
      .string()
      .uuid({ message: 'existingClientId must be a valid UUID' })
      .optional()
      .nullable(),
  })
  .refine(
    (data) => {
      if (data.mode === 'existing_client') {
        return Boolean(data.existingClientId);
      }
      return true;
    },
    {
      message: 'existingClientId is required when mode is existing_client',
      path: ['existingClientId'],
    },
  );

export type ConvertLeadToClientActionInput = z.infer<typeof convertLeadToClientActionInputSchema>;

export const getLeadDuplicatesActionInputSchema = z.object({
  leadId: z.string().uuid({ message: 'leadId must be a valid UUID' }),
});

export type GetLeadDuplicatesActionInput = z.infer<typeof getLeadDuplicatesActionInputSchema>;

export interface LeadCounts {
  all: number;
  new: number;
  contacted: number;
  converted: number;
  archived: number;
  spam: number;
}
