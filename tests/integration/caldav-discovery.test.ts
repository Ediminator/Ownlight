import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import {
  createFakeCaldavServer,
  type FakeCaldavServerInstance,
} from '../helpers/fake-caldav-server';
import { caldavAccounts, calendarSyncLinks } from '@/server/db/schema/calendar';
import { auditEvents } from '@/server/db/schema/audit';
import { decryptSecret } from '@/server/crypto/vault';
import {
  testCaldavConnectionAction,
  saveCaldavAccountAction,
  disconnectCaldavAccountAction,
  getCaldavAccountStatusAction,
} from '@/server/integrations/caldav/actions';
import {
  updateCaldavAccountSyncStatus,
  deleteCaldavAccount,
  getCaldavAccountStatus,
} from '@/server/integrations/caldav/repo';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';

const mockRequireOwner = vi.fn();
vi.mock('@/server/auth/guards', () => ({
  requireOwner: async () => {
    return (await mockRequireOwner()) as {
      user: { id: string; email: string };
      session: { id: string };
    };
  },
  ForbiddenError: class ForbiddenError extends Error {},
}));

describe('TASK-0047: CalDAV Connection Discovery and Encrypted Credential Vault (AC-1, AC-2, AC-5)', () => {
  let testDb: TestDatabaseInstance;
  let fakeCaldav: FakeCaldavServerInstance;

  const masterKey = '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a';
  const testUser = 'photographer@example.org';
  const testPassword = 'secret-app-password-xyz';

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    fakeCaldav = await createFakeCaldavServer({
      expectedUser: testUser,
      expectedPass: testPassword,
    });

    process.env.ENCRYPTION_KEY = masterKey;

    mockRequireOwner.mockResolvedValue({
      user: { id: '01920000-0000-7000-8000-000000000099', email: 'owner@example.com' },
      session: { id: 'sess-1' },
    });
  });

  afterEach(async () => {
    await fakeCaldav.close();
    await testDb.destroy();
    vi.clearAllMocks();
  });

  function getDb(): DbClient {
    return testDb.db as unknown as DbClient;
  }

  it('AC-1: authenticates with CalDAV server via tsdav, discovers calendar-home-set, and returns user calendars', async () => {
    const result = await testCaldavConnectionAction(
      {
        serverUrl: fakeCaldav.baseUrl,
        username: testUser,
        password: testPassword,
      },
      getDb(),
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.calendars).toBeInstanceOf(Array);
    expect(result.data?.calendars.length).toBeGreaterThanOrEqual(2);

    const calNames = result.data?.calendars.map((c) => c.displayName);
    expect(calNames).toContain('Personal');
    expect(calNames).toContain('Studio Work');

    const workCal = result.data?.calendars.find((c) => c.displayName === 'Studio Work');
    expect(workCal?.url).toContain('/calendars/owner/work');
  });

  it('AC-1: fails with localized error when authentication credentials are invalid', async () => {
    const result = await testCaldavConnectionAction(
      {
        serverUrl: fakeCaldav.baseUrl,
        username: testUser,
        password: 'mock_pw',
      },
      getDb(),
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe('ERROR');
    expect(result.error).toContain('Failed to connect to CalDAV server');
  });

  it('AC-2: encrypts CalDAV password using AES-256-GCM under purpose ownlight:vault:caldav in caldav_accounts', async () => {
    const saveResult = await saveCaldavAccountAction(
      {
        serverUrl: fakeCaldav.baseUrl,
        username: testUser,
        password: testPassword,
        selectedCalendarUrl: `${fakeCaldav.baseUrl}/calendars/owner/work/`,
        selectedCalendarName: 'Studio Work',
      },
      getDb(),
    );

    expect(saveResult.success).toBe(true);
    expect(saveResult.data?.account.id).toBeDefined();

    // Inspect stored row in database
    const [stored] = await testDb.db.select().from(caldavAccounts).limit(1);
    expect(stored).toBeDefined();
    expect(stored?.serverUrl).toBe(fakeCaldav.baseUrl);
    expect(stored?.username).toBe(testUser);

    // Verify plaintext password is NEVER stored
    expect(stored?.encryptedPassword).not.toBe(testPassword);
    expect(stored?.encryptedPassword).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);

    // Verify decryption with vault purpose ownlight:vault:caldav
    const encryptedPassword = stored?.encryptedPassword ?? '';
    const decrypted = await decryptSecret(encryptedPassword, 'ownlight:vault:caldav', masterKey);
    expect(decrypted).toBe(testPassword);

    // Verify decryption fails with a different purpose
    await expect(
      decryptSecret(encryptedPassword, 'ownlight:vault:google', masterKey),
    ).rejects.toThrow();

    // Verify audit event integration.caldav.connected was recorded
    const [auditRecord] = await testDb.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'integration.caldav.connected'))
      .limit(1);

    expect(auditRecord).toBeDefined();
    expect(auditRecord?.targetId).toBe('caldav');
    expect(auditRecord?.metadata).toMatchObject({
      account_id: stored?.id,
      server_url: stored?.serverUrl,
      calendar_name: 'Studio Work',
    });

    // Verify getCaldavAccountStatusAction returns status without exposing encryptedPassword
    const statusRes = await getCaldavAccountStatusAction(getDb());
    expect(statusRes.success).toBe(true);
    expect(statusRes.data?.connected).toBe(true);
    expect(statusRes.data?.account?.username).toBe(testUser);
    expect(statusRes.data?.account?.selectedCalendarName).toBe('Studio Work');
    expect((statusRes.data?.account as Record<string, unknown>).encryptedPassword).toBeUndefined();
  });

  it('AC-5: disconnects CalDAV integration, deletes credentials, and deletes sync links', async () => {
    // 1. Save account
    await saveCaldavAccountAction(
      {
        serverUrl: fakeCaldav.baseUrl,
        username: testUser,
        password: testPassword,
        selectedCalendarUrl: `${fakeCaldav.baseUrl}/calendars/owner/work/`,
        selectedCalendarName: 'Studio Work',
      },
      getDb(),
    );

    // 2. Insert dummy calendar sync links for caldav and google
    await testDb.db.insert(calendarSyncLinks).values([
      {
        provider: 'caldav',
        entityType: 'appointment',
        entityId: '01920000-0000-7000-8000-000000000010',
        externalEventId: 'ext-caldav-1.ics',
        syncedAt: new Date(),
      },
      {
        provider: 'google',
        entityType: 'appointment',
        entityId: '01920000-0000-7000-8000-000000000010',
        externalEventId: 'g_evt_10',
        syncedAt: new Date(),
      },
    ]);

    // 3. Disconnect
    const disconnectRes = await disconnectCaldavAccountAction(getDb());
    expect(disconnectRes.success).toBe(true);

    // 4. Verify account is removed from database
    const accounts = await testDb.db.select().from(caldavAccounts);
    expect(accounts).toHaveLength(0);

    // 5. Verify CalDAV sync links are removed, but Google links remain
    const remainingLinks = await testDb.db.select().from(calendarSyncLinks);
    expect(remainingLinks).toHaveLength(1);
    expect(remainingLinks[0]?.provider).toBe('google');

    // 6. Verify audit event integration.caldav.disconnected is recorded
    const [disconnectAudit] = await testDb.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'integration.caldav.disconnected'))
      .limit(1);

    expect(disconnectAudit).toBeDefined();
    expect(disconnectAudit?.metadata).toHaveProperty('account_id');
  });

  it('AC-2: updates existing CalDAV account credentials when saved multiple times', async () => {
    // 1. Initial save
    const firstSave = await saveCaldavAccountAction(
      {
        serverUrl: fakeCaldav.baseUrl,
        username: testUser,
        password: testPassword,
        selectedCalendarUrl: `${fakeCaldav.baseUrl}/calendars/owner/work/`,
        selectedCalendarName: 'Studio Work',
      },
      getDb(),
    );
    expect(firstSave.success).toBe(true);

    // 2. Second save with updated calendar selection
    const secondSave = await saveCaldavAccountAction(
      {
        serverUrl: fakeCaldav.baseUrl,
        username: testUser,
        password: 'mock_pw_2',
        selectedCalendarUrl: `${fakeCaldav.baseUrl}/calendars/owner/personal/`,
        selectedCalendarName: 'Personal Shoots',
      },
      getDb(),
    );
    expect(secondSave.success).toBe(true);

    // 3. Verify single record exists in database with updated properties
    const accounts = await testDb.db.select().from(caldavAccounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.selectedCalendarName).toBe('Personal Shoots');
    expect(accounts[0]?.selectedCalendarUrl).toBe(
      `${fakeCaldav.baseUrl}/calendars/owner/personal/`,
    );
  });

  it('AC-2: updates sync status and retrieves formatted account status', async () => {
    // 1. Initially no account status is connected: false
    const statusBefore = await getCaldavAccountStatus(getDb());
    expect(statusBefore.connected).toBe(false);

    // 2. Save account
    await saveCaldavAccountAction(
      {
        serverUrl: fakeCaldav.baseUrl,
        username: testUser,
        password: testPassword,
        selectedCalendarUrl: `${fakeCaldav.baseUrl}/calendars/owner/work/`,
        selectedCalendarName: 'Studio Work',
      },
      getDb(),
    );

    const [account] = await testDb.db.select().from(caldavAccounts);
    expect(account).toBeDefined();
    if (!account) {
      throw new Error('Account expected to be defined');
    }

    // 3. Update sync status with ctag, syncToken, lastSyncedAt
    const syncTime = new Date('2026-10-24T12:00:00Z');
    const updated = await updateCaldavAccountSyncStatus(
      account.id,
      {
        lastSyncedAt: syncTime,
        ctag: 'ctag-v1',
        syncToken: 'token-v1',
      },
      getDb(),
    );
    expect(updated?.ctag).toBe('ctag-v1');
    expect(updated?.syncToken).toBe('token-v1');

    // 4. Status reflects COMPLETED
    const statusSuccess = await getCaldavAccountStatus(getDb());
    expect(statusSuccess.connected).toBe(true);
    expect(statusSuccess.lastSyncStatus).toBe('COMPLETED');

    // 5. Update sync status with error
    await updateCaldavAccountSyncStatus(
      account.id,
      {
        lastSyncError: 'Connection refused',
      },
      getDb(),
    );

    const statusError = await getCaldavAccountStatus(getDb());
    expect(statusError.lastSyncStatus).toBe('FAILED');
    expect(statusError.lastSyncError).toBe('Connection refused');
  });

  it('AC-5: deleteCaldavAccount returns deleted: false when no account exists', async () => {
    const res = await deleteCaldavAccount(getDb());
    expect(res.deleted).toBe(false);
  });
});
