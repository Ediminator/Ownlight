'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { requireOwner, ForbiddenError, type AuthContext } from '@/server/auth/guards';
import { logger } from '@/server/log';
import {
  createContractTemplateSchema,
  updateContractTemplateActionInputSchema,
  archiveContractTemplateActionInputSchema,
  updateStudioSigningProfileSchema,
  type CreateContractTemplateInput,
  type UpdateContractTemplateActionInput,
  type ArchiveContractTemplateActionInput,
  type UpdateStudioSigningProfileInput,
} from './schema';
import {
  createContractTemplate,
  updateContractTemplate,
  deleteContractTemplate,
} from './template-repo';
import { updateStudioSigningProfile } from '@/server/studio/signing-settings';
import type { ContractTemplate } from '@/server/db/schema/contracts';
import type { StudioSettings } from '@/server/db/schema/studio-settings';

export type {
  CreateContractTemplateInput,
  UpdateContractTemplateActionInput,
  ArchiveContractTemplateActionInput,
  UpdateStudioSigningProfileInput,
};

export type ContractActionResult<T = unknown> =
  { success: true; data: T } | { success: false; code: string; error: string; fields?: string[] };

function safeRevalidate(path: string): void {
  try {
    revalidatePath(path);
  } catch {
    // Ignore outside Next.js request context (e.g. tests)
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatValidationIssues(error: z.ZodError): { error: string; fields: string[] } {
  return {
    error: error.issues[0]?.message ?? 'Validation failed',
    fields: error.issues.map((i) => i.path.join('.')),
  };
}

/**
 * Creates a new contract template.
 * Strictly requires authenticated studio owner (AC-4, AC-7).
 */
export async function createContractTemplateAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<ContractActionResult<ContractTemplate>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = createContractTemplateSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  try {
    const created = await createContractTemplate(parsed.data, { auth, client }, client);
    safeRevalidate('/settings/contracts');
    return { success: true, data: created };
  } catch (error) {
    const msg = getErrorMessage(error, String(error));
    logger.error({ error: msg }, 'Failed to create contract template');
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: getErrorMessage(error, 'Failed to create contract template'),
    };
  }
}

/**
 * Updates an existing contract template.
 * Strictly requires authenticated studio owner (AC-4, AC-7).
 */
export async function updateContractTemplateAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<ContractActionResult<ContractTemplate>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = updateContractTemplateActionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  try {
    const { id, ...data } = parsed.data;
    const updated = await updateContractTemplate(id, data, { auth, client }, client);
    safeRevalidate('/settings/contracts');
    return { success: true, data: updated };
  } catch (error) {
    const msg = getErrorMessage(error, String(error));
    logger.error({ error: msg }, 'Failed to update contract template');
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: getErrorMessage(error, 'Failed to update contract template'),
    };
  }
}

/**
 * Soft deactivates (archives) or restores a contract template by updating is_active.
 * Strictly requires authenticated studio owner (AC-5, AC-7).
 */
export async function archiveContractTemplateAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<ContractActionResult<{ id: string; isActive: boolean }>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = archiveContractTemplateActionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  try {
    const { id, isActive } = parsed.data;
    if (isActive) {
      const updated = await updateContractTemplate(
        id,
        { isActive: true },
        { auth, client },
        client,
      );
      safeRevalidate('/settings/contracts');
      return { success: true, data: { id: updated.id, isActive: true } };
    }

    const archived = await deleteContractTemplate(id, { auth, client }, client);
    safeRevalidate('/settings/contracts');
    return { success: true, data: { id: archived.id, isActive: false } };
  } catch (error) {
    const msg = getErrorMessage(error, String(error));
    logger.error({ error: msg }, 'Failed to archive contract template');
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: getErrorMessage(error, 'Failed to archive contract template'),
    };
  }
}

/**
 * Updates studio contract signing profile and physical address details (AC-6).
 * Strictly requires authenticated studio owner (AC-6, AC-7).
 */
export async function updateStudioSigningSettingsAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<ContractActionResult<StudioSettings>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = updateStudioSigningProfileSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  try {
    const updated = await updateStudioSigningProfile(parsed.data, { auth, client }, client);
    safeRevalidate('/settings/contracts');
    return { success: true, data: updated };
  } catch (error) {
    const msg = getErrorMessage(error, String(error));
    logger.error({ error: msg }, 'Failed to update studio signing settings');
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: getErrorMessage(error, 'Failed to update studio signing settings'),
    };
  }
}
