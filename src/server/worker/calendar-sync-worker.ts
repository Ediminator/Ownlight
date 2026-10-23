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
import { shoots } from '@/server/db/schema/projects';
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
import { GOOGLE_CALENDAR_SCOPE } from '@/server/integrations/google/constants';
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
 * Processes outbound Google Calendar synchronization from calendar_sync_outbox (AC-2, AC-3, AC-4, AC-6).
 */
export async function processCalendarSyncBatch(
  options: CalendarSyncBatchOptions = {},
): Promise<CalendarSyncBatchResult> {
  const startTime = Date.now();
  const dbClient = options.dbClient ?? defaultDb;
  const batchSize = options.batchSize ?? 20;

  // 1. Verify Google Calendar connection and authorization
  const tokenRecord = await getGoogleOAuthToken(dbClient);
  if (!tokenRecord?.calendarSyncEnabled) {
    return {
      batchSize: 0,
      syncedCount: 0,
      failedCount: 0,
      durationMs: Date.now() - startTime,
    };
  }

  const hasCalendarScope =
    Boolean(tokenRecord.scope) &&
    (tokenRecord.scope.includes(GOOGLE_CALENDAR_SCOPE) ||
      tokenRecord.scope.includes('https://www.googleapis.com/auth/calendar'));

  if (!hasCalendarScope) {
    logger.warn('Google Calendar sync is enabled but calendar.events scope is not granted');
    return {
      batchSize: 0,
      syncedCount: 0,
      failedCount: 0,
      durationMs: Date.now() - startTime,
    };
  }

  const selectedCalendarId = tokenRecord.selectedCalendarId ?? 'primary';
  const calendarClient = new GoogleCalendarClient({
    fetchFn: options.fetchFn,
    timeoutMs: options.timeoutMs ?? 10_000,
    dbClient,
  });

  // 2. Fetch studio name for summary formatting (Decision D6)
  const [studio] = await dbClient.select().from(studioSettings).limit(1);
  const studioName = studio?.studio_name ?? 'Ownlight';

  // 3. Fetch pending outbox batch
  const batch = await fetchPendingCalendarOutbox(batchSize, dbClient);
  let syncedCount = 0;
  let failedCount = 0;

  for (const item of batch) {
    try {
      await markCalendarOutboxProcessing(item.id, dbClient);

      // Check existing sync link
      const [existingLink] = await dbClient
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

      if (item.action === 'delete') {
        if (existingLink) {
          try {
            await calendarClient.deleteEvent(selectedCalendarId, existingLink.externalEventId);
          } catch (err) {
            // If event is already deleted (404/410), ignore
            if (
              err instanceof CalendarApiError &&
              (err.statusCode === 404 || err.statusCode === 410)
            ) {
              // Idempotent
            } else {
              throw err;
            }
          }
          await dbClient.delete(calendarSyncLinks).where(eq(calendarSyncLinks.id, existingLink.id));
        }
        await markCalendarOutboxCompleted(item.id, dbClient);
        syncedCount++;
        continue;
      }

      // Handle 'create' and 'update'
      let eventPayload: GoogleCalendarEventPayload | null = null;
      let isGoogleMeet = false;

      if (item.entityType === 'appointment') {
        const [appointment] = await dbClient
          .select()
          .from(appointments)
          .where(eq(appointments.id, item.entityId))
          .limit(1);

        if (!appointment) {
          // Appointment was deleted before sync: mark completed
          await markCalendarOutboxCompleted(item.id, dbClient);
          continue;
        }

        if (appointment.status === 'cancelled') {
          // If appointment was cancelled, delete from external calendar if linked
          if (existingLink) {
            try {
              await calendarClient.deleteEvent(selectedCalendarId, existingLink.externalEventId);
            } catch {
              // ignore 404
            }
            await dbClient
              .delete(calendarSyncLinks)
              .where(eq(calendarSyncLinks.id, existingLink.id));
          }
          await markCalendarOutboxCompleted(item.id, dbClient);
          syncedCount++;
          continue;
        }

        isGoogleMeet = appointment.locationType === 'google_meet';

        // PII minimization: format title as [Studio] - Consultation: Robert S. (AC-4)
        const summary = formatCalendarEventSummary({
          studioName,
          entityType: 'appointment',
          title: appointment.title,
          attendeeName: appointment.attendeeName,
        });

        // Omit attendee notes and phone numbers (AC-4)
        let description = `Studio Appointment: ${appointment.title}`;
        if (appointment.meetUrl) {
          description += `\nGoogle Meet: ${appointment.meetUrl}`;
        } else if (appointment.locationDetails) {
          description += `\nLocation: ${appointment.locationDetails}`;
        }

        eventPayload = {
          summary,
          description,
          start: {
            dateTime: appointment.startsAt.toISOString(),
            timeZone: appointment.timezone,
          },
          end: {
            dateTime: appointment.endsAt.toISOString(),
            timeZone: appointment.timezone,
          },
          location: appointment.locationDetails ?? undefined,
        };

        // Add Google Meet conferenceData request if location_type === 'google_meet' (AC-2)
        if (isGoogleMeet) {
          eventPayload.conferenceData = {
            createRequest: {
              requestId: appointment.id,
              conferenceSolutionKey: {
                type: 'hangoutsMeet',
              },
            },
          };
        }
      } else if (item.entityType === 'shoot') {
        const [shoot] = await dbClient
          .select()
          .from(shoots)
          .where(eq(shoots.id, item.entityId))
          .limit(1);

        if (!shoot) {
          await markCalendarOutboxCompleted(item.id, dbClient);
          continue;
        }

        const summary = formatCalendarEventSummary({
          studioName,
          entityType: 'shoot',
          title: shoot.title,
        });

        const endsAt = shoot.endsAt ?? new Date(shoot.startsAt.getTime() + 60 * 60 * 1000);

        eventPayload = {
          summary,
          description: `Photography Shoot: ${shoot.title}`,
          start: {
            dateTime: shoot.startsAt.toISOString(),
          },
          end: {
            dateTime: endsAt.toISOString(),
          },
        };
      } else {
        const [bt] = await dbClient
          .select()
          .from(blockedTime)
          .where(eq(blockedTime.id, item.entityId))
          .limit(1);

        if (!bt) {
          await markCalendarOutboxCompleted(item.id, dbClient);
          continue;
        }

        const summary = formatCalendarEventSummary({
          studioName,
          entityType: 'blocked_time',
          title: bt.title,
        });

        eventPayload = {
          summary,
          description: 'Studio Blackout Interval',
          start: {
            dateTime: bt.startsAt.toISOString(),
          },
          end: {
            dateTime: bt.endsAt.toISOString(),
          },
        };
      }

      // Call Google Calendar API
      let eventResult;
      if (existingLink) {
        eventResult = await calendarClient.updateEvent(
          selectedCalendarId,
          existingLink.externalEventId,
          eventPayload,
          { conferenceDataVersion: isGoogleMeet ? 1 : undefined },
        );
        await dbClient
          .update(calendarSyncLinks)
          .set({
            etag: eventResult.etag ?? existingLink.etag,
            syncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(calendarSyncLinks.id, existingLink.id));
      } else {
        eventResult = await calendarClient.insertEvent(selectedCalendarId, eventPayload, {
          conferenceDataVersion: isGoogleMeet ? 1 : undefined,
        });
        await dbClient.insert(calendarSyncLinks).values({
          provider: 'google',
          entityType: item.entityType,
          entityId: item.entityId,
          externalEventId: eventResult.id,
          etag: eventResult.etag ?? null,
          syncedAt: new Date(),
        });
      }

      // If Google Meet URL was returned, update appointment.meetUrl (AC-2)
      if (item.entityType === 'appointment' && eventResult.hangoutLink) {
        await dbClient
          .update(appointments)
          .set({
            meetUrl: eventResult.hangoutLink,
            updatedAt: new Date(),
          })
          .where(eq(appointments.id, item.entityId));
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

  // 4. Inbound free/busy query (AC-5)
  let inboundBusyCount = 0;
  try {
    inboundBusyCount = await syncGoogleInboundFreeBusy({
      calendarClient,
      calendarId: selectedCalendarId,
      dbClient,
    });
    // Update last sync timestamp on token record
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

  const durationMs = Date.now() - startTime;

  // 5. Emit audit event: calendar_sync.executed (AC-3)
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
