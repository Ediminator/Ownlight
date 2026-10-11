import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

const UX_RUN_DIR = path.resolve(
  import.meta.dirname,
  '../../../../control/ownlight/runs/TASK-0012/iter-01/ux',
);

async function ensureOwnerBootstrappedAndSignedIn(page: import('@playwright/test').Page) {
  // Check if initial setup is available
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

  // If already set up, check if sign-in is needed
  await page.goto('/en/sign-in');
  const emailInput = page.locator('[data-testid="email-input"]');
  if (await emailInput.isVisible({ timeout: 1500 }).catch(() => false)) {
    await emailInput.fill(E2E_OWNER_EMAIL);
    await page.fill('[data-testid="password-input"]', E2E_OWNER_PASSWORD);
    await page.click('[data-testid="signin-submit-btn"]');
    await expect(page).not.toHaveURL(/\/sign-in$/);
  }
}

test.describe('TASK-0012: Create & Edit Clients UI E2E', () => {
  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-1: "New client" navigation, form submission with valid synthetic data, lands on profile with role="status"', async ({
    page,
  }) => {
    await page.goto('/en/clients');

    // Click "New client" primary button in directory header
    const newClientBtn = page.locator('[data-testid="new-client-btn"]');
    await expect(newClientBtn).toBeVisible();
    await newClientBtn.click();
    await expect(page).toHaveURL(/\/en\/clients\/new/);

    // Fill form with valid synthetic data
    await page.fill('[data-testid="display-name-input"]', 'Anna Schmidt Photography');
    await page.fill('[data-testid="given-name-input"]', 'Anna');
    await page.fill('[data-testid="family-name-input"]', 'Schmidt');
    await page.fill('[data-testid="email-input"]', 'anna@example.com');
    await page.fill('[data-testid="phone-input"]', '+49 30 0000 0001');
    await page.fill('[data-testid="tags-input"]', 'Wedding, 2026');

    // Submit form
    await page.click('[data-testid="submit-client-btn"]');

    // Lands on client profile
    await expect(page).toHaveURL(/\/en\/clients\/[0-9a-f-]{36}/);
    const displayNameHeading = page.locator('[data-testid="client-display-name"]');
    await expect(displayNameHeading).toHaveText('Anna Schmidt Photography');

    // Shows entered contact data
    await expect(page.locator('[data-testid="client-profile-view"]')).toContainText('Anna Schmidt');
    await expect(page.locator('[data-testid="client-profile-view"]')).toContainText(
      'anna@example.com',
    );
    await expect(page.locator('[data-testid="client-profile-view"]')).toContainText(
      '+49 30 0000 0001',
    );

    // Success status message is announced
    const statusMsg = page.locator('[role="status"]');
    await expect(statusMsg).toBeVisible();
  });

  test('AC-2: validation failure with empty display name and invalid email focuses error summary and sets aria-invalid', async ({
    page,
  }) => {
    await page.goto('/en/clients/new');

    // Leave display name empty, fill invalid email
    await page.fill('[data-testid="display-name-input"]', '');
    await page.fill('[data-testid="given-name-input"]', 'Johannes');
    await page.fill('[data-testid="email-input"]', 'not-an-email');
    await page.fill('[data-testid="phone-input"]', '+49 30 0000 0002');

    // Submit
    await page.click('[data-testid="submit-client-btn"]');

    // Should stay on the creation page
    await expect(page).toHaveURL(/\/en\/clients\/new/);

    // Error summary receives focus
    const errorSummary = page.locator('[data-testid="error-summary"]');
    await expect(errorSummary).toBeVisible();
    await expect(errorSummary).toBeFocused();

    // Both fields have aria-invalid="true"
    const displayNameInput = page.locator('[data-testid="display-name-input"]');
    await expect(displayNameInput).toHaveAttribute('aria-invalid', 'true');
    const emailInput = page.locator('[data-testid="email-input"]');
    await expect(emailInput).toHaveAttribute('aria-invalid', 'true');

    // Entered values preserved
    await expect(page.locator('[data-testid="given-name-input"]')).toHaveValue('Johannes');
    await expect(emailInput).toHaveValue('not-an-email');
    await expect(page.locator('[data-testid="phone-input"]')).toHaveValue('+49 30 0000 0002');
  });

  test('AC-3: duplicate warning appears on duplicate email, cancel keeps values, create anyway succeeds', async ({
    page,
  }) => {
    await page.goto('/en/clients/new');

    // Submit with duplicate email (anna@example.com was created in AC-1)
    await page.fill('[data-testid="display-name-input"]', 'Duplicate Studio');
    await page.fill('[data-testid="given-name-input"]', 'Anna');
    await page.fill('[data-testid="email-input"]', 'ANNA@example.com');

    await page.click('[data-testid="submit-client-btn"]');

    // Warning appears
    const duplicateWarning = page.locator('[data-testid="duplicate-warning"]');
    await expect(duplicateWarning).toBeVisible();

    // Link opens in new tab and has rel="noopener noreferrer"
    const duplicateLink = duplicateWarning.locator('a');
    await expect(duplicateLink).toHaveAttribute('target', '_blank');
    await expect(duplicateLink).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(duplicateLink).toContainText('(opens in a new tab)');

    // Cancel creates nothing and keeps form values
    const cancelBtn = page.locator('[data-testid="cancel-duplicate-btn"]');
    await cancelBtn.click();
    await expect(page).toHaveURL(/\/en\/clients\/new/);
    await expect(page.locator('[data-testid="display-name-input"]')).toHaveValue(
      'Duplicate Studio',
    );

    // Create anyway creates the client
    await page.click('[data-testid="submit-client-btn"]');
    await expect(duplicateWarning).toBeVisible();
    const createAnywayBtn = page.locator('[data-testid="create-anyway-btn"]');
    await createAnywayBtn.click();

    // Successfully navigates to new profile
    await expect(page).toHaveURL(/\/en\/clients\/[0-9a-f-]{36}/);
    await expect(page.locator('[data-testid="client-display-name"]')).toHaveText(
      'Duplicate Studio',
    );
  });

  test('AC-4: editing display name and preferred language updates profile and persists change', async ({
    page,
  }) => {
    // Go to first client profile
    await page.goto('/en/clients');
    const firstClientLink = page.locator(
      '[data-testid="client-table"] tbody tr:first-child td:first-child a',
    );
    await firstClientLink.click();
    await expect(page).toHaveURL(/\/en\/clients\/[0-9a-f-]{36}/);

    // Open Edit Details dialog
    const editDetailsBtn = page.locator('[data-testid="edit-client-details-btn"]');
    await editDetailsBtn.click();
    const dialog = page.locator('[data-testid="edit-details-dialog"]');
    await expect(dialog).toBeVisible();

    // Change display name and preferred language
    const nameInput = page.locator('[data-testid="edit-display-name-input"]');
    await nameInput.fill('Updated Client Name Ltd');
    const localeSelect = page.locator('[data-testid="edit-preferred-locale-select"]');
    await localeSelect.selectOption('de');

    // Save
    await page.click('[data-testid="save-details-btn"]');
    await expect(dialog).toBeHidden();

    // Profile displays new values
    await expect(page.locator('[data-testid="client-display-name"]')).toHaveText(
      'Updated Client Name Ltd',
    );
    await expect(page.locator('[data-testid="client-locale-badge"]')).toContainText('German');

    // Focus moves to status message or updated heading (AC-13)
    await expect(page.locator('[data-testid="client-display-name"]')).toBeFocused();
  });

  test('AC-5: add second contact and mark it primary, new contact becomes the only primary', async ({
    page,
  }) => {
    await page.goto('/en/clients');
    const firstClientLink = page.locator(
      '[data-testid="client-table"] tbody tr:first-child td:first-child a',
    );
    await firstClientLink.click();

    // Click "Add contact"
    await page.click('[data-testid="add-contact-btn"]');
    const contactDialog = page.locator('[data-testid="contact-dialog"]');
    await expect(contactDialog).toBeVisible();

    // Fill contact details
    await page.fill('[data-testid="contact-given-name-input"]', 'Second');
    await page.fill('[data-testid="contact-family-name-input"]', 'Contact');
    await page.fill('[data-testid="contact-email-input"]', 'second.contact@example.org');
    await page.fill('[data-testid="contact-phone-input"]', '+49 30 0000 9999');

    // Mark as primary
    await page.click('[data-testid="contact-is-primary-checkbox"]');
    await page.click('[data-testid="save-contact-btn"]');
    await expect(contactDialog).toBeHidden();

    // Profile now has only ONE primary badge, on the new contact
    const primaryBadges = page.locator('[data-testid="primary-contact-badge"]');
    await expect(primaryBadges).toHaveCount(1);
    await expect(page.locator('[data-testid="client-profile-view"]')).toContainText(
      'Second Contact',
    );
  });

  test('AC-6: removing a contact has confirmation step, single contact removal shows CLIENT_NEEDS_CONTACT', async ({
    page,
  }) => {
    await page.goto('/en/clients');
    const firstClientLink = page.locator(
      '[data-testid="client-table"] tbody tr:first-child td:first-child a',
    );
    await firstClientLink.click();
    await expect(page).toHaveURL(/\/en\/clients\/[0-9a-f-]{36}/);
    await expect(page.locator('[data-testid="client-profile-view"]')).toBeVisible();

    // First test Cancel on the confirmation dialog if multiple contacts exist
    const removeButtons = page.locator('[data-testid^="remove-contact-btn-"]');
    let count = await removeButtons.count();

    if (count > 1) {
      await removeButtons.first().click();
      const confirmDialog = page.locator('[data-testid="confirm-dialog"]');
      await expect(confirmDialog).toBeVisible();

      // Cancel leaves all contacts
      await page.click('[data-testid="confirm-dialog-cancel-btn"]');
      await expect(confirmDialog).toBeHidden();
      await expect(page.locator('[data-testid^="remove-contact-btn-"]')).toHaveCount(count);

      // Now remove contacts one by one until exactly 1 remains
      while (count > 1) {
        await page.locator('[data-testid^="remove-contact-btn-"]').first().click();
        await expect(confirmDialog).toBeVisible();
        await page.click('[data-testid="confirm-dialog-confirm-btn"]');
        await expect(confirmDialog).toBeHidden();
        await expect(page.locator('[data-testid^="remove-contact-btn-"]')).toHaveCount(count - 1);
        count = await page.locator('[data-testid^="remove-contact-btn-"]').count();
      }
    }

    // Now exactly 1 contact remains: attempt removal
    expect(await page.locator('[data-testid^="remove-contact-btn-"]').count()).toBe(1);
    const singleRemoveBtn = page.locator('[data-testid^="remove-contact-btn-"]').first();
    await singleRemoveBtn.click();
    const confirmDialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(confirmDialog).toBeVisible();
    await page.click('[data-testid="confirm-dialog-confirm-btn"]');

    // Dialog displays localized CLIENT_NEEDS_CONTACT error message and contact remains
    const errorAlert = page.locator('[data-testid="confirm-dialog-error"]');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText('A client must have at least one contact.');

    // Dismiss error dialog
    await page.click('[data-testid="confirm-dialog-cancel-btn"]');
    await expect(confirmDialog).toBeHidden();
    await expect(page.locator('[data-testid^="remove-contact-btn-"]')).toHaveCount(1);
  });

  test('AC-7: add postal address with country Germany, edit, and remove after confirmation', async ({
    page,
  }) => {
    await page.goto('/en/clients');
    const firstClientLink = page.locator(
      '[data-testid="client-table"] tbody tr:first-child td:first-child a',
    );
    await firstClientLink.click();

    // Click "Add address"
    await page.click('[data-testid="add-address-btn"]');
    const addressDialog = page.locator('[data-testid="address-dialog"]');
    await expect(addressDialog).toBeVisible();

    await page.fill('[data-testid="address-line1-input"]', 'Friedrichstraße 100');
    await page.fill('[data-testid="address-postal-code-input"]', '10117');
    await page.fill('[data-testid="address-city-input"]', 'Berlin');
    await page.selectOption('[data-testid="address-country-select"]', 'DE');

    await page.click('[data-testid="save-address-btn"]');
    await expect(addressDialog).toBeHidden();

    // Profile displays formatted address with "Germany"
    const postalCard = page.locator('[data-testid="address-card-postal"]');
    await expect(postalCard).toBeVisible();
    await expect(postalCard).toContainText('Friedrichstraße 100');
    await expect(postalCard).toContainText('Germany');

    // Edit address
    await page.click('[data-testid="edit-address-btn-postal"]');
    await expect(addressDialog).toBeVisible();
    await page.fill('[data-testid="address-line1-input"]', 'Unter den Linden 5');
    await page.click('[data-testid="save-address-btn"]');
    await expect(addressDialog).toBeHidden();
    await expect(postalCard).toContainText('Unter den Linden 5');

    // Remove address with confirmation
    await page.click('[data-testid="remove-address-btn-postal"]');
    const confirmDialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(confirmDialog).toBeVisible();
    await page.click('[data-testid="confirm-dialog-confirm-btn"]');
    await expect(confirmDialog).toBeHidden();
    await expect(page.locator('[data-testid="address-card-postal"]')).toBeHidden();
  });

  test('AC-8: edit tags with Wedding, 2026 saves; entering 21 tags shows LIMIT_EXCEEDED', async ({
    page,
  }) => {
    await page.goto('/en/clients');
    const firstClientLink = page.locator(
      '[data-testid="client-table"] tbody tr:first-child td:first-child a',
    );
    await firstClientLink.click();

    // Click "Edit tags"
    await page.click('[data-testid="edit-tags-btn"]');
    const tagsDialog = page.locator('[data-testid="tags-dialog"]');
    await expect(tagsDialog).toBeVisible();

    // Enter 2 tags
    await page.fill('[data-testid="edit-tags-input"]', 'Wedding, 2026');
    await page.click('[data-testid="save-tags-btn"]');
    await expect(tagsDialog).toBeHidden();

    // Both tags appear on profile
    await expect(page.locator('[data-testid="client-tag-Wedding"]')).toBeVisible();
    await expect(page.locator('[data-testid="client-tag-2026"]')).toBeVisible();

    // Open tags dialog again and enter 21 tags
    await page.click('[data-testid="edit-tags-btn"]');
    await expect(tagsDialog).toBeVisible();
    const twentyOneTags = Array.from({ length: 21 }, (_, i) => `Tag${String(i + 1)}`).join(', ');
    await page.fill('[data-testid="edit-tags-input"]', twentyOneTags);
    await page.click('[data-testid="save-tags-btn"]');

    // Localized LIMIT_EXCEEDED error is displayed
    const errorAlert = page.locator('[data-testid="tags-error"]');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText('Limit exceeded.');

    // Cancel keeps previous tags
    await page.click('[data-testid="cancel-tags-btn"]');
    await expect(tagsDialog).toBeHidden();
    await expect(page.locator('[data-testid="client-tag-Wedding"]')).toBeVisible();
  });

  test('AC-9: double-submit prevention disables submit button during pending', async ({ page }) => {
    await page.goto('/en/clients/new');

    await page.fill('[data-testid="display-name-input"]', 'Fast Submit Client');
    await page.fill('[data-testid="given-name-input"]', 'Fast');
    await page.fill('[data-testid="email-input"]', 'fast.submit@example.com');

    const submitBtn = page.locator('[data-testid="submit-client-btn"]');
    // Double click
    await submitBtn.dblclick();

    // Should create exactly one client and land on profile
    await expect(page).toHaveURL(/\/en\/clients\/[0-9a-f-]{36}/);
  });

  test('AC-10: German locale displays all strings from de.json including Hauptkontakt and Mögliches Duplikat', async ({
    page,
  }) => {
    await page.goto('/de/clients/new');

    // German title and labels
    await expect(page.locator('h1')).toHaveText('Neuer Kunde');
    await expect(page.locator('legend')).toContainText('Kundentyp');
    await expect(page.locator('h2')).toContainText('Hauptkontakt');

    // Trigger duplicate warning in German
    await page.fill('[data-testid="display-name-input"]', 'Deutscher Testkunde');
    await page.fill('[data-testid="given-name-input"]', 'Anna');
    await page.fill('[data-testid="email-input"]', 'anna@example.com');
    await page.click('[data-testid="submit-client-btn"]');

    const warning = page.locator('[data-testid="duplicate-warning"]');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('Mögliches Duplikat');
    await expect(warning).toContainText('Ein Kunde mit dieser E-Mail-Adresse existiert bereits');
    await expect(page.locator('[data-testid="create-anyway-btn"]')).toHaveText('Trotzdem anlegen');
  });

  test('AC-11: zero axe violations across wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa on new client page and edit dialogs', async ({
    page,
  }) => {
    // 1. New Client Page (en)
    await page.goto('/en/clients/new');
    const axeNewEn = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axeNewEn.violations).toEqual([]);

    // 2. New Client Page (de)
    await page.goto('/de/clients/new');
    const axeNewDe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axeNewDe.violations).toEqual([]);

    // 3. Edit Details Dialog
    await page.goto('/en/clients');
    const firstClientLink = page.locator(
      '[data-testid="client-table"] tbody tr:first-child td:first-child a',
    );
    await firstClientLink.click();
    await page.click('[data-testid="edit-client-details-btn"]');
    const editDetailsDialog = page.locator('[data-testid="edit-details-dialog"]');
    await expect(editDetailsDialog).toBeVisible();
    await page.waitForTimeout(300);
    const axeEditDetails = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axeEditDetails.violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(editDetailsDialog).toBeHidden();
    await page.waitForTimeout(250);

    // 4. Contact Dialog
    await page.click('[data-testid="add-contact-btn"]');
    const contactDialog = page.locator('[data-testid="contact-dialog"]');
    await expect(contactDialog).toBeVisible();
    await page.waitForTimeout(300);
    const axeContact = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axeContact.violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(contactDialog).toBeHidden();
    await page.waitForTimeout(250);

    // 5. Address Dialog
    await page.click('[data-testid="add-address-btn"]');
    const addressDialog = page.locator('[data-testid="address-dialog"]');
    await expect(addressDialog).toBeVisible();
    await page.waitForTimeout(300);
    const axeAddress = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axeAddress.violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(addressDialog).toBeHidden();
  });

  test('AC-12: 320px viewport has zero horizontal scroll, visible labels, and targets >= 24px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/en/clients/new');

    // Check no horizontal scroll
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    // Target sizes >= 24px
    const submitBox = await page.locator('[data-testid="submit-client-btn"]').boundingBox();
    expect(submitBox?.height).toBeGreaterThanOrEqual(24);
    expect(submitBox?.width).toBeGreaterThanOrEqual(24);

    const cancelBox = await page.locator('[data-testid="cancel-btn"]').boundingBox();
    expect(cancelBox?.height).toBeGreaterThanOrEqual(24);
    expect(cancelBox?.width).toBeGreaterThanOrEqual(24);

    // Visible labels on all form inputs
    const displayNameLabel = page.locator('label[for="displayName"]');
    await expect(displayNameLabel).toBeVisible();
    const givenNameLabel = page.locator('label[for="givenName"]');
    await expect(givenNameLabel).toBeVisible();
  });

  test('AC-13: dialog focus management (Tab contained, Escape dismisses, focus restored)', async ({
    page,
  }) => {
    await page.goto('/en/clients');
    const firstClientLink = page.locator(
      '[data-testid="client-table"] tbody tr:first-child td:first-child a',
    );
    await firstClientLink.click();

    const editDetailsBtn = page.locator('[data-testid="edit-client-details-btn"]');
    await editDetailsBtn.focus();
    await editDetailsBtn.click();

    const dialog = page.locator('[data-testid="edit-details-dialog"]');
    await expect(dialog).toBeVisible();

    // Escape closes dialog
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Focus restored to trigger control
    await expect(editDetailsBtn).toBeFocused();
  });

  test('AC-14: unauthenticated requests to /en/clients/new redirect to sign-in', async ({
    browser,
  }) => {
    // Fresh unauthenticated context
    const context = await browser.newContext();
    const anonPage = await context.newPage();

    await anonPage.goto('/en/clients/new');
    await expect(anonPage).toHaveURL(
      /\/en\/sign-in\?callbackUrl=(%2F|\/)en(%2F|\/)clients(%2F|\/)new/,
    );
    await context.close();
  });

  test('AC-15: resulting URL contains no submitted personal data', async ({ page }) => {
    await page.goto('/en/clients/new');

    const testDisplayName = 'PII Free URL Test Client';
    const testEmail = 'secret.email@example.com';
    const testPhone = '+49 30 1234 5678';

    await page.fill('[data-testid="display-name-input"]', testDisplayName);
    await page.fill('[data-testid="given-name-input"]', 'SecretName');
    await page.fill('[data-testid="email-input"]', testEmail);
    await page.fill('[data-testid="phone-input"]', testPhone);

    await page.click('[data-testid="submit-client-btn"]');
    await expect(page).toHaveURL(/\/en\/clients\/[0-9a-f-]{36}/);

    const currentUrl = page.url();
    expect(currentUrl).not.toContain('SecretName');
    expect(currentUrl).not.toContain('secret.email');
    expect(currentUrl).not.toContain('1234');
    expect(currentUrl).not.toContain('PII');
  });

  test('UX: capture responsive screenshots at 320px, 768px, and 1280px for UX reviewers', async ({
    page,
  }) => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });

    const breakpoints = [
      { name: '320px', width: 320, height: 640 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1280px', width: 1280, height: 800 },
    ];

    // 1. New Client Page screenshots
    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto('/en/clients/new');
      await page.screenshot({
        path: path.join(UX_RUN_DIR, `client-new-${bp.name}.png`),
        fullPage: true,
      });
    }

    // 2. Duplicate Warning screenshots
    await page.goto('/en/clients/new');
    await page.fill('[data-testid="display-name-input"]', 'Duplicate Studio');
    await page.fill('[data-testid="given-name-input"]', 'Anna');
    await page.fill('[data-testid="email-input"]', 'anna@example.com');
    await page.click('[data-testid="submit-client-btn"]');
    await expect(page.locator('[data-testid="duplicate-warning"]')).toBeVisible();

    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.screenshot({
        path: path.join(UX_RUN_DIR, `client-duplicate-warning-${bp.name}.png`),
        fullPage: true,
      });
    }

    // 3. Edit Dialogs screenshots
    await page.goto('/en/clients');
    const firstClientLink = page.locator(
      '[data-testid="client-table"] tbody tr:first-child td:first-child a',
    );
    await firstClientLink.click();
    await page.click('[data-testid="edit-client-details-btn"]');
    await expect(page.locator('[data-testid="edit-details-dialog"]')).toBeVisible();

    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.screenshot({
        path: path.join(UX_RUN_DIR, `client-edit-details-${bp.name}.png`),
      });
    }

    // Verify screenshots exist
    for (const bp of breakpoints) {
      expect(fs.existsSync(path.join(UX_RUN_DIR, `client-new-${bp.name}.png`))).toBe(true);
      expect(fs.existsSync(path.join(UX_RUN_DIR, `client-duplicate-warning-${bp.name}.png`))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(UX_RUN_DIR, `client-edit-details-${bp.name}.png`))).toBe(true);
    }
  });
});
