'use server';

import 'server-only';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { env } from '@/env';
import { requireOwner, ForbiddenError, type AuthContext } from '@/server/auth/guards';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { generateOAuthState, generateCodeVerifier, computeCodeChallenge } from './pkce';
import {
  createOAuthStateCookie,
  GOOGLE_OAUTH_STATE_COOKIE,
  SECURE_GOOGLE_OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
} from './state';
import { getGoogleIntegrationStatus, buildGoogleAuthorizationUrl } from './service';
import { getGoogleOAuthToken, updateGoogleCalendarSettings } from './repo';
import { GOOGLE_CALENDAR_SCOPE } from './constants';
import { GoogleCalendarClient, type GoogleCalendarItem } from './calendar-client';
import {
  runCalendarSyncWorker,
  type CalendarSyncBatchResult,
} from '@/server/worker/calendar-sync-worker';

export interface CalendarActionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'VALIDATION_FAILED' | 'NOT_CONFIGURED' | 'ERROR';
}

export interface GoogleCalendarSettingsPayload {
  status: 'unconfigured' | 'disconnected' | 'connected';
  configured: boolean;
  connected: boolean;
  hasCalendarScope: boolean;
  calendarSyncEnabled: boolean;
  selectedCalendarId: string;
  lastCalendarSyncAt: Date | null;
  lastCalendarSyncError: string | null;
  calendars: GoogleCalendarItem[];
}

const toggleInputSchema = z.object({
  enabled: z.boolean(),
});

const selectCalendarInputSchema = z.object({
  calendarId: z.string().min(1).max(255),
});

/**
 * Initiates Google Calendar OAuth flow with incremental scope (AC-1, AC-8).
 */
export async function startGoogleCalendarAuthAction(
  redirectBaseUrl?: string,
  client: DbClient = defaultDb,
): Promise<CalendarActionResult<{ url: string }>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'Owner role required.' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
  }

  const details = await getGoogleIntegrationStatus(client);
  if (!details.configured) {
    return {
      success: false,
      code: 'NOT_CONFIGURED',
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

  // Request calendar.events scope with incremental consent (include_granted_scopes: true) (AC-1)
  const authUrl = buildGoogleAuthorizationUrl({
    state,
    codeChallenge,
    redirectUri,
    scope: GOOGLE_CALENDAR_SCOPE,
    includeGrantedScopes: true,
  });

  return { success: true, data: { url: authUrl } };
}

/**
 * Toggles Google Calendar two-way synchronization on or off (AC-7, AC-8).
 */
export async function toggleGoogleCalendarSyncAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<CalendarActionResult<{ enabled: boolean }>> {
  try {
    await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'Owner role required.' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
  }

  const parsed = toggleInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: 'Invalid toggle parameters.',
    };
  }

  const tokenRecord = await getGoogleOAuthToken(client);
  if (!tokenRecord) {
    return {
      success: false,
      code: 'NOT_CONFIGURED',
      error: 'Google Workspace is not connected. Connect via settings first.',
    };
  }

  const hasCalendarScope =
    Boolean(tokenRecord.scope) &&
    (tokenRecord.scope.includes(GOOGLE_CALENDAR_SCOPE) ||
      tokenRecord.scope.includes('https://www.googleapis.com/auth/calendar'));

  if (parsed.data.enabled && !hasCalendarScope) {
    return {
      success: false,
      code: 'ERROR',
      error: 'Google Calendar scope is not authorized. Please authorize calendar access first.',
    };
  }

  await updateGoogleCalendarSettings(
    {
      calendarSyncEnabled: parsed.data.enabled,
    },
    client,
  );

  return { success: true, data: { enabled: parsed.data.enabled } };
}

/**
 * Selects the target Google Calendar ID for synchronization (AC-7, AC-8).
 */
export async function selectGoogleCalendarAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<CalendarActionResult<{ calendarId: string }>> {
  try {
    await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'Owner role required.' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
  }

  const parsed = selectCalendarInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: 'Invalid calendar selection parameters.',
    };
  }

  const tokenRecord = await getGoogleOAuthToken(client);
  if (!tokenRecord) {
    return {
      success: false,
      code: 'NOT_CONFIGURED',
      error: 'Google Workspace is not connected.',
    };
  }

  await updateGoogleCalendarSettings(
    {
      selectedCalendarId: parsed.data.calendarId,
    },
    client,
  );

  return { success: true, data: { calendarId: parsed.data.calendarId } };
}

/**
 * Triggers manual calendar sync worker run (AC-7, AC-8).
 */
export async function triggerManualCalendarSyncAction(
  client: DbClient = defaultDb,
): Promise<CalendarActionResult<CalendarSyncBatchResult>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'Owner role required.' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
  }

  const tokenRecord = await getGoogleOAuthToken(client);
  if (!tokenRecord) {
    return {
      success: false,
      code: 'NOT_CONFIGURED',
      error: 'Google Workspace is not connected.',
    };
  }

  try {
    const result = await runCalendarSyncWorker({
      dbClient: client,
      actorType: 'owner',
      actorId: auth.user.id,
      forceInbound: true,
    });

    return { success: true, data: result };
  } catch (err) {
    return {
      success: false,
      code: 'ERROR',
      error: err instanceof Error ? err.message : 'Manual sync failed.',
    };
  }
}

/**
 * Fetches Google Calendar integration settings and calendar list (AC-7, AC-8).
 */
export async function getGoogleCalendarSettingsAction(
  client: DbClient = defaultDb,
): Promise<CalendarActionResult<GoogleCalendarSettingsPayload>> {
  try {
    await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'Owner role required.' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
  }

  const status = await getGoogleIntegrationStatus(client);
  const tokenRecord = await getGoogleOAuthToken(client);

  let calendars: GoogleCalendarItem[] = [
    { id: 'primary', summary: 'Primary Calendar', primary: true },
  ];

  if (status.connected && status.hasCalendarScope) {
    try {
      const calendarClient = new GoogleCalendarClient({ dbClient: client });
      const fetchedCalendars = await calendarClient.listCalendars();
      if (fetchedCalendars.length > 0) {
        calendars = fetchedCalendars;
      }
    } catch {
      // Keep default primary calendar on fetch error
    }
  }

  return {
    success: true,
    data: {
      status: status.status,
      configured: status.configured,
      connected: status.connected,
      hasCalendarScope: Boolean(status.hasCalendarScope),
      calendarSyncEnabled: tokenRecord?.calendarSyncEnabled ?? false,
      selectedCalendarId: tokenRecord?.selectedCalendarId ?? 'primary',
      lastCalendarSyncAt: tokenRecord?.lastCalendarSyncAt ?? null,
      lastCalendarSyncError: tokenRecord?.lastCalendarSyncError ?? null,
      calendars,
    },
  };
}
