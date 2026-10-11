import { eq } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { clients } from '@/server/db/schema/clients';
import type { ActorType } from '@/server/db/schema/audit';
import type { AuthContext } from '@/server/auth/guards';
import { audit } from '@/server/audit';
import { logger } from '@/server/log';
import { recordTimelineEvent } from '@/server/timeline/service';
import { getStudioSettings } from '@/server/settings/repo';
import {
  getContactForClient,
  getLatestConsentRecord,
  insertConsentRecord,
  listConsentsForClient,
  type ClientConsentsResult,
} from './repo';
import { getTodayDateString, type RecordConsentInput } from './schema';

export type ConsentServiceResult<T> =
  | { success: true; data: T; code?: never; error?: never; fields?: never }
  | {
      success: false;
      code:
        'VALIDATION_FAILED' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'CONSENT_NOT_GRANTED';
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
 * Records a consent change (granted or withdrawn) for a contact under a client.
 * Enforces:
 * - Contact belongs to client (IDOR protection)
 * - effectiveOn is not in the future evaluated against studio timezone
 * - Withdrawn status requires current status to be granted (AC-3)
 * - Single transaction for record, timeline event, and audit log
 * - Privacy: zero names, emails, scope, or evidence in timeline data, audit metadata, or logs (AC-9)
 */
export async function recordConsent(
  input: RecordConsentInput,
  auth: AuthContext,
  client: DbClient = defaultDb,
): Promise<ConsentServiceResult<{ consentId: string }>> {
  // 1. Verify client exists
  const [existingClient] = await client
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, input.clientId))
    .limit(1);

  if (!existingClient) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  // 2. IDOR check: contact must belong to this client (AC-6)
  const contact = await getContactForClient(input.contactId, input.clientId, client);
  if (!contact) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  // 3. Studio timezone date validation: effectiveOn must not be in the future (AC-4)
  const settings = await getStudioSettings(client).catch(() => null);
  const timezone = settings?.timezone ?? 'UTC';
  const todayInStudio = getTodayDateString(timezone);

  if (input.effectiveOn > todayInStudio) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: 'VALIDATION_FAILED',
      fields: ['effectiveOn'],
    };
  }

  // 4. Status transition validation: withdrawn requires current status to be granted (AC-3)
  const currentRecord = await getLatestConsentRecord(input.contactId, input.purpose, client);
  if (input.status === 'withdrawn') {
    if (currentRecord?.status !== 'granted') {
      return {
        success: false,
        code: 'CONSENT_NOT_GRANTED',
        error: 'CONSENT_NOT_GRANTED',
      };
    }
  }

  const { actorType, actorId } = getAuditActor(auth);
  const eventAction = input.status === 'granted' ? 'consent.granted' : 'consent.withdrawn';

  // 5. Transactional insert + timeline event + audit event
  const insertedId = await client.transaction(async (tx) => {
    // 5a. Insert consent record
    const record = await insertConsentRecord(
      {
        contactId: input.contactId,
        purpose: input.purpose,
        status: input.status,
        effectiveOn: input.effectiveOn,
        method: input.method,
        scope: input.scope,
        evidenceNote: input.evidenceNote,
        recordedByActorType: actorType,
        recordedByActorId: actorId,
      },
      tx,
    );

    // 5b. Emit timeline event (data contains purpose ONLY - AC-9)
    await recordTimelineEvent(tx, {
      clientId: input.clientId,
      type: eventAction,
      occurredAt: new Date(),
      actorType,
      actorId,
      subjectType: 'consent_record',
      subjectId: record.id,
      data: { purpose: input.purpose },
    });

    // 5c. Record audit event (metadata contains contact_id, purpose, method ONLY - AC-9)
    await audit(
      {
        actorType,
        actorId,
        action: eventAction,
        targetType: 'consent_record',
        targetId: record.id,
        outcome: 'success',
        metadata: {
          contact_id: input.contactId,
          purpose: input.purpose,
          method: input.method,
        },
      },
      tx,
    );

    return record.id;
  });

  // 6. Structured log (contactId, purpose, status, outcome only - AC-9)
  logger.info(
    {
      contactId: input.contactId,
      purpose: input.purpose,
      status: input.status,
      outcome: 'success',
    },
    'Consent record stored',
  );

  return {
    success: true,
    data: { consentId: insertedId },
  };
}

/**
 * Lists current consent status per purpose and full history for all contacts of a client.
 */
export async function listConsents(
  clientId: string,
  _auth: AuthContext,
  client: DbClient = defaultDb,
): Promise<ConsentServiceResult<ClientConsentsResult>> {
  // 1. Verify client exists
  const [existingClient] = await client
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!existingClient) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  // 2. Fetch per-contact consent status and history
  const result = await listConsentsForClient(clientId, client);

  return {
    success: true,
    data: result,
  };
}
