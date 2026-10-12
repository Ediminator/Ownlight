import { type DbClient, db as defaultDb } from '@/server/db/client';
import { audit, type ActorType } from '@/server/audit';
import { logger } from '@/server/log';
import {
  type Lead,
  type LeadStatus,
  type LeadVerification,
  type LeadDeliveryMode,
} from '@/server/db/schema/leads';
import {
  insertLeadRecord,
  getLeadById,
  getLeadsByIds,
  updateLeadStatusRecord,
  listLeadsRecords,
  deleteNonConvertedLeads,
} from './repo';
import {
  createLeadInputSchema,
  listLeadsQuerySchema,
  type CreateLeadInput,
  type ListLeadsQuery,
} from './schema';
import { isAllowedLeadStatusTransition } from './transitions';

export type ActorInput =
  { actorType?: ActorType; actorId: string | null } | string | null | undefined;

export function resolveActor(actor: ActorInput): { actorType: ActorType; actorId: string | null } {
  if (!actor) {
    return { actorType: 'system', actorId: 'lead-domain' };
  }
  if (typeof actor === 'string') {
    return { actorType: 'owner', actorId: actor };
  }
  return {
    actorType: actor.actorType ?? 'owner',
    actorId: actor.actorId ?? null,
  };
}

export interface CreateLeadContext {
  verification?: LeadVerification;
  deliveryMode?: LeadDeliveryMode;
}

export type LeadResult<T> =
  | ({ success: true; data: T } & T)
  | { success: false; code: string; error: string; fields?: string[] };

/**
 * Creates a new lead in 'new' status (AC-1).
 * Validates input, normalises email (lowercase, trim), sets received_at = last_activity_at = now,
 * and emits audit event lead.received (metadata contains only form_id, verification, delivery_mode).
 */
export async function createLead(
  rawInput: CreateLeadInput,
  ctx?: CreateLeadContext,
  client: DbClient = defaultDb,
): Promise<LeadResult<Lead>> {
  const parsed = createLeadInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => i.message).join('; ');
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: errorMsg,
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  const input = parsed.data;
  const now = new Date();
  const emailNormalized = input.email ? input.email.trim().toLowerCase() : null;
  const verification = ctx?.verification ?? input.verification;
  const deliveryMode = ctx?.deliveryMode ?? input.deliveryMode;

  const leadRecord = await insertLeadRecord(
    {
      formId: input.formId,
      noticeVersionId: input.noticeVersionId,
      noticeAcknowledgedAt: input.noticeAcknowledgedAt ?? now,
      status: 'new',
      verification,
      deliveryMode,
      locale: input.locale,
      givenName: input.givenName ?? null,
      familyName: input.familyName ?? null,
      email: input.email ? input.email.trim() : null,
      emailNormalized,
      phone: input.phone ? input.phone.trim() : null,
      eventTypeKey: input.eventTypeKey ?? null,
      eventDate: input.eventDate ?? null,
      eventLocation: input.eventLocation ?? null,
      message: input.message ?? null,
      autoReplyStatus: input.autoReplyStatus,
      receivedAt: now,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    },
    client,
  );

  // Emit lead.received audit event (AC-1)
  await audit(
    {
      action: 'lead.received',
      actorType: 'system',
      actorId: 'public-inquiry-endpoint',
      targetType: 'lead',
      targetId: leadRecord.id,
      outcome: 'success',
      metadata: {
        form_id: leadRecord.formId,
        verification: leadRecord.verification,
        delivery_mode: leadRecord.deliveryMode,
      },
    },
    client,
  );

  logger.info(
    {
      leadId: leadRecord.id,
      formId: leadRecord.formId,
      status: leadRecord.status,
      verification: leadRecord.verification,
      deliveryMode: leadRecord.deliveryMode,
    },
    'Lead created successfully',
  );

  return Object.assign(
    {
      success: true as const,
      data: leadRecord,
    },
    leadRecord,
  );
}

/**
 * Changes lead status according to ADR-0015 §6 transition table (AC-2).
 * 'converted' is NOT reachable through this function.
 * Invalid transitions return { success: false, code: 'INVALID_TRANSITION', error: 'INVALID_TRANSITION' }.
 * Allowed transitions update status and last_activity_at = now, and emit lead.status_changed audit event.
 */
export async function changeLeadStatus(
  leadId: string,
  toStatus: LeadStatus,
  actor?: ActorInput,
  client: DbClient = defaultDb,
): Promise<
  | ({ success: true; data: Lead } & Lead)
  | {
      success: false;
      code: 'INVALID_TRANSITION' | 'NOT_FOUND';
      error: 'INVALID_TRANSITION' | 'NOT_FOUND';
    }
> {
  const lead = await getLeadById(leadId, client);
  if (!lead) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'NOT_FOUND',
    };
  }

  const isAllowed = isAllowedLeadStatusTransition(lead.status, toStatus);
  if (!isAllowed) {
    return {
      success: false,
      code: 'INVALID_TRANSITION',
      error: 'INVALID_TRANSITION',
    };
  }

  const now = new Date();
  const updated = await updateLeadStatusRecord(leadId, toStatus, now, client);
  if (!updated) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'NOT_FOUND',
    };
  }

  const actorObj = resolveActor(actor);
  await audit(
    {
      action: 'lead.status_changed',
      actorType: actorObj.actorType,
      actorId: actorObj.actorId,
      targetType: 'lead',
      targetId: leadId,
      outcome: 'success',
      metadata: {
        from: lead.status,
        to: toStatus,
      },
    },
    client,
  );

  logger.info(
    {
      leadId,
      from: lead.status,
      to: toStatus,
    },
    'Lead status changed',
  );

  return Object.assign(
    {
      success: true as const,
      data: updated,
    },
    updated,
  );
}

/**
 * Lists leads with keyset pagination by (received_at DESC, id DESC).
 */
export async function listLeads(
  query: ListLeadsQuery = {},
  client: DbClient = defaultDb,
): Promise<{
  leads: Lead[];
  nextCursor: { receivedAt: string; id: string } | null;
  hasMore: boolean;
}> {
  const parsed = listLeadsQuerySchema.parse(query);
  return await listLeadsRecords(parsed, client);
}

/**
 * Retrieves a single lead by its UUID.
 */
export async function getLead(leadId: string, client: DbClient = defaultDb): Promise<Lead | null> {
  return await getLeadById(leadId, client);
}

/**
 * Hard-deletes non-converted leads only (AC-3, AC-4).
 * If any converted lead ID is included, rejects the entire call with CONVERTED_LEAD and deletes nothing.
 * Emits exactly one lead.deleted event with metadata { count, bulk }.
 */
export async function deleteLeads(
  leadIds: string[],
  actor?: ActorInput,
  client: DbClient = defaultDb,
): Promise<
  | { success: true; count: number; data: { count: number } }
  | { success: false; code: 'CONVERTED_LEAD'; error: 'CONVERTED_LEAD' }
> {
  if (leadIds.length === 0) {
    return {
      success: true,
      count: 0,
      data: { count: 0 },
    };
  }

  return await client.transaction(async (tx) => {
    // 1. Fetch leads by IDs to check for converted status (AC-3)
    const existingLeads = await getLeadsByIds(leadIds, tx);
    const hasConverted = existingLeads.some((l) => l.status === 'converted');

    if (hasConverted) {
      return {
        success: false,
        code: 'CONVERTED_LEAD',
        error: 'CONVERTED_LEAD',
      };
    }

    // 2. Delete non-converted leads (AC-4)
    const deletedCount = await deleteNonConvertedLeads(leadIds, tx);

    // 3. Emit exactly one lead.deleted audit event with { count, bulk } (AC-4)
    const actorObj = resolveActor(actor);
    await audit(
      {
        action: 'lead.deleted',
        actorType: actorObj.actorType,
        actorId: actorObj.actorId,
        targetType: 'lead',
        outcome: 'success',
        metadata: {
          count: deletedCount,
          bulk: leadIds.length > 1,
        },
      },
      tx,
    );

    logger.info(
      {
        count: deletedCount,
        bulk: leadIds.length > 1,
      },
      'Leads hard deleted',
    );

    return {
      success: true,
      count: deletedCount,
      data: { count: deletedCount },
    };
  });
}
