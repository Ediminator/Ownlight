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
import { createSession } from '@/server/auth/session';
import type { DbClient } from '@/server/db/client';
import { generateOAuthState, generateCodeVerifier } from '@/server/integrations/google/pkce';
import {
  createOAuthStateCookie,
  GOOGLE_OAUTH_STATE_COOKIE,
  _resetUsedOAuthStatesForTesting,
} from '@/server/integrations/google/state';
import { GET as connectHandler } from '@/app/api/integrations/google/connect/route';
import { GET as callbackHandler } from '@/app/api/integrations/google/callback/route';

describe('TASK-0017: Google OAuth Negative & Security Controls (AC-1, AC-5, AC-7)', () => {
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

  // --- AC-1: Unconfigured Credentials ---
  it('AC-1: rejects connect navigation when OAuth is unconfigured without external calls', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    const { session } = await createOwnerUser();

    const req = new NextRequest('http://127.0.0.1:3000/api/integrations/google/connect', {
      headers: {
        cookie: `ownlight_session=${session.token}`,
      },
    });

    const res = await connectHandler(req, { client: getDb() });
    expect(res.status).toBe(307); // NextResponse.redirect default is 307
    const location = res.headers.get('location');
    expect(location).toContain('/settings/integrations/google?error=unconfigured');
    expect(fakeOAuth.requests.length).toBe(0);
  });

  // --- AC-7: Authentication & Authorization Bounds ---
  it('AC-7: rejects unauthenticated connect request with 401', async () => {
    const req = new NextRequest('http://127.0.0.1:3000/api/integrations/google/connect');
    const res = await connectHandler(req, { client: getDb() });
    expect(res.status).toBe(401);
  });

  it('AC-7: rejects connect request with API key Bearer token with 403', async () => {
    const req = new NextRequest('http://127.0.0.1:3000/api/integrations/google/connect', {
      headers: {
        Authorization: 'Bearer test_api_key_value',
      },
    });
    const res = await connectHandler(req, { client: getDb() });
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).toContain('API keys are not permitted');
  });

  it('AC-7: rejects connect request by client role user with 403', async () => {
    const { session } = await createClientUser();
    const req = new NextRequest('http://127.0.0.1:3000/api/integrations/google/connect', {
      headers: {
        cookie: `ownlight_session=${session.token}`,
      },
    });
    const res = await connectHandler(req, { client: getDb() });
    expect(res.status).toBe(403);
  });

  it('AC-7: rejects unauthenticated callback request with 401', async () => {
    const req = new NextRequest(
      'http://127.0.0.1:3000/api/integrations/google/callback?code=abc&state=xyz',
    );
    const res = await callbackHandler(req, { client: getDb() });
    expect(res.status).toBe(401);
  });

  it('AC-7: rejects callback request with API key Bearer token with 403', async () => {
    const req = new NextRequest(
      'http://127.0.0.1:3000/api/integrations/google/callback?code=abc&state=xyz',
      {
        headers: {
          Authorization: 'Bearer test_api_key_value',
        },
      },
    );
    const res = await callbackHandler(req, { client: getDb() });
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).toContain('API keys are not permitted');
  });

  // --- AC-5: State Validation, CSRF, Replay, Expiry, Session Binding ---
  it('AC-5: rejects callback when state parameter is missing with 400', async () => {
    const { session } = await createOwnerUser();
    const req = new NextRequest('http://127.0.0.1:3000/api/integrations/google/callback?code=abc', {
      headers: {
        cookie: `ownlight_session=${session.token}`,
      },
    });
    const res = await callbackHandler(req, { client: getDb() });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Missing code or state');
  });

  it('AC-5: rejects callback when code parameter is missing with 400', async () => {
    const { session } = await createOwnerUser();
    const req = new NextRequest(
      'http://127.0.0.1:3000/api/integrations/google/callback?state=xyz',
      {
        headers: {
          cookie: `ownlight_session=${session.token}`,
        },
      },
    );
    const res = await callbackHandler(req, { client: getDb() });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Missing code or state');
  });

  it('AC-5: rejects callback when state cookie is missing with 400', async () => {
    const { session } = await createOwnerUser();
    const req = new NextRequest(
      'http://127.0.0.1:3000/api/integrations/google/callback?code=abc&state=xyz',
      {
        headers: {
          cookie: `ownlight_session=${session.token}`,
        },
      },
    );
    const res = await callbackHandler(req, { client: getDb() });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Missing OAuth state cookie');
  });

  it('AC-5: rejects callback when state cookie is corrupted or tampered with 400', async () => {
    const { session } = await createOwnerUser();
    const req = new NextRequest(
      'http://127.0.0.1:3000/api/integrations/google/callback?code=abc&state=xyz',
      {
        headers: {
          cookie: `ownlight_session=${session.token}; ${GOOGLE_OAUTH_STATE_COOKIE}=v1:invalidiv:invalidtag:invalidcipher`,
        },
      },
    );
    const res = await callbackHandler(req, { client: getDb() });
    expect(res.status).toBe(400);
  });

  it('AC-5: rejects callback when state token has expired (>10 minutes) with 400', async () => {
    const { owner, session } = await createOwnerUser();
    const state = generateOAuthState();
    const verifier = generateCodeVerifier();

    // Fabricate expired cookie (11 minutes ago)
    const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
    const expiredCookie = await createOAuthStateCookie({
      state,
      codeVerifier: verifier,
      userId: owner.id,
      expiresAtOverride: elevenMinutesAgo,
    });

    const req = new NextRequest(
      `http://127.0.0.1:3000/api/integrations/google/callback?code=abc&state=${state}`,
      {
        headers: {
          cookie: `ownlight_session=${session.token}; ${GOOGLE_OAUTH_STATE_COOKIE}=${expiredCookie}`,
        },
      },
    );
    const res = await callbackHandler(req, { client: getDb() });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('OAuth state has expired');
  });

  it('AC-5: rejects callback when state token is replayed with 400', async () => {
    const { owner, session } = await createOwnerUser();
    const state = generateOAuthState();
    const verifier = generateCodeVerifier();

    const stateCookie = await createOAuthStateCookie({
      state,
      codeVerifier: verifier,
      userId: owner.id,
    });

    // First request succeeds
    const req1 = new NextRequest(
      `http://127.0.0.1:3000/api/integrations/google/callback?code=valid-code-1&state=${state}`,
      {
        headers: {
          cookie: `ownlight_session=${session.token}; ${GOOGLE_OAUTH_STATE_COOKIE}=${stateCookie}`,
        },
      },
    );
    const res1 = await callbackHandler(req1, { client: getDb() });
    expect(res1.status).toBe(307);

    // Second request with exact same state cookie is rejected as replayed
    const req2 = new NextRequest(
      `http://127.0.0.1:3000/api/integrations/google/callback?code=valid-code-2&state=${state}`,
      {
        headers: {
          cookie: `ownlight_session=${session.token}; ${GOOGLE_OAUTH_STATE_COOKIE}=${stateCookie}`,
        },
      },
    );
    const res2 = await callbackHandler(req2, { client: getDb() });
    expect(res2.status).toBe(400);
    const text = await res2.text();
    expect(text).toContain('already been used');
  });

  it('AC-5: rejects callback when session owner does not match the state cookie userId with 400', async () => {
    const { owner: ownerA } = await createOwnerUser();
    const { session: sessionB } = await createOwnerUser();

    const state = generateOAuthState();
    const verifier = generateCodeVerifier();

    // Cookie issued for Owner A
    const stateCookie = await createOAuthStateCookie({
      state,
      codeVerifier: verifier,
      userId: ownerA.id,
    });

    // Callback invoked by Owner B's session
    const req = new NextRequest(
      `http://127.0.0.1:3000/api/integrations/google/callback?code=abc&state=${state}`,
      {
        headers: {
          cookie: `ownlight_session=${sessionB.token}; ${GOOGLE_OAUTH_STATE_COOKIE}=${stateCookie}`,
        },
      },
    );
    const res = await callbackHandler(req, { client: getDb() });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('different owner session');
  });

  it('AC-5: redirects to settings with error parameter when Google sends error (e.g. access_denied)', async () => {
    const { session } = await createOwnerUser();
    const req = new NextRequest(
      'http://127.0.0.1:3000/api/integrations/google/callback?error=access_denied',
      {
        headers: {
          cookie: `ownlight_session=${session.token}`,
        },
      },
    );
    const res = await callbackHandler(req, { client: getDb() });
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toContain('/settings/integrations/google?error=access_denied');

    // No DB tokens created
    const tokens = await testDb.db.select().from(googleOAuthTokens);
    expect(tokens.length).toBe(0);
  });

  // --- AC-4: Upstream Token Exchange Failures ---
  it('AC-4: handles upstream Google token endpoint error gracefully and redirects to error', async () => {
    const { owner, session } = await createOwnerUser();
    const state = generateOAuthState();
    const verifier = generateCodeVerifier();

    const stateCookie = await createOAuthStateCookie({
      state,
      codeVerifier: verifier,
      userId: owner.id,
    });

    // Simulate token endpoint failure
    fakeOAuth.setTokenResponse(500, { error: 'server_error', error_description: 'Google outage' });

    const req = new NextRequest(
      `http://127.0.0.1:3000/api/integrations/google/callback?code=error-trigger&state=${state}`,
      {
        headers: {
          cookie: `ownlight_session=${session.token}; ${GOOGLE_OAUTH_STATE_COOKIE}=${stateCookie}`,
        },
      },
    );
    const res = await callbackHandler(req, { client: getDb() });
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toContain('/settings/integrations/google?error=token_exchange_failed');

    const tokens = await testDb.db.select().from(googleOAuthTokens);
    expect(tokens.length).toBe(0);
  });
});
