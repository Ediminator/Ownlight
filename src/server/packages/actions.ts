'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { requireOwner, ForbiddenError, type AuthContext } from '@/server/auth/guards';
import { logger } from '@/server/log';
import {
  savePackageActionInputSchema,
  archivePackageActionInputSchema,
  type SavePackageActionInput,
  type ArchivePackageActionInput,
} from './schema';
import {
  createPackage,
  updatePackage,
  deletePackage,
  listPackages,
  type PackageWithIncludedItems,
  type ListPackagesOptions,
} from './repo';

export type { SavePackageActionInput, ArchivePackageActionInput };

export type PackageActionResult<T = unknown> =
  { success: true; data: T } | { success: false; code: string; error: string; fields?: string[] };

function safeRevalidate(path: string): void {
  try {
    revalidatePath(path);
  } catch {
    // Ignore outside Next.js request context (e.g. tests)
  }
}

function formatValidationIssues(error: z.ZodError): { error: string; fields: string[] } {
  return {
    error: error.issues[0]?.message ?? 'Validation failed',
    fields: error.issues.map((i) => i.path.join('.')),
  };
}

/**
 * Creates or updates a photography service package and its included deliverables.
 * Strictly requires authenticated studio owner.
 */
export async function savePackageAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<PackageActionResult<PackageWithIncludedItems>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = savePackageActionInputSchema.safeParse(rawInput);
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
    const input = parsed.data;
    const name = (input.name ?? input.title ?? '').trim();

    let result: PackageWithIncludedItems;
    if (input.id) {
      result = await updatePackage(
        input.id,
        {
          name,
          slug: input.slug,
          description: input.description,
          projectTypeKey: input.projectTypeKey,
          basePriceMinor: input.basePriceMinor,
          currency: input.currency,
          taxRateBasisPoints: input.taxRateBasisPoints,
          position: input.position,
          isActive: input.isActive,
          includedItems: input.includedItems,
        },
        { auth, client },
      );
    } else {
      result = await createPackage(
        {
          name,
          slug: input.slug,
          description: input.description,
          projectTypeKey: input.projectTypeKey,
          basePriceMinor: input.basePriceMinor,
          currency: input.currency,
          taxRateBasisPoints: input.taxRateBasisPoints,
          position: input.position,
          isActive: input.isActive,
          includedItems: input.includedItems,
        },
        { auth, client },
      );
    }

    safeRevalidate('/settings/packages');
    return { success: true, data: result };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to save package',
    );
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: error instanceof Error ? error.message : 'Failed to save package',
    };
  }
}

/**
 * Soft deactivates (archives) or restores a package by updating is_active.
 * Strictly requires authenticated studio owner.
 */
export async function archivePackageAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<PackageActionResult<{ id: string; isActive: boolean }>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = archivePackageActionInputSchema.safeParse(rawInput);
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
      const updated = await updatePackage(id, { isActive: true }, { auth, client });
      safeRevalidate('/settings/packages');
      return { success: true, data: { id: updated.id, isActive: true } };
    }

    const archived = await deletePackage(id, { auth, client });
    safeRevalidate('/settings/packages');
    return { success: true, data: { id: archived.id, isActive: false } };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to archive package',
    );
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: error instanceof Error ? error.message : 'Failed to archive package',
    };
  }
}

/**
 * Lists packages with included items. Strictly requires authenticated owner.
 */
export async function listPackagesAction(
  options: ListPackagesOptions = {},
  client: DbClient = defaultDb,
): Promise<PackageActionResult<PackageWithIncludedItems[]>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  try {
    const data = await listPackages(options, { auth, client });
    return { success: true, data };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to list packages',
    );
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: error instanceof Error ? error.message : 'Failed to list packages',
    };
  }
}
