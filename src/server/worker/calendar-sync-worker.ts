import 'server-only';
import { eq, and, lte } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { audit } from '@/server/audit';
import { logger } from '@/server/log';
import {
  calendarSyncOutbox,
  calendarSyncLinks,
  appointments,
  blockedTime,
  type CalendarSyncOutboxItem,
} from '@/server/db/schema/calendar';
import { shoots, projects } from '@/server/db/schema/projects';
import { studioSettings } from '@/server/db/schema/studio-settings';
import {
  getGoogleOAuthToken,
  updateGoogleCalendarSettings,
} from '@/server/integrations/google/repo';
import {
  GoogleCalendarClient,
  CalendarApiError,
  formatCalendarEventSummary,
  type GoogleCalendarEventPayload,
} from '@/server/integrations/google/calendar-client';
import { hasGoogleCalendarScope } from '@/server/integrations/google/constants';
import { getCaldavAccount, updateCaldavAccountSyncStatus } from '@/server/integrations/caldav/repo';
import { CaldavClient } from '@/server/integrations/caldav/client';
import { decryptSecret } from '@/server/crypto/vault';
import { type CaldavEventInput } from '@/server/integrations/caldav/mapping';
import {
  calculateNextAttemptDate,
  calculateBackoffDelayMs,
  isTerminalRetry,
} from '@/server/jobs/backoff';
import { replaceExternalBusyIntervals } from '@/server/calendar/repo';

export function calculateCalendarBackoffMs(attempt: number, randomFn?: () => number): number {
  return calculateBackoffDelayMs(attempt, {
    baseDelayMs: 30_000,
    maxDelayMs: 3_600_000,
    randomFn,
  });
}

export interface CalendarSyncBatchOptions {
  batchSize?: number;
  dbClient?: DbClient;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  actorType?: 'system' | 'owner';
  actorId?: string;
  forceInbound?: boolean;
}

export interface CalendarSyncBatchResult {
  batchSize: number;
  syncedCount: number;
  failedCount: number;
  durationMs: number;
  inboundBusyCount?: number;
}

/**
 * Fetches pending outbox items ready to process.
 */
export async function fetchPendingCalendarOutbox(
  batchSize = 20,
  client: DbClient = defaultDb,
): Promise<CalendarSyncOutboxItem[]> {
  const now = new Date();
  return client
    .select()
    .from(calendarSyncOutbox)
    .where(
      and(eq(calendarSyncOutbox.status, 'PENDING'), lte(calendarSyncOutbox.nextAttemptAt, now)),
    )
    .orderBy(calendarSyncOutbox.createdAt)
    .limit(batchSize);
}

/**
 * Marks outbox item as PROCESSING.
 */
export async function markCalendarOutboxProcessing(
  id: string,
  client: DbClient = defaultDb,
): Promise<void> {
  await client
    .update(calendarSyncOutbox)
    .set({
      status: 'PROCESSING',
      updatedAt: new Date(),
    })
    .where(eq(calendarSyncOutbox.id, id));
}

/**
 * Marks outbox item as COMPLETED.
 */
export async function markCalendarOutboxCompleted(
  id: string,
  client: DbClient = defaultDb,
): Promise<void> {
  await client
    .update(calendarSyncOutbox)
    .set({
      status: 'COMPLETED',
      updatedAt: new Date(),
    })
    .where(eq(calendarSyncOutbox.id, id));
}

/**
 * Handles outbox retry with exponential backoff on failure (AC-6).
 */
export async function handleCalendarOutboxRetry(
  item: CalendarSyncOutboxItem,
  errorMessage: string,
  client: DbClient = defaultDb,
): Promise<void> {
  const nextAttempts = item.attempts + 1;
  const isTerminal = isTerminalRetry(nextAttempts, item.maxAttempts);
  const nextAttemptAt = calculateNextAttemptDate(nextAttempts, {
    baseDelayMs: 30_000,
    maxDelayMs: 3_600_000,
  });

  await client
    .update(calendarSyncOutbox)
    .set({
      attempts: nextAttempts,
      status: isTerminal ? 'FAILED' : 'PENDING',
      nextAttemptAt,
      lastError: errorMessage.slice(0, 1000),
      updatedAt: new Date(),
    })
    .where(eq(calendarSyncOutbox.id, item.id));
}

/**
 * Executes inbound Google Calendar free/busy query for rolling window [-1 day, +60 days] (AC-5).
 */
export async function syncGoogleInboundFreeBusy(options: {
  calendarClient: GoogleCalendarClient;
  calendarId: string;
  dbClient?: DbClient;
  now?: Date;
}): Promise<number> {
  const dbClient = options.dbClient ?? defaultDb;
  const now = options.now ?? new Date();

  const minDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const maxDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const busyRanges = await options.calendarClient.queryFreeBusy(
    options.calendarId,
    minDate.toISOString(),
    maxDate.toISOString(),
  );

  const intervals = busyRanges.map((range) => ({
    startsAt: new Date(range.start),
    endsAt: new Date(range.end),
  }));

  await replaceExternalBusyIntervals('google', intervals, dbClient);
  return intervals.length;
}

/**
 * Executes inbound CalDAV busy intervals query for rolling window [-1 day, +60 days] (AC-4).
 */
export async function syncCaldavInboundFreeBusy(options: {
  caldavClient: CaldavClient;
  calendarUrl: string;
  dbClient?: DbClient;
  now?: Date;
}): Promise<number> {
  const dbClient = options.dbClient ?? defaultDb;
  const now = options.now ?? new Date();

  const minDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const maxDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const busyIntervals = await options.caldavClient.fetchBusyIntervals(options.calendarUrl, {
    start: minDate,
    end: maxDate,
  });

  const intervals = busyIntervals.map((inv) => ({
    startsAt: inv.startsAt,
    endsAt: inv.endsAt,
    externalId: inv.externalId,
  }));

  await replaceExternalBusyIntervals('caldav', intervals, dbClient);
  return intervals.length;
}

/**
 * Processes outbound synchronization from calendar_sync_outbox for Google Calendar and CalDAV (AC-3).
 */
export async function processCalendarSyncBatch(
  options: CalendarSyncBatchOptions = {},
): Promise<CalendarSyncBatchResult> {
  const startTime = Date.now();
  const dbClient = options.dbClient ?? defaultDb;
  const batchSize = options.batchSize ?? 20;

  // 1. Verify provider connectivity
  const tokenRecord = await getGoogleOAuthToken(dbClient);
  const hasCalendarScope = Boolean(tokenRecord && hasGoogleCalendarScope(tokenRecord.scope));
  const isGoogleEnabled = Boolean(tokenRecord?.calendarSyncEnabled && hasCalendarScope);

  const caldavAccount = await getCaldavAccount(dbClient);
  const isCaldavEnabled = Boolean(caldavAccount?.isActive && caldavAccount.selectedCalendarUrl);

  if (!isGoogleEnabled && !isCaldavEnabled) {
    if (tokenRecord?.calendarSyncEnabled && !hasCalendarScope) {
      logger.warn('Google Calendar sync is enabled but calendar.events scope is not granted');
    }
    return {
      batchSize: 0,
      syncedCount: 0,
      failedCount: 0,
      durationMs: Date.now() - startTime,
    };
  }

  // Setup Google Calendar client if enabled
  let googleCalendarClient: GoogleCalendarClient | null = null;
  let googleSelectedCalendarId = 'primary';
  if (isGoogleEnabled && tokenRecord) {
    googleSelectedCalendarId = tokenRecord.selectedCalendarId ?? 'primary';
    googleCalendarClient = new GoogleCalendarClient({
      fetchFn: options.fetchFn,
      timeoutMs: options.timeoutMs ?? 10_000,
      dbClient,
    });
  }

  // Setup CalDAV client if enabled
  let caldavClient: CaldavClient | null = null;
  let caldavCalendarUrl = '';
  if (isCaldavEnabled && caldavAccount?.selectedCalendarUrl) {
    caldavCalendarUrl = caldavAccount.selectedCalendarUrl;
    const isTest = process.env.NODE_ENV === 'test' || process.env.USE_PGLITE === 'true';
    const decryptedPassword = await decryptSecret(
      caldavAccount.encryptedPassword,
      'ownlight:vault:caldav',
    );
    caldavClient = new CaldavClient({
      serverUrl: caldavAccount.serverUrl,
      username: caldavAccount.username,
      password: decryptedPassword,
      fetchFn: options.fetchFn,
      timeoutMs: options.timeoutMs ?? 15_000,
      allowLoopback: isTest,
    });
  }

  // 2. Fetch studio name for summary formatting
  const [studio] = await dbClient.select().from(studioSettings).limit(1);
  const studioName = studio?.studio_name ?? 'Ownlight';

  // 3. Fetch pending outbox batch
  const batch = await fetchPendingCalendarOutbox(batchSize, dbClient);
  let syncedCount = 0;
  let failedCount = 0;

  for (const item of batch) {
    try {
      await markCalendarOutboxProcessing(item.id, dbClient);

      // Load entity data
      let appointmentData: typeof appointments.$inferSelect | null = null;
      let shootData: typeof shoots.$inferSelect | null = null;
      let shootProjectTitle: string | null = null;
      let blockedTimeData: typeof blockedTime.$inferSelect | null = null;

      if (item.entityType === 'appointment') {
        const [appt] = await dbClient
          .select()
          .from(appointments)
          .where(eq(appointments.id, item.entityId))
          .limit(1);
        appointmentData = appt ?? null;
      } else if (item.entityType === 'shoot') {
        const [sh] = await dbClient
          .select()
          .from(shoots)
          .where(eq(shoots.id, item.entityId))
          .limit(1);
        shootData = sh ?? null;
        if (shootData?.projectId) {
          const [proj] = await dbClient
            .select({ title: projects.title })
            .from(projects)
            .where(eq(projects.id, shootData.projectId))
            .limit(1);
          shootProjectTitle = proj?.title ?? null;
        }
      } else {
        const [bt] = await dbClient
          .select()
          .from(blockedTime)
          .where(eq(blockedTime.id, item.entityId))
          .limit(1);
        blockedTimeData = bt ?? null;
      }

      // If entity was deleted prior to processing and action is not delete, mark completed
      if (item.action !== 'delete') {
        if (
          (item.entityType === 'appointment' && !appointmentData) ||
          (item.entityType === 'shoot' && !shootData) ||
          (item.entityType === 'blocked_time' && !blockedTimeData)
        ) {
          await markCalendarOutboxCompleted(item.id, dbClient);
          continue;
        }
      }

      const isAppointmentCancelled =
        item.entityType === 'appointment' && appointmentData?.status === 'cancelled';

      // ------------------------------------------------------------------
      // A. Google Calendar Outbound Sync
      // ------------------------------------------------------------------
      if (isGoogleEnabled && googleCalendarClient) {
        const [existingGoogleLink] = await dbClient
          .select()
          .from(calendarSyncLinks)
          .where(
            and(
              eq(calendarSyncLinks.provider, 'google'),
              eq(calendarSyncLinks.entityType, item.entityType),
              eq(calendarSyncLinks.entityId, item.entityId),
            ),
          )
          .limit(1);

        if (item.action === 'delete' || isAppointmentCancelled) {
          if (existingGoogleLink) {
            try {
              await googleCalendarClient.deleteEvent(
                googleSelectedCalendarId,
                existingGoogleLink.externalEventId,
              );
            } catch (err) {
              if (
                err instanceof CalendarApiError &&
                (err.statusCode === 404 || err.statusCode === 410)
              ) {
                // Idempotent
              } else {
                throw err;
              }
            }
            await dbClient
              .delete(calendarSyncLinks)
              .where(eq(calendarSyncLinks.id, existingGoogleLink.id));
          }
        } else {
          // Create or update
          let eventPayload: GoogleCalendarEventPayload | null = null;
          let isGoogleMeet = false;

          if (item.entityType === 'appointment' && appointmentData) {
            isGoogleMeet = appointmentData.locationType === 'google_meet';
            const summary = formatCalendarEventSummary({
              studioName,
              entityType: 'appointment',
              title: appointmentData.title,
              attendeeName: appointmentData.attendeeName,
            });

            let description = `Studio Appointment: ${appointmentData.title}`;
            if (appointmentData.meetUrl) {
              description += `\nGoogle Meet: ${appointmentData.meetUrl}`;
            } else if (appointmentData.locationDetails) {
              description += `\nLocation: ${appointmentData.locationDetails}`;
            }

            eventPayload = {
              summary,
              description,
              start: {
                dateTime: appointmentData.startsAt.toISOString(),
                timeZone: appointmentData.timezone,
              },
              end: {
                dateTime: appointmentData.endsAt.toISOString(),
                timeZone: appointmentData.timezone,
              },
              location: appointmentData.locationDetails ?? undefined,
            };

            if (isGoogleMeet) {
              eventPayload.conferenceData = {
                createRequest: {
                  requestId: appointmentData.id,
                  conferenceSolutionKey: { type: 'hangoutsMeet' },
                },
              };
            }
          } else if (item.entityType === 'shoot' && shootData) {
            const summary = formatCalendarEventSummary({
              studioName,
              entityType: 'shoot',
              title: shootData.title,
            });
            const endsAt =
              shootData.endsAt ?? new Date(shootData.startsAt.getTime() + 60 * 60 * 1000);
            eventPayload = {
              summary,
              description: `Photography Shoot: ${shootData.title}`,
              start: { dateTime: shootData.startsAt.toISOString() },
              end: { dateTime: endsAt.toISOString() },
            };
          } else if (item.entityType === 'blocked_time' && blockedTimeData) {
            const summary = formatCalendarEventSummary({
              studioName,
              entityType: 'blocked_time',
              title: blockedTimeData.title,
            });
            eventPayload = {
              summary,
              description: 'Studio Blackout Interval',
              start: { dateTime: blockedTimeData.startsAt.toISOString() },
              end: { dateTime: blockedTimeData.endsAt.toISOString() },
            };
          }

          if (eventPayload) {
            let eventResult;
            if (existingGoogleLink) {
              eventResult = await googleCalendarClient.updateEvent(
                googleSelectedCalendarId,
                existingGoogleLink.externalEventId,
                eventPayload,
                { conferenceDataVersion: isGoogleMeet ? 1 : undefined },
              );
              await dbClient
                .update(calendarSyncLinks)
                .set({
                  etag: eventResult.etag ?? existingGoogleLink.etag,
                  syncedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(calendarSyncLinks.id, existingGoogleLink.id));
            } else {
              eventResult = await googleCalendarClient.insertEvent(
                googleSelectedCalendarId,
                eventPayload,
                { conferenceDataVersion: isGoogleMeet ? 1 : undefined },
              );
              await dbClient.insert(calendarSyncLinks).values({
                provider: 'google',
                entityType: item.entityType,
                entityId: item.entityId,
                externalEventId: eventResult.id,
                etag: eventResult.etag ?? null,
                syncedAt: new Date(),
              });
            }

            if (item.entityType === 'appointment' && eventResult.hangoutLink) {
              await dbClient
                .update(appointments)
                .set({
                  meetUrl: eventResult.hangoutLink,
                  updatedAt: new Date(),
                })
                .where(eq(appointments.id, item.entityId));
            }
          }
        }
      }

      // ------------------------------------------------------------------
      // B. CalDAV Outbound Sync (AC-3)
      // ------------------------------------------------------------------
      if (isCaldavEnabled && caldavClient && caldavCalendarUrl) {
        const [existingCaldavLink] = await dbClient
          .select()
          .from(calendarSyncLinks)
          .where(
            and(
              eq(calendarSyncLinks.provider, 'caldav'),
              eq(calendarSyncLinks.entityType, item.entityType),
              eq(calendarSyncLinks.entityId, item.entityId),
            ),
          )
          .limit(1);

        if (item.action === 'delete' || isAppointmentCancelled) {
          if (existingCaldavLink) {
            await caldavClient.deleteCalendarEvent(
              existingCaldavLink.externalEventId,
              existingCaldavLink.etag ?? undefined,
            );
            await dbClient
              .delete(calendarSyncLinks)
              .where(eq(calendarSyncLinks.id, existingCaldavLink.id));
          }
        } else {
          // Create or update CalDAV event
          let caldavInput: CaldavEventInput | null = null;

          if (item.entityType === 'appointment' && appointmentData) {
            caldavInput = {
              studioName,
              entityType: 'appointment',
              entity: {
                id: appointmentData.id,
                title: appointmentData.title,
                startsAt: appointmentData.startsAt,
                endsAt: appointmentData.endsAt,
                attendeeName: appointmentData.attendeeName,
                locationType: appointmentData.locationType,
                locationDetails: appointmentData.locationDetails,
                meetUrl: appointmentData.meetUrl,
                status: appointmentData.status,
              },
            };
          } else if (item.entityType === 'shoot' && shootData) {
            caldavInput = {
              studioName,
              entityType: 'shoot',
              entity: {
                id: shootData.id,
                title: shootData.title,
                startsAt: shootData.startsAt,
                endsAt: shootData.endsAt,
                projectTitle: shootProjectTitle,
              },
            };
          } else if (item.entityType === 'blocked_time' && blockedTimeData) {
            caldavInput = {
              studioName,
              entityType: 'blocked_time',
              entity: {
                id: blockedTimeData.id,
                title: blockedTimeData.title,
                startsAt: blockedTimeData.startsAt,
                endsAt: blockedTimeData.endsAt,
                allDay: blockedTimeData.allDay,
              },
            };
          }

          if (caldavInput) {
            if (existingCaldavLink) {
              const res = await caldavClient.updateCalendarEvent(
                existingCaldavLink.externalEventId,
                caldavInput,
                existingCaldavLink.etag ?? undefined,
              );
              await dbClient
                .update(calendarSyncLinks)
                .set({
                  etag: res.etag ?? existingCaldavLink.etag,
                  syncedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(calendarSyncLinks.id, existingCaldavLink.id));
            } else {
              const res = await caldavClient.createCalendarEvent(caldavCalendarUrl, caldavInput);
              await dbClient.insert(calendarSyncLinks).values({
                provider: 'caldav',
                entityType: item.entityType,
                entityId: item.entityId,
                externalEventId: res.url,
                etag: res.etag ?? null,
                syncedAt: new Date(),
              });
            }
          }
        }
      }

      await markCalendarOutboxCompleted(item.id, dbClient);
      syncedCount++;
    } catch (err) {
      failedCount++;
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn(
        {
          outboxId: item.id,
          entityType: item.entityType,
          action: item.action,
          error: errorMessage,
        },
        'Calendar sync outbox item failed',
      );
      await handleCalendarOutboxRetry(item, errorMessage, dbClient);
    }
  }

  // 4. Inbound free/busy sync (AC-4, AC-5)
  let inboundBusyCount = 0;

  if (isGoogleEnabled && googleCalendarClient) {
    try {
      const gCount = await syncGoogleInboundFreeBusy({
        calendarClient: googleCalendarClient,
        calendarId: googleSelectedCalendarId,
        dbClient,
      });
      inboundBusyCount += gCount;
      await updateGoogleCalendarSettings(
        {
          lastCalendarSyncAt: new Date(),
          lastCalendarSyncError: null,
        },
        dbClient,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn({ error: errorMsg }, 'Inbound Google free/busy sync failed');
      await updateGoogleCalendarSettings(
        {
          lastCalendarSyncError: errorMsg,
        },
        dbClient,
      );
    }
  }

  if (isCaldavEnabled && caldavClient && caldavAccount && caldavCalendarUrl) {
    try {
      const cCount = await syncCaldavInboundFreeBusy({
        caldavClient,
        calendarUrl: caldavCalendarUrl,
        dbClient,
      });
      inboundBusyCount += cCount;
      await updateCaldavAccountSyncStatus(
        caldavAccount.id,
        {
          lastSyncedAt: new Date(),
          lastSyncError: null,
        },
        dbClient,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn({ error: errorMsg }, 'Inbound CalDAV busy sync failed');
      await updateCaldavAccountSyncStatus(
        caldavAccount.id,
        {
          lastSyncError: errorMsg,
        },
        dbClient,
      );
    }
  }

  const durationMs = Date.now() - startTime;

  // 5. Emit audit events (calendar_sync.executed)
  if (isGoogleEnabled) {
    await audit(
      {
        actorType: options.actorType ?? 'system',
        actorId: options.actorId ?? 'calendar-sync-worker',
        action: 'calendar_sync.executed',
        targetType: 'integration',
        targetId: 'google',
        outcome: failedCount > 0 ? 'failure' : 'success',
        metadata: {
          provider: 'google',
          synced_count: syncedCount,
          failed_count: failedCount,
          duration_ms: durationMs,
        },
      },
      dbClient,
    );
  }

  if (isCaldavEnabled) {
    await audit(
      {
        actorType: options.actorType ?? 'system',
        actorId: options.actorId ?? 'calendar-sync-worker',
        action: 'calendar_sync.executed',
        targetType: 'integration',
        targetId: 'caldav',
        outcome: failedCount > 0 ? 'failure' : 'success',
        metadata: {
          provider: 'caldav',
          synced_count: syncedCount,
          failed_count: failedCount,
          duration_ms: durationMs,
        },
      },
      dbClient,
    );
  }

  return {
    batchSize: batch.length,
    syncedCount,
    failedCount,
    durationMs,
    inboundBusyCount,
  };
}

/**
 * Runner invoked by background worker jobs and manual trigger action.
 */
export async function runCalendarSyncWorker(
  options: CalendarSyncBatchOptions = {},
): Promise<CalendarSyncBatchResult> {
  return processCalendarSyncBatch(options);
}
