import { z } from 'zod';
import { BOOKING_LOCATION_TYPES, APPOINTMENT_STATUSES } from '@/server/db/schema/calendar';

export const bookingLocationTypeEnum = z.enum(BOOKING_LOCATION_TYPES);
export const appointmentStatusEnum = z.enum(APPOINTMENT_STATUSES);

export const createBookingTypeSchema = z
  .object({
    slug: z
      .string()
      .min(2, 'Slug must be at least 2 characters')
      .max(64, 'Slug must be at most 64 characters')
      .regex(/^[a-z0-9-]+$/, 'Slug must consist of lowercase alphanumeric characters and hyphens')
      .refine(
        (val) => !val.startsWith('-') && !val.endsWith('-') && !val.includes('--'),
        'Slug must not start or end with a hyphen or contain consecutive hyphens',
      ),
    title: z.string().min(1, 'Title is required').max(150, 'Title must not exceed 150 characters'),
    description: z
      .string()
      .max(2000, 'Description must not exceed 2000 characters')
      .nullable()
      .optional(),
    durationMinutes: z
      .number()
      .int()
      .min(5, 'Duration must be at least 5 minutes')
      .max(480, 'Duration must not exceed 480 minutes (8 hours)')
      .default(30),
    bufferBeforeMinutes: z
      .number()
      .int()
      .min(0, 'Buffer before must be at least 0 minutes')
      .max(120, 'Buffer before must not exceed 120 minutes')
      .default(0),
    bufferAfterMinutes: z
      .number()
      .int()
      .min(0, 'Buffer after must be at least 0 minutes')
      .max(120, 'Buffer after must not exceed 120 minutes')
      .default(15),
    minNoticeHours: z
      .number()
      .int()
      .min(0, 'Minimum notice must be at least 0 hours')
      .max(168, 'Minimum notice must not exceed 168 hours (7 days)')
      .default(24),
    maxFutureDays: z
      .number()
      .int()
      .min(1, 'Horizon must be at least 1 day')
      .max(365, 'Horizon must not exceed 365 days')
      .default(60),
    locationType: bookingLocationTypeEnum.default('google_meet'),
    locationDetails: z.string().max(255).nullable().optional(),
    color: z.string().max(32).default('indigo'),
    isActive: z.boolean().default(true),
  })
  .strict();

export type CreateBookingTypeInput = z.input<typeof createBookingTypeSchema>;

export const updateBookingTypeSchema = createBookingTypeSchema.partial().strict();
export type UpdateBookingTypeInput = z.infer<typeof updateBookingTypeSchema>;

export const createAppointmentSchema = z
  .object({
    bookingTypeId: z.string().uuid().nullable().optional(),
    clientId: z.string().uuid().nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    leadId: z.string().uuid().nullable().optional(),
    title: z.string().min(1, 'Title is required').max(200, 'Title must not exceed 200 characters'),
    status: appointmentStatusEnum.default('scheduled'),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    timezone: z.string().min(1).max(64).default('Europe/Berlin'),
    attendeeName: z
      .string()
      .min(1, 'Attendee name is required')
      .max(200, 'Attendee name must not exceed 200 characters'),
    attendeeEmail: z
      .string()
      .email('Invalid email address')
      .max(255, 'Attendee email must not exceed 255 characters'),
    attendeePhone: z.string().max(50).nullable().optional(),
    attendeeNotes: z.string().max(2000).nullable().optional(),
    locationType: bookingLocationTypeEnum.default('google_meet'),
    locationDetails: z.string().max(255).nullable().optional(),
    meetUrl: z.string().url().max(500).nullable().optional(),
    cancellationReason: z.string().max(1000).nullable().optional(),
  })
  .strict()
  .refine((data) => data.endsAt > data.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

export type CreateAppointmentInput = z.input<typeof createAppointmentSchema>;

export const updateAppointmentSchema = z
  .object({
    bookingTypeId: z.string().uuid().nullable().optional(),
    clientId: z.string().uuid().nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    leadId: z.string().uuid().nullable().optional(),
    title: z.string().min(1).max(200).optional(),
    status: appointmentStatusEnum.optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    timezone: z.string().min(1).max(64).optional(),
    attendeeName: z.string().min(1).max(200).optional(),
    attendeeEmail: z.string().email().max(255).optional(),
    attendeePhone: z.string().max(50).nullable().optional(),
    attendeeNotes: z.string().max(2000).nullable().optional(),
    locationType: bookingLocationTypeEnum.optional(),
    locationDetails: z.string().max(255).nullable().optional(),
    meetUrl: z.string().url().max(500).nullable().optional(),
    cancellationReason: z.string().max(1000).nullable().optional(),
    cancelledAt: z.coerce.date().nullable().optional(),
  })
  .strict()
  .refine((data) => !data.startsAt || !data.endsAt || data.endsAt > data.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;

export const cancelAppointmentSchema = z
  .object({
    reason: z.string().max(1000).nullable().optional(),
  })
  .strict();

export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

export const createBlockedTimeSchema = z
  .object({
    title: z.string().min(1).max(200).default('Blocked Time'),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    allDay: z.boolean().default(false),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine((data) => data.endsAt >= data.startsAt, {
    message: 'endsAt must be greater than or equal to startsAt',
    path: ['endsAt'],
  });

export type CreateBlockedTimeInput = z.input<typeof createBlockedTimeSchema>;

export const updateBlockedTimeSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    allDay: z.boolean().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine((data) => !data.startsAt || !data.endsAt || data.endsAt >= data.startsAt, {
    message: 'endsAt must be greater than or equal to startsAt',
    path: ['endsAt'],
  });

export type UpdateBlockedTimeInput = z.infer<typeof updateBlockedTimeSchema>;

export const availabilityScheduleItemSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format must be HH:MM'),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format must be HH:MM'),
    isActive: z.boolean(),
  })
  .strict()
  .refine((data) => data.startTime < data.endTime, {
    message: 'End time must be after start time',
    path: ['endTime'],
  });

export type AvailabilityScheduleItemInput = z.infer<typeof availabilityScheduleItemSchema>;

export const updateAvailabilitySchedulesSchema = z
  .object({
    schedules: z.array(availabilityScheduleItemSchema),
  })
  .strict();

export type UpdateAvailabilitySchedulesInput = z.infer<typeof updateAvailabilitySchedulesSchema>;

export const createAvailabilityOverrideSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    startTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/, 'Format must be HH:MM')
      .nullable()
      .optional(),
    endTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/, 'Format must be HH:MM')
      .nullable()
      .optional(),
    isUnavailable: z.boolean().default(false),
    reason: z.string().max(150).nullable().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.isUnavailable || !data.startTime || !data.endTime || data.startTime < data.endTime,
    {
      message: 'End time must be after start time',
      path: ['endTime'],
    },
  );

export type CreateAvailabilityOverrideInput = z.input<typeof createAvailabilityOverrideSchema>;

export const calculateAvailableSlotsSchema = z
  .object({
    bookingTypeId: z.string().uuid(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    timezone: z.string().min(1).max(64),
  })
  .strict();

export type CalculateAvailableSlotsInput = z.infer<typeof calculateAvailableSlotsSchema>;
