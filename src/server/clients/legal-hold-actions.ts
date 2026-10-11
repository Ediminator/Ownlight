'use server';

import 'server-only';
import { headers } from 'next/headers';
import { db } from '@/server/db/client';
import { clients } from '@/server/db/schema/clients';
import { type ClientLegalHold } from '@/server/db/schema/client-legal-holds';
import { eq } from 'drizzle-orm';
import {
  requireOwnerSession,
  extractBearerToken,
  ForbiddenError,
  type AuthContext,
} from '@/server/auth/guards';
import { getStudioSettings } from '@/server/settings/repo';
import { getTodayDateString } from '@/server/consents/schema';
import { audit } from '@/server/audit';
import {
  setLegalHoldInputSchema,
  releaseLegalHoldInputSchema,
  type SetLegalHoldInput,
  type ReleaseLegalHoldInput,
} from './legal-hold-schema';
import { getLegalHold, upsertLegalHold, deleteLegalHold } from './legal-hold-repo';

export type SetLegalHoldActionResult =
  | {
      success: true;
      hold: ClientLegalHold;
    }
  | {
      success: false;
      code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_FAILED' | 'INTERNAL_ERROR';
      error: string;
    };

export type ReleaseLegalHoldActionResult =
  | {
      success: true;
    }
  | {
      success: false;
      code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_FAILED' | 'INTERNAL_ERROR';
      error: string;
    };

/**
 * Sets or updates a manual legal hold on a client (AC-1, AC-2, AC-6).
 * Owner web session ONLY; API keys rejected.
 */
export async function setLegalHoldAction(
  rawInput: SetLegalHoldInput,
): Promise<SetLegalHoldActionResult> {
  let reqHeaders: Headers | undefined;
  try {
    reqHeaders = await headers();
  } catch {
    reqHeaders = undefined;
  }

  if (reqHeaders && extractBearerToken(reqHeaders)) {
    return {
      success: false,
      code: 'FORBIDDEN',
      error: 'API keys are not permitted for legal hold actions.',
    };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerSession();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return {
        success: false,
        code: 'FORBIDDEN',
        error: err.message,
      };
    }
    return {
      success: false,
      code: 'UNAUTHORIZED',
      error: 'Authentication required.',
    };
  }

  // 1. Validate input strictly (AC-2)
  const parsed = setLegalHoldInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues.map((i) => i.message).join(', '),
    };
  }

  const { clientId, reason, note, until } = parsed.data;

  // 2. Validate calendar date & future/today constraint against studio timezone
  if (until !== undefined && until !== null && until !== '') {
    const parts = until.split('-').map(Number);
    const y = parts[0];
    const m = parts[1];
    const d = parts[2];
    if (y === undefined || m === undefined || d === undefined || isNaN(y) || isNaN(m) || isNaN(d)) {
      return {
        success: false,
        code: 'VALIDATION_FAILED',
        error: 'Invalid calendar date for until.',
      };
    }
    const dateObj = new Date(Date.UTC(y, m - 1, d));
    if (
      dateObj.getUTCFullYear() !== y ||
      dateObj.getUTCMonth() !== m - 1 ||
      dateObj.getUTCDate() !== d
    ) {
      return {
        success: false,
        code: 'VALIDATION_FAILED',
        error: 'Invalid calendar date for until.',
      };
    }

    let studioTimezone = 'UTC';
    try {
      const settings = await getStudioSettings();
      studioTimezone = settings.timezone;
    } catch {
      studioTimezone = 'UTC';
    }

    const todayInStudio = getTodayDateString(studioTimezone);
    if (until < todayInStudio) {
      return {
        success: false,
        code: 'VALIDATION_FAILED',
        error: 'until date must be today or in the future.',
      };
    }
  }

  // 3. Verify client exists (AC-6)
  const [clientRow] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!clientRow) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Client not found.',
    };
  }

  // 4. Upsert legal hold and record audit event inside atomic transaction
  return await db.transaction(async (tx) => {
    const { hold, isUpdate } = await upsertLegalHold(
      {
        clientId,
        reason,
        note,
        until: until && until.length > 0 ? until : null,
        actorType: 'owner',
        actorId: auth.user.id,
      },
      tx,
    );

    const action = isUpdate ? 'client.legal_hold.updated' : 'client.legal_hold.set';

    // AC-1, AC-15: audit metadata contains reason and until only, NEVER note
    await audit(
      {
        actorType: 'owner',
        actorId: auth.user.id,
        action,
        targetType: 'client',
        targetId: clientId,
        outcome: 'success',
        metadata: {
          reason: hold.reason,
          until: hold.until ?? null,
        },
      },
      tx,
    );

    return {
      success: true,
      hold,
    };
  });
}

/**
 * Releases a manual legal hold on a client (AC-5, AC-6).
 * Owner web session ONLY; API keys rejected.
 */
export async function releaseLegalHoldAction(
  rawInput: ReleaseLegalHoldInput,
): Promise<ReleaseLegalHoldActionResult> {
  let reqHeaders: Headers | undefined;
  try {
    reqHeaders = await headers();
  } catch {
    reqHeaders = undefined;
  }

  if (reqHeaders && extractBearerToken(reqHeaders)) {
    return {
      success: false,
      code: 'FORBIDDEN',
      error: 'API keys are not permitted for legal hold actions.',
    };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerSession();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return {
        success: false,
        code: 'FORBIDDEN',
        error: err.message,
      };
    }
    return {
      success: false,
      code: 'UNAUTHORIZED',
      error: 'Authentication required.',
    };
  }

  // 1. Validate input strictly (AC-2)
  const parsed = releaseLegalHoldInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues.map((i) => i.message).join(', '),
    };
  }

  const { clientId } = parsed.data;

  // 2. Verify client exists (AC-6)
  const [clientRow] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!clientRow) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Client not found.',
    };
  }

  // 3. Delete hold row inside atomic transaction and emit audit event (AC-5)
  return await db.transaction(async (tx) => {
    const existing = await getLegalHold(clientId, tx);
    if (!existing) {
      return {
        success: false,
        code: 'NOT_FOUND',
        error: 'Legal hold not found.',
      };
    }

    await deleteLegalHold(clientId, tx);

    await audit(
      {
        actorType: 'owner',
        actorId: auth.user.id,
        action: 'client.legal_hold.released',
        targetType: 'client',
        targetId: clientId,
        outcome: 'success',
        metadata: {
          reason: existing.reason,
        },
      },
      tx,
    );

    return {
      success: true,
    };
  });
}

/**
 * Reads the current legal hold for a client.
 * Owner web session ONLY.
 */
export async function getLegalHoldAction(
  clientId: string,
): Promise<{ success: true; hold: ClientLegalHold | null } | { success: false; error: string }> {
  let reqHeaders: Headers | undefined;
  try {
    reqHeaders = await headers();
  } catch {
    reqHeaders = undefined;
  }

  if (reqHeaders && extractBearerToken(reqHeaders)) {
    return { success: false, error: 'API keys are not permitted for legal hold actions.' };
  }

  try {
    await requireOwnerSession();
  } catch {
    return { success: false, error: 'Authentication required.' };
  }

  const hold = await getLegalHold(clientId);
  return { success: true, hold };
}
