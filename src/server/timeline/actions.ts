'use server';

import 'server-only';
import { requireAuth, UnauthorizedError, ForbiddenError } from '@/server/auth/guards';
import { authorizeClientRead, authorizeClientWrite } from '@/server/clients/policy';
import {
  addNoteInputSchema,
  updateNoteInputSchema,
  deleteNoteInputSchema,
  listTimelineInputSchema,
} from './schema';
import * as timelineService from './service';
import type { ListTimelineResult } from './repo';

export type TimelineActionResult<T> = timelineService.ServiceResult<T>;

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
}): TimelineActionResult<never> {
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
 * Adds a new note to a client and records a note.created event in the timeline.
 * Requires role 'owner' and 'clients:write' scope.
 */
export async function addNoteAction(
  rawInput: unknown,
): Promise<TimelineActionResult<{ noteId: string }>> {
  let auth;
  try {
    auth = await requireAuth();
    const targetId = extractClientId(rawInput);
    await authorizeClientWrite('client.note.created', targetId, auth);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
    }
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    throw err;
  }

  const parsed = addNoteInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return handleValidationError(parsed.error);
  }

  return await timelineService.addNote(parsed.data, auth);
}

/**
 * Updates an existing note.
 * Requires role 'owner' and 'clients:write' scope.
 */
export async function updateNoteAction(
  rawInput: unknown,
): Promise<TimelineActionResult<{ noteId: string }>> {
  let auth;
  try {
    auth = await requireAuth();
    const targetId = extractClientId(rawInput);
    await authorizeClientWrite('client.note.updated', targetId, auth);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
    }
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    throw err;
  }

  const parsed = updateNoteInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return handleValidationError(parsed.error);
  }

  return await timelineService.updateNote(parsed.data, auth);
}

/**
 * Deletes a note and its timeline event in the same transaction.
 * Requires role 'owner' and 'clients:write' scope.
 */
export async function deleteNoteAction(
  rawInput: unknown,
): Promise<TimelineActionResult<{ noteId: string }>> {
  let auth;
  try {
    auth = await requireAuth();
    const targetId = extractClientId(rawInput);
    await authorizeClientWrite('client.note.deleted', targetId, auth);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
    }
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    throw err;
  }

  const parsed = deleteNoteInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return handleValidationError(parsed.error);
  }

  return await timelineService.deleteNote(parsed.data, auth);
}

/**
 * Lists timeline events for a client using keyset pagination.
 * Requires role 'owner' and 'clients:read' scope.
 */
export async function listTimelineAction(
  rawInput: unknown,
): Promise<TimelineActionResult<ListTimelineResult>> {
  try {
    const auth = await requireAuth();
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

  const parsed = listTimelineInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return handleValidationError(parsed.error);
  }

  return await timelineService.listTimeline(parsed.data.clientId, parsed.data.cursor);
}
