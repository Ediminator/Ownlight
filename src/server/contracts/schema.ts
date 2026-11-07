import { z } from 'zod';
import {
  CONTRACT_STATUSES,
  CONTRACT_SIGNATURE_TYPES,
  type ContractStatus,
  type ContractSignatureType,
} from '@/server/db/schema/contracts';
import {
  CONTRACT_COUNTERSIGNATURE_MODES,
  type ContractCountersignatureMode,
} from '@/server/db/schema/studio-settings';

export { CONTRACT_STATUSES, CONTRACT_SIGNATURE_TYPES, CONTRACT_COUNTERSIGNATURE_MODES };
export type { ContractStatus, ContractSignatureType, ContractCountersignatureMode };

export const contractStatusSchema = z.enum(CONTRACT_STATUSES);
export type ContractStatusInput = z.infer<typeof contractStatusSchema>;

export const contractSignatureTypeSchema = z.enum(CONTRACT_SIGNATURE_TYPES);
export type ContractSignatureTypeInput = z.infer<typeof contractSignatureTypeSchema>;

export const contractCountersignatureModeSchema = z.enum(CONTRACT_COUNTERSIGNATURE_MODES);
export type ContractCountersignatureModeInput = z.infer<typeof contractCountersignatureModeSchema>;

/**
 * Regex for kebab-case slugs: lower-case alphanumeric segments joined by single hyphens.
 */
export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Allowed contract language locales.
 */
export const CONTRACT_LOCALES = ['en', 'de'] as const;
export type ContractLocale = (typeof CONTRACT_LOCALES)[number];
export const contractLocaleSchema = z.enum(CONTRACT_LOCALES);

/**
 * Schema for creating a contract template (AC-1, AC-8).
 */
export const createContractTemplateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Template name is required')
      .max(150, 'Template name must not exceed 150 characters'),
    slug: z
      .string()
      .trim()
      .min(1, 'Slug is required')
      .max(100, 'Slug must not exceed 100 characters')
      .regex(
        SLUG_REGEX,
        'Slug must consist of lowercase alphanumeric words separated by single hyphens',
      ),
    description: z.string().max(1000, 'Description too long').nullable().optional(),
    projectTypeKey: z.string().trim().max(40, 'Project type key too long').nullable().optional(),
    contentEn: z.string().min(1, 'English content is required'),
    contentDe: z.string().min(1, 'German content is required'),
    isDefault: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .strict();

export type CreateContractTemplateInput = z.input<typeof createContractTemplateSchema>;
export type CreateContractTemplateOutput = z.output<typeof createContractTemplateSchema>;

/**
 * Schema for updating an existing contract template (AC-2, AC-8).
 */
export const updateContractTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    slug: z.string().trim().min(1).max(100).regex(SLUG_REGEX).optional(),
    description: z.string().max(1000).nullable().optional(),
    projectTypeKey: z.string().trim().max(40).nullable().optional(),
    contentEn: z.string().min(1).optional(),
    contentDe: z.string().min(1).optional(),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type UpdateContractTemplateInput = z.input<typeof updateContractTemplateSchema>;
export type UpdateContractTemplateOutput = z.output<typeof updateContractTemplateSchema>;

/**
 * Schema for updating an existing contract template via server action (AC-4).
 */
export const updateContractTemplateActionInputSchema = updateContractTemplateSchema
  .extend({
    id: z.string().uuid('Template ID must be a valid UUID'),
  })
  .strict();

export type UpdateContractTemplateActionInput = z.input<
  typeof updateContractTemplateActionInputSchema
>;

/**
 * Schema for archiving or restoring a contract template via server action (AC-5).
 */
export const archiveContractTemplateActionInputSchema = z
  .object({
    id: z.string().uuid('Template ID must be a valid UUID'),
    isActive: z.boolean().default(false),
  })
  .strict();

export type ArchiveContractTemplateActionInput = z.input<
  typeof archiveContractTemplateActionInputSchema
>;

/**
 * Schema for creating a contract draft (AC-5, AC-8).
 */
export const createContractDraftSchema = z
  .object({
    projectId: z.string().uuid('Project ID must be a valid UUID'),
    clientId: z.string().uuid('Client ID must be a valid UUID'),
    templateId: z.string().uuid('Template ID must be a valid UUID').nullable().optional(),
    proposalId: z.string().uuid('Proposal ID must be a valid UUID').nullable().optional(),
    title: z
      .string()
      .trim()
      .min(1, 'Contract title is required')
      .max(200, 'Contract title must not exceed 200 characters'),
    locale: contractLocaleSchema.default('en'),
    renderedBody: z.string().optional(),
    mergeValuesSnapshot: z.record(z.unknown()).optional(),
    validUntil: z.coerce.date().nullable().optional(),
    internalNotes: z.string().max(5000, 'Internal notes too long').nullable().optional(),
  })
  .strict();

export type CreateContractDraftInput = z.input<typeof createContractDraftSchema>;
export type CreateContractDraftOutput = z.output<typeof createContractDraftSchema>;

/**
 * Schema for updating an editable draft contract.
 */
export const updateContractDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    locale: contractLocaleSchema.optional(),
    templateId: z.string().uuid().nullable().optional(),
    proposalId: z.string().uuid().nullable().optional(),
    renderedBody: z.string().optional(),
    mergeValuesSnapshot: z.record(z.unknown()).optional(),
    validUntil: z.coerce.date().nullable().optional(),
    internalNotes: z.string().max(5000).nullable().optional(),
  })
  .strict();

export type UpdateContractDraftInput = z.input<typeof updateContractDraftSchema>;
export type UpdateContractDraftOutput = z.output<typeof updateContractDraftSchema>;

/**
 * Schema for voiding a contract.
 */
export const voidContractSchema = z
  .object({
    reason: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export type VoidContractInput = z.input<typeof voidContractSchema>;

/**
 * Schema for updating studio signing profile and contact details (AC-6, AC-8).
 */
export const updateStudioSigningProfileSchema = z
  .object({
    contractSignatoryName: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional()
      .transform((val) => (val === '' ? null : val)),
    contractSignatoryTitle: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .optional()
      .transform((val) => (val === '' ? null : val)),
    contractCountersignatureMode: contractCountersignatureModeSchema.optional(),
    studioAddressLine1: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional()
      .transform((val) => (val === '' ? null : val)),
    studioAddressLine2: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional()
      .transform((val) => (val === '' ? null : val)),
    studioPostalCode: z
      .string()
      .trim()
      .max(20)
      .nullable()
      .optional()
      .transform((val) => (val === '' ? null : val)),
    studioCity: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .optional()
      .transform((val) => (val === '' ? null : val)),
    studioCountryCode: z
      .string()
      .trim()
      .length(2, 'Country code must be exactly 2 characters (ISO 3166-1 alpha-2)')
      .toUpperCase()
      .optional(),
    studioPhone: z
      .string()
      .trim()
      .max(50)
      .nullable()
      .optional()
      .transform((val) => (val === '' ? null : val)),
    studioEmail: z
      .string()
      .trim()
      .max(255)
      .email('Invalid email address')
      .or(z.literal(''))
      .nullable()
      .optional()
      .transform((val) => (val === '' ? null : val)),
  })
  .strict();

export type UpdateStudioSigningProfileInput = z.input<typeof updateStudioSigningProfileSchema>;
export type UpdateStudioSigningProfileOutput = z.output<typeof updateStudioSigningProfileSchema>;
