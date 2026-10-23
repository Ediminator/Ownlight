import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  text,
  timestamp,
  index,
  unique,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';
import { generateUuidV7 } from '@/lib/id';
import { clients } from './clients';
import { leads } from './leads';
import { projects } from './projects';

export const BOOKING_LOCATION_TYPES = ['in_person', 'phone', 'google_meet'] as const;
export type BookingLocationType = (typeof BOOKING_LOCATION_TYPES)[number];

export const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const CALENDAR_FEED_SUMMARY_LEVELS = ['minimal', 'standard', 'full'] as const;
export type CalendarFeedSummaryLevel = (typeof CALENDAR_FEED_SUMMARY_LEVELS)[number];

export const CALENDAR_SYNC_ENTITY_TYPES = ['shoot', 'appointment', 'blocked_time'] as const;
export type CalendarSyncEntityType = (typeof CALENDAR_SYNC_ENTITY_TYPES)[number];

export const CALENDAR_SYNC_ACTIONS = ['create', 'update', 'delete'] as const;
export type CalendarSyncAction = (typeof CALENDAR_SYNC_ACTIONS)[number];

export const CALENDAR_SYNC_STATUSES = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type CalendarSyncStatus = (typeof CALENDAR_SYNC_STATUSES)[number];

export const CALENDAR_SYNC_PROVIDERS = ['google', 'caldav'] as const;
export type CalendarSyncProvider = (typeof CALENDAR_SYNC_PROVIDERS)[number];

/**
 * Booking types table (TASK-0040 / ADR-0017 §1.1).
 * Defines appointment session types available for booking.
 */
export const bookingTypes = pgTable(
  'booking_types',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    slug: varchar('slug', { length: 64 }).notNull().unique(),
    title: varchar('title', { length: 150 }).notNull(),
    description: text('description'),
    durationMinutes: integer('duration_minutes').notNull().default(30),
    bufferBeforeMinutes: integer('buffer_before_minutes').notNull().default(0),
    bufferAfterMinutes: integer('buffer_after_minutes').notNull().default(15),
    minNoticeHours: integer('min_notice_hours').notNull().default(24),
    maxFutureDays: integer('max_future_days').notNull().default(60),
    locationType: varchar('location_type', { length: 20 })
      .notNull()
      .default('google_meet')
      .$type<BookingLocationType>(),
    locationDetails: varchar('location_details', { length: 255 }),
    color: varchar('color', { length: 32 }).notNull().default('indigo'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  () => [
    check(
      'booking_types_location_type_check',
      sql`location_type IN ('in_person', 'phone', 'google_meet')`,
    ),
  ],
);

export const booking_types = bookingTypes;
export type BookingType = typeof bookingTypes.$inferSelect;
export type NewBookingType = typeof bookingTypes.$inferInsert;

/**
 * Appointments table (TASK-0040 / ADR-0017 §1.2).
 * Represents scheduled client consultations and meetings.
 */
export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    bookingTypeId: uuid('booking_type_id').references((): AnyPgColumn => bookingTypes.id, {
      onDelete: 'set null',
    }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references((): AnyPgColumn => projects.id, {
      onDelete: 'set null',
    }),
    leadId: uuid('lead_id').references((): AnyPgColumn => leads.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 200 }).notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('scheduled')
      .$type<AppointmentStatus>(),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Europe/Berlin'),
    attendeeName: varchar('attendee_name', { length: 200 }).notNull(),
    attendeeEmail: varchar('attendee_email', { length: 255 }).notNull(),
    attendeePhone: varchar('attendee_phone', { length: 50 }),
    attendeeNotes: text('attendee_notes'),
    locationType: varchar('location_type', { length: 20 })
      .notNull()
      .default('google_meet')
      .$type<BookingLocationType>(),
    locationDetails: varchar('location_details', { length: 255 }),
    meetUrl: varchar('meet_url', { length: 500 }),
    cancellationReason: text('cancellation_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'appointments_location_type_check',
      sql`location_type IN ('in_person', 'phone', 'google_meet')`,
    ),
    check(
      'appointments_status_check',
      sql`status IN ('scheduled', 'completed', 'cancelled', 'no_show')`,
    ),
    index('appointments_starts_at_idx').on(table.startsAt, table.endsAt),
    index('appointments_client_id_idx').on(table.clientId),
    index('appointments_project_id_idx').on(table.projectId),
    index('appointments_status_idx').on(table.status),
  ],
);

export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;

/**
 * Blocked time table (TASK-0040 / ADR-0017 §1.3).
 * Studio or personal blackout intervals.
 */
export const blockedTime = pgTable(
  'blocked_time',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    title: varchar('title', { length: 200 }).notNull().default('Blocked Time'),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }).notNull(),
    allDay: boolean('all_day').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('blocked_time_starts_at_idx').on(table.startsAt, table.endsAt)],
);

export const blocked_time = blockedTime;
export type BlockedTime = typeof blockedTime.$inferSelect;
export type NewBlockedTime = typeof blockedTime.$inferInsert;

/**
 * Availability schedules table (TASK-0040 / ADR-0017 §1.4).
 * Recurring weekly working hours.
 */
export const availabilitySchedules = pgTable(
  'availability_schedules',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    dayOfWeek: integer('day_of_week').notNull(),
    startTime: varchar('start_time', { length: 5 }).notNull(),
    endTime: varchar('end_time', { length: 5 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  () => [
    check('availability_schedules_day_of_week_check', sql`day_of_week >= 0 AND day_of_week <= 6`),
  ],
);

export const availability_schedules = availabilitySchedules;
export type AvailabilitySchedule = typeof availabilitySchedules.$inferSelect;
export type NewAvailabilitySchedule = typeof availabilitySchedules.$inferInsert;

/**
 * Availability overrides table (TASK-0040 / ADR-0017 §1.5).
 * Date-specific schedule exceptions and holiday blackout dates.
 */
export const availabilityOverrides = pgTable(
  'availability_overrides',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    date: varchar('date', { length: 10 }).notNull(),
    startTime: varchar('start_time', { length: 5 }),
    endTime: varchar('end_time', { length: 5 }),
    isUnavailable: boolean('is_unavailable').notNull().default(false),
    reason: varchar('reason', { length: 150 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('availability_overrides_date_start_time_unique').on(table.date, table.startTime),
  ],
);

export const availability_overrides = availabilityOverrides;
export type AvailabilityOverride = typeof availabilityOverrides.$inferSelect;
export type NewAvailabilityOverride = typeof availabilityOverrides.$inferInsert;

/**
 * Calendar feeds table (TASK-0040 / ADR-0017 §1.6).
 * Revocable iCal feed token records.
 */
export const calendarFeeds = pgTable(
  'calendar_feeds',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    name: varchar('name', { length: 100 }).notNull().default('Main Studio Feed'),
    summaryLevel: varchar('summary_level', { length: 20 })
      .notNull()
      .default('standard')
      .$type<CalendarFeedSummaryLevel>(),
    isActive: boolean('is_active').notNull().default(true),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  () => [
    check(
      'calendar_feeds_summary_level_check',
      sql`summary_level IN ('minimal', 'standard', 'full')`,
    ),
  ],
);

export const calendar_feeds = calendarFeeds;
export type CalendarFeed = typeof calendarFeeds.$inferSelect;
export type NewCalendarFeed = typeof calendarFeeds.$inferInsert;

/**
 * CalDAV accounts table (TASK-0040 / ADR-0017 §1.7).
 * Encrypted CalDAV server connection credentials.
 */
export const caldavAccounts = pgTable('caldav_accounts', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),
  serverUrl: varchar('server_url', { length: 500 }).notNull(),
  username: varchar('username', { length: 255 }).notNull(),
  encryptedPassword: text('encrypted_password').notNull(),
  calendarHomeUrl: varchar('calendar_home_url', { length: 500 }),
  selectedCalendarUrl: varchar('selected_calendar_url', { length: 500 }),
  selectedCalendarName: varchar('selected_calendar_name', { length: 255 }),
  ctag: varchar('ctag', { length: 255 }),
  syncToken: varchar('sync_token', { length: 500 }),
  isActive: boolean('is_active').notNull().default(true),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
  lastSyncError: text('last_sync_error'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const caldav_accounts = caldavAccounts;
export type CaldavAccount = typeof caldavAccounts.$inferSelect;
export type NewCaldavAccount = typeof caldavAccounts.$inferInsert;

/**
 * Calendar sync outbox table (TASK-0040 / ADR-0017 §1.8).
 * Asynchronous queue for outbound calendar synchronization.
 */
export const calendarSyncOutbox = pgTable(
  'calendar_sync_outbox',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    entityType: varchar('entity_type', { length: 20 }).notNull().$type<CalendarSyncEntityType>(),
    entityId: uuid('entity_id').notNull(),
    action: varchar('action', { length: 20 }).notNull().$type<CalendarSyncAction>(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<CalendarSyncStatus>(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'calendar_sync_outbox_entity_type_check',
      sql`entity_type IN ('shoot', 'appointment', 'blocked_time')`,
    ),
    check('calendar_sync_outbox_action_check', sql`action IN ('create', 'update', 'delete')`),
    check(
      'calendar_sync_outbox_status_check',
      sql`status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')`,
    ),
    index('calendar_sync_outbox_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
  ],
);

export const calendar_sync_outbox = calendarSyncOutbox;
export type CalendarSyncOutboxItem = typeof calendarSyncOutbox.$inferSelect;
export type NewCalendarSyncOutboxItem = typeof calendarSyncOutbox.$inferInsert;

/**
 * Calendar sync links table (TASK-0040 / ADR-0017 §1.9).
 * Bidirectional mapping between Ownlight entities and external calendar IDs.
 */
export const calendarSyncLinks = pgTable(
  'calendar_sync_links',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    provider: varchar('provider', { length: 20 }).notNull().$type<CalendarSyncProvider>(),
    entityType: varchar('entity_type', { length: 20 }).notNull().$type<CalendarSyncEntityType>(),
    entityId: uuid('entity_id').notNull(),
    externalEventId: varchar('external_event_id', { length: 500 }).notNull(),
    etag: varchar('etag', { length: 255 }),
    syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('calendar_sync_links_provider_check', sql`provider IN ('google', 'caldav')`),
    check(
      'calendar_sync_links_entity_type_check',
      sql`entity_type IN ('shoot', 'appointment', 'blocked_time')`,
    ),
    unique('calendar_sync_links_provider_entity_unique').on(
      table.provider,
      table.entityType,
      table.entityId,
    ),
  ],
);

export const calendar_sync_links = calendarSyncLinks;
export type CalendarSyncLink = typeof calendarSyncLinks.$inferSelect;
export type NewCalendarSyncLink = typeof calendarSyncLinks.$inferInsert;

/**
 * External calendar busy intervals cache table (TASK-0046 / ADR-0017 §5.4).
 * Stores imported busy time ranges from external calendar free/busy queries.
 */
export const externalCalendarBusyIntervals = pgTable(
  'external_calendar_busy_intervals',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    provider: varchar('provider', { length: 20 }).notNull().$type<CalendarSyncProvider>(),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }).notNull(),
    externalId: varchar('external_id', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('external_calendar_busy_intervals_provider_check', sql`provider IN ('google', 'caldav')`),
    index('external_calendar_busy_intervals_starts_at_idx').on(table.startsAt, table.endsAt),
  ],
);

export const external_calendar_busy_intervals = externalCalendarBusyIntervals;
export type ExternalCalendarBusyInterval = typeof externalCalendarBusyIntervals.$inferSelect;
export type NewExternalCalendarBusyInterval = typeof externalCalendarBusyIntervals.$inferInsert;

// Relations
export const bookingTypesRelations = relations(bookingTypes, ({ many }) => ({
  appointments: many(appointments),
}));

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  bookingType: one(bookingTypes, {
    fields: [appointments.bookingTypeId],
    references: [bookingTypes.id],
  }),
  client: one(clients, {
    fields: [appointments.clientId],
    references: [clients.id],
  }),
  project: one(projects, {
    fields: [appointments.projectId],
    references: [projects.id],
  }),
  lead: one(leads, {
    fields: [appointments.leadId],
    references: [leads.id],
  }),
}));
