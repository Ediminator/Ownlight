'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { requireOwner, ForbiddenError, type AuthContext } from '@/server/auth/guards';
import { logger } from '@/server/log';
import { saveDraftProposalSchema, sendProposalSchema, revokeProposalTokenSchema } from './schema';
import * as service from './service';
import { ProposalNotFoundError, ProposalForbiddenError, type ProposalWithLineItems } from './repo';
import { ProposalImmutableError } from './snapshot';

export type ProposalActionResult<T = unknown> =
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
 * Creates or updates a draft proposal and its line items transactionally (TASK-0060 / AC-8).
 * Strictly requires authenticated studio owner.
 */
export async function saveDraftProposalAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<ProposalActionResult<ProposalWithLineItems>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = saveDraftProposalSchema.safeParse(rawInput);
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
    const result = await service.saveDraftProposal(parsed.data, { auth, client }, client);
    safeRevalidate(`/projects/${result.projectId}`);
    return { success: true, data: result };
  } catch (err) {
    if (err instanceof ProposalNotFoundError) {
      return { success: false, code: 'NOT_FOUND', error: err.message };
    }
    if (err instanceof ProposalForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: err.message };
    }
    if (err instanceof ProposalImmutableError) {
      return { success: false, code: 'IMMUTABLE', error: err.message };
    }
    logger.error(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      'Unexpected error in saveDraftProposalAction',
    );
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: err instanceof Error ? err.message : 'Internal error saving draft proposal',
    };
  }
}

/**
 * Sends a proposal to the client: generates 32-byte secret token, updates status to 'sent',
 * queues proposal_sent email outbox item in the same transaction, and emits timeline and audit events (TASK-0060 / AC-1).
 * Strictly requires authenticated studio owner.
 */
export async function sendProposalAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<ProposalActionResult<service.SendProposalResult>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = sendProposalSchema.safeParse(rawInput);
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
    const result = await service.sendProposal(parsed.data, { auth, client }, client);
    safeRevalidate('/projects');
    return { success: true, data: result };
  } catch (err) {
    if (err instanceof ProposalNotFoundError) {
      return { success: false, code: 'NOT_FOUND', error: err.message };
    }
    if (err instanceof ProposalImmutableError) {
      return { success: false, code: 'IMMUTABLE', error: err.message };
    }
    logger.error(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      'Unexpected error in sendProposalAction',
    );
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: err instanceof Error ? err.message : 'Internal error sending proposal',
    };
  }
}

/**
 * Revokes public access token for a proposal, setting token_revoked_at = now() and generating a fresh hash (TASK-0060 / AC-3).
 * Strictly requires authenticated studio owner.
 */
export async function revokeProposalTokenAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<ProposalActionResult<service.RevokeProposalTokenActionResult>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = revokeProposalTokenSchema.safeParse(rawInput);
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
    const result = await service.revokeProposalToken(parsed.data, { auth, client }, client);
    safeRevalidate('/projects');
    return { success: true, data: result };
  } catch (err) {
    if (err instanceof ProposalNotFoundError) {
      return { success: false, code: 'NOT_FOUND', error: err.message };
    }
    logger.error(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      'Unexpected error in revokeProposalTokenAction',
    );
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: err instanceof Error ? err.message : 'Internal error revoking proposal token',
    };
  }
}
