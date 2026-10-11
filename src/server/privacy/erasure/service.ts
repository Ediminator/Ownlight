import 'server-only';
import { eq, and, count } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { audit } from '@/server/audit/service';
import { logger } from '@/server/log';
import { getErasureProviders, getErasureHoldProviders } from './registry';
import type {
  ErasureSubject,
  ErasurePlan,
  ErasureActor,
  ErasureResult,
  ErasureHold,
} from './types';

export interface ExtendedErasurePlan extends ErasurePlan {
  clientDisplayName: string;
}

/**
 * Resolves the effective subject for erasure:
 * - If client subject: verifies client existence.
 * - If contact subject: verifies client and contact existence.
 * - Invariant (AC-1): If client has <= 1 contacts, erasing that contact is treated as erasing the client.
 */
async function resolveSubject(
  subject: ErasureSubject,
  tx: DbClient,
): Promise<{
  effectiveSubject: ErasureSubject;
  clientDisplayName: string;
  isMultiContact: boolean;
} | null> {
  const [clientRow] = await tx
    .select({ id: clients.id, displayName: clients.displayName })
    .from(clients)
    .where(eq(clients.id, subject.clientId))
    .limit(1);

  if (!clientRow) {
    return null;
  }

  if (subject.kind === 'client') {
    return {
      effectiveSubject: subject,
      clientDisplayName: clientRow.displayName,
      isMultiContact: false,
    };
  }

  // Verify contact exists and belongs to client (IDOR protection)
  const [contactRow] = await tx
    .select({ id: clientContacts.id, clientId: clientContacts.clientId })
    .from(clientContacts)
    .where(
      and(eq(clientContacts.id, subject.contactId), eq(clientContacts.clientId, subject.clientId)),
    )
    .limit(1);

  if (!contactRow) {
    return null;
  }

  // Count contacts for this client
  const [contactCountRes] = await tx
    .select({ count: count() })
    .from(clientContacts)
    .where(eq(clientContacts.clientId, subject.clientId));

  const totalContacts = contactCountRes?.count ?? 0;

  // If client has only 1 contact, erasing that contact is treated as erasing the client (AC-1)
  if (totalContacts <= 1) {
    return {
      effectiveSubject: { kind: 'client', clientId: subject.clientId },
      clientDisplayName: clientRow.displayName,
      isMultiContact: false,
    };
  }

  return {
    effectiveSubject: subject,
    clientDisplayName: clientRow.displayName,
    isMultiContact: true,
  };
}

/**
 * Plans erasure of a client or contact.
 * Aggregates counts across all erasure providers, evaluates holds,
 * and flags notesMayMentionPerson for contact erasure on multi-contact clients.
 */
export async function planErasure(
  subject: ErasureSubject,
  client: DbClient = defaultDb,
): Promise<ExtendedErasurePlan | null> {
  const resolved = await resolveSubject(subject, client);
  if (!resolved) {
    return null;
  }

  const { effectiveSubject, clientDisplayName, isMultiContact } = resolved;

  // 1. Evaluate holds across all registered hold providers
  const holdProviders = getErasureHoldProviders();
  const holds: ErasureHold[] = [];
  for (const hp of holdProviders) {
    const provHolds = await hp.holds(effectiveSubject, client);
    if (provHolds.length > 0) {
      holds.push(...provHolds);
    }
  }

  // 2. Aggregate category counts from erasure providers
  const providers = getErasureProviders();
  const categoryCounts: Record<string, number> = {};

  for (const provider of providers) {
    const count = await provider.plan(effectiveSubject, client);
    if (count > 0 || provider.category !== 'legal_hold') {
      categoryCounts[provider.category] = (categoryCounts[provider.category] ?? 0) + count;
    }
  }

  logger.info(
    {
      subjectKind: effectiveSubject.kind,
      clientId: subject.clientId,
      contactId: subject.kind === 'contact' ? subject.contactId : undefined,
      holdCount: holds.length,
      categoryCounts,
    },
    'Erasure planned',
  );

  return {
    subjectKind: effectiveSubject.kind,
    categoryCounts,
    holds,
    notesMayMentionPerson: isMultiContact && effectiveSubject.kind === 'contact',
    clientDisplayName,
  };
}

/**
 * Executes subject erasure in a single atomic transaction.
 * Re-evaluates holds inside the transaction (TOCTOU protection).
 * If any hold exists, deletes nothing and emits privacy.erasure.blocked audit event.
 * If successful, deletes personal data via providers and emits privacy.erasure.completed audit event.
 */
export async function eraseSubject(
  subject: ErasureSubject,
  options: { actor: ErasureActor },
  client: DbClient = defaultDb,
): Promise<ErasureResult> {
  return await client.transaction(async (tx) => {
    // 1. Resolve subject inside transaction
    const resolved = await resolveSubject(subject, tx);
    if (!resolved) {
      return {
        success: false,
        code: 'NOT_FOUND',
        error: 'Subject not found',
      };
    }

    const { effectiveSubject } = resolved;

    // 2. Re-evaluate holds inside transaction (TOCTOU protection, AC-5)
    const holdProviders = getErasureHoldProviders();
    const holds: ErasureHold[] = [];
    for (const hp of holdProviders) {
      const provHolds = await hp.holds(effectiveSubject, tx);
      if (provHolds.length > 0) {
        holds.push(...provHolds);
      }
    }

    const targetUuid =
      effectiveSubject.kind === 'client' ? effectiveSubject.clientId : effectiveSubject.contactId;

    if (holds.length > 0) {
      // Record audit event for blocked erasure
      await audit(
        {
          actorType: options.actor.actorType,
          actorId: options.actor.actorId ?? null,
          action: 'privacy.erasure.blocked',
          targetType: effectiveSubject.kind,
          targetId: targetUuid,
          outcome: 'denied',
          metadata: {
            subject_kind: effectiveSubject.kind,
            hold_count: holds.length,
          },
        },
        tx,
      );

      logger.warn(
        {
          subjectKind: effectiveSubject.kind,
          targetUuid,
          holdCount: holds.length,
        },
        'Erasure blocked by active retention hold',
      );

      return {
        success: false,
        code: 'ERASURE_BLOCKED',
        holds,
      };
    }

    // 3. Execute erasure across all providers (all-or-nothing rollback on throw, AC-6)
    const providers = getErasureProviders();
    const categoryCounts: Record<string, number> = {};

    for (const provider of providers) {
      const deletedCount = await provider.erase(effectiveSubject, tx);
      if (deletedCount > 0 || provider.category !== 'legal_hold') {
        categoryCounts[provider.category] = (categoryCounts[provider.category] ?? 0) + deletedCount;
      }
    }

    // 4. Record audit event for completed erasure (AC-2, AC-14, AC-15)
    await audit(
      {
        actorType: options.actor.actorType,
        actorId: options.actor.actorId ?? null,
        action: 'privacy.erasure.completed',
        targetType: effectiveSubject.kind,
        targetId: targetUuid,
        outcome: 'success',
        metadata: {
          subject_kind: effectiveSubject.kind,
          category_counts: categoryCounts,
        },
      },
      tx,
    );

    logger.info(
      {
        subjectKind: effectiveSubject.kind,
        targetUuid,
        categoryCounts,
      },
      'Erasure completed successfully',
    );

    return {
      success: true,
      subjectKind: effectiveSubject.kind,
      categoryCounts,
    };
  });
}
