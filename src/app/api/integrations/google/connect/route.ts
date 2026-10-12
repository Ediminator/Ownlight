import { NextRequest, NextResponse } from 'next/server';
import { db, type DbClient } from '@/server/db/client';
import { requireOwnerSession, extractBearerToken, ForbiddenError } from '@/server/auth/guards';
import { isGoogleOAuthConfigured } from '@/env';
import {
  generateOAuthState,
  generateCodeVerifier,
  computeCodeChallenge,
} from '@/server/integrations/google/pkce';
import {
  createOAuthStateCookie,
  GOOGLE_OAUTH_STATE_COOKIE,
  SECURE_GOOGLE_OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
} from '@/server/integrations/google/state';
import { buildGoogleAuthorizationUrl } from '@/server/integrations/google/service';

export const dynamic = 'force-dynamic';

export interface ConnectRouteContext {
  params?: Promise<Record<string, string | string[]>>;
  client?: DbClient;
}

/**
 * Initiates the Google OAuth 2.0 PKCE flow via GET navigation (AC-3, AC-7).
 * Sets the session-bound state cookie and redirects to Google authorization endpoint.
 */
export async function GET(request: NextRequest, context?: ConnectRouteContext): Promise<Response> {
  const dbClient = context?.client ?? db;

  // 1. Strict rejection of Bearer tokens
  const bearerToken = extractBearerToken(request.headers);
  if (bearerToken) {
    return new NextResponse('API keys are not permitted for this endpoint.', {
      status: 403,
    });
  }

  // 2. Validate active owner web session
  let auth;
  try {
    auth = await requireOwnerSession({
      headers: request.headers,
      client: dbClient,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return new NextResponse('Owner session required.', { status: 403 });
    }
    return new NextResponse('Authentication required.', { status: 401 });
  }

  // 3. Verify that integration is configured
  if (!isGoogleOAuthConfigured()) {
    const errorUrl = new URL('/settings/integrations/google', request.url);
    errorUrl.searchParams.set('error', 'unconfigured');
    return NextResponse.redirect(errorUrl);
  }

  // 4. Generate PKCE and state
  const state = generateOAuthState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);

  const redirectUri = `${request.nextUrl.origin}/api/integrations/google/callback`;

  // 5. Encrypt session-bound state cookie
  const cookieValue = await createOAuthStateCookie({
    state,
    codeVerifier,
    userId: auth.user.id,
  });

  const isProductionOrSsl = process.env.NODE_ENV === 'production' || process.env.DB_SSL === 'true';
  const cookieName = isProductionOrSsl
    ? SECURE_GOOGLE_OAUTH_STATE_COOKIE
    : GOOGLE_OAUTH_STATE_COOKIE;

  const authUrl = buildGoogleAuthorizationUrl({
    state,
    codeChallenge,
    redirectUri,
  });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(cookieName, cookieValue, {
    httpOnly: true,
    secure: isProductionOrSsl,
    sameSite: 'lax',
    maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
    path: '/',
  });

  return response;
}
