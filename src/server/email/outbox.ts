import 'server-only';
import { eq, and, lte, asc, count } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';
import { emailOutbox, type EmailOutboxItem } from '@/server/db/schema/email-outbox';

/**
 * Enqueues a lead auto-reply outbox entry within an active database transaction.
 */
export async function enqueueLeadAutoReply(
  leadId: string,
  tx: DbClient = defaultDb,
): Promise<EmailOutboxItem> {
  const now = new Date();
  const [created] = await tx
    .insert(emailOutbox)
    .values({
      id: generateUuidV7(),
      kind: 'lead_auto_reply',
      leadId,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!created) {
    throw new Error('Failed to enqueue email outbox record');
  }

  return created;
}

/**
 * Fetches pending outbox rows ready for sending using FOR UPDATE SKIP LOCKED.
 */
export async function fetchPendingEmailOutboxBatch(
  batchSize = 20,
  client: DbClient = defaultDb,
): Promise<EmailOutboxItem[]> {
  const now = new Date();
  return await client
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, 'PENDING'), lte(emailOutbox.nextAttemptAt, now)))
    .orderBy(asc(emailOutbox.createdAt), asc(emailOutbox.id))
    .limit(batchSize)
    .for('update', { skipLocked: true });
}

/**
 * Marks an outbox item as in-progress (PROCESSING).
 */
export async function markEmailOutboxProcessing(
  id: string,
  client: DbClient = defaultDb,
): Promise<void> {
  await client
    .update(emailOutbox)
    .set({
      status: 'PROCESSING',
      updatedAt: new Date(),
    })
    .where(eq(emailOutbox.id, id));
}

/**
 * Deletes an outbox entry upon successful delivery or suppression.
 */
export async function deleteEmailOutboxItem(
  id: string,
  client: DbClient = defaultDb,
): Promise<void> {
  await client.delete(emailOutbox).where(eq(emailOutbox.id, id));
}

/**
 * Updates an outbox item after a delivery failure.
 * When isTerminal is true, transitions status to FAILED.
 * Otherwise resets status to PENDING with next backoff attempt.
 */
export async function updateEmailOutboxRetry(
  id: string,
  attempts: number,
  nextAttemptAt: Date,
  error: string,
  isTerminal: boolean,
  client: DbClient = defaultDb,
): Promise<void> {
  const now = new Date();
  await client
    .update(emailOutbox)
    .set({
      status: isTerminal ? 'FAILED' : 'PENDING',
      attempts,
      nextAttemptAt,
      lastError: error.slice(0, 500),
      updatedAt: now,
    })
    .where(eq(emailOutbox.id, id));
}

/**
 * Returns total count of failed email outbox items.
 */
export async function getFailedEmailOutboxCount(client: DbClient = defaultDb): Promise<number> {
  const [row] = await client
    .select({ total: count() })
    .from(emailOutbox)
    .where(eq(emailOutbox.status, 'FAILED'));
  return row?.total ?? 0;
}

export { enqueueAppointmentEmail } from './templates/appointment';
