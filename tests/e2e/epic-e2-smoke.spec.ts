import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';
import { E2E_INQUIRY_PUBLISHED_SLUG } from '../helpers/e2e-inquiry-helper';

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

test.describe('TASK-0032 / Epic E2 Smoke Test (AC-9, Permanent Rule R-C)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test('AC-9: complete epic journey from public inquiry submission to client profile conversion', async ({
    page,
    browser,
  }) => {
    test.setTimeout(60000);

    // -------------------------------------------------------------
    // Step 1: Form verification in Studio Owner Settings
    // -------------------------------------------------------------
    await ensureOwnerBootstrappedAndSignedIn(page);
    await page.goto('/en/settings/inquiry-forms');
    await expect(page.locator('h1')).toContainText('Inquiry Forms');

    // Verify published form exists
    const formRow = page.locator('tr:has-text("General Inquiries")');
    await expect(formRow).toBeVisible();
    await expect(formRow).toContainText('Published');

    // -------------------------------------------------------------
    // Step 2: Visitor fills and submits public hosted inquiry form
    // -------------------------------------------------------------
    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();

    const uniqueTag = Date.now().toString().slice(-6);
    const visitorGivenName = 'Eleanor';
    const visitorFamilyName = `Rigby${uniqueTag}`;
    const visitorFullName = `${visitorGivenName} ${visitorFamilyName}`;
    const visitorEmail = `eleanor.rigby.${uniqueTag}@example.com`;
    const inquiryMessage = `Looking for a wedding photographer in Berlin for our autumn wedding. Tag ${uniqueTag}`;

    await visitorPage.goto(`/en/f/${E2E_INQUIRY_PUBLISHED_SLUG}`);
    await expect(visitorPage.locator('h1')).toBeVisible();

    // Fill inquiry form
    await visitorPage.fill('#field-given_name', visitorGivenName);
    await visitorPage.fill('#field-family_name', visitorFamilyName);
    await visitorPage.fill('#field-email', visitorEmail);
    await visitorPage.fill('#field-phone', '+49 30 76543210');
    await visitorPage.selectOption('#field-event_type', 'wedding');
    await visitorPage.fill('#field-message', inquiryMessage);
    await visitorPage.check('#field-notice_acknowledged');

    // Submit inquiry form
    await visitorPage.click('button[type="submit"]');

    // Lands on thanks page
    await expect(visitorPage).toHaveURL(`/en/f/${E2E_INQUIRY_PUBLISHED_SLUG}/thanks`, {
      timeout: 10000,
    });
    await expect(visitorPage.locator('h1')).toContainText('Thank you for your inquiry');

    await visitorContext.close();

    // -------------------------------------------------------------
    // Step 3: Owner leads inbox triage
    // -------------------------------------------------------------
    await page.goto('/en/leads');
    await page.waitForLoadState('networkidle');

    // Unread badge is visible in nav
    const unreadBadge = page.locator('[data-testid="new-leads-badge"]');
    await expect(unreadBadge).toBeVisible();

    // Find the newly submitted lead in the table
    const leadRow = page.locator(`tr:has-text("${visitorFullName}")`).first();
    await expect(leadRow).toBeVisible({ timeout: 10000 });
    await expect(leadRow).toContainText('New');

    // Click into lead detail view
    const viewLink = leadRow.locator('[data-testid^="lead-view-link-"]').first();
    await viewLink.click();
    await expect(page).toHaveURL(/\/en\/leads\/[0-9a-f-]{36}/);

    // Verify lead details displayed
    await expect(page.locator('[data-testid="lead-full-name"]')).toContainText(visitorFullName);
    await expect(page.locator('[data-testid="lead-email-link"]')).toContainText(visitorEmail);
    await expect(page.locator('[data-testid="lead-message-content"]')).toContainText(
      inquiryMessage,
    );

    const leadUrl = page.url();

    // -------------------------------------------------------------
    // Step 4: Owner converts lead to client
    // -------------------------------------------------------------
    const convertBtn = page.locator('[data-testid="convert-lead-btn"]').first();
    await expect(convertBtn).toBeVisible();
    await convertBtn.click();

    // Conversion modal opens
    const dialog = page.locator('[data-testid="convert-lead-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(visitorFullName);
    await expect(dialog).toContainText(visitorEmail);

    // Confirm conversion
    const confirmBtn = page.locator('[data-testid="confirm-convert-btn"]');
    await confirmBtn.click();

    // -------------------------------------------------------------
    // Step 5: Verify client profile, note, and timeline events
    // -------------------------------------------------------------
    await expect(page).toHaveURL(/\/en\/clients\/[0-9a-f-]{36}/, { timeout: 15000 });

    // Client display name
    await expect(page.locator('h1')).toContainText(visitorFullName);

    // Primary contact email
    await expect(page.locator('body')).toContainText(visitorEmail);

    // Client note created with title and verbatim message
    const notesSection = page.locator('[data-testid="client-notes-section"], body');
    await expect(notesSection).toContainText('Inquiry message');
    await expect(notesSection).toContainText(inquiryMessage);

    // Relationship timeline events present
    const timeline = page.locator('[data-testid="client-timeline"], body');
    await expect(timeline).toContainText('Inquiry received');
    await expect(timeline).toContainText('Lead converted to client');

    // Capture epic smoke test evidence screenshot
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'epic-e2-client-profile-1280px.png'),
      fullPage: true,
    });

    // -------------------------------------------------------------
    // Step 6: Verify post-conversion lead row in database / UI
    // -------------------------------------------------------------
    await page.goto(leadUrl);
    await page.waitForLoadState('domcontentloaded');

    // Converted banner is shown
    const banner = page.locator('[data-testid="lead-converted-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Converted to client');

    // Conversion button and status mutation buttons are removed
    await expect(page.locator('[data-testid="convert-lead-btn"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="mark-contacted-btn"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="delete-lead-btn"]')).toHaveCount(0);
  });
});
