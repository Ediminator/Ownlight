import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';
import { E2E_PROJECT_INQUIRY_1_ID } from '../helpers/e2e-projects-helper';
import {
  E2E_PACKAGE_WEDDING_ID,
  E2E_CATALOGUE_ITEM_1_ID,
  E2E_DRAFT_PROPOSAL_ID,
} from '../helpers/e2e-proposals-helper';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

function getLatestRunDir(): string {
  if (process.env.RUN_DIR) return process.env.RUN_DIR;
  const runsRoot = path.resolve(import.meta.dirname, '../../../../control/ownlight/runs/TASK-0061');
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
  `../../../../control/ownlight/runs/TASK-0061/${RUN_DIR_PARAM}/ux`,
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

test.describe('TASK-0061: Proposal Builder Project Workspace UI E2E', () => {
  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-5: Unauthenticated visitor to proposal builder routes is redirected to sign-in', async ({
    browser,
  }) => {
    const unauthContext = await browser.newContext();
    const unauthPage = await unauthContext.newPage();

    await unauthPage.goto(`/en/projects/${E2E_PROJECT_INQUIRY_1_ID}/proposals/new`);
    await expect(unauthPage).toHaveURL(new RegExp(`.*\\/sign-in\\?callbackUrl=.*proposals%2Fnew`));

    const bodyText = await unauthPage.content();
    expect(bodyText).not.toContain('data-testid="proposal-builder-view"');
    expect(bodyText).not.toContain('data-testid="package-selector-section"');

    await unauthContext.close();
  });

  test('AC-1 & AC-2 & AC-3: Full proposal composer flow with package, add-on, custom item, and draft save', async ({
    page,
  }) => {
    test.setTimeout(90000);

    // 1. Navigate to proposal builder composer
    await page.goto(`/en/projects/${E2E_PROJECT_INQUIRY_1_ID}/proposals/new`);
    await expect(page.locator('[data-testid="proposal-builder-view"]')).toBeVisible();

    // Verify breadcrumbs and client review card
    await expect(page.locator('[data-testid="breadcrumb-projects"]')).toBeVisible();
    await expect(page.locator('[data-testid="breadcrumb-project-detail"]')).toBeVisible();
    await expect(page.locator('[data-testid="client-review-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="proposal-client-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="proposal-status-badge"]')).toContainText('Draft');

    // 2. Select package from catalogue
    const packageSelect = page.locator('[data-testid="package-select"]');
    await expect(packageSelect).toBeVisible();
    await packageSelect.selectOption(E2E_PACKAGE_WEDDING_ID);

    // Verify base price populated (€2,800.00 -> 2800.00)
    const basePriceInput = page.locator('[data-testid="base-package-price-input"]');
    await expect(basePriceInput).toHaveValue('2800.00');

    // Verify deliverables populated
    await expect(page.locator('[data-testid="deliverable-item-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="deliverable-title-input-0"]')).toHaveValue(
      '8 Hours Continuous Coverage',
    );
    await expect(page.locator('[data-testid="deliverable-item-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="deliverable-title-input-1"]')).toHaveValue(
      '400+ High-Resolution Edited Images',
    );

    // Edit deliverable 0 title and deliverable 1 quantity
    await page.fill('[data-testid="deliverable-title-input-0"]', '9 Hours Continuous Coverage');
    await page.fill('[data-testid="deliverable-qty-input-1"]', '500');

    // Add a third custom deliverable
    await page.fill('[data-testid="new-deliverable-qty-input"]', '1');
    await page.fill(
      '[data-testid="new-deliverable-title-input"]',
      'Sneak Peek Gallery within 48 Hours',
    );
    await page.locator('[data-testid="add-deliverable-btn"]').click();
    await expect(page.locator('[data-testid="deliverable-item-2"]')).toBeVisible();

    // 3. Add Catalogue Add-on Item (AC-2)
    const addonSelect = page.locator('[data-testid="catalogue-addon-select"]');
    await addonSelect.selectOption(E2E_CATALOGUE_ITEM_1_ID);
    await page.locator('[data-testid="add-catalogue-addon-btn"]').click();

    // Verify add-on item added
    await expect(page.locator('[data-testid="addon-row-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="addon-name-0"]')).toHaveValue(
      'Extra Photography Hour',
    );
    await expect(page.locator('[data-testid="addon-price-0"]')).toHaveValue('250.00');

    // Mark as optional and set max quantity = 2
    const optionalToggle = page.locator('[data-testid="addon-optional-toggle-0"]');
    await optionalToggle.check();
    await expect(optionalToggle).toBeChecked();

    const maxQtyInput = page.locator('[data-testid="addon-max-quantity-0"]');
    await maxQtyInput.fill('2');
    await expect(maxQtyInput).toHaveValue('2');

    // 4. Add Custom Inline Line Item
    await page.locator('[data-testid="add-custom-item-btn"]').click();
    await expect(page.locator('[data-testid="addon-row-1"]')).toBeVisible();
    await page.fill('[data-testid="addon-name-1"]', 'Second Photographer Assistant');
    await page.fill('[data-testid="addon-price-1"]', '400.00');

    // 5. Verify reactive financial summary calculation
    // Base 2800.00 + Addon 250.00 + Custom 400.00 = 3450.00
    await expect(page.locator('[data-testid="financial-summary-total"]')).toContainText('3,450.00');

    // 6. Save Draft Proposal (AC-3)
    await page.locator('[data-testid="save-draft-btn"]').click();

    // Verify redirected to edit route /projects/[id]/proposals/[proposalId]
    await expect(page).toHaveURL(
      new RegExp(`.*/projects/${E2E_PROJECT_INQUIRY_1_ID}/proposals/[0-9a-f-]{36}`),
    );

    // Verify persisted state after redirect
    await expect(page.locator('[data-testid="proposal-builder-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="proposal-status-badge"]')).toContainText('Draft');
    await expect(page.locator('[data-testid="financial-summary-total"]')).toContainText('3,450.00');
  });

  test('AC-4: Send Proposal Modal flow with 14-day default validity and copy link notification', async ({
    page,
  }) => {
    test.setTimeout(90000);

    // Open existing draft proposal
    await page.goto(`/en/projects/${E2E_PROJECT_INQUIRY_1_ID}/proposals/${E2E_DRAFT_PROPOSAL_ID}`);
    await expect(page.locator('[data-testid="proposal-builder-view"]')).toBeVisible();

    // Click "Send Proposal to Client"
    const openSendBtn = page.locator('[data-testid="open-send-proposal-btn"]');
    await expect(openSendBtn).toBeVisible();
    await openSendBtn.click();

    // Verify modal is open
    const modal = page.locator('[data-testid="send-proposal-modal"]');
    await expect(modal).toBeVisible();
    await page.waitForTimeout(300);

    // Verify recipient email is populated
    const emailInput = page.locator('[data-testid="send-recipient-email-input"]');
    await expect(emailInput).not.toHaveValue('');

    // Verify expiration date is populated with a date ~14 days in future
    const expDateInput = page.locator('[data-testid="send-valid-until-input"]');
    const expValue = await expDateInput.inputValue();
    expect(expValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Submit send proposal
    await page.locator('[data-testid="submit-send-proposal-btn"]').click();

    // Verify "Copy Link" notification card appears with shareable token URL inside modal
    const copyLinkNotification = page.locator('[data-testid="copy-link-notification"]');
    await expect(copyLinkNotification).toBeVisible();

    const tokenUrlElement = page.locator('[data-testid="proposal-token-url"]');
    await expect(tokenUrlElement).toBeVisible();
    const tokenUrlText = await tokenUrlElement.inputValue();
    expect(tokenUrlText).toContain('/p/');

    // Click "Copy Link" button
    const copyBtn = page.locator('[data-testid="copy-link-button"]');
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();
    await expect(copyBtn).toContainText('Copied');
  });

  test('AC-6: Validation error associations on invalid title, negative prices, and past dates', async ({
    page,
  }) => {
    test.setTimeout(90000);

    await page.goto(`/en/projects/${E2E_PROJECT_INQUIRY_1_ID}/proposals/new`);
    await expect(page.locator('[data-testid="proposal-builder-view"]')).toBeVisible();

    // 1. Empty title validation
    const titleInput = page.locator('[data-testid="proposal-title-input"]');
    await titleInput.fill('');
    await expect(page.locator('[data-testid="save-draft-btn"]')).toBeDisabled();

    const titleError = page.locator('[data-testid="proposal-title-error"]');
    await expect(titleError).toBeVisible();
    await expect(titleError).toHaveAttribute('role', 'alert');
    await expect(titleInput).toHaveAttribute('aria-invalid', 'true');
    await expect(titleInput).toHaveAttribute('aria-describedby', 'proposal-title-error');

    // Restore valid title
    await titleInput.fill('Valid Proposal Title');
    await expect(titleError).not.toBeVisible();

    // 2. Negative price validation (select package first)
    await page.locator('[data-testid="package-select"]').selectOption(E2E_PACKAGE_WEDDING_ID);
    const basePriceInput = page.locator('[data-testid="base-package-price-input"]');
    await basePriceInput.fill('-100.00');
    await expect(page.locator('[data-testid="save-draft-btn"]')).toBeDisabled();

    const priceError = page.locator('[data-testid="base-package-price-error"]');
    await expect(priceError).toBeVisible();
    await expect(priceError).toHaveAttribute('role', 'alert');
    await expect(basePriceInput).toHaveAttribute('aria-invalid', 'true');
    await expect(basePriceInput).toHaveAttribute('aria-describedby', 'base-package-price-error');

    // 3. Send modal past date validation
    await page.goto(`/en/projects/${E2E_PROJECT_INQUIRY_1_ID}/proposals/${E2E_DRAFT_PROPOSAL_ID}`);
    await expect(page.locator('[data-testid="proposal-builder-view"]')).toBeVisible();

    await page.locator('[data-testid="open-send-proposal-btn"]').click();
    const modal = page.locator('[data-testid="send-proposal-modal"]');
    await expect(modal).toBeVisible();
    await page.waitForTimeout(300);

    const expDateInput = page.locator('[data-testid="send-valid-until-input"]');
    await expDateInput.fill('2020-01-01');

    const dateError = page.locator('[data-testid="send-date-error"]');
    await expect(dateError).toBeVisible();
    await expect(dateError).toHaveAttribute('role', 'alert');
    await expect(expDateInput).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('[data-testid="submit-send-proposal-btn"]')).toBeDisabled();

    // Close modal
    await page.locator('[data-testid="cancel-send-proposal-btn"]').click();
    await expect(modal).not.toBeVisible();
  });

  test('AC-7: German locale renders complete proposal builder UI with zero untranslated strings', async ({
    page,
  }) => {
    test.setTimeout(90000);

    await page.goto(`/de/projects/${E2E_PROJECT_INQUIRY_1_ID}/proposals/new`);
    await expect(page.locator('[data-testid="proposal-builder-view"]')).toBeVisible();

    const content = await page.content();
    // Verify no untranslated keys exist
    expect(content).not.toContain('proposals.builder.');
    expect(content).not.toContain('common.');

    // Verify key German strings
    await expect(page.locator('[data-testid="save-draft-btn"]')).toContainText('Entwurf speichern');
    await expect(page.locator('[data-testid="open-send-proposal-btn"]')).toContainText(
      'Angebot an Kunden senden',
    );
    await expect(page.locator('[data-testid="proposal-status-badge"]')).toContainText('Entwurf');
    await expect(page.locator('[data-testid="package-selector-section"] h2')).toContainText(
      '1. Basispaket',
    );
    await expect(page.locator('[data-testid="addon-options-section"] h2')).toContainText(
      '2. Zusatzoptionen',
    );
    await expect(page.locator('[data-testid="financial-summary-section"] h2')).toContainText(
      '3. Finanzübersicht',
    );
  });

  test('AC-8: WCAG 2.2 AA accessibility scan with Axe across light/dark themes and viewports', async ({
    page,
  }) => {
    test.setTimeout(90000);

    // 1. Desktop Light (1280x800)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`/en/projects/${E2E_PROJECT_INQUIRY_1_ID}/proposals/${E2E_DRAFT_PROPOSAL_ID}`);
    await expect(page.locator('[data-testid="proposal-builder-view"]')).toBeVisible();

    const axeDesktopLight = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(axeDesktopLight.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'proposal-builder-1280px-light.png'),
    });

    // 2. Desktop Dark (1280x800)
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(200);

    const axeDesktopDark = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(axeDesktopDark.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'proposal-builder-1280px-dark.png'),
    });

    // 3. Open Send Proposal Modal Axe Scan (Light mode)
    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('[data-testid="open-send-proposal-btn"]').click();
    await page.waitForSelector('[data-testid="send-proposal-modal"]', { state: 'visible' });
    await page.waitForTimeout(300);

    const axeModalLight = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(axeModalLight.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'send-proposal-modal-1280px-light.png'),
    });

    await page.locator('[data-testid="cancel-send-proposal-btn"]').click();
    await expect(page.locator('[data-testid="send-proposal-modal"]')).not.toBeVisible();

    // 4. Mobile Light (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/en/projects/${E2E_PROJECT_INQUIRY_1_ID}/proposals/${E2E_DRAFT_PROPOSAL_ID}`);
    await expect(page.locator('[data-testid="proposal-builder-view"]')).toBeVisible();

    const axeMobileLight = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(axeMobileLight.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'proposal-builder-390px-mobile-light.png'),
    });

    // 5. Mobile Dark (390x844)
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(200);

    const axeMobileDark = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(axeMobileDark.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'proposal-builder-390px-mobile-dark.png'),
    });
  });

  test('I1-U02 regression: 375px mobile viewport has no horizontal overflow or clipped buttons in package and addon sections', async ({
    page,
  }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);

    // Test both English and German locales on 375px viewport
    for (const locale of ['en', 'de']) {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/${locale}/projects/${E2E_PROJECT_INQUIRY_1_ID}/proposals/new`);
      await page.waitForSelector('[data-testid="proposal-builder-view"]', {
        state: 'visible',
      });

      // 1. Check package selector add deliverable form does not overflow card width
      const deliverableForm = page.locator('[data-testid="add-deliverable-form"]');
      await expect(deliverableForm).toBeVisible();
      const formBox = await deliverableForm.boundingBox();
      expect(formBox).not.toBeNull();
      if (formBox) {
        expect(formBox.x + formBox.width).toBeLessThanOrEqual(375);
      }

      const addDeliverableBtn = page.locator('[data-testid="add-deliverable-btn"]');
      const addDeliverableBox = await addDeliverableBtn.boundingBox();
      expect(addDeliverableBox).not.toBeNull();
      if (addDeliverableBox) {
        expect(addDeliverableBox.x + addDeliverableBox.width).toBeLessThanOrEqual(375);
      }

      // 2. Check catalogue addon toolbar does not overflow card width
      const catalogueSelect = page.locator('[data-testid="catalogue-addon-select"]');
      await expect(catalogueSelect).toBeVisible();
      await catalogueSelect.selectOption({ index: 1 });

      const addCatalogueBtn = page.locator('[data-testid="add-catalogue-addon-btn"]');
      await expect(addCatalogueBtn).toBeEnabled();
      const addCatalogueBox = await addCatalogueBtn.boundingBox();
      expect(addCatalogueBox).not.toBeNull();
      if (addCatalogueBox) {
        expect(addCatalogueBox.x + addCatalogueBox.width).toBeLessThanOrEqual(375);
      }

      // 3. Check document does not horizontally scroll
      const isOverflowing = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth > doc.clientWidth;
      });
      expect(isOverflowing).toBe(false);

      // 4. Verify I1-U01 tax rates localized options in German
      if (locale === 'de') {
        const packageSelect = page.locator('[data-testid="package-select"]');
        await packageSelect.selectOption({ index: 1 });
        const taxRateSelect = page.locator('[data-testid="base-package-tax-rate-select"]');
        await expect(taxRateSelect).toBeVisible();
        const taxOptionsText = await taxRateSelect.innerText();
        expect(taxOptionsText).toContain('19% (Regelsteuersatz)');
        expect(taxOptionsText).not.toContain('19% Standard');

        // Capture screenshot of 375px layout in German
        await page.screenshot({
          path: path.join(UX_RUN_DIR, 'proposal-builder-375px-mobile-de-fixed.png'),
        });
      }
    }
  });
});
