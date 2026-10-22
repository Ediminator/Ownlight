'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { requireOwner, ForbiddenError, type AuthContext } from '@/server/auth/guards';
import {
  createAppointmentSchema,
  updateAppointmentSchema,
  cancelAppointmentSchema,
  createBlockedTimeSchema,
  updateBlockedTimeSchema,
} from './schema';
import * as service from './service';
import type { Appointment, BlockedTime } from '@/server/db/schema/calendar';
import type { UnifiedCalendarEvent } from './service';
import { z } from 'zod';

export type CalendarActionResult<T> =
  | { success: true; data: T; code?: never; error?: never; fields?: never }
  | {
      success: false;
      code:
        | 'UNAUTHENTICATED'
        | 'FORBIDDEN'
        | 'VALIDATION_FAILED'
        | 'NOT_FOUND'
        | 'CONFLICT'
        | 'INTERNAL_ERROR';
      error: string;
      fields?: string[];
    };

function safeRevalidate(path = '/calendar'): void {
  try {
    revalidatePath(path);
  } catch {
    // Ignore outside Next.js request context (e.g. unit/integration tests)
  }
}

function formatValidationIssues(error: {
  issues: { message: string; path: (string | number)[] }[];
}): { error: string; fields: string[] } {
  return {
    error: error.issues[0]?.message ?? 'Validation failed',
    fields: error.issues.map((i) => i.path.join('.')),
  };
}

async function verifyOwnerAuth(
  client: DbClient,
): Promise<
  | { authorized: true; auth: AuthContext }
  | { authorized: false; result: CalendarActionResult<never> }
> {
  try {
    const auth = await requireOwner({ client });
    return { authorized: true, auth };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return {
        authorized: false,
        result: { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' },
      };
    }
    return {
      authorized: false,
      result: { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' },
    };
  }
}

// ==========================================
// Appointment Actions (AC-5, AC-6, AC-9)
// ==========================================

export async function createAppointmentAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<CalendarActionResult<Appointment>> {
  const authCheck = await verifyOwnerAuth(client);
  if (!authCheck.authorized) return authCheck.result;

  const parsed = createAppointmentSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.createAppointment(parsed.data, authCheck.auth.user.id, client);
  if (result.success) {
    safeRevalidate('/calendar');
  }
  return result;
}

export async function updateAppointmentAction(
  rawInputOrId: unknown,
  maybeInput?: unknown,
  maybeClient?: DbClient,
): Promise<CalendarActionResult<Appointment>> {
  let id: string;
  let rawInput: unknown;
  let client: DbClient;

  if (typeof rawInputOrId === 'string') {
    id = rawInputOrId;
    rawInput = maybeInput;
    client = maybeClient ?? defaultDb;
  } else if (typeof rawInputOrId === 'object' && rawInputOrId !== null && 'id' in rawInputOrId) {
    const { id: extractedId, ...rest } = rawInputOrId as Record<string, unknown>;
    id = String(extractedId);
    rawInput = rest;
    client = (maybeInput as DbClient | undefined) ?? defaultDb;
  } else {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: 'Appointment ID is required',
      fields: ['id'],
    };
  }

  const authCheck = await verifyOwnerAuth(client);
  if (!authCheck.authorized) return authCheck.result;

  const parsed = updateAppointmentSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.updateAppointment(id, parsed.data, authCheck.auth.user.id, client);
  if (result.success) {
    safeRevalidate('/calendar');
  }
  return result;
}

export async function cancelAppointmentAction(
  rawInputOrId: unknown,
  maybeInput?: unknown,
  maybeClient?: DbClient,
): Promise<CalendarActionResult<Appointment>> {
  let id: string;
  let rawInput: unknown;
  let client: DbClient;

  if (typeof rawInputOrId === 'string') {
    id = rawInputOrId;
    rawInput = maybeInput;
    client = maybeClient ?? defaultDb;
  } else if (typeof rawInputOrId === 'object' && rawInputOrId !== null && 'id' in rawInputOrId) {
    const { id: extractedId, ...rest } = rawInputOrId as Record<string, unknown>;
    id = String(extractedId);
    rawInput = rest;
    client = (maybeInput as DbClient | undefined) ?? defaultDb;
  } else {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: 'Appointment ID is required',
      fields: ['id'],
    };
  }

  const authCheck = await verifyOwnerAuth(client);
  if (!authCheck.authorized) return authCheck.result;

  const parsed = cancelAppointmentSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.cancelAppointment(id, parsed.data, authCheck.auth.user.id, client);
  if (result.success) {
    safeRevalidate('/calendar');
  }
  return result;
}

// ==========================================
// Blocked Time Actions (AC-7, AC-8, AC-9)
// ==========================================

export async function createBlockedTimeAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<CalendarActionResult<BlockedTime>> {
  const authCheck = await verifyOwnerAuth(client);
  if (!authCheck.authorized) return authCheck.result;

  const parsed = createBlockedTimeSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.createBlockedTime(parsed.data, authCheck.auth.user.id, client);
  if (result.success) {
    safeRevalidate('/calendar');
  }
  return result;
}

export async function updateBlockedTimeAction(
  rawInputOrId: unknown,
  maybeInput?: unknown,
  maybeClient?: DbClient,
): Promise<CalendarActionResult<BlockedTime>> {
  let id: string;
  let rawInput: unknown;
  let client: DbClient;

  if (typeof rawInputOrId === 'string') {
    id = rawInputOrId;
    rawInput = maybeInput;
    client = maybeClient ?? defaultDb;
  } else if (typeof rawInputOrId === 'object' && rawInputOrId !== null && 'id' in rawInputOrId) {
    const { id: extractedId, ...rest } = rawInputOrId as Record<string, unknown>;
    id = String(extractedId);
    rawInput = rest;
    client = (maybeInput as DbClient | undefined) ?? defaultDb;
  } else {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: 'Blocked time ID is required',
      fields: ['id'],
    };
  }

  const authCheck = await verifyOwnerAuth(client);
  if (!authCheck.authorized) return authCheck.result;

  const parsed = updateBlockedTimeSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.updateBlockedTime(id, parsed.data, authCheck.auth.user.id, client);
  if (result.success) {
    safeRevalidate('/calendar');
  }
  return result;
}

export async function deleteBlockedTimeAction(
  rawInputOrId: unknown,
  maybeClient?: DbClient,
): Promise<CalendarActionResult<{ id: string }>> {
  let id: string;
  let client: DbClient;

  if (typeof rawInputOrId === 'string') {
    id = rawInputOrId;
    client = maybeClient ?? defaultDb;
  } else if (typeof rawInputOrId === 'object' && rawInputOrId !== null && 'id' in rawInputOrId) {
    id = String((rawInputOrId as Record<string, unknown>).id);
    client = maybeClient ?? defaultDb;
  } else {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: 'Blocked time ID is required',
      fields: ['id'],
    };
  }

  const authCheck = await verifyOwnerAuth(client);
  if (!authCheck.authorized) return authCheck.result;

  const result = await service.deleteBlockedTime(id, authCheck.auth.user.id, client);
  if (result.success) {
    safeRevalidate('/calendar');
  }
  return result;
}

// ==========================================
// Unified Calendar Query Action (AC-1)
// ==========================================

const getCalendarEventsInputSchema = z
  .object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    includeCancelled: z.boolean().optional(),
  })
  .strict();

export async function getCalendarEventsAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<CalendarActionResult<UnifiedCalendarEvent[]>> {
  const authCheck = await verifyOwnerAuth(client);
  if (!authCheck.authorized) return authCheck.result;

  const parsed = getCalendarEventsInputSchema.safeParse(rawInput);
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
    const events = await service.getUnifiedCalendarEvents(
      {
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        includeCancelled: parsed.data.includeCancelled ?? false,
      },
      client,
    );
    return { success: true, data: events };
  } catch (err) {
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: err instanceof Error ? err.message : 'Failed to query calendar events',
    };
  }
}
