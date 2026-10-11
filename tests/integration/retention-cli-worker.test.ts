import { describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'node:path';
import * as schema from '@/server/db/schema';
import { executeRetentionSweep } from '@/server/retention/runner';
import { BackgroundWorker } from '@/server/retention/worker';
import type { DbClient } from '@/server/db/client';

vi.mock('server-only', () => ({}));

describe('Retention CLI & Worker scripts integration', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const drizzleDir = path.resolve(rootDir, 'drizzle');

  it('executeRetentionSweep respects dryRun option and reports per-policy stats', async () => {
    const client = new PGlite();
    try {
      const db = drizzle(client, { schema }) as unknown as DbClient;
      await migrate(drizzle(client), { migrationsFolder: drizzleDir });

      const now = new Date('2026-10-10T12:00:00.000Z');

      await client.query(`
        INSERT INTO audit_events (id, occurred_at, actor_type, action, outcome)
        VALUES ('01912345-6789-7abc-8def-0123456789aa', '2024-01-01', 'system', 'auth.setup.completed', 'success');
      `);

      // 1. Dry run
      const dryResult = await executeRetentionSweep({
        dbClient: db,
        dryRun: true,
        now,
      });

      expect(dryResult.dryRun).toBe(true);
      expect(dryResult.auditEvents.scanned).toBe(1);
      expect(dryResult.auditEvents.deleted).toBe(0);

      const countAfterDry = await client.query<{ cnt: string | number }>(
        'SELECT count(*) as cnt FROM audit_events',
      );
      expect(Number(countAfterDry.rows[0]?.cnt)).toBe(1);

      // 2. Live run
      const liveResult = await executeRetentionSweep({
        dbClient: db,
        dryRun: false,
        now,
      });

      expect(liveResult.dryRun).toBe(false);
      expect(liveResult.auditEvents.scanned).toBe(1);
      expect(liveResult.auditEvents.deleted).toBe(1);

      // Audit table now contains the retention.sweep.completed audit event
      const rowsAfterLive = await client.query<{ action: string }>(
        'SELECT action FROM audit_events',
      );
      expect(rowsAfterLive.rows).toHaveLength(1);
      expect(rowsAfterLive.rows[0]?.action).toBe('retention.sweep.completed');
    } finally {
      await client.close();
    }
  });

  it('I1-S01: executeRetentionSweep evaluates legalHold and preserves held records across batch chunks', async () => {
    const client = new PGlite();
    try {
      const db = drizzle(client, { schema }) as unknown as DbClient;
      await migrate(drizzle(client), { migrationsFolder: drizzleDir });

      const now = new Date('2026-10-10T12:00:00.000Z');

      // Seed 2 old events: 1 held, 1 eligible
      const heldId = '01912345-6789-7abc-8def-0123456789b1';
      const normalId = '01912345-6789-7abc-8def-0123456789b2';

      await client.query(`
        INSERT INTO audit_events (id, occurred_at, actor_type, action, outcome, metadata)
        VALUES ('${heldId}', '2024-01-01', 'system', 'auth.setup.completed', 'success', '{"legal_hold": true}')
      `);
      await client.query(`
        INSERT INTO audit_events (id, occurred_at, actor_type, action, outcome, metadata)
        VALUES ('${normalId}', '2024-01-01', 'system', 'auth.setup.completed', 'success', '{"note": "normal"}')
      `);

      // Run live sweep with batchSize = 1 to test pagination and chunking
      const result = await executeRetentionSweep({
        dbClient: db,
        dryRun: false,
        now,
        batchSize: 1,
      });

      expect(result.auditEvents.scanned).toBe(2);
      expect(result.auditEvents.held).toBe(1);
      expect(result.auditEvents.deleted).toBe(1);

      // Verify held event is still present in DB
      const heldCheck = await client.query<{ id: string }>(
        `SELECT id FROM audit_events WHERE id = '${heldId}'`,
      );
      expect(heldCheck.rows).toHaveLength(1);

      // Verify normal event was deleted
      const normalCheck = await client.query<{ id: string }>(
        `SELECT id FROM audit_events WHERE id = '${normalId}'`,
      );
      expect(normalCheck.rows).toHaveLength(0);

      // Verify retention.sweep.completed recorded held_count: 1
      const sweepAuditRes = await client.query<{ metadata: { held_count: number } }>(
        `SELECT metadata FROM audit_events WHERE action = 'retention.sweep.completed'`,
      );
      expect(sweepAuditRes.rows[0]?.metadata.held_count).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('I1-S03: throws descriptive error when database connection URL is omitted from environment and options', async () => {
    const originalRetentionUrl = process.env.DATABASE_RETENTION_URL;
    const originalDbUrl = process.env.DATABASE_URL;

    try {
      delete process.env.DATABASE_RETENTION_URL;
      delete process.env.DATABASE_URL;

      await expect(
        executeRetentionSweep({
          connectionUrl: undefined,
          dbClient: undefined,
        }),
      ).rejects.toThrow(/Database connection URL missing/i);

      expect(
        () =>
          new BackgroundWorker({
            connectionUrl: undefined,
          }),
      ).toThrow(/Database connection URL missing/i);
    } finally {
      if (originalRetentionUrl) process.env.DATABASE_RETENTION_URL = originalRetentionUrl;
      if (originalDbUrl) process.env.DATABASE_URL = originalDbUrl;
    }
  });

  it('BackgroundWorker initializes, executes sweep cycle and stops cleanly with connection URL provided', async () => {
    const worker = new BackgroundWorker({
      connectionUrl: 'postgres://mock:mock@127.0.0.1:5432/mock_db',
      runOnce: true,
    });
    expect(typeof worker.start).toBe('function');
    expect(typeof worker.stop).toBe('function');
    expect(worker.isShuttingDown).toBe(false);

    await worker.stop();
    expect(worker.isShuttingDown).toBe(true);
  });
});
