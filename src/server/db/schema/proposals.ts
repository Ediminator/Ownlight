import {
  pgTable,
  uuid,
  varchar,
  char,
  boolean,
  integer,
  bigint,
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
import { packages, catalogueItems } from './packages';

export const PROPOSAL_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'declined',
  'expired',
  'superseded',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_LINE_ITEM_TYPES = ['base_package', 'addon', 'custom'] as const;
export type ProposalLineItemType = (typeof PROPOSAL_LINE_ITEM_TYPES)[number];

export interface AcceptedOptionsSnapshotItem {
  id: string;
  packageId?: string | null;
  catalogueItemId?: string | null;
  itemType: ProposalLineItemType;
  name: string;
  description?: string | null;
  unitPriceMinor: number;
  quantity: number;
  taxRateBasisPoints: number;
  lineTotalMinor: number;
}

export interface AcceptedOptionsSnapshotBreakdown {
  taxRateBasisPoints: number;
  taxRatePercentFormatted: string;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
}

export interface AcceptedOptionsSnapshot {
  acceptedAt: string;
  acceptedByName?: string | null;
  acceptedByEmail?: string | null;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  pricesIncludeTax: boolean;
  isKleinunternehmer: boolean;
  taxBreakdown: AcceptedOptionsSnapshotBreakdown[];
  items: AcceptedOptionsSnapshotItem[];
}

/**
 * Proposals table (TASK-0058 / ADR-0018 §1.5).
 * Core commercial proposal entity attached to a client commission.
 */
export const proposals = pgTable(
  'proposals',
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
    title: varchar('title', { length: 200 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('draft').$type<ProposalStatus>(),
    version: integer('version').notNull().default(1),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    subtotalMinor: bigint('subtotal_minor', { mode: 'number' }).notNull().default(0),
    taxMinor: bigint('tax_minor', { mode: 'number' }).notNull().default(0),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull().default(0),
    pricesIncludeTax: boolean('prices_include_tax').notNull().default(true),
    isKleinunternehmer: boolean('is_kleinunternehmer').notNull().default(false),
    taxNotice: text('tax_notice'),
    validUntil: timestamp('valid_until', { withTimezone: true, mode: 'date' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    tokenRevokedAt: timestamp('token_revoked_at', { withTimezone: true, mode: 'date' }),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
    declinedAt: timestamp('declined_at', { withTimezone: true, mode: 'date' }),
    declineReason: text('decline_reason'),
    acceptedByName: varchar('accepted_by_name', { length: 200 }),
    acceptedByEmail: varchar('accepted_by_email', { length: 255 }),
    acceptanceIpAnonymized: varchar('acceptance_ip_anonymized', { length: 64 }),
    acceptanceUserAgent: varchar('acceptance_user_agent', { length: 255 }),
    acceptedOptionsSnapshot: jsonb('accepted_options_snapshot').$type<AcceptedOptionsSnapshot>(),
    internalNotes: text('internal_notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'proposals_status_check',
      sql`status IN ('draft', 'sent', 'accepted', 'declined', 'expired', 'superseded')`,
    ),
    index('proposals_project_id_idx').on(table.projectId),
    index('proposals_client_id_idx').on(table.clientId),
    index('proposals_token_hash_idx').on(table.tokenHash),
    index('proposals_status_idx').on(table.status),
  ],
);

export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;

/**
 * Proposal line items table (TASK-0058 / ADR-0018 §1.6).
 * Individual deliverables and options belonging to a proposal.
 */
export const proposalLineItems = pgTable(
  'proposal_line_items',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    packageId: uuid('package_id').references(() => packages.id, { onDelete: 'set null' }),
    catalogueItemId: uuid('catalogue_item_id').references(() => catalogueItems.id, {
      onDelete: 'set null',
    }),
    itemType: varchar('item_type', { length: 20 })
      .notNull()
      .default('addon')
      .$type<ProposalLineItemType>(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'number' }).notNull().default(0),
    quantity: integer('quantity').notNull().default(1),
    minQuantity: integer('min_quantity').notNull().default(0),
    maxQuantity: integer('max_quantity').notNull().default(1),
    taxRateBasisPoints: integer('tax_rate_basis_points').notNull().default(1900),
    isOptional: boolean('is_optional').notNull().default(false),
    isSelected: boolean('is_selected').notNull().default(true),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'proposal_line_items_item_type_check',
      sql`item_type IN ('base_package', 'addon', 'custom')`,
    ),
    index('proposal_line_items_proposal_position_idx').on(table.proposalId, table.position),
  ],
);

export type ProposalLineItem = typeof proposalLineItems.$inferSelect;
export type NewProposalLineItem = typeof proposalLineItems.$inferInsert;

// --- Drizzle Relations ---

export const proposalsRelations = relations(proposals, ({ one, many }) => ({
  project: one(projects, {
    fields: [proposals.projectId],
    references: [projects.id],
  }),
  client: one(clients, {
    fields: [proposals.clientId],
    references: [clients.id],
  }),
  lineItems: many(proposalLineItems),
}));

export const proposalLineItemsRelations = relations(proposalLineItems, ({ one }) => ({
  proposal: one(proposals, {
    fields: [proposalLineItems.proposalId],
    references: [proposals.id],
  }),
  package: one(packages, {
    fields: [proposalLineItems.packageId],
    references: [packages.id],
  }),
  catalogueItem: one(catalogueItems, {
    fields: [proposalLineItems.catalogueItemId],
    references: [catalogueItems.id],
  }),
}));
