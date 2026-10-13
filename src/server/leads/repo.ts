import { eq, and, inArray, sql, desc, type SQL } from 'drizzle-orm';
import { type DbClient, db as defaultDb } from '@/server/db/client';
import { leads, type Lead, type NewLead, type LeadStatus } from '@/server/db/schema/leads';
import type { ListLeadsQuery } from './schema';

/**
 * Inserts a new lead record into the database.
 */
export async function insertLeadRecord(data: NewLead, client: DbClient = defaultDb): Promise<Lead> {
  const [created] = await client.insert(leads).values(data).returning();
  if (!created) {
    throw new Error('Failed to insert lead record');
  }
  return created;
}

/**
 * Retrieves a lead record by its UUID.
 */
export async function getLeadById(id: string, client: DbClient = defaultDb): Promise<Lead | null> {
  const [lead] = await client.select().from(leads).where(eq(leads.id, id)).limit(1);
  return lead ?? null;
}

/**
 * Retrieves multiple leads by their IDs.
 */
export async function getLeadsByIds(ids: string[], client: DbClient = defaultDb): Promise<Lead[]> {
  if (ids.length === 0) return [];
  return await client.select().from(leads).where(inArray(leads.id, ids));
}

/**
 * Updates lead status and sets last_activity_at to now.
 */
export async function updateLeadStatusRecord(
  id: string,
  toStatus: LeadStatus,
  lastActivityAt: Date,
  client: DbClient = defaultDb,
): Promise<Lead | null> {
  const [updated] = await client
    .update(leads)
    .set({
      status: toStatus,
      lastActivityAt,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, id))
    .returning();

  return updated ?? null;
}

/**
 * Updates lead auto_reply_status without modifying last_activity_at.
 */
export async function updateLeadAutoReplyStatus(
  id: string,
  autoReplyStatus: import('@/server/db/schema/leads').LeadAutoReplyStatus,
  client: DbClient = defaultDb,
): Promise<Lead | null> {
  const [updated] = await client
    .update(leads)
    .set({
      autoReplyStatus,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, id))
    .returning();

  return updated ?? null;
}

/**
 * Lists leads with keyset pagination by (received_at DESC, id DESC).
 * Filters by status, verification, and email prefix/exact match.
 */
export async function listLeadsRecords(
  query: ListLeadsQuery,
  client: DbClient = defaultDb,
): Promise<{
  leads: Lead[];
  nextCursor: { receivedAt: string; id: string } | null;
  hasMore: boolean;
}> {
  const limit = query.limit ?? 25;
  const conditions: SQL[] = [];

  if (query.status) {
    conditions.push(eq(leads.status, query.status));
  }

  if (query.verification) {
    conditions.push(eq(leads.verification, query.verification));
  }

  if (query.emailQuery && query.emailQuery.trim().length > 0) {
    const normalized = query.emailQuery.trim().toLowerCase();
    conditions.push(sql`${leads.emailNormalized} LIKE ${normalized + '%'}`);
  }

  if (query.cursor) {
    const cursorDate =
      query.cursor.receivedAt instanceof Date
        ? query.cursor.receivedAt
        : new Date(query.cursor.receivedAt);

    conditions.push(
      sql`(${leads.receivedAt} < ${cursorDate} OR (${leads.receivedAt} = ${cursorDate} AND ${leads.id} < ${query.cursor.id}))`,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await client
    .select()
    .from(leads)
    .where(whereClause)
    .orderBy(desc(leads.receivedAt), desc(leads.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  const lastItem = items[items.length - 1];
  const nextCursor =
    hasMore && lastItem
      ? {
          receivedAt: lastItem.receivedAt.toISOString(),
          id: lastItem.id,
        }
      : null;

  return {
    leads: items,
    nextCursor,
    hasMore,
  };
}

/**
 * Deletes non-converted leads by their IDs.
 */
export async function deleteNonConvertedLeads(
  ids: string[],
  client: DbClient = defaultDb,
): Promise<number> {
  if (ids.length === 0) return 0;
  const deleted = await client
    .delete(leads)
    .where(and(inArray(leads.id, ids), sql`status != 'converted'`))
    .returning({ id: leads.id });

  return deleted.length;
}
