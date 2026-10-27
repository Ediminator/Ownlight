'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { requireOwner, ForbiddenError, type AuthContext } from '@/server/auth/guards';
import { logger } from '@/server/log';
import {
  catalogueCategorySchema,
  saveCatalogueItemActionInputSchema,
  archiveCatalogueItemActionInputSchema,
  type SaveCatalogueItemActionInput,
  type ArchiveCatalogueItemActionInput,
} from './schema';
import {
  createCatalogueItem,
  updateCatalogueItem,
  deleteCatalogueItem,
  listCatalogueItems,
  type ListCatalogueItemsOptions,
} from './repo';
import type { CatalogueItem } from '@/server/db/schema/packages';

export type { SaveCatalogueItemActionInput, ArchiveCatalogueItemActionInput };

export type CatalogueActionResult<T = unknown> =
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
 * Creates or updates an add-on product or service in the studio catalogue.
 * Strictly requires authenticated studio owner.
 */
export async function saveCatalogueItemAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<CatalogueActionResult<CatalogueItem>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = saveCatalogueItemActionInputSchema.safeParse(rawInput);
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

    let result: CatalogueItem;
    if (input.id) {
      result = await updateCatalogueItem(
        input.id,
        {
          name: input.name,
          slug: input.slug,
          description: input.description,
          category: input.category,
          unitPriceMinor: input.unitPriceMinor,
          currency: input.currency,
          taxRateBasisPoints: input.taxRateBasisPoints,
          position: input.position,
          isActive: input.isActive,
        },
        { auth, client },
      );
    } else {
      result = await createCatalogueItem(
        {
          name: input.name,
          slug: input.slug,
          description: input.description,
          category: input.category,
          unitPriceMinor: input.unitPriceMinor,
          currency: input.currency,
          taxRateBasisPoints: input.taxRateBasisPoints,
          position: input.position,
          isActive: input.isActive,
        },
        { auth, client },
      );
    }

    safeRevalidate('/settings/packages');
    return { success: true, data: result };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to save catalogue item',
    );
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: error instanceof Error ? error.message : 'Failed to save catalogue item',
    };
  }
}

/**
 * Soft deactivates (archives) or restores a catalogue item by updating is_active.
 * Strictly requires authenticated studio owner.
 */
export async function archiveCatalogueItemAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<CatalogueActionResult<{ id: string; isActive: boolean }>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = archiveCatalogueItemActionInputSchema.safeParse(rawInput);
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
      const updated = await updateCatalogueItem(id, { isActive: true }, { auth, client });
      safeRevalidate('/settings/packages');
      return { success: true, data: { id: updated.id, isActive: true } };
    }

    const archived = await deleteCatalogueItem(id, { auth, client });
    safeRevalidate('/settings/packages');
    return { success: true, data: { id: archived.id, isActive: false } };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to archive catalogue item',
    );
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: error instanceof Error ? error.message : 'Failed to archive catalogue item',
    };
  }
}

/**
 * Lists catalogue items. Strictly requires authenticated owner.
 */
export async function listCatalogueItemsAction(
  options: ListCatalogueItemsOptions = {},
  client: DbClient = defaultDb,
): Promise<CatalogueActionResult<CatalogueItem[]>> {
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
    const data = await listCatalogueItems(options, { auth, client });
    return { success: true, data };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to list catalogue items',
    );
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: error instanceof Error ? error.message : 'Failed to list catalogue items',
    };
  }
}
