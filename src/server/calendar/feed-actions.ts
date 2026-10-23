'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { requireOwner, ForbiddenError, type AuthContext } from '@/server/auth/guards';
import {
  generateFeedTokenSchema,
  revokeFeedTokenSchema,
  updateFeedSummaryLevelSchema,
} from './schema';
import * as service from './service';
import type { CalendarFeed } from '@/server/db/schema/calendar';
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

/**
 * Retrieves the currently active calendar feed, initializing a default feed if none exists.
 * Studio owner only.
 */
export async function getCalendarFeedAction(
  client: DbClient = defaultDb,
): Promise<CalendarActionResult<{ feed: CalendarFeed | null; token?: string }>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const { feed, token } = await service.getOrCreateActiveFeed(auth.user.id, client);
  return {
    success: true,
    data: {
      feed,
      token,
    },
  };
}

/**
 * Generates a new secret feed token and record.
 * Studio owner only.
 */
export async function generateFeedTokenAction(
  rawInput: unknown = {},
  client: DbClient = defaultDb,
): Promise<CalendarActionResult<{ feed: CalendarFeed; token: string }>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = generateFeedTokenSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.generateFeedTokenService(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/settings/calendar/feed');
    safeRevalidate('/settings/calendar/availability');
  }
  return result;
}

/**
 * Revokes the existing feed token and generates a new secret URL immediately.
 * Studio owner only.
 */
export async function revokeFeedTokenAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<CalendarActionResult<{ feed: CalendarFeed; token: string; previousFeedId: string }>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const normalized = typeof rawInput === 'string' ? { feedId: rawInput } : (rawInput ?? {});

  const parsed = revokeFeedTokenSchema.safeParse(normalized);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.revokeFeedTokenService(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/settings/calendar/feed');
    safeRevalidate('/settings/calendar/availability');
  }
  return result;
}

/**
 * Updates the privacy summary level for the calendar feed.
 * Studio owner only.
 */
export async function updateFeedSummaryLevelAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<CalendarActionResult<CalendarFeed>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = updateFeedSummaryLevelSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.updateFeedSummaryLevelService(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/settings/calendar/feed');
    safeRevalidate('/settings/calendar/availability');
  }
  return result;
}
