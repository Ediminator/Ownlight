import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { clientNotes, clientTimelineEvents } from '@/server/db/schema/timeline';
import { consentRecords } from '@/server/db/schema/consents';
import { clientLegalHolds } from '@/server/db/schema/client-legal-holds';
import { auditEvents } from '@/server/db/schema/audit';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { user } from '@/server/db/schema/auth';
import {
  createIsolatedTestDatabase,
  loadMigrationSql,
  type TestDatabaseInstance,
} from '../helpers/db-test-helper';
import { runRetentionSweep } from '@/server/retention/sweep';
import { registerActivityProvider, resetActivityProviders } from '@/server/clients/activity';
import {
  registerErasureProvider,
  resetErasureProviders,
  resetErasureHoldProviders,
} from '@/server/privacy/erasure/registry';
import type { DbClient } from '@/server/db/client';

describe('TASK-0019: Inactive Client Retention Policy Integration (AC-8 to AC-13)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  const ownerUserId = '018f0000-0000-7000-8000-000000000001';

  beforeEach(async () => {
    resetErasureHoldProviders();
    resetErasureProviders();
    resetActivityProviders();

    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;

    // Seed studio owner user
    await dbClient.insert(user).values({
      id: ownerUserId,
      name: 'Test Owner',
      email: 'owner@example.org',
      role: 'owner',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });

    // Seed studio settings
    await dbClient.insert(studioSettings).values({
      studio_name: 'Studio Test',
      currency: 'EUR',
      default_locale: 'en',
      timezone: 'UTC',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });
  });

  afterEach(async () => {
    delete (globalThis as unknown as { db: DbClient | undefined }).db;
    resetErasureHoldProviders();
    resetErasureProviders();
    resetActivityProviders();
    await testDb.destroy();
  });

  // Client ID constants for AC-8 / AC-9 matrix
  const clientAId = '018f0000-0000-7000-8000-00000000000a';
  const clientBId = '018f0000-0000-7000-8000-00000000000b';
  const clientCId = '018f0000-0000-7000-8000-00000000000c';
  const clientDId = '018f0000-0000-7000-8000-00000000000d';
  const clientEId = '018f0000-0000-7000-8000-00000000000e';
  const clientFId = '018f0000-0000-7000-8000-00000000000f';
  const clientGId = '018f0000-0000-7000-8000-000000000010';
  const clientHId = '018f0000-0000-7000-8000-000000000011';

  const contactDId = '018f0000-0000-7000-8000-00000000001d';

  async function seedMatrix(now: Date) {
    const thirtySevenMonthsAgo = new Date(
      now.getFullYear(),
      now.getMonth() - 37,
      now.getDate(),
      12,
      0,
      0,
    );
    const thirtyFiveMonthsAgo = new Date(
      now.getFullYear(),
      now.getMonth() - 35,
      now.getDate(),
      12,
      0,
      0,
    );
    const fiveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, now.getDate(), 12, 0, 0);
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate(), 12, 0, 0);
    const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate(), 12, 0, 0);

    const yesterdayStr = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const futureDateStr = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    // Client A: 37 months ago, nothing else
    await dbClient.insert(clients).values({
      id: clientAId,
      displayName: 'Client A (No Activity)',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: thirtySevenMonthsAgo,
      lastActivityAt: thirtySevenMonthsAgo,
    });

    // Client B: 37 months ago, note updated 2 months ago
    await dbClient.insert(clients).values({
      id: clientBId,
      displayName: 'Client B (Recent Note)',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: thirtySevenMonthsAgo,
      lastActivityAt: thirtySevenMonthsAgo,
    });
    await dbClient.insert(clientNotes).values({
      id: '018f0000-0000-7000-8000-0000000000b1',
      clientId: clientBId,
      body: 'Client called about renewal',
      createdAt: twoMonthsAgo,
      updatedAt: twoMonthsAgo,
    });

    // Client C: 37 months ago, owner timeline event 1 month ago
    await dbClient.insert(clients).values({
      id: clientCId,
      displayName: 'Client C (Owner Timeline Event)',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: thirtySevenMonthsAgo,
      lastActivityAt: thirtySevenMonthsAgo,
    });
    await dbClient.insert(clientTimelineEvents).values({
      id: '018f0000-0000-7000-8000-0000000000c1',
      clientId: clientCId,
      type: 'custom',
      occurredAt: oneMonthAgo,
      actorType: 'owner',
      actorId: ownerUserId,
      data: { summary: 'Met at photo studio' },
    });

    // Client D: 37 months ago, consent record 5 months ago
    await dbClient.insert(clients).values({
      id: clientDId,
      displayName: 'Client D (Consent Record)',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: thirtySevenMonthsAgo,
      lastActivityAt: thirtySevenMonthsAgo,
    });
    await dbClient.insert(clientContacts).values({
      id: contactDId,
      clientId: clientDId,
      givenName: 'Contact',
      familyName: 'D',
      isPrimary: true,
      createdAt: thirtySevenMonthsAgo,
    });
    await dbClient.insert(consentRecords).values({
      id: '018f0000-0000-7000-8000-0000000000d2',
      contactId: contactDId,
      purpose: 'marketing',
      status: 'granted',
      effectiveOn: fiveMonthsAgo.toISOString().slice(0, 10),
      method: 'email',
      recordedByActorType: 'owner',
      recordedByActorId: ownerUserId,
      createdAt: fiveMonthsAgo,
    });

    // Client E: 35 months ago (less than 36-month cutoff)
    await dbClient.insert(clients).values({
      id: clientEId,
      displayName: 'Client E (Active 35 Months Ago)',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: thirtyFiveMonthsAgo,
      lastActivityAt: thirtyFiveMonthsAgo,
    });

    // Client F: 37 months ago, only system timeline events since (ignored as activity)
    await dbClient.insert(clients).values({
      id: clientFId,
      displayName: 'Client F (System Timeline Only)',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: thirtySevenMonthsAgo,
      lastActivityAt: thirtySevenMonthsAgo,
    });
    await dbClient.insert(clientTimelineEvents).values({
      id: '018f0000-0000-7000-8000-0000000000f1',
      clientId: clientFId,
      type: 'system_log',
      occurredAt: oneMonthAgo,
      actorType: 'system',
      actorId: 'system-worker',
      data: { summary: 'Automated health verification' },
    });

    // Client G: 37 months ago, active hold
    await dbClient.insert(clients).values({
      id: clientGId,
      displayName: 'Client G (Active Hold)',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: thirtySevenMonthsAgo,
      lastActivityAt: thirtySevenMonthsAgo,
    });
    await dbClient.insert(clientLegalHolds).values({
      clientId: clientGId,
      reason: 'dispute',
      until: futureDateStr,
      setByActorType: 'owner',
      setByActorId: ownerUserId,
      createdAt: thirtySevenMonthsAgo,
      updatedAt: thirtySevenMonthsAgo,
    });

    // Client H: 37 months ago, hold expired yesterday
    await dbClient.insert(clients).values({
      id: clientHId,
      displayName: 'Client H (Expired Hold)',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: thirtySevenMonthsAgo,
      lastActivityAt: thirtySevenMonthsAgo,
    });
    await dbClient.insert(clientLegalHolds).values({
      clientId: clientHId,
      reason: 'statutory',
      until: yesterdayStr,
      setByActorType: 'owner',
      setByActorId: ownerUserId,
      createdAt: thirtySevenMonthsAgo,
      updatedAt: thirtySevenMonthsAgo,
    });
  }

  it('AC-8: retention:sweep --dry-run reports candidates A, F, H as erasable and G as held, and deletes 0 rows', async () => {
    const now = new Date();
    await seedMatrix(now);

    const result = await runRetentionSweep({
      dryRun: true,
      policyIds: ['inactive-clients'],
      client: dbClient,
      now,
    });

    const inactiveResult = result.policies.find((p) => p.policyId === 'inactive-clients');
    expect(inactiveResult).toBeDefined();
    expect(inactiveResult?.scannedCount).toBe(4); // A, F, G, H
    expect(inactiveResult?.erasableCount).toBe(3); // A, F, H
    expect(inactiveResult?.heldCount).toBe(1); // G
    expect(inactiveResult?.deletedCount).toBe(0); // dry-run: 0 deleted

    expect(inactiveResult?.erasableIds).toContain(clientAId);
    expect(inactiveResult?.erasableIds).toContain(clientFId);
    expect(inactiveResult?.erasableIds).toContain(clientHId);
    expect(inactiveResult?.heldIds).toContain(clientGId);

    // Verify all 8 clients are completely untouched in the database
    const allClients = await dbClient.select().from(clients);
    expect(allClients).toHaveLength(8);
  });

  it('AC-9: live sweep erases A, F, H (including H hold row), leaves B, C, D, E, G unchanged, and records audit events', async () => {
    const now = new Date();
    await seedMatrix(now);

    const result = await runRetentionSweep({
      dryRun: false,
      policyIds: ['inactive-clients'],
      client: dbClient,
      now,
    });

    const inactiveResult = result.policies.find((p) => p.policyId === 'inactive-clients');
    expect(inactiveResult).toBeDefined();
    expect(inactiveResult?.erasableCount).toBe(3);
    expect(inactiveResult?.heldCount).toBe(1);
    expect(inactiveResult?.deletedCount).toBe(3);

    // Verify A, F, H are deleted
    const survivingClients = await dbClient.select().from(clients);
    const survivingIds = survivingClients.map((c) => c.id);
    expect(survivingIds).not.toContain(clientAId);
    expect(survivingIds).not.toContain(clientFId);
    expect(survivingIds).not.toContain(clientHId);

    // Verify B, C, D, E, G remain intact
    expect(survivingIds).toContain(clientBId);
    expect(survivingIds).toContain(clientCId);
    expect(survivingIds).toContain(clientDId);
    expect(survivingIds).toContain(clientEId);
    expect(survivingIds).toContain(clientGId);

    // Verify H's expired hold row was erased with H
    const [holdH] = await dbClient
      .select()
      .from(clientLegalHolds)
      .where(eq(clientLegalHolds.clientId, clientHId));
    expect(holdH).toBeUndefined();

    // Verify G's active hold row remains intact
    const [holdG] = await dbClient
      .select()
      .from(clientLegalHolds)
      .where(eq(clientLegalHolds.clientId, clientGId));
    expect(holdG).toBeDefined();

    // Verify erasure audit events for A, F, H
    const erasureEvents = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'privacy.erasure.completed'));
    const erasedTargetIds = erasureEvents.map((e) => e.targetId);
    expect(erasedTargetIds).toContain(clientAId);
    expect(erasedTargetIds).toContain(clientFId);
    expect(erasedTargetIds).toContain(clientHId);
    for (const e of erasureEvents) {
      expect(e.actorType).toBe('system');
    }

    // Verify retention.sweep.completed audit event
    const [sweepEvent] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'retention.sweep.completed'));
    expect(sweepEvent).toBeDefined();
    expect(sweepEvent?.outcome).toBe('success');
    expect(sweepEvent?.metadata).toMatchObject({
      policy_id: 'inactive-clients',
      scanned_count: 4,
      deleted_count: 3,
      held_count: 1,
      dry_run: false,
    });
  });

  it('AC-10: plug-in test-only activity provider reports client A as active and spares it from sweep', async () => {
    const now = new Date();
    await seedMatrix(now);

    // Register custom activity provider simulating E3 project activity
    registerActivityProvider({
      id: 'e3-test-project-provider',
      activeClientIds: (_client, _since, candidateIds) => {
        const active = new Set<string>();
        if (candidateIds.includes(clientAId)) {
          active.add(clientAId);
        }
        return Promise.resolve(active);
      },
    });

    const result = await runRetentionSweep({
      dryRun: false,
      policyIds: ['inactive-clients'],
      client: dbClient,
      now,
    });

    const inactiveResult = result.policies.find((p) => p.policyId === 'inactive-clients');
    expect(inactiveResult).toBeDefined();
    // A was excluded from candidates; only F and H erased
    expect(inactiveResult?.erasableIds).not.toContain(clientAId);
    expect(inactiveResult?.erasableIds).toContain(clientFId);
    expect(inactiveResult?.erasableIds).toContain(clientHId);
    expect(inactiveResult?.deletedCount).toBe(2);

    // Verify client A is still in database
    const [clientA] = await dbClient.select().from(clients).where(eq(clients.id, clientAId));
    expect(clientA).toBeDefined();
  });

  it('AC-12: erasure failure on one candidate rolls back cleanly and isolates failure without stopping sweep', async () => {
    const now = new Date();
    const thirtySevenMonthsAgo = new Date(
      now.getFullYear(),
      now.getMonth() - 37,
      now.getDate(),
      12,
      0,
      0,
    );

    const client1Id = '018f0000-0000-7000-8000-000000000021';
    const client2Id = '018f0000-0000-7000-8000-000000000022';

    await dbClient.insert(clients).values([
      {
        id: client1Id,
        displayName: 'Failing Candidate 1',
        kind: 'person',
        preferredLocale: 'en',
        createdAt: thirtySevenMonthsAgo,
        lastActivityAt: thirtySevenMonthsAgo,
      },
      {
        id: client2Id,
        displayName: 'Succeeding Candidate 2',
        kind: 'person',
        preferredLocale: 'en',
        createdAt: thirtySevenMonthsAgo,
        lastActivityAt: thirtySevenMonthsAgo,
      },
    ]);

    // Register a failing erasure provider that throws only for client1
    registerErasureProvider({
      id: 'throwing_provider',
      category: 'legal_hold',
      coveredTables: ['client_legal_holds'],
      plan: () => Promise.resolve(0),
      erase: (subject) => {
        if ('clientId' in subject && subject.clientId === client1Id) {
          throw new Error('Simulated external failure for client 1');
        }
        return Promise.resolve(0);
      },
    });

    const result = await runRetentionSweep({
      dryRun: false,
      policyIds: ['inactive-clients'],
      client: dbClient,
      now,
    });

    const inactiveResult = result.policies.find((p) => p.policyId === 'inactive-clients');
    expect(inactiveResult).toBeDefined();
    expect(inactiveResult?.failedCount).toBe(1);
    expect(inactiveResult?.deletedCount).toBe(1);
    expect(inactiveResult?.errors).toHaveLength(1);
    expect(inactiveResult?.errors?.[0]).toContain('Simulated external failure for client 1');

    // Client 1 transaction rolled back completely: client 1 still exists
    const [client1] = await dbClient.select().from(clients).where(eq(clients.id, client1Id));
    expect(client1).toBeDefined();

    // Client 2 was erased successfully
    const [client2] = await dbClient.select().from(clients).where(eq(clients.id, client2Id));
    expect(client2).toBeUndefined();
  });

  it('AC-13: retention role cannot UPDATE any client table or run DDL', async () => {
    const pglite = new PGlite();
    try {
      // 1. Establish PostgreSQL role boundaries
      await pglite.exec(`
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

      // 2. Run all migrations under migrator
      const migrationSql = loadMigrationSql();
      await pglite.exec(migrationSql);

      // Seed a client under migrator
      const testClientId = '018f0000-0000-7000-8000-000000000099';
      await pglite.query(`
        INSERT INTO clients (id, display_name, kind, preferred_locale, created_at, last_activity_at)
        VALUES ('${testClientId}', 'Privilege Test Client', 'person', 'en', NOW(), NOW());
      `);

      // 3. Switch active role to ownlight_retention
      await pglite.exec('SET ROLE ownlight_retention;');

      // 4a. Verify DDL is denied
      await expect(
        pglite.exec('CREATE TABLE test_retention_unauthorized (id int);'),
      ).rejects.toThrow(/permission denied/i);

      await expect(pglite.exec('DROP TABLE clients;')).rejects.toThrow(
        /must be owner of table clients/i,
      );

      // 4b. Verify UPDATE is denied on clients table
      await expect(
        pglite.query(`UPDATE clients SET display_name = 'tampered' WHERE id = '${testClientId}';`),
      ).rejects.toThrow(/permission denied/i);

      // 4c. Verify SELECT and DELETE succeed under retention role
      const selectRes = await pglite.query(`SELECT id FROM clients WHERE id = '${testClientId}';`);
      expect(selectRes.rows).toHaveLength(1);

      await pglite.query(`DELETE FROM clients WHERE id = '${testClientId}';`);
      const afterDelete = await pglite.query(
        `SELECT id FROM clients WHERE id = '${testClientId}';`,
      );
      expect(afterDelete.rows).toHaveLength(0);

      // 4d. Verify INSERT succeeds on audit_events
      const auditId = '018f0000-0000-7000-8000-000000000098';
      await pglite.query(`
        INSERT INTO audit_events (id, occurred_at, actor_type, action, outcome)
        VALUES ('${auditId}', NOW(), 'system', 'retention.sweep.completed', 'success');
      `);
      const auditRes = await pglite.query(`SELECT id FROM audit_events WHERE id = '${auditId}';`);
      expect(auditRes.rows).toHaveLength(1);
    } finally {
      await pglite.close();
    }
  });
});
