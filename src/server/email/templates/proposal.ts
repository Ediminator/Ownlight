import 'server-only';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';
import { logger } from '@/server/log';
import { emailOutbox, type EmailOutboxItem } from '@/server/db/schema/email-outbox';
import { user } from '@/server/db/schema/auth';
import { proposals } from '@/server/db/schema/proposals';
import { clientContacts } from '@/server/db/schema/clients';
import { eq, desc, asc } from 'drizzle-orm';

export interface EnqueueProposalEmailParams {
  proposalId: string;
  kind: 'proposal_sent' | 'proposal_accepted_client' | 'proposal_accepted_owner';
  recipient?: string | null;
  payload?: Record<string, unknown> | null;
  tx?: DbClient;
}

/**
 * Standard RFC 3834 auto-submitted headers for automated proposal emails (TASK-0060).
 */
export const PROPOSAL_EMAIL_HEADERS = {
  'Auto-Submitted': 'auto-generated',
  Precedence: 'bulk',
  'X-Auto-Response-Suppress': 'All',
} as const;

/**
 * Returns RFC 3834 auto-submitted headers for proposal transactional notifications.
 */
export function getProposalEmailHeaders(): Record<string, string> {
  return {
    'Auto-Submitted': 'auto-generated',
    Precedence: 'bulk',
    'X-Auto-Response-Suppress': 'All',
  };
}

/**
 * Enqueues a proposal transactional email in `email_outbox` (TASK-0060 / AC-1, AC-4).
 * Adheres strictly to security baseline by logging only proposalId and outboxId without PII.
 */
export async function enqueueProposalEmail({
  proposalId,
  kind,
  recipient,
  payload,
  tx = defaultDb,
}: EnqueueProposalEmailParams): Promise<EmailOutboxItem> {
  const now = new Date();
  const [created] = await tx
    .insert(emailOutbox)
    .values({
      id: generateUuidV7(),
      kind,
      proposalId,
      recipient: recipient ?? null,
      payload: payload ?? null,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!created) {
    throw new Error('Failed to enqueue proposal email outbox record');
  }

  // Security constraint: Log proposal ID and outbox ID only. Never log recipient email or client notes.
  logger.info(
    {
      proposalId,
      outboxId: created.id,
      kind,
    },
    'Proposal transactional email enqueued',
  );

  return created;
}

/**
 * Enqueues both client and owner notification emails upon proposal acceptance (TASK-0060 / AC-4).
 */
export async function enqueueProposalAcceptedEmails(
  proposalId: string,
  tx: DbClient = defaultDb,
): Promise<{ clientItem: EmailOutboxItem; ownerItem: EmailOutboxItem }> {
  // 1. Resolve proposal and client recipient
  const [proposalRow] = await tx
    .select({
      id: proposals.id,
      clientId: proposals.clientId,
      acceptedByEmail: proposals.acceptedByEmail,
    })
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);

  if (!proposalRow) {
    throw new Error(`Proposal not found for enqueueProposalAcceptedEmails: ${proposalId}`);
  }

  let clientRecipient = proposalRow.acceptedByEmail;
  if (!clientRecipient) {
    const [contactRow] = await tx
      .select({ email: clientContacts.email })
      .from(clientContacts)
      .where(eq(clientContacts.clientId, proposalRow.clientId))
      .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.createdAt))
      .limit(1);
    clientRecipient = contactRow?.email ?? null;
  }

  // 2. Resolve studio owner recipient
  const [ownerRow] = await tx
    .select({ email: user.email })
    .from(user)
    .where(eq(user.role, 'owner'))
    .limit(1);

  const ownerRecipient = ownerRow?.email ?? process.env.SMTP_FROM ?? 'owner@example.org';

  // 3. Insert both outbox items in the transaction
  const clientItem = await enqueueProposalEmail({
    proposalId,
    kind: 'proposal_accepted_client',
    recipient: clientRecipient,
    tx,
  });

  const ownerItem = await enqueueProposalEmail({
    proposalId,
    kind: 'proposal_accepted_owner',
    recipient: ownerRecipient,
    tx,
  });

  return { clientItem, ownerItem };
}
