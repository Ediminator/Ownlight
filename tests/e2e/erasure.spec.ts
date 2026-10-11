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
  `../../../../control/ownlight/runs/TASK-0016/${RUN_DIR_PARAM}/ux`,
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
  await page.fill('[data-testid="given-name-input"]', 'John');
  await page.fill('[data-testid="family-name-input"]', 'Doe');
  await page.fill('[data-testid="email-input"]', `erasure-${String(Date.now())}@example.com`);
  await page.click('[data-testid="submit-client-btn"]');
  await expect(page).toHaveURL(new RegExp(`/${locale}/clients/[0-9a-f-]{36}`));
  const url = page.url();
  const match = /\/clients\/([0-9a-f-]{36})/.exec(url);
  const clientId = match?.[1];
  if (!clientId) throw new Error('Could not parse clientId from URL');
  return clientId;
}

test.describe('TASK-0016: Erasure with retention-lock awareness E2E (AC-10 to AC-13)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-10 & AC-11: Client deletion workflow in EN and DE, typed confirmation, directory redirection, and localized status message', async ({
    page,
  }) => {
    // 1. English Flow
    const clientNameEn = `E2E Delete Client EN ${String(Date.now()).slice(-4)}`;
    const clientIdEn = await createTestClient(page, clientNameEn, 'en');
    await page.goto(`/en/clients/${clientIdEn}`);

    // AC-10: Danger zone section is visible
    const dangerZone = page.locator('[data-testid="danger-zone-section"]');
    await expect(dangerZone).toBeVisible();
    await expect(dangerZone).toContainText('Danger zone');

    const deleteBtn = page.locator('[data-testid="delete-client-btn"]');
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Erasure dialog opens
    const dialog = page.locator('[data-testid="erasure-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Delete client');
    await expect(dialog).toContainText('Data to be erased');

    // Submit button is disabled before typing confirmation
    const submitBtn = page.locator('[data-testid="erasure-submit-btn"]');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeDisabled();

    // Type incorrect confirmation -> still disabled
    const confirmInput = page.locator('[data-testid="erasure-confirmation-input"]');
    await confirmInput.fill('Wrong Name');
    await expect(submitBtn).toBeDisabled();

    // Type exact client display name -> enabled
    await confirmInput.fill(clientNameEn);
    await expect(submitBtn).toBeEnabled();

    // Execute deletion
    await submitBtn.click();

    // AC-10: Navigates to directory with status banner
    await expect(page).toHaveURL(/\/en\/clients\?deleted=1/);
    const deletedBanner = page.locator('[data-testid="client-deleted-banner"]');
    await expect(deletedBanner).toBeVisible();
    await expect(deletedBanner).toContainText(
      'Client and all associated records have been erased.',
    );

    // 2. German Flow (AC-11)
    const clientNameDe = `E2E Delete Client DE ${String(Date.now()).slice(-4)}`;
    const clientIdDe = await createTestClient(page, clientNameDe, 'de');
    await page.goto(`/de/clients/${clientIdDe}`);

    // AC-11: Danger zone in German
    const dangerZoneDe = page.locator('[data-testid="danger-zone-section"]');
    await expect(dangerZoneDe).toBeVisible();
    await expect(dangerZoneDe).toContainText('Gefahrenbereich');
    await expect(dangerZoneDe).toContainText('Kunden löschen');

    await page.click('[data-testid="delete-client-btn"]');

    // Dialog in German
    const dialogDe = page.locator('[data-testid="erasure-dialog"]');
    await expect(dialogDe).toBeVisible();
    await expect(dialogDe).toContainText('Kunden löschen');
    await expect(dialogDe).toContainText('Zu löschende Daten');
    await expect(dialogDe).toContainText('Kundenprofil');
    await expect(dialogDe).toContainText('Abbrechen');

    // Confirm input prompt in German
    const confirmInputDe = page.locator('[data-testid="erasure-confirmation-input"]');
    await confirmInputDe.fill(clientNameDe);

    const submitBtnDe = page.locator('[data-testid="erasure-submit-btn"]');
    await expect(submitBtnDe).toBeEnabled();
    await submitBtnDe.click();

    // Redirection with German localized banner
    await expect(page).toHaveURL(/\/de\/clients\?deleted=1/);
    const deletedBannerDe = page.locator('[data-testid="client-deleted-banner"]');
    await expect(deletedBannerDe).toBeVisible();
    await expect(deletedBannerDe).toContainText(
      'Kunde und alle zugehörigen Daten wurden gelöscht.',
    );
  });

  test('AC-3 & AC-10: Single contact erasure on multi-contact client, notes warning, and in-place profile update', async ({
    page,
  }) => {
    const clientName = `Multi Contact Client ${String(Date.now()).slice(-4)}`;
    const clientId = await createTestClient(page, clientName, 'en');
    await page.goto(`/en/clients/${clientId}`);

    // Add a secondary contact
    await page.click('[data-testid="add-contact-btn"]');
    const contactDialog = page.locator('[data-testid="contact-dialog"]');
    await expect(contactDialog).toBeVisible();
    await page.fill('[data-testid="contact-given-name-input"]', 'Partner');
    await page.fill('[data-testid="contact-family-name-input"]', 'Person');
    await page.fill(
      '[data-testid="contact-email-input"]',
      `partner-${String(Date.now())}@example.com`,
    );
    await page.click('[data-testid="save-contact-btn"]');
    await expect(contactDialog).not.toBeVisible();

    // Both contacts are present
    const eraseButtons = page.locator('[data-testid^="erase-contact-btn-"]');
    await expect(eraseButtons).toHaveCount(2);

    // Click erase person on the secondary contact
    await eraseButtons.nth(1).click();

    const dialog = page.locator('[data-testid="erasure-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Erase person');

    // AC-3: Notes warning is displayed for contact erasure
    const notesWarning = page.locator('[data-testid="erasure-notes-warning"]');
    await expect(notesWarning).toBeVisible();
    await expect(notesWarning).toContainText('Review client notes');

    // Confirmation input asks for the contact's name
    const confirmInput = page.locator('[data-testid="erasure-confirmation-input"]');
    await confirmInput.fill('Partner Person');

    const submitBtn = page.locator('[data-testid="erasure-submit-btn"]');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Dialog closes and profile remains with 1 contact
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('[data-testid^="erase-contact-btn-"]')).toHaveCount(1);
  });

  test('AC-12: WCAG 2.2 AA Axe accessibility audit on Danger Zone and Erasure Dialog', async ({
    page,
  }) => {
    const clientId = await createTestClient(page, 'A11y Erasure Client', 'en');
    await page.goto(`/en/clients/${clientId}`);

    // Audit profile page with danger zone
    const profileScan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const profileViolations = profileScan.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(
      profileViolations,
      `Axe accessibility violations in ClientProfile with Danger Zone:\n${JSON.stringify(profileViolations, null, 2)}`,
    ).toEqual([]);

    // Open erasure dialog
    await page.click('[data-testid="delete-client-btn"]');
    const dialog = page.locator('[data-testid="erasure-dialog"]');
    await expect(dialog).toBeVisible();

    // Audit erasure dialog
    const dialogScan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const dialogViolations = dialogScan.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(
      dialogViolations,
      `Axe accessibility violations in ErasureDialog:\n${JSON.stringify(dialogViolations, null, 2)}`,
    ).toEqual([]);
  });

  test('AC-13: 320px responsive viewport, focus trap/return, touch targets >= 24px, and UX screenshots', async ({
    page,
  }) => {
    const clientName = 'Responsive Erasure Client';
    const clientId = await createTestClient(page, clientName, 'en');

    // 1. Mobile viewport at 320px width
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/en/clients/${clientId}`);

    // Check no horizontal overflow on profile
    const profileHasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(profileHasOverflow).toBe(false);

    // Open erasure dialog
    const deleteBtn = page.locator('[data-testid="delete-client-btn"]');
    await deleteBtn.click();
    const dialog = page.locator('[data-testid="erasure-dialog"]');
    await expect(dialog).toBeVisible();

    // Check no horizontal overflow in dialog at 320px
    const dialogHasOverflow = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="erasure-dialog"]');
      if (!el) return false;
      return el.scrollWidth > el.clientWidth;
    });
    expect(dialogHasOverflow).toBe(false);

    // AC-13: Touch target dimensions (>= 24px x 24px per WCAG 2.2 AA SC 2.5.8)
    const targets = [
      page.locator('[data-testid="erasure-cancel-btn"]'),
      page.locator('[data-testid="erasure-submit-btn"]'),
      page.locator('[data-testid="erasure-confirmation-input"]'),
    ];

    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box, 'Element must have visible bounding box').toBeTruthy();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(24);
        expect(box.height).toBeGreaterThanOrEqual(24);
      }
    }

    // AC-13: Focus restoration on Cancel
    await page.click('[data-testid="erasure-cancel-btn"]');
    await expect(dialog).not.toBeVisible();
    await expect(deleteBtn).toBeFocused();

    // AC-13: Focus restoration on Escape key
    await deleteBtn.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(deleteBtn).toBeFocused();

    // 2. Capture UX screenshots across required breakpoints (320px, 768px, 1280px)
    const breakpoints = [
      { name: '320px', width: 320, height: 640 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1280px', width: 1280, height: 800 },
    ];

    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto(`/en/clients/${clientId}`);

      // Capture Danger Zone screenshot
      const dangerZonePath = path.join(UX_RUN_DIR, `danger-zone-${bp.name}.png`);
      await page
        .locator('[data-testid="danger-zone-section"]')
        .screenshot({ path: dangerZonePath });
      expect(fs.existsSync(dangerZonePath)).toBe(true);

      // Open dialog and capture dialog screenshot
      await page.click('[data-testid="delete-client-btn"]');
      await expect(page.locator('[data-testid="erasure-dialog"]')).toBeVisible();

      const dialogPath = path.join(UX_RUN_DIR, `erasure-dialog-${bp.name}.png`);
      await page.screenshot({ path: dialogPath, fullPage: false });
      expect(fs.existsSync(dialogPath)).toBe(true);

      // Close dialog
      await page.click('[data-testid="erasure-cancel-btn"]');
      await expect(page.locator('[data-testid="erasure-dialog"]')).not.toBeVisible();
    }
  });
});
