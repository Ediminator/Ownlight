import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';
import {
  E2E_LEAD_CONTACTED_ID,
  E2E_LEAD_CONVERTED_ID,
  E2E_LEAD_CONVERT_TARGET_ID,
  E2E_LEAD_DUPLICATE_ID,
} from '../helpers/e2e-leads-helper';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

const RUN_DIR_PARAM = process.env.RUN_DIR ?? 'iter-01';
const UX_RUN_DIR = path.resolve(
  import.meta.dirname,
  `../../../../control/ownlight/runs/TASK-0032/${RUN_DIR_PARAM}/ux`,
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

test.describe('TASK-0032: Lead to Client Conversion UI & A11y (AC-1, AC-2, AC-6, AC-10, AC-11)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-1: unconverted lead converts to new client and redirects to client profile', async ({
    page,
  }) => {
    await page.goto(`/en/leads/${E2E_LEAD_CONVERT_TARGET_ID}`);

    const convertBtn = page.locator('[data-testid="convert-lead-btn"]').first();
    await expect(convertBtn).toBeVisible();
    await convertBtn.click();

    // Modal opens
    const dialog = page.locator('[data-testid="convert-lead-dialog"]');
    await expect(dialog).toBeVisible();

    // Check preview card contains lead details
    await expect(dialog).toContainText('Clara Oswald');
    await expect(dialog).toContainText('clara.oswald@example.com');

    // Confirm conversion
    const confirmBtn = page.locator('[data-testid="confirm-convert-btn"]');
    await confirmBtn.click();

    // Redirects to client profile
    await expect(page).toHaveURL(/\/en\/clients\/[0-9a-f-]{36}/, { timeout: 10000 });
    await expect(page.locator('h1')).toContainText('Clara Oswald');

    // Navigate back to lead to verify converted banner
    await page.goto(`/en/leads/${E2E_LEAD_CONVERT_TARGET_ID}`);
    const banner = page.locator('[data-testid="lead-converted-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Converted to client');

    // Convert button and status buttons are hidden
    await expect(page.locator('[data-testid="convert-lead-btn"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="mark-contacted-btn"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="mark-spam-btn"]')).toHaveCount(0);
  });

  test('AC-2: duplicate email alert displays matching client and allows linking to existing client', async ({
    page,
  }) => {
    await page.goto(`/en/leads/${E2E_LEAD_DUPLICATE_ID}`);

    const convertBtn = page.locator('[data-testid="convert-lead-btn"]').first();
    await expect(convertBtn).toBeVisible();
    await convertBtn.click();

    // Modal opens
    const dialog = page.locator('[data-testid="convert-lead-dialog"]');
    await expect(dialog).toBeVisible();

    // Duplicate alert is displayed
    const duplicateAlert = page.locator('[data-testid="duplicate-alert"]');
    await expect(duplicateAlert).toBeVisible();
    await expect(duplicateAlert).toContainText('Brice Steuber');
    await expect(duplicateAlert).toContainText('maci.weimann.1.0@example.org');

    // Capture screenshot of duplicate alert
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'lead-conversion-duplicate-alert-1280px-light.png'),
    });

    // Select "Link to existing client" mode
    await page.locator('[data-testid="mode-existing-client"]').click();

    // Existing client select is visible
    const clientSelect = page.locator('[data-testid="existing-client-select"]');
    await expect(clientSelect).toBeVisible();

    // Confirm conversion in existing_client mode
    const confirmBtn = page.locator('[data-testid="confirm-convert-btn"]');
    await confirmBtn.click();

    // Redirects to the existing client's profile
    await expect(page).toHaveURL(/\/en\/clients\/[0-9a-f-]{36}/, { timeout: 10000 });
    await expect(page.locator('h1')).toContainText('Brice Steuber');
  });

  test('AC-6: already converted lead displays converted banner and hides convert action', async ({
    page,
  }) => {
    await page.goto(`/en/leads/${E2E_LEAD_CONVERTED_ID}`);

    const banner = page.locator('[data-testid="lead-converted-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Converted to client');

    const clientLink = page.locator('[data-testid="converted-client-link"]');
    await expect(clientLink).toBeVisible();

    // Action buttons are hidden
    await expect(page.locator('[data-testid="convert-lead-btn"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="mark-contacted-btn"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="delete-lead-btn"]')).toHaveCount(0);

    // Capture banner screenshot (light)
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'lead-converted-banner-1280px-light.png'),
    });

    // Capture banner screenshot (dark)
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'lead-converted-banner-1280px-dark.png'),
    });
  });

  test('AC-10: German locale /de/leads/{id} renders conversion dialog and banner in German', async ({
    page,
  }) => {
    await page.goto(`/de/leads/${E2E_LEAD_CONTACTED_ID}`);

    // HTML lang is de
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');

    // Button is localized
    const convertBtn = page.locator('[data-testid="convert-lead-btn"]').first();
    await expect(convertBtn).toContainText('In Kund:in umwandeln');
    await convertBtn.click();

    // Modal dialog is in German
    const dialog = page.locator('[data-testid="convert-lead-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('h2')).toContainText('In Kunde umwandeln');
    await expect(dialog).toContainText(
      'Wandeln Sie diese Interessenten-Anfrage in einen Kundeneintrag um',
    );
    await expect(dialog).toContainText('Neuen Kunden anlegen');
    await expect(dialog).toContainText('Mit bestehendem Kunden verknüpfen');
    await expect(dialog).toContainText('Vorschau der Umwandlung');
    await expect(dialog).toContainText('Kundenname');
    await expect(dialog).toContainText('Primärer Kontakt');

    // Close dialog
    await page.locator('[data-testid="cancel-convert-btn"]').click();
    await expect(dialog).not.toBeVisible();
  });

  test('AC-11: zero axe WCAG 2.2 AA violations on conversion dialog across 320px, 768px, and 1280px in light and dark modes', async ({
    page,
  }) => {
    const viewports = [
      { name: '320px', width: 320, height: 640 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1280px', width: 1280, height: 800 },
    ];

    const themes: ('light' | 'dark')[] = ['light', 'dark'];

    for (const theme of themes) {
      await page.emulateMedia({ colorScheme: theme });

      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        await page.goto(`/en/leads/${E2E_LEAD_CONTACTED_ID}`);
        await page.waitForLoadState('networkidle');

        // Open modal
        const convertBtn = page.locator('[data-testid="convert-lead-btn"]').first();
        await convertBtn.click();
        const dialog = page.locator('[data-testid="convert-lead-dialog"]');
        await expect(dialog).toBeVisible();

        // Wait for modal fade-in/zoom animation to settle
        await page.waitForTimeout(350);

        // Run Axe accessibility scan
        const axeResults = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        expect(axeResults.violations).toEqual([]);

        // Capture screenshot
        await page.screenshot({
          path: path.join(UX_RUN_DIR, `lead-conversion-dialog-${vp.name}-${theme}.png`),
        });

        // Close modal
        await page.locator('[data-testid="cancel-convert-btn"]').click();
        await expect(dialog).not.toBeVisible();
      }
    }
  });
});
