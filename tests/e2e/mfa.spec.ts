import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { generateTotpCode } from '@/server/auth/totp';
import {
  E2E_OWNER_EMAIL,
  E2E_OWNER_PASSWORD,
  setE2eStudioMfaSettings,
  clearE2eUserMfaCredentials,
} from '../helpers/e2e-global-setup';

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

test.describe('TASK-0008: Multi-Factor Authentication (MFA) & Passkeys E2E', () => {
  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test.afterAll(async () => {
    await setE2eStudioMfaSettings(false, null);
  });

  test('AC-1: TOTP enrolment renders local QR code SVG, text alternative, and handles positive code verification with recovery codes display', async ({
    page,
  }) => {
    // Intercept third-party network requests to verify local vector SVG rendering
    const externalRequests: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        externalRequests.push(req.url());
      }
    });

    await page.goto('/en/settings/security');
    await expect(page.locator('h1')).toHaveText('Security & Multi-Factor Authentication');

    // Click setup TOTP button
    const setupBtn = page.locator('[data-testid="setup-totp-btn"]');
    await expect(setupBtn).toBeVisible();
    await setupBtn.click();

    // Verify enrolment panel opened
    const enrolmentPanel = page.locator('[data-testid="totp-enrolment-panel"]');
    await expect(enrolmentPanel).toBeVisible();

    // Verify local QR code SVG is rendered without external requests
    const qrSvg = page.locator('[data-testid="totp-qr-code"] svg');
    await expect(qrSvg).toBeVisible();
    expect(externalRequests).toEqual([]);

    // Verify text alternative (manual secret key) is present
    const manualSecretEl = page.locator('[data-testid="totp-manual-secret"]');
    await expect(manualSecretEl).toBeVisible();
    const manualSecret = (await manualSecretEl.textContent())?.trim() ?? '';
    expect(manualSecret.length).toBeGreaterThanOrEqual(16);
    expect(manualSecret).toMatch(/^[A-Z2-7]+$/);

    // Verify copy secret button is available
    await expect(page.locator('[data-testid="copy-secret-btn"]')).toBeVisible();

    // 1. Submit invalid verification code
    await page.fill('[data-testid="totp-verify-input"]', '000000');
    await page.click('[data-testid="totp-activate-btn"]');

    // Error alert is shown with role="alert"
    const errorAlert = page.locator('[data-testid="security-error-alert"]');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toHaveAttribute('role', 'alert');

    // 2. Submit genuine, valid TOTP code computed from the revealed secret (positive flow)
    const validTotpCode = generateTotpCode(manualSecret);
    await page.fill('[data-testid="totp-verify-input"]', validTotpCode);
    await page.click('[data-testid="totp-activate-btn"]');

    // Assert recovery codes modal appears with 10 single-use codes (AC-1, I1-V03, I1-V06)
    const recoveryModal = page.locator('[data-testid="recovery-codes-display"]');
    await expect(recoveryModal).toBeVisible();

    const codeItems = page.locator('[data-testid="recovery-code-item"]');
    await expect(codeItems).toHaveCount(10);

    // Assert copy and download buttons are accessible
    await expect(page.locator('[data-testid="copy-recovery-codes-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="download-recovery-codes-btn"]')).toBeVisible();

    // Confirm and dismiss recovery codes
    await page.click('[data-testid="confirm-recovery-codes-btn"]');
    await expect(recoveryModal).not.toBeVisible();

    // Verify TOTP status badge is now active
    const statusBadge = page.locator('[data-testid="totp-status-badge"]');
    await expect(statusBadge).toBeVisible();
    await expect(statusBadge).toContainText(/Active|Aktiv/i);

    // Clean up TOTP so subsequent tests run with an un-enrolled state
    const disableBtn = page.locator('[data-testid="disable-totp-btn"]');
    await expect(disableBtn).toBeVisible();
    await disableBtn.click();
    const reauthInput = page.locator('[data-testid="reauth-password-input"]');
    if (await reauthInput.isVisible({ timeout: 1500 }).catch(() => false)) {
      await reauthInput.fill(E2E_OWNER_PASSWORD);
      await page.click('[data-testid="reauth-submit-btn"]');
    }
    await expect(page.locator('[data-testid="setup-totp-btn"]')).toBeVisible({ timeout: 5000 });
  });

  test('AC-2: Sign-in view presents passkey option and handles credentials sign-in', async ({
    page,
    context,
  }) => {
    // Clear cookies to test sign-in form
    await context.clearCookies();
    await page.goto('/en/sign-in');

    // Verify standard sign-in form elements
    await expect(page.locator('[data-testid="signin-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="email-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="signin-submit-btn"]')).toBeVisible();

    // Verify WebAuthn passkey sign-in option is present
    const passkeyBtn = page.locator('[data-testid="passkey-signin-btn"]');
    await expect(passkeyBtn).toBeVisible();

    // Sign in with genuine owner credentials
    await page.fill('[data-testid="email-input"]', E2E_OWNER_EMAIL);
    await page.fill('[data-testid="password-input"]', E2E_OWNER_PASSWORD);
    await page.click('[data-testid="signin-submit-btn"]');

    // Either redirected to app shell or prompted for MFA
    await expect(page).not.toHaveURL(/\/sign-in$/);
  });

  test('AC-5: Passkey registration, passwordless sign-in, and deletion with CDP virtual authenticator', async ({
    page,
    context,
  }) => {
    // Enable Chrome DevTools Protocol virtual authenticator for WebAuthn (AC-5, I1-V02, I1-V04, I1-S06)
    const cdpClient = await context.newCDPSession(page);
    await cdpClient.send('WebAuthn.enable');
    await cdpClient.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    });

    await page.goto('/en/settings/security');

    // 1. Open passkey registration form
    const registerBtn = page.locator('[data-testid="register-passkey-btn"]');
    await expect(registerBtn).toBeVisible();
    await registerBtn.click();

    const passkeyForm = page.locator('[data-testid="passkey-register-form"]');
    await expect(passkeyForm).toBeVisible();
    await expect(page.locator('[data-testid="passkey-name-input"]')).toBeVisible();

    // 2. Submit passkey registration
    await page.fill('[data-testid="passkey-name-input"]', 'YubiKey 5C NFC');
    await page.click('[data-testid="passkey-submit-btn"]');

    // Assert passkey appears in the registered list
    const passkeyList = page.locator('[data-testid="passkeys-list"]');
    await expect(passkeyList).toBeVisible();
    await expect(passkeyList).toContainText('YubiKey 5C NFC');

    // 3. Test passwordless sign-in with passkey
    await context.clearCookies();
    await page.goto('/en/sign-in');

    const passkeySignInBtn = page.locator('[data-testid="passkey-signin-btn"]');
    await expect(passkeySignInBtn).toBeVisible();
    await passkeySignInBtn.click();

    // Verify redirected away from sign-in after successful passkey authentication
    await expect(page).not.toHaveURL(/\/sign-in/);

    // 4. Return to settings and delete the registered passkey
    await page.goto('/en/settings/security');
    const deleteBtn = page.locator('[data-testid="delete-passkey-btn"]').first();
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // If re-auth modal opens, enter password
    const reauthInput = page.locator('[data-testid="reauth-password-input"]');
    try {
      await reauthInput.waitFor({ state: 'visible', timeout: 2000 });
      await reauthInput.fill(E2E_OWNER_PASSWORD);
      await page.click('[data-testid="reauth-submit-btn"]');
    } catch {
      // Re-authentication was not prompted
    }

    // Assert passkey is removed
    await expect(passkeyList).not.toContainText('YubiKey 5C NFC');

    // 5. Verify deleted passkey is rejected upon subsequent sign-in attempt (AC-5, I2-V03)
    await context.clearCookies();
    await page.goto('/en/sign-in');
    const passkeyBtnAfterDelete = page.locator('[data-testid="passkey-signin-btn"]');
    await expect(passkeyBtnAfterDelete).toBeVisible();
    await passkeyBtnAfterDelete.click();
    await expect(page.locator('[data-testid="signin-error"]')).toBeVisible();
  });

  test('AC-8: Forced MFA enrolment intercepts navigation from protected routes and allows postponement', async ({
    page,
    context,
  }) => {
    try {
      // 1. Configure studio settings with mfa_required=true and postponement expired in the past (AC-8, I2-V01, I2-V02)
      const pastDate = new Date(Date.now() - 3600 * 1000); // 1 hour ago
      await setE2eStudioMfaSettings(true, pastDate);
      await clearE2eUserMfaCredentials();

      // 2. Clear cookies and sign in with owner credentials (without MFA configured)
      await context.clearCookies();
      await page.goto('/en/sign-in');
      await page.fill('[data-testid="email-input"]', E2E_OWNER_EMAIL);
      await page.fill('[data-testid="password-input"]', E2E_OWNER_PASSWORD);
      await page.click('[data-testid="signin-submit-btn"]');

      // Assert sign-in automatically forces redirect to security settings with mfa_enforced=1
      await expect(page).toHaveURL(/\/settings\/security\?mfa_enforced=1/);

      // 3. Attempt to navigate directly to a protected app route (/en/settings) before enrolling MFA
      await page.goto('/en/settings');

      // Assert automatic interception/redirection back to /settings/security?mfa_enforced=1
      await expect(page).toHaveURL(/\/settings\/security\?mfa_enforced=1/);

      // 4. Verify alert banner is rendered with role="alert"
      const alert = page.locator('[data-testid="mfa-enforcement-alert"]');
      await expect(alert).toBeVisible();
      await expect(alert).toHaveAttribute('role', 'alert');
      await expect(alert).toContainText(
        /Multi-factor authentication is required|Mehrstufige Authentifizierung ist erforderlich/i,
      );

      // 5. Verify postponement button is rendered and functional
      const postponeBtn = page.locator('[data-testid="postpone-mfa-btn"]');
      await expect(postponeBtn).toBeVisible();
      await postponeBtn.click();

      // Verify postponement success notice appears
      const successAlert = page.locator('[data-testid="security-success-alert"]');
      await expect(successAlert).toBeVisible();

      // 6. Verify owner can now navigate to protected app route (/en/settings) without being intercepted
      await page.goto('/en/settings');
      await expect(page).toHaveURL(/\/en\/settings$/);
    } finally {
      // 7. Cleanup: reset studio settings
      await setE2eStudioMfaSettings(false, null);
    }
  });

  test.describe('AC-7: Localization & WCAG 2.2 AA Axe Accessibility on Security Settings', () => {
    const viewports = [
      { name: 'mobile (375px)', width: 375, height: 667 },
      { name: 'desktop (1440px)', width: 1440, height: 900 },
    ];

    for (const vp of viewports) {
      test(`AC-7: /en/settings/security is localized in English and has 0 serious/critical axe violations at ${vp.name}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/en/settings/security');

        // Verify HTML lang
        const htmlLang = await page.getAttribute('html', 'lang');
        expect(htmlLang).toBe('en');

        // Verify localized headings
        const h1 = page.locator('h1');
        await expect(h1).toHaveText('Security & Multi-Factor Authentication');
        await expect(page.getByRole('heading', { name: 'Authenticator App (TOTP)' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Passkeys (WebAuthn)' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Active Sessions' })).toBeVisible();

        // Run axe accessibility audit
        const scan = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();

        const seriousOrCritical = scan.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical',
        );
        expect(seriousOrCritical).toEqual([]);
      });

      test(`AC-7: /de/settings/security is localized in German and has 0 serious/critical axe violations at ${vp.name}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/de/settings/security');

        // Verify HTML lang
        const htmlLang = await page.getAttribute('html', 'lang');
        expect(htmlLang).toBe('de');

        // Verify localized headings
        const h1 = page.locator('h1');
        await expect(h1).toHaveText('Sicherheit & Multi-Faktor-Authentifizierung');
        await expect(
          page.getByRole('heading', { name: 'Authentifikator-App (TOTP)' }),
        ).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Passkeys (WebAuthn)' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Aktive Sitzungen' })).toBeVisible();

        // Run axe accessibility audit
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
