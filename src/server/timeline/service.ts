import { eq } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { clients } from '@/server/db/schema/clients';
import type { ActorType } from '@/server/db/schema/audit';
import type { ClientTimelineEvent } from '@/server/db/schema/timeline';
import type { AuthContext } from '@/server/auth/guards';
import { audit } from '@/server/audit';
import { logger } from '@/server/log';
import { getTimelineEventType } from './registry';
import { decodeTimelineCursor } from './cursor';
import {
  insertTimelineEventRecord,
  deleteTimelineEventsBySubject,
  getClientTimelineEvents,
  insertClientNoteRecord,
  getClientNoteRecord,
  updateClientNoteRecord,
  deleteClientNoteRecord,
  type ListTimelineResult,
} from './repo';

export type ServiceResult<T> =
  | { success: true; data: T; code?: never; error?: never; fields?: never }
  | {
      success: false;
      code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'LIMIT_EXCEEDED';
      error: string;
      fields?: string[];
    };

function getAuditActor(auth: AuthContext): { actorType: ActorType; actorId: string | null } {
  const actorType: ActorType = auth.authType === 'apiKey' ? 'token' : (auth.user.role as ActorType);
  const actorId =
    auth.authType === 'apiKey' ? (auth.apiKey?.id ?? auth.apiKey?.prefix ?? null) : auth.user.id;
  return { actorType, actorId };
}

/**
 * Records a timeline event within a transaction.
 * In dev/test, throws if the event type is unregistered or data keys are outside the allowlist.
 * In production, filters invalid keys with a warning.
 */
export async function recordTimelineEvent(
  tx: DbClient,
  input: {
    id?: string;
    clientId: string;
    type: string;
    occurredAt?: Date;
    actorType: ActorType;
    actorId?: string | null;
    subjectType?: string | null;
    subjectId?: string | null;
    data?: Record<string, unknown>;
  },
): Promise<ClientTimelineEvent | null> {
  const isDevOrTest = process.env.NODE_ENV !== 'production';
  const typeDef = getTimelineEventType(input.type);

  // 1. Verify event type is registered
  if (!typeDef) {
    if (isDevOrTest) {
      throw new Error(`Unregistered timeline event type: ${input.type}`);
    }
    logger.warn({ type: input.type }, 'Dropped unregistered timeline event in production');
    return null;
  }

  // 2. Validate data keys against allowlist (AC-3, AC-10)
  const inputData = input.data ?? {};
  const allowedKeys = new Set(typeDef.dataKeys);
  const sanitizedData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(inputData)) {
    if (!allowedKeys.has(key)) {
      if (isDevOrTest) {
        throw new Error(`Timeline event key '${key}' not allowed for type '${input.type}'`);
      }
      logger.warn(
        { type: input.type, key },
        'Dropped disallowed timeline event data key in production',
      );
      continue;
    }
    Object.assign(sanitizedData, { [key]: value });
  }

  return await insertTimelineEventRecord(tx, {
    id: input.id,
    clientId: input.clientId,
    type: input.type,
    occurredAt: input.occurredAt ?? new Date(),
    actorType: input.actorType,
    actorId: input.actorId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    data: sanitizedData,
  });
}

/**
 * Lists timeline events for a client using keyset pagination and read-time content resolution.
 */
export async function listTimeline(
  clientId: string,
  cursorString?: string,
  client: DbClient = defaultDb,
): Promise<ServiceResult<ListTimelineResult>> {
  // 1. Verify client exists (AC-8: non-existent client returns NOT_FOUND)
  const [existingClient] = await client
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!existingClient) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'NOT_FOUND',
    };
  }

  // 2. Parse and verify cursor if provided (AC-7: tampered cursor returns VALIDATION_FAILED)
  let cursor = null;
  if (cursorString) {
    cursor = decodeTimelineCursor(cursorString);
    if (!cursor) {
      return {
        success: false,
        code: 'VALIDATION_FAILED',
        error: 'VALIDATION_FAILED',
        fields: ['cursor'],
      };
    }
  }

  const result = await getClientTimelineEvents(clientId, cursor, 20, client);

  return {
    success: true,
    data: result,
  };
}

/**
 * Adds a note to a client and records a note.created timeline event in the same transaction.
 */
export async function addNote(
  input: {
    clientId: string;
    body: string;
  },
  auth: AuthContext,
  client: DbClient = defaultDb,
): Promise<ServiceResult<{ noteId: string }>> {
  // Verify client existence
  const [existingClient] = await client
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, input.clientId))
    .limit(1);

  if (!existingClient) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  const { actorType, actorId } = getAuditActor(auth);
  const now = new Date();

  const note = await client.transaction(async (tx) => {
    // 1. Insert note
    const insertedNote = await insertClientNoteRecord(tx, {
      clientId: input.clientId,
      body: input.body,
      now,
    });

    // 2. Emit note.created timeline event in the same transaction (AC-4)
    await recordTimelineEvent(tx, {
      clientId: input.clientId,
      type: 'note.created',
      occurredAt: now,
      actorType,
      actorId,
      subjectType: 'note',
      subjectId: insertedNote.id,
      data: {}, // Zero note text in data (AC-10)
    });

    // 3. Bump client last_activity_at
    await tx
      .update(clients)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(eq(clients.id, input.clientId));

    return insertedNote;
  });

  // 4. Record audit event with metadata note_id only (AC-10)
  await audit(
    {
      actorType,
      actorId,
      action: 'client.note.created',
      targetType: 'client',
      targetId: input.clientId,
      outcome: 'success',
      metadata: { note_id: note.id },
    },
    client,
  );

  logger.info(
    { clientId: input.clientId, noteId: note.id, action: 'client.note.created' },
    'Client note added successfully',
  );

  return {
    success: true,
    data: { noteId: note.id },
  };
}

/**
 * Updates a note's body and bumps updated_at.
 */
export async function updateNote(
  input: {
    clientId: string;
    noteId: string;
    body: string;
  },
  auth: AuthContext,
  client: DbClient = defaultDb,
): Promise<ServiceResult<{ noteId: string }>> {
  // Verify client and note existence strictly scoped by clientId (AC-8 IDOR guard)
  const existingNote = await getClientNoteRecord(input.clientId, input.noteId, client);
  if (!existingNote) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  const { actorType, actorId } = getAuditActor(auth);
  const now = new Date();

  await client.transaction(async (tx) => {
    // 1. Update note
    await updateClientNoteRecord(tx, {
      clientId: input.clientId,
      noteId: input.noteId,
      body: input.body,
      now,
    });

    // 2. Bump client activity
    await tx
      .update(clients)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(eq(clients.id, input.clientId));
  });

  // 3. Record audit event with metadata note_id only (AC-10)
  await audit(
    {
      actorType,
      actorId,
      action: 'client.note.updated',
      targetType: 'client',
      targetId: input.clientId,
      outcome: 'success',
      metadata: { note_id: input.noteId },
    },
    client,
  );

  logger.info(
    { clientId: input.clientId, noteId: input.noteId, action: 'client.note.updated' },
    'Client note updated successfully',
  );

  return {
    success: true,
    data: { noteId: input.noteId },
  };
}

/**
 * Deletes a note and its timeline event in the same transaction.
 */
export async function deleteNote(
  input: {
    clientId: string;
    noteId: string;
  },
  auth: AuthContext,
  client: DbClient = defaultDb,
): Promise<ServiceResult<{ noteId: string }>> {
  // Verify client and note existence strictly scoped by clientId (AC-8 IDOR guard)
  const existingNote = await getClientNoteRecord(input.clientId, input.noteId, client);
  if (!existingNote) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  const { actorType, actorId } = getAuditActor(auth);
  const now = new Date();

  await client.transaction(async (tx) => {
    // 1. Delete note row
    await deleteClientNoteRecord(tx, {
      clientId: input.clientId,
      noteId: input.noteId,
    });

    // 2. Delete note.created timeline event in the same transaction (AC-6)
    await deleteTimelineEventsBySubject(tx, {
      clientId: input.clientId,
      subjectType: 'note',
      subjectId: input.noteId,
    });

    // 3. Bump client activity
    await tx
      .update(clients)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(eq(clients.id, input.clientId));
  });

  // 4. Record audit event with metadata note_id only (AC-10)
  await audit(
    {
      actorType,
      actorId,
      action: 'client.note.deleted',
      targetType: 'client',
      targetId: input.clientId,
      outcome: 'success',
      metadata: { note_id: input.noteId },
    },
    client,
  );

  logger.info(
    { clientId: input.clientId, noteId: input.noteId, action: 'client.note.deleted' },
    'Client note deleted successfully',
  );

  return {
    success: true,
    data: { noteId: input.noteId },
  };
}
