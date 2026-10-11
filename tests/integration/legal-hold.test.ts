import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

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
import { setLegalHoldAction, releaseLegalHoldAction } from '@/server/clients/legal-hold-actions';
import { executeErasureAction } from '@/server/privacy/erasure/actions';
import { getClient, getClientList } from '@/server/clients/service';
import { listTimeline } from '@/server/timeline/service';
import { user } from '@/server/db/schema/auth';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { clientLegalHolds } from '@/server/db/schema/client-legal-holds';
import { auditEvents } from '@/server/db/schema/audit';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { createApiKey } from '@/server/auth/api-keys';
import {
  resetErasureHoldProviders,
  resetErasureProviders,
} from '@/server/privacy/erasure/registry';
import { generateExport } from '@/server/privacy/export/service';
import type { DbClient } from '@/server/db/client';

describe('TASK-0019: Manual Client Legal Hold Integration (AC-1 to AC-7, AC-14 to AC-16)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();
    resetErasureProviders();
    resetErasureHoldProviders();

    // 1. Seed owner user
    ownerUser = {
      id: '018f0000-0000-7000-8000-000000000001',
      name: 'Studio Owner',
      email: 'owner@example.org',
      role: 'owner',
    };
    await dbClient.insert(user).values({
      id: ownerUser.id,
      name: ownerUser.name,
      email: ownerUser.email,
      emailVerified: true,
      role: ownerUser.role,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // 2. Owner session
    const sessionRes = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRes.token;

    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
    mockHeadersStore.set('host', 'localhost:3000');
    mockHeadersStore.set('origin', 'http://localhost:3000');

    // 3. Studio settings
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
    resetErasureProviders();
    resetErasureHoldProviders();
    await testDb.destroy();
  });

  it('AC-1: sets active legal hold with audit event containing reason and until only, never note', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000010';
    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Hold Client Alpha',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-10T10:00:00Z'),
      lastActivityAt: new Date('2026-01-10T10:00:00Z'),
    });

    const res = await setLegalHoldAction({
      clientId,
      reason: 'dispute',
      note: 'Synthetic dispute note for client Alpha',
      until: '2028-12-31',
    });

    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.hold.clientId).toBe(clientId);
    expect(res.hold.reason).toBe('dispute');
    expect(res.hold.note).toBe('Synthetic dispute note for client Alpha');
    expect(res.hold.until).toBe('2028-12-31');

    // Verify row in database
    const [holdRow] = await dbClient
      .select()
      .from(clientLegalHolds)
      .where(eq(clientLegalHolds.clientId, clientId));
    expect(holdRow).toBeDefined();
    expect(holdRow?.reason).toBe('dispute');
    expect(holdRow?.note).toBe('Synthetic dispute note for client Alpha');
    expect(holdRow?.until).toBe('2028-12-31');

    // Verify audit event
    const [auditRow] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'client.legal_hold.set'));

    expect(auditRow).toBeDefined();
    expect(auditRow?.targetId).toBe(clientId);
    expect(auditRow?.outcome).toBe('success');
    expect(auditRow?.metadata).toEqual({
      reason: 'dispute',
      until: '2028-12-31',
    });
    // AC-15: Verify note is NEVER in audit metadata
    const auditMeta = auditRow?.metadata ?? {};
    expect(auditMeta.note).toBeUndefined();
  });

  it('AC-2: rejects invalid legal hold input (past date, 501 chars note, unknown reason, extra keys)', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000010';
    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Validation Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-10T10:00:00Z'),
      lastActivityAt: new Date('2026-01-10T10:00:00Z'),
    });

    // Past date
    const pastRes = await setLegalHoldAction({
      clientId,
      reason: 'dispute',
      until: '2020-01-01',
    });
    expect(pastRes.success).toBe(false);
    if (!pastRes.success) {
      expect(pastRes.code).toBe('VALIDATION_FAILED');
    }

    // 501 chars note
    const longNoteRes = await setLegalHoldAction({
      clientId,
      reason: 'statutory',
      note: 'X'.repeat(501),
    });
    expect(longNoteRes.success).toBe(false);
    if (!longNoteRes.success) {
      expect(longNoteRes.code).toBe('VALIDATION_FAILED');
    }

    // Unknown reason
    const badReasonRes = await setLegalHoldAction({
      clientId,
      reason: 'invalid_reason' as unknown as 'dispute',
    });
    expect(badReasonRes.success).toBe(false);
    if (!badReasonRes.success) {
      expect(badReasonRes.code).toBe('VALIDATION_FAILED');
    }

    // Extra key
    const extraKeyRes = await setLegalHoldAction({
      clientId,
      reason: 'other',
      unexpectedField: 'forbidden',
    } as unknown as { clientId: string; reason: 'other' });
    expect(extraKeyRes.success).toBe(false);
    if (!extraKeyRes.success) {
      expect(extraKeyRes.code).toBe('VALIDATION_FAILED');
    }
  });

  it('AC-3: active hold blocks erasure returning ERASURE_BLOCKED with reason and until', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000020';
    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Blocked Erasure Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-10T10:00:00Z'),
      lastActivityAt: new Date('2026-01-10T10:00:00Z'),
    });

    // Set active hold
    await setLegalHoldAction({
      clientId,
      reason: 'dispute',
      until: '2028-06-30',
    });

    // Attempt erasure
    const erasureRes = await executeErasureAction({
      subject: { kind: 'client', clientId },
      confirmation: 'Blocked Erasure Client',
    });

    expect(erasureRes.success).toBe(false);
    if (!erasureRes.success && erasureRes.code === 'ERASURE_BLOCKED') {
      expect(erasureRes.holds).toHaveLength(1);
      expect(erasureRes.holds[0]?.reason).toBe('manual.dispute');
      expect(erasureRes.holds[0]?.retainUntil).toBe('2028-06-30');
    } else {
      expect.fail('Expected ERASURE_BLOCKED');
    }

    // Verify client still exists in database
    const [clientStillThere] = await dbClient
      .select()
      .from(clients)
      .where(eq(clients.id, clientId));
    expect(clientStillThere).toBeDefined();
  });

  it('AC-4: expired hold allows erasure and expired hold row is deleted with client graph', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000030';
    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Expired Hold Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-10T10:00:00Z'),
      lastActivityAt: new Date('2026-01-10T10:00:00Z'),
    });

    // Insert an expired hold directly (until was yesterday)
    await dbClient.insert(clientLegalHolds).values({
      clientId,
      reason: 'statutory',
      until: '2025-01-01',
      setByActorType: 'owner',
      setByActorId: ownerUser.id,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });

    // Execute erasure
    const erasureRes = await executeErasureAction({
      subject: { kind: 'client', clientId },
      confirmation: 'Expired Hold Client',
    });

    expect(erasureRes.success).toBe(true);

    // Verify client row is deleted
    const [clientRow] = await dbClient.select().from(clients).where(eq(clients.id, clientId));
    expect(clientRow).toBeUndefined();

    // Verify expired hold row was deleted by legal_hold erasure provider
    const [holdRow] = await dbClient
      .select()
      .from(clientLegalHolds)
      .where(eq(clientLegalHolds.clientId, clientId));
    expect(holdRow).toBeUndefined();
  });

  it('AC-5: releaseLegalHoldAction deletes hold row, records audit event, and allows erasure', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000040';
    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Release Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-10T10:00:00Z'),
      lastActivityAt: new Date('2026-01-10T10:00:00Z'),
    });

    await setLegalHoldAction({
      clientId,
      reason: 'other',
      note: 'Temporary dispute',
    });

    // Release hold
    const releaseRes = await releaseLegalHoldAction({ clientId });
    expect(releaseRes.success).toBe(true);

    // Check hold row deleted
    const [holdRow] = await dbClient
      .select()
      .from(clientLegalHolds)
      .where(eq(clientLegalHolds.clientId, clientId));
    expect(holdRow).toBeUndefined();

    // Check audit event
    const [auditRow] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'client.legal_hold.released'));
    expect(auditRow).toBeDefined();
    expect(auditRow?.targetId).toBe(clientId);
    expect(auditRow?.metadata).toEqual({ reason: 'other' });

    // Subsequent erasure succeeds
    const erasureRes = await executeErasureAction({
      subject: { kind: 'client', clientId },
      confirmation: 'Release Client',
    });
    expect(erasureRes.success).toBe(true);
  });

  it('AC-6: rejects calls with no session (UNAUTHORIZED), API keys (FORBIDDEN), or missing clientId (NOT_FOUND)', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000050';
    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Auth Test Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-10T10:00:00Z'),
      lastActivityAt: new Date('2026-01-10T10:00:00Z'),
    });

    // 1. No session
    mockCookiesStore.clear();
    const noSessionRes = await setLegalHoldAction({
      clientId,
      reason: 'dispute',
    });
    expect(noSessionRes.success).toBe(false);
    if (!noSessionRes.success) {
      expect(noSessionRes.code).toBe('UNAUTHORIZED');
    }

    const noSessionRelease = await releaseLegalHoldAction({ clientId });
    expect(noSessionRelease.success).toBe(false);
    if (!noSessionRelease.success) {
      expect(noSessionRelease.code).toBe('UNAUTHORIZED');
    }

    // 2. API key with '*' scope -> FORBIDDEN (owner web session only)
    const apiKeyResult = await createApiKey({
      userId: ownerUser.id,
      name: 'Super Key',
      scopes: ['*'],
      client: dbClient,
    });
    mockHeadersStore.set('authorization', `Bearer ${apiKeyResult.apiKey}`);

    const apiKeySetRes = await setLegalHoldAction({
      clientId,
      reason: 'dispute',
    });
    expect(apiKeySetRes.success).toBe(false);
    if (!apiKeySetRes.success) {
      expect(apiKeySetRes.code).toBe('FORBIDDEN');
    }

    const apiKeyReleaseRes = await releaseLegalHoldAction({ clientId });
    expect(apiKeyReleaseRes.success).toBe(false);
    if (!apiKeyReleaseRes.success) {
      expect(apiKeyReleaseRes.code).toBe('FORBIDDEN');
    }

    // 3. Unknown clientId -> NOT_FOUND
    mockHeadersStore.delete('authorization');
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);

    const nonExistentId = '018f0000-0000-7000-8000-000000000099';
    const notFoundSet = await setLegalHoldAction({
      clientId: nonExistentId,
      reason: 'dispute',
    });
    expect(notFoundSet.success).toBe(false);
    if (!notFoundSet.success) {
      expect(notFoundSet.code).toBe('NOT_FOUND');
    }

    const notFoundRelease = await releaseLegalHoldAction({ clientId: nonExistentId });
    expect(notFoundRelease.success).toBe(false);
    if (!notFoundRelease.success) {
      expect(notFoundRelease.code).toBe('NOT_FOUND');
    }
  });

  it('AC-7: foreign key constraint ON DELETE RESTRICT prevents direct SQL deletion of client with hold', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000060';
    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'FK Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-10T10:00:00Z'),
      lastActivityAt: new Date('2026-01-10T10:00:00Z'),
    });

    await dbClient.insert(clientLegalHolds).values({
      clientId,
      reason: 'dispute',
      setByActorType: 'owner',
      setByActorId: ownerUser.id,
      createdAt: new Date('2026-01-10T10:00:00Z'),
      updatedAt: new Date('2026-01-10T10:00:00Z'),
    });

    // Attempt direct SQL delete on client
    await expect(dbClient.delete(clients).where(eq(clients.id, clientId))).rejects.toThrow();
  });

  it('AC-14: reading client profile, timeline, and directory does not update last_activity_at', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000070';
    const originalActivity = new Date('2025-06-01T12:00:00Z');

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Read Only Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2025-06-01T12:00:00Z'),
      lastActivityAt: originalActivity,
    });

    // 1. Read profile
    const profileRes = await getClient(clientId, dbClient);
    expect(profileRes.success).toBe(true);

    // 2. Read timeline
    const timelineRes = await listTimeline(clientId, undefined, dbClient);
    expect(timelineRes.success).toBe(true);

    // 3. Read directory
    const directoryRes = await getClientList(1, 25, undefined, undefined, dbClient);
    expect(directoryRes.success).toBe(true);

    // Check last_activity_at is unchanged
    const [clientRow] = await dbClient.select().from(clients).where(eq(clients.id, clientId));
    expect(clientRow?.lastActivityAt.getTime()).toBe(originalActivity.getTime());
  });

  it('AC-15: audit metadata contains zero PII (no client name, email, phone, or hold note)', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000080';
    const secretNote = 'Secret dispute information regarding contract #999';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'PII Test Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-10T10:00:00Z'),
      lastActivityAt: new Date('2026-01-10T10:00:00Z'),
    });

    await setLegalHoldAction({
      clientId,
      reason: 'dispute',
      note: secretNote,
      until: '2028-05-15',
    });

    const [setAudit] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'client.legal_hold.set'));

    const metaStr = JSON.stringify(setAudit?.metadata);
    expect(metaStr).not.toContain(secretNote);
    expect(metaStr).not.toContain('PII Test Client');

    await releaseLegalHoldAction({ clientId });

    const [releaseAudit] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'client.legal_hold.released'));

    const releaseMetaStr = JSON.stringify(releaseAudit?.metadata);
    expect(releaseMetaStr).not.toContain(secretNote);
    expect(releaseMetaStr).not.toContain('PII Test Client');
  });

  it('AC-16: export includes "legal hold" category with reason, note, until, and dates', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000085';
    const contactId = '018f0000-0000-7000-8000-000000000086';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Export Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-10T10:00:00Z'),
      lastActivityAt: new Date('2026-01-10T10:00:00Z'),
    });

    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      isPrimary: true,
      givenName: 'Bob',
      familyName: 'Jones',
      email: 'bob@example.com',
      emailNormalized: 'bob@example.com',
      createdAt: new Date('2026-01-10T10:00:00Z'),
      updatedAt: new Date('2026-01-10T10:00:00Z'),
    });

    await setLegalHoldAction({
      clientId,
      reason: 'statutory',
      note: 'Tax audit documentation hold',
      until: '2029-01-01',
    });

    const exportResult = await generateExport({
      contactId,
      format: 'json',
      locale: 'en',
      actorId: ownerUser.id,
      client: dbClient,
    });
    expect(exportResult).not.toBeNull();

    const legalHoldRecords = exportResult?.exportData.categories.legal_hold;
    expect(legalHoldRecords).toBeDefined();
    expect(legalHoldRecords).toHaveLength(1);

    const record = legalHoldRecords?.[0] as Record<string, unknown>;
    expect(record.reason).toBe('statutory');
    expect(record.note).toBe('Tax audit documentation hold');
    expect(record.until).toBe('2029-01-01');
    expect(record.created_at).toBeDefined();
    expect(record.updated_at).toBeDefined();
  });
});
