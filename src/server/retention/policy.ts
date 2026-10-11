import { lt, notInArray, inArray, and } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { auditEvents, type AuditEvent } from '@/server/db/schema/audit';
import { session, rateLimits, type Session, type RateLimit } from '@/server/db/schema/auth';
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
  legalHold?: (row: T) => boolean | Promise<boolean>;
  getCandidates?: (
    client: DbClient,
    cutoff: Date,
    limit: number,
    excludedIds: string[],
  ) => Promise<T[]>;
  deleteBatch?: (client: DbClient, ids: string[]) => Promise<void>;
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
  };
}

/**
 * Built-in default retention policies (ADR-0007 / Constitution).
 */
export function createDefaultPolicies(): RetentionPolicy[] {
  let auditMonths = 24;
  try {
    const val = env.RETENTION_PERIOD_MONTHS;
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      auditMonths = val;
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

  return [
    auditEventsPolicy as unknown as RetentionPolicy,
    expiredSessionsPolicy as unknown as RetentionPolicy,
    expiredRateLimitsPolicy as unknown as RetentionPolicy,
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
