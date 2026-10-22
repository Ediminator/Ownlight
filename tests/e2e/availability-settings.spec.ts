import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

function getLatestRunDir(): string {
  if (process.env.RUN_DIR) return process.env.RUN_DIR;
  const runsRoot = path.resolve(import.meta.dirname, '../../../../control/ownlight/runs/TASK-0043');
  if (fs.existsSync(runsRoot)) {
    const entries = fs
      .readdirSync(runsRoot)
      .filter((d) => d.startsWith('iter-'))
      .sort();
    const last = entries[entries.length - 1];
    if (last) {
      return last;
    }
  }
  return 'iter-01';
}

const RUN_DIR_PARAM = getLatestRunDir();
const UX_RUN_DIR = path.resolve(
  import.meta.dirname,
  `../../../../control/ownlight/runs/TASK-0043/${RUN_DIR_PARAM}/ux`,
);

async function ensureOwnerBootstrappedAndSignedIn(page: import('@playwright/test').Page) {
  // Check if initial setup is available
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

  // If already set up, check if sign-in is needed
  await page.goto('/en/sign-in');
  const emailInput = page.locator('[data-testid="email-input"]');
  if (await emailInput.isVisible({ timeout: 1500 }).catch(() => false)) {
    await emailInput.fill(E2E_OWNER_EMAIL);
    await page.fill('[data-testid="password-input"]', E2E_OWNER_PASSWORD);
    await page.click('[data-testid="signin-submit-btn"]');
    await expect(page).not.toHaveURL(/\/sign-in$/);
  }
}

test.describe('TASK-0043: Availability Schedules, Date Overrides, & Booking Types Settings E2E', () => {
  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    try {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    } catch {
      // Ignore if permissions API is unsupported
    }
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-8: Unauthenticated request to /en/settings/calendar/availability redirects to sign-in', async ({
    browser,
  }) => {
    const unauthContext = await browser.newContext();
    const unauthPage = await unauthContext.newPage();

    await unauthPage.goto('/en/settings/calendar/availability');
    await expect(unauthPage).toHaveURL(
      /\/en\/sign-in\?callbackUrl=%2Fen%2Fsettings%2Fcalendar%2Favailability/,
    );

    const bodyText = await unauthPage.content();
    expect(bodyText).not.toContain('data-testid="weekly-schedule-editor"');
    expect(bodyText).not.toContain('data-testid="tab-weekly-schedule"');

    await unauthContext.close();
  });

  test('AC-1 & AC-2: Weekly Schedule editor renders days, performs inline time validation, and saves schedule', async ({
    page,
  }) => {
    await page.goto('/en/settings/calendar/availability');
    await expect(page.locator('[data-testid="breadcrumb-settings"]')).toBeVisible();
    await expect(page.locator('[data-testid="weekly-schedule-editor"]')).toBeVisible();

    // Monday schedule row
    const mondayRow = page.locator('[data-testid="schedule-row-1"]');
    await expect(mondayRow).toBeVisible();

    const mondayStart = page.locator('[data-testid="schedule-start-time-1"]');
    const mondayEnd = page.locator('[data-testid="schedule-end-time-1"]');
    const saveBtn = page.locator('[data-testid="save-weekly-schedule-btn"]');

    // 1. Invert times: start 17:00, end 09:00 -> error and save disabled
    await mondayStart.fill('17:00');
    await mondayEnd.fill('09:00');

    const mondayError = page.locator('[data-testid="schedule-error-1"]');
    await expect(mondayError).toBeVisible();
    await expect(saveBtn).toBeDisabled();

    // 2. Restore valid times: start 09:00, end 17:00
    await mondayStart.fill('09:00');
    await mondayEnd.fill('17:00');

    await expect(mondayError).not.toBeVisible();
    await expect(saveBtn).toBeEnabled();

    // 3. Save weekly schedule
    await saveBtn.click();
    const notification = page.locator('[data-testid="availability-notification"]');
    await expect(notification).toBeVisible();
    await expect(notification).toContainText(/saved|gespeichert/i);
  });

  test('AC-3 & AC-4: Date Overrides manager adds upcoming override and deletes it via confirmation dialog', async ({
    page,
  }) => {
    await page.goto('/en/settings/calendar/availability');

    // Switch to Date Overrides tab
    const tabOverrides = page.locator('[data-testid="tab-date-overrides"]');
    await tabOverrides.click();
    await expect(page.locator('[data-testid="date-overrides-empty"]')).toBeVisible();

    // Click "Add Date Override" button
    const addBtn = page.locator('[data-testid="add-date-override-btn"]');
    await addBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300); // Allow Radix transition to settle

    // Fill form
    const overrideDate = '2026-11-20';
    await page.fill('[data-testid="override-date-input"]', overrideDate);
    await page.fill('[data-testid="override-reason-input"]', 'Annual Studio Maintenance');

    // Save override
    const saveBtn = page.locator('[data-testid="override-save-btn"]');
    await saveBtn.click();

    await expect(dialog).not.toBeVisible();

    // Verify table appears and row is rendered
    await expect(page.locator('[data-testid="date-overrides-table"]')).toBeVisible();
    const overrideRow = page.locator(`[data-testid="override-row-${overrideDate}"]`);
    await expect(overrideRow).toBeVisible();
    await expect(overrideRow).toContainText('Annual Studio Maintenance');

    // Delete override
    const deleteBtn = page.locator(`[data-testid="delete-override-${overrideDate}"]`);
    await deleteBtn.click();

    // Confirm dialog
    const confirmDialog = page.locator('[role="dialog"]');
    await expect(confirmDialog).toBeVisible();
    await page.waitForTimeout(300);

    const confirmDeleteBtn = page.locator('[data-testid="confirm-delete-override-btn"]');
    await confirmDeleteBtn.click();

    await expect(confirmDialog).not.toBeVisible();
    await expect(overrideRow).not.toBeVisible();
    await expect(page.locator('[data-testid="date-overrides-empty"]')).toBeVisible();
  });

  test('AC-5, AC-6, & AC-7: Booking Types manager lists types, copies link, creates new with slug validation, edits, and deletes', async ({
    page,
  }) => {
    await page.goto('/en/settings/calendar/availability');

    // Switch to Booking Types tab
    const tabBookingTypes = page.locator('[data-testid="tab-booking-types"]');
    await tabBookingTypes.click();
    await expect(page.locator('[data-testid="new-booking-type-btn"]')).toBeVisible();

    // Clean up leftover test card if previous test run was interrupted
    const leftoverCard = page.locator(
      '[data-testid="booking-type-card-e2e-portrait-consultation"]',
    );
    if (await leftoverCard.isVisible()) {
      const delBtn = page.locator('[data-testid="delete-booking-type-e2e-portrait-consultation"]');
      await delBtn.click();
      await page.waitForTimeout(300);
      await page.locator('[data-testid="confirm-delete-booking-type-btn"]').click();
      await expect(leftoverCard).not.toBeVisible();
    }

    // Open "New Booking Type" dialog
    const newBtn = page.locator('[data-testid="new-booking-type-btn"]');
    await newBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);

    // Title and auto slug generation
    const titleInput = page.locator('[data-testid="booking-type-title-input"]');
    await titleInput.fill('E2E Portrait Consultation');

    const slugInput = page.locator('[data-testid="booking-type-slug-input"]');
    await expect(slugInput).toHaveValue('e2e-portrait-consultation');

    const testSlug = 'e2e-portrait-consultation';
    await page.fill('[data-testid="booking-type-duration-input"]', '45');

    // Select color rose
    const roseColorBtn = page.locator('[data-testid="booking-type-color-rose"]');
    await roseColorBtn.click();

    // Select phone location
    const locationSelect = page.locator('[data-testid="booking-type-location-type-select"]');
    await locationSelect.selectOption('phone');
    await page.fill('[data-testid="booking-type-location-details-input"]', '+49 30 98765432');

    // Submit creation
    const submitBtn = page.locator('[data-testid="booking-type-submit-btn"]');
    await submitBtn.click();
    await expect(dialog).not.toBeVisible();

    // Verify list and card are rendered
    await expect(page.locator('[data-testid="booking-types-list"]')).toBeVisible();
    const newCard = page.locator(`[data-testid="booking-type-card-${testSlug}"]`);
    await expect(newCard).toBeVisible();
    await expect(newCard).toContainText('E2E Portrait Consultation');
    await expect(newCard).toContainText('45 min');

    // Test duplicate slug validation by trying to create another with same slug
    await newBtn.click();
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);

    await titleInput.fill('Duplicate Title');
    await slugInput.fill(testSlug);
    await submitBtn.click();

    const formError = page.locator('[data-testid="booking-type-form-error"]');
    await expect(formError).toBeVisible();
    await expect(formError).toContainText(/already exists|already in use|bereits vergeben/i);

    // Cancel dialog
    const cancelBtn = page.locator('[data-testid="booking-type-cancel-btn"]');
    await cancelBtn.click();
    await expect(dialog).not.toBeVisible();

    // Test Copy link
    const copyBtn = page.locator(`[data-testid="copy-booking-type-link-${testSlug}"]`);
    await copyBtn.click();
    await expect(copyBtn).toContainText(/copied|kopiert/i);

    // Edit booking type
    const editBtn = page.locator(`[data-testid="edit-booking-type-${testSlug}"]`);
    await editBtn.click();
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);

    // Change title and deactivate
    await titleInput.fill('E2E Updated Consultation');
    const activeToggle = page.locator('[data-testid="booking-type-active-toggle"]');
    await activeToggle.uncheck();

    await submitBtn.click();
    await expect(dialog).not.toBeVisible();

    // Verify card updated
    await expect(newCard).toContainText('E2E Updated Consultation');
    const statusBadge = page.locator(`[data-testid="booking-type-status-${testSlug}"]`);
    await expect(statusBadge).toContainText(/inactive|inaktiv/i);

    // Delete booking type
    const deleteBtn = page.locator(`[data-testid="delete-booking-type-${testSlug}"]`);
    await deleteBtn.click();

    const confirmDialog = page.locator('[role="dialog"]');
    await expect(confirmDialog).toBeVisible();
    await page.waitForTimeout(300);

    const confirmDeleteBtn = page.locator('[data-testid="confirm-delete-booking-type-btn"]');
    await confirmDeleteBtn.click();

    await expect(confirmDialog).not.toBeVisible();
    await expect(newCard).not.toBeVisible();
    await expect(page.locator('[data-testid="booking-types-empty"]')).toBeVisible();
  });

  test('AC-9: German translation renders localized headers, tabs, and weekday names', async ({
    page,
  }) => {
    await page.goto('/de/settings/calendar/availability');

    // Check heading & breadcrumb
    await expect(page.locator('h1')).toContainText('Verfügbarkeit & Buchungsarten');
    await expect(page.locator('[data-testid="breadcrumb-settings"]')).toContainText(
      'Studio-Einstellungen',
    );

    // Check tabs in German
    await expect(page.locator('[data-testid="tab-weekly-schedule"]')).toContainText('Wochenplan');
    await expect(page.locator('[data-testid="tab-date-overrides"]')).toContainText(
      'Datumsausnahmen',
    );
    await expect(page.locator('[data-testid="tab-booking-types"]')).toContainText('Buchungsarten');

    // Check weekday row names
    const mondayLabel = page.locator('[data-testid="schedule-row-1"]');
    await expect(mondayLabel).toContainText('Montag');

    const sundayLabel = page.locator('[data-testid="schedule-row-0"]');
    await expect(sundayLabel).toContainText('Sonntag');

    // Check save button
    await expect(page.locator('[data-testid="save-weekly-schedule-btn"]')).toContainText(
      'Wochenplan speichern',
    );
  });

  test('AC-10: Zero WCAG 2.2 AA violations across viewports (320px, 768px, 1280px) in light/dark modes with UX screenshots', async ({
    page,
  }) => {
    const viewports = [
      { name: '320px', width: 320, height: 640 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1280px', width: 1280, height: 800 },
    ];

    const themes: ('light' | 'dark')[] = ['light', 'dark'];

    for (const theme of themes) {
      await page.emulateMedia({ colorScheme: theme });

      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        await page.goto('/en/settings/calendar/availability');
        await expect(page.locator('[data-testid="weekly-schedule-editor"]')).toBeVisible();

        const axeResults = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        expect(axeResults.violations).toEqual([]);

        // Capture UX screenshot
        await page.screenshot({
          path: path.join(UX_RUN_DIR, `availability-schedule-${vp.name}-${theme}.png`),
          fullPage: true,
        });

        // Test Date Overrides Tab accessibility
        const tabOverrides = page.locator('[data-testid="tab-date-overrides"]');
        await tabOverrides.click();
        await expect(page.locator('[data-testid="date-overrides-empty"]')).toBeVisible();

        const overridesAxe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        expect(overridesAxe.violations).toEqual([]);

        // Test Booking Types Tab accessibility
        const tabBookingTypes = page.locator('[data-testid="tab-booking-types"]');
        await tabBookingTypes.click();
        await expect(page.locator('[data-testid="new-booking-type-btn"]')).toBeVisible();

        const bookingTypesAxe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        expect(bookingTypesAxe.violations).toEqual([]);

        if (vp.name === '1280px' && theme === 'light') {
          await page.screenshot({
            path: path.join(UX_RUN_DIR, 'availability-booking-types-1280px-light.png'),
            fullPage: true,
          });
        }
      }
    }

    // Modal Axe Scans on Desktop
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/settings/calendar/availability');

    // 1. Add Date Override Modal Axe Scan
    await page.locator('[data-testid="tab-date-overrides"]').click();
    await page.locator('[data-testid="add-date-override-btn"]').click();
    await page.waitForSelector('[role="dialog"]', { state: 'visible' });
    await page.waitForTimeout(300);

    const overrideDialogAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(overrideDialogAxe.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'availability-override-modal-1280px-light.png'),
    });

    await page.locator('[data-testid="override-cancel-btn"]').click();
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();

    // 2. New Booking Type Modal Axe Scan
    await page.locator('[data-testid="tab-booking-types"]').click();
    await page.locator('[data-testid="new-booking-type-btn"]').click();
    await page.waitForSelector('[role="dialog"]', { state: 'visible' });
    await page.waitForTimeout(300);

    const bookingTypeDialogAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(bookingTypeDialogAxe.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'availability-booking-type-modal-1280px-light.png'),
    });

    await page.locator('[data-testid="booking-type-cancel-btn"]').click();
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  // I2-U01 (BLOCKER regression test): Tab keyboard navigation
  test('I2-U01: Settings tab navigation operates seamlessly via keyboard with WAI-ARIA roving tabindex', async ({
    page,
  }) => {
    await page.goto('/en/settings/calendar/availability');

    const tabSchedules = page.locator('[data-testid="tab-weekly-schedule"]');
    const tabOverrides = page.locator('[data-testid="tab-date-overrides"]');
    const tabBookingTypes = page.locator('[data-testid="tab-booking-types"]');

    // Focus initial active tab
    await tabSchedules.focus();
    await expect(tabSchedules).toBeFocused();
    await expect(tabSchedules).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="weekly-schedule-editor"]')).toBeVisible();

    // ArrowRight -> Moves focus and activates Date Overrides tab
    await page.keyboard.press('ArrowRight');
    await expect(tabOverrides).toBeFocused();
    await expect(tabOverrides).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="date-overrides-manager"]')).toBeVisible();

    // ArrowRight -> Moves focus and activates Booking Types tab
    await page.keyboard.press('ArrowRight');
    await expect(tabBookingTypes).toBeFocused();
    await expect(tabBookingTypes).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="booking-types-manager"]')).toBeVisible();

    // ArrowRight -> Wraps around to first tab (Weekly Schedule)
    await page.keyboard.press('ArrowRight');
    await expect(tabSchedules).toBeFocused();
    await expect(tabSchedules).toHaveAttribute('aria-selected', 'true');

    // ArrowLeft -> Wraps backward to last tab (Booking Types)
    await page.keyboard.press('ArrowLeft');
    await expect(tabBookingTypes).toBeFocused();
    await expect(tabBookingTypes).toHaveAttribute('aria-selected', 'true');

    // Home -> Jumps to first tab (Weekly Schedule)
    await page.keyboard.press('Home');
    await expect(tabSchedules).toBeFocused();
    await expect(tabSchedules).toHaveAttribute('aria-selected', 'true');

    // End -> Jumps to last tab (Booking Types)
    await page.keyboard.press('End');
    await expect(tabBookingTypes).toBeFocused();
    await expect(tabBookingTypes).toHaveAttribute('aria-selected', 'true');
  });

  // I2-U02 (MAJOR regression test): Date Overrides i18n
  test('I2-U02: Date Overrides manager renders all localized text without raw translation path keys in EN and DE', async ({
    page,
  }) => {
    for (const locale of ['en', 'de']) {
      await page.goto(`/${locale}/settings/calendar/availability`);

      // Switch to Date Overrides tab
      await page.locator('[data-testid="tab-date-overrides"]').click();
      await expect(page.locator('[data-testid="date-overrides-manager"]')).toBeVisible();

      // Check "Add Date Override" button has localized text and no raw path
      const addBtn = page.locator('[data-testid="add-date-override-btn"]');
      const addBtnText = await addBtn.innerText();
      expect(addBtnText.length).toBeGreaterThan(0);
      expect(addBtnText).not.toContain('settings.availability.overrides');

      // Open Add Date Override dialog
      await addBtn.click();
      const dialog = page.locator('[data-testid="add-override-dialog"]');
      await expect(dialog).toBeVisible();

      const dialogContent = await dialog.innerText();
      expect(dialogContent).not.toContain('settings.availability.overrides');
      expect(dialogContent).not.toContain('SETTINGS.AVAILABILITY.OVERRIDES');

      // Verify specific translated labels
      if (locale === 'de') {
        expect(dialogContent).toContain('Datumsausnahme hinzufügen');
        expect(dialogContent.toUpperCase()).toContain('DATUM');
        expect(dialogContent.toUpperCase()).toContain('STATUS');
        expect(dialogContent).toContain('Ganztägig nicht verfügbar');
        expect(dialogContent).toContain('Abbrechen');
        expect(dialogContent).toContain('Ausnahme hinzufügen');
      } else {
        expect(dialogContent).toContain('Add Date Override');
        expect(dialogContent.toUpperCase()).toContain('DATE');
        expect(dialogContent.toUpperCase()).toContain('STATUS');
        expect(dialogContent).toContain('Entire day unavailable');
        expect(dialogContent).toContain('Cancel');
        expect(dialogContent).toContain('Add Override');
      }

      await page.locator('[data-testid="override-cancel-btn"]').click();
      await expect(dialog).not.toBeVisible();
    }
  });

  // I2-U03 (MINOR regression test): Mobile tab strip visibility
  test('I2-U03: Settings tab list renders all three tabs cleanly on mobile viewports (375px)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/de/settings/calendar/availability');

    const tabSchedules = page.locator('[data-testid="tab-weekly-schedule"]');
    const tabOverrides = page.locator('[data-testid="tab-date-overrides"]');
    const tabBookingTypes = page.locator('[data-testid="tab-booking-types"]');

    await expect(tabSchedules).toBeVisible();
    await expect(tabOverrides).toBeVisible();
    await expect(tabBookingTypes).toBeVisible();

    // Verify all 3 tabs have non-zero bounding boxes and are within viewport width
    const schedulesBox = await tabSchedules.boundingBox();
    const overridesBox = await tabOverrides.boundingBox();
    const bookingTypesBox = await tabBookingTypes.boundingBox();

    expect(schedulesBox).not.toBeNull();
    expect(overridesBox).not.toBeNull();
    expect(bookingTypesBox).not.toBeNull();

    expect((schedulesBox?.x ?? 0) + (schedulesBox?.width ?? 0)).toBeLessThanOrEqual(375);
    expect((bookingTypesBox?.x ?? 0) + (bookingTypesBox?.width ?? 0)).toBeLessThanOrEqual(375);
  });
});
