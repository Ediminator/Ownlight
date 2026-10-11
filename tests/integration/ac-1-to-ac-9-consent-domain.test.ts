import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, and, sql } from 'drizzle-orm';

vi.mock('server-only', () => ({}));

const mockCookiesStore = new Map<string, string>();
const mockHeadersStore = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const val = mockCookiesStore.get(name);
        return val ? { name, value: val } : undefined;
      },
      set: (name: string, value: string) => {
        mockCookiesStore.set(name, value);
      },
      delete: (name: string) => {
        mockCookiesStore.delete(name);
      },
    }),
  headers: () =>
    Promise.resolve({
      get: (name: string) => mockHeadersStore.get(name.toLowerCase()) ?? null,
    }),
}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { recordConsentAction, listConsentsAction } from '@/server/consents/actions';
import * as consentService from '@/server/consents/service';
import { consentRecords } from '@/server/db/schema/consents';
import { user } from '@/server/db/schema/auth';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { clientTimelineEvents } from '@/server/db/schema/timeline';
import { auditEvents } from '@/server/db/schema/audit';
import type { DbClient } from '@/server/db/client';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { createApiKey, type ApiKeyWithScopes } from '@/server/auth/api-keys';
import { executeRetentionSweep } from '@/server/retention/cli';
import { resetPolicies } from '@/server/retention/policy';
import type { AuthContext } from '@/server/auth/guards';
import { generateUuidV7 } from '@/lib/id';
import { logger } from '@/server/log';

describe('TASK-0014: Consent records and immutable history (AC-1 to AC-9)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let ownerUser: { id: string; name: string; email: string; role: string };
  let testClient: { id: string; displayName: string };
  let primaryContact: { id: string; givenName: string | null; familyName: string | null };

  const rootDir = path.resolve(import.meta.dirname, '../..');
  const drizzleDir = path.resolve(rootDir, 'drizzle');

  beforeEach(async () => {
    resetPolicies();
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;
    mockCookiesStore.clear();
    mockHeadersStore.clear();

    // 1. Studio settings with Europe/Berlin timezone (AC-4)
    await dbClient.insert(studioSettings).values({
      studio_name: 'Consent Studio Berlin',
      default_locale: 'en',
      timezone: 'Europe/Berlin',
      currency: 'EUR',
    });

    // 2. Owner user
    const [insertedOwner] = await dbClient
      .insert(user)
      .values({
        name: 'Studio Owner',
        email: 'owner@example.com',
        role: 'owner',
      })
      .returning();
    if (!insertedOwner) throw new Error('Failed to insert ownerUser');
    ownerUser = insertedOwner;

    // 3. Authenticate as owner
    const session = await createSession(ownerUser.id, dbClient);
    mockCookiesStore.set(SESSION_COOKIE_NAME, session.token);

    // 4. Client
    const [insertedClient] = await dbClient
      .insert(clients)
      .values({
        kind: 'person',
        displayName: 'Alice & Bob Wedding',
        preferredLocale: 'en',
      })
      .returning();
    if (!insertedClient) throw new Error('Failed to insert testClient');
    testClient = insertedClient;

    // 5. Primary contact
    const [insertedContact] = await dbClient
      .insert(clientContacts)
      .values({
        clientId: testClient.id,
        givenName: 'Alice',
        familyName: 'Wonderland',
        email: 'alice@example.com',
        isPrimary: true,
      })
      .returning();
    if (!insertedContact) throw new Error('Failed to insert primaryContact');
    primaryContact = insertedContact;
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-1: given a contact without consent records, recording marketing granted shows marketing granted, image usage no consent, timeline event and audit event', async () => {
    const today = '2026-10-11';

    const result = await recordConsentAction({
      clientId: testClient.id,
      contactId: primaryContact.id,
      purpose: 'marketing',
      status: 'granted',
      effectiveOn: today,
      method: 'in_person',
      scope: 'Newsletter and seasonal mini-session offers',
      evidenceNote: 'Signed consent checkbox on intake card #101',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Action failed');
    expect(result.data.consentId).toBeDefined();

    // Verify listConsentsAction shows contact marketing status granted and image_usage as no consent
    const listRes = await listConsentsAction({ clientId: testClient.id });
    expect(listRes.success).toBe(true);
    if (!listRes.success) throw new Error('List failed');

    const contactSummary = listRes.data.contacts.find((c) => c.contactId === primaryContact.id);
    expect(contactSummary).toBeDefined();
    expect(contactSummary?.marketing).toMatchObject({
      purpose: 'marketing',
      status: 'granted',
      effectiveOn: today,
      method: 'in_person',
      scope: 'Newsletter and seasonal mini-session offers',
      evidenceNote: 'Signed consent checkbox on intake card #101',
    });
    expect(contactSummary?.imageUsage).toBeNull();
    expect(contactSummary?.history).toHaveLength(1);

    // Verify timeline event consent.granted exists
    const timelineRows = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(
        and(
          eq(clientTimelineEvents.clientId, testClient.id),
          eq(clientTimelineEvents.type, 'consent.granted'),
        ),
      );
    expect(timelineRows).toHaveLength(1);
    expect(timelineRows[0]?.subjectType).toBe('consent_record');
    expect(timelineRows[0]?.subjectId).toBe(result.data.consentId);
    expect(timelineRows[0]?.data).toEqual({ purpose: 'marketing' });

    // Verify audit event consent.granted exists
    const auditRows = await dbClient
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'consent.granted'),
          eq(auditEvents.targetId, result.data.consentId),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.outcome).toBe('success');
    expect(auditRows[0]?.metadata).toEqual({
      contact_id: primaryContact.id,
      purpose: 'marketing',
      method: 'in_person',
    });
  });

  it('AC-2: given a granted marketing consent, recording withdrawn sets current status to withdrawn, shows full history newest first, and emits consent.withdrawn timeline event', async () => {
    // 1. Initial grant
    const grantRes = await recordConsentAction({
      clientId: testClient.id,
      contactId: primaryContact.id,
      purpose: 'marketing',
      status: 'granted',
      effectiveOn: '2026-10-01',
      method: 'email',
    });
    expect(grantRes.success).toBe(true);

    // 2. Withdrawal with today's date
    const withdrawRes = await recordConsentAction({
      clientId: testClient.id,
      contactId: primaryContact.id,
      purpose: 'marketing',
      status: 'withdrawn',
      effectiveOn: '2026-10-11',
      method: 'email',
      evidenceNote: 'Client replied requesting unsubscribe',
    });
    expect(withdrawRes.success).toBe(true);
    if (!withdrawRes.success) throw new Error('Withdrawal failed');

    // 3. listConsentsAction verifies current status is withdrawn
    const listRes = await listConsentsAction({ clientId: testClient.id });
    expect(listRes.success).toBe(true);
    if (!listRes.success) throw new Error('List failed');

    const contactSummary = listRes.data.contacts.find((c) => c.contactId === primaryContact.id);
    expect(contactSummary?.marketing?.status).toBe('withdrawn');
    expect(contactSummary?.marketing?.effectiveOn).toBe('2026-10-11');

    // 4. History contains both entries, ordered newest first (effective_on DESC, created_at DESC)
    expect(contactSummary?.history).toHaveLength(2);
    expect(contactSummary?.history[0]?.status).toBe('withdrawn');
    expect(contactSummary?.history[0]?.effectiveOn).toBe('2026-10-11');
    expect(contactSummary?.history[1]?.status).toBe('granted');
    expect(contactSummary?.history[1]?.effectiveOn).toBe('2026-10-01');

    // 5. consent.withdrawn timeline event exists
    const timelineRows = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(
        and(
          eq(clientTimelineEvents.clientId, testClient.id),
          eq(clientTimelineEvents.type, 'consent.withdrawn'),
        ),
      );
    expect(timelineRows).toHaveLength(1);
    expect(timelineRows[0]?.subjectId).toBe(withdrawRes.data.consentId);
    expect(timelineRows[0]?.data).toEqual({ purpose: 'marketing' });
  });

  it('AC-3: given no current grant for image usage, recording withdrawn returns CONSENT_NOT_GRANTED and stores nothing', async () => {
    // 1. Attempt withdraw with no prior record
    const res1 = await recordConsentAction({
      clientId: testClient.id,
      contactId: primaryContact.id,
      purpose: 'image_usage',
      status: 'withdrawn',
      effectiveOn: '2026-10-11',
      method: 'phone',
    });

    expect(res1.success).toBe(false);
    if (res1.success) throw new Error('Expected failure');
    expect(res1.code).toBe('CONSENT_NOT_GRANTED');

    // 2. Grant marketing, then attempt to withdraw image usage
    await recordConsentAction({
      clientId: testClient.id,
      contactId: primaryContact.id,
      purpose: 'marketing',
      status: 'granted',
      effectiveOn: '2026-10-11',
      method: 'in_person',
    });

    const res2 = await recordConsentAction({
      clientId: testClient.id,
      contactId: primaryContact.id,
      purpose: 'image_usage',
      status: 'withdrawn',
      effectiveOn: '2026-10-11',
      method: 'phone',
    });
    expect(res2.success).toBe(false);
    if (res2.success) throw new Error('Expected failure');
    expect(res2.code).toBe('CONSENT_NOT_GRANTED');

    // 3. Withdraw marketing, then attempt to withdraw marketing again
    await recordConsentAction({
      clientId: testClient.id,
      contactId: primaryContact.id,
      purpose: 'marketing',
      status: 'withdrawn',
      effectiveOn: '2026-10-11',
      method: 'email',
    });

    const res3 = await recordConsentAction({
      clientId: testClient.id,
      contactId: primaryContact.id,
      purpose: 'marketing',
      status: 'withdrawn',
      effectiveOn: '2026-10-11',
      method: 'email',
    });
    expect(res3.success).toBe(false);
    if (res3.success) throw new Error('Expected failure');
    expect(res3.code).toBe('CONSENT_NOT_GRANTED');

    // Verify 0 image_usage consent records stored
    const stored = await dbClient
      .select()
      .from(consentRecords)
      .where(
        and(
          eq(consentRecords.contactId, primaryContact.id),
          eq(consentRecords.purpose, 'image_usage'),
        ),
      );
    expect(stored).toHaveLength(0);
  });

  it('AC-4: given invalid input (image_usage grant without scope, future effective_on, unknown method, scope > 500 chars, extra key), returns VALIDATION_FAILED and stores nothing', async () => {
    // 1. image_usage grant without scope
    const noScopeRes = await recordConsentAction({
      clientId: testClient.id,
      contactId: primaryContact.id,
      purpose: 'image_usage',
      status: 'granted',
      effectiveOn: '2026-10-11',
      method: 'paper_form',
    });
    expect(noScopeRes.success).toBe(false);
    if (noScopeRes.success) throw new Error('Expected failure');
    expect(noScopeRes.code).toBe('VALIDATION_FAILED');
    expect(noScopeRes.fields).toContain('scope');

    // 2. effective_on in the future (studio timezone Europe/Berlin)
    // Compute tomorrow's date relative to current time in Europe/Berlin
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    const futureRes = await recordConsentAction({
      clientId: testClient.id,
      contactId: primaryContact.id,
      purpose: 'marketing',
      status: 'granted',
      effectiveOn: tomorrowStr,
      method: 'email',
    });
    expect(futureRes.success).toBe(false);
    if (futureRes.success) throw new Error('Expected failure');
    expect(futureRes.code).toBe('VALIDATION_FAILED');
    expect(futureRes.fields).toContain('effectiveOn');

    // 3. Unknown method
    const unknownMethodRes = await recordConsentAction({
      clientId: testClient.id,
      contactId: primaryContact.id,
      purpose: 'marketing',
      status: 'granted',
      effectiveOn: '2026-10-11',
      method: 'telepathy',
    });
    expect(unknownMethodRes.success).toBe(false);
    if (unknownMethodRes.success) throw new Error('Expected failure');
    expect(unknownMethodRes.code).toBe('VALIDATION_FAILED');
    expect(unknownMethodRes.fields).toContain('method');

    // 4. Scope > 500 characters
    const longScope = 'a'.repeat(501);
    const longScopeRes = await recordConsentAction({
      clientId: testClient.id,
      contactId: primaryContact.id,
      purpose: 'image_usage',
      status: 'granted',
      effectiveOn: '2026-10-11',
      method: 'paper_form',
      scope: longScope,
    });
    expect(longScopeRes.success).toBe(false);
    if (longScopeRes.success) throw new Error('Expected failure');
    expect(longScopeRes.code).toBe('VALIDATION_FAILED');
    expect(longScopeRes.fields).toContain('scope');

    // 5. Unknown extra key (.strict())
    const extraKeyRes = await recordConsentAction({
      clientId: testClient.id,
      contactId: primaryContact.id,
      purpose: 'marketing',
      status: 'granted',
      effectiveOn: '2026-10-11',
      method: 'email',
      unauthorizedExtraKey: 'malicious',
    });
    expect(extraKeyRes.success).toBe(false);
    if (extraKeyRes.success) throw new Error('Expected failure');
    expect(extraKeyRes.code).toBe('VALIDATION_FAILED');

    // Verify database remains empty for primaryContact
    const allRecords = await dbClient
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.contactId, primaryContact.id));
    expect(allRecords).toHaveLength(0);
  });

  it('AC-5: given an existing consent record, app role and table owner UPDATE is strictly rejected by PostgreSQL trigger', async () => {
    const rawClient = new PGlite();
    try {
      // Establish roles and migration
      await rawClient.exec(`
        CREATE ROLE ownlight_migrator;
        CREATE ROLE ownlight_app;
        CREATE ROLE ownlight_retention;

        ALTER SCHEMA public OWNER TO ownlight_migrator;
        GRANT USAGE, CREATE ON SCHEMA public TO ownlight_migrator;
        GRANT USAGE ON SCHEMA public TO ownlight_app;
        GRANT USAGE ON SCHEMA public TO ownlight_retention;
      `);

      const pgliteDb = drizzle(rawClient);
      await migrate(pgliteDb, { migrationsFolder: drizzleDir });

      // Grant privileges reflecting production setup
      await rawClient.exec(`
        ALTER TABLE consent_records OWNER TO ownlight_migrator;
        REVOKE ALL ON consent_records FROM ownlight_app;
        GRANT SELECT, INSERT, DELETE ON consent_records TO ownlight_app;

        REVOKE ALL ON consent_records FROM ownlight_retention;
        GRANT SELECT, DELETE ON consent_records TO ownlight_retention;
      `);

      // Insert dummy client & contact under migrator
      const cId = '01912345-6789-7abc-8def-012345678910';
      const contactId = '01912345-6789-7abc-8def-012345678911';
      const consentId = '01912345-6789-7abc-8def-012345678912';

      await rawClient.exec(`
        INSERT INTO clients (id, kind, display_name, preferred_locale)
        VALUES ('${cId}', 'person', 'Test Client', 'en');
        INSERT INTO client_contacts (id, client_id, given_name, family_name, is_primary)
        VALUES ('${contactId}', '${cId}', 'Eva', 'Sample', true);
      `);

      // Switch to ownlight_app and insert consent record
      await rawClient.exec('SET ROLE ownlight_app;');
      await rawClient.exec(`
        INSERT INTO consent_records (id, contact_id, purpose, status, effective_on, method, recorded_by_actor_type)
        VALUES ('${consentId}', '${contactId}', 'marketing', 'granted', '2026-10-11', 'in_person', 'owner');
      `);

      // Attempt UPDATE as ownlight_app: MUST reject (by REVOKE UPDATE and trigger)
      await expect(
        rawClient.exec(
          `UPDATE consent_records SET status = 'withdrawn' WHERE id = '${consentId}';`,
        ),
      ).rejects.toThrow(/permission denied|cannot be updated/i);

      // Switch to table owner (ownlight_migrator) to prove trigger rejects UPDATE even for owner
      await rawClient.exec('SET ROLE ownlight_migrator;');
      await expect(
        rawClient.exec(
          `UPDATE consent_records SET status = 'withdrawn' WHERE id = '${consentId}';`,
        ),
      ).rejects.toThrow(/consent_records rows cannot be updated/i);
    } finally {
      await rawClient.close();
    }
  });

  it('AC-6: given contacts on clients X and Y, recordConsentAction returns NOT_FOUND on IDOR; no session returns UNAUTHORIZED; read-only API key returns FORBIDDEN with denied audit event', async () => {
    // Client Y and Contact Y
    const [clientY] = await dbClient
      .insert(clients)
      .values({
        kind: 'person',
        displayName: 'Client Y',
        preferredLocale: 'en',
      })
      .returning();

    if (!clientY) throw new Error('Failed to insert clientY');

    const [contactY] = await dbClient
      .insert(clientContacts)
      .values({
        clientId: clientY.id,
        givenName: 'Y-Contact',
        familyName: 'Person',
        isPrimary: true,
      })
      .returning();
    if (!contactY) throw new Error('Failed to insert contactY');

    // 1. IDOR: call recordConsentAction with clientId = testClient.id (X) and contactId = contactY.id (Y)
    const idorRes = await recordConsentAction({
      clientId: testClient.id,
      contactId: contactY.id,
      purpose: 'marketing',
      status: 'granted',
      effectiveOn: '2026-10-11',
      method: 'in_person',
    });

    expect(idorRes.success).toBe(false);
    if (idorRes.success) throw new Error('Expected IDOR failure');
    expect(idorRes.code).toBe('NOT_FOUND');

    // 2. Unauthenticated: clear session cookies
    mockCookiesStore.clear();
    const unauthRes = await recordConsentAction({
      clientId: testClient.id,
      contactId: primaryContact.id,
      purpose: 'marketing',
      status: 'granted',
      effectiveOn: '2026-10-11',
      method: 'in_person',
    });
    expect(unauthRes.success).toBe(false);
    if (unauthRes.success) throw new Error('Expected unauth failure');
    expect(unauthRes.code).toBe('UNAUTHORIZED');

    // 3. API key with clients:read only (no clients:write)
    const { apiKey } = await createApiKey({
      userId: ownerUser.id,
      name: 'Read Only Key',
      scopes: ['clients:read'],
      client: dbClient,
    });

    mockHeadersStore.set('authorization', `Bearer ${apiKey}`);

    const forbiddenRes = await recordConsentAction({
      clientId: testClient.id,
      contactId: primaryContact.id,
      purpose: 'marketing',
      status: 'granted',
      effectiveOn: '2026-10-11',
      method: 'in_person',
    });

    expect(forbiddenRes.success).toBe(false);
    if (forbiddenRes.success) throw new Error('Expected forbidden failure');
    expect(forbiddenRes.code).toBe('FORBIDDEN');

    // Verify denied audit event exists
    const deniedAuditRows = await dbClient
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'consent.recorded'), eq(auditEvents.outcome, 'denied')));
    expect(deniedAuditRows.length).toBeGreaterThanOrEqual(1);
    expect(deniedAuditRows[0]?.actorType).toBe('token');
  });

  it('AC-7: given chain withdrawn 37 months ago, another withdrawn 35 months ago, and chain granted 40 months ago, sweep --dry-run reports 1st chain; live sweep deletes only 1st chain + timeline events, and records audit event', async () => {
    const now = new Date('2026-10-10T12:00:00.000Z');

    // Create 3 contacts for 3 chains
    const [c1] = await dbClient
      .insert(clientContacts)
      .values({
        clientId: testClient.id,
        givenName: 'Contact1',
        familyName: 'Chain1',
      })
      .returning();
    const [c2] = await dbClient
      .insert(clientContacts)
      .values({
        clientId: testClient.id,
        givenName: 'Contact2',
        familyName: 'Chain2',
      })
      .returning();
    const [c3] = await dbClient
      .insert(clientContacts)
      .values({
        clientId: testClient.id,
        givenName: 'Contact3',
        familyName: 'Chain3',
      })
      .returning();

    if (!c1 || !c2 || !c3) throw new Error('Failed to create contacts for retention test');

    // Chain 1: Contact 1, marketing.
    // - Record 1: granted 40 months ago (2023-06-10)
    // - Record 2: withdrawn 37 months ago (2023-09-10)
    const [c1r1] = await dbClient
      .insert(consentRecords)
      .values({
        contactId: c1.id,
        purpose: 'marketing',
        status: 'granted',
        effectiveOn: '2023-06-10',
        method: 'in_person',
        recordedByActorType: 'owner',
      })
      .returning();
    const [c1r2] = await dbClient
      .insert(consentRecords)
      .values({
        contactId: c1.id,
        purpose: 'marketing',
        status: 'withdrawn',
        effectiveOn: '2023-09-10',
        method: 'email',
        recordedByActorType: 'owner',
      })
      .returning();

    if (!c1r1 || !c1r2) throw new Error('Failed to create chain 1 records');

    // Timeline events for Chain 1
    await dbClient.insert(clientTimelineEvents).values([
      {
        clientId: testClient.id,
        type: 'consent.granted',
        occurredAt: new Date('2023-06-10T10:00:00Z'),
        actorType: 'owner',
        subjectType: 'consent_record',
        subjectId: c1r1.id,
        data: { purpose: 'marketing' },
      },
      {
        clientId: testClient.id,
        type: 'consent.withdrawn',
        occurredAt: new Date('2023-09-10T10:00:00Z'),
        actorType: 'owner',
        subjectType: 'consent_record',
        subjectId: c1r2.id,
        data: { purpose: 'marketing' },
      },
    ]);

    // Chain 2: Contact 2, marketing.
    // - Record 1: granted 38 months ago (2023-08-10)
    // - Record 2: withdrawn 35 months ago (2023-11-10)
    const [c2r1] = await dbClient
      .insert(consentRecords)
      .values({
        contactId: c2.id,
        purpose: 'marketing',
        status: 'granted',
        effectiveOn: '2023-08-10',
        method: 'email',
        recordedByActorType: 'owner',
      })
      .returning();
    const [c2r2] = await dbClient
      .insert(consentRecords)
      .values({
        contactId: c2.id,
        purpose: 'marketing',
        status: 'withdrawn',
        effectiveOn: '2023-11-10',
        method: 'email',
        recordedByActorType: 'owner',
      })
      .returning();

    if (!c2r1 || !c2r2) throw new Error('Failed to create chain 2 records');

    await dbClient.insert(clientTimelineEvents).values([
      {
        clientId: testClient.id,
        type: 'consent.granted',
        occurredAt: new Date('2023-08-10T10:00:00Z'),
        actorType: 'owner',
        subjectType: 'consent_record',
        subjectId: c2r1.id,
        data: { purpose: 'marketing' },
      },
      {
        clientId: testClient.id,
        type: 'consent.withdrawn',
        occurredAt: new Date('2023-11-10T10:00:00Z'),
        actorType: 'owner',
        subjectType: 'consent_record',
        subjectId: c2r2.id,
        data: { purpose: 'marketing' },
      },
    ]);

    // Chain 3: Contact 3, image_usage.
    // - Record 1: granted 40 months ago (2023-06-10), STILL GRANTED!
    const [c3r1] = await dbClient
      .insert(consentRecords)
      .values({
        contactId: c3.id,
        purpose: 'image_usage',
        status: 'granted',
        effectiveOn: '2023-06-10',
        method: 'paper_form',
        scope: 'Portfolio website',
        recordedByActorType: 'owner',
      })
      .returning();

    if (!c3r1) throw new Error('Failed to create chain 3 records');

    await dbClient.insert(clientTimelineEvents).values([
      {
        clientId: testClient.id,
        type: 'consent.granted',
        occurredAt: new Date('2023-06-10T10:00:00Z'),
        actorType: 'owner',
        subjectType: 'consent_record',
        subjectId: c3r1.id,
        data: { purpose: 'image_usage' },
      },
    ]);

    // 1. Dry-run sweep: reports exactly Chain 1 (2 records)
    const dryRunResult = await executeRetentionSweep({
      dbClient,
      dryRun: true,
      policyIds: ['withdrawn-consent-proof'],
      now,
    });

    expect(dryRunResult.dryRun).toBe(true);
    expect(dryRunResult.totalScanned).toBe(2);
    expect(dryRunResult.totalDeleted).toBe(0);

    const consentPolicyReport = dryRunResult.policies.find(
      (p) => p.policyId === 'withdrawn-consent-proof',
    );
    expect(consentPolicyReport).toBeDefined();
    expect(consentPolicyReport?.scannedCount).toBe(2);

    // Records must still be intact after dry-run
    const allConsentsAfterDryRun = await dbClient.select().from(consentRecords);
    expect(allConsentsAfterDryRun).toHaveLength(5);

    // 2. Live sweep: deletes only Chain 1's records and its timeline events
    const liveResult = await executeRetentionSweep({
      dbClient,
      dryRun: false,
      policyIds: ['withdrawn-consent-proof'],
      now,
    });

    expect(liveResult.dryRun).toBe(false);
    expect(liveResult.totalDeleted).toBe(2);

    // Verify Chain 1 records are purged, Chain 2 & Chain 3 intact
    const remainingConsents = await dbClient.select().from(consentRecords);
    expect(remainingConsents).toHaveLength(3);
    const remainingIds = remainingConsents.map((r) => r.id);
    expect(remainingIds).not.toContain(c1r1.id);
    expect(remainingIds).not.toContain(c1r2.id);
    expect(remainingIds).toContain(c2r1.id);
    expect(remainingIds).toContain(c2r2.id);
    expect(remainingIds).toContain(c3r1.id);

    // Verify Chain 1 timeline events are purged, Chain 2 & Chain 3 timeline events intact
    const remainingTimeline = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(sql`${clientTimelineEvents.subjectType} = 'consent_record'`);
    expect(remainingTimeline).toHaveLength(3);
    const remainingSubjectIds = remainingTimeline.map((t) => t.subjectId);
    expect(remainingSubjectIds).not.toContain(c1r1.id);
    expect(remainingSubjectIds).not.toContain(c1r2.id);
    expect(remainingSubjectIds).toContain(c2r1.id);
    expect(remainingSubjectIds).toContain(c2r2.id);
    expect(remainingSubjectIds).toContain(c3r1.id);

    // 3. Verify retention.sweep.completed audit event recorded
    const sweepAuditRows = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'retention.sweep.completed'));
    expect(sweepAuditRows.length).toBeGreaterThanOrEqual(1);
    const latestSweepAudit = sweepAuditRows[sweepAuditRows.length - 1];
    expect(latestSweepAudit?.metadata).toMatchObject({
      policy_id: 'withdrawn-consent-proof',
      deleted_count: 2,
      dry_run: false,
    });
  });

  it('AC-8: given a contact is removed, then its consent records are removed via cascade', async () => {
    // 1. Add consent record for primaryContact
    await recordConsentAction({
      clientId: testClient.id,
      contactId: primaryContact.id,
      purpose: 'marketing',
      status: 'granted',
      effectiveOn: '2026-10-11',
      method: 'in_person',
    });

    const beforeDelete = await dbClient
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.contactId, primaryContact.id));
    expect(beforeDelete).toHaveLength(1);

    // 2. Remove contact at SQL level (cascade foreign key)
    await dbClient.delete(clientContacts).where(eq(clientContacts.id, primaryContact.id));

    // 3. Consent records for this contact must be completely deleted
    const afterDelete = await dbClient
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.contactId, primaryContact.id));
    expect(afterDelete).toHaveLength(0);
  });

  it('AC-9: given audit metadata, timeline data and captured logs for consent actions, they contain zero names, emails, scope or evidence_note text', async () => {
    const loggerInfoSpy = vi.spyOn(logger, 'info');

    const contactName = 'SensitiveContactName';
    const contactEmail = 'confidential@example.org';
    const secretScope = 'SecretPrivateInstagramAccountOnly';
    const secretEvidence = 'KeptInSafeBoxRoom99';

    // Create a special contact
    const [sensitiveContact] = await dbClient
      .insert(clientContacts)
      .values({
        clientId: testClient.id,
        givenName: contactName,
        familyName: 'Person',
        email: contactEmail,
      })
      .returning();
    if (!sensitiveContact) throw new Error('Failed to insert sensitiveContact');

    // Record consent
    const res = await recordConsentAction({
      clientId: testClient.id,
      contactId: sensitiveContact.id,
      purpose: 'image_usage',
      status: 'granted',
      effectiveOn: '2026-10-11',
      method: 'paper_form',
      scope: secretScope,
      evidenceNote: secretEvidence,
    });

    expect(res.success).toBe(true);
    if (!res.success) throw new Error('Action failed');

    // 1. Audit event metadata inspection
    const [auditRow] = await dbClient
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'consent.granted'),
          eq(auditEvents.targetId, res.data.consentId),
        ),
      );
    expect(auditRow).toBeDefined();
    const auditMetaStr = JSON.stringify(auditRow?.metadata ?? {});
    expect(auditMetaStr).not.toContain(contactName);
    expect(auditMetaStr).not.toContain(contactEmail);
    expect(auditMetaStr).not.toContain(secretScope);
    expect(auditMetaStr).not.toContain(secretEvidence);
    expect(auditRow?.metadata).toEqual({
      contact_id: sensitiveContact.id,
      purpose: 'image_usage',
      method: 'paper_form',
    });

    // 2. Timeline event data inspection
    const [timelineRow] = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(
        and(
          eq(clientTimelineEvents.clientId, testClient.id),
          eq(clientTimelineEvents.subjectId, res.data.consentId),
        ),
      );
    expect(timelineRow).toBeDefined();
    const timelineDataStr = JSON.stringify(timelineRow?.data ?? {});
    expect(timelineDataStr).not.toContain(contactName);
    expect(timelineDataStr).not.toContain(contactEmail);
    expect(timelineDataStr).not.toContain(secretScope);
    expect(timelineDataStr).not.toContain(secretEvidence);
    expect(timelineRow?.data).toEqual({
      purpose: 'image_usage',
    });

    // 3. Logger call inspection
    const matchingLogCalls = loggerInfoSpy.mock.calls.filter(([obj]) => {
      return (
        obj &&
        typeof obj === 'object' &&
        'contactId' in obj &&
        obj.contactId === sensitiveContact.id
      );
    });
    expect(matchingLogCalls.length).toBeGreaterThan(0);
    for (const [logObj] of matchingLogCalls) {
      const logStr = JSON.stringify(logObj);
      expect(logStr).not.toContain(contactName);
      expect(logStr).not.toContain(contactEmail);
      expect(logStr).not.toContain(secretScope);
      expect(logStr).not.toContain(secretEvidence);
    }

    loggerInfoSpy.mockRestore();
  });

  it('exercises service and repo edge cases: non-existent client, client with zero contacts, and api-key actor', async () => {
    const nonExistentClientId = '01912345-6789-7abc-8def-999999999999';

    const ownerAuth: AuthContext = {
      authType: 'session',
      scopes: ['*'],
      session: {
        id: 'sess-1',
        userId: ownerUser.id,
        token: 'tok-1',
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
        updatedAt: new Date(),
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        lastReauthenticatedAt: new Date(),
      },
      user: {
        id: ownerUser.id,
        name: ownerUser.name,
        email: ownerUser.email,
        role: 'owner',
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };

    // 1. recordConsent with non-existent client -> NOT_FOUND
    const recordRes = await consentService.recordConsent(
      {
        clientId: nonExistentClientId,
        contactId: '01912345-6789-7abc-8def-999999999998',
        purpose: 'marketing',
        status: 'granted',
        effectiveOn: '2026-10-11',
        method: 'in_person',
        scope: null,
        evidenceNote: null,
      },
      ownerAuth,
      dbClient,
    );
    expect(recordRes).toEqual({
      success: false,
      code: 'NOT_FOUND',
      error: 'NOT_FOUND',
    });

    // 2. listConsents with non-existent client -> NOT_FOUND
    const listRes = await consentService.listConsents(nonExistentClientId, ownerAuth, dbClient);
    expect(listRes).toEqual({
      success: false,
      code: 'NOT_FOUND',
      error: 'NOT_FOUND',
    });

    // 3. listConsents with client having zero contacts
    const [emptyClient] = await dbClient
      .insert(clients)
      .values({
        id: generateUuidV7(),
        kind: 'company',
        displayName: 'Empty Contacts Org',
        preferredLocale: 'en',
      })
      .returning();
    if (!emptyClient) throw new Error('emptyClient undefined');

    const emptyListRes = await consentService.listConsents(emptyClient.id, ownerAuth, dbClient);
    expect(emptyListRes).toEqual({
      success: true,
      data: {
        clientId: emptyClient.id,
        contacts: [],
      },
    });

    // 4. recordConsent with apiKey auth
    const apiKeyAuth: AuthContext = {
      authType: 'apiKey',
      scopes: ['clients:write'],
      apiKey: {
        id: 'mock-key-id',
        name: 'Test Key',
        scopes: ['clients:write'],
        prefix: 'test_prefix',
      } as unknown as ApiKeyWithScopes,
      user: {
        id: 'owner-id',
        name: 'Owner',
        email: 'owner@example.com',
        role: 'owner',
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };

    const [contactWithKey] = await dbClient
      .insert(clientContacts)
      .values({
        id: generateUuidV7(),
        clientId: emptyClient.id,
        givenName: 'Key',
        familyName: 'User',
        isPrimary: true,
      })
      .returning();
    if (!contactWithKey) throw new Error('contactWithKey undefined');

    const keyRes = await consentService.recordConsent(
      {
        clientId: emptyClient.id,
        contactId: contactWithKey.id,
        purpose: 'marketing',
        status: 'granted',
        effectiveOn: '2026-10-11',
        method: 'email',
        scope: null,
        evidenceNote: null,
      },
      apiKeyAuth,
      dbClient,
    );
    expect(keyRes.success).toBe(true);
  });
});
