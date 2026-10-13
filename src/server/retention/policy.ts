import { lt, notInArray, inArray, and, eq, sql, asc } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { auditEvents, type AuditEvent } from '@/server/db/schema/audit';
import { session, rateLimits, type Session, type RateLimit } from '@/server/db/schema/auth';
import { consentRecords, type ConsentRecord } from '@/server/db/schema/consents';
import { clientTimelineEvents } from '@/server/db/schema/timeline';
import { clients } from '@/server/db/schema/clients';
import { leads } from '@/server/db/schema/leads';
import { inquiryPowReplays } from '@/server/db/schema/inquiry-forms';
import { emailOutbox } from '@/server/db/schema/email-outbox';
import { findActiveClientIds } from '@/server/clients/activity';
import { env } from '@/env';

export interface RetentionEntity {
  id: string;
}

export interface RetentionPolicyDef<T extends RetentionEntity = RetentionEntity> {
  id: string;
  entity: string;
  description?: string;
  after?: {
    months?: number;
    days?: number;
    hours?: number;
  };
  where?: (client: DbClient, now: Date) => Promise<T[]> | T[];
  action: 'delete' | 'anonymize';
  legalHold?: (row: T, client?: DbClient) => boolean | Promise<boolean>;
  getCandidates?: (
    client: DbClient,
    cutoff: Date,
    limit: number,
    excludedIds: string[],
  ) => Promise<T[]>;
  deleteBatch?: (client: DbClient, ids: string[]) => Promise<void>;
  eraseCandidate?: (
    client: DbClient,
    id: string,
  ) => Promise<{ outcome: 'deleted' | 'held' | 'failed'; error?: unknown }>;
  anonymizeBatch?: (client: DbClient, ids: string[]) => Promise<void>;
  batchSize?: number;
}

export interface RetentionPolicy<
  T extends RetentionEntity = RetentionEntity,
> extends RetentionPolicyDef<T> {
  getCandidates: (
    client: DbClient,
    cutoff: Date,
    limit: number,
    excludedIds: string[],
  ) => Promise<T[]>;
  deleteBatch: (client: DbClient, ids: string[]) => Promise<void>;
  eraseCandidate?: (
    client: DbClient,
    id: string,
  ) => Promise<{ outcome: 'deleted' | 'held' | 'failed'; error?: unknown }>;
}

export function getClientRetentionMonths(): number {
  try {
    const raw = process.env.CLIENT_RETENTION_MONTHS;
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 1) {
        return parsed;
      }
    }
    const val = env.CLIENT_RETENTION_MONTHS;
    if (typeof val === 'number' && Number.isFinite(val) && val >= 1) {
      return val;
    }
  } catch {
    // Fallback if env is not configured in current execution context (e.g. unit tests)
  }
  return 36;
}

export function getLeadRetentionMonths(): number {
  try {
    const raw = process.env.LEAD_RETENTION_MONTHS;
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 36) {
        return parsed;
      }
    }
    const val = env.LEAD_RETENTION_MONTHS;
    if (typeof val === 'number' && Number.isFinite(val) && val >= 1 && val <= 36) {
      return val;
    }
  } catch {
    // Fallback if env is not configured in current execution context (e.g. unit tests)
  }
  return 12;
}

export function computeCutoff(
  now: Date,
  after?: { months?: number; days?: number; hours?: number },
): Date {
  const cutoff = new Date(now.getTime());
  if (!after) return cutoff;

  if (after.months) {
    cutoff.setMonth(cutoff.getMonth() - after.months);
  }
  if (after.days) {
    cutoff.setDate(cutoff.getDate() - after.days);
  }
  if (after.hours) {
    cutoff.setHours(cutoff.getHours() - after.hours);
  }
  return cutoff;
}

export function defineRetentionPolicy<T extends RetentionEntity = RetentionEntity>(
  def: RetentionPolicyDef<T>,
): RetentionPolicy<T> {
  const getCandidates =
    def.getCandidates ??
    (async (client: DbClient, cutoff: Date, limit: number, excludedIds: string[]): Promise<T[]> => {
      if (def.where) {
        const rows = await def.where(client, cutoff);
        return rows.filter((r) => !excludedIds.includes(r.id)).slice(0, limit);
      }
      return [];
    });

  const deleteBatch =
    def.deleteBatch ??
    (async (): Promise<void> => {
      // Default no-op if custom delete logic is not provided
    });

  return {
    ...def,
    getCandidates,
    deleteBatch,
    eraseCandidate: def.eraseCandidate,
  };
}

/**
 * Built-in default retention policies (ADR-0007 / Constitution).
 */
export function createDefaultPolicies(): RetentionPolicy[] {
  let auditMonths = 24;
  try {
    const raw = process.env.RETENTION_PERIOD_MONTHS;
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        auditMonths = parsed;
      }
    } else {
      const val = env.RETENTION_PERIOD_MONTHS;
      if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
        auditMonths = val;
      }
    }
  } catch {
    auditMonths = 24;
  }

  // 1. Audit events older than configured period (default 24 months)
  const auditEventsPolicy = defineRetentionPolicy<AuditEvent>({
    id: 'audit-events-retention',
    entity: 'audit_events',
    description: 'Purges historical audit events older than retention period',
    after: { months: auditMonths },
    action: 'delete',
    batchSize: 500,
    legalHold: (row: AuditEvent) => {
      const meta = row.metadata;
      return Boolean(
        meta && typeof meta === 'object' && 'legal_hold' in meta && meta.legal_hold === true,
      );
    },
    getCandidates: async (client, cutoff, limit, excludedIds) => {
      if (excludedIds.length > 0) {
        return await client
          .select()
          .from(auditEvents)
          .where(and(lt(auditEvents.occurredAt, cutoff), notInArray(auditEvents.id, excludedIds)))
          .limit(limit);
      }

      return await client
        .select()
        .from(auditEvents)
        .where(lt(auditEvents.occurredAt, cutoff))
        .limit(limit);
    },
    deleteBatch: async (client, ids) => {
      if (ids.length === 0) return;
      await client.delete(auditEvents).where(inArray(auditEvents.id, ids));
    },
  });

  // 2. Expired user sessions (expiresAt < now)
  const expiredSessionsPolicy = defineRetentionPolicy<Session>({
    id: 'expired-sessions',
    entity: 'session',
    description: 'Purges expired Better-Auth user sessions',
    action: 'delete',
    batchSize: 500,
    getCandidates: async (client, now, limit, excludedIds) => {
      if (excludedIds.length > 0) {
        return await client
          .select()
          .from(session)
          .where(and(lt(session.expiresAt, now), notInArray(session.id, excludedIds)))
          .limit(limit);
      }
      return await client.select().from(session).where(lt(session.expiresAt, now)).limit(limit);
    },
    deleteBatch: async (client, ids) => {
      if (ids.length === 0) return;
      await client.delete(session).where(inArray(session.id, ids));
    },
  });

  // 3. Expired rate limit tracking rows (expiresAt < now)
  const expiredRateLimitsPolicy = defineRetentionPolicy<RateLimit>({
    id: 'expired-rate-limits',
    entity: 'rate_limits',
    description: 'Purges expired database-backed rate limit counters',
    action: 'delete',
    batchSize: 500,
    getCandidates: async (client, now, limit, excludedIds) => {
      if (excludedIds.length > 0) {
        return await client
          .select()
          .from(rateLimits)
          .where(and(lt(rateLimits.expiresAt, now), notInArray(rateLimits.id, excludedIds)))
          .limit(limit);
      }
      return await client
        .select()
        .from(rateLimits)
        .where(lt(rateLimits.expiresAt, now))
        .limit(limit);
    },
    deleteBatch: async (client, ids) => {
      if (ids.length === 0) return;
      await client.delete(rateLimits).where(inArray(rateLimits.id, ids));
    },
  });

  // 4. Withdrawn consent records chain older than retention period (default 36 months, GDPR Art. 7(1) proof)
  let consentProofMonths = 36;
  try {
    const raw = process.env.CONSENT_PROOF_RETENTION_MONTHS;
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        consentProofMonths = parsed;
      }
    } else {
      const val = env.CONSENT_PROOF_RETENTION_MONTHS;
      if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
        consentProofMonths = val;
      }
    }
  } catch {
    consentProofMonths = 36;
  }

  const withdrawnConsentProofPolicy = defineRetentionPolicy<ConsentRecord>({
    id: 'withdrawn-consent-proof',
    entity: 'consent_records',
    description:
      'Purges historical withdrawn consent record chains older than retention period together with associated timeline events',
    after: { months: consentProofMonths },
    action: 'delete',
    batchSize: 500,
    getCandidates: async (client, cutoff, limit, excludedIds) => {
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const excludedCondition =
        excludedIds.length > 0 ? sql`AND cr.id NOT IN ${excludedIds}` : sql``;

      const query = sql`
        WITH latest_records AS (
          SELECT
            id,
            contact_id,
            purpose,
            status,
            effective_on,
            ROW_NUMBER() OVER (
              PARTITION BY contact_id, purpose
              ORDER BY effective_on DESC, created_at DESC, id DESC
            ) as rn
          FROM consent_records
        ),
        eligible_chains AS (
          SELECT contact_id, purpose
          FROM latest_records
          WHERE rn = 1
            AND status = 'withdrawn'
            AND effective_on < ${cutoffStr}::date
        )
        SELECT cr.id
        FROM consent_records cr
        INNER JOIN eligible_chains ec
          ON cr.contact_id = ec.contact_id
          AND cr.purpose = ec.purpose
        WHERE 1=1 ${excludedCondition}
        ORDER BY cr.effective_on ASC, cr.created_at ASC
        LIMIT ${limit}
      `;

      const res = await client.execute(query);
      const rawRows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as {
        id: string;
      }[];
      if (rawRows.length === 0) return [];
      const ids = rawRows.map((r) => r.id);
      return await client.select().from(consentRecords).where(inArray(consentRecords.id, ids));
    },
    deleteBatch: async (client, ids) => {
      if (ids.length === 0) return;
      // 1. Delete associated timeline events (subjectType = 'consent_record' AND subjectId IN (ids))
      await client
        .delete(clientTimelineEvents)
        .where(
          and(
            sql`${clientTimelineEvents.subjectType} = 'consent_record'`,
            inArray(clientTimelineEvents.subjectId, ids),
          ),
        );
      // 2. Delete consent records
      await client.delete(consentRecords).where(inArray(consentRecords.id, ids));
    },
  });

  // 5. Inactive clients policy (ADR-0012 §4.2, TASK-0019)
  const clientMonths = getClientRetentionMonths();

  const inactiveClientsPolicy = defineRetentionPolicy<{ id: string; lastActivityAt: Date }>({
    id: 'inactive-clients',
    entity: 'clients',
    description:
      'Purges clients inactive for 36 months (configurable) without activity, respecting legal holds',
    after: { months: clientMonths },
    action: 'delete',
    batchSize: 50,
    legalHold: async (row, tx) => {
      if (!tx) return false;
      const { getErasureHoldProviders } = await import('@/server/privacy/erasure/registry');
      const holdProviders = getErasureHoldProviders();
      for (const hp of holdProviders) {
        const holds = await hp.holds({ kind: 'client', clientId: row.id }, tx);
        if (holds.length > 0) return true;
      }
      return false;
    },
    getCandidates: async (client, cutoff, limit, excludedIds) => {
      const basePredicate =
        excludedIds.length > 0
          ? and(lt(clients.lastActivityAt, cutoff), notInArray(clients.id, excludedIds))
          : lt(clients.lastActivityAt, cutoff);

      const rows = await client
        .select({
          id: clients.id,
          lastActivityAt: clients.lastActivityAt,
        })
        .from(clients)
        .where(basePredicate)
        .orderBy(asc(clients.lastActivityAt), asc(clients.id))
        .limit(Math.max(limit * 2, 100));

      if (rows.length === 0) return [];

      const candidateIds = rows.map((r) => r.id);
      const activeIds = await findActiveClientIds(client, cutoff, candidateIds);

      return rows.filter((r) => !activeIds.has(r.id)).slice(0, limit);
    },
    eraseCandidate: async (client, id) => {
      const { eraseSubject } = await import('@/server/privacy/erasure/service');
      const res = await eraseSubject(
        { kind: 'client', clientId: id },
        { actor: { actorType: 'system', actorId: 'retention-worker' } },
        client,
      );
      if (res.success) {
        return { outcome: 'deleted' };
      }
      if (res.code === 'ERASURE_BLOCKED') {
        return { outcome: 'held' };
      }
      return { outcome: 'failed', error: res.error };
    },
    deleteBatch: async (client, ids) => {
      const { eraseSubject } = await import('@/server/privacy/erasure/service');
      for (const id of ids) {
        await eraseSubject(
          { kind: 'client', clientId: id },
          { actor: { actorType: 'system', actorId: 'retention-worker' } },
          client,
        );
      }
    },
  });

  // 6. Unconverted leads policy (ADR-0015 §9, TASK-0026)
  const unconvertedLeadsPolicy = defineRetentionPolicy<{ id: string }>({
    id: 'unconverted-leads',
    entity: 'leads',
    description:
      'Purges unconverted leads (new, contacted, archived) inactive for configured retention period (default 12 months)',
    get after() {
      return { months: getLeadRetentionMonths() };
    },
    action: 'delete',
    batchSize: 500,
    getCandidates: async (client, cutoff, limit, excludedIds) => {
      const basePredicate = and(
        inArray(leads.status, ['new', 'contacted', 'archived']),
        lt(leads.lastActivityAt, cutoff),
        excludedIds.length > 0 ? notInArray(leads.id, excludedIds) : undefined,
      );

      return await client
        .select({
          id: leads.id,
        })
        .from(leads)
        .where(basePredicate)
        .orderBy(asc(leads.lastActivityAt), asc(leads.id))
        .limit(limit);
    },
    eraseCandidate: async (client, id) => {
      const { eraseSubject } = await import('@/server/privacy/erasure/service');
      const res = await eraseSubject(
        { kind: 'lead', leadId: id },
        { actor: { actorType: 'system', actorId: 'retention-worker' } },
        client,
      );
      if (res.success) {
        return { outcome: 'deleted' };
      }
      if (res.code === 'ERASURE_BLOCKED') {
        return { outcome: 'held' };
      }
      return { outcome: 'failed', error: res.error };
    },
    deleteBatch: async (client, ids) => {
      const { eraseSubject } = await import('@/server/privacy/erasure/service');
      for (const id of ids) {
        await eraseSubject(
          { kind: 'lead', leadId: id },
          { actor: { actorType: 'system', actorId: 'retention-worker' } },
          client,
        );
      }
    },
  });

  // 7. Spam leads policy (ADR-0015 §9, TASK-0026)
  const spamLeadsPolicy = defineRetentionPolicy<{ id: string }>({
    id: 'spam-leads',
    entity: 'leads',
    description: 'Purges spam leads inactive for 30 days',
    after: { days: 30 },
    action: 'delete',
    batchSize: 500,
    getCandidates: async (client, cutoff, limit, excludedIds) => {
      const basePredicate = and(
        eq(leads.status, 'spam'),
        lt(leads.lastActivityAt, cutoff),
        excludedIds.length > 0 ? notInArray(leads.id, excludedIds) : undefined,
      );

      return await client
        .select({
          id: leads.id,
        })
        .from(leads)
        .where(basePredicate)
        .orderBy(asc(leads.lastActivityAt), asc(leads.id))
        .limit(limit);
    },
    eraseCandidate: async (client, id) => {
      const { eraseSubject } = await import('@/server/privacy/erasure/service');
      const res = await eraseSubject(
        { kind: 'lead', leadId: id },
        { actor: { actorType: 'system', actorId: 'retention-worker' } },
        client,
      );
      if (res.success) {
        return { outcome: 'deleted' };
      }
      if (res.code === 'ERASURE_BLOCKED') {
        return { outcome: 'held' };
      }
      return { outcome: 'failed', error: res.error };
    },
    deleteBatch: async (client, ids) => {
      const { eraseSubject } = await import('@/server/privacy/erasure/service');
      for (const id of ids) {
        await eraseSubject(
          { kind: 'lead', leadId: id },
          { actor: { actorType: 'system', actorId: 'retention-worker' } },
          client,
        );
      }
    },
  });

  // 8. Expired PoW replays (expires_at < now) (ADR-0015 §9, TASK-0029 AC-11)
  const expiredPowReplaysPolicy = defineRetentionPolicy<{ id: string }>({
    id: 'expired-pow-replays',
    entity: 'inquiry_pow_replays',
    description: 'Purges expired proof-of-work challenge signatures',
    action: 'delete',
    batchSize: 500,
    getCandidates: async (client, now, limit, excludedIds) => {
      const basePredicate =
        excludedIds.length > 0
          ? and(
              lt(inquiryPowReplays.expiresAt, now),
              notInArray(inquiryPowReplays.signatureHash, excludedIds),
            )
          : lt(inquiryPowReplays.expiresAt, now);

      const rows = await client
        .select({
          id: inquiryPowReplays.signatureHash,
        })
        .from(inquiryPowReplays)
        .where(basePredicate)
        .limit(limit);

      return rows;
    },
    deleteBatch: async (client, ids) => {
      if (ids.length === 0) return;
      await client.delete(inquiryPowReplays).where(inArray(inquiryPowReplays.signatureHash, ids));
    },
  });

  // 9. Failed email outbox items (status = 'FAILED' AND updated_at < now - 30 days) (ADR-0015 §9, TASK-0030 AC-12)
  const failedEmailOutboxPolicy = defineRetentionPolicy<{ id: string }>({
    id: 'failed-email-outbox',
    entity: 'email_outbox',
    description: 'Purges failed transactional email outbox items older than 30 days',
    after: { days: 30 },
    action: 'delete',
    batchSize: 500,
    getCandidates: async (client, cutoff, limit, excludedIds) => {
      const basePredicate = and(
        eq(emailOutbox.status, 'FAILED'),
        lt(emailOutbox.updatedAt, cutoff),
        excludedIds.length > 0 ? notInArray(emailOutbox.id, excludedIds) : undefined,
      );

      const rows = await client
        .select({
          id: emailOutbox.id,
        })
        .from(emailOutbox)
        .where(basePredicate)
        .orderBy(asc(emailOutbox.updatedAt), asc(emailOutbox.id))
        .limit(limit);

      return rows;
    },
    deleteBatch: async (client, ids) => {
      if (ids.length === 0) return;
      await client.delete(emailOutbox).where(inArray(emailOutbox.id, ids));
    },
  });

  return [
    auditEventsPolicy as unknown as RetentionPolicy,
    expiredSessionsPolicy as unknown as RetentionPolicy,
    expiredRateLimitsPolicy as unknown as RetentionPolicy,
    withdrawnConsentProofPolicy as unknown as RetentionPolicy,
    inactiveClientsPolicy as unknown as RetentionPolicy,
    unconvertedLeadsPolicy,
    spamLeadsPolicy,
    expiredPowReplaysPolicy,
    failedEmailOutboxPolicy,
  ];
}

const policyRegistry = new Map<string, RetentionPolicy>();

export function registerPolicy<T extends RetentionEntity>(policy: RetentionPolicy<T>): void {
  policyRegistry.set(policy.id, policy as unknown as RetentionPolicy);
}

export function getPolicies(): RetentionPolicy[] {
  if (policyRegistry.size === 0) {
    for (const p of createDefaultPolicies()) {
      registerPolicy(p);
    }
  }
  return Array.from(policyRegistry.values());
}

export function resetPolicies(): void {
  policyRegistry.clear();
  for (const p of createDefaultPolicies()) {
    registerPolicy(p);
  }
}
