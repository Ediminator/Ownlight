import 'server-only';
import { eq } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import {
  clientLegalHolds,
  type ClientLegalHold,
  type ClientLegalHoldReason,
} from '@/server/db/schema/client-legal-holds';
import type { ActorType } from '@/server/db/schema/audit';

export async function getLegalHold(
  clientId: string,
  tx: DbClient = defaultDb,
): Promise<ClientLegalHold | null> {
  const [row] = await tx
    .select()
    .from(clientLegalHolds)
    .where(eq(clientLegalHolds.clientId, clientId))
    .limit(1);

  return row ?? null;
}

export async function upsertLegalHold(
  data: {
    clientId: string;
    reason: ClientLegalHoldReason;
    note?: string | null;
    until?: string | null;
    actorType: ActorType;
    actorId: string | null;
  },
  tx: DbClient = defaultDb,
): Promise<{ hold: ClientLegalHold; isUpdate: boolean }> {
  const existing = await getLegalHold(data.clientId, tx);

  if (existing) {
    const [updated] = await tx
      .update(clientLegalHolds)
      .set({
        reason: data.reason,
        note: data.note ?? null,
        until: data.until ?? null,
        setByActorType: data.actorType,
        setByActorId: data.actorId,
        updatedAt: new Date(),
      })
      .where(eq(clientLegalHolds.clientId, data.clientId))
      .returning();

    if (!updated) {
      throw new Error('Failed to update client legal hold');
    }

    return { hold: updated, isUpdate: true };
  }

  const [inserted] = await tx
    .insert(clientLegalHolds)
    .values({
      clientId: data.clientId,
      reason: data.reason,
      note: data.note ?? null,
      until: data.until ?? null,
      setByActorType: data.actorType,
      setByActorId: data.actorId,
    })
    .returning();

  if (!inserted) {
    throw new Error('Failed to insert client legal hold');
  }

  return { hold: inserted, isUpdate: false };
}

export async function deleteLegalHold(
  clientId: string,
  tx: DbClient = defaultDb,
): Promise<ClientLegalHold | null> {
  const [deleted] = await tx
    .delete(clientLegalHolds)
    .where(eq(clientLegalHolds.clientId, clientId))
    .returning();

  return deleted ?? null;
}
