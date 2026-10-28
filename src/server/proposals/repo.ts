import { randomBytes, createHash } from 'node:crypto';
import { eq, and, inArray, asc, desc } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';
import {
  proposals,
  proposalLineItems,
  type Proposal,
  type ProposalLineItem,
} from '@/server/db/schema/proposals';
import { projects } from '@/server/db/schema/projects';
import { resolveRepoAuth, type RepoAuthInput } from '@/server/auth/repo-auth';
import { audit } from '@/server/audit';
import { recordTimelineEvent } from '@/server/timeline/service';
import { calculateProposalTotals } from './calculator';
import {
  assertProposalTransitionAllowed,
  assertProposalEditable,
  createAcceptedOptionsSnapshot,
  ProposalImmutableError,
  ProposalStateTransitionError,
} from './snapshot';
import {
  createProposalSchema,
  updateProposalSchema,
  proposalLineItemInputSchema,
  transitionProposalStatusSchema,
  type CreateProposalInput,
  type UpdateProposalInput,
  type ProposalLineItemInput,
  type TransitionProposalStatusInput,
} from './schema';
import { z } from 'zod';

export { ProposalImmutableError, ProposalStateTransitionError };

export class ProposalNotFoundError extends Error {
  public readonly code = 'NOT_FOUND';
  public readonly statusCode = 404;

  constructor(message = 'Proposal not found') {
    super(message);
    this.name = 'ProposalNotFoundError';
  }
}

export class ProposalForbiddenError extends Error {
  public readonly code = 'FORBIDDEN';
  public readonly statusCode = 403;

  constructor(message = 'FORBIDDEN') {
    super(message);
    this.name = 'ProposalForbiddenError';
  }
}

export interface ProposalWithLineItems extends Proposal {
  lineItems: ProposalLineItem[];
}

export interface CreateProposalResult extends ProposalWithLineItems {
  rawToken: string;
}

export interface RevokeProposalTokenResult {
  proposal: ProposalWithLineItems;
  rawToken: string;
}

/**
 * Creates a proposal and child line items in a single transaction (AC-1, AC-9).
 * - Generates UUIDv7 IDs and 32-byte secret token (stored as SHA-256 hash).
 * - Enforces authenticated studio owner role.
 * - Enforces valid project/client relationship (AC-9).
 * - Computes initial integer minor unit totals.
 * - Emits proposal.created audit log.
 */
export async function createProposal(
  rawInput: CreateProposalInput,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<CreateProposalResult> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = createProposalSchema.parse(rawInput);

  // Validate project exists and matches clientId (AC-9)
  const [project] = await client
    .select()
    .from(projects)
    .where(eq(projects.id, validated.projectId))
    .limit(1);

  if (!project) {
    throw new ProposalForbiddenError('Project does not exist or access is forbidden');
  }

  if (project.clientId !== validated.clientId) {
    throw new ProposalForbiddenError('FORBIDDEN: Project does not belong to the specified client');
  }

  const proposalId = generateUuidV7();
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const now = new Date();

  // Calculate totals
  const calcResult = calculateProposalTotals(
    validated.lineItems.map((item) => ({
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      taxRateBasisPoints: item.taxRateBasisPoints,
      isSelected: item.isSelected,
    })),
    {
      pricesIncludeTax: validated.pricesIncludeTax,
      isKleinunternehmer: validated.isKleinunternehmer,
    },
  );

  const executeInTransaction = async (tx: DbClient): Promise<CreateProposalResult> => {
    const [insertedProposal] = (await tx
      .insert(proposals)
      .values({
        id: proposalId,
        projectId: validated.projectId,
        clientId: validated.clientId,
        title: validated.title,
        status: 'draft',
        version: 1,
        currency: validated.currency,
        subtotalMinor: calcResult.subtotalMinor,
        taxMinor: calcResult.taxMinor,
        totalMinor: calcResult.totalMinor,
        pricesIncludeTax: validated.pricesIncludeTax,
        isKleinunternehmer: validated.isKleinunternehmer,
        taxNotice: validated.taxNotice ?? null,
        validUntil: validated.validUntil ?? null,
        tokenHash,
        tokenRevokedAt: null,
        sentAt: null,
        acceptedAt: null,
        declinedAt: null,
        declineReason: null,
        acceptedByName: null,
        acceptedByEmail: null,
        acceptanceIpAnonymized: null,
        acceptanceUserAgent: null,
        acceptedOptionsSnapshot: null,
        internalNotes: validated.internalNotes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()) as [Proposal];

    let insertedItems: ProposalLineItem[] = [];
    if (validated.lineItems.length > 0) {
      insertedItems = await tx
        .insert(proposalLineItems)
        .values(
          validated.lineItems.map((item, index) => ({
            id: item.id ?? generateUuidV7(),
            proposalId: insertedProposal.id,
            packageId: item.packageId ?? null,
            catalogueItemId: item.catalogueItemId ?? null,
            itemType: item.itemType,
            name: item.name,
            description: item.description ?? null,
            unitPriceMinor: item.unitPriceMinor,
            quantity: item.quantity,
            minQuantity: item.minQuantity,
            maxQuantity: item.maxQuantity,
            taxRateBasisPoints: item.taxRateBasisPoints,
            isOptional: item.isOptional,
            isSelected: item.isSelected,
            position: item.position ?? index,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .returning();
    }

    await audit(
      {
        actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
        actorId: auth.user.id,
        action: 'proposal.created',
        targetType: 'proposal',
        targetId: insertedProposal.id,
        outcome: 'success',
        metadata: {
          proposal_id: insertedProposal.id,
          project_id: insertedProposal.projectId,
          client_id: insertedProposal.clientId,
          title: insertedProposal.title,
          total_minor: insertedProposal.totalMinor,
          currency: insertedProposal.currency,
          version: insertedProposal.version,
          status: insertedProposal.status,
        },
      },
      tx,
    );

    return {
      ...insertedProposal,
      lineItems: insertedItems,
      rawToken,
    };
  };

  return await client.transaction(async (tx) => {
    return await executeInTransaction(tx);
  });
}

/**
 * Retrieves a proposal by its ID with all child line items.
 * Strictly requires authenticated studio owner.
 */
export async function getProposalById(
  id: string,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<ProposalWithLineItems | null> {
  const { client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const [proposal] = await client.select().from(proposals).where(eq(proposals.id, id)).limit(1);

  if (!proposal) {
    return null;
  }

  const items = await client
    .select()
    .from(proposalLineItems)
    .where(eq(proposalLineItems.proposalId, id))
    .orderBy(asc(proposalLineItems.position), asc(proposalLineItems.createdAt));

  return {
    ...proposal,
    lineItems: items,
  };
}

/**
 * Resolves a proposal by its SHA-256 token hash (used for cookieless client views).
 * Validates that the token has not been revoked.
 */
export async function getProposalByTokenHash(
  tokenHash: string,
  explicitClient?: DbClient,
): Promise<ProposalWithLineItems | null> {
  const client = explicitClient ?? defaultDb;

  const [proposal] = await client
    .select()
    .from(proposals)
    .where(and(eq(proposals.tokenHash, tokenHash)))
    .limit(1);

  if (!proposal) {
    return null;
  }

  if (proposal.tokenRevokedAt !== null) {
    return null;
  }

  const items = await client
    .select()
    .from(proposalLineItems)
    .where(eq(proposalLineItems.proposalId, proposal.id))
    .orderBy(asc(proposalLineItems.position), asc(proposalLineItems.createdAt));

  return {
    ...proposal,
    lineItems: items,
  };
}

/**
 * Resolves a proposal by raw token string by computing its SHA-256 hash.
 */
export async function getProposalByRawToken(
  rawToken: string,
  explicitClient?: DbClient,
): Promise<ProposalWithLineItems | null> {
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  return await getProposalByTokenHash(tokenHash, explicitClient);
}

/**
 * Lists all proposals for a given project, ordered newest first.
 * Strictly requires authenticated studio owner.
 */
export async function listProposalsByProject(
  projectId: string,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<ProposalWithLineItems[]> {
  const { client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const rows = await client
    .select()
    .from(proposals)
    .where(eq(proposals.projectId, projectId))
    .orderBy(desc(proposals.createdAt));

  if (rows.length === 0) {
    return [];
  }

  const proposalIds = rows.map((r) => r.id);
  const items = await client
    .select()
    .from(proposalLineItems)
    .where(inArray(proposalLineItems.proposalId, proposalIds))
    .orderBy(asc(proposalLineItems.position), asc(proposalLineItems.createdAt));

  const itemsByProposalId = new Map<string, ProposalLineItem[]>();
  for (const item of items) {
    const list = itemsByProposalId.get(item.proposalId) ?? [];
    list.push(item);
    itemsByProposalId.set(item.proposalId, list);
  }

  return rows.map((p) => ({
    ...p,
    lineItems: itemsByProposalId.get(p.id) ?? [],
  }));
}

/**
 * Updates proposal metadata (title, validUntil, tax settings, internalNotes).
 * Enforces immutability guard: throws ProposalImmutableError if proposal is accepted or superseded.
 */
export async function updateProposal(
  id: string,
  rawInput: UpdateProposalInput,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<ProposalWithLineItems> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = updateProposalSchema.parse(rawInput);

  const existing = await getProposalById(id, authOrOptions, client);
  if (!existing) {
    throw new ProposalNotFoundError();
  }

  assertProposalEditable(existing);

  const now = new Date();
  const pricesIncludeTax = validated.pricesIncludeTax ?? existing.pricesIncludeTax;
  const isKleinunternehmer = validated.isKleinunternehmer ?? existing.isKleinunternehmer;

  // Recalculate totals if tax settings changed
  let { subtotalMinor, taxMinor, totalMinor } = existing;
  if (validated.pricesIncludeTax !== undefined || validated.isKleinunternehmer !== undefined) {
    const recalc = calculateProposalTotals(
      existing.lineItems.map((item) => ({
        unitPriceMinor: item.unitPriceMinor,
        quantity: item.quantity,
        taxRateBasisPoints: item.taxRateBasisPoints,
        isSelected: item.isSelected,
      })),
      { pricesIncludeTax, isKleinunternehmer },
    );
    subtotalMinor = recalc.subtotalMinor;
    taxMinor = recalc.taxMinor;
    totalMinor = recalc.totalMinor;
  }

  const changedFields = Object.keys(validated).filter(
    (key) => validated[key as keyof UpdateProposalInput] !== undefined,
  );

  const [updated] = (await client
    .update(proposals)
    .set({
      title: validated.title ?? existing.title,
      currency: validated.currency ?? existing.currency,
      pricesIncludeTax,
      isKleinunternehmer,
      taxNotice: validated.taxNotice !== undefined ? validated.taxNotice : existing.taxNotice,
      validUntil: validated.validUntil !== undefined ? validated.validUntil : existing.validUntil,
      internalNotes:
        validated.internalNotes !== undefined ? validated.internalNotes : existing.internalNotes,
      subtotalMinor,
      taxMinor,
      totalMinor,
      updatedAt: now,
    })
    .where(eq(proposals.id, id))
    .returning()) as [Proposal];

  await audit(
    {
      actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
      actorId: auth.user.id,
      action: 'proposal.updated',
      targetType: 'proposal',
      targetId: updated.id,
      outcome: 'success',
      metadata: {
        proposal_id: updated.id,
        project_id: updated.projectId,
        client_id: updated.clientId,
        title: updated.title,
        total_minor: updated.totalMinor,
        currency: updated.currency,
        version: updated.version,
        status: updated.status,
        changed_fields: changedFields.join(','),
      },
    },
    client,
  );

  return {
    ...updated,
    lineItems: existing.lineItems,
  };
}

/**
 * Replaces all line items for an unaccepted proposal and recalculates totals (AC-5, AC-6).
 * Enforces immutability guard: throws ProposalImmutableError if proposal is accepted or superseded.
 */
export async function setProposalLineItems(
  proposalId: string,
  rawItems: ProposalLineItemInput[],
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<ProposalWithLineItems> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validatedItems = z.array(proposalLineItemInputSchema).parse(rawItems);

  const existing = await getProposalById(proposalId, authOrOptions, client);
  if (!existing) {
    throw new ProposalNotFoundError();
  }

  assertProposalEditable(existing);

  const now = new Date();
  const calcResult = calculateProposalTotals(
    validatedItems.map((item) => ({
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      taxRateBasisPoints: item.taxRateBasisPoints,
      isSelected: item.isSelected,
    })),
    {
      pricesIncludeTax: existing.pricesIncludeTax,
      isKleinunternehmer: existing.isKleinunternehmer,
    },
  );

  const executeInTransaction = async (tx: DbClient): Promise<ProposalWithLineItems> => {
    // Delete existing items
    await tx.delete(proposalLineItems).where(eq(proposalLineItems.proposalId, proposalId));

    let insertedItems: ProposalLineItem[] = [];
    if (validatedItems.length > 0) {
      insertedItems = await tx
        .insert(proposalLineItems)
        .values(
          validatedItems.map((item, index) => ({
            id: item.id ?? generateUuidV7(),
            proposalId,
            packageId: item.packageId ?? null,
            catalogueItemId: item.catalogueItemId ?? null,
            itemType: item.itemType,
            name: item.name,
            description: item.description ?? null,
            unitPriceMinor: item.unitPriceMinor,
            quantity: item.quantity,
            minQuantity: item.minQuantity,
            maxQuantity: item.maxQuantity,
            taxRateBasisPoints: item.taxRateBasisPoints,
            isOptional: item.isOptional,
            isSelected: item.isSelected,
            position: item.position ?? index,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .returning();
    }

    const [updatedProposal] = (await tx
      .update(proposals)
      .set({
        subtotalMinor: calcResult.subtotalMinor,
        taxMinor: calcResult.taxMinor,
        totalMinor: calcResult.totalMinor,
        updatedAt: now,
      })
      .where(eq(proposals.id, proposalId))
      .returning()) as [Proposal];

    await audit(
      {
        actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
        actorId: auth.user.id,
        action: 'proposal.updated',
        targetType: 'proposal',
        targetId: updatedProposal.id,
        outcome: 'success',
        metadata: {
          proposal_id: updatedProposal.id,
          project_id: updatedProposal.projectId,
          client_id: updatedProposal.clientId,
          title: updatedProposal.title,
          total_minor: updatedProposal.totalMinor,
          currency: updatedProposal.currency,
          version: updatedProposal.version,
          status: updatedProposal.status,
          changed_fields: 'line_items,subtotal_minor,tax_minor,total_minor',
        },
      },
      tx,
    );

    return {
      ...updatedProposal,
      lineItems: insertedItems,
    };
  };

  return await client.transaction(async (tx) => {
    return await executeInTransaction(tx);
  });
}

/**
 * Transitions proposal status following state machine rules (AC-6, AC-8).
 * When transitioning to 'accepted':
 * - Generates immutable accepted_options_snapshot.
 * - Freezes status to 'accepted'.
 * - Synchronizes project priceMinor.
 * - Records proposal.accepted timeline and audit events.
 */
export async function transitionProposalStatus(
  id: string,
  rawInput: TransitionProposalStatusInput,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<ProposalWithLineItems> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = transitionProposalStatusSchema.parse(rawInput);

  const existing = await getProposalById(id, authOrOptions, client);
  if (!existing) {
    throw new ProposalNotFoundError();
  }

  // Enforce legal state machine transition (AC-6)
  assertProposalTransitionAllowed(existing.status, validated.newStatus);

  const now = new Date();

  const executeInTransaction = async (tx: DbClient): Promise<ProposalWithLineItems> => {
    let currentItems = existing.lineItems;

    // Handle acceptance ceremony
    if (validated.newStatus === 'accepted') {
      // If client selectively toggled options upon acceptance, update selection flags
      if (validated.selectedLineItemIds && validated.selectedLineItemIds.length > 0) {
        const selectedSet = new Set(validated.selectedLineItemIds);
        currentItems = currentItems.map((item) => {
          // Base packages cannot be deselected
          const isSelected = item.itemType === 'base_package' || selectedSet.has(item.id);
          return { ...item, isSelected };
        });

        // Persist updated selection states
        for (const item of currentItems) {
          await tx
            .update(proposalLineItems)
            .set({ isSelected: item.isSelected, updatedAt: now })
            .where(eq(proposalLineItems.id, item.id));
        }
      }

      // Compute exact snapshot totals
      const calcResult = calculateProposalTotals(
        currentItems.map((item) => ({
          unitPriceMinor: item.unitPriceMinor,
          quantity: item.quantity,
          taxRateBasisPoints: item.taxRateBasisPoints,
          isSelected: item.isSelected,
        })),
        {
          pricesIncludeTax: existing.pricesIncludeTax,
          isKleinunternehmer: existing.isKleinunternehmer,
        },
      );

      const snapshot = createAcceptedOptionsSnapshot(existing, currentItems, {
        acceptedByName: validated.acceptedByName,
        acceptedByEmail: validated.acceptedByEmail,
      });

      const [acceptedProposal] = (await tx
        .update(proposals)
        .set({
          status: 'accepted',
          acceptedAt: now,
          acceptedByName: validated.acceptedByName ?? null,
          acceptedByEmail: validated.acceptedByEmail ?? null,
          acceptanceIpAnonymized: validated.acceptanceIpAnonymized ?? null,
          acceptanceUserAgent: validated.acceptanceUserAgent ?? null,
          acceptedOptionsSnapshot: snapshot,
          subtotalMinor: calcResult.subtotalMinor,
          taxMinor: calcResult.taxMinor,
          totalMinor: calcResult.totalMinor,
          updatedAt: now,
        })
        .where(eq(proposals.id, id))
        .returning()) as [Proposal];

      // Synchronize project price and currency (ADR-0018 §3.3)
      await tx
        .update(projects)
        .set({
          priceMinor: acceptedProposal.totalMinor,
          currency: acceptedProposal.currency,
          updatedAt: now,
        })
        .where(eq(projects.id, acceptedProposal.projectId));

      // Record client relationship timeline event (AC-8)
      await recordTimelineEvent(tx, {
        clientId: acceptedProposal.clientId,
        type: 'proposal.accepted',
        actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
        actorId: auth.user.id,
        subjectType: 'proposal',
        subjectId: acceptedProposal.id,
        data: {
          proposal_id: acceptedProposal.id,
          total_minor: acceptedProposal.totalMinor,
          currency: acceptedProposal.currency,
        },
      });

      // Emit audit log
      await audit(
        {
          actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
          actorId: auth.user.id,
          action: 'proposal.accepted',
          targetType: 'proposal',
          targetId: acceptedProposal.id,
          outcome: 'success',
          metadata: {
            proposal_id: acceptedProposal.id,
            project_id: acceptedProposal.projectId,
            client_id: acceptedProposal.clientId,
            total_minor: acceptedProposal.totalMinor,
            currency: acceptedProposal.currency,
            accepted_by_name: acceptedProposal.acceptedByName ?? null,
          },
        },
        tx,
      );

      return {
        ...acceptedProposal,
        lineItems: currentItems,
      };
    }

    if (validated.newStatus === 'sent') {
      const [sentProposal] = (await tx
        .update(proposals)
        .set({
          status: 'sent',
          sentAt: now,
          updatedAt: now,
        })
        .where(eq(proposals.id, id))
        .returning()) as [Proposal];

      await recordTimelineEvent(tx, {
        clientId: sentProposal.clientId,
        type: 'proposal.sent',
        actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
        actorId: auth.user.id,
        subjectType: 'proposal',
        subjectId: sentProposal.id,
        data: {
          proposal_id: sentProposal.id,
          total_minor: sentProposal.totalMinor,
          currency: sentProposal.currency,
        },
      });

      await audit(
        {
          actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
          actorId: auth.user.id,
          action: 'proposal.sent',
          targetType: 'proposal',
          targetId: sentProposal.id,
          outcome: 'success',
          metadata: {
            proposal_id: sentProposal.id,
            project_id: sentProposal.projectId,
            client_id: sentProposal.clientId,
            total_minor: sentProposal.totalMinor,
            currency: sentProposal.currency,
            valid_until: sentProposal.validUntil ? sentProposal.validUntil.toISOString() : null,
          },
        },
        tx,
      );

      return {
        ...sentProposal,
        lineItems: currentItems,
      };
    }

    if (validated.newStatus === 'declined') {
      const [declinedProposal] = (await tx
        .update(proposals)
        .set({
          status: 'declined',
          declinedAt: now,
          declineReason: validated.declineReason ?? null,
          updatedAt: now,
        })
        .where(eq(proposals.id, id))
        .returning()) as [Proposal];

      await recordTimelineEvent(tx, {
        clientId: declinedProposal.clientId,
        type: 'proposal.declined',
        actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
        actorId: auth.user.id,
        subjectType: 'proposal',
        subjectId: declinedProposal.id,
        data: {
          proposal_id: declinedProposal.id,
          total_minor: declinedProposal.totalMinor,
          currency: declinedProposal.currency,
        },
      });

      await audit(
        {
          actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
          actorId: auth.user.id,
          action: 'proposal.declined',
          targetType: 'proposal',
          targetId: declinedProposal.id,
          outcome: 'success',
          metadata: {
            proposal_id: declinedProposal.id,
            project_id: declinedProposal.projectId,
            client_id: declinedProposal.clientId,
            total_minor: declinedProposal.totalMinor,
            currency: declinedProposal.currency,
            decline_reason: declinedProposal.declineReason ?? null,
          },
        },
        tx,
      );

      return {
        ...declinedProposal,
        lineItems: currentItems,
      };
    }

    // expired or superseded
    const [updatedProposal] = (await tx
      .update(proposals)
      .set({
        status: validated.newStatus,
        updatedAt: now,
      })
      .where(eq(proposals.id, id))
      .returning()) as [Proposal];

    await audit(
      {
        actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
        actorId: auth.user.id,
        action: 'proposal.updated',
        targetType: 'proposal',
        targetId: updatedProposal.id,
        outcome: 'success',
        metadata: {
          proposal_id: updatedProposal.id,
          project_id: updatedProposal.projectId,
          client_id: updatedProposal.clientId,
          title: updatedProposal.title,
          total_minor: updatedProposal.totalMinor,
          currency: updatedProposal.currency,
          version: updatedProposal.version,
          status: updatedProposal.status,
          changed_fields: 'status',
        },
      },
      tx,
    );

    return {
      ...updatedProposal,
      lineItems: currentItems,
    };
  };

  return await client.transaction(async (tx) => {
    return await executeInTransaction(tx);
  });
}

/**
 * Revokes existing public access token and generates a new secret token and hash.
 * Strictly requires authenticated studio owner.
 */
export async function revokeProposalToken(
  id: string,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<RevokeProposalTokenResult> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const existing = await getProposalById(id, authOrOptions, client);
  if (!existing) {
    throw new ProposalNotFoundError();
  }

  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const now = new Date();

  const [updated] = (await client
    .update(proposals)
    .set({
      tokenHash,
      tokenRevokedAt: null,
      updatedAt: now,
    })
    .where(eq(proposals.id, id))
    .returning()) as [Proposal];

  await audit(
    {
      actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
      actorId: auth.user.id,
      action: 'proposal.revoked',
      targetType: 'proposal',
      targetId: updated.id,
      outcome: 'success',
      metadata: {
        proposal_id: updated.id,
        project_id: updated.projectId,
        client_id: updated.clientId,
        reason: 'manual_reissuance',
      },
    },
    client,
  );

  return {
    proposal: {
      ...updated,
      lineItems: existing.lineItems,
    },
    rawToken,
  };
}
