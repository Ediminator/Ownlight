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

test.describe('TASK-0021: Google Contacts Sync Toggle E2E (AC-1)', () => {
  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-1: Client create form toggle defaults to OFF with localized description in English and passes axe audit at 320px, 768px, 1280px', async ({
    page,
  }) => {
    const viewports = [
      { width: 320, height: 600, label: 'mobile-320' },
      { width: 768, height: 1024, label: 'tablet-768' },
      { width: 1280, height: 800, label: 'desktop-1280' },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/en/clients/new');

      const toggle = page.locator('[data-testid="google-sync-toggle"]');
      await expect(toggle).toBeVisible();

      // AC-1: Defaults to OFF (unchecked)
      await expect(toggle).not.toBeChecked();

      // AC-1: Localized description of transmitted fields (names and phones only)
      const desc = page.locator('[data-testid="google-sync-desc"]');
      await expect(desc).toBeVisible();
      await expect(desc).toContainText('names and phone numbers');

      // Axe accessibility check
      const axeResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();

      const seriousOrCritical = axeResults.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(seriousOrCritical).toEqual([]);
    }

    // Explicit opt-in interaction
    const toggle = page.locator('[data-testid="google-sync-toggle"]');
    await toggle.click();
    await expect(toggle).toBeChecked();
  });

  test('AC-1: Client create form toggle defaults to OFF with localized description in German and passes axe audit', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/de/clients/new');

    const toggle = page.locator('[data-testid="google-sync-toggle"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();

    const desc = page.locator('[data-testid="google-sync-desc"]');
    await expect(desc).toBeVisible();
    await expect(desc).toContainText('Namen und Telefonnummern');

    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const seriousOrCritical = axeResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(seriousOrCritical).toEqual([]);
  });

  test('AC-1: Client edit route opens edit dialog with toggle and localized copy', async ({
    page,
  }) => {
    // 1. Create a client first
    await page.goto('/en/clients/new');
    await page.fill('[data-testid="display-name-input"]', 'Google Sync Test Couple');
    await page.fill('[data-testid="given-name-input"]', 'Taylor');
    await page.fill('[data-testid="family-name-input"]', 'Swift');
    await page.fill('[data-testid="email-input"]', 'taylor@example.org');
    await page.fill('[data-testid="phone-input"]', '+49 30 112233');
    await page.click('[data-testid="submit-client-btn"]');

    await expect(page).toHaveURL(/\/en\/clients\/[0-9a-f-]{36}/);
    const clientUrl = page.url();
    const clientId = clientUrl.split('/').pop()?.split('?')[0];
    expect(clientId).toBeDefined();
    if (!clientId) {
      throw new Error('Expected clientId to be defined');
    }

    // 2. Navigate to /edit route
    await page.goto(`/en/clients/${clientId}/edit`);

    // Should redirect to client profile with edit dialog open
    const editToggle = page.locator('[data-testid="edit-google-sync-toggle"]');
    await expect(editToggle).toBeVisible();
    await expect(editToggle).not.toBeChecked();

    const editDesc = page.locator('[data-testid="edit-google-sync-desc"]');
    await expect(editDesc).toBeVisible();
    await expect(editDesc).toContainText('names and phone numbers');

    // Run axe on open edit modal after animation settles
    await page.waitForTimeout(300);
    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const seriousOrCritical = axeResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(seriousOrCritical).toEqual([]);

    // Explicit opt-in click
    await editToggle.click();
    await expect(editToggle).toBeChecked();

    // Save
    await page.click('[data-testid="save-details-btn"]');

    // Verify sync status badge appears on client profile
    const syncBadge = page.locator('[data-testid="google-sync-status-badge"]');
    await expect(syncBadge).toBeVisible();
  });
});
