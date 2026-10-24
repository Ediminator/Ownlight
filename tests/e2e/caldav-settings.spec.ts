import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';
import {
  createFakeCaldavServer,
  type FakeCaldavServerInstance,
} from '../helpers/fake-caldav-server';

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

test.describe('TASK-0047: CalDAV Settings Integration E2E & A11y', () => {
  test.setTimeout(90000);

  let fakeCaldav: FakeCaldavServerInstance;
  const testUser = 'photographer@example.org';
  const testPassword = 'secret-app-password-xyz';

  test.beforeAll(async () => {
    fakeCaldav = await createFakeCaldavServer({
      expectedUser: testUser,
      expectedPass: testPassword,
    });
  });

  test.afterAll(async () => {
    await fakeCaldav.close();
  });

  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-7: CalDAV settings wizard validates inputs, connects account, syncs, disconnects, and passes WCAG 2.2 AA in light & dark mode', async ({
    page,
  }) => {
    await page.goto('/en/settings/integrations/caldav');

    // 1. Initial disconnected state
    const statusBadge = page.locator('[data-testid="caldav-status-badge"]');
    await expect(statusBadge).toBeVisible();

    const wizardCard = page.locator('[data-testid="caldav-wizard-card"]');
    await expect(wizardCard).toBeVisible();

    // 2. Validate empty submission triggers programmatic form error association (WCAG 3.3.1)
    const testConnectBtn = page.locator('[data-testid="caldav-test-connect-button"]');
    await testConnectBtn.click();

    const urlError = page.locator('[data-testid="caldav-server-url-error"]');
    await expect(urlError).toBeVisible();
    await expect(page.locator('#caldav-server-url')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#caldav-server-url')).toHaveAttribute(
      'aria-describedby',
      'caldav-server-url-error',
    );

    // 3. Accessibility audit in wizard view (light mode)
    const lightAxeWizard = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const lightWizardViolations = lightAxeWizard.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(lightWizardViolations).toEqual([]);

    // 4. Fill credentials and test connection
    await page.locator('[data-testid="caldav-server-url-input"]').fill(fakeCaldav.baseUrl);
    await page.locator('[data-testid="caldav-username-input"]').fill(testUser);
    await page.locator('[data-testid="caldav-password-input"]').fill(testPassword);

    await testConnectBtn.click();

    // 5. Calendar picker step appears
    const calendarSelect = page.locator('[data-testid="caldav-calendar-select"]');
    await expect(calendarSelect).toBeVisible();

    const saveConnectBtn = page.locator('[data-testid="caldav-save-connect-button"]');
    await expect(saveConnectBtn).toBeVisible();

    // 6. Save and connect calendar
    await saveConnectBtn.click();

    // 7. Active card view appears
    const activeCard = page.locator('[data-testid="caldav-active-card"]');
    await expect(activeCard).toBeVisible();
    await expect(page.locator('[data-testid="caldav-status-badge"]')).toContainText('Connected');
    await expect(page.locator('[data-testid="caldav-display-username"]')).toContainText(testUser);

    // 8. Accessibility audit in active card view (light mode)
    const lightAxeActive = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const lightActiveViolations = lightAxeActive.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(lightActiveViolations).toEqual([]);

    // 9. Accessibility audit in active card view (dark mode)
    await page.emulateMedia({ colorScheme: 'dark' });
    const darkAxeActive = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const darkActiveViolations = darkAxeActive.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(darkActiveViolations).toEqual([]);
    await page.emulateMedia({ colorScheme: 'light' });

    // 10. Trigger manual sync
    const syncNowBtn = page.locator('[data-testid="caldav-sync-now-button"]');
    await expect(syncNowBtn).toBeVisible();
    await syncNowBtn.click();

    const successAlert = page.locator('[data-testid="caldav-success-alert"]');
    await expect(successAlert).toBeVisible();

    // 11. Disconnect flow
    const disconnectBtn = page.locator('[data-testid="caldav-disconnect-button"]');
    await disconnectBtn.click();

    const disconnectDialog = page.locator('[data-testid="caldav-disconnect-dialog"]');
    await expect(disconnectDialog).toBeVisible();
    // Wait 300ms for Radix Dialog CSS animation to settle
    await page.waitForTimeout(300);

    // Axe check on modal dialog
    const modalAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const modalViolations = modalAxe.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(modalViolations).toEqual([]);

    // Confirm disconnect
    const confirmDisconnectBtn = page.locator('[data-testid="caldav-confirm-disconnect-button"]');
    await confirmDisconnectBtn.click();

    // Returned to disconnected wizard view
    await expect(disconnectDialog).not.toBeVisible();
    await expect(page.locator('[data-testid="caldav-wizard-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="caldav-status-badge"]')).toContainText('Disconnected');
  });

  test('AC-7: renders German locale (/de/settings/integrations/caldav) with localized text and passes axe audit', async ({
    page,
  }) => {
    await page.goto('/de/settings/integrations/caldav');

    const htmlLang = await page.getAttribute('html', 'lang');
    expect(htmlLang).toBe('de');

    const heading = page.locator('h1');
    await expect(heading).toContainText('CalDAV-Kalendersynchronisation');

    const wizardCard = page.locator('[data-testid="caldav-wizard-card"]');
    await expect(wizardCard).toBeVisible();
    await expect(wizardCard).toContainText('CalDAV-Server verbinden');

    const testBtn = page.locator('[data-testid="caldav-test-connect-button"]');
    await expect(testBtn).toContainText('Verbindung testen & Kalender finden');

    // Run axe check in de locale
    const deAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const deViolations = deAxe.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(deViolations).toEqual([]);
  });
});
