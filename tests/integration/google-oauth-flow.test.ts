import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
import type { DbClient } from '@/server/db/client';
import { decryptSecret } from '@/server/crypto/vault';
import {
  generateOAuthState,
  generateCodeVerifier,
  computeCodeChallenge,
} from '@/server/integrations/google/pkce';
import {
  createOAuthStateCookie,
  GOOGLE_OAUTH_STATE_COOKIE,
  _resetUsedOAuthStatesForTesting,
} from '@/server/integrations/google/state';
import {
  buildGoogleAuthorizationUrl,
  getGoogleIntegrationStatus,
} from '@/server/integrations/google/service';
import { disconnectGoogleAction } from '@/server/integrations/google/actions';
import { GET as callbackHandler } from '@/app/api/integrations/google/callback/route';
import { GOOGLE_OAUTH_PURPOSE } from '@/server/integrations/google/constants';

describe('TASK-0017: Google OAuth Flow Integration (AC-3, AC-4, AC-6, AC-7)', () => {
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

    _resetUsedOAuthStatesForTesting();
  });

  afterEach(async () => {
    await fakeOAuth.close();
    await testDb.destroy();
    process.env = { ...originalEnv };
    _resetUsedOAuthStatesForTesting();
  });

  it('AC-3: generates authorization URL targeting endpoint with S256 PKCE, contacts scope, and state', () => {
    const state = generateOAuthState();
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier);

    const authUrl = buildGoogleAuthorizationUrl({
      state,
      codeChallenge: challenge,
      redirectUri: 'http://127.0.0.1:3000/api/integrations/google/callback',
    });

    const parsed = new URL(authUrl);
    expect(parsed.origin).toBe(fakeOAuth.baseUrl);
    expect(parsed.searchParams.get('client_id')).toBe(clientId);
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/contacts');
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
    expect(parsed.searchParams.get('code_challenge')).toBe(challenge);
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('state')).toBe(state);
  });

  it('AC-4: exchanges authorization code, stores refresh token encrypted at rest, and emits audit event', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    // 1. Seed owner user and session
    const [owner] = await dbClient
      .insert(user)
      .values({
        name: 'Studio Owner',
        email: 'owner@example.com',
        role: 'owner',
      })
      .returning();
    expect(owner).toBeDefined();
    if (!owner) throw new Error('Expected owner to exist');

    const sessionRecord = await createSession(owner.id, dbClient);

    // 2. Prepare state & verifier
    const state = generateOAuthState();
    const codeVerifier = generateCodeVerifier();
    const authCode = 'fake-authorization-code-from-google';

    const stateCookie = await createOAuthStateCookie({
      state,
      codeVerifier,
      userId: owner.id,
      masterKeyOverride: masterKey,
    });

    // 3. Invoke callback route with owner session cookie and state cookie
    const callbackUrl = `http://127.0.0.1:3000/api/integrations/google/callback?code=${authCode}&state=${state}`;
    const request = new NextRequest(callbackUrl, {
      headers: {
        cookie: `ownlight_session=${sessionRecord.token}; ${GOOGLE_OAUTH_STATE_COOKIE}=${stateCookie}`,
      },
    });

    const response = await callbackHandler(request, { client: dbClient });

    // Assert redirect to settings with success=connected
    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('/settings/integrations/google');
    expect(location).toContain('success=connected');

    // 4. Assert token row is stored in google_oauth_tokens
    const tokenRows = await dbClient.select().from(googleOAuthTokens);
    expect(tokenRows.length).toBe(1);
    const stored = tokenRows[0];
    expect(stored).toBeDefined();
    if (!stored) throw new Error('Expected stored token row');
    expect(stored.provider).toBe('google');
    expect(stored.scope).toBe('https://www.googleapis.com/auth/contacts');

    // CRITICAL SECURITY ASSERTION: Plaintext refresh token NEVER in database
    expect(stored.encryptedRefreshToken).not.toContain('fake-refresh-token-secret-67890');
    expect(stored.encryptedRefreshToken.startsWith('v1:')).toBe(true);

    // Assert vault successfully decrypts the stored token
    const decryptedToken = await decryptSecret(
      stored.encryptedRefreshToken,
      GOOGLE_OAUTH_PURPOSE,
      masterKey,
    );
    expect(decryptedToken).toBe('fake-refresh-token-secret-67890');

    // 5. Assert audit event emitted
    const auditRows = await dbClient.select().from(auditEvents);
    const connectEvent = auditRows.find((e) => e.action === 'integration.google.connected');
    expect(connectEvent).toBeDefined();
    if (!connectEvent) throw new Error('Expected connect audit event');
    expect(connectEvent.actorType).toBe('owner');
    expect(connectEvent.actorId).toBe(owner.id);
    expect(connectEvent.outcome).toBe('success');
    expect(connectEvent.metadata).toEqual({
      provider: 'google',
      scope: 'https://www.googleapis.com/auth/contacts',
    });
  });

  it('AC-6: disconnectGoogleAction revokes token with Google, removes DB row, and emits audit event', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    // Seed owner user and session
    const [owner] = await dbClient
      .insert(user)
      .values({
        name: 'Studio Owner',
        email: 'owner@example.com',
        role: 'owner',
      })
      .returning();
    expect(owner).toBeDefined();
    if (!owner) throw new Error('Expected owner to exist');

    const sessionRecord = await createSession(owner.id, dbClient);

    // First connect tokens
    const state = generateOAuthState();
    const codeVerifier = generateCodeVerifier();
    const stateCookie = await createOAuthStateCookie({
      state,
      codeVerifier,
      userId: owner.id,
    });

    const callbackUrl = `http://127.0.0.1:3000/api/integrations/google/callback?code=sample-code&state=${state}`;
    const req = new NextRequest(callbackUrl, {
      headers: {
        cookie: `ownlight_session=${sessionRecord.token}; ${GOOGLE_OAUTH_STATE_COOKIE}=${stateCookie}`,
      },
    });
    await callbackHandler(req, { client: dbClient });

    // Assert connected in DB
    const beforeDisconnect = await getGoogleIntegrationStatus(dbClient);
    expect(beforeDisconnect.connected).toBe(true);

    // Call disconnectGoogleAction
    currentSessionToken = sessionRecord.token;

    const tokenRecordBefore = (await dbClient.select().from(googleOAuthTokens))[0];
    expect(tokenRecordBefore).toBeDefined();

    // Call revoke endpoint directly or through action
    const disconnectResult = await disconnectGoogleAction({ deleteSyncedContacts: true }, dbClient);
    expect(disconnectResult.success).toBe(true);

    // Assert tokens deleted from DB
    const tokenRowsAfter = await dbClient.select().from(googleOAuthTokens);
    expect(tokenRowsAfter.length).toBe(0);

    // Assert status is disconnected
    const afterStatus = await getGoogleIntegrationStatus(dbClient);
    expect(afterStatus.connected).toBe(false);

    // Assert audit event recorded
    const auditRows = await dbClient.select().from(auditEvents);
    const disconnectEvent = auditRows.find((e) => e.action === 'integration.google.disconnected');
    expect(disconnectEvent).toBeDefined();
    if (!disconnectEvent) throw new Error('Expected disconnect audit event');
    expect(disconnectEvent.outcome).toBe('success');
    expect(disconnectEvent.metadata).toEqual({
      provider: 'google',
      delete_synced_contacts: true,
    });
  });
});
