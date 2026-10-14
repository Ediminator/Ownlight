'use server';

import 'server-only';
import { headers } from 'next/headers';
import { db, type DbClient } from '@/server/db/client';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { eq, and } from 'drizzle-orm';
import {
  requireOwnerSession,
  extractBearerToken,
  ForbiddenError,
  type AuthContext,
} from '@/server/auth/guards';
import { assertFreshReauthentication } from '@/server/auth/reauth';
import { env, clientEnv } from '@/env';
import { planErasureInputSchema, executeErasureInputSchema } from './schema';
import * as erasureService from './service';
import type { ErasureResult } from './types';

export type PlanErasureActionResult =
  | {
      success: true;
      plan: erasureService.ExtendedErasurePlan;
    }
  | {
      success: false;
      code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_FAILED';
      error: string;
    };

export type ExecuteErasureActionResult = ErasureResult;

async function verifyRequestSecurity(): Promise<{ allowed: boolean; code?: 'FORBIDDEN' }> {
  let reqHeaders: Headers | undefined;
  try {
    reqHeaders = await headers();
  } catch {
    reqHeaders = undefined;
  }

  if (reqHeaders) {
    // 1. Reject API keys even with wildcard scope (AC-7)
    const bearer = extractBearerToken(reqHeaders);
    if (bearer) {
      return { allowed: false, code: 'FORBIDDEN' };
    }

    // 2. Reject foreign origin (AC-7 CSRF defense)
    const origin = reqHeaders.get('origin');
    if (origin) {
      let isAllowed = false;
      const host = reqHeaders.get('host');
      if (host) {
        try {
          const parsedOrigin = new URL(origin);
          if (parsedOrigin.host === host) isAllowed = true;
        } catch {
          // Ignore
        }
      }

      if (!isAllowed) {
        try {
          const authOrigin = new URL(env.AUTH_URL).origin;
          if (origin === authOrigin) isAllowed = true;
        } catch {
          // Ignore
        }
      }

      if (!isAllowed) {
        try {
          const clientAppOrigin = new URL(clientEnv.NEXT_PUBLIC_APP_URL).origin;
          if (origin === clientAppOrigin) isAllowed = true;
        } catch {
          // Ignore
        }
      }

      if (!isAllowed) {
        return { allowed: false, code: 'FORBIDDEN' };
      }
    }
  }

  return { allowed: true };
}

/**
 * Plans subject erasure: calculates category counts, evaluates holds,
 * and checks if notes may mention the person.
 */
export async function planErasureAction(rawInput: unknown): Promise<PlanErasureActionResult> {
  const security = await verifyRequestSecurity();
  if (!security.allowed) {
    return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
  }

  try {
    await requireOwnerSession();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  const parsed = planErasureInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, code: 'VALIDATION_FAILED', error: 'VALIDATION_FAILED' };
  }

  const plan = await erasureService.planErasure(parsed.data.subject);
  if (!plan) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  return {
    success: true,
    plan,
  };
}

/**
 * Executes subject erasure after verifying step-up re-authentication,
 * confirmation matching client display name, and active retention holds.
 */
export async function executeErasureAction(rawInput: unknown): Promise<ExecuteErasureActionResult> {
  const security = await verifyRequestSecurity();
  if (!security.allowed) {
    return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerSession();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  const parsed = executeErasureInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, code: 'VALIDATION_FAILED', error: 'VALIDATION_FAILED' };
  }

  const { subject, confirmation } = parsed.data;

  // Step-up re-authentication within 5 minutes (AC-7)
  try {
    await assertFreshReauthentication(auth.user.id);
  } catch {
    return {
      success: false,
      code: 'REAUTH_REQUIRED',
      error: 'REAUTH_REQUIRED',
    };
  }

  // Verify subject existence and IDOR scoped by clientId
  const [clientRow] = await db
    .select({ id: clients.id, displayName: clients.displayName })
    .from(clients)
    .where(eq(clients.id, subject.clientId))
    .limit(1);

  if (!clientRow) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  if (subject.kind === 'contact') {
    const [contactRow] = await db
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.id, subject.contactId),
          eq(clientContacts.clientId, subject.clientId),
        ),
      )
      .limit(1);

    if (!contactRow) {
      return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
    }
  }

  // Validate confirmation matches client display name exactly
  if (confirmation.trim() !== clientRow.displayName.trim()) {
    return {
      success: false,
      code: 'CONFIRMATION_MISMATCH',
      error: 'Confirmation does not match client name',
    };
  }

  // Execute subject erasure
  return await erasureService.eraseSubject(subject, {
    actor: {
      actorType: 'owner',
      actorId: auth.user.id,
    },
  });
}

export type EraseClientDataActionResult =
  | ExecuteErasureActionResult
  | { success: false; code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'VALIDATION_FAILED'; error: string };

/**
 * Production erasure action for client data (AC-2, AC-3, AC-4, AC-7).
 * Governed by Process Rule R-A.
 */
export async function eraseClientDataAction(
  rawInput: unknown,
  client: DbClient = db,
): Promise<EraseClientDataActionResult> {
  const security = await verifyRequestSecurity();
  if (!security.allowed) {
    return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  // Support either { clientId: string, confirmation: string } or { subject: ErasureSubject, confirmation: string }
  let payload: unknown = rawInput;
  if (typeof payload === 'object' && payload !== null) {
    const obj = payload as Record<string, unknown>;
    if ('clientId' in obj && !('subject' in obj)) {
      payload = {
        subject: { kind: 'client', clientId: obj.clientId },
        confirmation: obj.confirmation,
      };
    }
  }

  const parsed = executeErasureInputSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, code: 'VALIDATION_FAILED', error: 'VALIDATION_FAILED' };
  }

  const { subject, confirmation } = parsed.data;

  // Step-up re-authentication within 5 minutes
  try {
    await assertFreshReauthentication(auth.user.id, client, auth.session?.token);
  } catch {
    return {
      success: false,
      code: 'REAUTH_REQUIRED',
      error: 'REAUTH_REQUIRED',
    };
  }

  // Verify subject existence
  const [clientRow] = await client
    .select({ id: clients.id, displayName: clients.displayName })
    .from(clients)
    .where(eq(clients.id, subject.clientId))
    .limit(1);

  if (!clientRow) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  if (subject.kind === 'contact') {
    const [contactRow] = await client
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.id, subject.contactId),
          eq(clientContacts.clientId, subject.clientId),
        ),
      )
      .limit(1);

    if (!contactRow) {
      return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
    }
  }

  // Validate confirmation matches client display name exactly
  if (confirmation.trim() !== clientRow.displayName.trim()) {
    return {
      success: false,
      code: 'CONFIRMATION_MISMATCH',
      error: 'Confirmation does not match client name',
    };
  }

  // Execute subject erasure
  return await erasureService.eraseSubject(
    subject,
    {
      actor: {
        actorType: 'owner',
        actorId: auth.user.id,
      },
    },
    client,
  );
}
