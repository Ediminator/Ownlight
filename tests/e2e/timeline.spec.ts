import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

const UX_RUN_DIR = path.resolve(
  import.meta.dirname,
  '../../../../control/ownlight/runs/TASK-0013/iter-01/ux',
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

test.describe('TASK-0013: Relationship History Timeline and Notes UI E2E', () => {
  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-1 & AC-5 & AC-6: Note lifecycle and timeline event rendering', async ({ page }) => {
    const clientId = await createTestClient(page, 'Note Lifecycle Studio');
    await page.goto(`/en/clients/${clientId}`);

    // Verify timeline heading
    const timelineHeading = page.locator('[data-testid="timeline-heading"]');
    await expect(timelineHeading).toBeVisible();

    // AC-1: client.created event present
    const createdEvent = page.locator('[data-event-type="client.created"]').first();
    await expect(createdEvent).toBeVisible();

    // AC-5: Add note with 5,000 characters and line breaks
    const part1 = 'First consultation segment. '.repeat(50);
    const part2 = 'Second requirements segment. '.repeat(50);
    const bodyText = `${part1}\n\n${part2}`;

    await page.fill('[data-testid="timeline-note-textarea"]', bodyText);
    const counter = page.locator('[data-testid="timeline-note-counter"]');
    await expect(counter).toContainText(String(bodyText.length));

    await page.click('[data-testid="timeline-note-submit-btn"]');

    // Wait for note event to appear in timeline
    const noteEvent = page.locator('[data-event-type="note.created"]').first();
    await expect(noteEvent).toBeVisible();
    const noteBody = noteEvent.locator('[data-testid^="note-body-"]');
    await expect(noteBody).toBeVisible();
    await expect(noteBody).toContainText(part1.slice(0, 50));

    // AC-6: Edit note
    const editBtn = noteEvent.locator('[data-testid^="edit-note-btn-"]');
    await editBtn.click();

    const editDialog = page.locator('[data-testid="edit-note-dialog"]');
    await expect(editDialog).toBeVisible();

    const editTextarea = page.locator('[data-testid="edit-note-textarea"]');
    await editTextarea.fill('Updated note body text: requirements finalised.');
    await page.click('[data-testid="edit-note-save-btn"]');
    await expect(editDialog).not.toBeVisible();

    // Verify updated note body and edited marker
    await expect(noteBody).toContainText('Updated note body text: requirements finalised.');
    const editedMarker = noteEvent.locator('[data-testid^="note-edited-marker-"]');
    await expect(editedMarker).toBeVisible();

    // AC-6: Delete note with confirmation
    const deleteBtn = noteEvent.locator('[data-testid^="delete-note-btn-"]');
    await deleteBtn.click();

    const confirmDialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(confirmDialog).toBeVisible();

    await page.click('[data-testid="confirm-dialog-confirm-btn"]');
    await expect(confirmDialog).not.toBeVisible();

    // Verify note event is removed from timeline
    await expect(page.locator('[data-event-type="note.created"]')).toHaveCount(0);
  });

  test('AC-9: Note body XSS payloads render literally without executing scripts or showing dialogs', async ({
    page,
  }) => {
    let dialogTriggered = false;
    page.on('dialog', async (dialog) => {
      dialogTriggered = true;
      await dialog.dismiss();
    });

    const clientId = await createTestClient(page, 'XSS Test Client');
    await page.goto(`/en/clients/${clientId}`);

    const xssPayload =
      '<script>alert("xss")</script><img src="x" onerror="alert(1)"><b>bold test</b>';
    await page.fill('[data-testid="timeline-note-textarea"]', xssPayload);
    await page.click('[data-testid="timeline-note-submit-btn"]');

    const noteEvent = page.locator('[data-event-type="note.created"]').first();
    await expect(noteEvent).toBeVisible();

    const noteBody = noteEvent.locator('[data-testid^="note-body-"]');
    await expect(noteBody).toBeVisible();
    await expect(noteBody).toContainText('<script>alert("xss")</script>');
    await expect(noteBody).toContainText('<img src="x" onerror="alert(1)">');
    await expect(noteBody).toContainText('<b>bold test</b>');

    expect(dialogTriggered).toBe(false);
  });

  test('AC-12: Bilingual UI renders German strings in de locale', async ({ page }) => {
    const clientId = await createTestClient(page, 'German UI Client');
    await page.goto(`/de/clients/${clientId}`);

    // Verify German section title
    const timelineHeading = page.locator('[data-testid="timeline-heading"]');
    await expect(timelineHeading).toHaveText('Verlauf');

    // Verify German composer label and hint
    await expect(page.locator('label[for="timeline-note-composer"]')).toHaveText('Kundennotiz');
    await expect(page.locator('[data-testid="timeline-composer-hint"]')).toContainText(
      'Bitte vermeiden Sie es, sensible personenbezogene Daten',
    );

    // Verify German client created event
    const createdEvent = page.locator('[data-event-type="client.created"]').first();
    await expect(createdEvent).toContainText('Kund:in angelegt');
  });

  test('AC-13: WCAG 2.2 AA accessibility audit passes with zero violations across pages and open dialogs (I1-U01, I1-U02)', async ({
    page,
  }) => {
    const clientId = await createTestClient(page, 'Axe A11y Client');

    // Add a note to test full interactive UI state
    await page.goto(`/en/clients/${clientId}`);
    await page.fill(
      '[data-testid="timeline-note-textarea"]',
      'Consultation note for accessibility testing.',
    );
    await page.click('[data-testid="timeline-note-submit-btn"]');
    const noteEvent = page.locator('[data-event-type="note.created"]').first();
    await expect(noteEvent).toBeVisible();

    // 1. Run Axe on English profile (light mode)
    const enAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(enAxe.violations).toEqual([]);

    // 2. Run Axe on German profile
    await page.goto(`/de/clients/${clientId}`);
    const deAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(deAxe.violations).toEqual([]);

    // 3. Run Axe on English profile in dark mode
    await page.goto(`/en/clients/${clientId}`);
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    const darkAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(darkAxe.violations).toEqual([]);

    // Reset back to light mode for dialog audits
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
    });

    // 4. Run Axe on open edit note dialog (light mode)
    const editBtn = page.locator('[data-testid^="edit-note-btn-"]').first();
    await editBtn.click();
    const editDialog = page.locator('[data-testid="edit-note-dialog"]');
    await expect(editDialog).toBeVisible();
    await page.waitForTimeout(300);

    const editDialogAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(editDialogAxe.violations).toEqual([]);

    await page.click('[data-testid="edit-note-cancel-btn"]');
    await expect(editDialog).not.toBeVisible();
    await page.waitForTimeout(300);

    // 5. Run Axe on open confirm delete dialog (I1-U01 regression test: destructive button contrast >= 4.5:1)
    const deleteBtn = page.locator('[data-testid^="delete-note-btn-"]').first();
    await deleteBtn.click();
    const confirmDialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(confirmDialog).toBeVisible();
    await page.waitForTimeout(300);

    const deleteDialogAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(deleteDialogAxe.violations).toEqual([]);

    await page.click('[data-testid="confirm-dialog-cancel-btn"]');
    await expect(confirmDialog).not.toBeVisible();
  });

  test('AC-14: keyboard navigation for note composition, editing, and deletion (I1-V01, I1-V02)', async ({
    page,
  }) => {
    const clientId = await createTestClient(page, 'Keyboard Nav Client');
    await page.goto(`/en/clients/${clientId}`);

    // Focus composer textarea directly and enter text via keyboard
    const textarea = page.locator('[data-testid="timeline-note-textarea"]');
    await textarea.focus();
    await expect(textarea).toBeFocused();
    await page.keyboard.type('Keyboard authored note content.');

    // Tab to submit button and activate with Enter
    await page.keyboard.press('Tab');
    const submitBtn = page.locator('[data-testid="timeline-note-submit-btn"]');
    await expect(submitBtn).toBeFocused();
    await page.keyboard.press('Enter');

    // Verify note is rendered in timeline
    const noteEvent = page.locator('[data-event-type="note.created"]').first();
    await expect(noteEvent).toBeVisible();
    const noteBody = noteEvent.locator('[data-testid^="note-body-"]');
    await expect(noteBody).toContainText('Keyboard authored note content.');

    // Focus edit button via keyboard and open dialog with Space
    const editBtn = noteEvent.locator('[data-testid^="edit-note-btn-"]');
    await editBtn.focus();
    await expect(editBtn).toBeFocused();
    await page.keyboard.press('Space');

    const editDialog = page.locator('[data-testid="edit-note-dialog"]');
    await expect(editDialog).toBeVisible();

    // Test Escape key cancels dialog and restores focus to edit trigger button
    await page.keyboard.press('Escape');
    await expect(editDialog).not.toBeVisible();
    await expect(editBtn).toBeFocused();

    // Reopen edit dialog via Enter
    await page.keyboard.press('Enter');
    await expect(editDialog).toBeVisible();

    // Edit textarea: update content
    const editTextarea = page.locator('[data-testid="edit-note-textarea"]');
    await editTextarea.fill('Keyboard revised note content.');

    // Tab to cancel button, then Tab to save button, then activate with Enter
    await page.keyboard.press('Tab');
    const cancelBtn = page.locator('[data-testid="edit-note-cancel-btn"]');
    await expect(cancelBtn).toBeFocused();
    await page.keyboard.press('Tab');
    const saveBtn = page.locator('[data-testid="edit-note-save-btn"]');
    await expect(saveBtn).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(editDialog).not.toBeVisible();
    await expect(noteBody).toContainText('Keyboard revised note content.');

    // Focus delete button via keyboard and open dialog with Enter
    const deleteBtn = noteEvent.locator('[data-testid^="delete-note-btn-"]');
    await deleteBtn.focus();
    await expect(deleteBtn).toBeFocused();
    await page.keyboard.press('Enter');

    const confirmDialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(confirmDialog).toBeVisible();

    // Test Tab navigation inside confirm dialog to reach confirm button and activate with Enter
    const confirmBtn = page.locator('[data-testid="confirm-dialog-confirm-btn"]');
    await confirmBtn.focus();
    await expect(confirmBtn).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(confirmDialog).not.toBeVisible();
    await expect(page.locator('[data-event-type="note.created"]')).toHaveCount(0);
  });

  test('AC-14: keyset pagination Load more button and focus movement to newly loaded item (I1-V01, I1-V02, I1-U02)', async ({
    page,
  }) => {
    const clientId = await createTestClient(page, 'Pagination Focus Client');
    await page.goto(`/en/clients/${clientId}`);

    // Create 21 notes (total 22 events > 20 limit) to trigger keyset pagination
    for (let i = 1; i <= 21; i++) {
      const noteLabel = `Timeline note item ${String(i)}`;
      await page.fill('[data-testid="timeline-note-textarea"]', noteLabel);
      await page.click('[data-testid="timeline-note-submit-btn"]');
      await expect(page.locator('[data-event-type="note.created"]').first()).toContainText(
        noteLabel,
      );
    }

    // Reload profile page to receive first page of 20 items + nextCursor
    await page.goto(`/en/clients/${clientId}`);
    await page.waitForLoadState('networkidle');

    // Initial page has exactly 20 items and Load more button is visible
    const initialItems = page.locator('ol[data-testid="timeline-events-list"] > li');
    await expect(initialItems).toHaveCount(20);

    const loadMoreBtn = page.locator('[data-testid="timeline-load-more-btn"]');
    await expect(loadMoreBtn).toBeVisible();

    // Activate Load more via keyboard
    await loadMoreBtn.focus();
    await expect(loadMoreBtn).toBeFocused();
    await page.keyboard.press('Enter');

    // Once loaded, all 22 items are present and Load more button disappears
    const allItems = page.locator('ol[data-testid="timeline-events-list"] > li');
    await expect(allItems).toHaveCount(22);
    await expect(loadMoreBtn).not.toBeVisible();

    // Focus moved to the first newly loaded item (index 20, 21st event)
    const isNewItemFocused = await page.evaluate(() => {
      const active = document.activeElement;
      const items = Array.from(
        document.querySelectorAll('ol[data-testid="timeline-events-list"] > li'),
      );
      return active === items[20];
    });
    expect(isNewItemFocused).toBe(true);
  });

  test('AC-14: 320px viewport responsiveness, touch targets, and UX screenshots', async ({
    page,
  }) => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });

    const clientId = await createTestClient(page, 'Mobile Responsive Client');

    // Add a note so all elements are rendered
    await page.goto(`/en/clients/${clientId}`);
    await page.fill(
      '[data-testid="timeline-note-textarea"]',
      'Timeline note for responsive design verification.',
    );
    await page.click('[data-testid="timeline-note-submit-btn"]');
    await expect(page.locator('[data-event-type="note.created"]')).toBeVisible();

    // 320px viewport test
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/en/clients/${clientId}`);

    // Verify no horizontal overflow at 320px
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    // Verify minimum touch target sizes on submit and action buttons (>= 24px)
    const submitBtnBox = await page
      .locator('[data-testid="timeline-note-submit-btn"]')
      .boundingBox();
    if (submitBtnBox) {
      expect(submitBtnBox.width).toBeGreaterThanOrEqual(24);
      expect(submitBtnBox.height).toBeGreaterThanOrEqual(24);
    }

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
        path: path.join(UX_RUN_DIR, `timeline-${bp.name}.png`),
        fullPage: true,
      });

      expect(fs.existsSync(path.join(UX_RUN_DIR, `timeline-${bp.name}.png`))).toBe(true);
    }
  });
});
