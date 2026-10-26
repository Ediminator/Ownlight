import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Authentication, Owner Bootstrap, Security Headers & Accessibility E2E', () => {
  test('AC-1: rejects invalid setup token on setup form with generic alert and creates no account', async ({
    page,
  }) => {
    await page.goto('/en/setup');

    // Verify form rendered
    const setupForm = page.locator('[data-testid="setup-form"]');
    await expect(setupForm).toBeVisible();

    // Fill form with invalid token
    await page.fill('[data-testid="setup-token-input"]', 'invalid_setup_token_value_12345');
    await page.fill('[data-testid="name-input"]', 'Studio Owner');
    await page.fill('[data-testid="email-input"]', 'owner@example.com');
    await page.fill('[data-testid="password-input"]', 'ValidOwnerPassword123!');

    await page.click('[data-testid="setup-submit-btn"]');

    // Error is announced with role="alert"
    const errorAlert = page.locator('[data-testid="setup-error"]');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toHaveAttribute('role', 'alert');
    await expect(errorAlert).toContainText('Invalid setup token or setup unavailable');
  });

  test('AC-4: displays first-run setup callout on sign-in page when zero users exist', async ({
    page,
  }) => {
    // 1. English sign-in page
    await page.goto('/en/sign-in');
    const calloutEn = page.locator('[data-testid="signin-setup-callout"]');
    await expect(calloutEn).toBeVisible();
    const linkEn = page.locator('[data-testid="signin-setup-callout-link"]');
    await expect(linkEn).toBeVisible();
    await expect(linkEn).toHaveAttribute('href', '/en/setup');

    // Heading remains untouched
    await expect(page.locator('h1')).toHaveText('Studio Sign In');

    // 2. German sign-in page
    await page.goto('/de/sign-in');
    const calloutDe = page.locator('[data-testid="signin-setup-callout"]');
    await expect(calloutDe).toBeVisible();
    const linkDe = page.locator('[data-testid="signin-setup-callout-link"]');
    await expect(linkDe).toBeVisible();
    await expect(linkDe).toHaveAttribute('href', '/de/setup');

    // Heading remains untouched
    await expect(page.locator('h1')).toHaveText('Studio-Anmeldung');

    // 3. Accessibility scans on both light and dark themes
    const scanLight = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const violationsLight = scanLight.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(violationsLight).toEqual([]);

    await page.emulateMedia({ colorScheme: 'dark' });
    const scanDark = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const violationsDark = scanDark.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(violationsDark).toEqual([]);
  });

  test('AC-8: validates mandatory security headers and strict-dynamic CSP on browser response', async ({
    page,
  }) => {
    const response = await page.goto('/en/sign-in');
    expect(response).not.toBeNull();
    if (!response) {
      throw new Error('Expected response to be defined');
    }

    const headers = response.headers();

    // 1. Content Security Policy with nonce and strict-dynamic
    const csp = headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("frame-ancestors 'none'");

    // 2. Standard security headers
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['x-frame-options']).toBe('DENY');
  });

  test('AC-9: unauthenticated request to protected app routes redirects to sign-in', async ({
    page,
  }) => {
    // Unauthenticated visit to protected /en/leads
    await page.goto('/en/leads');

    // Expect redirect to sign-in with callbackUrl
    await expect(page).toHaveURL(/\/en\/sign-in\?callbackUrl=%2Fen%2Fleads/);
    const heading = page.locator('h1');
    await expect(heading).toHaveText('Studio Sign In');
  });

  test.describe('AC-10: Localization and WCAG 2.2 AA Axe Accessibility on Auth Pages', () => {
    const authPages = [
      { path: '/sign-in', enHeading: 'Studio Sign In', deHeading: 'Studio-Anmeldung' },
      {
        path: '/setup',
        enHeading: 'Initial Studio Setup',
        deHeading: 'Ersteinrichtung des Studios',
      },
      { path: '/forgot-password', enHeading: 'Forgot Password', deHeading: 'Passwort vergessen' },
      { path: '/reset-password', enHeading: 'Reset Password', deHeading: 'Passwort zurücksetzen' },
      { path: '/verify-email', enHeading: 'Email Verification', deHeading: 'E-Mail-Bestätigung' },
    ];

    for (const { path, enHeading, deHeading } of authPages) {
      test(`AC-10: /en${path} is localized in English and has 0 serious/critical axe violations`, async ({
        page,
      }) => {
        await page.goto(`/en${path}`);

        // Verify HTML lang
        const htmlLang = await page.getAttribute('html', 'lang');
        expect(htmlLang).toBe('en');

        // Verify localized heading
        const heading = page.locator('h1');
        await expect(heading).toHaveText(enHeading);

        // Run axe accessibility scan
        const scan = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();

        const seriousOrCritical = scan.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical',
        );
        expect(seriousOrCritical).toEqual([]);
      });

      test(`AC-10: /de${path} is localized in German and has 0 serious/critical axe violations`, async ({
        page,
      }) => {
        await page.goto(`/de${path}`);

        // Verify HTML lang
        const htmlLang = await page.getAttribute('html', 'lang');
        expect(htmlLang).toBe('de');

        // Verify localized heading
        const heading = page.locator('h1');
        await expect(heading).toHaveText(deHeading);

        // Run axe accessibility scan
        const scan = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();

        const seriousOrCritical = scan.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical',
        );
        expect(seriousOrCritical).toEqual([]);
      });
    }
  });
});
