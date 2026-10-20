import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import {
  availabilitySchedules,
  bookingTypes,
  type AvailabilitySchedule,
  type BookingType,
} from '@/server/db/schema/calendar';

export interface DefaultScheduleSeedDefinition {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

export const DEFAULT_AVAILABILITY_SCHEDULES: readonly DefaultScheduleSeedDefinition[] = [
  {
    id: '01920000-0000-7000-8000-000000000020',
    dayOfWeek: 0, // Sunday
    startTime: '09:00',
    endTime: '17:00',
    isActive: false,
  },
  {
    id: '01920000-0000-7000-8000-000000000021',
    dayOfWeek: 1, // Monday
    startTime: '09:00',
    endTime: '17:00',
    isActive: true,
  },
  {
    id: '01920000-0000-7000-8000-000000000022',
    dayOfWeek: 2, // Tuesday
    startTime: '09:00',
    endTime: '17:00',
    isActive: true,
  },
  {
    id: '01920000-0000-7000-8000-000000000023',
    dayOfWeek: 3, // Wednesday
    startTime: '09:00',
    endTime: '17:00',
    isActive: true,
  },
  {
    id: '01920000-0000-7000-8000-000000000024',
    dayOfWeek: 4, // Thursday
    startTime: '09:00',
    endTime: '17:00',
    isActive: true,
  },
  {
    id: '01920000-0000-7000-8000-000000000025',
    dayOfWeek: 5, // Friday
    startTime: '09:00',
    endTime: '17:00',
    isActive: true,
  },
  {
    id: '01920000-0000-7000-8000-000000000026',
    dayOfWeek: 6, // Saturday
    startTime: '09:00',
    endTime: '17:00',
    isActive: false,
  },
] as const;

export interface DefaultBookingTypeSeedDefinition {
  id: string;
  slug: string;
  title: string;
  description: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeHours: number;
  maxFutureDays: number;
  locationType: 'in_person' | 'phone' | 'google_meet';
  color: string;
  isActive: boolean;
}

export const DEFAULT_BOOKING_TYPES: readonly DefaultBookingTypeSeedDefinition[] = [
  {
    id: '01920000-0000-7000-8000-000000000031',
    slug: 'discovery-call',
    title: 'Discovery Call',
    description: 'Initial 30-minute consultation to discuss your photography project and vision.',
    durationMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 15,
    minNoticeHours: 24,
    maxFutureDays: 60,
    locationType: 'google_meet',
    color: 'indigo',
    isActive: true,
  },
  {
    id: '01920000-0000-7000-8000-000000000032',
    slug: 'consultation',
    title: 'Consultation',
    description: 'In-depth 60-minute planning session to review concept, styling, and logistics.',
    durationMinutes: 60,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 15,
    minNoticeHours: 24,
    maxFutureDays: 60,
    locationType: 'google_meet',
    color: 'indigo',
    isActive: true,
  },
] as const;

/**
 * Seeds default availability schedules and booking types (TASK-0040 / AC-2).
 * Safe to execute multiple times (idempotent).
 */
export async function seedDefaultCalendarData(db: DbClient): Promise<{
  schedules: AvailabilitySchedule[];
  bookingTypes: BookingType[];
}> {
  const seededSchedules: AvailabilitySchedule[] = [];

  for (const def of DEFAULT_AVAILABILITY_SCHEDULES) {
    const existing = await db
      .select()
      .from(availabilitySchedules)
      .where(eq(availabilitySchedules.dayOfWeek, def.dayOfWeek))
      .limit(1);

    if (existing[0]) {
      seededSchedules.push(existing[0]);
    } else {
      const [inserted] = await db
        .insert(availabilitySchedules)
        .values({
          id: def.id,
          dayOfWeek: def.dayOfWeek,
          startTime: def.startTime,
          endTime: def.endTime,
          isActive: def.isActive,
        })
        .returning();

      if (inserted) {
        seededSchedules.push(inserted);
      }
    }
  }

  const seededBookingTypes: BookingType[] = [];

  for (const def of DEFAULT_BOOKING_TYPES) {
    const existing = await db
      .select()
      .from(bookingTypes)
      .where(eq(bookingTypes.slug, def.slug))
      .limit(1);

    if (existing[0]) {
      seededBookingTypes.push(existing[0]);
    } else {
      const [inserted] = await db
        .insert(bookingTypes)
        .values({
          id: def.id,
          slug: def.slug,
          title: def.title,
          description: def.description,
          durationMinutes: def.durationMinutes,
          bufferBeforeMinutes: def.bufferBeforeMinutes,
          bufferAfterMinutes: def.bufferAfterMinutes,
          minNoticeHours: def.minNoticeHours,
          maxFutureDays: def.maxFutureDays,
          locationType: def.locationType,
          color: def.color,
          isActive: def.isActive,
        })
        .returning();

      if (inserted) {
        seededBookingTypes.push(inserted);
      }
    }
  }

  return {
    schedules: seededSchedules.sort((a, b) => a.dayOfWeek - b.dayOfWeek),
    bookingTypes: seededBookingTypes,
  };
}
