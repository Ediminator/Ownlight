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
  `../../../../control/ownlight/runs/TASK-0015/${RUN_DIR_PARAM}/ux`,
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
  await page.fill('[data-testid="given-name-input"]', 'Alice');
  await page.fill('[data-testid="family-name-input"]', 'DSAR');
  await page.fill('[data-testid="email-input"]', `dsar-${String(Date.now())}@example.com`);
  await page.click('[data-testid="submit-client-btn"]');
  await expect(page).toHaveURL(new RegExp(`/${locale}/clients/[0-9a-f-]{36}`));
  const url = page.url();
  const match = /\/clients\/([0-9a-f-]{36})/.exec(url);
  const clientId = match?.[1];
  if (!clientId) throw new Error('Could not parse clientId from URL');
  return clientId;
}

test.describe('TASK-0015: DSAR Data Export E2E (AC-9 to AC-12)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-9 & AC-10: Export dialog workflow, review notice, locale translation, and file downloads in JSON & HTML', async ({
    page,
  }) => {
    // 1. Create client and navigate to profile in English
    const clientId = await createTestClient(page, 'Export Test Client EN', 'en');
    await page.goto(`/en/clients/${clientId}`);

    // Locate contact export button
    const exportBtn = page.locator('[data-testid^="export-contact-btn-"]').first();
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    // Dialog is visible
    const dialog = page.locator('[data-testid="export-data-dialog"]');
    await expect(dialog).toBeVisible();

    // AC-9: Art. 15(4) review notice is prominently displayed
    const reviewNotice = page.locator('[data-testid="export-review-notice"]');
    await expect(reviewNotice).toBeVisible();
    await expect(reviewNotice).toContainText('Third-party data review required (Art. 15(4) GDPR)');

    // Format buttons present
    const htmlBtn = page.locator('[data-testid="export-format-html-btn"]');
    const jsonBtn = page.locator('[data-testid="export-format-json-btn"]');
    await expect(htmlBtn).toBeVisible();
    await expect(jsonBtn).toBeVisible();

    // Trigger JSON download
    await jsonBtn.click();

    const [jsonDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="export-submit-btn"]'),
    ]);

    // Verify downloaded filename structure: ownlight-data-export-<uuid>-<YYYY-MM-DD>.json
    const jsonFilename = jsonDownload.suggestedFilename();
    expect(jsonFilename).toMatch(/^ownlight-data-export-[0-9a-f-]{36}-\d{4}-\d{2}-\d{2}\.json$/);

    // Dialog auto-closes after download starts
    await expect(dialog).not.toBeVisible();

    // 2. Open dialog again for HTML export in German
    await page.goto(`/de/clients/${clientId}`);
    const exportBtnDe = page.locator('[data-testid^="export-contact-btn-"]').first();
    await exportBtnDe.click();

    const dialogDe = page.locator('[data-testid="export-data-dialog"]');
    await expect(dialogDe).toBeVisible();

    // AC-10: All strings come from de.json
    await expect(dialogDe).toContainText('Personenbezogene Daten exportieren');
    await expect(dialogDe).toContainText(
      'Prüfung auf Drittpersonendaten erforderlich (Art. 15 Abs. 4 DSGVO)',
    );
    await expect(dialogDe).toContainText('Druckbares Dokument (HTML)');
    await expect(dialogDe).toContainText('Maschinenlesbare Daten (JSON)');

    // Trigger HTML download in German
    const [htmlDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="export-submit-btn"]'),
    ]);

    const htmlFilename = htmlDownload.suggestedFilename();
    expect(htmlFilename).toMatch(/^ownlight-data-export-[0-9a-f-]{36}-\d{4}-\d{2}-\d{2}\.html$/);

    // Save HTML content to test axe on the rendered document (AC-11)
    const downloadPath = await htmlDownload.path();
    if (downloadPath) {
      const htmlContent = fs.readFileSync(downloadPath, 'utf8');
      expect(htmlContent).toContain('<html lang="de">');
      expect(htmlContent).toContain('Datenauskunft');
      expect(htmlContent).not.toMatch(/<script\b/i);
    }
  });

  test('AC-11: WCAG 2.2 AA Axe accessibility audit on dialog and exported HTML document', async ({
    page,
  }) => {
    const clientId = await createTestClient(page, 'A11y Audit Client', 'en');
    await page.goto(`/en/clients/${clientId}`);

    // Open export dialog
    await page.click('[data-testid^="export-contact-btn-"]');
    const dialog = page.locator('[data-testid="export-data-dialog"]');
    await expect(dialog).toBeVisible();

    // Axe audit on export dialog
    const dialogScan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const criticalOrSerious = dialogScan.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(
      criticalOrSerious,
      `Axe accessibility violations in ExportDataDialog:\n${JSON.stringify(criticalOrSerious, null, 2)}`,
    ).toEqual([]);

    // Trigger HTML download
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="export-submit-btn"]'),
    ]);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    if (downloadPath) {
      const htmlContent = fs.readFileSync(downloadPath, 'utf8');

      // Load the generated HTML into a new blank page context to audit accessibility
      const newPage = await page.context().newPage();
      await newPage.setContent(htmlContent);

      const htmlScan = await new AxeBuilder({ page: newPage })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();

      const htmlViolations = htmlScan.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(
        htmlViolations,
        `Axe accessibility violations in generated HTML export:\n${JSON.stringify(htmlViolations, null, 2)}`,
      ).toEqual([]);

      await newPage.close();
    }
  });

  test('AC-12: 320px responsive viewport, touch targets >= 24px, and UX screenshots', async ({
    page,
  }) => {
    const clientId = await createTestClient(page, 'Responsive DSAR Client', 'en');

    // Test at 320px mobile viewport
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/en/clients/${clientId}`);

    // Check no horizontal scrollbar on client profile at 320px
    const profileHasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(profileHasOverflow).toBe(false);

    // Open export dialog
    const exportBtn = page.locator('[data-testid^="export-contact-btn-"]').first();
    await exportBtn.click();

    const dialog = page.locator('[data-testid="export-data-dialog"]');
    await expect(dialog).toBeVisible();

    // Check no horizontal scroll inside dialog at 320px
    const dialogHasOverflow = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="export-data-dialog"]');
      if (!el) return false;
      return el.scrollWidth > el.clientWidth;
    });
    expect(dialogHasOverflow).toBe(false);

    // Verify touch target dimensions (>= 24px x 24px per WCAG 2.2 AA SC 2.5.8)
    const targets = [
      page.locator('[data-testid="export-format-html-btn"]'),
      page.locator('[data-testid="export-format-json-btn"]'),
      page.locator('[data-testid="export-locale-select"]'),
      page.locator('[data-testid="export-cancel-btn"]'),
      page.locator('[data-testid="export-submit-btn"]'),
    ];

    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box, 'Element must have visible bounding box').toBeTruthy();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(24);
        expect(box.height).toBeGreaterThanOrEqual(24);
      }
    }

    // Capture screenshots across required breakpoints (320px, 768px, 1280px)
    const breakpoints = [
      { name: '320px', width: 320, height: 640 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1280px', width: 1280, height: 800 },
    ];

    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto(`/en/clients/${clientId}`);
      await page.click('[data-testid^="export-contact-btn-"]');
      await expect(page.locator('[data-testid="export-data-dialog"]')).toBeVisible();

      const screenshotPath = path.join(UX_RUN_DIR, `dsar-export-dialog-${bp.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      expect(fs.existsSync(screenshotPath)).toBe(true);

      // Close dialog for next loop
      await page.click('[data-testid="export-cancel-btn"]');
      await expect(page.locator('[data-testid="export-data-dialog"]')).not.toBeVisible();
    }
  });
});
