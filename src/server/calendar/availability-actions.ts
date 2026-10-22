'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { requireOwner, ForbiddenError, type AuthContext } from '@/server/auth/guards';
import {
  updateAvailabilitySchedulesSchema,
  createAvailabilityOverrideSchema,
  createBookingTypeSchema,
  updateBookingTypeSchema,
} from './schema';
import * as service from './service';
import type {
  AvailabilitySchedule,
  AvailabilityOverride,
  BookingType,
} from '@/server/db/schema/calendar';
import type { CalendarActionResult } from './actions';

function safeRevalidate(path: string): void {
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

// ==========================================
// Weekly Schedule Actions (AC-1, AC-2)
// ==========================================

export async function updateWeeklyScheduleAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<CalendarActionResult<AvailabilitySchedule[]>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  // Normalize: allow either { schedules: [...] } or direct array [...]
  const normalized = Array.isArray(rawInput) ? { schedules: rawInput } : rawInput;

  const parsed = updateAvailabilitySchedulesSchema.safeParse(normalized);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.updateAvailabilitySchedules(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/calendar');
    safeRevalidate('/settings/calendar/availability');
  }
  return result;
}

// ==========================================
// Date Override Actions (AC-3, AC-4)
// ==========================================

export async function createDateOverrideAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<CalendarActionResult<AvailabilityOverride>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = createAvailabilityOverrideSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.createAvailabilityOverride(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/calendar');
    safeRevalidate('/settings/calendar/availability');
  }
  return result;
}

export async function deleteDateOverrideAction(
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
      error: 'Override ID is required',
      fields: ['id'],
    };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const result = await service.deleteAvailabilityOverride(id, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/calendar');
    safeRevalidate('/settings/calendar/availability');
  }
  return result;
}

// ==========================================
// Booking Type Actions (AC-5, AC-6, AC-7)
// ==========================================

export async function createBookingTypeAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<CalendarActionResult<BookingType>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = createBookingTypeSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.createBookingType(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/calendar');
    safeRevalidate('/settings/calendar/availability');
    safeRevalidate(`/book/${result.data.slug}`);
  }
  return result;
}

export async function updateBookingTypeAction(
  rawInputOrId: unknown,
  maybeInput?: unknown,
  maybeClient?: DbClient,
): Promise<CalendarActionResult<BookingType>> {
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
      error: 'Booking type ID is required',
      fields: ['id'],
    };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = updateBookingTypeSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.updateBookingType(id, parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/calendar');
    safeRevalidate('/settings/calendar/availability');
    safeRevalidate(`/book/${result.data.slug}`);
  }
  return result;
}

export async function deleteBookingTypeAction(
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
      error: 'Booking type ID is required',
      fields: ['id'],
    };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const result = await service.deleteBookingType(id, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/calendar');
    safeRevalidate('/settings/calendar/availability');
  }
  return result;
}
