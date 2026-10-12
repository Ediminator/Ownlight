import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let currentSessionToken: string | null = null;

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        if (name === 'ownlight_session' && currentSessionToken) {
          return { value: currentSessionToken };
        }
        return undefined;
      },
      set: () => undefined,
      delete: () => undefined,
    }),
  headers: () => Promise.resolve(new Headers()),
}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { createFakeOAuthServer, type FakeOAuthServerInstance } from '../helpers/fake-oauth-server';
import { user } from '@/server/db/schema/auth';
import { googleOAuthTokens } from '@/server/db/schema/google-oauth-tokens';
import { auditEvents } from '@/server/db/schema/audit';
import { createSession } from '@/server/auth/session';
import { encryptSecret } from '@/server/crypto/vault';
import { GOOGLE_OAUTH_PURPOSE } from '@/server/integrations/google/constants';
import {
  disconnectGoogleAction,
  getGoogleIntegrationStatusAction,
  initiateGoogleConnectAction,
} from '@/server/integrations/google/actions';
import { upsertGoogleOAuthToken } from '@/server/integrations/google/repo';
import { UnauthorizedError, ForbiddenError } from '@/server/auth/guards';
import type { DbClient } from '@/server/db/client';

describe('TASK-0017: Google OAuth Disconnect Integration (AC-6, AC-7)', () => {
  let testDb: TestDatabaseInstance;
  let fakeOAuth: FakeOAuthServerInstance;

  const masterKey = '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a';
  const clientId = 'studio-test-client-id.apps.googleusercontent.com';
  const clientSecret = 'GOCSPX-studio-test-secret-12345';

  const originalEnv = { ...process.env };

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    fakeOAuth = await createFakeOAuthServer();

    process.env.ENCRYPTION_KEY = masterKey;
    process.env.GOOGLE_OAUTH_CLIENT_ID = clientId;
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = clientSecret;
    process.env.GOOGLE_AUTH_URL_OVERRIDE = fakeOAuth.authUrl;
    process.env.GOOGLE_TOKEN_URL_OVERRIDE = fakeOAuth.tokenUrl;
    process.env.GOOGLE_REVOKE_URL_OVERRIDE = fakeOAuth.revokeUrl;
    process.env.AUTH_URL = 'http://127.0.0.1:3000';
  });

  afterEach(async () => {
    await fakeOAuth.close();
    await testDb.destroy();
    process.env = { ...originalEnv };
    currentSessionToken = null;
  });

  function getDb(): DbClient {
    return testDb.db as unknown as DbClient;
  }

  async function createOwnerUser(dbClient: DbClient = getDb()) {
    const [u] = await dbClient
      .insert(user)
      .values({
        name: 'Studio Owner',
        email: `owner-${String(Date.now())}@example.com`,
        role: 'owner',
      })
      .returning();
    expect(u).toBeDefined();
    if (!u) {
      throw new Error('Expected owner user to be created');
    }
    const session = await createSession(u.id, dbClient);
    return { owner: u, session };
  }

  async function createClientUser(dbClient: DbClient = getDb()) {
    const [u] = await dbClient
      .insert(user)
      .values({
        name: 'Test Client',
        email: `client-${String(Date.now())}@example.com`,
        role: 'client',
      })
      .returning();
    expect(u).toBeDefined();
    if (!u) {
      throw new Error('Expected client user to be created');
    }
    const session = await createSession(u.id, dbClient);
    return { clientUser: u, session };
  }

  it('AC-6: revokes token upstream, deletes DB record, and emits integration.google.disconnected audit event', async () => {
    const { owner, session } = await createOwnerUser();
    currentSessionToken = session.token;

    // Seed active token in DB
    const refreshTokenPlain = '1//0gRealTestRefreshToken123456';
    const encryptedRefreshToken = await encryptSecret(refreshTokenPlain, GOOGLE_OAUTH_PURPOSE);
    await upsertGoogleOAuthToken(
      {
        encryptedRefreshToken,
        accessToken: 'ya29.test_access_token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        scope: 'https://www.googleapis.com/auth/contacts',
      },
      getDb(),
    );

    // Verify token exists before disconnect
    const initialStatus = await getGoogleIntegrationStatusAction(getDb());
    expect(initialStatus.data?.connected).toBe(true);

    // Call disconnect
    const result = await disconnectGoogleAction({ deleteSyncedContacts: true }, getDb());
    expect(result.success).toBe(true);
    expect(result.data?.disconnected).toBe(true);

    // Verify fake OAuth server received revocation request
    const revokeRequests = fakeOAuth.requests.filter((r) => r.url.includes('/revoke'));
    expect(revokeRequests.length).toBe(1);
    const revokeReq = revokeRequests[0];
    expect(revokeReq).toBeDefined();
    if (!revokeReq) {
      throw new Error('Expected revoke request to be present');
    }
    expect(revokeReq.url).toContain('token=1%2F%2F0gRealTestRefreshToken123456');

    // Verify token row removed from DB
    const tokens = await testDb.db.select().from(googleOAuthTokens);
    expect(tokens.length).toBe(0);

    // Verify status updated to disconnected
    const finalStatus = await getGoogleIntegrationStatusAction(getDb());
    expect(finalStatus.data?.connected).toBe(false);

    // Verify audit event
    const auditRows = await testDb.db.select().from(auditEvents);
    const disconnectEvent = auditRows.find((e) => e.action === 'integration.google.disconnected');
    expect(disconnectEvent).toBeDefined();
    expect(disconnectEvent?.actorId).toBe(owner.id);
    expect(disconnectEvent?.targetType).toBe('integration');
    expect(disconnectEvent?.targetId).toBe('google');
    expect(disconnectEvent?.metadata).toMatchObject({
      provider: 'google',
      delete_synced_contacts: true,
    });
  });

  it('AC-6: safely deletes DB token and succeeds even if Google revocation returns 500 error', async () => {
    const { session } = await createOwnerUser();
    currentSessionToken = session.token;

    const encryptedRefreshToken = await encryptSecret('token-to-fail', GOOGLE_OAUTH_PURPOSE);
    await upsertGoogleOAuthToken(
      {
        encryptedRefreshToken,
        accessToken: null,
        accessTokenExpiresAt: null,
        scope: 'https://www.googleapis.com/auth/contacts',
      },
      getDb(),
    );

    fakeOAuth.setRevokeResponse(500);

    const result = await disconnectGoogleAction({ deleteSyncedContacts: false }, getDb());
    expect(result.success).toBe(true);
    expect(result.data?.disconnected).toBe(true);

    // Token must still be deleted from DB so the user isn't stuck
    const tokens = await testDb.db.select().from(googleOAuthTokens);
    expect(tokens.length).toBe(0);

    // Audit event must still be recorded
    const auditRows = await testDb.db.select().from(auditEvents);
    const disconnectEvent = auditRows.find((e) => e.action === 'integration.google.disconnected');
    expect(disconnectEvent).toBeDefined();
    expect(disconnectEvent?.metadata).toMatchObject({
      delete_synced_contacts: false,
    });
  });

  it('AC-6: succeeds and records audit event if disconnect is called when no token is present', async () => {
    const { session } = await createOwnerUser();
    currentSessionToken = session.token;

    const result = await disconnectGoogleAction({ deleteSyncedContacts: true }, getDb());
    expect(result.success).toBe(true);
    expect(result.data?.disconnected).toBe(true);

    const auditRows = await testDb.db.select().from(auditEvents);
    const disconnectEvent = auditRows.find((e) => e.action === 'integration.google.disconnected');
    expect(disconnectEvent).toBeDefined();
  });

  it('AC-7: rejects unauthenticated disconnect attempt with UnauthorizedError', async () => {
    currentSessionToken = null;
    await expect(disconnectGoogleAction({ deleteSyncedContacts: true }, getDb())).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('AC-7: rejects disconnect attempt by non-owner client with ForbiddenError', async () => {
    const { session } = await createClientUser();
    currentSessionToken = session.token;

    await expect(disconnectGoogleAction({ deleteSyncedContacts: true }, getDb())).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('AC-6: returns error when disconnectGoogleAction receives invalid input', async () => {
    const { session } = await createOwnerUser();
    currentSessionToken = session.token;

    // Pass invalid shape (schema has .strict())
    const invalidResult = await disconnectGoogleAction(
      { unexpectedProperty: true } as unknown as { deleteSyncedContacts: boolean },
      getDb(),
    );
    expect(invalidResult.success).toBe(false);
    expect(invalidResult.error).toContain('Invalid disconnect parameters');
  });

  it('AC-3: initiateGoogleConnectAction returns authorization URL for authenticated owner', async () => {
    const { session } = await createOwnerUser();
    currentSessionToken = session.token;

    const res = await initiateGoogleConnectAction('http://127.0.0.1:3000', getDb());
    expect(res.success).toBe(true);
    expect(res.data?.url).toContain(fakeOAuth.baseUrl);
    expect(res.data?.url).toContain('client_id=');
  });

  it('AC-1: initiateGoogleConnectAction returns error when Google OAuth is not configured', async () => {
    const { session } = await createOwnerUser();
    currentSessionToken = session.token;

    delete process.env.GOOGLE_OAUTH_CLIENT_ID;

    const res = await initiateGoogleConnectAction('http://127.0.0.1:3000', getDb());
    expect(res.success).toBe(false);
    expect(res.error).toContain('not configured');
  });
});
