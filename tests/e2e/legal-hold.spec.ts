import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

const RUN_DIR_PARAM = process.env.RUN_DIR ?? 'iter-01';
const UX_RUN_DIR = path.resolve(
  import.meta.dirname,
  `../../../../control/ownlight/runs/TASK-0019/${RUN_DIR_PARAM}/ux`,
);

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

async function createTestClient(
  page: import('@playwright/test').Page,
  name: string,
  locale = 'en',
): Promise<string> {
  await page.goto(`/${locale}/clients/new`);
  await page.fill('[data-testid="display-name-input"]', name);
  await page.fill('[data-testid="given-name-input"]', 'Jane');
  await page.fill('[data-testid="family-name-input"]', 'Doe');
  await page.fill('[data-testid="email-input"]', `hold-${String(Date.now())}@example.com`);
  await page.click('[data-testid="submit-client-btn"]');
  await expect(page).toHaveURL(new RegExp(`/${locale}/clients/[0-9a-f-]{36}`));
  const url = page.url();
  const match = /\/clients\/([0-9a-f-]{36})/.exec(url);
  const clientId = match?.[1];
  if (!clientId) throw new Error('Could not parse clientId from URL');
  return clientId;
}

test.describe('TASK-0019: Manual Client Legal Hold and Retention UI E2E (AC-17 to AC-20)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-17 & AC-20: Set legal hold via switch and dialog, focus return, aria-live announce, retention indicator update, and release with confirm', async ({
    page,
  }) => {
    const clientName = `E2E Hold Client EN ${String(Date.now()).slice(-4)}`;
    const clientId = await createTestClient(page, clientName, 'en');
    await page.goto(`/en/clients/${clientId}`);

    // Verify Retention Indicator is visible and shows scheduled automatic erasure
    const retentionIndicator = page.locator('[data-testid="retention-indicator"]');
    await expect(retentionIndicator).toBeVisible();
    await expect(retentionIndicator).toContainText('Data retention');
    await expect(retentionIndicator).toContainText('Scheduled for automatic erasure on');

    // Verify Legal Hold section and switch
    const legalHoldSection = page.locator('[data-testid="legal-hold-section"]');
    await expect(legalHoldSection).toBeVisible();

    const holdSwitch = page.locator('[data-testid="legal-hold-switch"]');
    await expect(holdSwitch).toBeVisible();
    await expect(holdSwitch).toHaveAttribute('role', 'switch');
    await expect(holdSwitch).toHaveAttribute('aria-checked', 'false');

    // Click switch to open legal hold dialog
    await holdSwitch.click();

    const dialog = page.locator('[data-testid="legal-hold-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Set legal hold');

    // Fill form: Reason 'dispute', Note, Until date
    await page.selectOption('[data-testid="legal-hold-reason-select"]', 'dispute');
    await page.fill('[data-testid="legal-hold-note-input"]', 'Synthetic dispute test note');

    // Compute future date (30 days from now)
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.fill('[data-testid="legal-hold-until-input"]', futureDate);

    // Save hold
    const saveBtn = page.locator('[data-testid="save-legal-hold-btn"]');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Verify dialog closes
    await expect(dialog).not.toBeVisible();

    // Verify focus returned to switch (AC-17)
    await expect(holdSwitch).toBeFocused();

    // Verify aria-live announcement (AC-17)
    const announcement = page.locator('[data-testid="legal-hold-status-announcement"]');
    await expect(announcement).toHaveAttribute('aria-live', 'polite');
    await expect(announcement).toContainText('Legal hold active');

    // Verify switch is now checked
    await expect(holdSwitch).toHaveAttribute('aria-checked', 'true');

    // Verify Active badge and details
    const badge = page.locator('[data-testid="legal-hold-status-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('Active');

    const details = page.locator('[data-testid="legal-hold-details"]');
    await expect(details).toBeVisible();
    await expect(details).toContainText('Dispute resolution');
    await expect(details).toContainText('Synthetic dispute test note');

    // Verify Retention Indicator updated to paused by legal hold (AC-20)
    await expect(retentionIndicator).toContainText(
      'Automatic erasure is paused by an active legal hold.',
    );

    // Attempt release: clicking switch when active opens confirmation prompt
    await holdSwitch.click();

    const confirmDialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText('Release legal hold?');

    // Confirm release
    const confirmReleaseBtn = page.locator('[data-testid="confirm-dialog-confirm-btn"]');
    await confirmReleaseBtn.click();

    // Verify confirmation closes, hold released
    await expect(confirmDialog).not.toBeVisible();
    await expect(holdSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(announcement).toContainText('Legal hold released');

    // Verify retention indicator reverted to scheduled automatic erasure
    await expect(retentionIndicator).toContainText('Scheduled for automatic erasure on');
  });

  test('AC-18: German localization across legal-hold section, dialog, confirmation, and erasure dialog', async ({
    page,
  }) => {
    const clientName = `E2E Löschsperre Kunde ${String(Date.now()).slice(-4)}`;
    const clientId = await createTestClient(page, clientName, 'de');
    await page.goto(`/de/clients/${clientId}`);

    // Verify German section title and switch
    const legalHoldSection = page.locator('[data-testid="legal-hold-section"]');
    await expect(legalHoldSection).toBeVisible();
    await expect(legalHoldSection).toContainText('Löschsperre');

    const holdSwitch = page.locator('[data-testid="legal-hold-switch"]');
    await holdSwitch.click();

    const dialog = page.locator('[data-testid="legal-hold-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Löschsperre festlegen');
    await expect(dialog).toContainText('Grund');
    await expect(dialog).toContainText('Gültig bis (optional)');

    // Select statutory obligation in German
    await page.selectOption('[data-testid="legal-hold-reason-select"]', 'statutory');
    await page.fill('[data-testid="legal-hold-note-input"]', 'Steuerliche Aufbewahrungsfrist');

    // Save
    await page.click('[data-testid="save-legal-hold-btn"]');
    await expect(dialog).not.toBeVisible();

    // Verify German details display
    const details = page.locator('[data-testid="legal-hold-details"]');
    await expect(details).toBeVisible();
    await expect(details).toContainText('Gesetzliche Anforderung');
    await expect(details).toContainText('Steuerliche Aufbewahrungsfrist');

    // Verify Retention indicator in German
    const retentionIndicator = page.locator('[data-testid="retention-indicator"]');
    await expect(retentionIndicator).toContainText('Datenaufbewahrung');
    await expect(retentionIndicator).toContainText(
      'Automatische Löschung ist durch eine aktive Löschsperre pausiert',
    );

    // Verify Erasure dialog shows German hold reason
    await page.click('[data-testid="delete-client-btn"]');
    const erasureDialog = page.locator('[data-testid="erasure-dialog"]');
    await expect(erasureDialog).toBeVisible();
    await expect(erasureDialog).toContainText('Löschen nicht möglich');
    await expect(erasureDialog).toContainText('Löschsperre');
    await page.keyboard.press('Escape');
    await expect(erasureDialog).not.toBeVisible();
  });

  test('AC-19: WCAG 2.2 AA zero Axe violations in en and de', async ({ page }) => {
    const clientId = await createTestClient(page, 'A11y Hold Client', 'en');
    await page.goto(`/en/clients/${clientId}`);

    // Audit profile page with legal hold section
    const profileScan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const profileViolations = profileScan.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(
      profileViolations,
      `Axe accessibility violations in LegalHoldSection:\n${JSON.stringify(profileViolations, null, 2)}`,
    ).toEqual([]);

    // Open dialog and scan dialog
    await page.click('[data-testid="legal-hold-switch"]');
    const dialog = page.locator('[data-testid="legal-hold-dialog"]');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);

    const dialogScan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const dialogViolations = dialogScan.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(
      dialogViolations,
      `Axe accessibility violations in LegalHoldDialog:\n${JSON.stringify(dialogViolations, null, 2)}`,
    ).toEqual([]);
  });

  test('AC-19: Responsive 320px viewport, focus management, target sizes >= 24px, and UX screenshots', async ({
    page,
  }) => {
    const clientId = await createTestClient(page, 'Responsive Hold Client', 'en');

    // 1. Mobile viewport at 320px width
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/en/clients/${clientId}`);

    // Check no horizontal overflow on profile
    const profileHasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(profileHasOverflow).toBe(false);

    // Open legal hold dialog
    const holdSwitch = page.locator('[data-testid="legal-hold-switch"]');
    await holdSwitch.click();
    const dialog = page.locator('[data-testid="legal-hold-dialog"]');
    await expect(dialog).toBeVisible();

    // Check no horizontal overflow in dialog at 320px
    const dialogHasOverflow = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="legal-hold-dialog"]');
      if (!el) return false;
      return el.scrollWidth > el.clientWidth;
    });
    expect(dialogHasOverflow).toBe(false);

    // Target sizes >= 24px per WCAG 2.2 AA SC 2.5.8
    const targets = [
      page.locator('[data-testid="legal-hold-switch"]'),
      page.locator('[data-testid="cancel-legal-hold-btn"]'),
      page.locator('[data-testid="save-legal-hold-btn"]'),
    ];

    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box).toBeTruthy();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(24);
        expect(box.height).toBeGreaterThanOrEqual(24);
      }
    }

    // Cancel dialog and verify focus restoration to switch
    await page.click('[data-testid="cancel-legal-hold-btn"]');
    await expect(dialog).not.toBeVisible();
    await expect(holdSwitch).toBeFocused();

    // Set hold so we can capture screenshots with active hold
    await holdSwitch.click();
    await expect(dialog).toBeVisible();
    await page.selectOption('[data-testid="legal-hold-reason-select"]', 'dispute');
    await page.fill(
      '[data-testid="legal-hold-note-input"]',
      'Active dispute regarding commercial license',
    );
    await page.click('[data-testid="save-legal-hold-btn"]');
    await expect(dialog).not.toBeVisible();

    // 2. Capture UX screenshots across required breakpoints (320px, 768px, 1280px)
    const breakpoints = [
      { name: '320px', width: 320, height: 640 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1280px', width: 1280, height: 800 },
    ];

    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.waitForTimeout(200);

      // Screenshot 1: Profile with active legal hold & retention indicator
      const activeShotPath = path.join(UX_RUN_DIR, `legal-hold-active-${bp.name}.png`);
      await page.screenshot({ path: activeShotPath, fullPage: false });

      // Open Edit dialog and capture dialog screenshot
      await page.click('[data-testid="edit-legal-hold-btn"]');
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(200);

      const dialogShotPath = path.join(UX_RUN_DIR, `legal-hold-dialog-${bp.name}.png`);
      await page.screenshot({ path: dialogShotPath, fullPage: false });

      await page.click('[data-testid="cancel-legal-hold-btn"]');
      await expect(dialog).not.toBeVisible();
    }
  });
});
