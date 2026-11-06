import { eq, and, desc, asc, isNull } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import {
  contractTemplates,
  type ContractTemplate,
  type NewContractTemplate,
} from '@/server/db/schema/contracts';
import { audit } from '@/server/audit';
import { resolveRepoAuth, type RepoAuthInput } from '@/server/auth/repo-auth';
import {
  createContractTemplateSchema,
  updateContractTemplateSchema,
  type CreateContractTemplateInput,
  type UpdateContractTemplateInput,
} from './schema';

export class ContractTemplateNotFoundError extends Error {
  public readonly code = 'NOT_FOUND';
  public readonly statusCode = 404;

  constructor(message = 'Contract template not found') {
    super(message);
    this.name = 'ContractTemplateNotFoundError';
  }
}

export interface ListContractTemplatesOptions {
  activeOnly?: boolean;
  projectTypeKey?: string | null;
}

/**
 * Lists contract templates ordered by name.
 * Strictly requires authenticated studio owner (AC-7).
 */
export async function listContractTemplates(
  options?: ListContractTemplatesOptions,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<ContractTemplate[]> {
  const { client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const conditions = [];

  if (options?.activeOnly) {
    conditions.push(eq(contractTemplates.isActive, true));
  }

  if (options?.projectTypeKey !== undefined) {
    if (options.projectTypeKey === null) {
      conditions.push(isNull(contractTemplates.projectTypeKey));
    } else {
      conditions.push(eq(contractTemplates.projectTypeKey, options.projectTypeKey));
    }
  }

  const query = client.select().from(contractTemplates);

  if (conditions.length > 0) {
    return query
      .where(and(...conditions))
      .orderBy(desc(contractTemplates.isDefault), asc(contractTemplates.name));
  }

  return query.orderBy(desc(contractTemplates.isDefault), asc(contractTemplates.name));
}

/**
 * Retrieves a single contract template by its UUID.
 * Strictly requires authenticated studio owner (AC-7).
 */
export async function getContractTemplateById(
  id: string,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<ContractTemplate> {
  const { client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const [template] = await client
    .select()
    .from(contractTemplates)
    .where(eq(contractTemplates.id, id))
    .limit(1);

  if (!template) {
    throw new ContractTemplateNotFoundError(`Contract template not found: ${id}`);
  }

  return template;
}

/**
 * Retrieves a single contract template by unique slug.
 * Strictly requires authenticated studio owner (AC-7).
 */
export async function getContractTemplateBySlug(
  slug: string,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<ContractTemplate> {
  const { client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const [template] = await client
    .select()
    .from(contractTemplates)
    .where(eq(contractTemplates.slug, slug))
    .limit(1);

  if (!template) {
    throw new ContractTemplateNotFoundError(`Contract template not found with slug: ${slug}`);
  }

  return template;
}

/**
 * Creates a new contract template and records audit event contract_template.created (AC-1).
 * Strictly requires authenticated studio owner (AC-7).
 */
export async function createContractTemplate(
  rawInput: CreateContractTemplateInput,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<ContractTemplate> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = createContractTemplateSchema.parse(rawInput);

  // If this template is set as default for a project type, unset existing default
  if (validated.isDefault) {
    if (validated.projectTypeKey) {
      await client
        .update(contractTemplates)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(contractTemplates.projectTypeKey, validated.projectTypeKey),
            eq(contractTemplates.isDefault, true),
          ),
        );
    } else {
      await client
        .update(contractTemplates)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(isNull(contractTemplates.projectTypeKey), eq(contractTemplates.isDefault, true)),
        );
    }
  }

  const [created] = await client
    .insert(contractTemplates)
    .values({
      name: validated.name,
      slug: validated.slug,
      description: validated.description ?? null,
      projectTypeKey: validated.projectTypeKey ?? null,
      contentEn: validated.contentEn,
      contentDe: validated.contentDe,
      isDefault: validated.isDefault,
      isActive: validated.isActive,
    })
    .returning();

  if (!created) {
    throw new Error('Failed to create contract template');
  }

  // Record audit log
  await audit(
    {
      actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
      actorId: auth.user.id,
      action: 'contract_template.created',
      targetType: 'contract_template',
      targetId: created.id,
      outcome: 'success',
      metadata: {
        template_id: created.id,
        slug: created.slug,
        name: created.name,
        project_type_key: created.projectTypeKey ?? undefined,
        is_default: created.isDefault,
      },
    },
    client,
  );

  return created;
}

/**
 * Updates an existing contract template and records audit event contract_template.updated (AC-2).
 * Strictly requires authenticated studio owner (AC-7).
 */
export async function updateContractTemplate(
  id: string,
  rawInput: UpdateContractTemplateInput,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<ContractTemplate> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = updateContractTemplateSchema.parse(rawInput);

  const existing = await getContractTemplateById(id, auth, client);
  const now = new Date();

  const updatePayload: Partial<NewContractTemplate> = {
    updatedAt: now,
  };
  const changedFields: string[] = [];

  if (validated.name !== undefined) {
    updatePayload.name = validated.name;
    changedFields.push('name');
  }
  if (validated.slug !== undefined) {
    updatePayload.slug = validated.slug;
    changedFields.push('slug');
  }
  if (validated.description !== undefined) {
    updatePayload.description = validated.description;
    changedFields.push('description');
  }
  if (validated.projectTypeKey !== undefined) {
    updatePayload.projectTypeKey = validated.projectTypeKey;
    changedFields.push('projectTypeKey');
  }
  if (validated.contentEn !== undefined) {
    updatePayload.contentEn = validated.contentEn;
    changedFields.push('contentEn');
  }
  if (validated.contentDe !== undefined) {
    updatePayload.contentDe = validated.contentDe;
    changedFields.push('contentDe');
  }
  if (validated.isActive !== undefined) {
    updatePayload.isActive = validated.isActive;
    changedFields.push('isActive');
  }
  if (validated.isDefault !== undefined) {
    updatePayload.isDefault = validated.isDefault;
    changedFields.push('isDefault');

    if (validated.isDefault) {
      const targetTypeKey = validated.projectTypeKey ?? existing.projectTypeKey;
      if (targetTypeKey) {
        await client
          .update(contractTemplates)
          .set({ isDefault: false, updatedAt: now })
          .where(
            and(
              eq(contractTemplates.projectTypeKey, targetTypeKey),
              eq(contractTemplates.isDefault, true),
            ),
          );
      } else {
        await client
          .update(contractTemplates)
          .set({ isDefault: false, updatedAt: now })
          .where(
            and(isNull(contractTemplates.projectTypeKey), eq(contractTemplates.isDefault, true)),
          );
      }
    }
  }

  const [updated] = await client
    .update(contractTemplates)
    .set(updatePayload)
    .where(eq(contractTemplates.id, id))
    .returning();

  if (!updated) {
    throw new ContractTemplateNotFoundError(`Contract template not found: ${id}`);
  }

  // Record audit log
  await audit(
    {
      actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
      actorId: auth.user.id,
      action: 'contract_template.updated',
      targetType: 'contract_template',
      targetId: updated.id,
      outcome: 'success',
      metadata: {
        template_id: updated.id,
        slug: updated.slug,
        name: updated.name,
        changed_fields: changedFields,
      },
    },
    client,
  );

  return updated;
}

/**
 * Soft deletes a contract template by setting isActive = false and emits contract_template.deleted (AC-2).
 * Strictly requires authenticated studio owner (AC-7).
 */
export async function deleteContractTemplate(
  id: string,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<ContractTemplate> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  await getContractTemplateById(id, auth, client);

  const [updated] = await client
    .update(contractTemplates)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(eq(contractTemplates.id, id))
    .returning();

  if (!updated) {
    throw new ContractTemplateNotFoundError(`Contract template not found: ${id}`);
  }

  // Record audit log
  await audit(
    {
      actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
      actorId: auth.user.id,
      action: 'contract_template.deleted',
      targetType: 'contract_template',
      targetId: updated.id,
      outcome: 'success',
      metadata: {
        template_id: updated.id,
        slug: updated.slug,
      },
    },
    client,
  );

  return updated;
}
