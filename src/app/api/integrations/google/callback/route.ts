import { NextRequest, NextResponse } from 'next/server';
import { db, type DbClient } from '@/server/db/client';
import { requireOwnerSession, extractBearerToken, ForbiddenError } from '@/server/auth/guards';
import { logger } from '@/server/log';
import { audit } from '@/server/audit/service';
import { encryptSecret } from '@/server/crypto/vault';
import {
  validateOAuthStateCookie,
  GOOGLE_OAUTH_STATE_COOKIE,
  SECURE_GOOGLE_OAUTH_STATE_COOKIE,
  OAuthStateError,
} from '@/server/integrations/google/state';
import { exchangeGoogleAuthorizationCode } from '@/server/integrations/google/service';
import { upsertGoogleOAuthToken } from '@/server/integrations/google/repo';
import { GOOGLE_OAUTH_PURPOSE } from '@/server/integrations/google/constants';

export const dynamic = 'force-dynamic';

export interface CallbackRouteContext {
  params?: Promise<Record<string, string | string[]>>;
  client?: DbClient;
  fetchFn?: typeof fetch;
}

/**
 * Handles the Google OAuth 2.0 PKCE callback (AC-4, AC-5, AC-7).
 * Validates owner session, verifies single-use session-bound state,
 * exchanges authorization code for tokens, stores refresh token encrypted at rest,
 * records the integration.google.connected audit event, and redirects to settings.
 */
export async function GET(request: NextRequest, context?: CallbackRouteContext): Promise<Response> {
  const dbClient = context?.client ?? db;

  // 1. Strict rejection of Bearer tokens (owner web session only)
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

  const searchParams = request.nextUrl.searchParams;
  const oauthError = searchParams.get('error');
  if (oauthError) {
    logger.warn({ oauthError }, 'Google OAuth returned an error in callback');
    const redirectUrl = new URL('/settings/integrations/google', request.url);
    redirectUrl.searchParams.set('error', oauthError);
    return NextResponse.redirect(redirectUrl);
  }

  const code = searchParams.get('code');
  const callbackState = searchParams.get('state');

  if (!code || !callbackState) {
    logger.warn('OAuth callback missing required code or state parameter');
    return new NextResponse('Missing code or state parameter.', { status: 400 });
  }

  // 3. Extract and validate session-bound state cookie
  const cookieValue =
    request.cookies.get(SECURE_GOOGLE_OAUTH_STATE_COOKIE)?.value ??
    request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;

  let codeVerifier: string;
  try {
    const validated = await validateOAuthStateCookie({
      cookieValue,
      callbackState,
      currentUserId: auth.user.id,
    });
    codeVerifier = validated.codeVerifier;
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'OAuth state validation failed in callback',
    );
    return new NextResponse(err instanceof OAuthStateError ? err.message : 'Invalid OAuth state.', {
      status: 400,
    });
  }

  // 4. Exchange code + verifier with Google token endpoint
  const redirectUri = `${request.nextUrl.origin}/api/integrations/google/callback`;

  let tokenData;
  try {
    tokenData = await exchangeGoogleAuthorizationCode({
      code,
      codeVerifier,
      redirectUri,
      fetchFn: context?.fetchFn,
    });
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Token exchange failed during Google OAuth callback',
    );
    const redirectUrl = new URL('/settings/integrations/google', request.url);
    redirectUrl.searchParams.set('error', 'token_exchange_failed');
    return NextResponse.redirect(redirectUrl);
  }

  // 5. Encrypt refresh token with credential vault and persist to database
  const encryptedRefreshToken = await encryptSecret(tokenData.refresh_token, GOOGLE_OAUTH_PURPOSE);

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;

  await upsertGoogleOAuthToken(
    {
      encryptedRefreshToken,
      accessToken: tokenData.access_token ?? null,
      accessTokenExpiresAt: expiresAt,
      scope: tokenData.scope,
    },
    dbClient,
  );

  // 6. Record audit event
  await audit(
    {
      actorType: 'owner',
      actorId: auth.user.id,
      action: 'integration.google.connected',
      targetType: 'integration',
      targetId: 'google',
      outcome: 'success',
      metadata: {
        provider: 'google',
        scope: tokenData.scope,
      },
    },
    dbClient,
  );

  // 7. Clear state cookie and redirect to settings with success feedback
  const redirectUrl = new URL('/settings/integrations/google', request.url);
  redirectUrl.searchParams.set('success', 'connected');

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE);
  response.cookies.delete(SECURE_GOOGLE_OAUTH_STATE_COOKIE);

  return response;
}
