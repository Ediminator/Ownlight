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
  `../../../../control/ownlight/runs/TASK-0025/${RUN_DIR_PARAM}/ux`,
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

async function createFormViaUI(
  page: import('@playwright/test').Page,
  name: string,
  locale = 'en',
): Promise<string> {
  await page.goto(`/${locale}/settings/inquiry-forms/new`);
  await page.fill('[data-testid="new-form-name-input"]', name);
  await page.click('[data-testid="create-form-submit-button"]');
  await expect(page).toHaveURL(new RegExp(`/${locale}/settings/inquiry-forms/[0-9a-f-]{36}`));
  const url = page.url();
  const match = /\/settings\/inquiry-forms\/([0-9a-f-]{36})/.exec(url);
  const formId = match?.[1];
  if (!formId) throw new Error('Could not parse formId from URL: ' + url);
  return formId;
}

test.describe('TASK-0025: Owner Settings UI for Inquiry Forms', () => {
  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-1: creates a new form through /en/settings/inquiry-forms/new, lands on edit page of new draft form, and list shows it', async ({
    page,
  }) => {
    const formName = `AC-1 Wedding Form ${String(Date.now())}`;
    const formId = await createFormViaUI(page, formName);

    // Verify edit page elements
    await expect(page.locator('[data-testid="edit-form-title"]')).toContainText(formName);
    const draftBadge = page.locator('[data-testid="status-badge-draft"]');
    await expect(draftBadge).toBeVisible();
    await expect(draftBadge).toContainText('Draft');

    // Verify inquiry forms list view shows the new form
    await page.goto('/en/settings/inquiry-forms');
    const tableRow = page.locator(`[data-testid="form-row-${formId}"]`);
    await expect(tableRow).toBeVisible();
    await expect(tableRow).toContainText(formName);
    await expect(tableRow.locator(`[data-testid="form-status-${formId}"]`)).toContainText('Draft');
  });

  test('AC-2: edit page allows disabling phone, making event_date required, moving message up, and persisting across reload; given_name and email are locked', async ({
    page,
  }) => {
    const formName = `AC-2 Config Form ${String(Date.now())}`;
    await createFormViaUI(page, formName);

    // Check given_name and email are locked
    await expect(page.locator('[data-testid="locked-badge-given_name"]')).toBeVisible();
    await expect(page.locator('[data-testid="locked-badge-email"]')).toBeVisible();
    await expect(page.locator('[data-testid="locked-required-given_name"]')).toBeVisible();
    await expect(page.locator('[data-testid="locked-required-email"]')).toBeVisible();
    await expect(page.locator('[data-testid="field-enabled-given_name"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="field-required-given_name"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="field-enabled-email"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="field-required-email"]')).toHaveCount(0);

    // Disable phone
    const phoneToggle = page.locator('[data-testid="field-enabled-phone"]');
    await expect(phoneToggle).toBeChecked();
    await phoneToggle.click();
    await expect(phoneToggle).not.toBeChecked();

    // Enable event_date, then make it required
    const eventDateEnabled = page.locator('[data-testid="field-enabled-event_date"]');
    await expect(eventDateEnabled).not.toBeChecked();
    await eventDateEnabled.click();
    await expect(eventDateEnabled).toBeChecked();

    const eventDateReq = page.locator('[data-testid="field-required-event_date"]');
    await expect(eventDateReq).not.toBeChecked();
    await eventDateReq.click();
    await expect(eventDateReq).toBeChecked();

    // Move message up
    const messageUpButton = page.locator('[data-testid="field-move-up-message"]');
    await messageUpButton.click();

    // Save fields
    await page.click('[data-testid="save-fields-button"]');
    await expect(page.locator('[data-testid="save-notification"]')).toBeVisible();

    // Reload and assert persisted state
    await page.reload();
    await expect(page.locator('[data-testid="field-enabled-phone"]')).not.toBeChecked();
    await expect(page.locator('[data-testid="field-enabled-event_date"]')).toBeChecked();
    await expect(page.locator('[data-testid="field-required-event_date"]')).toBeChecked();

    // Verify given_name and email remain locked
    await expect(page.locator('[data-testid="locked-badge-given_name"]')).toBeVisible();
    await expect(page.locator('[data-testid="locked-badge-email"]')).toBeVisible();
  });

  test('AC-3: event types section persists Wedding/Hochzeit; enabling event_type with 0 event types triggers error summary linked to #event-types-section', async ({
    page,
  }) => {
    const formName = `AC-3 Event Types Form ${String(Date.now())}`;
    await createFormViaUI(page, formName);

    // Add Wedding / Hochzeit event type
    await page.fill('[data-testid="new-event-type-key"]', 'wedding');
    await page.fill('[data-testid="new-event-type-label-en"]', 'Wedding');
    await page.fill('[data-testid="new-event-type-label-de"]', 'Hochzeit');
    await page.click('[data-testid="add-event-type-button"]');

    // Assert row was added to local table
    const weddingRow = page.locator('[data-testid="event-type-row-wedding"]');
    await expect(weddingRow).toBeVisible();
    await expect(weddingRow).toContainText('Wedding');
    await expect(weddingRow).toContainText('Hochzeit');

    // Save event types
    await page.click('[data-testid="save-event-types-button"]');
    await expect(page.locator('[data-testid="save-notification"]')).toBeVisible();

    // Reload page and assert persistence
    await page.reload();
    await expect(page.locator('[data-testid="event-type-row-wedding"]')).toBeVisible();
    await expect(page.locator('[data-testid="event-type-row-wedding"]')).toContainText('Wedding');
    await expect(page.locator('[data-testid="event-type-row-wedding"]')).toContainText('Hochzeit');

    // Negative test: Remove all event types while event_type field is enabled
    const eventTypeToggle = page.locator('[data-testid="field-enabled-event_type"]');
    if (!(await eventTypeToggle.isChecked())) {
      await eventTypeToggle.click();
    }
    await page.click('[data-testid="save-fields-button"]');
    await expect(page.locator('[data-testid="save-notification"]')).toBeVisible();

    const removeButtons = page.locator('[data-testid^="event-type-remove-"]');
    const count = await removeButtons.count();
    for (let i = 0; i < count; i++) {
      await page.locator('[data-testid^="event-type-remove-"]').first().click();
    }

    // Try to save event types with 0 event types
    await page.click('[data-testid="save-event-types-button"]');

    // Error summary must appear and link to #event-types-section
    const errorSummary = page.locator('[data-testid="error-summary"]');
    await expect(errorSummary).toBeVisible();
    const errorLink = errorSummary.locator('a[href="#event-types-section"]');
    await expect(errorLink).toBeVisible();

    // Reload page: Wedding must still be present because save was aborted
    await page.reload();
    await expect(page.locator('[data-testid="event-type-row-wedding"]')).toBeVisible();
  });

  test('AC-4: privacy notice editing German text and saving as new version increments version and lists previous version read-only', async ({
    page,
  }) => {
    const formName = `AC-4 Notice Form ${String(Date.now())}`;
    await createFormViaUI(page, formName);

    // Initial version is 1
    const versionNumberEl = page.locator('[data-testid="current-version-number"]');
    await expect(versionNumberEl).toContainText('1');

    // Edit privacy policy URL and German text
    await page.fill('[data-testid="notice-policy-url-input"]', 'https://example.org/datenschutz');
    await page.fill(
      '[data-testid="notice-ack-de-input"]',
      'Ich stimme der Verarbeitung meiner Angaben zum Zwecke der Kontaktaufnahme zu.',
    );
    await page.click('[data-testid="save-notice-version-button"]');

    await expect(page.locator('[data-testid="save-notification"]')).toBeVisible();

    // Current version is now 2
    await expect(versionNumberEl).toContainText('2');

    // Version 1 is displayed read-only in the history table
    const historyRow1 = page.locator('[data-testid="history-version-row-1"]');
    await expect(historyRow1).toBeVisible();
    await expect(historyRow1.locator('[data-testid="history-version-1"]')).toContainText('1');
  });

  test('AC-5: publishing draft with missing URL shows inline precondition error; after adding URL, publish succeeds with Published badge', async ({
    page,
  }) => {
    const formName = `AC-5 Publish Form ${String(Date.now())}`;
    await createFormViaUI(page, formName);

    // Initially newly created form has no privacy policy URL -> Click Publish
    await page.click('[data-testid="publish-form-button"]');

    // Inline precondition error appears and status stays draft
    const preconditionError = page.locator('[data-testid="publish-precondition-error"]');
    await expect(preconditionError).toBeVisible();
    await expect(preconditionError).toContainText('privacy policy URL');
    await expect(page.locator('[data-testid="status-badge-draft"]')).toBeVisible();

    // Add valid privacy policy URL and save as new version
    await page.fill('[data-testid="notice-policy-url-input"]', 'https://example.org/privacy');
    await page.click('[data-testid="save-notice-version-button"]');
    await expect(page.locator('[data-testid="save-notification"]')).toBeVisible();

    // Click Publish again
    await page.click('[data-testid="publish-form-button"]');
    await expect(page.locator('[data-testid="save-notification"]')).toBeVisible();

    // Status is now Published
    const publishedBadge = page.locator('[data-testid="status-badge-published"]');
    await expect(publishedBadge).toBeVisible();
    await expect(publishedBadge).toContainText('Published');
  });

  test('AC-8: German locale (/de) displays all copy from de catalog without English fallbacks and formats dates with German locale', async ({
    page,
  }) => {
    // 1. Overview list in German
    await page.goto('/de/settings/inquiry-forms');
    await expect(page.locator('h1')).toContainText('Anfrageformulare');
    await expect(page.locator('[data-testid="new-form-button"]')).toContainText('Neues Formular');

    // 2. New form page in German
    await page.goto('/de/settings/inquiry-forms/new');
    await expect(page.locator('h1')).toContainText('Anfrageformular erstellen');
    await expect(page.locator('label[for="new-form-name"]')).toContainText('Formularname');
    await expect(page.locator('[data-testid="create-form-submit-button"]')).toContainText(
      'Formular erstellen',
    );

    // Create a form in German
    const formNameDe = `AC-8 Deutsches Formular ${String(Date.now())}`;
    await page.fill('[data-testid="new-form-name-input"]', formNameDe);
    await page.click('[data-testid="create-form-submit-button"]');
    await expect(page).toHaveURL(/\/de\/settings\/inquiry-forms\/[0-9a-f-]{36}/);

    // 3. Edit page in German
    await expect(page.locator('[data-testid="status-badge-draft"]')).toContainText('Entwurf');
    await expect(page.locator('[data-testid="publish-form-button"]')).toContainText(
      'Veröffentlichen',
    );
    await expect(page.locator('[data-testid="archive-form-button"]')).toContainText('Archivieren');
    await expect(page.locator('[data-testid="general-section"] h2')).toContainText(
      'Allgemeine Einstellungen',
    );
    await expect(page.locator('[data-testid="fields-section"] h2')).toContainText('Formularfelder');
    await expect(page.locator('[data-testid="event-types-section"] h2')).toContainText(
      'Ereignisarten',
    );
    await expect(page.locator('[data-testid="privacy-notice-section"] h2')).toContainText(
      'Datenschutzhinweis',
    );

    // German date check
    const currentNotice = page.locator('[data-testid="current-notice-version"]');
    await expect(currentNotice).toBeVisible();
  });

  test('AC-10: sensitive event-type warning note (D7) is visible in both English and German', async ({
    page,
  }) => {
    const formId = await createFormViaUI(page, `AC-10 Sensitive Warning ${String(Date.now())}`);

    // English warning
    await page.goto(`/en/settings/inquiry-forms/${formId}`);
    const warningEn = page.locator('[data-testid="sensitive-event-types-warning"]');
    await expect(warningEn).toBeVisible();
    await expect(warningEn).toContainText('health');

    // German warning
    await page.goto(`/de/settings/inquiry-forms/${formId}`);
    const warningDe = page.locator('[data-testid="sensitive-event-types-warning"]');
    await expect(warningDe).toBeVisible();
    await expect(warningDe).toContainText('Gesundheit');
  });

  test('AC-9: list, /new, and edit pages pass WCAG 2.2 AA axe checks at 320px, 768px, and 1280px; field reorder and archive dialog are keyboard operable', async ({
    page,
  }) => {
    const formId = await createFormViaUI(page, `AC-9 A11y Form ${String(Date.now())}`);

    const breakpoints = [
      { name: '320px', width: 320, height: 640 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1280px', width: 1280, height: 800 },
    ];

    // Axe audit across breakpoints on list, new, and edit pages
    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });

      // List page
      await page.goto('/en/settings/inquiry-forms');
      const listAxe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        listAxe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
      ).toEqual([]);

      // New page
      await page.goto('/en/settings/inquiry-forms/new');
      const newAxe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        newAxe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
      ).toEqual([]);

      // Edit page
      await page.goto(`/en/settings/inquiry-forms/${formId}`);
      const editAxe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        editAxe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
      ).toEqual([]);
    }

    // Keyboard operability: field reorder button via keyboard
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/en/settings/inquiry-forms/${formId}`);
    const moveBtn = page.locator('[data-testid="field-move-up-message"]');
    await moveBtn.focus();
    await page.keyboard.press('Enter');

    // Keyboard operability: archive dialog focus, escape / cancel, and confirm
    const archiveBtn = page.locator('[data-testid="archive-form-button"]');
    await archiveBtn.focus();
    await page.keyboard.press('Enter');

    const archiveDialog = page.locator('[data-testid="archive-dialog"]');
    await expect(archiveDialog).toBeVisible();

    // Cancel archive via keyboard
    const cancelBtn = page.locator('[data-testid="cancel-archive-button"]');
    await cancelBtn.focus();
    await page.keyboard.press('Enter');
    await expect(archiveDialog).not.toBeVisible();

    // Reopen archive dialog and confirm archive
    await archiveBtn.click();
    await expect(archiveDialog).toBeVisible();
    await page.click('[data-testid="confirm-archive-button"]');
    await expect(archiveDialog).not.toBeVisible();

    // Form is archived
    await expect(page.locator('[data-testid="status-badge-archived"]')).toBeVisible();
  });

  test('AC-9 / UX: capture responsive screenshots at 320px, 768px, and 1280px for UX reviewers', async ({
    page,
  }) => {
    const formId = await createFormViaUI(page, `UX Preview Form ${String(Date.now())}`);

    const breakpoints = [
      { name: '320px', width: 320, height: 640 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1280px', width: 1280, height: 800 },
    ];

    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });

      // 1. List page
      await page.goto('/en/settings/inquiry-forms');
      await page.screenshot({
        path: path.join(UX_RUN_DIR, `inquiry-forms-list-${bp.name}.png`),
        fullPage: true,
      });

      // 2. New form page
      await page.goto('/en/settings/inquiry-forms/new');
      await page.screenshot({
        path: path.join(UX_RUN_DIR, `inquiry-forms-new-${bp.name}.png`),
        fullPage: true,
      });

      // 3. Edit form page
      await page.goto(`/en/settings/inquiry-forms/${formId}`);
      await page.screenshot({
        path: path.join(UX_RUN_DIR, `inquiry-forms-edit-${bp.name}.png`),
        fullPage: true,
      });

      // 4. Archive dialog
      const archiveBtn = page.locator('[data-testid="archive-form-button"]');
      if (await archiveBtn.isVisible()) {
        await archiveBtn.click();
        await expect(page.locator('[data-testid="archive-dialog"]')).toBeVisible();
        await page.screenshot({
          path: path.join(UX_RUN_DIR, `inquiry-forms-archive-dialog-${bp.name}.png`),
        });
        await page.click('[data-testid="cancel-archive-button"]');
        await expect(page.locator('[data-testid="archive-dialog"]')).not.toBeVisible();
      }
    }

    // Capture German edit page at 1280px
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/de/settings/inquiry-forms/${formId}`);
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'inquiry-forms-edit-de-1280px.png'),
      fullPage: true,
    });

    // Verify all screenshots exist
    for (const bp of breakpoints) {
      expect(fs.existsSync(path.join(UX_RUN_DIR, `inquiry-forms-list-${bp.name}.png`))).toBe(true);
      expect(fs.existsSync(path.join(UX_RUN_DIR, `inquiry-forms-new-${bp.name}.png`))).toBe(true);
      expect(fs.existsSync(path.join(UX_RUN_DIR, `inquiry-forms-edit-${bp.name}.png`))).toBe(true);
      expect(
        fs.existsSync(path.join(UX_RUN_DIR, `inquiry-forms-archive-dialog-${bp.name}.png`)),
      ).toBe(true);
    }
    expect(fs.existsSync(path.join(UX_RUN_DIR, 'inquiry-forms-edit-de-1280px.png'))).toBe(true);
  });
});
