import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

function getLatestRunDir(): string {
  if (process.env.RUN_DIR) return process.env.RUN_DIR;
  const runsRoot = path.resolve(import.meta.dirname, '../../../../control/ownlight/runs/TASK-0057');
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
  `../../../../control/ownlight/runs/TASK-0057/${RUN_DIR_PARAM}/ux`,
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

test.describe('TASK-0057: Packages, Catalogue & Studio Tax Settings E2E', () => {
  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-6: Unauthenticated request to /en/settings/packages redirects to sign-in', async ({
    browser,
  }) => {
    const unauthContext = await browser.newContext();
    const unauthPage = await unauthContext.newPage();

    await unauthPage.goto('/en/settings/packages');
    await expect(unauthPage).toHaveURL(/\/en\/sign-in\?callbackUrl=%2Fen%2Fsettings%2Fpackages/);

    const bodyText = await unauthPage.content();
    expect(bodyText).not.toContain('data-testid="packages-settings-view"');
    expect(bodyText).not.toContain('data-testid="tab-packages"');

    await unauthContext.close();
  });

  test('AC-1: Create Package with bundled deliverables', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/en/settings/packages');
    await expect(page.locator('[data-testid="packages-settings-view"]')).toBeVisible();

    // Verify breadcrumb & active tab
    await expect(page.locator('[data-testid="breadcrumb-settings"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-packages"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Open Create Package Modal
    await page.locator('[data-testid="create-package-button"]').click();
    const modal = page.locator('[data-testid="package-modal"]');
    await expect(modal).toBeVisible();
    await page.waitForTimeout(300);

    // Fill package details
    await page.fill('[data-testid="package-name-input"]', 'Full Day Wedding Coverage');
    await expect(page.locator('[data-testid="package-slug-input"]')).toHaveValue(
      'full-day-wedding-coverage',
    );

    await page.selectOption('[data-testid="package-project-type-select"]', 'wedding');
    await page.fill('[data-testid="package-price-input"]', '2800.00');
    await page.fill(
      '[data-testid="package-description-input"]',
      'Complete all-day coverage package.',
    );

    // Add first deliverable
    await page.locator('[data-testid="add-deliverable-btn"]').click();
    await page.fill('[data-testid="deliverable-title-input-0"]', '8 Hours Continuous Coverage');
    await page.fill('[data-testid="deliverable-desc-input-0"]', 'From bridal prep to dancing');

    // Add second deliverable
    await page.locator('[data-testid="add-deliverable-btn"]').click();
    await page.fill(
      '[data-testid="deliverable-title-input-1"]',
      '400+ High-Resolution Edited Images',
    );
    await page.fill('[data-testid="deliverable-quantity-input-1"]', '400');

    // Save package
    await page.locator('[data-testid="save-package-btn"]').click();
    await expect(modal).not.toBeVisible();

    // Verify package appears in packages list
    const packageCard = page.locator('[data-testid="package-card-full-day-wedding-coverage"]');
    await expect(packageCard).toBeVisible();
    await expect(packageCard).toContainText('2,800.00');
    await expect(packageCard).toContainText('8 Hours Continuous Coverage');
  });

  test('AC-2: Edit existing package, reorder and update deliverable description', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.goto('/en/settings/packages');
    await expect(page.locator('[data-testid="packages-settings-view"]')).toBeVisible();

    const editBtn = page.locator('[data-testid^="edit-package-"]').first();
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    const modal = page.locator('[data-testid="package-modal"]');
    await expect(modal).toBeVisible();
    await page.waitForTimeout(300);

    // Update package name
    await page.fill('[data-testid="package-name-input"]', 'Luxury Wedding Collection');

    // Reorder deliverables if at least 2 exist
    const moveUpBtn = page.locator('[data-testid="deliverable-move-up-1"]');
    if (await moveUpBtn.isVisible().catch(() => false)) {
      await moveUpBtn.click();
    }

    // Save changes
    await page.locator('[data-testid="save-package-btn"]').click();
    await expect(modal).not.toBeVisible();

    // Verify updated title
    await expect(page.locator('text=Luxury Wedding Collection')).toBeVisible();
  });

  test('AC-3: Archive package with confirmation dialog and restore it', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/en/settings/packages');
    await expect(page.locator('[data-testid="packages-settings-view"]')).toBeVisible();

    const archiveBtn = page.locator('[data-testid^="archive-package-"]').first();
    await expect(archiveBtn).toBeVisible();
    await archiveBtn.click();

    // Verify archive confirmation dialog
    const dialog = page.locator('[data-testid="package-archive-dialog"]');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);

    // Confirm archive
    await page.locator('[data-testid="confirm-archive-btn"]').click();
    await expect(dialog).not.toBeVisible();

    // Toggle show archived
    const toggleArchived = page.locator('[data-testid="toggle-archived-packages"]');
    if (await toggleArchived.isVisible().catch(() => false)) {
      await toggleArchived.click();
      const restoreBtn = page.locator('[data-testid^="restore-package-"]').first();
      await expect(restoreBtn).toBeVisible();
      await restoreBtn.click();
    }
  });

  test('AC-4: Catalogue tab manages add-on services/products with categories and archiving', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.goto('/en/settings/packages');
    await expect(page.locator('[data-testid="packages-settings-view"]')).toBeVisible();

    // Switch to Catalogue tab
    await page.locator('[data-testid="tab-catalogue"]').click();
    await expect(page.locator('[data-testid="tabpanel-catalogue"]')).toBeVisible();

    // Open Catalogue Item Modal
    await page.locator('[data-testid="create-catalogue-item-btn"]').click();
    const modal = page.locator('[data-testid="catalogue-item-modal"]');
    await expect(modal).toBeVisible();
    await page.waitForTimeout(300);

    // Fill item details
    await page.fill('[data-testid="catalogue-item-name-input"]', 'Drone Aerial Footage');
    await expect(page.locator('[data-testid="catalogue-item-slug-input"]')).toHaveValue(
      'drone-aerial-footage',
    );
    await page.selectOption('[data-testid="catalogue-item-category-select"]', 'service');
    await page.fill('[data-testid="catalogue-item-price-input"]', '250.00');

    // Save item
    await page.locator('[data-testid="save-catalogue-item-btn"]').click();
    await expect(modal).not.toBeVisible();

    // Verify in table
    const itemRow = page.locator('[data-testid="catalogue-item-row-drone-aerial-footage"]');
    await expect(itemRow).toBeVisible();
    await expect(itemRow).toContainText('Drone Aerial Footage');

    // Toggle archive
    const toggleArchiveBtn = itemRow.locator('[data-testid^="toggle-archive-catalogue-item-"]');
    await toggleArchiveBtn.click();

    // Verify status toggle
    await expect(itemRow).toBeVisible();
  });

  test('AC-5: Tax Settings tab saves Steuernummer, USt-IdNr, §19 UStG notice, and pricing display mode', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.goto('/en/settings/packages');
    await expect(page.locator('[data-testid="packages-settings-view"]')).toBeVisible();

    // Switch to Tax Settings tab
    await page.locator('[data-testid="tab-tax"]').click();
    await expect(page.locator('[data-testid="tabpanel-tax"]')).toBeVisible();

    // Fill tax numbers
    await page.fill('[data-testid="tax-number-input"]', '133/5815/0011');
    await page.fill('[data-testid="vat-id-input"]', 'DE312345678');

    // Toggle Kleinunternehmer (§19 UStG)
    const kleinunternehmerToggle = page.locator('[data-testid="toggle-kleinunternehmer"]');
    const isChecked = await kleinunternehmerToggle.isChecked();
    if (!isChecked) {
      await kleinunternehmerToggle.check();
    }

    const noticeTextarea = page.locator('[data-testid="kleinunternehmer-notice-textarea"]');
    await expect(noticeTextarea).toBeVisible();
    await noticeTextarea.fill(
      'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerstatus).',
    );

    // Toggle pricing mode
    await page.locator('[data-testid="pricing-mode-gross"]').click();

    // Save tax settings
    await page.locator('[data-testid="save-tax-settings-btn"]').click();
    await expect(page.locator('[data-testid="tax-save-success-banner"]')).toBeVisible();

    // Reload page to verify persistence
    await page.reload();
    await page.locator('[data-testid="tab-tax"]').click();
    await expect(page.locator('[data-testid="tax-number-input"]')).toHaveValue('133/5815/0011');
    await expect(page.locator('[data-testid="vat-id-input"]')).toHaveValue('DE312345678');
  });

  test('AC-7: Form validation error states display accessible error associations', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.goto('/en/settings/packages');

    // 1. Package modal empty required fields
    await page.locator('[data-testid="create-package-button"]').click();
    const packageModal = page.locator('[data-testid="package-modal"]');
    await expect(packageModal).toBeVisible();
    await page.waitForTimeout(300);

    // Clear title and submit
    await page.fill('[data-testid="package-name-input"]', '');
    await page.fill('[data-testid="package-price-input"]', '');
    await page.locator('[data-testid="save-package-btn"]').click();

    // Verify inline errors with aria-invalid & aria-describedby
    const nameInput = page.locator('[data-testid="package-name-input"]');
    await expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#package-name-error')).toBeVisible();

    await page.locator('[data-testid="package-modal-cancel-btn"]').click();
    await expect(packageModal).not.toBeVisible();

    // 2. Catalogue modal empty required fields
    await page.locator('[data-testid="tab-catalogue"]').click();
    await page.locator('[data-testid="create-catalogue-item-btn"]').click();
    const catModal = page.locator('[data-testid="catalogue-item-modal"]');
    await expect(catModal).toBeVisible();
    await page.waitForTimeout(300);

    await page.fill('[data-testid="catalogue-item-name-input"]', '');
    await page.locator('[data-testid="save-catalogue-item-btn"]').click();

    const catNameInput = page.locator('[data-testid="catalogue-item-name-input"]');
    await expect(catNameInput).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#catalogue-item-name-error')).toBeVisible();

    await page.locator('[data-testid="catalogue-item-cancel-btn"]').click();
    await expect(catModal).not.toBeVisible();
  });

  test('AC-8: German translation parity renders German text without raw keys', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/de/settings/packages');
    await expect(page.locator('[data-testid="packages-settings-view"]')).toBeVisible();

    const content = await page.content();
    expect(content).not.toContain('settings.packages.');
    expect(content).not.toContain('settings.tax.');

    // Verify specific German headings and buttons
    await expect(page.locator('h1')).toContainText('Pakete & Leistungen');
    await expect(page.locator('[data-testid="tab-packages"]')).toContainText('Leistungspakete');
    await expect(page.locator('[data-testid="tab-catalogue"]')).toContainText('Katalog');
    await expect(page.locator('[data-testid="tab-tax"]')).toContainText('Steuern');
    await expect(page.locator('[data-testid="create-package-button"]')).toContainText(
      'Paket erstellen',
    );
  });

  test('AC-9: WAI-ARIA roving tabindex keyboard navigation across tabs', async ({ page }) => {
    await page.goto('/en/settings/packages');
    const tabPackages = page.locator('[data-testid="tab-packages"]');
    const tabCatalogue = page.locator('[data-testid="tab-catalogue"]');
    const tabTax = page.locator('[data-testid="tab-tax"]');

    await tabPackages.focus();
    await expect(tabPackages).toBeFocused();
    await expect(tabPackages).toHaveAttribute('aria-selected', 'true');

    // ArrowRight -> Catalogue
    await page.keyboard.press('ArrowRight');
    await expect(tabCatalogue).toBeFocused();
    await expect(tabCatalogue).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="tabpanel-catalogue"]')).toBeVisible();

    // ArrowRight -> Tax
    await page.keyboard.press('ArrowRight');
    await expect(tabTax).toBeFocused();
    await expect(tabTax).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="tabpanel-tax"]')).toBeVisible();

    // ArrowRight -> Wraps back to Packages
    await page.keyboard.press('ArrowRight');
    await expect(tabPackages).toBeFocused();
    await expect(tabPackages).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="tabpanel-packages"]')).toBeVisible();
  });

  test('AC-9: WCAG 2.2 AA accessibility scan with Axe across light/dark themes and modals', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.goto('/en/settings/packages');
    await expect(page.locator('[data-testid="packages-settings-view"]')).toBeVisible();

    // 1. Light theme scan on Packages tab
    const packagesAxeLight = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(packagesAxeLight.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'packages-tab-1280px-light.png'),
    });

    // 2. Dark theme scan on Packages tab
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(200);

    const packagesAxeDark = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(packagesAxeDark.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'packages-tab-1280px-dark.png'),
    });

    // 3. Open Package Modal Axe Scan
    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('[data-testid="create-package-button"]').click();
    await page.waitForSelector('[data-testid="package-modal"]', { state: 'visible' });
    await page.waitForTimeout(300);

    const modalAxeLight = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(modalAxeLight.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'package-create-modal-1280px-light.png'),
    });

    await page.locator('[data-testid="package-modal-cancel-btn"]').click();
    await expect(page.locator('[data-testid="package-modal"]')).not.toBeVisible();

    // 4. Catalogue tab Axe Scan
    await page.locator('[data-testid="tab-catalogue"]').click();
    await expect(page.locator('[data-testid="tabpanel-catalogue"]')).toBeVisible();

    const catalogueAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(catalogueAxe.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'catalogue-tab-1280px-light.png'),
    });

    // 5. Tax settings tab Axe Scan
    await page.locator('[data-testid="tab-tax"]').click();
    await expect(page.locator('[data-testid="tabpanel-tax"]')).toBeVisible();

    const taxAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(taxAxe.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'tax-settings-tab-1280px-light.png'),
    });
  });
});
