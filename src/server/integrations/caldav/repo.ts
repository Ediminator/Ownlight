import 'server-only';
import { eq } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import {
  caldavAccounts,
  calendarSyncLinks,
  externalCalendarBusyIntervals,
  type CaldavAccount,
  type NewCaldavAccount,
} from '@/server/db/schema/calendar';

export type { CaldavAccount, NewCaldavAccount };

export interface CaldavAccountStatus {
  connected: boolean;
  serverUrl?: string | null;
  username?: string | null;
  selectedCalendarUrl?: string | null;
  selectedCalendarName?: string | null;
  lastSyncedAt?: Date | null;
  lastSyncStatus?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | null;
  lastSyncError?: string | null;
}

/**
 * Retrieves the primary active CalDAV account if configured.
 */
export async function getCaldavAccount(
  client: DbClient = defaultDb,
): Promise<CaldavAccount | null> {
  const rows = await client
    .select()
    .from(caldavAccounts)
    .where(eq(caldavAccounts.isActive, true))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Retrieves the status representation of the CalDAV integration.
 */
export async function getCaldavAccountStatus(
  client: DbClient = defaultDb,
): Promise<CaldavAccountStatus> {
  const account = await getCaldavAccount(client);
  if (!account) {
    return { connected: false };
  }
  return {
    connected: true,
    serverUrl: account.serverUrl,
    username: account.username,
    selectedCalendarUrl: account.selectedCalendarUrl,
    selectedCalendarName: account.selectedCalendarName,
    lastSyncedAt: account.lastSyncedAt,
    lastSyncStatus: account.lastSyncError ? 'FAILED' : account.lastSyncedAt ? 'COMPLETED' : null,
    lastSyncError: account.lastSyncError,
  };
}

/**
 * Retrieves any CalDAV account record (active or inactive).
 */
export async function getAnyCaldavAccount(
  client: DbClient = defaultDb,
): Promise<CaldavAccount | null> {
  const rows = await client.select().from(caldavAccounts).limit(1);
  return rows[0] ?? null;
}

/**
 * Saves or updates CalDAV account credentials with encrypted password.
 */
export async function saveCaldavAccount(
  data: {
    serverUrl: string;
    username: string;
    encryptedPassword: string;
    selectedCalendarUrl: string;
    selectedCalendarName: string;
    calendarHomeUrl?: string | null;
  },
  client: DbClient = defaultDb,
): Promise<CaldavAccount> {
  const existing = await getAnyCaldavAccount(client);
  const now = new Date();

  if (existing) {
    const [updated] = await client
      .update(caldavAccounts)
      .set({
        serverUrl: data.serverUrl,
        username: data.username,
        encryptedPassword: data.encryptedPassword,
        selectedCalendarUrl: data.selectedCalendarUrl,
        selectedCalendarName: data.selectedCalendarName,
        calendarHomeUrl: data.calendarHomeUrl ?? existing.calendarHomeUrl,
        isActive: true,
        lastSyncError: null,
        updatedAt: now,
      })
      .where(eq(caldavAccounts.id, existing.id))
      .returning();

    if (!updated) {
      throw new Error('Failed to update CalDAV account.');
    }
    return updated;
  }

  const [created] = await client
    .insert(caldavAccounts)
    .values({
      serverUrl: data.serverUrl,
      username: data.username,
      encryptedPassword: data.encryptedPassword,
      selectedCalendarUrl: data.selectedCalendarUrl,
      selectedCalendarName: data.selectedCalendarName,
      calendarHomeUrl: data.calendarHomeUrl ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!created) {
    throw new Error('Failed to insert CalDAV account.');
  }
  return created;
}

/**
 * Updates synchronization status and tokens on the CalDAV account record.
 */
export async function updateCaldavAccountSyncStatus(
  id: string,
  data: {
    lastSyncedAt?: Date | null;
    lastSyncError?: string | null;
    ctag?: string | null;
    syncToken?: string | null;
    isActive?: boolean;
  },
  client: DbClient = defaultDb,
): Promise<CaldavAccount | null> {
  const [record] = await client
    .update(caldavAccounts)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(caldavAccounts.id, id))
    .returning();

  return record ?? null;
}

/**
 * Disconnects the CalDAV integration by deleting the account,
 * associated sync links, and external cached busy intervals (AC-5).
 */
export async function deleteCaldavAccount(
  client: DbClient = defaultDb,
): Promise<{ deleted: boolean; accountId?: string }> {
  const existing = await getAnyCaldavAccount(client);
  if (!existing) {
    return { deleted: false };
  }

  // 1. Delete all CalDAV calendar sync links
  await client.delete(calendarSyncLinks).where(eq(calendarSyncLinks.provider, 'caldav'));

  // 2. Clear external busy intervals cached from CalDAV
  await client
    .delete(externalCalendarBusyIntervals)
    .where(eq(externalCalendarBusyIntervals.provider, 'caldav'));

  // 3. Delete CalDAV account record
  await client.delete(caldavAccounts).where(eq(caldavAccounts.id, existing.id));

  return { deleted: true, accountId: existing.id };
}
