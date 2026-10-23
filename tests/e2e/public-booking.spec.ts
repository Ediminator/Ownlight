import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const PGLITE_DIR = path.resolve('./.pglite-e2e');

/**
 * Public Booking Scheduler E2E Specs (TASK-0044)
 * Covers AC-1, AC-2, AC-3, AC-7, AC-9, AC-10, AC-11 and WCAG 2.2 AA accessibility.
 */
test.describe('TASK-0044: Public Booking Scheduler E2E', () => {
  // Ensure calendar seed exists in .pglite-e2e before running tests
  test.beforeAll(async () => {
    let pglite: PGlite | null = null;
    try {
      pglite = new PGlite(PGLITE_DIR);
      await pglite.waitReady;

      // Seed discovery-call booking type if not already present
      const check = await pglite.query(
        "SELECT id FROM booking_types WHERE slug = 'discovery-call'",
      );
      if (check.rows.length === 0) {
        const now = new Date().toISOString();
        await pglite.query(
          `INSERT INTO booking_types (id, slug, title, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, min_notice_hours, max_future_days, location_type, color, is_active, created_at, updated_at)
           VALUES ('01920000-0000-7000-8000-000000000031', 'discovery-call', 'Discovery Call', 'Initial 30-minute consultation', 30, 0, 15, 24, 60, 'google_meet', 'indigo', true, $1, $1)`,
          [now],
        );
      }

      // Ensure availability schedules exist (Mon-Fri 09:00-17:00)
      for (let day = 1; day <= 5; day++) {
        const schedCheck = await pglite.query(
          'SELECT id FROM availability_schedules WHERE day_of_week = $1',
          [day],
        );
        if (schedCheck.rows.length === 0) {
          const now = new Date().toISOString();
          await pglite.query(
            `INSERT INTO availability_schedules (id, day_of_week, start_time, end_time, is_active, created_at, updated_at)
             VALUES ($1, $2, '09:00', '17:00', true, $3, $3)`,
            [`01920000-0000-7000-8000-00000000002${String(day)}`, day, now],
          );
        }
      }
    } catch {
      // Ignore if database is locked by concurrent process
    } finally {
      if (pglite) {
        try {
          await pglite.close();
        } catch {
          // ignore
        }
      }
    }
  });

  // Clean up any test appointments after tests
  test.afterEach(async () => {
    let pglite: PGlite | null = null;
    try {
      pglite = new PGlite(PGLITE_DIR);
      await pglite.waitReady;
      await pglite.query("DELETE FROM appointments WHERE attendee_email LIKE '%@example.com'");
      await pglite.query("DELETE FROM email_outbox WHERE recipient LIKE '%@example.com'");
      await pglite.query("DELETE FROM calendar_sync_outbox WHERE entity_type = 'appointment'");
    } catch {
      // ignore
    } finally {
      if (pglite) {
        try {
          await pglite.close();
        } catch {
          // ignore
        }
      }
    }
  });

  test('AC-1 & AC-2: unauthenticated visitor sees session details, timezone selector, responsive slot picker, and passes a11y', async ({
    page,
  }) => {
    await page.goto('/en/book/discovery-call');

    // 1. Verify unauthenticated access and session details
    await expect(page.locator('#booking-title')).toContainText('Discovery Call');
    await expect(page.locator('text=30 min')).toBeVisible();

    // 2. Verify timezone selector is present and functional
    const tzSelect = page.locator('[data-testid="timezone-select"]');
    await expect(tzSelect).toBeVisible();

    // 3. Verify calendar date picker grid is visible
    const calendarGrid = page.locator('[role="grid"]');
    await expect(calendarGrid).toBeVisible();

    // 4. Verify slots list is rendered
    await expect(page.locator('[data-testid="slots-list"]')).toBeVisible({ timeout: 10000 });

    // 5. Run WCAG 2.2 AA accessibility scan
    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('AC-3, AC-7, AC-11: full reservation flow with honeypot, ALTCHA PoW, confirmation view, and Add to Calendar', async ({
    page,
  }) => {
    await page.goto('/en/book/discovery-call');

    // 1. Wait for slots to load
    const slotsList = page.locator('[data-testid="slots-list"]');
    await expect(slotsList).toBeVisible({ timeout: 10000 });

    // 2. Click the first available slot button
    const firstSlot = slotsList.locator('button').first();
    await expect(firstSlot).toBeVisible();
    await firstSlot.click();

    // 3. Verify attendee form appears
    const nameInput = page.locator('[data-testid="attendee-name-input"]');
    const emailInput = page.locator('[data-testid="attendee-email-input"]');
    const phoneInput = page.locator('[data-testid="attendee-phone-input"]');
    const notesInput = page.locator('[data-testid="attendee-notes-input"]');
    const submitBtn = page.locator('[data-testid="confirm-booking-btn"]');

    await expect(nameInput).toBeVisible();
    await expect(emailInput).toBeVisible();

    // 4. Verify hidden honeypot is present in DOM but hidden
    const honeypot = page.locator('input[name="website_url"]');
    await expect(honeypot).toBeAttached();
    await expect(honeypot).not.toBeVisible();

    // 5. Fill out attendee details
    await nameInput.fill('Arthur Dent');
    await emailInput.fill('arthur.dent@example.com');
    await phoneInput.fill('+44 20 7946 0912');
    await notesInput.fill('Need consultation about interstellar landscape photography.');

    // 6. Wait for PoW timing requirement (POW_MIN_DURATION_MS = 3000ms)
    await page.waitForTimeout(3200);

    // 7. Submit the booking reservation
    await submitBtn.click();

    // 7. Verify confirmation view renders (AC-3)
    const confirmationHeading = page.locator('#confirmation-heading');
    await expect(confirmationHeading).toBeVisible({ timeout: 15000 });
    await expect(confirmationHeading).toContainText('Booking Confirmed!');

    // 8. Verify session summary
    await expect(page.getByText('Discovery Call (30 min)')).toBeVisible();
    await expect(page.locator('text=arthur.dent@example.com')).toBeVisible();

    // 9. Verify "Add to Calendar" button is present (AC-11)
    const addToCalendarBtn = page.locator('[data-testid="add-to-calendar-btn"]');
    await expect(addToCalendarBtn).toBeVisible();

    // 10. Run a11y scan on confirmation view
    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('AC-9: inactive or unknown booking type displays closed notice without slot picker', async ({
    page,
  }) => {
    await page.goto('/en/book/non-existent-booking-type-12345');

    // 1. Closed heading should be visible
    const closedHeading = page.locator('#closed-heading');
    await expect(closedHeading).toBeVisible();
    await expect(closedHeading).toContainText('Bookings Currently Closed');

    // 2. Slot picker and form must NOT be rendered
    await expect(page.locator('[role="grid"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="slots-list"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="confirm-booking-btn"]')).not.toBeVisible();

    // 3. Run a11y scan on closed notice
    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('AC-10: localized German booking page renders German labels and notices', async ({
    page,
  }) => {
    await page.goto('/de/book/discovery-call');

    // 1. Verify German title / date picker heading
    await expect(page.locator('text=Datum & Uhrzeit wählen')).toBeVisible();

    // 2. Verify German slot list
    const slotsList = page.locator('[data-testid="slots-list"]');
    await expect(slotsList).toBeVisible({ timeout: 10000 });

    // 3. Click first slot and verify German form labels
    const firstSlot = slotsList.locator('button').first();
    await firstSlot.click();

    await expect(page.locator('text=Ihre Angaben')).toBeVisible();
    await expect(page.locator('text=Ihr Name')).toBeVisible();
    await expect(page.locator('text=E-Mail-Adresse')).toBeVisible();
    await expect(page.locator('[data-testid="confirm-booking-btn"]')).toContainText(
      'Termin verbindlich buchen',
    );
  });
});
