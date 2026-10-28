import { z } from 'zod';
import { PROPOSAL_STATUSES, PROPOSAL_LINE_ITEM_TYPES } from '@/server/db/schema/proposals';

export const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export type ProposalStatusInput = z.infer<typeof proposalStatusSchema>;

export const proposalLineItemTypeSchema = z.enum(PROPOSAL_LINE_ITEM_TYPES);
export type ProposalLineItemTypeInput = z.infer<typeof proposalLineItemTypeSchema>;

/**
 * Schema for an individual proposal line item (create/update input).
 */
export const proposalLineItemInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    packageId: z.string().uuid().nullable().optional(),
    catalogueItemId: z.string().uuid().nullable().optional(),
    itemType: proposalLineItemTypeSchema.default('addon'),
    name: z.string().trim().min(1, 'Item name is required').max(200, 'Item name too long'),
    description: z.string().max(2000).nullable().optional(),
    unitPriceMinor: z.number().int().min(0, 'Unit price cannot be negative'),
    quantity: z.number().int().min(0, 'Quantity cannot be negative').default(1),
    minQuantity: z.number().int().min(0).default(0),
    maxQuantity: z.number().int().min(1).default(1),
    taxRateBasisPoints: z.number().int().min(0).max(10000).default(1900),
    isOptional: z.boolean().default(false),
    isSelected: z.boolean().default(true),
    position: z.number().int().min(0).optional(),
  })
  .strict();

export type ProposalLineItemInput = z.input<typeof proposalLineItemInputSchema>;
export type ProposalLineItemOutput = z.output<typeof proposalLineItemInputSchema>;

/**
 * Schema for creating a new proposal.
 */
export const createProposalSchema = z
  .object({
    projectId: z.string().uuid('Project ID must be a valid UUID'),
    clientId: z.string().uuid('Client ID must be a valid UUID'),
    title: z
      .string()
      .trim()
      .min(1, 'Proposal title is required')
      .max(200, 'Proposal title too long'),
    currency: z.string().length(3, 'Currency must be 3 characters').default('EUR'),
    pricesIncludeTax: z.boolean().default(true),
    isKleinunternehmer: z.boolean().default(false),
    taxNotice: z.string().max(1000).nullable().optional(),
    validUntil: z.coerce.date().nullable().optional(),
    internalNotes: z.string().max(5000).nullable().optional(),
    lineItems: z.array(proposalLineItemInputSchema).optional().default([]),
  })
  .strict();

export type CreateProposalInput = z.input<typeof createProposalSchema>;
export type CreateProposalOutput = z.output<typeof createProposalSchema>;

/**
 * Schema for updating an existing proposal.
 */
export const updateProposalSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    currency: z.string().length(3).optional(),
    pricesIncludeTax: z.boolean().optional(),
    isKleinunternehmer: z.boolean().optional(),
    taxNotice: z.string().max(1000).nullable().optional(),
    validUntil: z.coerce.date().nullable().optional(),
    internalNotes: z.string().max(5000).nullable().optional(),
  })
  .strict();

export type UpdateProposalInput = z.input<typeof updateProposalSchema>;
export type UpdateProposalOutput = z.output<typeof updateProposalSchema>;

/**
 * Schema for transitioning proposal state.
 */
export const transitionProposalStatusSchema = z
  .object({
    newStatus: proposalStatusSchema,
    declineReason: z.string().max(1000).nullable().optional(),
    acceptedByName: z.string().trim().min(1).max(200).optional(),
    acceptedByEmail: z.string().trim().email().max(255).optional(),
    acceptanceIpAnonymized: z.string().max(64).optional(),
    acceptanceUserAgent: z.string().max(255).optional(),
    selectedLineItemIds: z.array(z.string().uuid()).optional(),
  })
  .strict();

export type TransitionProposalStatusInput = z.input<typeof transitionProposalStatusSchema>;
export type TransitionProposalStatusOutput = z.output<typeof transitionProposalStatusSchema>;
