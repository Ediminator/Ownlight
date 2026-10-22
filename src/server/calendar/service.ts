import { generateUuidV7 } from '@/lib/id';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import type {
  BookingType,
  Appointment,
  BlockedTime,
  AvailabilitySchedule,
  AvailabilityOverride,
} from '@/server/db/schema/calendar';
import * as repo from './repo';
import {
  createBookingTypeSchema,
  updateBookingTypeSchema,
  createAppointmentSchema,
  updateAppointmentSchema,
  cancelAppointmentSchema,
  createBlockedTimeSchema,
  updateBlockedTimeSchema,
  updateAvailabilitySchedulesSchema,
  createAvailabilityOverrideSchema,
  type CreateBookingTypeInput,
  type UpdateBookingTypeInput,
  type CreateAppointmentInput,
  type UpdateAppointmentInput,
  type CancelAppointmentInput,
  type CreateBlockedTimeInput,
  type UpdateBlockedTimeInput,
  type UpdateAvailabilitySchedulesInput,
  type CreateAvailabilityOverrideInput,
} from './schema';
import { recordTimelineEvent } from '@/server/timeline/service';
import { audit } from '@/server/audit';

export type CalendarServiceResult<T> =
  | { success: true; data: T; code?: never; error?: never; fields?: never }
  | {
      success: false;
      code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL_ERROR';
      error: string;
      fields?: string[];
    };

// ==========================================
// Booking Types
// ==========================================

export async function createBookingType(
  rawInput: CreateBookingTypeInput,
  actorId = 'system',
  tx: DbClient = defaultDb,
): Promise<CalendarServiceResult<BookingType>> {
  const parsed = createBookingTypeSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues[0]?.message ?? 'Invalid booking type data',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  const input = parsed.data;
  const existing = await repo.findBookingTypeBySlug(input.slug, tx);
  if (existing) {
    return {
      success: false,
      code: 'CONFLICT',
      error: `Booking type with slug "${input.slug}" already exists.`,
      fields: ['slug'],
    };
  }

  const id = generateUuidV7();
  const now = new Date();

  const record = await repo.insertBookingType(
    {
      id,
      slug: input.slug,
      title: input.title,
      description: input.description ?? null,
      durationMinutes: input.durationMinutes,
      bufferBeforeMinutes: input.bufferBeforeMinutes,
      bufferAfterMinutes: input.bufferAfterMinutes,
      minNoticeHours: input.minNoticeHours,
      maxFutureDays: input.maxFutureDays,
      locationType: input.locationType,
      locationDetails: input.locationDetails ?? null,
      color: input.color,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    },
    tx,
  );

  await audit(
    {
      action: 'booking_type.created',
      actorType: 'owner',
      actorId,
      targetType: 'booking_type',
      targetId: id,
      outcome: 'success',
      metadata: {
        booking_type_id: id,
        slug: record.slug,
        duration_minutes: record.durationMinutes,
      },
    },
    tx,
  );

  return { success: true, data: record };
}

export async function updateBookingType(
  id: string,
  rawInput: UpdateBookingTypeInput,
  actorId = 'system',
  tx: DbClient = defaultDb,
): Promise<CalendarServiceResult<BookingType>> {
  const parsed = updateBookingTypeSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues[0]?.message ?? 'Invalid booking type update',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  const existing = await repo.findBookingTypeById(id, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Booking type not found',
      fields: ['id'],
    };
  }

  if (parsed.data.slug && parsed.data.slug !== existing.slug) {
    const conflict = await repo.findBookingTypeBySlug(parsed.data.slug, tx);
    if (conflict) {
      return {
        success: false,
        code: 'CONFLICT',
        error: `Booking type with slug "${parsed.data.slug}" already exists.`,
        fields: ['slug'],
      };
    }
  }

  const updated = await repo.updateBookingTypeRecord(id, parsed.data, tx);
  if (!updated) {
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: 'Failed to update booking type',
    };
  }

  await audit(
    {
      action: 'booking_type.updated',
      actorType: 'owner',
      actorId,
      targetType: 'booking_type',
      targetId: id,
      outcome: 'success',
      metadata: {
        booking_type_id: id,
        changed_fields: Object.keys(parsed.data),
      },
    },
    tx,
  );

  return { success: true, data: updated };
}

export async function deleteBookingType(
  id: string,
  actorId = 'system',
  tx: DbClient = defaultDb,
): Promise<CalendarServiceResult<{ id: string }>> {
  const existing = await repo.findBookingTypeById(id, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Booking type not found',
      fields: ['id'],
    };
  }

  await repo.deleteBookingTypeRecord(id, tx);

  await audit(
    {
      action: 'booking_type.deleted',
      actorType: 'owner',
      actorId,
      targetType: 'booking_type',
      targetId: id,
      outcome: 'success',
      metadata: {
        booking_type_id: id,
      },
    },
    tx,
  );

  return { success: true, data: { id } };
}

export async function getBookingTypeById(
  id: string,
  tx: DbClient = defaultDb,
): Promise<BookingType | null> {
  return repo.findBookingTypeById(id, tx);
}

export async function getBookingTypeBySlug(
  slug: string,
  tx: DbClient = defaultDb,
): Promise<BookingType | null> {
  return repo.findBookingTypeBySlug(slug, tx);
}

export async function getBookingTypes(
  includeInactive = false,
  tx: DbClient = defaultDb,
): Promise<BookingType[]> {
  return repo.listBookingTypes(includeInactive, tx);
}

// ==========================================
// Appointments
// ==========================================

export async function createAppointment(
  rawInput: CreateAppointmentInput,
  actorId = 'system',
  tx: DbClient = defaultDb,
): Promise<CalendarServiceResult<Appointment>> {
  const parsed = createAppointmentSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues[0]?.message ?? 'Invalid appointment data',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  const input = parsed.data;
  const id = generateUuidV7();
  const now = new Date();

  const record = await repo.insertAppointment(
    {
      id,
      bookingTypeId: input.bookingTypeId ?? null,
      clientId: input.clientId ?? null,
      projectId: input.projectId ?? null,
      leadId: input.leadId ?? null,
      title: input.title,
      status: input.status,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
      attendeeName: input.attendeeName,
      attendeeEmail: input.attendeeEmail,
      attendeePhone: input.attendeePhone ?? null,
      attendeeNotes: input.attendeeNotes ?? null,
      locationType: input.locationType,
      locationDetails: input.locationDetails ?? null,
      meetUrl: input.meetUrl ?? null,
      cancellationReason: input.cancellationReason ?? null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    },
    tx,
  );

  // If associated with a client, record timeline event (AC-11)
  if (record.clientId) {
    await recordTimelineEvent(tx, {
      clientId: record.clientId,
      type: 'appointment.scheduled',
      occurredAt: now,
      actorType: 'owner',
      actorId,
      subjectType: 'appointment',
      subjectId: id,
      data: {
        appointment_id: id,
        starts_at: record.startsAt.toISOString(),
        location_type: record.locationType,
      },
    });
  }

  // Audit event (AC-10)
  await audit(
    {
      action: 'appointment.created',
      actorType: 'owner',
      actorId,
      targetType: 'appointment',
      targetId: id,
      outcome: 'success',
      metadata: {
        appointment_id: id,
        booking_type_id: record.bookingTypeId ?? null,
        starts_at: record.startsAt.toISOString(),
        location_type: record.locationType,
        client_id: record.clientId ?? null,
        lead_id: record.leadId ?? null,
      },
    },
    tx,
  );

  return { success: true, data: record };
}

export async function updateAppointment(
  id: string,
  rawInput: UpdateAppointmentInput,
  actorId = 'system',
  tx: DbClient = defaultDb,
): Promise<CalendarServiceResult<Appointment>> {
  const parsed = updateAppointmentSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues[0]?.message ?? 'Invalid appointment update',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  const existing = await repo.findAppointmentById(id, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Appointment not found',
      fields: ['id'],
    };
  }

  const updated = await repo.updateAppointmentRecord(id, parsed.data, tx);
  if (!updated) {
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: 'Failed to update appointment',
    };
  }

  await audit(
    {
      action: 'appointment.updated',
      actorType: 'owner',
      actorId,
      targetType: 'appointment',
      targetId: id,
      outcome: 'success',
      metadata: {
        appointment_id: id,
        changed_fields: Object.keys(parsed.data),
      },
    },
    tx,
  );

  return { success: true, data: updated };
}

export async function cancelAppointment(
  id: string,
  rawInput: CancelAppointmentInput = {},
  actorId = 'system',
  tx: DbClient = defaultDb,
): Promise<CalendarServiceResult<Appointment>> {
  const parsed = cancelAppointmentSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues[0]?.message ?? 'Invalid cancellation input',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  const existing = await repo.findAppointmentById(id, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Appointment not found',
      fields: ['id'],
    };
  }

  const now = new Date();
  const reason = parsed.data.reason ?? 'Cancelled by studio';

  const updated = await repo.updateAppointmentRecord(
    id,
    {
      status: 'cancelled',
      cancellationReason: reason,
      cancelledAt: now,
    },
    tx,
  );

  if (!updated) {
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: 'Failed to cancel appointment',
    };
  }

  if (updated.clientId) {
    await recordTimelineEvent(tx, {
      clientId: updated.clientId,
      type: 'appointment.cancelled',
      occurredAt: now,
      actorType: 'owner',
      actorId,
      subjectType: 'appointment',
      subjectId: id,
      data: {
        appointment_id: id,
        reason,
      },
    });
  }

  await audit(
    {
      action: 'appointment.cancelled',
      actorType: 'owner',
      actorId,
      targetType: 'appointment',
      targetId: id,
      outcome: 'success',
      metadata: {
        appointment_id: id,
        reason,
      },
    },
    tx,
  );

  return { success: true, data: updated };
}

export async function getAppointmentById(
  id: string,
  tx: DbClient = defaultDb,
): Promise<Appointment | null> {
  return repo.findAppointmentById(id, tx);
}

export async function getAppointmentsInRange(
  params: repo.ListAppointmentsInRangeParams,
  tx: DbClient = defaultDb,
): Promise<Appointment[]> {
  return repo.listAppointmentsInRange(params, tx);
}

// ==========================================
// Blocked Time
// ==========================================

export async function createBlockedTime(
  rawInput: CreateBlockedTimeInput,
  actorId = 'system',
  tx: DbClient = defaultDb,
): Promise<CalendarServiceResult<BlockedTime>> {
  const parsed = createBlockedTimeSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues[0]?.message ?? 'Invalid blocked time data',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  const input = parsed.data;
  const id = generateUuidV7();
  const now = new Date();

  const record = await repo.insertBlockedTime(
    {
      id,
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      allDay: input.allDay,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    },
    tx,
  );

  await audit(
    {
      action: 'blocked_time.created',
      actorType: 'owner',
      actorId,
      targetType: 'blocked_time',
      targetId: id,
      outcome: 'success',
      metadata: {
        blocked_time_id: id,
        starts_at: record.startsAt.toISOString(),
        ends_at: record.endsAt.toISOString(),
        all_day: record.allDay,
      },
    },
    tx,
  );

  return { success: true, data: record };
}

export async function updateBlockedTime(
  id: string,
  rawInput: UpdateBlockedTimeInput,
  actorId = 'system',
  tx: DbClient = defaultDb,
): Promise<CalendarServiceResult<BlockedTime>> {
  const parsed = updateBlockedTimeSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues[0]?.message ?? 'Invalid blocked time update',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  const existing = await repo.findBlockedTimeById(id, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Blocked time record not found',
      fields: ['id'],
    };
  }

  const updated = await repo.updateBlockedTimeRecord(id, parsed.data, tx);
  if (!updated) {
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: 'Failed to update blocked time',
    };
  }

  await audit(
    {
      action: 'blocked_time.updated',
      actorType: 'owner',
      actorId,
      targetType: 'blocked_time',
      targetId: id,
      outcome: 'success',
      metadata: {
        blocked_time_id: id,
        changed_fields: Object.keys(parsed.data),
      },
    },
    tx,
  );

  return { success: true, data: updated };
}

export async function deleteBlockedTime(
  id: string,
  actorId = 'system',
  tx: DbClient = defaultDb,
): Promise<CalendarServiceResult<{ id: string }>> {
  const existing = await repo.findBlockedTimeById(id, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Blocked time record not found',
      fields: ['id'],
    };
  }

  await repo.deleteBlockedTimeRecord(id, tx);

  await audit(
    {
      action: 'blocked_time.deleted',
      actorType: 'owner',
      actorId,
      targetType: 'blocked_time',
      targetId: id,
      outcome: 'success',
      metadata: {
        blocked_time_id: id,
      },
    },
    tx,
  );

  return { success: true, data: { id } };
}

export async function getBlockedTimeById(
  id: string,
  tx: DbClient = defaultDb,
): Promise<BlockedTime | null> {
  return repo.findBlockedTimeById(id, tx);
}

export async function getBlockedTimeInRange(
  params: repo.ListBlockedTimeInRangeParams,
  tx: DbClient = defaultDb,
): Promise<BlockedTime[]> {
  return repo.listBlockedTimeInRange(params, tx);
}

// ==========================================
// Availability Schedules & Overrides
// ==========================================

export async function getAvailabilitySchedules(
  tx: DbClient = defaultDb,
): Promise<AvailabilitySchedule[]> {
  return repo.listAvailabilitySchedules(tx);
}

export async function updateAvailabilitySchedules(
  rawInput: UpdateAvailabilitySchedulesInput,
  actorId = 'system',
  tx: DbClient = defaultDb,
): Promise<CalendarServiceResult<AvailabilitySchedule[]>> {
  const parsed = updateAvailabilitySchedulesSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues[0]?.message ?? 'Invalid availability schedules',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  const results: AvailabilitySchedule[] = [];
  for (const item of parsed.data.schedules) {
    const updated = await repo.upsertAvailabilitySchedule(
      {
        id: generateUuidV7(),
        dayOfWeek: item.dayOfWeek,
        startTime: item.startTime,
        endTime: item.endTime,
        isActive: item.isActive,
      },
      tx,
    );
    results.push(updated);
  }

  await audit(
    {
      action: 'availability.updated',
      actorType: 'owner',
      actorId,
      targetType: 'availability',
      targetId: 'schedules',
      outcome: 'success',
      metadata: {
        schedule_count: results.length,
        override_count: 0,
      },
    },
    tx,
  );

  return { success: true, data: results };
}

export async function getAvailabilityOverrides(
  params: repo.ListAvailabilityOverridesInRangeParams,
  tx: DbClient = defaultDb,
): Promise<AvailabilityOverride[]> {
  return repo.listAvailabilityOverridesInRange(params, tx);
}

export async function getAllAvailabilityOverrides(
  tx: DbClient = defaultDb,
): Promise<AvailabilityOverride[]> {
  return repo.listAllAvailabilityOverrides(tx);
}

export async function createAvailabilityOverride(
  rawInput: CreateAvailabilityOverrideInput,
  actorId = 'system',
  tx: DbClient = defaultDb,
): Promise<CalendarServiceResult<AvailabilityOverride>> {
  const parsed = createAvailabilityOverrideSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues[0]?.message ?? 'Invalid availability override',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  const input = parsed.data;
  const id = generateUuidV7();
  const now = new Date();

  const record = await repo.insertAvailabilityOverride(
    {
      id,
      date: input.date,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      isUnavailable: input.isUnavailable,
      reason: input.reason ?? null,
      createdAt: now,
      updatedAt: now,
    },
    tx,
  );

  await audit(
    {
      action: 'availability.updated',
      actorType: 'owner',
      actorId,
      targetType: 'availability',
      targetId: id,
      outcome: 'success',
      metadata: {
        schedule_count: 0,
        override_count: 1,
      },
    },
    tx,
  );

  return { success: true, data: record };
}

export async function deleteAvailabilityOverride(
  id: string,
  actorId = 'system',
  tx: DbClient = defaultDb,
): Promise<CalendarServiceResult<{ id: string }>> {
  const existing = await repo.findAvailabilityOverrideById(id, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Availability override not found',
      fields: ['id'],
    };
  }

  await repo.deleteAvailabilityOverrideRecord(id, tx);

  await audit(
    {
      action: 'availability.updated',
      actorType: 'owner',
      actorId,
      targetType: 'availability',
      targetId: id,
      outcome: 'success',
      metadata: {
        schedule_count: 0,
        override_count: 1,
      },
    },
    tx,
  );

  return { success: true, data: { id } };
}

// ==========================================
// Unified Calendar Events Query (TASK-0042)
// ==========================================

export type CalendarEventType = 'shoot' | 'appointment' | 'blocked_time';

export interface UnifiedCalendarEvent {
  id: string;
  type: CalendarEventType;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timezone: string;
  status?: string;
  projectId?: string;
  projectTitle?: string;
  locationName?: string | null;
  attendeeName?: string;
  attendeeEmail?: string;
  attendeePhone?: string | null;
  locationType?: string;
  locationDetails?: string | null;
  meetUrl?: string | null;
  cancellationReason?: string | null;
  clientId?: string | null;
  projectId_appt?: string | null;
  leadId?: string | null;
  bookingTypeId?: string | null;
  notes?: string | null;
}

export interface GetUnifiedCalendarEventsParams {
  startDate: Date;
  endDate: Date;
  includeCancelled?: boolean;
}

export async function getUnifiedCalendarEvents(
  params: GetUnifiedCalendarEventsParams,
  tx: DbClient = defaultDb,
): Promise<UnifiedCalendarEvent[]> {
  const [shoots, appointments, blockedTimes] = await Promise.all([
    repo.listShootsWithDetailsInRange({ startDate: params.startDate, endDate: params.endDate }, tx),
    repo.listAppointmentsInRange({ startDate: params.startDate, endDate: params.endDate }, tx),
    repo.listBlockedTimeInRange({ startDate: params.startDate, endDate: params.endDate }, tx),
  ]);

  const events: UnifiedCalendarEvent[] = [];

  // Shoots
  for (const s of shoots) {
    const ends = s.endsAt ?? new Date(s.startsAt.getTime() + 60 * 60 * 1000);
    events.push({
      id: s.id,
      type: 'shoot',
      title: s.title,
      startsAt: s.startsAt.toISOString(),
      endsAt: ends.toISOString(),
      allDay: false,
      timezone: s.timezone,
      projectId: s.projectId,
      projectTitle: s.projectTitle,
      locationName: s.locationName,
      notes: s.notes,
    });
  }

  // Appointments
  for (const a of appointments) {
    if (!params.includeCancelled && a.status === 'cancelled') {
      continue;
    }
    events.push({
      id: a.id,
      type: 'appointment',
      title: a.title,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      allDay: false,
      timezone: a.timezone,
      status: a.status,
      attendeeName: a.attendeeName,
      attendeeEmail: a.attendeeEmail,
      attendeePhone: a.attendeePhone,
      locationType: a.locationType,
      locationDetails: a.locationDetails,
      meetUrl: a.meetUrl,
      cancellationReason: a.cancellationReason,
      clientId: a.clientId,
      projectId: a.projectId ?? undefined,
      leadId: a.leadId,
      bookingTypeId: a.bookingTypeId,
      notes: a.attendeeNotes,
    });
  }

  // Blocked Times
  for (const b of blockedTimes) {
    events.push({
      id: b.id,
      type: 'blocked_time',
      title: b.title,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      allDay: b.allDay,
      timezone: 'Europe/Berlin',
      notes: b.notes,
    });
  }

  // Sort events chronologically by startsAt
  events.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  return events;
}
