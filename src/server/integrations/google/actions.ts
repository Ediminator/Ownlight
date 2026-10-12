'use server';

import 'server-only';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { env } from '@/env';
import { requireOwnerSession } from '@/server/auth/guards';
import { audit } from '@/server/audit/service';
import { decryptSecret } from '@/server/crypto/vault';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { generateOAuthState, generateCodeVerifier, computeCodeChallenge } from './pkce';
import {
  createOAuthStateCookie,
  GOOGLE_OAUTH_STATE_COOKIE,
  SECURE_GOOGLE_OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
} from './state';
import {
  getGoogleIntegrationStatus,
  buildGoogleAuthorizationUrl,
  revokeGoogleToken,
  type GoogleIntegrationDetails,
} from './service';
import { getGoogleOAuthToken, deleteGoogleOAuthToken } from './repo';
import { GOOGLE_OAUTH_PURPOSE } from './constants';

const disconnectInputSchema = z
  .object({
    deleteSyncedContacts: z.boolean().default(true),
  })
  .strict()
  .optional();

export type DisconnectInput = z.infer<typeof disconnectInputSchema>;

export interface ActionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Reads Google Workspace integration status for the authenticated studio owner.
 */
export async function getGoogleIntegrationStatusAction(
  client: DbClient = defaultDb,
): Promise<ActionResult<GoogleIntegrationDetails>> {
  await requireOwnerSession({ client });
  const details = await getGoogleIntegrationStatus(client);
  return { success: true, data: details };
}

/**
 * Initiates the Google OAuth 2.0 PKCE flow.
 * Generates single-use state, code verifier/challenge, binds to the session,
 * sets the encrypted state cookie, and returns the authorization URL.
 */
export async function initiateGoogleConnectAction(
  redirectBaseUrl?: string,
  client: DbClient = defaultDb,
): Promise<ActionResult<{ url: string }>> {
  const auth = await requireOwnerSession({ client });

  const details = await getGoogleIntegrationStatus(client);
  if (!details.configured) {
    return {
      success: false,
      error: 'Google OAuth integration is not configured on this studio instance.',
    };
  }

  const state = generateOAuthState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);

  let baseUrl = redirectBaseUrl ?? process.env.AUTH_URL;
  if (!baseUrl) {
    try {
      baseUrl = env.AUTH_URL;
    } catch {
      baseUrl = 'http://localhost:3000';
    }
  }
  const redirectUri = `${baseUrl.replace(/\/$/, '')}/api/integrations/google/callback`;

  // Encrypt state and verifier in session-bound cookie
  const cookieValue = await createOAuthStateCookie({
    state,
    codeVerifier,
    userId: auth.user.id,
  });

  const isProductionOrSsl = process.env.NODE_ENV === 'production' || process.env.DB_SSL === 'true';
  const cookieName = isProductionOrSsl
    ? SECURE_GOOGLE_OAUTH_STATE_COOKIE
    : GOOGLE_OAUTH_STATE_COOKIE;

  const cookieStore = await cookies();
  cookieStore.set(cookieName, cookieValue, {
    httpOnly: true,
    secure: isProductionOrSsl,
    sameSite: 'lax',
    maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
    path: '/',
  });

  const authUrl = buildGoogleAuthorizationUrl({
    state,
    codeChallenge,
    redirectUri,
  });

  return { success: true, data: { url: authUrl } };
}

/**
 * Disconnects Google Workspace integration.
 * Revokes external OAuth tokens, deletes credentials from database,
 * and emits the integration.google.disconnected audit event.
 */
export async function disconnectGoogleAction(
  rawInput?: DisconnectInput,
  client: DbClient = defaultDb,
): Promise<ActionResult<{ disconnected: boolean }>> {
  const auth = await requireOwnerSession({ client });

  const parsed = disconnectInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Invalid disconnect parameters.',
    };
  }

  const tokenRecord = await getGoogleOAuthToken(client);
  if (tokenRecord) {
    try {
      const refreshToken = await decryptSecret(
        tokenRecord.encryptedRefreshToken,
        GOOGLE_OAUTH_PURPOSE,
      );
      await revokeGoogleToken(refreshToken);
    } catch {
      // If decryption fails, proceed with deleting database token to prevent lockout
    }

    await deleteGoogleOAuthToken(client);
  }

  await audit(
    {
      actorType: 'owner',
      actorId: auth.user.id,
      action: 'integration.google.disconnected',
      targetType: 'integration',
      targetId: 'google',
      outcome: 'success',
      metadata: {
        provider: 'google',
        delete_synced_contacts: parsed.data?.deleteSyncedContacts ?? true,
      },
    },
    client,
  );

  return { success: true, data: { disconnected: true } };
}
