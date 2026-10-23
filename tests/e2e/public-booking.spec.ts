import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

async function ensureOwnerBootstrappedAndSignedIn(page: import('@playwright/test').Page) {
  await page.goto('/en/setup');
  const setupForm = page.locator('[data-testid="setup-form"]');
  if (await setupForm.isVisible({ timeout: 1500 }).catch(() => false)) {
    await page.fill('[data-testid="setup-token-input"]', VALID_SETUP_TOKEN);
    await page.fill('[data-testid="name-input"]', 'Studio Owner');
    await page.fill('[data-testid="email-input"]', E2E_OWNER_EMAIL);
    await page.fill('[data-testid="password-input"]', E2E_OWNER_PASSWORD);
    await page.click('[data-testid="setup-submit-btn"]');
    await expect(page).not.toHaveURL(/\/setup/);
    return;
  }

  await page.goto('/en/sign-in');
  const emailInput = page.locator('[data-testid="email-input"]');
  if (await emailInput.isVisible({ timeout: 1500 }).catch(() => false)) {
    await emailInput.fill(E2E_OWNER_EMAIL);
    await page.fill('[data-testid="password-input"]', E2E_OWNER_PASSWORD);
    await page.click('[data-testid="signin-submit-btn"]');
    await expect(page).not.toHaveURL(/\/sign-in$/);
  }
}

/**
 * Public Booking Scheduler E2E Specs (TASK-0044)
 * Covers AC-1, AC-2, AC-3, AC-7, AC-9, AC-10, AC-11 and WCAG 2.2 AA accessibility.
 */
test.describe('TASK-0044: Public Booking Scheduler E2E', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await ensureOwnerBootstrappedAndSignedIn(page);
    await page.goto('/en/settings/calendar/availability');

    const tabBookingTypes = page.locator('[data-testid="tab-booking-types"]');
    await tabBookingTypes.click();
    await expect(page.locator('[data-testid="new-booking-type-btn"]')).toBeVisible();

    const card = page.locator('[data-testid="booking-type-card-discovery-call"]');
    if (!(await card.isVisible({ timeout: 1500 }).catch(() => false))) {
      await page.locator('[data-testid="new-booking-type-btn"]').click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(300);

      await page.locator('[data-testid="booking-type-title-input"]').fill('Discovery Call');
      await page.locator('[data-testid="booking-type-duration-input"]').fill('30');
      await page
        .locator('[data-testid="booking-type-location-type-select"]')
        .selectOption('google_meet');
      await page.locator('[data-testid="booking-type-submit-btn"]').click();
      await expect(dialog).not.toBeVisible();
      await expect(card).toBeVisible();
    }
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await ensureOwnerBootstrappedAndSignedIn(page);
    await page.goto('/en/settings/calendar/availability');

    const tabBookingTypes = page.locator('[data-testid="tab-booking-types"]');
    await tabBookingTypes.click();

    const card = page.locator('[data-testid="booking-type-card-discovery-call"]');
    if (await card.isVisible({ timeout: 1500 }).catch(() => false)) {
      await page.locator('[data-testid="delete-booking-type-discovery-call"]').click();
      const confirmDialog = page.locator('[role="dialog"]');
      await expect(confirmDialog).toBeVisible();
      await page.waitForTimeout(300);
      await page.locator('[data-testid="confirm-delete-booking-type-btn"]').click();
      await expect(confirmDialog).not.toBeVisible();
      await expect(card).not.toBeVisible();
    }
    await page.close();
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
