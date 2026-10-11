'use server';

import 'server-only';
import { requireAuth, UnauthorizedError, ForbiddenError } from '@/server/auth/guards';
import { authorizeClientRead, authorizeClientWrite } from '@/server/clients/policy';
import { recordConsentInputSchema, listConsentsInputSchema } from './schema';
import * as consentService from './service';
import type { ClientConsentsResult } from './repo';

export type ConsentActionResult<T> = consentService.ConsentServiceResult<T>;

function extractClientId(input: unknown): string | null {
  if (input !== null && typeof input === 'object' && 'clientId' in input) {
    const val = (input as Record<string, unknown>).clientId;
    if (typeof val === 'string' && val.length > 0) {
      return val;
    }
  }
  return null;
}

function handleValidationError(error: {
  issues: { path: (string | number)[]; keys?: string[] }[];
}): ConsentActionResult<never> {
  const fields = Array.from(
    new Set(
      error.issues.flatMap((issue) => {
        const result: string[] = [];
        if (Array.isArray(issue.keys)) {
          result.push(...issue.keys);
        }
        if (issue.path.length > 0) {
          const fullPath = issue.path.join('.');
          if (fullPath) result.push(fullPath);
          const leaf = String(issue.path[issue.path.length - 1]);
          if (leaf && leaf !== 'undefined') result.push(leaf);
        }
        return result;
      }),
    ),
  );

  return {
    success: false,
    code: 'VALIDATION_FAILED',
    error: 'VALIDATION_FAILED',
    fields,
  };
}

/**
 * Records a new consent decision (grant or withdrawal) for a contact.
 * Requires owner role and clients:write scope.
 */
export async function recordConsentAction(
  rawInput: unknown,
): Promise<ConsentActionResult<{ consentId: string }>> {
  let auth;
  try {
    auth = await requireAuth();
    await authorizeClientWrite('consent.recorded', extractClientId(rawInput), auth);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
    }
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    throw err;
  }

  const parsed = recordConsentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return handleValidationError(parsed.error);
  }

  return await consentService.recordConsent(parsed.data, auth);
}

/**
 * Lists current consent status per purpose and full history for all contacts of a client.
 * Requires owner role and clients:read scope.
 */
export async function listConsentsAction(
  rawInput: unknown,
): Promise<ConsentActionResult<ClientConsentsResult>> {
  let auth;
  try {
    auth = await requireAuth();
    await authorizeClientRead(auth);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
    }
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    throw err;
  }

  const parsed = listConsentsInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return handleValidationError(parsed.error);
  }

  return await consentService.listConsents(parsed.data.clientId, auth);
}
