import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

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

test.describe('TASK-0017: Google OAuth & Workspace Integration Settings E2E', () => {
  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-1, AC-8: /en/settings/integrations/google loads correctly, shows heading, and passes axe a11y audit', async ({
    page,
  }) => {
    await page.goto('/en/settings/integrations/google');

    // Verify view container
    const viewContainer = page.locator('[data-testid="google-integration-view"]');
    await expect(viewContainer).toBeVisible();

    // Verify main heading
    const heading = page.locator('h1');
    await expect(heading).toContainText('Google Workspace');

    // Run axe accessibility audit (WCAG 2.2 AA)
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const seriousOrCritical = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(seriousOrCritical).toEqual([]);
  });

  test('AC-8: /de/settings/integrations/google loads in German and passes axe a11y audit', async ({
    page,
  }) => {
    await page.goto('/de/settings/integrations/google');

    // Verify view container
    const viewContainer = page.locator('[data-testid="google-integration-view"]');
    await expect(viewContainer).toBeVisible();

    // Verify html lang is de
    const htmlLang = await page.getAttribute('html', 'lang');
    expect(htmlLang).toBe('de');

    // Verify heading
    const heading = page.locator('h1');
    await expect(heading).toContainText('Google Workspace');

    // Run axe accessibility audit
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const seriousOrCritical = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(seriousOrCritical).toEqual([]);
  });

  test('AC-8: Settings overview page (/en/settings) has link navigating to Google Workspace settings', async ({
    page,
  }) => {
    await page.goto('/en/settings');

    const googleCard = page.locator(
      'a[href="/settings/integrations/google"], a[href="/en/settings/integrations/google"]',
    );
    await expect(googleCard.first()).toBeVisible();

    await googleCard.first().click();
    await expect(page).toHaveURL(/\/settings\/integrations\/google/);
  });

  test('AC-8: Mobile responsive layout at 320px viewport without horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/en/settings/integrations/google');

    const viewContainer = page.locator('[data-testid="google-integration-view"]');
    await expect(viewContainer).toBeVisible();

    // Verify no horizontal overflow beyond viewport width
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    // Run axe scan on mobile viewport
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const seriousOrCritical = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(seriousOrCritical).toEqual([]);
  });
});
