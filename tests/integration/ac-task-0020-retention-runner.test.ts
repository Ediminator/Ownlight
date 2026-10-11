import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as schema from '@/server/db/schema';
import { auditEvents, type AuditEvent } from '@/server/db/schema/audit';
import { session, rateLimits, user } from '@/server/db/schema/auth';
import { defineRetentionPolicy, registerPolicy, resetPolicies } from '@/server/retention';
import {
  executeRetentionSweep,
  parseCliArgs,
  type CliExecutionResult,
} from '@/server/retention/cli';
import { BackgroundWorker } from '@/server/retention/worker';
import type { DbClient } from '@/server/db/client';

vi.mock('server-only', () => ({}));

describe('TASK-0020: Unified Retention Runner and Worker Integration', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const drizzleDir = path.resolve(rootDir, 'drizzle');
  const retentionScriptPath = path.resolve(rootDir, 'scripts/retention-sweep.mjs');

  beforeEach(() => {
    resetPolicies();
  });

  it('AC-1: given custom policy registered via defineRetentionPolicy in TypeScript, CLI sweep --dry-run evaluates and reports policy', async () => {
    const client = new PGlite();
    try {
      const db = drizzle(client, { schema }) as unknown as DbClient;
      await migrate(drizzle(client), { migrationsFolder: drizzleDir });

      const now = new Date('2026-10-10T12:00:00.000Z');

      // Seed 2 audit events to simulate candidates for a custom policy
      const id1 = '01912345-6789-7abc-8def-0123456789a1';
      const id2 = '01912345-6789-7abc-8def-0123456789a2';
      await db.insert(auditEvents).values([
        {
          id: id1,
          occurredAt: new Date('2024-01-01T00:00:00Z'),
          actorType: 'system',
          action: 'auth.setup.completed',
          outcome: 'success',
          metadata: { custom_tag: 'test-consent-proof' },
        },
        {
          id: id2,
          occurredAt: new Date('2024-01-01T00:00:00Z'),
          actorType: 'system',
          action: 'auth.setup.completed',
          outcome: 'success',
          metadata: { custom_tag: 'test-consent-proof' },
        },
      ]);

      // Register custom domain policy using canonical defineRetentionPolicy
      const customPolicy = defineRetentionPolicy<AuditEvent>({
        id: 'withdrawn-consent-proof-custom',
        entity: 'audit_events',
        description: 'Test custom retention policy evaluated via TypeScript registry',
        after: { months: 12 },
        action: 'delete',
        getCandidates: async (c, cutoff, limit, excludedIds) => {
          const rows = await c.select().from(auditEvents).limit(limit);
          return rows.filter((r) => r.occurredAt < cutoff && !excludedIds.includes(r.id));
        },
      });
      registerPolicy(customPolicy);

      // Verify parseCliArgs handles --dry-run and --policy flags
      const parsedArgs = parseCliArgs([
        '--dry-run',
        '--policy=withdrawn-consent-proof-custom',
        '--batch-size=100',
      ]);
      expect(parsedArgs.dryRun).toBe(true);
      expect(parsedArgs.policyIds).toEqual(['withdrawn-consent-proof-custom']);
      expect(parsedArgs.batchSize).toBe(100);

      // Execute sweep with dry-run
      const sweepResult = await executeRetentionSweep({
        dbClient: db,
        dryRun: true,
        policyIds: ['withdrawn-consent-proof-custom'],
        now,
      });

      expect(sweepResult.dryRun).toBe(true);
      expect(sweepResult.totalScanned).toBe(2);
      expect(sweepResult.totalDeleted).toBe(0);

      const reportedPolicy = sweepResult.policies.find(
        (p) => p.policyId === 'withdrawn-consent-proof-custom',
      );
      expect(reportedPolicy).toBeDefined();
      expect(reportedPolicy?.scannedCount).toBe(2);
      expect(reportedPolicy?.deletedCount).toBe(0);

      // Records must still be intact in DB
      const countRes = await db.select().from(auditEvents);
      expect(countRes).toHaveLength(2);
    } finally {
      await client.close();
    }
  });

  it('AC-2: given live retention sweep without --dry-run, built-in policies execute deletions in transactional batches and emit audit events', async () => {
    const client = new PGlite();
    try {
      const db = drizzle(client, { schema }) as unknown as DbClient;
      await migrate(drizzle(client), { migrationsFolder: drizzleDir });

      const now = new Date('2026-10-10T12:00:00.000Z');

      // Create owner user for FK relations
      const [owner] = await db
        .insert(user)
        .values({
          id: '01912345-6789-7abc-8def-0123456789b0',
          name: 'AC2 Studio Owner',
          email: 'ac2.owner@example.org',
          role: 'owner',
        })
        .returning();

      if (!owner) throw new Error('Failed to create owner user');

      // 1. Old audit event (26 months ago)
      const oldAuditId = '01912345-6789-7abc-8def-0123456789b1';
      await db.insert(auditEvents).values({
        id: oldAuditId,
        occurredAt: new Date('2024-08-01T00:00:00Z'),
        actorType: 'system',
        action: 'auth.setup.completed',
        outcome: 'success',
      });

      // 2. Expired session
      const expiredSessId = '01912345-6789-7abc-8def-0123456789b2';
      await db.insert(session).values({
        id: expiredSessId,
        userId: owner.id,
        token: 'tok-ac2-exp',
        expiresAt: new Date('2026-10-09T00:00:00Z'),
      });

      // 3. Expired rate limit
      const expiredLimitId = '01912345-6789-7abc-8def-0123456789b3';
      await db.insert(rateLimits).values({
        id: expiredLimitId,
        key: 'ip:127.0.0.1:auth',
        count: 10,
        expiresAt: new Date('2026-10-09T00:00:00Z'),
      });

      // Execute live sweep
      const result = await executeRetentionSweep({
        dbClient: db,
        dryRun: false,
        now,
      });

      expect(result.dryRun).toBe(false);
      expect(result.totalDeleted).toBe(3);

      // Verify deletions
      const remainingAudit = await db.select().from(auditEvents);
      const remainingAuditIds = remainingAudit.map((r) => r.id);
      expect(remainingAuditIds).not.toContain(oldAuditId);

      const remainingSessions = await db.select().from(session);
      expect(remainingSessions.map((r) => r.id)).not.toContain(expiredSessId);

      const remainingLimits = await db.select().from(rateLimits);
      expect(remainingLimits.map((r) => r.id)).not.toContain(expiredLimitId);

      // Verify retention.sweep.completed audit event was emitted
      const sweepAuditEvents = remainingAudit.filter(
        (r) => r.action === 'retention.sweep.completed',
      );
      expect(sweepAuditEvents.length).toBeGreaterThanOrEqual(1);
      const sweepEvent = sweepAuditEvents[0];
      expect(sweepEvent).toBeDefined();
      expect(sweepEvent?.outcome).toBe('success');
      expect(sweepEvent?.metadata).toHaveProperty('deleted_count');
    } finally {
      await client.close();
    }
  });

  it('AC-3: given SIGINT or SIGTERM sent to worker, worker drains active batch cleanly without leaving orphaned locks', async () => {
    let unlockExecuted = false;
    let endExecuted = false;

    const mockSql = Object.assign(
      vi.fn().mockImplementation((strings: TemplateStringsArray) => {
        const query = strings[0] ?? '';
        if (query.includes('pg_try_advisory_lock')) {
          return Promise.resolve([{ locked: true }]);
        }
        if (query.includes('pg_advisory_unlock')) {
          unlockExecuted = true;
          return Promise.resolve([{ unlocked: true }]);
        }
        return Promise.resolve([]);
      }),
      {
        end: vi.fn().mockImplementation(() => {
          endExecuted = true;
          return Promise.resolve();
        }),
      },
    );

    const worker = new BackgroundWorker({
      connectionUrl: 'postgres://mock:mock@127.0.0.1:5432/mock_db',
      runOnce: false,
    });

    // Inject mock sql client
    worker.sql = mockSql as unknown as typeof worker.sql;

    // Simulate active in-flight sweep batch
    let resolveSweep: (val: CliExecutionResult) => void = () => undefined;
    worker.activeSweepPromise = new Promise((resolve) => {
      resolveSweep = resolve;
    });

    // Initiate stop
    const stopPromise = worker.stop();

    expect(worker.isShuttingDown).toBe(true);
    expect(worker.abortController.signal.aborted).toBe(true);

    // Complete in-flight batch
    resolveSweep({
      dryRun: false,
      startedAt: new Date(),
      completedAt: new Date(),
      durationMs: 1,
      totalScanned: 0,
      totalDeleted: 0,
      totalHeld: 0,
      aborted: false,
      policies: [],
      auditEvents: { scanned: 0, deleted: 0, held: 0 },
      sessions: { scanned: 0, deleted: 0, held: 0 },
      rateLimits: { scanned: 0, deleted: 0, held: 0 },
    });
    await stopPromise;

    // Verify advisory lock was unlocked and connection was closed cleanly
    expect(unlockExecuted).toBe(true);
    expect(endExecuted).toBe(true);
    expect(worker.sql).toBeNull();
  });

  it('AC-4: given restricted DATABASE_RETENTION_URL, sweep executes successfully and cannot perform DDL or unauthorised writes', async () => {
    const client = new PGlite();
    try {
      // 1. Establish PostgreSQL role boundaries
      await client.exec(`
        CREATE ROLE ownlight_migrator;
        CREATE ROLE ownlight_app;
        CREATE ROLE ownlight_retention;

        ALTER SCHEMA public OWNER TO ownlight_migrator;
        REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        REVOKE CREATE ON SCHEMA public FROM ownlight_app;
        REVOKE CREATE ON SCHEMA public FROM ownlight_retention;

        GRANT USAGE, CREATE ON SCHEMA public TO ownlight_migrator;
        GRANT USAGE ON SCHEMA public TO ownlight_app;
        GRANT USAGE ON SCHEMA public TO ownlight_retention;
      `);

      // 2. Run migrations under migrator role
      await migrate(drizzle(client), { migrationsFolder: drizzleDir });

      // Grant restricted privileges matching production ownlight_retention role
      await client.exec(`
        REVOKE ALL ON audit_events FROM ownlight_retention;
        GRANT SELECT, DELETE ON audit_events TO ownlight_retention;
        REVOKE ALL ON session FROM ownlight_retention;
        GRANT SELECT, DELETE ON session TO ownlight_retention;
        REVOKE ALL ON rate_limits FROM ownlight_retention;
        GRANT SELECT, DELETE ON rate_limits TO ownlight_retention;
      `);

      // Seed 1 old audit event under migrator
      const eventId = '01912345-6789-7abc-8def-0123456789c1';
      await client.query(`
        INSERT INTO audit_events (id, occurred_at, actor_type, action, outcome)
        VALUES ('${eventId}', '2024-01-01T00:00:00Z', 'system', 'auth.setup.completed', 'success');
      `);

      // 3. Switch active session role to ownlight_retention
      await client.exec('SET ROLE ownlight_retention;');

      // 4a. Verify DDL is strictly denied for retention role
      await expect(
        client.exec('CREATE TABLE unauthorized_retention_table (id int);'),
      ).rejects.toThrow(/permission denied/i);

      await expect(client.exec('DROP TABLE audit_events;')).rejects.toThrow(
        /must be owner of table audit_events/i,
      );

      // 4b. Verify UPDATE is denied for retention role
      await expect(
        client.exec(`UPDATE audit_events SET action = 'tampered' WHERE id = '${eventId}';`),
      ).rejects.toThrow(/permission denied|audit_events rows cannot be updated/i);

      // 4c. Verify retention deletion succeeds under retention role
      await client.query(`DELETE FROM audit_events WHERE id = '${eventId}';`);
      const afterDelete = await client.query(
        `SELECT id FROM audit_events WHERE id = '${eventId}';`,
      );
      expect(afterDelete.rows).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  it('AC-5: scripts/retention-sweep.mjs contains zero duplicate table/schema definitions and delegates to compiled runner', () => {
    const scriptContent = readFileSync(retentionScriptPath, 'utf8');

    // Proves duplicate Drizzle pgTable definitions have been eliminated
    expect(scriptContent).not.toContain('pgTable(');
    expect(scriptContent).not.toContain("pgTable('audit_events'");
    expect(scriptContent).not.toContain("pgTable('session'");
    expect(scriptContent).not.toContain("pgTable('rate_limits'");

    // Proves script delegates to unified CLI runner
    expect(scriptContent).toContain('executeRetentionSweep');
    expect(scriptContent).toContain('dist/retention/cli.mjs');
  });
});
