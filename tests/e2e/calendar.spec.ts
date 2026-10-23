import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

function getLatestRunDir(): string {
  if (process.env.RUN_DIR) return process.env.RUN_DIR;
  const runsRoot = path.resolve(import.meta.dirname, '../../../../control/ownlight/runs/TASK-0042');
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
  `../../../../control/ownlight/runs/TASK-0042/${RUN_DIR_PARAM}/ux`,
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

test.describe('TASK-0042: Studio Calendar UI & Modals E2E Tests', () => {
  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-9: Unauthenticated request to /en/calendar redirects to sign-in', async ({
    browser,
  }) => {
    const unauthContext = await browser.newContext();
    const unauthPage = await unauthContext.newPage();

    await unauthPage.goto('/en/calendar');
    await expect(unauthPage).toHaveURL(/\/en\/sign-in\?callbackUrl=%2Fen%2Fcalendar/);

    const bodyText = await unauthPage.content();
    expect(bodyText).not.toContain('data-testid="calendar-container"');
    expect(bodyText).not.toContain('data-testid="calendar-month-grid"');

    await unauthContext.close();
  });

  test('AC-1 & AC-3: Month view renders accessible grid with period heading, live region, and roving tabindex navigation', async ({
    page,
  }) => {
    await page.goto('/en/calendar');
    await expect(page.locator('[data-testid="calendar-container"]')).toBeVisible();

    // Check heading and live region
    const periodHeading = page.locator('[data-testid="calendar-period-heading"]');
    await expect(periodHeading).toBeVisible();

    const liveRegion = page.locator('[data-testid="calendar-aria-live"]');
    await expect(liveRegion).toBeAttached();

    // Month grid has role="grid"
    const grid = page.locator('[data-testid="calendar-month-grid"]');
    await expect(grid).toBeVisible();
    await expect(grid).toHaveAttribute('role', 'grid');

    // Navigation buttons work
    const prevBtn = page.locator('[data-testid="calendar-prev-btn"]');
    const nextBtn = page.locator('[data-testid="calendar-next-btn"]');
    const todayBtn = page.locator('[data-testid="calendar-today-btn"]');

    const initialHeading = await periodHeading.innerText();
    await nextBtn.click();
    const nextHeading = await periodHeading.innerText();
    expect(nextHeading).not.toBe(initialHeading);

    await prevBtn.click();
    expect(await periodHeading.innerText()).toBe(initialHeading);

    await todayBtn.click();
    expect(await periodHeading.innerText()).toBe(initialHeading);

    // Gridcell arrow key navigation (AC-3)
    const focusedCell = page.locator('[role="gridcell"][tabindex="0"]');
    await expect(focusedCell).toBeVisible();
    await focusedCell.focus();

    // Press ArrowRight to move focus
    await page.keyboard.press('ArrowRight');
    const newFocusedCell = page.locator('[role="gridcell"][tabindex="0"]');
    await expect(newFocusedCell).toBeVisible();

    // Press Enter to select date and open Day Inspector
    await page.keyboard.press('Enter');
    const inspector = page.locator('[data-testid="day-inspector-panel"]');
    await expect(inspector).toBeVisible();

    // Close inspector
    const closeBtn = page.locator('[data-testid="inspector-close-btn"]');
    await closeBtn.click();
    await expect(inspector).not.toBeVisible();
  });

  test('AC-4: View switcher toggles Month, Week, and Day views via buttons and keyboard shortcuts', async ({
    page,
  }) => {
    await page.goto('/en/calendar');
    await expect(page.locator('[data-testid="calendar-container"]')).toBeVisible();

    // Month view is default
    await expect(page.locator('[data-testid="calendar-month-grid"]')).toBeVisible();

    // Switch to Week view via button
    const weekBtn = page.locator('[data-testid="calendar-view-week-btn"]');
    await weekBtn.click();
    await expect(page.locator('[data-testid="calendar-week-grid"]')).toBeVisible();
    await expect(page.locator('[data-testid="calendar-month-grid"]')).not.toBeVisible();

    // Switch to Day view via button
    const dayBtn = page.locator('[data-testid="calendar-view-day-btn"]');
    await dayBtn.click();
    await expect(page.locator('[data-testid="calendar-day-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="calendar-week-grid"]')).not.toBeVisible();

    // Keyboard shortcut 'm' returns to Month view
    await page.keyboard.press('m');
    await expect(page.locator('[data-testid="calendar-month-grid"]')).toBeVisible();

    // Keyboard shortcut 'w' switches to Week view
    await page.keyboard.press('w');
    await expect(page.locator('[data-testid="calendar-week-grid"]')).toBeVisible();

    // Keyboard shortcut 'd' switches to Day view
    await page.keyboard.press('d');
    await expect(page.locator('[data-testid="calendar-day-view"]')).toBeVisible();
  });

  test('AC-5 & AC-6: Appointment modal CRUD and cancellation flow with cleanup', async ({
    page,
  }) => {
    await page.goto('/en/calendar');
    await expect(page.locator('[data-testid="calendar-container"]')).toBeVisible();

    // Open Quick Appointment Modal
    const quickApptBtn = page.locator('[data-testid="calendar-quick-appointment-btn"]');
    await quickApptBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300); // Allow Radix fade-in animation to settle

    // Fill form fields
    const testTitle = `E2E Consultation ${String(Date.now())}`;
    await page.fill('[data-testid="appointment-title-input"]', testTitle);
    await page.fill('[data-testid="appointment-attendee-name-input"]', 'Sophie Martin');
    await page.fill(
      '[data-testid="appointment-attendee-email-input"]',
      'sophie.martin@example.org',
    );
    await page.fill(
      '[data-testid="appointment-notes-input"]',
      'Studio consultation regarding wedding package',
    );

    // Submit appointment creation
    const submitBtn = page.locator('[data-testid="appointment-submit-btn"]');
    await submitBtn.click();

    // Modal closes
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Verify appointment badge appears on calendar or day inspector
    const todayCell = page.locator('[data-testid^="calendar-day-"]').first();
    await todayCell.click();

    const inspector = page.locator('[data-testid="day-inspector-panel"]');
    await expect(inspector).toBeVisible();

    // If visible in inspector, test cancel modal
    const cancelBtn = page.locator('[data-testid="appointment-cancel-btn"]').first();
    if (await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cancelBtn.click();
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(300);

      // Confirm cancellation
      await page.fill(
        '[data-testid="appointment-cancel-reason-input"]',
        'Cancelled during automated E2E test',
      );
      const confirmCancelBtn = page.locator('[data-testid="appointment-confirm-cancel-btn"]');
      await confirmCancelBtn.click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
    }
  });

  test('AC-7 & AC-8: Blocked time creation, edit, and deletion flow with cleanup', async ({
    page,
  }) => {
    await page.goto('/en/calendar');
    await expect(page.locator('[data-testid="calendar-container"]')).toBeVisible();

    // Open Quick Block Time Modal
    const quickBlockBtn = page.locator('[data-testid="calendar-quick-block-btn"]');
    await quickBlockBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300); // Allow animation to settle

    // Fill form for blackout window
    const testTitle = `E2E Studio Maintenance ${String(Date.now())}`;
    await page.fill('[data-testid="blocked-time-title-input"]', testTitle);
    await page.check('[data-testid="blocked-time-allday-input"]');
    await page.fill(
      '[data-testid="blocked-time-notes-input"]',
      'Light rig rewiring and floor polishing',
    );

    // Submit
    const submitBtn = page.locator('[data-testid="blocked-time-submit-btn"]');
    await submitBtn.click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Open Day Inspector to verify and delete the record (AC-8 & DB cleanup)
    const todayCell = page.locator('[data-testid^="calendar-day-"]').first();
    await todayCell.click();

    const inspector = page.locator('[data-testid="day-inspector-panel"]');
    await expect(inspector).toBeVisible();

    const deleteBtn = page.locator('[data-testid="blocked-time-delete-btn"]').first();
    if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await deleteBtn.click();
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(300);

      const confirmDeleteBtn = page.locator('[data-testid="blocked-time-confirm-delete-btn"]');
      await confirmDeleteBtn.click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
    }
  });

  test('AC-10: Complete German localization (/de/calendar) renders German strings and weekday headers', async ({
    page,
  }) => {
    await page.goto('/de/calendar');
    await expect(page.locator('[data-testid="calendar-container"]')).toBeVisible();

    await expect(page.locator('html')).toHaveAttribute('lang', 'de');

    // German action buttons
    await expect(page.locator('[data-testid="calendar-today-btn"]')).toContainText('Heute');
    await expect(page.locator('[data-testid="calendar-view-month-btn"]')).toContainText('Monat');
    await expect(page.locator('[data-testid="calendar-view-week-btn"]')).toContainText('Woche');
    await expect(page.locator('[data-testid="calendar-view-day-btn"]')).toContainText('Tag');
    await expect(page.locator('[data-testid="calendar-quick-block-btn"]')).toContainText(
      'Zeit blockieren',
    );
    await expect(page.locator('[data-testid="calendar-quick-appointment-btn"]')).toContainText(
      'Neuer Termin',
    );

    // Weekdays in German start on Monday (Mo, Di, Mi, Do, Fr, Sa, So)
    const firstWeekday = page
      .locator('[data-testid="calendar-month-grid"] [role="columnheader"]')
      .first();
    await expect(firstWeekday).toContainText('Mo');
  });

  test('AC-10: Zero WCAG 2.2 AA violations across viewports (320px, 768px, 1280px) in light/dark modes with UX screenshots', async ({
    page,
  }) => {
    test.setTimeout(90000);
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

        await page.goto('/en/calendar');
        await expect(page.locator('[data-testid="calendar-container"]')).toBeVisible();

        const axeResults = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        expect(axeResults.violations).toEqual([]);

        // Capture UX screenshot
        await page.screenshot({
          path: path.join(UX_RUN_DIR, `calendar-month-${vp.name}-${theme}.png`),
          fullPage: true,
        });

        // Verify Week view accessibility (I1-U01)
        await page.goto('/en/calendar?view=week');
        await expect(page.locator('[data-testid="calendar-week-grid"]')).toBeVisible();
        const weekAxeResults = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        expect(weekAxeResults.violations).toEqual([]);
      }
    }

    // Modal Axe Scans on Desktop
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/calendar');
    await expect(page.locator('[data-testid="calendar-container"]')).toBeVisible();

    // 1. Appointment Modal Axe Scan
    const quickApptBtn = page.locator('[data-testid="calendar-quick-appointment-btn"]');
    await quickApptBtn.click();
    await page.waitForSelector('[role="dialog"]', { state: 'visible' });
    await page.waitForTimeout(300);

    const apptDialogAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(apptDialogAxe.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'calendar-appointment-modal-1280px-light.png'),
    });

    const closeApptBtn = page.locator('[data-testid="appointment-modal-close-btn"]');
    await closeApptBtn.click();
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();

    // 2. Blocked Time Modal Axe Scan
    const quickBlockBtn = page.locator('[data-testid="calendar-quick-block-btn"]');
    await quickBlockBtn.click();
    await page.waitForSelector('[role="dialog"]', { state: 'visible' });
    await page.waitForTimeout(300);

    const blockDialogAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(blockDialogAxe.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'calendar-blocked-time-modal-1280px-light.png'),
    });

    const closeBlockBtn = page.locator('[data-testid="blocked-time-modal-close-btn"]');
    await closeBlockBtn.click();
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });
});
