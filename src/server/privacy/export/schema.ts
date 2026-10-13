import { z } from 'zod';

export const exportRequestSchema = z
  .object({
    contactId: z.string().uuid({ message: 'contactId must be a valid UUID' }).optional(),
    leadId: z.string().uuid({ message: 'leadId must be a valid UUID' }).optional(),
    format: z.enum(['json', 'html'], {
      message: 'format must be either "json" or "html"',
    }),
    locale: z.enum(['en', 'de'], {
      message: 'locale must be either "en" or "de"',
    }),
  })
  .strict()
  .refine((data) => (data.contactId !== undefined) !== (data.leadId !== undefined), {
    message: 'Exactly one of contactId or leadId must be provided',
    path: ['contactId'],
  });

export type ExportRequestInput = z.infer<typeof exportRequestSchema>;

export const dsarSubjectSchema = z
  .object({
    id: z.string().uuid(),
    display_name: z.string(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    role: z.string(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

export const dsarStudioSchema = z
  .object({
    name: z.string(),
  })
  .strict();

export const dsarClientCategorySchema = z
  .object({
    display_name: z.string(),
    kind: z.string(),
    preferred_language: z.string(),
    created_at: z.string().datetime(),
    last_activity_at: z.string().datetime(),
  })
  .strict();

export const dsarAddressCategorySchema = z
  .object({
    type: z.string(),
    street: z.string(),
    line1: z.string().optional(),
    line2: z.string().nullable().optional(),
    postal_code: z.string(),
    city: z.string(),
    state: z.string().nullable().optional(),
    country: z.string(),
    created_at: z.string().datetime().optional(),
  })
  .strict();

export const dsarTagCategorySchema = z
  .object({
    name: z.string(),
  })
  .strict();

export const dsarNoteCategorySchema = z
  .object({
    id: z.string().uuid().optional(),
    body: z.string(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

export const dsarTimelineCategorySchema = z
  .object({
    type: z.string(),
    occurred_at: z.string().datetime(),
    actor_type: z.string(),
    content: z.unknown().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const dsarConsentCategorySchema = z
  .object({
    purpose: z.string(),
    status: z.string(),
    effective_on: z.string(),
    method: z.string(),
    scope: z.string().nullable(),
    evidence_note: z.string().nullable(),
    created_at: z.string().datetime(),
  })
  .strict();

export const dsarAuditCategorySchema = z
  .object({
    action: z.string(),
    occurred_at: z.string().datetime(),
    outcome: z.string(),
  })
  .strict();

export const dsarExportSchema = z
  .object({
    schema: z.literal('ownlight.dsar.v1'),
    generated_at: z.string().datetime(),
    studio: dsarStudioSchema,
    subject: dsarSubjectSchema,
    categories: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  })
  .strict();

export type DsarExport = z.infer<typeof dsarExportSchema>;
