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
