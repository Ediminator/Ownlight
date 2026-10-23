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

test.describe('TASK-0046: Google Calendar & Meet Settings E2E & A11y (AC-7, AC-9)', () => {
  test.setTimeout(90000);

  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-7: displays Google Calendar & Meet sync card with controls and passes axe audit in light & dark mode', async ({
    page,
  }) => {
    await page.goto('/en/settings/integrations/google');

    // 1. Verify view container and calendar sync card
    const viewContainer = page.locator('[data-testid="google-integration-view"]');
    await expect(viewContainer).toBeVisible();

    const calendarCard = page.locator('[data-testid="google-calendar-card"]');
    await expect(calendarCard).toBeVisible();

    // 2. Verify controls: scope indicator, toggle switch, calendar dropdown, sync now button, connection status
    const scopeIndicator = page.locator('[data-testid="calendar-scope-indicator"]');
    await expect(scopeIndicator).toBeVisible();

    const syncToggle = page.locator('[data-testid="calendar-sync-toggle"]');
    await expect(syncToggle).toBeVisible();

    const calendarDropdown = page.locator('[data-testid="calendar-select-dropdown"]');
    await expect(calendarDropdown).toBeVisible();

    const syncNowBtn = page.locator('[data-testid="calendar-sync-now-button"]');
    await expect(syncNowBtn).toBeVisible();
    await expect(syncNowBtn).toContainText('Sync Now');

    const connectionStatus = page.locator('[data-testid="calendar-connection-status"]');
    await expect(connectionStatus).toBeVisible();

    // 3. Accessibility audit in light mode
    const lightAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const lightViolations = lightAxe.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(lightViolations).toEqual([]);

    // 4. Accessibility audit in dark mode
    await page.emulateMedia({ colorScheme: 'dark' });
    const darkAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const darkViolations = darkAxe.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(darkViolations).toEqual([]);
  });

  test('AC-9: renders German locale (/de/settings/integrations/google) with localized labels and passes axe audit', async ({
    page,
  }) => {
    await page.goto('/de/settings/integrations/google');

    // 1. Verify HTML lang attribute
    const htmlLang = await page.getAttribute('html', 'lang');
    expect(htmlLang).toBe('de');

    // 2. Verify localized calendar card
    const calendarCard = page.locator('[data-testid="google-calendar-card"]');
    await expect(calendarCard).toBeVisible();
    await expect(calendarCard).toContainText('Google Kalender & Meet Synchronisation');

    // 3. Verify localized button label
    const syncNowBtn = page.locator('[data-testid="calendar-sync-now-button"]');
    await expect(syncNowBtn).toBeVisible();
    await expect(syncNowBtn).toContainText('Jetzt synchronisieren');

    // 4. Accessibility audit in German locale (both light and dark)
    const deLightAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const deLightViolations = deLightAxe.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(deLightViolations).toEqual([]);

    await page.emulateMedia({ colorScheme: 'dark' });
    const deDarkAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const deDarkViolations = deDarkAxe.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(deDarkViolations).toEqual([]);
  });
});
