import { eq, and, sql, inArray, type SQL } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import {
  clientTimelineEvents,
  clientNotes,
  type ClientTimelineEvent,
  type ClientNote,
} from '@/server/db/schema/timeline';
import { clientContacts } from '@/server/db/schema/clients';
import { consentRecords } from '@/server/db/schema/consents';
import type { ActorType } from '@/server/db/schema/audit';
import { encodeTimelineCursor, type TimelineCursorData } from './cursor';
import { generateUuidV7 } from '@/lib/id';

export interface ResolvedTimelineItem {
  id: string;
  clientId: string;
  type: string;
  occurredAt: Date;
  actorType: ActorType;
  actorId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  data: Record<string, unknown>;
  createdAt: Date;
  noteBody?: string | null;
  edited?: boolean;
  contactName?: string | null;
}

export interface ListTimelineResult {
  items: ResolvedTimelineItem[];
  nextCursor: string | null;
}

/**
 * Inserts a timeline event record within a transaction or dbClient.
 */
export async function insertTimelineEventRecord(
  tx: DbClient,
  event: {
    id?: string;
    clientId: string;
    type: string;
    occurredAt: Date;
    actorType: ActorType;
    actorId?: string | null;
    subjectType?: string | null;
    subjectId?: string | null;
    data: Record<string, unknown>;
  },
): Promise<ClientTimelineEvent> {
  const id = event.id ?? generateUuidV7();
  const [row] = await tx
    .insert(clientTimelineEvents)
    .values({
      id,
      clientId: event.clientId,
      type: event.type,
      occurredAt: event.occurredAt,
      actorType: event.actorType,
      actorId: event.actorId ?? null,
      subjectType: event.subjectType ?? null,
      subjectId: event.subjectId ?? null,
      data: event.data,
      createdAt: event.occurredAt,
    })
    .returning();

  if (!row) {
    throw new Error('Failed to insert timeline event');
  }

  return row;
}

/**
 * Deletes timeline events associated with a specific subject (e.g. when a note is deleted).
 */
export async function deleteTimelineEventsBySubject(
  tx: DbClient,
  params: {
    clientId: string;
    subjectType: string;
    subjectId: string;
  },
): Promise<number> {
  const result = await tx
    .delete(clientTimelineEvents)
    .where(
      and(
        eq(clientTimelineEvents.clientId, params.clientId),
        eq(clientTimelineEvents.subjectType, params.subjectType),
        eq(clientTimelineEvents.subjectId, params.subjectId),
      ),
    )
    .returning({ id: clientTimelineEvents.id });

  return result.length;
}

/**
 * Queries timeline events for a client with keyset pagination and read-time content resolution.
 */
export async function getClientTimelineEvents(
  clientId: string,
  cursor: TimelineCursorData | null,
  limit = 20,
  client: DbClient = defaultDb,
): Promise<ListTimelineResult> {
  // Keyset condition: (occurred_at < cursor.occurredAt) OR (occurred_at = cursor.occurredAt AND id < cursor.id)
  let whereClause: SQL | undefined = eq(clientTimelineEvents.clientId, clientId);

  if (cursor) {
    const cursorCondition = sql`(
      (${clientTimelineEvents.occurredAt} < ${cursor.occurredAt.toISOString()}::timestamptz)
      OR (
        ${clientTimelineEvents.occurredAt} = ${cursor.occurredAt.toISOString()}::timestamptz
        AND ${clientTimelineEvents.id} < ${cursor.id}::uuid
      )
    )`;

    whereClause = and(eq(clientTimelineEvents.clientId, clientId), cursorCondition);
  }

  // Fetch limit + 1 rows to determine if a next page exists
  const rows = await client
    .select()
    .from(clientTimelineEvents)
    .where(whereClause)
    .orderBy(sql`${clientTimelineEvents.occurredAt} DESC`, sql`${clientTimelineEvents.id} DESC`)
    .limit(limit + 1);

  const hasNextPage = rows.length > limit;
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasNextPage && pageRows.length > 0) {
    const lastItem = pageRows[pageRows.length - 1];
    if (lastItem) {
      nextCursor = encodeTimelineCursor({
        occurredAt: lastItem.occurredAt,
        id: lastItem.id,
      });
    }
  }

  // Read-time content resolution (AC-2, AC-6, AC-10):
  const isString = (val: unknown): val is string => typeof val === 'string' && val.length > 0;

  // 1. Resolve note bodies for note.created events
  const noteIds = pageRows
    .filter((r) => r.type === 'note.created')
    .map((r) => r.subjectId)
    .filter(isString);

  const notesMap = new Map<string, ClientNote>();
  if (noteIds.length > 0) {
    const noteRows = await client
      .select()
      .from(clientNotes)
      .where(and(eq(clientNotes.clientId, clientId), inArray(clientNotes.id, noteIds)));

    for (const note of noteRows) {
      notesMap.set(note.id, note);
    }
  }

  // 2. Resolve contact names for contact events (client.contact.added / client.contact.removed)
  const contactIds = pageRows
    .filter((r) => r.type === 'client.contact.added' || r.type === 'client.contact.removed')
    .map((r) => r.subjectId)
    .filter(isString);

  const contactsMap = new Map<string, string>();
  if (contactIds.length > 0) {
    const contactRows = await client
      .select({
        id: clientContacts.id,
        givenName: clientContacts.givenName,
        familyName: clientContacts.familyName,
      })
      .from(clientContacts)
      .where(and(eq(clientContacts.clientId, clientId), inArray(clientContacts.id, contactIds)));

    for (const c of contactRows) {
      const name = [c.givenName, c.familyName].filter(Boolean).join(' ') || null;
      if (name) {
        contactsMap.set(c.id, name);
      }
    }
  }

  // 3. Resolve contact names for consent events (consent.granted / consent.withdrawn)
  const consentRecordIds = pageRows
    .filter((r) => r.type === 'consent.granted' || r.type === 'consent.withdrawn')
    .map((r) => r.subjectId)
    .filter(isString);

  const consentContactsMap = new Map<string, string>();
  if (consentRecordIds.length > 0) {
    const consentRows = await client
      .select({
        id: consentRecords.id,
        contactId: consentRecords.contactId,
      })
      .from(consentRecords)
      .where(inArray(consentRecords.id, consentRecordIds));

    const consentContactIds = Array.from(new Set(consentRows.map((r) => r.contactId)));
    if (consentContactIds.length > 0) {
      const contactRows = await client
        .select({
          id: clientContacts.id,
          givenName: clientContacts.givenName,
          familyName: clientContacts.familyName,
        })
        .from(clientContacts)
        .where(
          and(eq(clientContacts.clientId, clientId), inArray(clientContacts.id, consentContactIds)),
        );

      const nameByContactId = new Map<string, string>();
      for (const c of contactRows) {
        const name = [c.givenName, c.familyName].filter(Boolean).join(' ') || null;
        if (name) {
          nameByContactId.set(c.id, name);
        }
      }

      for (const cr of consentRows) {
        const name = nameByContactId.get(cr.contactId);
        if (name) {
          consentContactsMap.set(cr.id, name);
        }
      }
    }
  }

  // Build resolved items
  const items: ResolvedTimelineItem[] = pageRows.map((r) => {
    const item: ResolvedTimelineItem = {
      id: r.id,
      clientId: r.clientId,
      type: r.type,
      occurredAt: r.occurredAt,
      actorType: r.actorType,
      actorId: r.actorId,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      data: r.data,
      createdAt: r.createdAt,
    };

    if (r.type === 'note.created' && r.subjectId) {
      const note = notesMap.get(r.subjectId);
      if (note) {
        item.noteBody = note.body;
        // Edited if updated_at is strictly after created_at
        item.edited = note.updatedAt.getTime() > note.createdAt.getTime();
      } else {
        item.noteBody = null;
        item.edited = false;
      }
    }

    if ((r.type === 'client.contact.added' || r.type === 'client.contact.removed') && r.subjectId) {
      // While the contact exists in client_contacts, resolve contactName; after removal neither contains name
      item.contactName = contactsMap.get(r.subjectId) ?? null;
    }

    if ((r.type === 'consent.granted' || r.type === 'consent.withdrawn') && r.subjectId) {
      item.contactName = consentContactsMap.get(r.subjectId) ?? null;
    }

    return item;
  });

  return {
    items,
    nextCursor,
  };
}

/**
 * Inserts a client note record.
 */
export async function insertClientNoteRecord(
  tx: DbClient,
  note: {
    id?: string;
    clientId: string;
    body: string;
    now?: Date;
  },
): Promise<ClientNote> {
  const id = note.id ?? generateUuidV7();
  const now = note.now ?? new Date();

  const [row] = await tx
    .insert(clientNotes)
    .values({
      id,
      clientId: note.clientId,
      body: note.body,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) {
    throw new Error('Failed to insert client note');
  }

  return row;
}

/**
 * Retrieves a client note by clientId and noteId (IDOR safe).
 */
export async function getClientNoteRecord(
  clientId: string,
  noteId: string,
  client: DbClient = defaultDb,
): Promise<ClientNote | null> {
  const [row] = await client
    .select()
    .from(clientNotes)
    .where(and(eq(clientNotes.id, noteId), eq(clientNotes.clientId, clientId)))
    .limit(1);

  return row ?? null;
}

/**
 * Updates a client note record and bumps updated_at.
 */
export async function updateClientNoteRecord(
  tx: DbClient,
  params: {
    clientId: string;
    noteId: string;
    body: string;
    now?: Date;
  },
): Promise<ClientNote | null> {
  const now = params.now ?? new Date();

  const [updated] = await tx
    .update(clientNotes)
    .set({
      body: params.body,
      updatedAt: now,
    })
    .where(and(eq(clientNotes.id, params.noteId), eq(clientNotes.clientId, params.clientId)))
    .returning();

  return updated ?? null;
}

/**
 * Deletes a client note record scoped strictly by clientId.
 */
export async function deleteClientNoteRecord(
  tx: DbClient,
  params: {
    clientId: string;
    noteId: string;
  },
): Promise<boolean> {
  const deleted = await tx
    .delete(clientNotes)
    .where(and(eq(clientNotes.id, params.noteId), eq(clientNotes.clientId, params.clientId)))
    .returning({ id: clientNotes.id });

  return deleted.length > 0;
}
