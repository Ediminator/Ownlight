'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { requireOwner, ForbiddenError, type AuthContext } from '@/server/auth/guards';
import { logger } from '@/server/log';
import { updateStudioTaxSettingsSchema } from './tax-settings-schema';
import { updateStudioTaxSettings, getStudioTaxSettings } from './tax-settings';
import type { StudioSettings } from '@/server/db/schema/studio-settings';

export type StudioActionResult<T = unknown> =
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
 * Updates studio tax settings (tax numbers, Kleinunternehmerregelung §19 UStG, default VAT rate, pricing display mode).
 * Strictly requires authenticated studio owner.
 */
export async function updateStudioTaxSettingsAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<StudioActionResult<StudioSettings>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = updateStudioTaxSettingsSchema.safeParse(rawInput);
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
    const updated = await updateStudioTaxSettings(parsed.data, { auth, client });
    safeRevalidate('/settings/packages');
    return { success: true, data: updated };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to update studio tax settings',
    );
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: error instanceof Error ? error.message : 'Failed to update studio tax settings',
    };
  }
}

/**
 * Retrieves studio settings containing tax configuration.
 * Strictly requires authenticated studio owner.
 */
export async function getStudioTaxSettingsAction(
  client: DbClient = defaultDb,
): Promise<StudioActionResult<StudioSettings>> {
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
    const data = await getStudioTaxSettings({ auth, client });
    return { success: true, data };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to get studio tax settings',
    );
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: error instanceof Error ? error.message : 'Failed to get studio tax settings',
    };
  }
}
