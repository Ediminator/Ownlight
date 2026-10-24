'use server';

import 'server-only';
import { z } from 'zod';
import { requireOwner, ForbiddenError, type AuthContext } from '@/server/auth/guards';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { audit } from '@/server/audit';
import { encryptSecret } from '@/server/crypto/vault';
import { CaldavClient, type CaldavCalendarItem } from './client';
import {
  saveCaldavAccount,
  getCaldavAccount,
  deleteCaldavAccount,
  type CaldavAccount,
} from './repo';
import {
  runCalendarSyncWorker,
  type CalendarSyncBatchResult,
} from '@/server/worker/calendar-sync-worker';

export interface CaldavActionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'VALIDATION_FAILED' | 'ERROR';
}

export interface CaldavAccountStatusPayload {
  connected: boolean;
  account: {
    id: string;
    serverUrl: string;
    username: string;
    selectedCalendarUrl: string | null;
    selectedCalendarName: string | null;
    lastSyncedAt: Date | null;
    lastSyncError: string | null;
    createdAt: Date;
  } | null;
}

const testConnectionSchema = z
  .object({
    serverUrl: z.string().url().max(500),
    username: z.string().min(1).max(255),
    password: z.string().min(1).max(500),
  })
  .strict();

const saveAccountSchema = z
  .object({
    serverUrl: z.string().url().max(500),
    username: z.string().min(1).max(255),
    password: z.string().min(1).max(500),
    selectedCalendarUrl: z.string().min(1).max(500),
    selectedCalendarName: z.string().min(1).max(255).default('Calendar'),
  })
  .strict();

/**
 * Tests connection credentials and discovers user calendars via tsdav (AC-1, AC-8).
 */
export async function testCaldavConnectionAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<CaldavActionResult<{ calendars: CaldavCalendarItem[] }>> {
  try {
    await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'Owner role required.' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
  }

  const parsed = testConnectionSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error:
        'Invalid connection parameters. Please provide valid server URL, username, and password.',
    };
  }

  try {
    const isTest = process.env.NODE_ENV === 'test' || process.env.USE_PGLITE === 'true';
    const caldav = new CaldavClient({
      serverUrl: parsed.data.serverUrl,
      username: parsed.data.username,
      password: parsed.data.password,
      allowLoopback: isTest,
    });

    const calendars = await caldav.testConnectionAndDiscoverCalendars();
    return { success: true, data: { calendars } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to connect to CalDAV server.';
    return { success: false, code: 'ERROR', error: message };
  }
}

/**
 * Encrypts password with AES-256-GCM via vault, stores CalDAV account,
 * and records integration.caldav.connected audit event (AC-2, AC-8).
 */
export async function saveCaldavAccountAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<CaldavActionResult<{ account: CaldavAccount }>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'Owner role required.' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
  }

  const parsed = saveAccountSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: 'Invalid parameters for saving CalDAV account.',
    };
  }

  try {
    // Encrypt password using application vault with purpose ownlight:vault:caldav (AC-2)
    const encryptedPassword = await encryptSecret(parsed.data.password, 'ownlight:vault:caldav');

    const account = await saveCaldavAccount(
      {
        serverUrl: parsed.data.serverUrl,
        username: parsed.data.username,
        encryptedPassword,
        selectedCalendarUrl: parsed.data.selectedCalendarUrl,
        selectedCalendarName: parsed.data.selectedCalendarName,
      },
      client,
    );

    // Record audit event: integration.caldav.connected (AC-2)
    await audit(
      {
        actorType: 'owner',
        actorId: auth.user.id,
        action: 'integration.caldav.connected',
        targetType: 'integration',
        targetId: 'caldav',
        outcome: 'success',
        metadata: {
          account_id: account.id,
          server_url: account.serverUrl,
          calendar_name: account.selectedCalendarName ?? 'Calendar',
        },
      },
      client,
    );

    return { success: true, data: { account } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save CalDAV account.';
    return { success: false, code: 'ERROR', error: message };
  }
}

/**
 * Disconnects CalDAV account, deletes credentials and sync links,
 * and records integration.caldav.disconnected audit event (AC-5, AC-8).
 */
export async function disconnectCaldavAccountAction(
  client: DbClient = defaultDb,
): Promise<CaldavActionResult<{ disconnected: boolean }>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'Owner role required.' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
  }

  try {
    const result = await deleteCaldavAccount(client);

    if (result.accountId) {
      await audit(
        {
          actorType: 'owner',
          actorId: auth.user.id,
          action: 'integration.caldav.disconnected',
          targetType: 'integration',
          targetId: 'caldav',
          outcome: 'success',
          metadata: {
            account_id: result.accountId,
          },
        },
        client,
      );
    }

    return { success: true, data: { disconnected: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to disconnect CalDAV account.';
    return { success: false, code: 'ERROR', error: message };
  }
}

/**
 * Triggers immediate manual CalDAV synchronization run (AC-8).
 */
export async function triggerManualCaldavSyncAction(
  client: DbClient = defaultDb,
): Promise<CaldavActionResult<CalendarSyncBatchResult>> {
  let auth: AuthContext;
  try {
    auth = await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'Owner role required.' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
  }

  const account = await getCaldavAccount(client);
  if (!account) {
    return {
      success: false,
      code: 'ERROR',
      error: 'CalDAV is not connected. Configure in settings first.',
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
    const message = err instanceof Error ? err.message : 'Manual CalDAV sync failed.';
    return { success: false, code: 'ERROR', error: message };
  }
}

/**
 * Retrieves the current CalDAV account status without returning sensitive credentials (AC-8).
 */
export async function getCaldavAccountStatusAction(
  client: DbClient = defaultDb,
): Promise<CaldavActionResult<CaldavAccountStatusPayload>> {
  try {
    await requireOwner({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'Owner role required.' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
  }

  try {
    const account = await getCaldavAccount(client);
    if (!account) {
      return {
        success: true,
        data: {
          connected: false,
          account: null,
        },
      };
    }

    return {
      success: true,
      data: {
        connected: true,
        account: {
          id: account.id,
          serverUrl: account.serverUrl,
          username: account.username,
          selectedCalendarUrl: account.selectedCalendarUrl,
          selectedCalendarName: account.selectedCalendarName,
          lastSyncedAt: account.lastSyncedAt,
          lastSyncError: account.lastSyncError,
          createdAt: account.createdAt,
        },
      },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to retrieve CalDAV account status.';
    return { success: false, code: 'ERROR', error: message };
  }
}
