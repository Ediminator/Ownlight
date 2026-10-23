import 'server-only';
import { eq } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import {
  googleOAuthTokens,
  type GoogleOAuthToken,
  type NewGoogleOAuthToken,
} from '@/server/db/schema/google-oauth-tokens';

export type { GoogleOAuthToken, NewGoogleOAuthToken };

/**
 * Retrieves the singleton Google OAuth token record if connected.
 */
export async function getGoogleOAuthToken(
  client: DbClient = defaultDb,
): Promise<GoogleOAuthToken | null> {
  const rows = await client
    .select()
    .from(googleOAuthTokens)
    .where(eq(googleOAuthTokens.provider, 'google'))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Upserts the singleton Google OAuth token record with encrypted refresh token.
 */
export async function upsertGoogleOAuthToken(
  data: {
    encryptedRefreshToken: string;
    accessToken?: string | null;
    accessTokenExpiresAt?: Date | null;
    scope: string;
    calendarSyncEnabled?: boolean;
    selectedCalendarId?: string | null;
    lastCalendarSyncAt?: Date | null;
    lastCalendarSyncError?: string | null;
  },
  client: DbClient = defaultDb,
): Promise<GoogleOAuthToken> {
  const now = new Date();

  const [record] = await client
    .insert(googleOAuthTokens)
    .values({
      provider: 'google',
      encryptedRefreshToken: data.encryptedRefreshToken,
      accessToken: data.accessToken ?? null,
      accessTokenExpiresAt: data.accessTokenExpiresAt ?? null,
      scope: data.scope,
      calendarSyncEnabled: data.calendarSyncEnabled ?? false,
      selectedCalendarId: data.selectedCalendarId ?? 'primary',
      lastCalendarSyncAt: data.lastCalendarSyncAt ?? null,
      lastCalendarSyncError: data.lastCalendarSyncError ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: googleOAuthTokens.provider,
      set: {
        encryptedRefreshToken: data.encryptedRefreshToken,
        accessToken: data.accessToken ?? null,
        accessTokenExpiresAt: data.accessTokenExpiresAt ?? null,
        scope: data.scope,
        ...(data.calendarSyncEnabled !== undefined
          ? { calendarSyncEnabled: data.calendarSyncEnabled }
          : {}),
        ...(data.selectedCalendarId !== undefined
          ? { selectedCalendarId: data.selectedCalendarId }
          : {}),
        ...(data.lastCalendarSyncAt !== undefined
          ? { lastCalendarSyncAt: data.lastCalendarSyncAt }
          : {}),
        ...(data.lastCalendarSyncError !== undefined
          ? { lastCalendarSyncError: data.lastCalendarSyncError }
          : {}),
        updatedAt: now,
      },
    })
    .returning();

  if (!record) {
    throw new Error('Failed to upsert Google OAuth token record.');
  }

  return record;
}

/**
 * Updates Google Calendar sync settings on the token record.
 */
export async function updateGoogleCalendarSettings(
  data: {
    calendarSyncEnabled?: boolean;
    selectedCalendarId?: string | null;
    lastCalendarSyncAt?: Date | null;
    lastCalendarSyncError?: string | null;
  },
  client: DbClient = defaultDb,
): Promise<GoogleOAuthToken | null> {
  const [record] = await client
    .update(googleOAuthTokens)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(googleOAuthTokens.provider, 'google'))
    .returning();

  return record ?? null;
}

/**
 * Deletes the Google OAuth token record upon disconnection.
 */
export async function deleteGoogleOAuthToken(client: DbClient = defaultDb): Promise<boolean> {
  const deleted = await client
    .delete(googleOAuthTokens)
    .where(eq(googleOAuthTokens.provider, 'google'))
    .returning();

  return deleted.length > 0;
}
