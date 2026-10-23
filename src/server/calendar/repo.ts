import { eq, and, gte, lte, lt, gt, or, isNull, inArray, desc } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import {
  bookingTypes,
  appointments,
  blockedTime,
  availabilitySchedules,
  availabilityOverrides,
  calendarFeeds,
  externalCalendarBusyIntervals,
  type BookingType,
  type NewBookingType,
  type Appointment,
  type NewAppointment,
  type BlockedTime,
  type NewBlockedTime,
  type AvailabilitySchedule,
  type NewAvailabilitySchedule,
  type AvailabilityOverride,
  type NewAvailabilityOverride,
  type AppointmentStatus,
  type CalendarFeed,
  type NewCalendarFeed,
  type ExternalCalendarBusyInterval,
  type CalendarSyncProvider,
} from '@/server/db/schema/calendar';
import { shoots, projects, shootLocations } from '@/server/db/schema/projects';

// ==========================================
// Booking Types
// ==========================================

export async function findBookingTypeById(
  id: string,
  tx: DbClient = defaultDb,
): Promise<BookingType | null> {
  const [row] = await tx.select().from(bookingTypes).where(eq(bookingTypes.id, id)).limit(1);
  return row ?? null;
}

export async function findBookingTypeBySlug(
  slug: string,
  tx: DbClient = defaultDb,
): Promise<BookingType | null> {
  const [row] = await tx.select().from(bookingTypes).where(eq(bookingTypes.slug, slug)).limit(1);
  return row ?? null;
}

export async function listBookingTypes(
  includeInactive = false,
  tx: DbClient = defaultDb,
): Promise<BookingType[]> {
  if (includeInactive) {
    return tx.select().from(bookingTypes);
  }
  return tx.select().from(bookingTypes).where(eq(bookingTypes.isActive, true));
}

export async function insertBookingType(
  data: NewBookingType,
  tx: DbClient = defaultDb,
): Promise<BookingType> {
  const [row] = await tx.insert(bookingTypes).values(data).returning();
  if (!row) {
    throw new Error('Failed to insert booking type');
  }
  return row;
}

export async function updateBookingTypeRecord(
  id: string,
  data: Partial<NewBookingType>,
  tx: DbClient = defaultDb,
): Promise<BookingType | null> {
  const [row] = await tx
    .update(bookingTypes)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(bookingTypes.id, id))
    .returning();
  return row ?? null;
}

export async function deleteBookingTypeRecord(
  id: string,
  tx: DbClient = defaultDb,
): Promise<boolean> {
  const rows = await tx
    .delete(bookingTypes)
    .where(eq(bookingTypes.id, id))
    .returning({ id: bookingTypes.id });
  return rows.length > 0;
}

// ==========================================
// Appointments
// ==========================================

export async function findAppointmentById(
  id: string,
  tx: DbClient = defaultDb,
): Promise<Appointment | null> {
  const [row] = await tx.select().from(appointments).where(eq(appointments.id, id)).limit(1);
  return row ?? null;
}

export interface ListAppointmentsInRangeParams {
  startDate: Date;
  endDate: Date;
  clientId?: string;
  projectId?: string;
  leadId?: string;
  status?: AppointmentStatus;
}

export async function listAppointmentsInRange(
  params: ListAppointmentsInRangeParams,
  tx: DbClient = defaultDb,
): Promise<Appointment[]> {
  const conditions = [
    lt(appointments.startsAt, params.endDate),
    gt(appointments.endsAt, params.startDate),
  ];

  if (params.clientId) {
    conditions.push(eq(appointments.clientId, params.clientId));
  }
  if (params.projectId) {
    conditions.push(eq(appointments.projectId, params.projectId));
  }
  if (params.leadId) {
    conditions.push(eq(appointments.leadId, params.leadId));
  }
  if (params.status) {
    conditions.push(eq(appointments.status, params.status));
  }

  return tx
    .select()
    .from(appointments)
    .where(and(...conditions))
    .orderBy(appointments.startsAt);
}

export async function insertAppointment(
  data: NewAppointment,
  tx: DbClient = defaultDb,
): Promise<Appointment> {
  const [row] = await tx.insert(appointments).values(data).returning();
  if (!row) {
    throw new Error('Failed to insert appointment');
  }
  return row;
}

export async function updateAppointmentRecord(
  id: string,
  data: Partial<NewAppointment>,
  tx: DbClient = defaultDb,
): Promise<Appointment | null> {
  const [row] = await tx
    .update(appointments)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(appointments.id, id))
    .returning();
  return row ?? null;
}

export async function deleteAppointmentRecord(
  id: string,
  tx: DbClient = defaultDb,
): Promise<boolean> {
  const rows = await tx
    .delete(appointments)
    .where(eq(appointments.id, id))
    .returning({ id: appointments.id });
  return rows.length > 0;
}

// ==========================================
// Blocked Time
// ==========================================

export async function findBlockedTimeById(
  id: string,
  tx: DbClient = defaultDb,
): Promise<BlockedTime | null> {
  const [row] = await tx.select().from(blockedTime).where(eq(blockedTime.id, id)).limit(1);
  return row ?? null;
}

export interface ListBlockedTimeInRangeParams {
  startDate: Date;
  endDate: Date;
}

export async function listBlockedTimeInRange(
  params: ListBlockedTimeInRangeParams,
  tx: DbClient = defaultDb,
): Promise<BlockedTime[]> {
  return tx
    .select()
    .from(blockedTime)
    .where(and(lt(blockedTime.startsAt, params.endDate), gt(blockedTime.endsAt, params.startDate)))
    .orderBy(blockedTime.startsAt);
}

export async function insertBlockedTime(
  data: NewBlockedTime,
  tx: DbClient = defaultDb,
): Promise<BlockedTime> {
  const [row] = await tx.insert(blockedTime).values(data).returning();
  if (!row) throw new Error('Failed to insert blocked time');
  return row;
}

export async function updateBlockedTimeRecord(
  id: string,
  data: Partial<NewBlockedTime>,
  tx: DbClient = defaultDb,
): Promise<BlockedTime | null> {
  const [row] = await tx
    .update(blockedTime)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(blockedTime.id, id))
    .returning();
  return row ?? null;
}

export async function deleteBlockedTimeRecord(
  id: string,
  tx: DbClient = defaultDb,
): Promise<boolean> {
  const rows = await tx
    .delete(blockedTime)
    .where(eq(blockedTime.id, id))
    .returning({ id: blockedTime.id });
  return rows.length > 0;
}

// ==========================================
// Availability Schedules
// ==========================================

export async function listAvailabilitySchedules(
  tx: DbClient = defaultDb,
): Promise<AvailabilitySchedule[]> {
  return tx.select().from(availabilitySchedules).orderBy(availabilitySchedules.dayOfWeek);
}

export async function upsertAvailabilitySchedule(
  data: NewAvailabilitySchedule,
  tx: DbClient = defaultDb,
): Promise<AvailabilitySchedule> {
  const existing = await tx
    .select()
    .from(availabilitySchedules)
    .where(eq(availabilitySchedules.dayOfWeek, data.dayOfWeek))
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    const [updated] = await tx
      .update(availabilitySchedules)
      .set({
        startTime: data.startTime,
        endTime: data.endTime,
        isActive: data.isActive,
        updatedAt: new Date(),
      })
      .where(eq(availabilitySchedules.id, existing[0].id))
      .returning();
    if (!updated) throw new Error('Failed to update availability schedule');
    return updated;
  }

  const [inserted] = await tx.insert(availabilitySchedules).values(data).returning();
  if (!inserted) throw new Error('Failed to insert availability schedule');
  return inserted;
}

// ==========================================
// Availability Overrides
// ==========================================

export async function findAvailabilityOverrideById(
  id: string,
  tx: DbClient = defaultDb,
): Promise<AvailabilityOverride | null> {
  const [row] = await tx
    .select()
    .from(availabilityOverrides)
    .where(eq(availabilityOverrides.id, id))
    .limit(1);
  return row ?? null;
}

export interface ListAvailabilityOverridesInRangeParams {
  startDate: string;
  endDate: string;
}

export async function listAvailabilityOverridesInRange(
  params: ListAvailabilityOverridesInRangeParams,
  tx: DbClient = defaultDb,
): Promise<AvailabilityOverride[]> {
  return tx
    .select()
    .from(availabilityOverrides)
    .where(
      and(
        gte(availabilityOverrides.date, params.startDate),
        lte(availabilityOverrides.date, params.endDate),
      ),
    )
    .orderBy(availabilityOverrides.date);
}

export async function listAllAvailabilityOverrides(
  tx: DbClient = defaultDb,
): Promise<AvailabilityOverride[]> {
  return tx.select().from(availabilityOverrides).orderBy(availabilityOverrides.date);
}

export async function insertAvailabilityOverride(
  data: NewAvailabilityOverride,
  tx: DbClient = defaultDb,
): Promise<AvailabilityOverride> {
  const [row] = await tx.insert(availabilityOverrides).values(data).returning();
  if (!row) throw new Error('Failed to insert availability override');
  return row;
}

export async function deleteAvailabilityOverrideRecord(
  id: string,
  tx: DbClient = defaultDb,
): Promise<boolean> {
  const rows = await tx
    .delete(availabilityOverrides)
    .where(eq(availabilityOverrides.id, id))
    .returning({ id: availabilityOverrides.id });
  return rows.length > 0;
}

// ==========================================
// Shoots Collision Query
// ==========================================

export async function listShootsInRange(
  params: { startDate: Date; endDate: Date },
  tx: DbClient = defaultDb,
): Promise<{ id: string; startsAt: Date; endsAt: Date | null }[]> {
  return tx
    .select({
      id: shoots.id,
      startsAt: shoots.startsAt,
      endsAt: shoots.endsAt,
    })
    .from(shoots)
    .where(
      and(
        lt(shoots.startsAt, params.endDate),
        or(isNull(shoots.endsAt), gt(shoots.endsAt, params.startDate)),
      ),
    )
    .orderBy(shoots.startsAt);
}

export interface CalendarShootItem {
  id: string;
  projectId: string;
  projectTitle: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  timezone: string;
  locationName: string | null;
  notes: string | null;
}

export async function listShootsWithDetailsInRange(
  params: { startDate: Date; endDate: Date },
  tx: DbClient = defaultDb,
): Promise<CalendarShootItem[]> {
  const rows = await tx
    .select({
      id: shoots.id,
      projectId: shoots.projectId,
      projectTitle: projects.title,
      title: shoots.title,
      startsAt: shoots.startsAt,
      endsAt: shoots.endsAt,
      timezone: shoots.timezone,
      notes: shoots.notes,
    })
    .from(shoots)
    .innerJoin(projects, eq(shoots.projectId, projects.id))
    .where(
      and(
        lt(shoots.startsAt, params.endDate),
        or(isNull(shoots.endsAt), gt(shoots.endsAt, params.startDate)),
      ),
    )
    .orderBy(shoots.startsAt);

  if (rows.length === 0) {
    return [];
  }

  const shootIds = rows.map((r) => r.id);
  const locRows = await tx
    .select({
      shootId: shootLocations.shootId,
      name: shootLocations.name,
      order: shootLocations.order,
    })
    .from(shootLocations)
    .where(inArray(shootLocations.shootId, shootIds))
    .orderBy(shootLocations.order);

  const locationMap = new Map<string, string>();
  for (const loc of locRows) {
    if (!locationMap.has(loc.shootId)) {
      locationMap.set(loc.shootId, loc.name);
    }
  }

  return rows.map((r) => ({
    ...r,
    locationName: locationMap.get(r.id) ?? null,
  }));
}

// ==========================================
// Calendar Feeds (TASK-0045)
// ==========================================

export async function findCalendarFeedByTokenHash(
  tokenHash: string,
  tx: DbClient = defaultDb,
): Promise<CalendarFeed | null> {
  const [row] = await tx
    .select()
    .from(calendarFeeds)
    .where(
      and(
        eq(calendarFeeds.tokenHash, tokenHash),
        isNull(calendarFeeds.revokedAt),
        eq(calendarFeeds.isActive, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findCalendarFeedById(
  id: string,
  tx: DbClient = defaultDb,
): Promise<CalendarFeed | null> {
  const [row] = await tx.select().from(calendarFeeds).where(eq(calendarFeeds.id, id)).limit(1);
  return row ?? null;
}

export async function findActiveCalendarFeed(
  tx: DbClient = defaultDb,
): Promise<CalendarFeed | null> {
  const [row] = await tx
    .select()
    .from(calendarFeeds)
    .where(and(isNull(calendarFeeds.revokedAt), eq(calendarFeeds.isActive, true)))
    .orderBy(desc(calendarFeeds.createdAt))
    .limit(1);
  return row ?? null;
}

export async function insertCalendarFeed(
  data: NewCalendarFeed,
  tx: DbClient = defaultDb,
): Promise<CalendarFeed> {
  const [row] = await tx.insert(calendarFeeds).values(data).returning();
  if (!row) {
    throw new Error('Failed to insert calendar feed');
  }
  return row;
}

export async function updateCalendarFeedRecord(
  id: string,
  data: Partial<NewCalendarFeed>,
  tx: DbClient = defaultDb,
): Promise<CalendarFeed | null> {
  const [row] = await tx
    .update(calendarFeeds)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(calendarFeeds.id, id))
    .returning();
  return row ?? null;
}

export async function touchCalendarFeedLastAccessed(
  id: string,
  tx: DbClient = defaultDb,
): Promise<void> {
  await tx
    .update(calendarFeeds)
    .set({ lastAccessedAt: new Date() })
    .where(eq(calendarFeeds.id, id));
}

export async function revokeCalendarFeedRecord(
  id: string,
  tx: DbClient = defaultDb,
): Promise<CalendarFeed | null> {
  const [row] = await tx
    .update(calendarFeeds)
    .set({
      revokedAt: new Date(),
      isActive: false,
      updatedAt: new Date(),
    })
    .where(eq(calendarFeeds.id, id))
    .returning();
  return row ?? null;
}

// ==========================================
// External Calendar Busy Intervals (AC-5)
// ==========================================

export async function listExternalBusyIntervalsInRange(
  params: {
    startDate: Date;
    endDate: Date;
    provider?: CalendarSyncProvider;
  },
  tx: DbClient = defaultDb,
): Promise<ExternalCalendarBusyInterval[]> {
  const conditions = [
    lt(externalCalendarBusyIntervals.startsAt, params.endDate),
    gt(externalCalendarBusyIntervals.endsAt, params.startDate),
  ];

  if (params.provider) {
    conditions.push(eq(externalCalendarBusyIntervals.provider, params.provider));
  }

  return tx
    .select()
    .from(externalCalendarBusyIntervals)
    .where(and(...conditions));
}

export async function replaceExternalBusyIntervals(
  provider: CalendarSyncProvider,
  intervals: { startsAt: Date; endsAt: Date; externalId?: string }[],
  tx: DbClient = defaultDb,
): Promise<ExternalCalendarBusyInterval[]> {
  // Clear existing intervals for this provider
  await tx
    .delete(externalCalendarBusyIntervals)
    .where(eq(externalCalendarBusyIntervals.provider, provider));

  if (intervals.length === 0) {
    return [];
  }

  return tx
    .insert(externalCalendarBusyIntervals)
    .values(
      intervals.map((inv) => ({
        provider,
        startsAt: inv.startsAt,
        endsAt: inv.endsAt,
        externalId: inv.externalId ?? null,
      })),
    )
    .returning();
}

export async function clearExternalBusyIntervals(
  provider?: CalendarSyncProvider,
  tx: DbClient = defaultDb,
): Promise<void> {
  if (provider) {
    await tx
      .delete(externalCalendarBusyIntervals)
      .where(eq(externalCalendarBusyIntervals.provider, provider));
  } else {
    await tx.delete(externalCalendarBusyIntervals);
  }
}
