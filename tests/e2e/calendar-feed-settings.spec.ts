import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

function getLatestRunDir(): string {
  if (process.env.RUN_DIR) return process.env.RUN_DIR;
  const runsRoot = path.resolve(import.meta.dirname, '../../../../control/ownlight/runs/TASK-0045');
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
  `../../../../control/ownlight/runs/TASK-0045/${RUN_DIR_PARAM}/ux`,
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

test.describe('TASK-0045: Calendar Feed Settings & iCal Endpoint E2E Tests', () => {
  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    try {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    } catch {
      // Ignore if permissions API unsupported in browser context
    }
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-8: Unauthenticated request to /en/settings/calendar/feed redirects to sign-in', async ({
    browser,
  }) => {
    const unauthContext = await browser.newContext();
    const unauthPage = await unauthContext.newPage();

    await unauthPage.goto('/en/settings/calendar/feed');
    await expect(unauthPage).toHaveURL(/\/sign-in/);
    expect(unauthPage.url()).toContain('callbackUrl');

    const bodyText = await unauthPage.content();
    expect(bodyText).not.toContain('data-testid="calendar-feed-settings-page"');
    expect(bodyText).not.toContain('data-testid="feed-url-input"');

    await unauthContext.close();
  });

  test('AC-7: Calendar feed settings panel loads with subscription URL, copy feedback, and device guides', async ({
    page,
  }) => {
    await page.goto('/en/settings/calendar/feed');
    await expect(page.locator('[data-testid="calendar-feed-settings-page"]')).toBeVisible();

    // Verify breadcrumbs
    const settingsBreadcrumb = page.locator('[data-testid="breadcrumb-settings"]');
    await expect(settingsBreadcrumb).toBeVisible();

    // Verify URL input
    const urlInput = page.locator('[data-testid="feed-url-input"]');
    await expect(urlInput).toBeVisible();
    await expect(urlInput).toHaveAttribute('readonly', '');
    const inputValue = await urlInput.inputValue();
    expect(inputValue.length).toBeGreaterThan(10);
    expect(inputValue).toMatch(/^https?:\/\//);

    // Verify copy button
    const copyButton = page.locator('[data-testid="copy-feed-url-button"]');
    await expect(copyButton).toBeVisible();
    await copyButton.click();

    // Verify feedback (button changes or polite announcement appears)
    await expect(page.getByRole('status')).toContainText('Copied to clipboard', {
      timeout: 4000,
    });

    // Verify device setup instructions
    await expect(page.getByRole('heading', { name: 'Apple Calendar (iOS / macOS)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Google Calendar' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Microsoft Outlook' })).toBeVisible();
  });

  test('AC-2 & AC-3: Privacy summary level radio options update and persist', async ({ page }) => {
    await page.goto('/en/settings/calendar/feed');
    await expect(page.locator('[data-testid="calendar-feed-settings-page"]')).toBeVisible();

    const standardOption = page.locator('[data-testid="summary-level-option-standard"] input');
    const minimalOption = page.locator('[data-testid="summary-level-option-minimal"] input');
    const fullOption = page.locator('[data-testid="summary-level-option-full"] input');

    // 1. Toggle to an alternate option
    const isMinimal = await minimalOption.isChecked();
    const targetOption = isMinimal ? standardOption : minimalOption;
    await targetOption.click();
    await expect(targetOption).toBeChecked();
    await expect(page.getByRole('status')).toContainText('Privacy summary level updated', {
      timeout: 5000,
    });

    // 2. Reload and verify persistence
    await page.reload();
    await expect(targetOption).toBeChecked();

    // 3. Switch to Full
    await fullOption.click();
    await expect(fullOption).toBeChecked();
    await expect(page.getByRole('status')).toContainText('Privacy summary level updated', {
      timeout: 5000,
    });

    await page.reload();
    await expect(fullOption).toBeChecked();

    // 4. Restore default Standard
    await standardOption.click();
    await expect(standardOption).toBeChecked();
    await expect(page.getByRole('status')).toContainText('Privacy summary level updated', {
      timeout: 5000,
    });

    await page.reload();
    await expect(standardOption).toBeChecked();
  });

  test('AC-1, AC-4, AC-5 & AC-6: Revoke & regenerate generates new URL, invalidates old token, and provides valid iCal feed', async ({
    page,
  }) => {
    await page.goto('/en/settings/calendar/feed');
    await expect(page.locator('[data-testid="calendar-feed-settings-page"]')).toBeVisible();

    const urlInput = page.locator('[data-testid="feed-url-input"]');
    let currentUrl = await urlInput.inputValue();

    // If the token is currently masked (reloaded page), regenerate once so we have the full plaintext token URL
    if (currentUrl.includes('••••')) {
      await page.locator('[data-testid="revoke-feed-button"]').click();
      await expect(page.locator('[data-testid="revoke-confirmation-dialog"]')).toBeVisible();
      await page.locator('[data-testid="confirm-revoke-button"]').click();
      await expect(page.locator('[data-testid="revoke-confirmation-dialog"]')).not.toBeVisible();
      await expect(urlInput).not.toHaveValue(/••••/);
      currentUrl = await urlInput.inputValue();
    }

    // 1. AC-1 & AC-6: Verify current active feed URL responds with 200 and strict headers
    const feedResponse = await page.request.get(currentUrl);
    expect(feedResponse.status()).toBe(200);
    const contentType = feedResponse.headers()['content-type'] ?? '';
    expect(contentType).toContain('text/calendar');
    expect(contentType).toContain('charset=utf-8');

    const cacheControl = feedResponse.headers()['cache-control'] ?? '';
    expect(cacheControl).toContain('no-store');
    expect(cacheControl).toContain('no-cache');
    expect(cacheControl).toContain('must-revalidate');

    const bodyText = await feedResponse.text();
    expect(bodyText).toContain('BEGIN:VCALENDAR');
    expect(bodyText).toContain('END:VCALENDAR');
    expect(bodyText).toContain('\r\n');

    // 2. AC-4: Revoke feed token via confirmation dialog
    await page.locator('[data-testid="revoke-feed-button"]').click();
    const dialog = page.locator('[data-testid="revoke-confirmation-dialog"]');
    await expect(dialog).toBeVisible();

    await page.locator('[data-testid="confirm-revoke-button"]').click();
    await expect(dialog).not.toBeVisible();

    // 3. Verify new URL is displayed and differs from old
    await expect(urlInput).not.toHaveValue(currentUrl);
    const newUrl = await urlInput.inputValue();
    expect(newUrl).not.toEqual(currentUrl);
    expect(newUrl).not.toContain('••••');

    // 4. AC-4: Request with old feed URL immediately returns 404
    const oldFeedResponse = await page.request.get(currentUrl);
    expect(oldFeedResponse.status()).toBe(404);

    // 5. New feed URL immediately works and returns 200
    const newFeedResponse = await page.request.get(newUrl);
    expect(newFeedResponse.status()).toBe(200);
    const newFeedBody = await newFeedResponse.text();
    expect(newFeedBody).toContain('BEGIN:VCALENDAR');
  });

  test('AC-9: German localization renders all UI, tabs, guides, and dialogs without raw translation keys', async ({
    page,
  }) => {
    // Test that navigating to /de/settings/calendar redirects to /de/settings/calendar/feed
    await page.goto('/de/settings/calendar');
    await expect(page).toHaveURL(/\/de\/settings\/calendar\/feed/);

    await expect(page.locator('[data-testid="calendar-feed-settings-page"]')).toBeVisible();

    // Verify translated German heading and section titles
    await expect(page.locator('h1')).toContainText('Kalender-Feed-Abonnement');
    await expect(page.locator('text=Private Feed-Abonnement-URL')).toBeVisible();
    await expect(page.locator('text=Datenschutz & Detailgrad')).toBeVisible();
    await expect(page.locator('text=Feed-URL kopieren')).toBeVisible();

    // Check summary level options in German
    await expect(page.locator('text=Standard (Datenschutzfreundlich)')).toBeVisible();
    await expect(page.locator('text=Minimal (Nur gebucht)')).toBeVisible();
    await expect(page.locator('text=Vollständige Details')).toBeVisible();

    // Open revocation dialog and verify German text
    await page.locator('[data-testid="revoke-feed-button"]').click();
    const dialog = page.locator('[data-testid="revoke-confirmation-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Kalender-Feed-URL widerrufen?');
    await expect(dialog).toContainText('Abbrechen');
    await expect(page.locator('[data-testid="confirm-revoke-button"]')).toContainText(
      'Widerrufen & Neu generieren',
    );

    // Close dialog
    await page.locator('text=Abbrechen').click();
    await expect(dialog).not.toBeVisible();

    // Ensure no raw translation keys leaked
    const htmlContent = await page.content();
    expect(htmlContent).not.toMatch(/settings\.calendarFeed\.[a-zA-Z]/);
  });

  test('WCAG 2.2 AA: Accessibility audit with axe-core across light and dark themes on main view and confirmation dialog', async ({
    page,
  }) => {
    test.setTimeout(90000);

    const themes: ('light' | 'dark')[] = ['light', 'dark'];
    const viewports = [
      { name: '1280px', width: 1280, height: 800 },
      { name: '375px', width: 375, height: 812 },
    ];

    for (const theme of themes) {
      await page.emulateMedia({ colorScheme: theme });

      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/en/settings/calendar/feed');
        await expect(page.locator('[data-testid="calendar-feed-settings-page"]')).toBeVisible();

        // 1. Accessibility scan on main view
        const axeResults = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        expect(axeResults.violations).toEqual([]);

        // UX Screenshot
        await page.screenshot({
          path: path.join(UX_RUN_DIR, `feed-settings-${vp.name}-${theme}.png`),
          fullPage: true,
        });

        // 2. Open Revoke Modal and scan accessibility
        await page.locator('[data-testid="revoke-feed-button"]').click();
        const dialog = page.locator('[data-testid="revoke-confirmation-dialog"]');
        await expect(dialog).toBeVisible();

        // Wait 300ms for Radix modal fade-in CSS animation to settle (prevents false-positive contrast issues on CI)
        await page.waitForTimeout(300);

        const modalAxeResults = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        expect(modalAxeResults.violations).toEqual([]);

        if (vp.name === '1280px') {
          await page.screenshot({
            path: path.join(UX_RUN_DIR, `feed-revoke-dialog-${vp.name}-${theme}.png`),
            fullPage: false,
          });
        }

        // Close modal
        await page.locator('button:has-text("Cancel")').click();
        await expect(dialog).not.toBeVisible();
      }
    }
  });
});
