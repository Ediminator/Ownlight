import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

function getLatestRunDir(): string {
  if (process.env.RUN_DIR) return process.env.RUN_DIR;
  const runsRoot = path.resolve(import.meta.dirname, '../../../../control/ownlight/runs/TASK-0065');
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
  `../../../../control/ownlight/runs/TASK-0065/${RUN_DIR_PARAM}/ux`,
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

test.describe('TASK-0065: Contract Templates & Studio Signing Settings E2E', () => {
  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-7: Unauthenticated request to /en/settings/contracts redirects to sign-in', async ({
    browser,
  }) => {
    const unauthContext = await browser.newContext();
    const unauthPage = await unauthContext.newPage();

    await unauthPage.goto('/en/settings/contracts');
    await expect(unauthPage).toHaveURL(/\/en\/sign-in\?callbackUrl=%2Fen%2Fsettings%2Fcontracts/);

    const bodyText = await unauthPage.content();
    expect(bodyText).not.toContain('data-testid="contracts-settings-view"');
    expect(bodyText).not.toContain('data-testid="tab-templates"');

    await unauthContext.close();
  });

  test('AC-1: Settings navigation and contracts overview list', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/en/settings');
    const contractCardLink = page.locator('[data-testid="settings-card-contracts"]');
    await expect(contractCardLink).toBeVisible();
    await contractCardLink.click();

    await expect(page).toHaveURL(/\/en\/settings\/contracts/);
    await expect(page.locator('[data-testid="contracts-settings-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="settings-nav"]')).toBeVisible();
    await expect(page.locator('[data-testid="settings-nav-contracts"]')).toBeVisible();

    // Verify breadcrumbs and active tab
    await expect(page.locator('[data-testid="breadcrumb-settings"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-templates"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-testid="create-template-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="template-project-type-filter"]')).toBeVisible();
    await expect(page.locator('[data-testid="template-search-input"]')).toBeVisible();
  });

  test('AC-2, AC-3, AC-4: Create Contract Template with bilingual clauses, tokens, and live preview', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.goto('/en/settings/contracts');
    await expect(page.locator('[data-testid="contracts-settings-view"]')).toBeVisible();

    // Open template modal
    await page.locator('[data-testid="create-template-button"]').click();
    const modal = page.locator('[data-testid="contract-template-modal"]');
    await expect(modal).toBeVisible();

    // Fill metadata fields
    const nameInput = page.locator('[data-testid="contract-template-name-input"]');
    await nameInput.fill('Full Day Wedding Agreement');

    // Verify auto-generated slug
    const slugInput = page.locator('[data-testid="contract-template-slug-input"]');
    await expect(slugInput).toHaveValue('full-day-wedding-agreement');

    // Select project type and default
    await page
      .locator('[data-testid="contract-template-project-type-select"]')
      .selectOption('wedding');
    await page.locator('[data-testid="contract-template-default-toggle"]').check();

    // Fill English clauses with tokens
    const enTextarea = page.locator('[data-testid="contract-template-content-en-input"]');
    await enTextarea.fill('This Agreement is entered into by ');

    // Click tokens
    await page.locator('[data-testid="token-chip-studio-owner_name"]').click();
    await expect(page.locator('[data-testid="token-announcement"]')).toContainText(
      'studio.owner_name',
    );

    await enTextarea.pressSequentially(' and ');
    await page.locator('[data-testid="token-chip-client-name"]').click();

    await enTextarea.pressSequentially(' for the ');
    await page.locator('[data-testid="token-chip-package-name"]').click();

    // Check live preview interpolation in merge field preview card
    const previewCard = page.locator('[data-testid="merge-field-preview-card"]');
    await expect(previewCard).toContainText('Elena Rostova');
    await expect(previewCard).toContainText('Sarah & Michael Jenkins');
    await expect(previewCard).toContainText('Full Day Wedding Collection');

    // Switch to German tab
    await page.locator('#clause-tab-de').click();
    await expect(page.locator('#clause-tab-de')).toHaveAttribute('aria-selected', 'true');

    const deTextarea = page.locator('[data-testid="contract-template-content-de-input"]');
    await deTextarea.fill('Dieser Vertrag wird geschlossen zwischen ');
    await page.locator('[data-testid="token-chip-studio-owner_name"]').click();
    await deTextarea.pressSequentially(' und ');
    await page.locator('[data-testid="token-chip-client-name"]').click();

    // Check German live preview
    await expect(previewCard).toContainText('Elena Rostova');
    await expect(previewCard).toContainText('Sarah & Michael Jenkins');

    // Submit form
    await page.locator('[data-testid="save-template-btn"]').click();
    await expect(modal).not.toBeVisible();

    // Verify row in table
    const row = page.locator('[data-testid="contract-template-row-full-day-wedding-agreement"]');
    await expect(row).toBeVisible();
    await expect(
      row.locator('[data-testid="template-name-full-day-wedding-agreement"]'),
    ).toContainText('Full Day Wedding Agreement');
    await expect(
      row.locator('[data-testid="template-default-badge-full-day-wedding-agreement"]'),
    ).toBeVisible();
    await expect(
      row.locator('[data-testid="template-type-full-day-wedding-agreement"]'),
    ).toContainText('Wedding');
    await expect(
      row.locator('[data-testid="template-active-badge-full-day-wedding-agreement"]'),
    ).toContainText('Active');
  });

  test('AC-3, AC-4, AC-5: Duplicate, edit, filter, and archive template', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/en/settings/contracts');
    await expect(page.locator('[data-testid="contracts-settings-view"]')).toBeVisible();

    // 1. Duplicate template
    const duplicateBtn = page.locator(
      '[data-testid="duplicate-template-full-day-wedding-agreement"]',
    );
    await expect(duplicateBtn).toBeVisible();
    await duplicateBtn.click();

    const modal = page.locator('[data-testid="contract-template-modal"]');
    await expect(modal).toBeVisible();
    await expect(page.locator('[data-testid="contract-template-name-input"]')).toHaveValue(
      'Full Day Wedding Agreement (Copy)',
    );
    await expect(page.locator('[data-testid="contract-template-slug-input"]')).toHaveValue(
      'full-day-wedding-agreement-copy',
    );

    // Change duplicate name
    await page
      .locator('[data-testid="contract-template-name-input"]')
      .fill('Half Day Wedding Agreement');
    await page
      .locator('[data-testid="contract-template-slug-input"]')
      .fill('half-day-wedding-agreement');
    await page.locator('[data-testid="save-template-btn"]').click();
    await expect(modal).not.toBeVisible();

    // Verify both rows exist
    await expect(
      page.locator('[data-testid="contract-template-row-full-day-wedding-agreement"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="contract-template-row-half-day-wedding-agreement"]'),
    ).toBeVisible();

    // 2. Search & filter
    const searchInput = page.locator('[data-testid="template-search-input"]');
    await searchInput.fill('Half Day');
    await expect(
      page.locator('[data-testid="contract-template-row-half-day-wedding-agreement"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="contract-template-row-full-day-wedding-agreement"]'),
    ).not.toBeVisible();

    // Clear search
    await searchInput.fill('');
    await expect(
      page.locator('[data-testid="contract-template-row-full-day-wedding-agreement"]'),
    ).toBeVisible();

    // 3. Archive template
    const archiveBtn = page.locator('[data-testid="archive-template-half-day-wedding-agreement"]');
    await archiveBtn.click();

    const archiveDialog = page.locator('[data-testid="contract-template-archive-dialog"]');
    await expect(archiveDialog).toBeVisible();
    await page.locator('[data-testid="confirm-archive-btn"]').click();
    await expect(archiveDialog).not.toBeVisible();

    // Verify it disappears from active view
    await expect(
      page.locator('[data-testid="contract-template-row-half-day-wedding-agreement"]'),
    ).not.toBeVisible();

    // 4. Toggle show archived
    const showArchivedToggle = page.locator('[data-testid="toggle-archived-templates-btn"]');
    await showArchivedToggle.click();

    // Archived row is now visible
    const archivedRow = page.locator(
      '[data-testid="contract-template-row-half-day-wedding-agreement"]',
    );
    await expect(archivedRow).toBeVisible();
    await expect(
      archivedRow.locator('[data-testid="template-archived-badge-half-day-wedding-agreement"]'),
    ).toContainText('Archived');

    // 5. Restore archived template
    const restoreBtn = page.locator('[data-testid="restore-template-half-day-wedding-agreement"]');
    await restoreBtn.click();

    // After restoring, it moves from archived to active view, so toggle back
    await showArchivedToggle.click();

    // Restored row is now in active templates with Active badge
    const restoredRow = page.locator(
      '[data-testid="contract-template-row-half-day-wedding-agreement"]',
    );
    await expect(restoredRow).toBeVisible();
    await expect(
      restoredRow.locator('[data-testid="template-active-badge-half-day-wedding-agreement"]'),
    ).toContainText('Active');
  });

  test('AC-6: Update Studio Signing profile, countersignature mode, and address', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.goto('/en/settings/contracts');
    await expect(page.locator('[data-testid="contracts-settings-view"]')).toBeVisible();

    // Switch to signing settings tab
    await page.locator('[data-testid="tab-signing"]').click();
    await expect(page.locator('[data-testid="tab-signing"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    const card = page.locator('[data-testid="studio-signing-settings-card"]');
    await expect(card).toBeVisible();

    // Fill signatory details
    const signatoryName = page.locator('[data-testid="signing-signatory-name-input"]');
    await signatoryName.fill('Elena Maria Rostova');

    const signatoryTitle = page.locator('[data-testid="signing-signatory-title-input"]');
    await signatoryTitle.fill('Founder & Lead Photographer');

    // Switch countersignature mode to explicit
    await page.locator('[data-testid="countersignature-mode-explicit"]').check();

    // Fill studio address fields
    await page.locator('[data-testid="signing-address-line1-input"]').fill('Kastanienallee 71');
    await page.locator('[data-testid="signing-postal-code-input"]').fill('10435');
    await page.locator('[data-testid="signing-city-input"]').fill('Berlin');
    await page.locator('[data-testid="signing-country-code-input"]').fill('DE');

    // Submit form
    await page.locator('[data-testid="save-signing-settings-btn"]').click();

    // Success notification
    const successBanner = page.locator('[data-testid="signing-success-notification"]');
    await expect(successBanner).toBeVisible();
    await expect(successBanner).toContainText('successfully');

    // Reload page to verify persistence
    await page.reload();
    await page.locator('[data-testid="tab-signing"]').click();
    await expect(page.locator('[data-testid="signing-signatory-name-input"]')).toHaveValue(
      'Elena Maria Rostova',
    );
    await expect(page.locator('[data-testid="signing-signatory-title-input"]')).toHaveValue(
      'Founder & Lead Photographer',
    );
    await expect(page.locator('[data-testid="countersignature-mode-explicit"]')).toBeChecked();
    await expect(page.locator('[data-testid="signing-address-line1-input"]')).toHaveValue(
      'Kastanienallee 71',
    );
  });

  test('AC-8: German locale rendering /de/settings/contracts', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/de/settings/contracts');
    await expect(page.locator('[data-testid="contracts-settings-view"]')).toBeVisible();

    // Verify German headers and tabs
    await expect(page.locator('h1')).toContainText('Vertragsvorlagen & Studio-Signatur');
    await expect(page.locator('[data-testid="tab-templates"]')).toContainText('Vertragsvorlagen');
    await expect(page.locator('[data-testid="tab-signing"]')).toContainText(
      'Studio-Signaturprofil',
    );
    await expect(page.locator('[data-testid="create-template-button"]')).toContainText(
      'Neue Vorlage',
    );

    // Verify zero untranslated bracketed keys
    const bodyContent = await page.content();
    expect(bodyContent).not.toMatch(/\[settings\.contracts\.[a-zA-Z0-9_.]+\]/);
  });

  test('AC-9: WCAG 2.2 AA accessibility scan with Axe across light/dark themes and viewport reflow', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.goto('/en/settings/contracts');
    await expect(page.locator('[data-testid="contracts-settings-view"]')).toBeVisible();

    // 1. Templates Tab Light mode (1280px)
    const templatesAxeLight = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(templatesAxeLight.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'contract-templates-1280px-light.png'),
    });

    // 2. Templates Tab Dark mode (1280px)
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(200);

    const templatesAxeDark = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(templatesAxeDark.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'contract-templates-1280px-dark.png'),
    });

    // 3. Open Modal Axe Scan (Light mode)
    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('[data-testid="create-template-button"]').click();
    await page.waitForSelector('[data-testid="contract-template-modal"]', { state: 'visible' });
    await page.waitForTimeout(300); // Allow Radix fade-in animation to complete

    const modalAxeLight = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(modalAxeLight.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'contract-template-modal-1280px-light.png'),
    });

    // Close modal
    await page.locator('[data-testid="template-modal-cancel-btn"]').click();
    await expect(page.locator('[data-testid="contract-template-modal"]')).not.toBeVisible();

    // 4. Signing Tab Axe Scan (Light mode)
    await page.locator('[data-testid="tab-signing"]').click();
    await expect(page.locator('[data-testid="studio-signing-settings-card"]')).toBeVisible();

    const signingAxeLight = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(signingAxeLight.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'studio-signing-1280px-light.png'),
    });

    // 5. 375px Mobile Viewport Reflow Scan
    await page.setViewportSize({ width: 375, height: 667 });
    await page.locator('[data-testid="tab-templates"]').click();
    await expect(page.locator('[data-testid="contracts-settings-view"]')).toBeVisible();

    const mobileAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(mobileAxe.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'contract-templates-375px-light.png'),
    });
  });
});
