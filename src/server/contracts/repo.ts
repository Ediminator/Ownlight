import { randomBytes, createHash } from 'node:crypto';
import { eq, desc, like } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { contracts, type Contract, type NewContract } from '@/server/db/schema/contracts';
import { projects } from '@/server/db/schema/projects';
import { contractTemplates } from '@/server/db/schema/contracts';
import { proposals } from '@/server/db/schema/proposals';
import { audit } from '@/server/audit';
import { resolveRepoAuth, type RepoAuthInput } from '@/server/auth/repo-auth';
import { recordTimelineEvent } from '@/server/timeline/service';
import { freezeContractSnapshot, computeCanonicalSha256 } from './merge-engine';
import {
  createContractDraftSchema,
  updateContractDraftSchema,
  voidContractSchema,
  type CreateContractDraftInput,
  type UpdateContractDraftInput,
} from './schema';

export class ContractNotFoundError extends Error {
  public readonly code = 'NOT_FOUND';
  public readonly statusCode = 404;

  constructor(message = 'Contract not found') {
    super(message);
    this.name = 'ContractNotFoundError';
  }
}

export class ContractForbiddenError extends Error {
  public readonly code = 'FORBIDDEN';
  public readonly statusCode = 403;

  constructor(message = 'FORBIDDEN') {
    super(message);
    this.name = 'ContractForbiddenError';
  }
}

export class ContractImmutableError extends Error {
  public readonly code = 'IMMUTABLE';
  public readonly statusCode = 400;

  constructor(message = 'Contract cannot be modified because it is no longer in draft status') {
    super(message);
    this.name = 'ContractImmutableError';
  }
}

export class ContractStateTransitionError extends Error {
  public readonly code = 'INVALID_TRANSITION';
  public readonly statusCode = 400;

  constructor(message = 'Invalid contract state transition') {
    super(message);
    this.name = 'ContractStateTransitionError';
  }
}

export interface CreateContractDraftResult extends Contract {
  rawToken: string;
}

/**
 * Computes next sequential contract number for given year (e.g. CTR-2026-0001).
 */
export async function generateNextContractNumber(
  client: DbClient,
  year = new Date().getFullYear(),
): Promise<string> {
  const prefix = `CTR-${String(year)}-`;
  const existingContracts = await client
    .select({ contractNumber: contracts.contractNumber })
    .from(contracts)
    .where(like(contracts.contractNumber, `${prefix}%`));

  let maxSeq = 0;
  for (const c of existingContracts) {
    const parts = c.contractNumber.split('-');
    const seqPart = parts[2];
    if (parts.length === 3 && seqPart) {
      const num = parseInt(seqPart, 10);
      if (!Number.isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  const nextSeq = maxSeq + 1;
  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

/**
 * Lists contracts for a specific project.
 * Strictly requires authenticated studio owner (AC-7).
 */
export async function listContractsForProject(
  projectId: string,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<Contract[]> {
  const { client } = await resolveRepoAuth(authOrOptions, explicitClient);

  return client
    .select()
    .from(contracts)
    .where(eq(contracts.projectId, projectId))
    .orderBy(desc(contracts.createdAt));
}

/**
 * Retrieves a contract by UUID.
 * Strictly requires authenticated studio owner (AC-7).
 */
export async function getContractById(
  id: string,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<Contract> {
  const { client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const [contract] = await client.select().from(contracts).where(eq(contracts.id, id)).limit(1);

  if (!contract) {
    throw new ContractNotFoundError(`Contract not found: ${id}`);
  }

  return contract;
}

/**
 * Retrieves a contract by public token hash (for public signing route).
 * Does not require owner authorization, but returns 404 if not found.
 */
export async function getContractByTokenHash(
  tokenHash: string,
  explicitClient?: DbClient,
): Promise<Contract> {
  const client = explicitClient ?? (await resolveRepoAuth(null, explicitClient)).client;

  const [contract] = await client
    .select()
    .from(contracts)
    .where(eq(contracts.tokenHash, tokenHash))
    .limit(1);

  if (!contract) {
    throw new ContractNotFoundError('Contract not found for token hash');
  }

  return contract;
}

/**
 * Creates a new contract draft with sequential CTR-YYYY-NNNN identifier (AC-5).
 * Validates project exists and belongs to client.
 * Strictly requires authenticated studio owner (AC-7).
 */
export async function createContractDraft(
  rawInput: CreateContractDraftInput,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<CreateContractDraftResult> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = createContractDraftSchema.parse(rawInput);

  // 1. Verify project exists and matches clientId (AC-8)
  const [project] = await client
    .select()
    .from(projects)
    .where(eq(projects.id, validated.projectId))
    .limit(1);

  if (!project) {
    throw new ContractForbiddenError('Project does not exist or access is forbidden');
  }

  if (project.clientId !== validated.clientId) {
    throw new ContractForbiddenError('FORBIDDEN: Project does not belong to the specified client');
  }

  // 2. If templateId provided, verify template exists
  let templateBody = '';
  if (validated.templateId) {
    const [tpl] = await client
      .select()
      .from(contractTemplates)
      .where(eq(contractTemplates.id, validated.templateId))
      .limit(1);

    if (!tpl) {
      throw new ContractNotFoundError(`Contract template not found: ${validated.templateId}`);
    }
    templateBody = validated.locale === 'de' ? tpl.contentDe : tpl.contentEn;
  }

  // 3. If proposalId provided, verify proposal exists
  if (validated.proposalId) {
    const [prop] = await client
      .select({ id: proposals.id })
      .from(proposals)
      .where(eq(proposals.id, validated.proposalId))
      .limit(1);

    if (!prop) {
      throw new ContractNotFoundError(`Proposal not found: ${validated.proposalId}`);
    }
  }

  // 4. Determine body text & snapshot
  const bodyText = validated.renderedBody ?? templateBody;
  const snapshot = freezeContractSnapshot(bodyText, validated.mergeValuesSnapshot ?? {});

  // 5. Generate sequential contract number
  const contractNumber = await generateNextContractNumber(client);

  // 6. Generate secret 32-byte signing token
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  // 7. Insert draft contract
  const [created] = await client
    .insert(contracts)
    .values({
      projectId: validated.projectId,
      clientId: validated.clientId,
      proposalId: validated.proposalId ?? null,
      templateId: validated.templateId ?? null,
      contractNumber,
      title: validated.title,
      locale: validated.locale,
      status: 'draft',
      renderedBody: snapshot.rendered_body,
      mergeValuesSnapshot: snapshot.merge_values_snapshot,
      canonicalBodySha256: snapshot.canonical_body_sha256,
      validUntil: validated.validUntil ?? null,
      tokenHash,
      internalNotes: validated.internalNotes ?? null,
    })
    .returning();

  if (!created) {
    throw new Error('Failed to create contract draft');
  }

  // 8. Record audit log
  await audit(
    {
      actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
      actorId: auth.user.id,
      action: 'contract.created',
      targetType: 'contract',
      targetId: created.id,
      outcome: 'success',
      metadata: {
        contract_id: created.id,
        project_id: created.projectId,
        client_id: created.clientId,
        contract_number: created.contractNumber,
        title: created.title,
        locale: created.locale,
        status: created.status,
        template_id: created.templateId ?? undefined,
      },
    },
    client,
  );

  return {
    ...created,
    rawToken,
  };
}

/**
 * Updates an editable contract draft.
 * Fails with ContractImmutableError if status is not 'draft'.
 * Strictly requires authenticated studio owner (AC-7).
 */
export async function updateContractDraft(
  id: string,
  rawInput: UpdateContractDraftInput,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<Contract> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = updateContractDraftSchema.parse(rawInput);

  const existing = await getContractById(id, auth, client);

  if (existing.status !== 'draft') {
    throw new ContractImmutableError(
      `Contract cannot be modified: current status is '${existing.status}'`,
    );
  }

  const now = new Date();
  const updatePayload: Partial<NewContract> = {
    updatedAt: now,
  };
  const changedFields: string[] = [];

  if (validated.title !== undefined) {
    updatePayload.title = validated.title;
    changedFields.push('title');
  }
  if (validated.locale !== undefined) {
    updatePayload.locale = validated.locale;
    changedFields.push('locale');
  }
  if (validated.templateId !== undefined) {
    updatePayload.templateId = validated.templateId;
    changedFields.push('templateId');
  }
  if (validated.proposalId !== undefined) {
    updatePayload.proposalId = validated.proposalId;
    changedFields.push('proposalId');
  }
  if (validated.validUntil !== undefined) {
    updatePayload.validUntil = validated.validUntil;
    changedFields.push('validUntil');
  }
  if (validated.internalNotes !== undefined) {
    updatePayload.internalNotes = validated.internalNotes;
    changedFields.push('internalNotes');
  }
  if (validated.mergeValuesSnapshot !== undefined) {
    updatePayload.mergeValuesSnapshot = validated.mergeValuesSnapshot;
    changedFields.push('mergeValuesSnapshot');
  }
  if (validated.renderedBody !== undefined) {
    updatePayload.renderedBody = validated.renderedBody;
    updatePayload.canonicalBodySha256 = computeCanonicalSha256(validated.renderedBody);
    changedFields.push('renderedBody');
    changedFields.push('canonicalBodySha256');
  }

  const [updated] = await client
    .update(contracts)
    .set(updatePayload)
    .where(eq(contracts.id, id))
    .returning();

  if (!updated) {
    throw new ContractNotFoundError(`Contract not found: ${id}`);
  }

  // Record audit log
  await audit(
    {
      actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
      actorId: auth.user.id,
      action: 'contract.updated',
      targetType: 'contract',
      targetId: updated.id,
      outcome: 'success',
      metadata: {
        contract_id: updated.id,
        project_id: updated.projectId,
        client_id: updated.clientId,
        contract_number: updated.contractNumber,
        title: updated.title,
        status: updated.status,
        changed_fields: changedFields,
      },
    },
    client,
  );

  return updated;
}

/**
 * Voids an existing contract, revoking its signing token and recording timeline and audit events.
 * Strictly requires authenticated studio owner (AC-7).
 */
export async function voidContract(
  id: string,
  reason?: string | null,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<Contract> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = voidContractSchema.parse({ reason });

  const existing = await getContractById(id, auth, client);

  if (existing.status === 'voided') {
    return existing;
  }

  const now = new Date();
  const [updated] = await client
    .update(contracts)
    .set({
      status: 'voided',
      tokenRevokedAt: now,
      updatedAt: now,
    })
    .where(eq(contracts.id, id))
    .returning();

  if (!updated) {
    throw new ContractNotFoundError(`Contract not found: ${id}`);
  }

  // Record timeline event
  await recordTimelineEvent(client, {
    clientId: updated.clientId,
    type: 'contract.voided',
    occurredAt: now,
    actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
    actorId: auth.user.id,
    subjectType: 'contract',
    subjectId: updated.id,
    data: {
      contract_id: updated.id,
      contract_number: updated.contractNumber,
    },
  });

  // Record audit log
  await audit(
    {
      actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
      actorId: auth.user.id,
      action: 'contract.voided',
      targetType: 'contract',
      targetId: updated.id,
      outcome: 'success',
      metadata: {
        contract_id: updated.id,
        project_id: updated.projectId,
        client_id: updated.clientId,
        contract_number: updated.contractNumber,
        reason: validated.reason ?? undefined,
      },
    },
    client,
  );

  return updated;
}
