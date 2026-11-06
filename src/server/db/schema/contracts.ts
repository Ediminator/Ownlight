import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  text,
  timestamp,
  index,
  check,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';
import { generateUuidV7 } from '@/lib/id';
import { projects } from './projects';
import { clients } from './clients';
import { proposals } from './proposals';

export const CONTRACT_STATUSES = [
  'draft',
  'sent',
  'signed_by_client',
  'signed',
  'declined',
  'voided',
  'superseded',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_SIGNATURE_TYPES = ['drawn', 'typed'] as const;
export type ContractSignatureType = (typeof CONTRACT_SIGNATURE_TYPES)[number];

/**
 * Contract templates table (TASK-0064 / ADR-0019 §1.2).
 * Reusable contract boilerplates in English and German authored by the studio.
 */
export const contractTemplates = pgTable(
  'contract_templates',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    name: varchar('name', { length: 150 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    description: text('description'),
    projectTypeKey: varchar('project_type_key', { length: 40 }),
    contentEn: text('content_en').notNull(),
    contentDe: text('content_de').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('contract_templates_slug_idx').on(table.slug),
    index('contract_templates_project_type_key_idx').on(table.projectTypeKey),
  ],
);

export type ContractTemplate = typeof contractTemplates.$inferSelect;
export type NewContractTemplate = typeof contractTemplates.$inferInsert;

/**
 * Contracts table (TASK-0064 / ADR-0019 §1.3).
 * Core contract agreement attached to a client project with tamper-evident audit seals.
 */
export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    proposalId: uuid('proposal_id').references(() => proposals.id, { onDelete: 'set null' }),
    templateId: uuid('template_id').references(() => contractTemplates.id, {
      onDelete: 'set null',
    }),
    contractNumber: varchar('contract_number', { length: 50 }).notNull().unique(),
    title: varchar('title', { length: 200 }).notNull(),
    locale: varchar('locale', { length: 10 }).notNull().default('en'),
    status: varchar('status', { length: 32 }).notNull().default('draft').$type<ContractStatus>(),
    renderedBody: text('rendered_body').notNull(),
    mergeValuesSnapshot: jsonb('merge_values_snapshot').notNull().$type<Record<string, unknown>>(),
    canonicalBodySha256: varchar('canonical_body_sha256', { length: 64 }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true, mode: 'date' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    tokenRevokedAt: timestamp('token_revoked_at', { withTimezone: true, mode: 'date' }),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    remindedAt: timestamp('reminded_at', { withTimezone: true, mode: 'date' }),
    reminderCount: integer('reminder_count').notNull().default(0),

    // Client signature audit trail
    clientSignedAt: timestamp('client_signed_at', { withTimezone: true, mode: 'date' }),
    clientSignerName: varchar('client_signer_name', { length: 200 }),
    clientSignerEmail: varchar('client_signer_email', { length: 255 }),
    clientSignatureType: varchar('client_signature_type', {
      length: 20,
    }).$type<ContractSignatureType>(),
    clientSignatureData: text('client_signature_data'),
    clientIpAnonymized: varchar('client_ip_anonymized', { length: 64 }),
    clientUserAgent: varchar('client_user_agent', { length: 255 }),

    // Studio countersignature audit trail
    studioSignedAt: timestamp('studio_signed_at', { withTimezone: true, mode: 'date' }),
    studioSignerName: varchar('studio_signer_name', { length: 200 }),
    studioSignerTitle: varchar('studio_signer_title', { length: 100 }),
    studioSignatureData: text('studio_signature_data'),

    // Final sealed PDF storage and verification
    pdfStorageKey: varchar('pdf_storage_key', { length: 255 }),
    pdfSha256: varchar('pdf_sha256', { length: 64 }),
    pdfByteSize: integer('pdf_byte_size'),
    pdfGeneratedAt: timestamp('pdf_generated_at', { withTimezone: true, mode: 'date' }),

    // Private studio internal notes
    internalNotes: text('internal_notes'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'contracts_status_check',
      sql`status IN ('draft', 'sent', 'signed_by_client', 'signed', 'declined', 'voided', 'superseded')`,
    ),
    check(
      'contracts_client_signature_type_check',
      sql`client_signature_type IS NULL OR client_signature_type IN ('drawn', 'typed')`,
    ),
    index('contracts_project_id_idx').on(table.projectId),
    index('contracts_client_id_idx').on(table.clientId),
    index('contracts_proposal_id_idx').on(table.proposalId),
    index('contracts_template_id_idx').on(table.templateId),
    index('contracts_token_hash_idx').on(table.tokenHash),
    index('contracts_status_idx').on(table.status),
    index('contracts_contract_number_idx').on(table.contractNumber),
  ],
);

export type Contract = typeof contracts.$inferSelect;
export type NewContract = typeof contracts.$inferInsert;

// --- Drizzle Relations ---

export const contractTemplatesRelations = relations(contractTemplates, ({ many }) => ({
  contracts: many(contracts),
}));

export const contractsRelations = relations(contracts, ({ one }) => ({
  project: one(projects, {
    fields: [contracts.projectId],
    references: [projects.id],
  }),
  client: one(clients, {
    fields: [contracts.clientId],
    references: [clients.id],
  }),
  proposal: one(proposals, {
    fields: [contracts.proposalId],
    references: [proposals.id],
  }),
  template: one(contractTemplates, {
    fields: [contracts.templateId],
    references: [contractTemplates.id],
  }),
}));
