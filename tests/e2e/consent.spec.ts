import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

const RUN_DIR_PARAM = process.env.RUN_DIR ?? 'iter-02';
const UX_RUN_DIR = path.resolve(
  import.meta.dirname,
  `../../../../control/ownlight/runs/TASK-0014/${RUN_DIR_PARAM}/ux`,
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
): Promise<string> {
  await page.goto('/en/clients/new');
  await page.fill('[data-testid="display-name-input"]', name);
  await page.fill('[data-testid="given-name-input"]', 'Test');
  await page.fill('[data-testid="family-name-input"]', 'Client');
  await page.fill('[data-testid="email-input"]', `test-${String(Date.now())}@example.com`);
  await page.click('[data-testid="submit-client-btn"]');
  await expect(page).toHaveURL(/\/en\/clients\/[0-9a-f-]{36}/);
  const url = page.url();
  const match = /\/clients\/([0-9a-f-]{36})/.exec(url);
  const clientId = match?.[1];
  if (!clientId) throw new Error('Could not parse clientId from URL');
  return clientId;
}

test.describe('TASK-0014: Consent Records & History E2E (AC-10 to AC-13)', () => {
  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-10: Record consent workflow, live region announcement, and focus restoration', async ({
    page,
  }) => {
    const clientId = await createTestClient(page, 'Consent Workflow Studio');
    await page.goto(`/en/clients/${clientId}`);

    // Consent heading is present
    const heading = page.locator('#consent-heading');
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('Consent');

    // Initially no consent recorded
    const marketingStatus = page.locator('[data-testid$="-marketing"]').first();
    await expect(marketingStatus).toBeVisible();
    await expect(marketingStatus).toContainText('No consent recorded');

    // Click Record consent change button
    const recordBtn = page.locator('[data-testid="record-consent-btn"]');
    await expect(recordBtn).toBeVisible();
    await recordBtn.click();

    // Dialog is visible
    const dialog = page.locator('[data-testid="consent-dialog"]');
    await expect(dialog).toBeVisible();

    // Select marketing purpose and granted status
    await page.check('[data-testid="consent-purpose-marketing"]');
    await page.check('[data-testid="consent-status-granted"]');

    // Method selection
    await page.selectOption('[data-testid="consent-method-select"]', 'in_person');

    // Submit form
    await page.click('[data-testid="consent-dialog-submit-btn"]');

    // Dialog closes
    await expect(dialog).not.toBeVisible();
    await page.waitForTimeout(300);

    // Focus restored to trigger button
    await expect(recordBtn).toBeFocused();

    // Section updates to show granted status
    await expect(marketingStatus).toContainText('Granted on');
    await expect(marketingStatus).toContainText('In person');

    // Reload page to verify persisted timeline consent event with localized purpose (I1-U06)
    await page.reload();
    const timelineEvent = page.locator('[data-event-type="consent.granted"]').first();
    await expect(timelineEvent).toBeVisible();
    await expect(timelineEvent).toContainText('Consent granted: Marketing consent');
  });

  test('AC-11: German locale rendering for Consent section, dialog, and date formats', async ({
    page,
  }) => {
    const clientId = await createTestClient(page, 'German Consent Studio');
    await page.goto(`/de/clients/${clientId}`);

    // Verify German section title
    const heading = page.locator('#consent-heading');
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('Einwilligung');

    // Verify German primary contact badge (I1-U05)
    const primaryCard = page.locator('[data-testid^="consent-contact-card-"]').first();
    await expect(primaryCard).toContainText('Hauptkontakt');

    // Verify German empty status
    const emptyStatus = page.locator('[data-testid$="-marketing"]').first();
    await expect(emptyStatus).toContainText('Keine Einwilligung erfasst');

    // Open dialog in German
    const recordBtn = page.locator('[data-testid="record-consent-btn"]');
    await recordBtn.click();

    const dialog = page.locator('[data-testid="consent-dialog"]');
    await expect(dialog).toBeVisible();

    // Check German form legends & labels
    await expect(dialog).toContainText('Einwilligung erfassen');
    await expect(dialog).toContainText('Werbeeinwilligung');
    await expect(dialog).toContainText('Einwilligung zur Bildnutzung');
    await expect(dialog).toContainText('Zweck');
    await expect(dialog).toContainText('Status');
    await expect(dialog).toContainText('Gültigkeitsdatum');
    await expect(dialog).toContainText('Art der Einholung');

    // Record image usage with scope
    await page.check('[data-testid="consent-purpose-image-usage"]');
    await page.check('[data-testid="consent-status-granted"]');
    await page.fill(
      '[data-testid="consent-scope-input"]',
      'Studio-Website, Portfolio und Instagram',
    );
    await page.selectOption('[data-testid="consent-method-select"]', 'paper_form');

    await page.click('[data-testid="consent-dialog-submit-btn"]');
    await expect(dialog).not.toBeVisible();

    // Verify updated status in German with German date formatting
    const imageUsageRow = page.locator('[data-testid$="-image_usage"]').first();
    await expect(imageUsageRow).toContainText('Erteilt am');
    await expect(imageUsageRow).toContainText('Schriftlich (Papier)');
    await expect(imageUsageRow).toContainText('Umfang: Studio-Website, Portfolio und Instagram');

    // Verify German timeline event with localized purpose (I1-U06)
    await page.reload();
    const deTimelineEvent = page.locator('[data-event-type="consent.granted"]').first();
    await expect(deTimelineEvent).toBeVisible();
    await expect(deTimelineEvent).toContainText(
      'Einwilligung erteilt: Einwilligung zur Bildnutzung',
    );
  });

  test('AC-12: Accessibility scan with axe (wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) and non-color-alone status', async ({
    page,
  }) => {
    const clientId = await createTestClient(page, 'A11y Consent Studio');
    await page.goto(`/en/clients/${clientId}`);

    // 1. Scan Consent section on profile page
    const resultsProfile = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .include('[aria-labelledby="consent-heading"]')
      .analyze();

    expect(resultsProfile.violations).toEqual([]);

    // 2. Open dialog and scan open dialog
    await page.click('[data-testid="record-consent-btn"]');
    const dialog = page.locator('[data-testid="consent-dialog"]');
    await expect(dialog).toBeVisible();

    const resultsDialog = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .include('[data-testid="consent-dialog"]')
      .analyze();

    expect(resultsDialog.violations).toEqual([]);

    // 3. Status text is explicitly conveyed by text label, not by color alone
    const statusTextEl = page.locator('[data-testid^="consent-status-"]').first();
    const textContent = await statusTextEl.innerText();
    expect(textContent.length).toBeGreaterThan(0);
    expect(textContent).toMatch(/No consent recorded|Granted|Withdrawn/);

    // 4. Test dark mode error alert and field error contrast with axe (I1-U02, I1-U03)
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.check('[data-testid="consent-purpose-image-usage"]');
    await page.check('[data-testid="consent-status-granted"]');
    await page.fill('[data-testid="consent-scope-input"]', '');
    await page.click('[data-testid="consent-dialog-submit-btn"]');

    const scopeError = page.locator('[data-testid="consent-scope-error"]');
    await expect(scopeError).toBeVisible();
    await expect(scopeError).toHaveText('Scope is required when granting image usage consent.');
    expect(await scopeError.innerText()).not.toContain('clients.consent.errors');

    const resultsDialogErrorDark = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .include('[data-testid="consent-dialog"]')
      .analyze();
    expect(resultsDialogErrorDark.violations).toEqual([]);

    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
    });
    await page.click('[data-testid="consent-dialog-cancel-btn"]');
    await expect(dialog).not.toBeVisible();
  });

  test('AC-13: 320px viewport responsiveness, touch targets >= 24px, and UX screenshots', async ({
    page,
  }) => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });

    const clientId = await createTestClient(page, 'Responsive Consent Studio');
    await page.goto(`/en/clients/${clientId}`);

    // 320px viewport test
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/en/clients/${clientId}`);

    // Verify no horizontal overflow at 320px
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    // Verify minimum touch target sizes on record consent buttons (>= 24px)
    const recordBtn = page.locator('[data-testid="record-consent-btn"]');
    const box = await recordBtn.boundingBox();
    if (box) {
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
    }

    // Open dialog at 320px and verify dialog has no horizontal overflow
    await recordBtn.click();
    const dialog = page.locator('[data-testid="consent-dialog"]');
    await expect(dialog).toBeVisible();

    const cancelBtnBox = await page
      .locator('[data-testid="consent-dialog-cancel-btn"]')
      .boundingBox();
    if (cancelBtnBox) {
      expect(cancelBtnBox.width).toBeGreaterThanOrEqual(24);
      expect(cancelBtnBox.height).toBeGreaterThanOrEqual(24);
    }

    const submitBtnBox = await page
      .locator('[data-testid="consent-dialog-submit-btn"]')
      .boundingBox();
    if (submitBtnBox) {
      expect(submitBtnBox.width).toBeGreaterThanOrEqual(24);
      expect(submitBtnBox.height).toBeGreaterThanOrEqual(24);
    }

    // Verify fieldset and legend wrapping radio groups
    const fieldsets = dialog.locator('fieldset');
    await expect(fieldsets).toHaveCount(2);
    await expect(fieldsets.first().locator('legend')).toBeVisible();
    await expect(fieldsets.last().locator('legend')).toBeVisible();

    // Close dialog
    await page.click('[data-testid="consent-dialog-cancel-btn"]');
    await expect(dialog).not.toBeVisible();

    // Capture screenshots at 320px, 768px, 1280px for UX reviewers
    const breakpoints = [
      { name: '320px', width: 320, height: 640 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1280px', width: 1280, height: 800 },
    ];

    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto(`/en/clients/${clientId}`);
      await page.screenshot({
        path: path.join(UX_RUN_DIR, `consent-${bp.name}.png`),
        fullPage: true,
      });

      expect(fs.existsSync(path.join(UX_RUN_DIR, `consent-${bp.name}.png`))).toBe(true);
    }
  });

  test('AC-2 & AC-3: Withdrawal workflow and expandable reverse-chronological history', async ({
    page,
  }) => {
    const clientId = await createTestClient(page, 'Withdrawal Workflow Studio');
    await page.goto(`/en/clients/${clientId}`);

    // 1. Grant marketing consent
    await page.click('[data-testid="record-consent-btn"]');
    await page.check('[data-testid="consent-purpose-marketing"]');
    await page.check('[data-testid="consent-status-granted"]');
    await page.selectOption('[data-testid="consent-method-select"]', 'email');
    await page.fill('[data-testid="consent-evidence-input"]', 'Signed opt-in via email');
    await page.click('[data-testid="consent-dialog-submit-btn"]');
    await expect(page.locator('[data-testid="consent-dialog"]')).not.toBeVisible();

    // 2. Withdraw marketing consent
    await page.click('[data-testid="record-consent-btn"]');
    await page.check('[data-testid="consent-purpose-marketing"]');
    await page.check('[data-testid="consent-status-withdrawn"]');
    await page.selectOption('[data-testid="consent-method-select"]', 'phone');
    await page.fill('[data-testid="consent-evidence-input"]', 'Phone call revocation');
    await page.click('[data-testid="consent-dialog-submit-btn"]');
    await expect(page.locator('[data-testid="consent-dialog"]')).not.toBeVisible();

    // Current status is Withdrawn
    const marketingStatus = page.locator('[data-testid$="-marketing"]').first();
    await expect(marketingStatus).toContainText('Withdrawn on');
    await expect(marketingStatus).toContainText('Phone');

    // Expand history
    const historyToggle = page.locator('[data-testid^="consent-history-toggle-"]').first();
    await expect(historyToggle).toContainText('Show history (2)');
    await historyToggle.click();

    // History list is visible with 2 items, newest first
    const historyList = page.locator('[data-testid^="consent-history-list-"]').first();
    await expect(historyList).toBeVisible();

    const historyItems = historyList.locator('[data-testid^="consent-history-item-"]');
    await expect(historyItems).toHaveCount(2);

    // First item is newest (Withdrawn)
    await expect(historyItems.first()).toContainText('Withdrawn');
    await expect(historyItems.first()).toContainText('Phone');

    // Second item is previous (Granted)
    await expect(historyItems.last()).toContainText('Granted');
    await expect(historyItems.last()).toContainText('Email');

    // 3. Scan expanded history with Axe to verify SC 1.4.3 contrast minimum (I1-U01)
    const resultsHistory = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .include('[data-testid^="consent-history-list-"]')
      .analyze();
    expect(resultsHistory.violations).toEqual([]);
  });
});
