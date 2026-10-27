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

async function createTestClient(
  page: import('@playwright/test').Page,
  name: string,
  email: string,
  locale = 'en',
): Promise<string> {
  await page.goto(`/${locale}/clients/new`);
  await page.fill('[data-testid="display-name-input"]', name);
  await page.fill('[data-testid="given-name-input"]', name.split(' ')[0] ?? name);
  await page.fill('[data-testid="family-name-input"]', name.split(' ')[1] ?? 'Client');
  await page.fill('[data-testid="email-input"]', email);
  await page.click('[data-testid="submit-client-btn"]');
  await expect(page).toHaveURL(new RegExp(`/${locale}/clients/[0-9a-f-]{36}`));
  const url = page.url();
  const match = /\/clients\/([0-9a-f-]{36})/.exec(url);
  const clientId = match?.[1];
  if (!clientId) throw new Error('Could not parse clientId from URL');
  return clientId;
}

test.describe('TASK-0047: Epic E4 Automated Journey Regression Test', () => {
  test.setTimeout(120000);

  test('Complete Epic E4 8-step lifecycle journey in English (/en)', async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);

    const testTimestamp = Date.now();
    const attendeeEmail = `clara.e4.${String(testTimestamp)}@example.com`;

    // -------------------------------------------------------------
    // Step 0: Create Client so public booking attaches to Clara's timeline
    // -------------------------------------------------------------
    const clientId = await createTestClient(page, 'Clara Schumann', attendeeEmail, 'en');

    // -------------------------------------------------------------
    // Step 1: Owner configures availability & booking type
    // -------------------------------------------------------------
    await page.goto('/en/settings/calendar/availability');
    await expect(page.locator('h1')).toBeVisible();

    const bookingTypesTab = page.locator('[data-testid="tab-booking-types"]');
    await bookingTypesTab.click();
    await expect(page.locator('[data-testid="new-booking-type-btn"]')).toBeVisible();

    // Create booking type "Discovery Consultation" if not present
    const existingCard = page.locator('[data-testid="booking-type-card-discovery-consultation"]');
    if (!(await existingCard.isVisible({ timeout: 1500 }).catch(() => false))) {
      await page.locator('[data-testid="new-booking-type-btn"]').click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(300);

      await page.locator('[data-testid="booking-type-title-input"]').fill('Discovery Consultation');
      await page.locator('[data-testid="booking-type-duration-input"]').fill('45');
      await page
        .locator('[data-testid="booking-type-location-type-select"]')
        .selectOption('google_meet');
      await page.locator('[data-testid="booking-type-submit-btn"]').click();
      await expect(dialog).not.toBeVisible();
    }

    // Run axe on availability & booking types
    const a11yStep1 = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const step1Violations = a11yStep1.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(step1Violations).toEqual([]);

    // -------------------------------------------------------------
    // Step 2: Owner inspects /calendar (Month & Week views) and adds blocked time
    // -------------------------------------------------------------
    await page.goto('/en/calendar');
    await expect(page.locator('[data-testid="calendar-container"]')).toBeVisible();

    // Month view check
    const monthGrid = page.locator('[data-testid="calendar-month-grid"]');
    await expect(monthGrid).toBeVisible();

    // Week view switch
    const weekViewBtn = page.locator('[data-testid="calendar-view-week"]');
    if (await weekViewBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await weekViewBtn.click();
      await expect(page.locator('[data-testid="calendar-week-view"]')).toBeVisible();
      // Switch back to month
      const monthViewBtn = page.locator('[data-testid="calendar-view-month"]');
      await monthViewBtn.click();
    }

    // Add blocked time
    const addBlockedBtn = page.locator('[data-testid="add-blocked-time-btn"]');
    if (await addBlockedBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await addBlockedBtn.click();
      const blockedDialog = page.locator('[role="dialog"]');
      await expect(blockedDialog).toBeVisible();
      await page.waitForTimeout(300);

      const reasonInput = page.locator('[data-testid="blocked-time-reason-input"]');
      if (await reasonInput.isVisible()) {
        await reasonInput.fill('Studio Maintenance Block');
      }
      const saveBlockedBtn = page.locator('[data-testid="save-blocked-time-btn"]');
      if (await saveBlockedBtn.isVisible()) {
        await saveBlockedBtn.click();
      }
    }

    // -------------------------------------------------------------
    // Step 3: External visitor visits /book/discovery-consultation, solves PoW, books
    // -------------------------------------------------------------
    await page.goto('/en/book/discovery-consultation');
    await expect(page.locator('#booking-title')).toBeVisible({ timeout: 10000 });

    const slotsList = page.locator('[data-testid="slots-list"]');
    await expect(slotsList).toBeVisible({ timeout: 10000 });

    const selectedDayBtn = page.locator('button[data-testid^="calendar-day-"].bg-primary');
    const bookedDayTestId = (await selectedDayBtn.getAttribute('data-testid')) ?? '';

    const slotButtons = slotsList.locator('button');
    const firstSlot = slotButtons.first();
    await expect(firstSlot).toBeVisible();
    const bookedSlotTestId = (await firstSlot.getAttribute('data-testid')) ?? '';
    await firstSlot.click();

    // Fill attendee details
    const nameInput = page.locator('[data-testid="attendee-name-input"]');
    const emailInput = page.locator('[data-testid="attendee-email-input"]');
    const phoneInput = page.locator('[data-testid="attendee-phone-input"]');
    const notesInput = page.locator('[data-testid="attendee-notes-input"]');
    const submitBtn = page.locator('[data-testid="confirm-booking-btn"]');

    await expect(nameInput).toBeVisible();
    await nameInput.fill('Clara Schumann');
    await emailInput.fill(attendeeEmail);
    await phoneInput.fill('+49 170 1234567');
    await notesInput.fill('Discussing portrait session requirements.');

    // Wait for PoW timing requirement (POW_MIN_DURATION_MS = 3000ms)
    await page.waitForTimeout(3200);

    await submitBtn.click();

    // Confirmation view
    const confirmationHeading = page.locator('#confirmation-heading');
    await expect(confirmationHeading).toBeVisible({ timeout: 15000 });
    await expect(confirmationHeading).toContainText('Booking Confirmed!');

    // -------------------------------------------------------------
    // Step 4: Concurrency check: slot is removed from /book/discovery-consultation
    // -------------------------------------------------------------
    await page.goto('/en/book/discovery-consultation');
    await expect(page.locator('[data-testid="slots-list"]')).toBeVisible({ timeout: 10000 });
    // Use auto-retrying assertions with timeout to prevent hydration/latency race conditions on CI (I2-C01)
    if (bookedSlotTestId) {
      await expect(page.locator(`[data-testid="${bookedSlotTestId}"]`)).toHaveCount(0, {
        timeout: 10000,
      });

      // If the day where the slot was booked still has remaining slots, select it and verify
      // that the specific booked slot is absent from that day's slot list.
      if (bookedDayTestId) {
        const bookedDayBtn = page.locator(`[data-testid="${bookedDayTestId}"]`);
        if ((await bookedDayBtn.count()) > 0 && (await bookedDayBtn.isEnabled())) {
          await bookedDayBtn.click();
          await expect(page.locator(`[data-testid="${bookedSlotTestId}"]`)).toHaveCount(0, {
            timeout: 10000,
          });
        }
      }
    }

    // -------------------------------------------------------------
    // Step 5: Owner checks /calendar, verifies appointment & attendee details
    // -------------------------------------------------------------
    await ensureOwnerBootstrappedAndSignedIn(page);
    await page.goto('/en/calendar');
    await expect(page.locator('[data-testid="calendar-container"]')).toBeVisible();
    // Verify Clara's booking is visible on the calendar
    const calendarContent = await page.content();
    expect(calendarContent).toContain('Clara Schumann');

    // -------------------------------------------------------------
    // Step 6: Client relationship timeline records appointment.scheduled on /clients/[id]
    // -------------------------------------------------------------
    await page.goto(`/en/clients/${clientId}`);
    await expect(page.locator('[data-testid="timeline-heading"]')).toBeVisible();
    const clientPageContent = await page.content();
    expect(clientPageContent).toContain('appointment.scheduled');

    // -------------------------------------------------------------
    // Step 7: Owner subscribes to iCal feed, verifies RFC 5545 format
    // -------------------------------------------------------------
    await page.goto('/en/settings/calendar/feed');
    await expect(page.locator('[data-testid="calendar-feed-settings-page"]')).toBeVisible();

    const feedUrlInput = page.locator('[data-testid="feed-url-input"]');
    await expect(feedUrlInput).toBeVisible();
    let feedUrl = await feedUrlInput.inputValue();
    expect(feedUrl).toContain('/api/calendar/feed/');

    // If initial token is masked on page load, regenerate once to get active plaintext token URL
    if (feedUrl.includes('••••')) {
      await page.locator('[data-testid="revoke-feed-button"]').click();
      const confirmBtn = page.locator('[data-testid="confirm-revoke-button"]');
      await expect(confirmBtn).toBeVisible();
      await page.waitForTimeout(300);
      await confirmBtn.click();
      await expect(confirmBtn).not.toBeVisible();
      await expect(feedUrlInput).not.toHaveValue(/••••/);
      feedUrl = await feedUrlInput.inputValue();
    }

    // Fetch the .ics feed
    const feedResponse = await page.request.get(feedUrl);
    expect(feedResponse.status()).toBe(200);
    const feedBody = await feedResponse.text();
    expect(feedBody).toContain('BEGIN:VCALENDAR');
    expect(feedBody).toContain('VERSION:2.0');
    expect(feedBody).toContain('PRODID:-//Ownlight//Studio Calendar//EN');
    expect(feedBody).toContain('END:VCALENDAR');

    // -------------------------------------------------------------
    // Step 8: Owner revokes iCal feed, verifies old URL returns HTTP 404
    // -------------------------------------------------------------
    const revokeBtn = page.locator('[data-testid="revoke-feed-button"]');
    await revokeBtn.click();

    const revokeConfirmBtn = page.locator('[data-testid="confirm-revoke-button"]');
    await expect(revokeConfirmBtn).toBeVisible();
    await page.waitForTimeout(300);
    await revokeConfirmBtn.click();

    // Verify confirmation dialog closes
    await expect(revokeConfirmBtn).not.toBeVisible();

    // Old URL must return 404 Not Found
    const revokedResponse = await page.request.get(feedUrl);
    expect(revokedResponse.status()).toBe(404);
  });

  test('Complete Epic E4 localized journey verification in German (/de)', async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);

    // 1. Verify German localization of calendar
    await page.goto('/de/calendar');
    const htmlLang = await page.getAttribute('html', 'lang');
    expect(htmlLang).toBe('de');
    await expect(page.locator('[data-testid="calendar-container"]')).toBeVisible();

    // 2. Verify German booking page
    await page.goto('/de/book/discovery-consultation');
    await expect(page.locator('#booking-title')).toBeVisible();

    // 3. Verify German feed settings page
    await page.goto('/de/settings/calendar/feed');
    await expect(page.locator('[data-testid="calendar-feed-settings-page"]')).toBeVisible();

    const deAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const deViolations = deAxe.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(deViolations).toEqual([]);
  });
});
