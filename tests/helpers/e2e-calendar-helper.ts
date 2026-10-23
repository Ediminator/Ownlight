import { type PGlite } from '@electric-sql/pglite';

export const E2E_BOOKING_TYPE_DISCOVERY_ID = '01920000-0000-7000-8000-000000000031';
export const E2E_BOOKING_TYPE_DISCOVERY_SLUG = 'discovery-call';
export const E2E_BOOKING_TYPE_CONSULTATION_ID = '01920000-0000-7000-8000-000000000032';
export const E2E_BOOKING_TYPE_CONSULTATION_SLUG = 'consultation';

/**
 * Seeds calendar defaults (booking types and weekly availability schedules)
 * for Playwright E2E tests in the shared .pglite-e2e database.
 */
export async function seedAllE2eCalendar(pglite: PGlite): Promise<void> {
  const now = new Date().toISOString();

  // 1. Seed Booking Types
  await pglite.query(
    `INSERT INTO booking_types (
      id, slug, title, description, duration_minutes, buffer_before_minutes, buffer_after_minutes,
      min_notice_hours, max_future_days, location_type, color, is_active, created_at, updated_at
    ) VALUES
      ($1, $2, 'Discovery Call', 'Initial 30-minute consultation to discuss your photography project and vision.', 30, 0, 15, 24, 60, 'google_meet', 'indigo', true, $3, $3),
      ($4, $5, 'Consultation', 'In-depth 60-minute planning session to review concept, styling, and logistics.', 60, 0, 15, 24, 60, 'google_meet', 'indigo', true, $3, $3)
    ON CONFLICT (id) DO UPDATE SET is_active = true, updated_at = $3`,
    [
      E2E_BOOKING_TYPE_DISCOVERY_ID,
      E2E_BOOKING_TYPE_DISCOVERY_SLUG,
      now,
      E2E_BOOKING_TYPE_CONSULTATION_ID,
      E2E_BOOKING_TYPE_CONSULTATION_SLUG,
    ],
  );

  // 2. Seed Availability Schedules (Mon-Fri 09:00-17:00, Sat/Sun inactive)
  const schedules = [
    { day: 0, active: false, id: '01920000-0000-7000-8000-000000000020' },
    { day: 1, active: true, id: '01920000-0000-7000-8000-000000000021' },
    { day: 2, active: true, id: '01920000-0000-7000-8000-000000000022' },
    { day: 3, active: true, id: '01920000-0000-7000-8000-000000000023' },
    { day: 4, active: true, id: '01920000-0000-7000-8000-000000000024' },
    { day: 5, active: true, id: '01920000-0000-7000-8000-000000000025' },
    { day: 6, active: false, id: '01920000-0000-7000-8000-000000000026' },
  ];

  for (const s of schedules) {
    await pglite.query(
      `INSERT INTO availability_schedules (
        id, day_of_week, start_time, end_time, is_active, created_at, updated_at
      ) VALUES ($1, $2, '09:00', '17:00', $3, $4, $4)
      ON CONFLICT (id) DO UPDATE SET is_active = $3, updated_at = $4`,
      [s.id, s.day, s.active, now],
    );
  }
}
