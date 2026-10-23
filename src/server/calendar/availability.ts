import { db as defaultDb, type DbClient } from '@/server/db/client';
import {
  findBookingTypeById,
  listAvailabilitySchedules,
  listAvailabilityOverridesInRange,
  listAppointmentsInRange,
  listBlockedTimeInRange,
  listShootsInRange,
  listExternalBusyIntervalsInRange,
} from './repo';

export interface CalculateAvailableSlotsParams {
  bookingTypeId: string;
  startDate: string; // 'YYYY-MM-DD'
  endDate: string; // 'YYYY-MM-DD'
  timezone: string; // Visitor IANA timezone, e.g. 'America/New_York'
  now?: Date;
  db?: DbClient;
  studioTimezone?: string;
  slotIntervalMinutes?: number;
  continuousSlots?: boolean;
}

export interface AvailableSlot {
  starts_at: string;
  ends_at: string;
  startsAt: string;
  endsAt: string;
  startsAtUtc: string;
  endsAtUtc: string;
  date: string;
  startTime: string;
  endTime: string;
  formattedStartTime: string;
  formattedEndTime: string;
  formattedDate: string;
  formattedTime: string;
}

/**
 * Normalizes a 24-hour hour string from Intl parts.
 */
function normalizeHour(hourStr: string): string {
  const h = Number(hourStr);
  if (h === 24) return '00';
  return String(h).padStart(2, '0');
}

/**
 * Formats a Date into an ISO 8601 string with explicit offset for the given timezone.
 * Example: 2026-10-26T04:00:00-04:00
 */
export function formatIsoWithTimezone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const year = partMap.year ?? '1970';
  const month = partMap.month ?? '01';
  const day = partMap.day ?? '01';
  const hour = normalizeHour(partMap.hour ?? '00');
  const minute = partMap.minute ?? '00';
  const second = partMap.second ?? '00';

  const targetUtcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );

  const offsetMinutes = Math.round((targetUtcMs - date.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const offsetMins = String(absOffset % 60).padStart(2, '0');
  const offsetStr = `${sign}${offsetHours}:${offsetMins}`;

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offsetStr}`;
}

/**
 * Formats local time (HH:MM) in target timezone.
 */
export function formatTimeInTimezone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const p of parts) partMap[p.type] = p.value;
  const hour = normalizeHour(partMap.hour ?? '00');
  const minute = partMap.minute ?? '00';
  return `${hour}:${minute}`;
}

/**
 * Formats date (YYYY-MM-DD) in target timezone.
 */
export function formatDateInTimezone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  let year = '';
  let month = '';
  let day = '';
  for (const p of parts) {
    if (p.type === 'year') year = p.value;
    else if (p.type === 'month') month = p.value;
    else if (p.type === 'day') day = p.value;
  }
  return `${year}-${month}-${day}`;
}

/**
 * Parses a local date string (YYYY-MM-DD) and time string (HH:MM) in studio timezone into UTC Date.
 */
export function parseStudioLocalDateTime(dateStr: string, timeStr: string, studioTz: string): Date {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const [hourStr, minuteStr] = timeStr.split(':');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: studioTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const getTzDiff = (ms: number) => {
    const parts = formatter.formatToParts(new Date(ms));
    const m: Record<string, string> = {};
    for (const p of parts) m[p.type] = p.value;
    const h = Number(normalizeHour(m.hour ?? '00'));
    const localMs = Date.UTC(
      Number(m.year),
      Number(m.month) - 1,
      Number(m.day),
      h,
      Number(m.minute),
      Number(m.second),
    );
    return localMs - ms;
  };

  const diff = getTzDiff(utcMs);
  utcMs -= diff;

  const secondDiff = getTzDiff(utcMs);
  if (secondDiff !== diff) {
    utcMs += diff - secondDiff;
  }

  return new Date(utcMs);
}

/**
 * Calculates open booking slots dynamically (TASK-0040 / ADR-0017 §2).
 */
export async function calculateAvailableSlots(
  params: CalculateAvailableSlotsParams,
): Promise<AvailableSlot[]> {
  const {
    bookingTypeId,
    startDate,
    endDate,
    timezone,
    now = new Date(),
    db = defaultDb,
    studioTimezone = 'Europe/Berlin',
    slotIntervalMinutes,
    continuousSlots = false,
  } = params;

  // 1. Fetch booking type
  const bookingType = await findBookingTypeById(bookingTypeId, db);
  if (!bookingType?.isActive) {
    return [];
  }

  const durationMs = bookingType.durationMinutes * 60 * 1000;
  const bufferBeforeMs = bookingType.bufferBeforeMinutes * 60 * 1000;
  const bufferAfterMs = bookingType.bufferAfterMinutes * 60 * 1000;

  // Step interval: if specified use it; else if continuousSlots step by duration + buffers;
  // else step by durationMinutes or 30 minutes if duration is a multiple of 30.
  const stepMs = slotIntervalMinutes
    ? slotIntervalMinutes * 60 * 1000
    : continuousSlots
      ? durationMs + bufferBeforeMs + bufferAfterMs
      : Math.min(30, bookingType.durationMinutes) * 60 * 1000;

  // Notice and future horizon cutoffs (AC-7)
  const nowMs = now.getTime();
  const earliestAllowedStartMs = nowMs + bookingType.minNoticeHours * 60 * 60 * 1000;
  const latestAllowedStartMs = nowMs + bookingType.maxFutureDays * 24 * 60 * 60 * 1000;

  // 2. Fetch schedules and overrides
  const schedules = await listAvailabilitySchedules(db);
  const overrides = await listAvailabilityOverridesInRange({ startDate, endDate }, db);

  const overrideMap = new Map<string, (typeof overrides)[0]>();
  for (const ov of overrides) {
    overrideMap.set(ov.date, ov);
  }

  const scheduleMap = new Map<number, (typeof schedules)[0]>();
  for (const sc of schedules) {
    scheduleMap.set(sc.dayOfWeek, sc);
  }

  // 3. Determine overall query range for collision checks
  // Extend by 1 day before and after to cover timezone boundary offsets
  const rangeStartUtc = parseStudioLocalDateTime(startDate, '00:00', studioTimezone);
  rangeStartUtc.setHours(rangeStartUtc.getHours() - 24);

  const rangeEndUtc = parseStudioLocalDateTime(endDate, '23:59', studioTimezone);
  rangeEndUtc.setHours(rangeEndUtc.getHours() + 24);

  // 4. Fetch colliding events (AC-5, AC-6)
  const [activeAppointments, activeBlockedTimes, activeShoots, externalBusy] = await Promise.all([
    listAppointmentsInRange(
      {
        startDate: rangeStartUtc,
        endDate: rangeEndUtc,
        status: 'scheduled',
      },
      db,
    ),
    listBlockedTimeInRange({ startDate: rangeStartUtc, endDate: rangeEndUtc }, db),
    listShootsInRange({ startDate: rangeStartUtc, endDate: rangeEndUtc }, db),
    listExternalBusyIntervalsInRange({ startDate: rangeStartUtc, endDate: rangeEndUtc }, db),
  ]);

  // Construct busy intervals list
  interface BusyInterval {
    startMs: number;
    endMs: number;
  }

  const busyIntervals: BusyInterval[] = [];

  // Appointments (AC-5)
  for (const app of activeAppointments) {
    busyIntervals.push({
      startMs: app.startsAt.getTime(),
      endMs: app.endsAt.getTime(),
    });
  }

  // Blocked time (AC-6)
  for (const bt of activeBlockedTimes) {
    busyIntervals.push({
      startMs: bt.startsAt.getTime(),
      endMs: bt.endsAt.getTime(),
    });
  }

  // Shoots (from E3) expanded with buffers
  for (const sh of activeShoots) {
    const shootStart = sh.startsAt.getTime() - bufferBeforeMs;
    const shootEnd =
      (sh.endsAt ? sh.endsAt.getTime() : sh.startsAt.getTime() + 60 * 60 * 1000) + bufferAfterMs;
    busyIntervals.push({
      startMs: shootStart,
      endMs: shootEnd,
    });
  }

  // External calendar busy intervals (Google Calendar / CalDAV sync - AC-5)
  for (const ext of externalBusy) {
    busyIntervals.push({
      startMs: ext.startsAt.getTime(),
      endMs: ext.endsAt.getTime(),
    });
  }

  // 5. Generate candidate slots per calendar date
  const availableSlots: AvailableSlot[] = [];

  const curDate = new Date(`${startDate}T12:00:00Z`);
  const stopDate = new Date(`${endDate}T12:00:00Z`);

  while (curDate <= stopDate) {
    const dateStr = curDate.toISOString().slice(0, 10);
    curDate.setUTCDate(curDate.getUTCDate() + 1);

    // Check date override (AC-9)
    const override = overrideMap.get(dateStr);
    let dayStartTime: string | null = null;
    let dayEndTime: string | null = null;

    if (override) {
      if (override.isUnavailable || (!override.startTime && !override.endTime)) {
        // Entire day is unavailable
        continue;
      }
      dayStartTime = override.startTime;
      dayEndTime = override.endTime;
    } else {
      // Parse day of week in studio timezone
      const testDate = parseStudioLocalDateTime(dateStr, '12:00', studioTimezone);
      const dayOfWeek = testDate.getUTCDay();
      const schedule = scheduleMap.get(dayOfWeek);
      if (!schedule?.isActive) {
        continue;
      }
      dayStartTime = schedule.startTime;
      dayEndTime = schedule.endTime;
    }

    if (!dayStartTime || !dayEndTime) {
      continue;
    }

    const windowStart = parseStudioLocalDateTime(dateStr, dayStartTime, studioTimezone);
    const windowEnd = parseStudioLocalDateTime(dateStr, dayEndTime, studioTimezone);

    let candStartMs = windowStart.getTime();
    const windowEndMs = windowEnd.getTime();

    while (candStartMs + durationMs <= windowEndMs) {
      const candEndMs = candStartMs + durationMs;

      // Check min_notice_hours and max_future_days (AC-7)
      if (candStartMs >= earliestAllowedStartMs && candStartMs <= latestAllowedStartMs) {
        // Check protected window with buffers (AC-5, AC-6)
        const protectedStartMs = candStartMs - bufferBeforeMs;
        const protectedEndMs = candEndMs + bufferAfterMs;

        // Verify collision against all busy intervals
        let isColliding = false;
        for (const busy of busyIntervals) {
          if (protectedStartMs < busy.endMs && protectedEndMs > busy.startMs) {
            isColliding = true;
            break;
          }
        }

        if (!isColliding) {
          const slotStart = new Date(candStartMs);
          const slotEnd = new Date(candEndMs);

          const startsAt = formatIsoWithTimezone(slotStart, timezone);
          const endsAt = formatIsoWithTimezone(slotEnd, timezone);
          const startTime = formatTimeInTimezone(slotStart, timezone);
          const endTime = formatTimeInTimezone(slotEnd, timezone);
          const formattedDate = formatDateInTimezone(slotStart, timezone);

          availableSlots.push({
            starts_at: startsAt,
            ends_at: endsAt,
            startsAt,
            endsAt,
            startsAtUtc: slotStart.toISOString(),
            endsAtUtc: slotEnd.toISOString(),
            date: formattedDate,
            startTime,
            endTime,
            formattedStartTime: startTime,
            formattedEndTime: endTime,
            formattedDate,
            formattedTime: `${startTime} - ${endTime}`,
          });
        }
      }

      candStartMs += stepMs;
    }
  }

  return availableSlots;
}
