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
  const runsRoot = path.resolve(import.meta.dirname, '../../../../control/ownlight/runs/TASK-0063');
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
  `../../../../control/ownlight/runs/TASK-0063/${RUN_DIR_PARAM}/ux`,
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
  email: string,
  locale = 'en',
): Promise<string> {
  await page.goto(`/${locale}/clients/new`);
  await page.fill('[data-testid="display-name-input"]', name);
  await page.fill('[data-testid="given-name-input"]', name.split(' ')[0] ?? name);
  await page.fill('[data-testid="family-name-input"]', name.split(' ')[1] ?? 'Client');
  await page.fill('[data-testid="email-input"]', email);
  await page.click('[data-testid="submit-client-btn"]');
  await expect(page).toHaveURL(new RegExp(`/${locale}/clients/[0-9a-f-]{36}`));
  const url = page.url();
  const match = /\/clients\/([0-9a-f-]{36})/.exec(url);
  const clientId = match?.[1];
  if (!clientId) throw new Error('Could not parse clientId from URL');
  return clientId;
}

test.describe('TASK-0063: Epic E5 Complete E2E Journey Spec', () => {
  let createdClientId = '';
  let createdProjectId = '';
  let proposalRawToken = '';
  let publicProposalUrl = '';

  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test.afterAll(async ({ browser }) => {
    // Clean up created project and client to preserve baseline seed counts
    const page = await browser.newPage();
    await ensureOwnerBootstrappedAndSignedIn(page);

    if (createdProjectId) {
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
    }

    if (createdClientId) {
      await page.goto(`/en/clients/${createdClientId}`);
      const deleteBtn = page.locator('[data-testid="delete-client-btn"]');
      if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await deleteBtn.click();
        const confirmInput = page.locator('[data-testid="erasure-confirmation-input"]');
        if (await confirmInput.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmInput.fill('Clara Journey');
          await page.locator('[data-testid="erasure-submit-btn"]').click();
          await expect(page).toHaveURL(/\/en\/clients/, { timeout: 5000 });
        }
      }
    }

    await page.close();
  });

  test('AC-4: Complete Epic E5 Journey (Catalogue -> Proposal -> Link -> Client Acceptance -> Booked Stage & Timeline)', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180000);

    // -----------------------------------------------------------------
    // Step 1: Owner login & Packages Catalogue verification
    // -----------------------------------------------------------------
    await ensureOwnerBootstrappedAndSignedIn(page);

    await page.goto('/en/settings/packages');
    await expect(page.locator('[data-testid="packages-settings-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-packages"]')).toBeVisible();

    // Verify packages catalogue renders and contains wedding package
    const weddingCard = page.locator('[data-testid="package-card-intimate-wedding-story"]');
    await expect(weddingCard).toBeVisible({ timeout: 10000 });
    await expect(weddingCard).toContainText('Intimate Wedding Story');

    // Light & Dark axe check on packages settings
    const axePackages = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axePackages.violations).toEqual([]);

    // -----------------------------------------------------------------
    // Step 2: Create isolated test client & inquiry project
    // -----------------------------------------------------------------
    const testTimestamp = Date.now();
    const clientEmail = `clara.e5.${String(testTimestamp)}@example.com`;
    createdClientId = await createTestClient(page, 'Clara Journey', clientEmail, 'en');

    await page.goto('/en/projects?view=list');
    const newProjectBtn = page.locator('[data-testid="new-project-btn"]').first();
    await expect(newProjectBtn).toBeVisible({ timeout: 10000 });
    await newProjectBtn.click();

    const newProjectDialog = page.locator('[data-testid="new-project-dialog"]');
    await expect(newProjectDialog).toBeVisible();

    await page.locator('[data-testid="new-project-title-input"]').fill('Epic E5 Commission');
    await page.locator('[data-testid="new-project-client-select"]').selectOption(createdClientId);
    await page.locator('[data-testid="new-project-type-select"]').selectOption('wedding');
    await page.locator('[data-testid="new-project-price-input"]').fill('2800.00');

    await page.locator('[data-testid="new-project-submit-btn"]').click();
    await expect(page).toHaveURL(/\/en\/projects\/[0-9a-f-]{36}/, { timeout: 10000 });

    const createdUrl = page.url();
    const parsedProjectId = /\/projects\/([0-9a-f-]{36})/.exec(createdUrl)?.[1];
    if (!parsedProjectId) throw new Error('Could not parse created projectId');
    createdProjectId = parsedProjectId;

    // -----------------------------------------------------------------
    // Step 3: Project Detail View - Proposals Tab Initial State
    // -----------------------------------------------------------------
    await page.goto(`/en/projects/${createdProjectId}`);
    await expect(page.locator('[data-testid="project-detail-view"]')).toBeVisible();

    const proposalsTab = page.locator('[data-testid="tab-proposals"]');
    await expect(proposalsTab).toBeVisible();
    await proposalsTab.click();

    // Verify empty state
    const emptyState = page.locator('[data-testid="proposals-empty-state"]');
    await expect(emptyState).toBeVisible();
    await expect(page.locator('[data-testid="new-proposal-btn"]')).toBeVisible();

    // -----------------------------------------------------------------
    // Step 4: Proposal Builder Workspace - Compose & Send Proposal
    // -----------------------------------------------------------------
    await page.locator('[data-testid="new-proposal-btn"]').first().click();
    await expect(page).toHaveURL(new RegExp(`.*/projects/${createdProjectId}/proposals/new`), {
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="proposal-builder-view"]')).toBeVisible();

    // Select base package
    const packageSelect = page.locator('[data-testid="package-select"]');
    await expect(packageSelect).toBeVisible();
    await packageSelect.selectOption(E2E_PACKAGE_WEDDING_ID);
    await expect(page.locator('[data-testid="base-package-price-input"]')).toHaveValue('2800.00');

    // Add catalogue add-on
    const addonSelect = page.locator('[data-testid="catalogue-addon-select"]');
    await addonSelect.selectOption(E2E_CATALOGUE_ITEM_1_ID);
    await page.locator('[data-testid="add-catalogue-addon-btn"]').click();

    // Configure add-on as optional with max quantity = 2
    const optionalToggle = page.locator('[data-testid="addon-optional-toggle-0"]');
    await optionalToggle.check();
    await expect(optionalToggle).toBeChecked();

    const maxQtyInput = page.locator('[data-testid="addon-max-quantity-0"]');
    await maxQtyInput.fill('2');

    // Verify total includes base (2800.00) + default selected add-on (250.00) = 3050.00
    await expect(page.locator('[data-testid="financial-summary-total"]')).toContainText('3,050.00');

    // Save draft
    await page.locator('[data-testid="save-draft-btn"]').click();
    await expect(page).toHaveURL(
      new RegExp(`.*/projects/${createdProjectId}/proposals/[0-9a-f-]{36}`),
      { timeout: 10000 },
    );
    await expect(page.locator('[data-testid="proposal-status-badge"]')).toContainText('Draft');

    // Send proposal to client
    const openSendBtn = page.locator('[data-testid="open-send-proposal-btn"]');
    await expect(openSendBtn).toBeVisible();
    await openSendBtn.click();

    const sendModal = page.locator('[data-testid="send-proposal-modal"]');
    await expect(sendModal).toBeVisible();
    await page.waitForTimeout(300);

    const emailInput = page.locator('[data-testid="send-recipient-email-input"]');
    await emailInput.fill(clientEmail);

    await page.locator('[data-testid="submit-send-proposal-btn"]').click();

    // Read generated proposal token URL
    const tokenUrlElement = page.locator('[data-testid="proposal-token-url"]');
    await expect(tokenUrlElement).toBeVisible({ timeout: 10000 });
    publicProposalUrl = await tokenUrlElement.inputValue();
    expect(publicProposalUrl).toContain('/p/');

    const tokenMatch = /\/p\/([a-zA-Z0-9_-]+)/.exec(publicProposalUrl);
    if (!tokenMatch?.[1]) throw new Error('Could not parse token from proposal URL');
    proposalRawToken = tokenMatch[1];

    // Capture screenshot of proposal builder send notification
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'desktop-proposal-builder-sent.png'),
    });

    // -----------------------------------------------------------------
    // Step 5: Project Detail View - Sent Proposal Card & Copy Public Link
    // -----------------------------------------------------------------
    await page.goto(`/en/projects/${createdProjectId}`);
    await expect(page.locator('[data-testid="project-detail-view"]')).toBeVisible();

    const proposalsTabAfterSend = page.locator('[data-testid="tab-proposals"]');
    await proposalsTabAfterSend.click();

    // Proposal item is now displayed with "Sent" status badge
    const proposalStatusBadge = page.locator('[data-testid^="proposal-status-badge-"]').first();
    await expect(proposalStatusBadge).toBeVisible();
    await expect(proposalStatusBadge).toContainText('Sent');

    // Copy public link button is present and functional
    const copyLinkBtn = page.locator('[data-testid^="proposal-copy-link-btn-"]').first();
    await expect(copyLinkBtn).toBeVisible();
    await copyLinkBtn.click();

    // Link copied feedback is displayed
    const linkCopiedFeedback = page.locator('[data-testid="link-copied-feedback"]');
    await expect(linkCopiedFeedback).toBeVisible({ timeout: 5000 });

    // Capture screenshot of project proposals tab
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'desktop-project-detail-proposals-sent.png'),
    });

    // -----------------------------------------------------------------
    // Step 6: Client Experience & Acceptance Ceremony (Fresh Context)
    // -----------------------------------------------------------------
    const clientContext = await browser.newContext();
    const clientPage = await clientContext.newPage();

    await clientPage.goto(`/en/p/${proposalRawToken}`);
    const clientProposalView = clientPage.locator('[data-testid="public-proposal-view"]');
    await expect(clientProposalView).toBeVisible({ timeout: 10000 });

    // Cookieless check: verify no session cookie
    const cookies = await clientContext.cookies();
    const sessionCookie = cookies.find((c) => c.name.includes('session'));
    expect(sessionCookie).toBeUndefined();

    // Verify initial total is €3,050.00
    const totalDisplay = clientPage.locator('[data-testid="summary-total"]');
    await expect(totalDisplay).toContainText('3,050.00');

    // Toggle add-on checkbox: total decreases to €2,800.00
    const addonToggle = clientPage.locator('[data-testid^="addon-checkbox-"]');
    await expect(addonToggle).toBeVisible();
    await addonToggle.click();
    await expect(totalDisplay).toContainText('2,800.00');

    // Toggle back on: total restores to €3,050.00
    await addonToggle.click();
    await expect(totalDisplay).toContainText('3,050.00');

    // Verify German localization parity at /de/p/[token]
    await clientPage.goto(`/de/p/${proposalRawToken}`);
    await expect(clientPage.locator('[data-testid="public-proposal-view"]')).toBeVisible();
    await expect(clientPage.locator('[data-testid="accept-proposal-btn"]')).toContainText(
      'Angebot annehmen',
    );

    // Switch back to English for acceptance
    await clientPage.goto(`/en/p/${proposalRawToken}`);
    await expect(clientPage.locator('[data-testid="public-proposal-view"]')).toBeVisible();

    // Open Accept Proposal modal
    const openAcceptBtn = clientPage.locator('[data-testid="accept-proposal-btn"]');
    await expect(openAcceptBtn).toBeVisible();
    await openAcceptBtn.click();

    const acceptModal = clientPage.locator('[data-testid="accept-proposal-dialog"]');
    await expect(acceptModal).toBeVisible();
    await clientPage.waitForTimeout(300);

    // Test form validation: empty submit triggers programmatic errors (WCAG 3.3.1)
    const confirmAcceptBtn = clientPage.locator('[data-testid="confirm-accept-btn"]');
    const nameInput = clientPage.locator('[data-testid="accepted-name-input"]');
    const acceptedEmailInput = clientPage.locator('[data-testid="accepted-email-input"]');
    const agreementCheckbox = clientPage.locator('[data-testid="agreement-checkbox"]');

    await nameInput.fill('');
    await acceptedEmailInput.fill('');
    if (await agreementCheckbox.isChecked()) {
      await agreementCheckbox.uncheck();
    }
    await confirmAcceptBtn.click();

    await expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    await expect(clientPage.locator('#accepted-by-name-error')).toBeVisible();

    // Fill valid acceptance information
    await nameInput.fill('Clara Journey');
    await acceptedEmailInput.fill(clientEmail);
    await agreementCheckbox.check();

    // Submit acceptance ceremony
    await confirmAcceptBtn.click();

    // Modal closes and accepted banner appears
    await expect(acceptModal).not.toBeVisible({ timeout: 10000 });
    const acceptedBanner = clientPage.locator('[data-testid="proposal-accepted-banner"]');
    await expect(acceptedBanner).toBeVisible({ timeout: 10000 });
    await expect(acceptedBanner).toContainText('Clara Journey');

    // Capture screenshot of accepted client view
    await clientPage.screenshot({
      path: path.join(UX_RUN_DIR, 'desktop-proposal-public-accepted.png'),
    });

    await clientContext.close();

    // -----------------------------------------------------------------
    // Step 7: Studio Owner Post-Acceptance Verification
    // -----------------------------------------------------------------
    await page.goto(`/en/projects/${createdProjectId}`);
    await expect(page.locator('[data-testid="project-detail-view"]')).toBeVisible();

    // 1. Project stage automatically updated to "booked"
    const bookedStageStep = page.locator('[data-testid="stage-step-booked"]');
    await expect(bookedStageStep).toBeVisible();
    await expect(bookedStageStep).toHaveAttribute('aria-current', 'step');

    // 2. Project price updated to the accepted total (€3,050.00)
    const projectPrice = page.locator('[data-testid="project-price"]');
    await expect(projectPrice).toBeVisible();
    await expect(projectPrice).toContainText('3,050.00');

    // 3. Proposals section shows "Accepted" status badge & accepted timestamp
    await page.locator('[data-testid="tab-proposals"]').click();
    const acceptedBadge = page.locator('[data-testid^="proposal-status-badge-"]').first();
    await expect(acceptedBadge).toBeVisible();
    await expect(acceptedBadge).toContainText('Accepted');

    const validityText = page.locator('[data-testid^="proposal-validity-"]').first();
    await expect(validityText).toBeVisible();
    await expect(validityText).toContainText('Accepted on');

    // Capture screenshot of accepted proposals tab
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'desktop-project-detail-proposals-accepted.png'),
    });

    // 4. Client timeline contains proposal.accepted event
    await page.goto(`/en/clients/${createdClientId}`);
    await expect(page.locator('[data-testid="timeline-heading"]')).toBeVisible();

    const proposalAcceptedEvent = page.locator('[data-event-type="proposal.accepted"]').first();
    await expect(proposalAcceptedEvent).toBeVisible({ timeout: 10000 });
    await expect(proposalAcceptedEvent).toContainText('Proposal accepted');

    // Capture screenshot of client timeline
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'desktop-client-timeline-proposal-accepted.png'),
    });

    // -----------------------------------------------------------------
    // Step 8: Multi-theme Axe scans across Light & Dark modes
    // -----------------------------------------------------------------
    // Scan client timeline in light mode
    const axeTimelineLight = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axeTimelineLight.violations).toEqual([]);

    // Scan client timeline in dark mode
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);

    const axeTimelineDark = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axeTimelineDark.violations).toEqual([]);
  });
});
