import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';
import { E2E_PACKAGE_WEDDING_ID, E2E_CATALOGUE_ITEM_1_ID } from '../helpers/e2e-proposals-helper';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

function getLatestRunDir(): string {
  if (process.env.RUN_DIR) return process.env.RUN_DIR;
  const runsRoot = path.resolve(import.meta.dirname, '../../../../control/ownlight/runs/TASK-0062');
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
  `../../../../control/ownlight/runs/TASK-0062/${RUN_DIR_PARAM}/ux`,
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

test.describe('TASK-0062: Public Interactive Proposal Acceptance E2E Tests', () => {
  let createdProjectId = '';
  let proposalRawToken = '';
  let publicProposalUrl = '';

  test.beforeAll(async ({ browser }) => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });

    // 1. Setup owner page to compose and send a test proposal
    const page = await browser.newPage();
    await ensureOwnerBootstrappedAndSignedIn(page);

    // 2. Create isolated project via New Project modal
    await page.goto('/en/projects?view=list');
    const newProjectBtn = page.locator('[data-testid="new-project-btn"]').first();
    await expect(newProjectBtn).toBeVisible({ timeout: 10000 });
    await newProjectBtn.click();

    const dialog = page.locator('[data-testid="new-project-dialog"]');
    await expect(dialog).toBeVisible();

    await page.locator('[data-testid="new-project-title-input"]').fill('Acceptance E2E Commission');
    await page.locator('[data-testid="new-project-type-select"]').selectOption('commercial');
    await page.locator('[data-testid="new-project-price-input"]').fill('2800.00');

    await page.locator('[data-testid="new-project-submit-btn"]').click();
    await expect(page).toHaveURL(/\/en\/projects\/[0-9a-f-]{36}/, { timeout: 10000 });

    const createdUrl = page.url();
    const parsedId = createdUrl.split('/').pop()?.split('?')[0];
    if (parsedId) {
      createdProjectId = parsedId;
    }
    expect(createdProjectId).not.toBe('');

    // 3. Compose a proposal with base package and optional add-on
    await page.goto(`/en/projects/${createdProjectId}/proposals/new`);
    await expect(page.locator('[data-testid="proposal-builder-view"]')).toBeVisible({
      timeout: 10000,
    });

    // Select base package
    const packageSelect = page.locator('[data-testid="package-select"]');
    await expect(packageSelect).toBeVisible();
    await packageSelect.selectOption(E2E_PACKAGE_WEDDING_ID);

    // Add optional add-on
    const addonSelect = page.locator('[data-testid="catalogue-addon-select"]');
    await addonSelect.selectOption(E2E_CATALOGUE_ITEM_1_ID);
    await page.locator('[data-testid="add-catalogue-addon-btn"]').click();

    // Configure add-on as optional with max quantity = 2
    const optionalToggle = page.locator('[data-testid="addon-optional-toggle-0"]');
    await optionalToggle.check();
    const maxQtyInput = page.locator('[data-testid="addon-max-quantity-0"]');
    await maxQtyInput.fill('2');

    // Save draft
    await page.locator('[data-testid="save-draft-btn"]').click();
    await expect(page).toHaveURL(
      new RegExp(`.*/projects/${createdProjectId}/proposals/[0-9a-f-]{36}`),
      { timeout: 10000 },
    );

    // Send proposal to client
    const openSendBtn = page.locator('[data-testid="open-send-proposal-btn"]');
    await expect(openSendBtn).toBeVisible({ timeout: 10000 });
    await openSendBtn.click();

    const sendModal = page.locator('[data-testid="send-proposal-modal"]');
    await expect(sendModal).toBeVisible();
    await page.waitForTimeout(300);

    const emailInput = page.locator('[data-testid="send-recipient-email-input"]');
    await emailInput.fill('emma.watson@example.com');

    await page.locator('[data-testid="submit-send-proposal-btn"]').click();

    // Read generated proposal URL
    const tokenUrlElement = page.locator('[data-testid="proposal-token-url"]');
    await expect(tokenUrlElement).toBeVisible({ timeout: 10000 });
    publicProposalUrl = await tokenUrlElement.inputValue();
    expect(publicProposalUrl).toContain('/p/');

    const tokenMatch = /\/p\/([a-zA-Z0-9_-]+)/.exec(publicProposalUrl);
    if (tokenMatch?.[1]) {
      proposalRawToken = tokenMatch[1];
    }
    expect(proposalRawToken).not.toBe('');

    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    // Clean up created project to preserve test isolation across pipeline Kanban tests
    if (createdProjectId) {
      const page = await browser.newPage();
      await ensureOwnerBootstrappedAndSignedIn(page);
      await page.goto('/en/projects?view=list');

      page.once('dialog', (dialog) => void dialog.accept());
      const trigger = page.locator(`[data-testid="project-actions-trigger-${createdProjectId}"]`);
      if (await trigger.isVisible({ timeout: 2000 }).catch(() => false)) {
        await trigger.click();
        const deleteBtn = page.locator(`[data-testid="project-action-delete-${createdProjectId}"]`);
        await deleteBtn.click();
        await expect(
          page.locator(`[data-testid="project-table-row-${createdProjectId}"]`),
        ).not.toBeVisible({ timeout: 5000 });
      }
      await page.close();
    }
  });

  test('AC-1: Cookieless protection & security headers on public proposal route', async ({
    request,
  }) => {
    expect(proposalRawToken).toBeDefined();
    const response = await request.get(`/en/p/${proposalRawToken}`);
    expect(response.status()).toBe(200);

    const headers = response.headers();
    // Verify X-Robots-Tag prevents search engine indexing
    expect(headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    // Verify set-cookie is stripped
    expect(headers['set-cookie']).toBeUndefined();
  });

  test('AC-2 & AC-3: Public proposal client acceptance journey, reactive calculation, modal validation, and acceptance confirmation', async ({
    browser,
  }) => {
    test.setTimeout(90000);
    expect(proposalRawToken).toBeDefined();

    // Client visits in a fresh unauthenticated browser context
    const clientContext = await browser.newContext();
    const page = await clientContext.newPage();

    await page.goto(`/en/p/${proposalRawToken}`);
    const proposalView = page.locator('[data-testid="public-proposal-view"]');
    await expect(proposalView).toBeVisible({ timeout: 10000 });

    // 1. Verify deliverables & initial pricing
    const basePkg = page.locator('[data-testid^="base-package-"]');
    await expect(basePkg).toBeVisible();
    await expect(basePkg).toContainText('Intimate Wedding Story');
    await expect(basePkg).toContainText('8 Hours Continuous Coverage');

    // Initial total is €3,050.00 (€2,800 base + €250 add-on checked by default)
    const totalDisplay = page.locator('[data-testid="summary-total"]');
    await expect(totalDisplay).toContainText('3,050.00');

    // 2. Toggle optional add-on checkbox off
    const addonToggle = page.locator('[data-testid^="addon-checkbox-"]');
    await expect(addonToggle).toBeVisible();
    await addonToggle.click();

    // Subtotal and total reactively update to €2,800.00
    await expect(totalDisplay).toContainText('2,800.00');

    // Toggle back on
    await addonToggle.click();
    await expect(totalDisplay).toContainText('3,050.00');

    // 3. Increase add-on quantity from 1 to 2
    const increaseBtn = page.locator('[data-testid="addon-qty-increase"]');
    await expect(increaseBtn).toBeVisible();
    await increaseBtn.click();

    // Subtotal and total reactively update to €3,300.00 (€2,800 + €250 * 2)
    await expect(totalDisplay).toContainText('3,300.00');

    // 4. Decrease back to quantity 1
    const decreaseBtn = page.locator('[data-testid="addon-qty-decrease"]');
    await expect(decreaseBtn).toBeVisible();
    await decreaseBtn.click();
    await expect(totalDisplay).toContainText('3,050.00');

    // Capture desktop proposal screenshot for UX review
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'desktop-proposal-public-en.png'),
      fullPage: true,
    });

    // 5. Open Accept Proposal modal (WCAG 2.4.3 focus restoration check)
    const openAcceptBtn = page.locator('[data-testid="accept-proposal-btn"]');
    await expect(openAcceptBtn).toBeVisible();
    await openAcceptBtn.click();

    const acceptModal = page.locator('[data-testid="accept-proposal-dialog"]');
    await expect(acceptModal).toBeVisible();
    await page.waitForTimeout(300); // Wait for modal fade-in animation

    // Capture modal screenshot for UX review
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'desktop-proposal-public-modal.png'),
    });

    // 6. Test form validation on empty submit (WCAG 3.3.1 error association)
    const submitBtn = page.locator('[data-testid="confirm-accept-btn"]');
    const nameInput = page.locator('[data-testid="accepted-name-input"]');
    const emailInput = page.locator('[data-testid="accepted-email-input"]');
    const agreementCheckbox = page.locator('[data-testid="agreement-checkbox"]');

    await nameInput.fill('');
    await emailInput.fill('');
    if (await agreementCheckbox.isChecked()) {
      await agreementCheckbox.uncheck();
    }
    await submitBtn.click();

    // Verify name error and programmatic attributes
    await expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    await expect(nameInput).toHaveAttribute('aria-describedby', 'accepted-by-name-error');
    await expect(page.locator('#accepted-by-name-error')).toBeVisible();

    // Verify email error and programmatic attributes
    await expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    await expect(emailInput).toHaveAttribute('aria-describedby', 'accepted-by-email-error');
    await expect(page.locator('#accepted-by-email-error')).toBeVisible();

    // Verify agreement error and programmatic attributes
    await expect(agreementCheckbox).toHaveAttribute('aria-invalid', 'true');
    await expect(agreementCheckbox).toHaveAttribute('aria-describedby', 'agreement-error');
    await expect(page.locator('#agreement-error')).toBeVisible();

    // 7. Fill valid form data
    await nameInput.fill('Emma Watson');
    await emailInput.fill('emma.watson@example.com');
    await agreementCheckbox.check();

    // 8. Submit acceptance
    await submitBtn.click();

    // Verify modal closes
    await expect(acceptModal).not.toBeVisible({ timeout: 10000 });

    // Verify accepted banner is displayed
    const acceptedBanner = page.locator('[data-testid="proposal-accepted-banner"]');
    await expect(acceptedBanner).toBeVisible({ timeout: 10000 });
    await expect(acceptedBanner).toContainText('Emma Watson');

    // Verify "Accept Proposal" button is no longer visible
    await expect(openAcceptBtn).not.toBeVisible();

    // Verify add-on controls are now disabled
    await expect(addonToggle).toBeDisabled();

    // Capture accepted state screenshot for UX review
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'desktop-proposal-public-accepted.png'),
      fullPage: true,
    });

    await clientContext.close();
  });

  test('AC-7: German localized proposal view /de/p/[token]', async ({ browser }) => {
    test.setTimeout(60000);
    expect(proposalRawToken).toBeDefined();

    const clientContext = await browser.newContext();
    const page = await clientContext.newPage();

    await page.goto(`/de/p/${proposalRawToken}`);
    const proposalView = page.locator('[data-testid="public-proposal-view"]');
    await expect(proposalView).toBeVisible({ timeout: 10000 });

    // Verify German translated badge and text
    const statusBadge = page.locator('[data-testid="proposal-lifecycle-badge"]');
    await expect(statusBadge).toContainText('Angenommen');

    const acceptedBanner = page.locator('[data-testid="proposal-accepted-banner"]');
    await expect(acceptedBanner).toBeVisible();
    await expect(acceptedBanner).toContainText('Angebot angenommen');

    // Capture German view screenshot for UX review
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'desktop-proposal-public-de.png'),
      fullPage: true,
    });

    await clientContext.close();
  });

  test('AC-2 & AC-7: WCAG 2.2 AA Accessibility (Axe scan across Light and Dark themes)', async ({
    browser,
  }) => {
    test.setTimeout(90000);
    expect(proposalRawToken).toBeDefined();

    const clientContext = await browser.newContext();
    const page = await clientContext.newPage();

    // 1. Light Mode Axe Scan on accepted view
    await page.goto(`/en/p/${proposalRawToken}`);
    await expect(page.locator('[data-testid="public-proposal-view"]')).toBeVisible();

    const axeLight = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axeLight.violations).toEqual([]);

    // 2. Dark Mode Axe Scan
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);

    const axeDark = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axeDark.violations).toEqual([]);

    await clientContext.close();
  });

  test('AC-4: Non-existent proposal token renders 404 Not Found', async ({ page }) => {
    const response = await page.goto(
      '/en/p/0000000000000000000000000000000000000000000000000000000000000000',
    );
    expect(response?.status()).toBe(404);
  });
});
