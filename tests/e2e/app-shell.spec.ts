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

const TEST_AUTH_COOKIE = {
  name: 'ownlight_session',
  value: 'e2e-session-valid-token',
  url: 'http://localhost:3000',
};

test.describe('App Shell, Theming, and Internationalization E2E', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([TEST_AUTH_COOKIE]);
  });

  test('AC-1: redirects / to /de on Accept-Language: de-DE,de;q=0.9 and sets html lang=de', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      locale: 'de-DE',
      extraHTTPHeaders: {
        'Accept-Language': 'de-DE,de;q=0.9',
      },
    });
    await context.addCookies([TEST_AUTH_COOKIE]);
    const page = await context.newPage();
    await page.goto('/');

    await expect(page).toHaveURL(/\/de$/);
    const htmlLang = await page.getAttribute('html', 'lang');
    expect(htmlLang).toBe('de');
    await context.close();
  });

  test('AC-1: redirects / to /en on Accept-Language: en-US and sets html lang=en', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      locale: 'en-US',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    await context.addCookies([TEST_AUTH_COOKIE]);
    const page = await context.newPage();
    await page.goto('/');

    await expect(page).toHaveURL(/\/en$/);
    const htmlLang = await page.getAttribute('html', 'lang');
    expect(htmlLang).toBe('en');
    await context.close();
  });

  test('AC-1: falls back to /en for unsupported languages (fr-FR)', async ({ browser }) => {
    const context = await browser.newContext({
      locale: 'fr-FR',
      extraHTTPHeaders: {
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
    });
    await context.addCookies([TEST_AUTH_COOKIE]);
    const page = await context.newPage();
    await page.goto('/');

    await expect(page).toHaveURL(/\/en$/);
    const htmlLang = await page.getAttribute('html', 'lang');
    expect(htmlLang).toBe('en');
    await context.close();
  });

  test('AC-2: language switcher preserves current route and persists choice across reloads', async ({
    page,
  }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);

    // Navigate to /en/calendar
    await page.goto('/en/calendar');
    await expect(page.locator('h1')).toHaveText('Calendar');

    // Open language switcher
    await page.click('[data-testid="locale-switcher-trigger"]');
    await page.click('[data-testid="locale-option-de"]');

    // Route preserved to /de/calendar
    await expect(page).toHaveURL(/\/de\/calendar$/);
    await expect(page.locator('h1')).toHaveText('Kalender');

    // Reload page to verify persistence
    await page.reload();
    await expect(page).toHaveURL(/\/de\/calendar$/);
    await expect(page.locator('h1')).toHaveText('Kalender');

    // Open another page without locale prefix to verify cookie persistence
    await page.goto('/calendar');
    await expect(page).toHaveURL(/\/de\/calendar$/);
    await expect(page.locator('h1')).toHaveText('Kalender');
  });

  test('AC-1 & AC-2: locale switcher accessible name contains visible uppercase locale text per WCAG 2.5.3', async ({
    page,
  }) => {
    await page.goto('/en');
    const enTrigger = page.locator('[data-testid="locale-switcher-trigger"]').first();
    await expect(enTrigger).toHaveAttribute('aria-label', 'Switch language, EN');

    await page.goto('/de');
    const deTrigger = page.locator('[data-testid="locale-switcher-trigger"]').first();
    await expect(deTrigger).toHaveAttribute('aria-label', 'Sprache wechseln, DE');
  });

  test('AC-3: app shell axe audit at 320px, 768px, and 1280px viewports in English and German light and dark', async ({
    page,
  }) => {
    const testViewports = [
      { width: 320, height: 568 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
    ];
    const testLocales = ['en', 'de'];
    const testThemes: ('light' | 'dark')[] = ['light', 'dark'];

    for (const locale of testLocales) {
      for (const theme of testThemes) {
        for (const vp of testViewports) {
          await page.setViewportSize(vp);
          await page.emulateMedia({ colorScheme: theme });
          await page.goto(`/${locale}/projects`);

          await page.evaluate((t) => {
            document.documentElement.classList.remove('light', 'dark');
            document.documentElement.classList.add(t);
          }, theme);

          const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
            .analyze();

          const seriousOrCritical = results.violations.filter(
            (v) => v.impact === 'serious' || v.impact === 'critical',
          );
          expect(
            seriousOrCritical,
            `Axe violations at ${String(vp.width)}px (${locale}, ${theme})`,
          ).toEqual([]);
        }
      }
    }
  });

  test('AC-4: keyboard navigation has skip-link as first element, visible focus, and mobile drawer traps focus', async ({
    page,
  }) => {
    // 1. Skip-link test on desktop
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en');

    // Press Tab from initial page load
    await page.keyboard.press('Tab');
    const skipLink = page.locator('[data-testid="skip-link"]');
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();

    // Activate skip-link
    await page.keyboard.press('Enter');
    const mainContent = page.locator('#main-content');
    await expect(mainContent).toBeFocused();

    // 2. Mobile drawer focus trapping test
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/en');

    const menuTrigger = page.locator('[data-testid="mobile-menu-trigger"]');
    await expect(menuTrigger).toBeVisible();
    await menuTrigger.click();

    const drawer = page.locator('[data-testid="mobile-drawer"]');
    await expect(drawer).toBeVisible();

    // Tab multiple times to verify focus remains within mobile drawer
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      const isFocusedInDrawer = await drawer.evaluate((node) =>
        node.contains(document.activeElement),
      );
      expect(isFocusedInDrawer).toBe(true);
    }

    // Press Escape to close and verify focus returns to trigger
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(menuTrigger).toBeFocused();
  });

  test('AC-5: browser makes zero requests to third-party hosts on production build', async ({
    page,
  }) => {
    const thirdPartyRequests: string[] = [];

    page.on('request', (req) => {
      const url = new URL(req.url());
      if (
        url.hostname !== 'localhost' &&
        url.hostname !== '127.0.0.1' &&
        !url.protocol.startsWith('data:') &&
        !url.protocol.startsWith('blob:')
      ) {
        thirdPartyRequests.push(req.url());
      }
    });

    await page.goto('/en');
    await page.waitForLoadState('networkidle');

    expect(thirdPartyRequests).toEqual([]);
  });

  test('AC-7: applies dark theme before hydration without visible flash', async ({ browser }) => {
    const context = await browser.newContext({
      colorScheme: 'dark',
    });
    await context.addCookies([TEST_AUTH_COOKIE]);
    const page = await context.newPage();

    await page.goto('/en');

    // The dark class should be applied immediately
    const htmlClass = await page.getAttribute('html', 'class');
    expect(htmlClass).toContain('dark');

    // Verify computed background style is dark (#09090b or rgb(9, 9, 11))
    const bodyBg = await page.evaluate(
      () => window.getComputedStyle(document.body).backgroundColor,
    );
    expect(bodyBg).toBe('rgb(9, 9, 11)');

    await context.close();
  });

  test.describe('AC-3: Axe accessibility audit across all shell pages, locales, themes, and viewports', () => {
    const pages = ['/', '/leads', '/clients', '/projects', '/calendar', '/settings'];
    const viewports = [
      { name: 'mobile', width: 375, height: 667 },
      { name: 'desktop', width: 1440, height: 900 },
    ];
    const locales = ['en', 'de'];
    const themes: ('light' | 'dark')[] = ['light', 'dark'];

    for (const locale of locales) {
      for (const theme of themes) {
        for (const vp of viewports) {
          test(`AC-3: axe check ${locale} ${theme} at ${String(vp.width)}px for all shell routes`, async ({
            page,
          }) => {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await page.emulateMedia({ colorScheme: theme });

            for (const path of pages) {
              const url = `/${locale}${path === '/' ? '' : path}`;
              await page.goto(url);

              // Set theme via localStorage if needed to ensure dark/light class
              await page.evaluate((t) => {
                document.documentElement.classList.remove('light', 'dark');
                document.documentElement.classList.add(t);
              }, theme);

              const results = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
                .analyze();

              const seriousOrCritical = results.violations.filter(
                (v) => v.impact === 'serious' || v.impact === 'critical',
              );

              const summary = seriousOrCritical
                .map(
                  (v) =>
                    `${v.id} (${v.impact ?? 'unknown'}): ${v.description} on ${v.nodes.map((n) => n.html).join(', ')}`,
                )
                .join('\n');
              expect(
                seriousOrCritical,
                `Axe violations on ${url} (${theme}, ${String(vp.width)}px):\n${summary}`,
              ).toEqual([]);
            }
          });
        }
      }
    }
  });
});
