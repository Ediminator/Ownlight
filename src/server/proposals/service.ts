import 'server-only';
import { randomBytes, createHash } from 'node:crypto';
import { eq, desc, asc } from 'drizzle-orm';
import { type DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';
import {
  proposals,
  proposalLineItems,
  type Proposal,
  type ProposalLineItem,
} from '@/server/db/schema/proposals';
import { projects } from '@/server/db/schema/projects';
import { clientContacts } from '@/server/db/schema/clients';
import { resolveRepoAuth, type RepoAuthInput } from '@/server/auth/repo-auth';
import { audit } from '@/server/audit';
import { recordTimelineEvent } from '@/server/timeline/service';
import { calculateProposalTotals } from './calculator';
import { enqueueProposalEmail } from '@/server/email/templates/proposal';
import { ProposalImmutableError, assertProposalEditable } from './snapshot';
import {
  saveDraftProposalSchema,
  sendProposalSchema,
  revokeProposalTokenSchema,
  type SaveDraftProposalInput,
  type SendProposalInput,
  type RevokeProposalTokenInput,
} from './schema';
import {
  createProposal,
  getProposalById,
  ProposalNotFoundError,
  ProposalForbiddenError,
  type ProposalWithLineItems,
} from './repo';

export { getAcceptedProposalForProject, type AcceptedProposalSummary } from './accepted-summary';

export interface SendProposalResult {
  proposalId: string;
  rawToken: string;
  tokenUrl: string;
}

export interface RevokeProposalTokenActionResult {
  proposalId: string;
  revokedAt: Date;
}

/**
 * Creates a new draft proposal or updates an existing draft proposal and line items transactionally (TASK-0060 / AC-8).
 */
export async function saveDraftProposal(
  rawInput: SaveDraftProposalInput,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<ProposalWithLineItems> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = saveDraftProposalSchema.parse(rawInput);

  if (!validated.id) {
    // Creating a new proposal
    let clientId = validated.clientId;
    if (!clientId) {
      const [project] = await client
        .select({ clientId: projects.clientId })
        .from(projects)
        .where(eq(projects.id, validated.projectId))
        .limit(1);
      if (!project?.clientId) {
        throw new Error('Project not found or missing clientId');
      }
      clientId = project.clientId;
    }

    const result = await createProposal(
      {
        projectId: validated.projectId,
        clientId,
        title: validated.title,
        currency: validated.currency,
        pricesIncludeTax: validated.pricesIncludeTax,
        isKleinunternehmer: validated.isKleinunternehmer,
        taxNotice: validated.taxNotice,
        validUntil: validated.validUntil,
        internalNotes: validated.internalNotes,
        lineItems: validated.lineItems,
      },
      authOrOptions,
      client,
    );

    return {
      id: result.id,
      projectId: result.projectId,
      clientId: result.clientId,
      title: result.title,
      status: result.status,
      version: result.version,
      currency: result.currency,
      subtotalMinor: result.subtotalMinor,
      taxMinor: result.taxMinor,
      totalMinor: result.totalMinor,
      pricesIncludeTax: result.pricesIncludeTax,
      isKleinunternehmer: result.isKleinunternehmer,
      taxNotice: result.taxNotice,
      validUntil: result.validUntil,
      tokenHash: result.tokenHash,
      tokenRevokedAt: result.tokenRevokedAt,
      sentAt: result.sentAt,
      acceptedAt: result.acceptedAt,
      declinedAt: result.declinedAt,
      declineReason: result.declineReason,
      acceptedByName: result.acceptedByName,
      acceptedByEmail: result.acceptedByEmail,
      acceptanceIpAnonymized: result.acceptanceIpAnonymized,
      acceptanceUserAgent: result.acceptanceUserAgent,
      acceptedOptionsSnapshot: result.acceptedOptionsSnapshot,
      internalNotes: result.internalNotes,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      lineItems: result.lineItems,
    };
  }

  // Updating existing draft proposal
  const proposalId = validated.id;
  const existing = await getProposalById(proposalId, authOrOptions, client);
  if (!existing) {
    throw new ProposalNotFoundError();
  }

  assertProposalEditable(existing);

  // Validate project exists
  const [project] = await client
    .select()
    .from(projects)
    .where(eq(projects.id, validated.projectId))
    .limit(1);

  if (!project) {
    throw new ProposalForbiddenError('Project does not exist or access is forbidden');
  }

  const clientId = validated.clientId ?? existing.clientId;
  if (project.clientId !== clientId) {
    throw new ProposalForbiddenError('FORBIDDEN: Project does not belong to the specified client');
  }

  const now = new Date();
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

  return await client.transaction(async (tx) => {
    // 1. Delete existing line items
    await tx.delete(proposalLineItems).where(eq(proposalLineItems.proposalId, proposalId));

    // 2. Insert new line items
    let insertedItems: ProposalLineItem[] = [];
    if (validated.lineItems.length > 0) {
      insertedItems = await tx
        .insert(proposalLineItems)
        .values(
          validated.lineItems.map((item, index) => ({
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

    // 3. Update proposal row
    const [updated] = (await tx
      .update(proposals)
      .set({
        projectId: validated.projectId,
        clientId,
        title: validated.title,
        currency: validated.currency,
        pricesIncludeTax: validated.pricesIncludeTax,
        isKleinunternehmer: validated.isKleinunternehmer,
        taxNotice: validated.taxNotice ?? null,
        validUntil: validated.validUntil ?? null,
        internalNotes: validated.internalNotes ?? null,
        subtotalMinor: calcResult.subtotalMinor,
        taxMinor: calcResult.taxMinor,
        totalMinor: calcResult.totalMinor,
        updatedAt: now,
      })
      .where(eq(proposals.id, proposalId))
      .returning()) as [Proposal];

    // 4. Emit proposal.updated audit log
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
          changed_fields: 'line_items,subtotal_minor,tax_minor,total_minor',
        },
      },
      tx,
    );

    return {
      ...updated,
      lineItems: insertedItems,
    };
  });
}

/**
 * Sends a proposal to the client: generates 32-byte secret token, updates status to 'sent',
 * queues 'proposal_sent' in email_outbox in the same transaction, and emits timeline and audit events (TASK-0060 / AC-1).
 */
export async function sendProposal(
  rawInput: SendProposalInput,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<SendProposalResult> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = sendProposalSchema.parse(rawInput);

  const existing = await getProposalById(validated.proposalId, authOrOptions, client);
  if (!existing) {
    throw new ProposalNotFoundError();
  }

  if (existing.status !== 'draft' && existing.status !== 'sent') {
    throw new ProposalImmutableError(
      `Cannot send proposal with status '${existing.status}'. Proposals can only be sent from 'draft' or 'sent' state.`,
    );
  }

  // Resolve recipient email: explicit parameter or client contact email
  let recipientEmail = validated.recipientEmail?.trim();
  if (!recipientEmail) {
    const [contactRow] = await client
      .select({ email: clientContacts.email })
      .from(clientContacts)
      .where(eq(clientContacts.clientId, existing.clientId))
      .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.createdAt))
      .limit(1);

    recipientEmail = contactRow?.email?.trim();
  }

  if (!recipientEmail) {
    throw new Error('Recipient email is required to send proposal');
  }

  // Generate 32-byte URL-safe base64 secret token
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const now = new Date();
  const validUntil = validated.validUntil ?? existing.validUntil;

  const result = await client.transaction(async (tx) => {
    // 1. Update proposal to 'sent'
    const [updated] = (await tx
      .update(proposals)
      .set({
        status: 'sent',
        tokenHash,
        tokenRevokedAt: null,
        sentAt: now,
        validUntil,
        updatedAt: now,
      })
      .where(eq(proposals.id, existing.id))
      .returning()) as [Proposal];

    // 2. Enqueue proposal_sent outbox row with token link in single transaction (AC-1)
    await enqueueProposalEmail({
      proposalId: updated.id,
      kind: 'proposal_sent',
      recipient: recipientEmail,
      payload: {
        token: rawToken,
        tokenUrl: `/p/${rawToken}`,
      },
      tx,
    });

    // 3. Emit client relationship timeline event (proposal.sent)
    await recordTimelineEvent(tx, {
      clientId: updated.clientId,
      type: 'proposal.sent',
      actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
      actorId: auth.user.id,
      subjectType: 'proposal',
      subjectId: updated.id,
      data: {
        proposal_id: updated.id,
        total_minor: updated.totalMinor,
        currency: updated.currency,
      },
    });

    // 4. Emit audit log event (proposal.sent)
    await audit(
      {
        actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
        actorId: auth.user.id,
        action: 'proposal.sent',
        targetType: 'proposal',
        targetId: updated.id,
        outcome: 'success',
        metadata: {
          proposal_id: updated.id,
          project_id: updated.projectId,
          client_id: updated.clientId,
          total_minor: updated.totalMinor,
          currency: updated.currency,
          valid_until: updated.validUntil ? updated.validUntil.toISOString() : null,
        },
      },
      tx,
    );

    return {
      proposalId: updated.id,
      rawToken,
      tokenUrl: `/p/${rawToken}`,
    };
  });

  return result;
}

/**
 * Revokes proposal secret token: sets token_revoked_at = now(), generates a fresh hash,
 * invalidating previous link and emitting proposal.revoked audit event (TASK-0060 / AC-3).
 */
export async function revokeProposalToken(
  rawInput: RevokeProposalTokenInput,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<RevokeProposalTokenActionResult> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = revokeProposalTokenSchema.parse(rawInput);

  const existing = await getProposalById(validated.proposalId, authOrOptions, client);
  if (!existing) {
    throw new ProposalNotFoundError();
  }

  // Generate new secret token and hash
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const now = new Date();

  await client.transaction(async (tx) => {
    await tx
      .update(proposals)
      .set({
        tokenHash,
        tokenRevokedAt: now,
        updatedAt: now,
      })
      .where(eq(proposals.id, existing.id));

    await audit(
      {
        actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
        actorId: auth.user.id,
        action: 'proposal.revoked',
        targetType: 'proposal',
        targetId: existing.id,
        outcome: 'success',
        metadata: {
          proposal_id: existing.id,
          project_id: existing.projectId,
          client_id: existing.clientId,
          reason: 'manual_revocation',
        },
      },
      tx,
    );
  });

  return {
    proposalId: existing.id,
    revokedAt: now,
  };
}
