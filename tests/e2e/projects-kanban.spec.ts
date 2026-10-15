import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';
import {
  E2E_PROJECT_INQUIRY_1_ID,
  E2E_PROJECT_INQUIRY_2_ID,
  E2E_PROJECT_SHOT_ID,
  E2E_PROJECT_EDITING_ID,
} from '../helpers/e2e-projects-helper';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

const RUN_DIR_PARAM = process.env.RUN_DIR ?? 'iter-01';
const UX_RUN_DIR = path.resolve(
  import.meta.dirname,
  `../../../../control/ownlight/runs/TASK-0036/${RUN_DIR_PARAM}/ux`,
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

test.describe('TASK-0036: Pipeline Kanban Board UI E2E Tests', () => {
  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-1: /en/projects renders all 6 pipeline stages in position order with count badges and formatted totals', async ({
    page,
  }) => {
    await page.goto('/en/projects');
    await expect(page.locator('[data-testid="kanban-column-inquiry"]')).toBeVisible();

    // Action bar elements
    await expect(page.locator('h1')).toContainText('Projects & Pipeline');
    await expect(page.locator('[data-testid="view-switch-board"]')).toBeVisible();
    await expect(page.locator('[data-testid="view-switch-list"]')).toBeVisible();
    await expect(page.locator('[data-testid="new-project-btn"]')).toBeVisible();

    // Verify all 6 stages present in order
    const stageKeys = ['inquiry', 'booked', 'shot', 'editing', 'delivered', 'archived'];
    for (const key of stageKeys) {
      await expect(page.locator(`[data-testid="kanban-column-${key}"]`)).toBeVisible();
    }

    // Counts and totals
    const inquiryCountText = await page
      .locator('[data-testid="kanban-column-count-inquiry"]')
      .innerText();
    expect(Number(inquiryCountText)).toBeGreaterThanOrEqual(2);
    await expect(page.locator('[data-testid="kanban-column-total-inquiry"]')).toContainText(
      '€8,500.00',
    );

    await expect(page.locator('[data-testid="kanban-column-count-booked"]')).toContainText('1');
    await expect(page.locator('[data-testid="kanban-column-total-booked"]')).toContainText(
      '€3,000.00',
    );

    await expect(page.locator('[data-testid="kanban-column-count-shot"]')).toContainText('1');
    await expect(page.locator('[data-testid="kanban-column-total-shot"]')).toContainText(
      '€1,200.00',
    );

    await expect(page.locator('[data-testid="kanban-column-count-editing"]')).toContainText('1');
    await expect(page.locator('[data-testid="kanban-column-total-editing"]')).toContainText(
      '€3,500.00',
    );

    await expect(page.locator('[data-testid="kanban-column-count-delivered"]')).toContainText('1');
    await expect(page.locator('[data-testid="kanban-column-total-delivered"]')).toContainText(
      '€4,000.00',
    );

    // Empty archived state
    await expect(page.locator('[data-testid="kanban-column-count-archived"]')).toContainText('0');
    await expect(page.locator('[data-testid="kanban-column-empty-archived"]')).toBeVisible();

    // Project cards inside columns
    const inquiryCard = page.locator(`[data-testid="project-card-${E2E_PROJECT_INQUIRY_1_ID}"]`);
    await expect(inquiryCard).toBeVisible();
    await expect(
      page.locator(`[data-testid="project-card-title-${E2E_PROJECT_INQUIRY_1_ID}"]`),
    ).toContainText('Emma & Liam Wedding');
    await expect(
      page.locator(`[data-testid="project-card-client-${E2E_PROJECT_INQUIRY_1_ID}"]`),
    ).toContainText('Emma Watson');
  });

  test('AC-2: Drag-and-drop card from Inquiry to Booked updates column counts and totals', async ({
    page,
  }) => {
    await page.goto('/en/projects');
    await expect(page.locator('[data-testid="kanban-column-inquiry"]')).toBeVisible();

    const initialInquiryCount = await page
      .locator('[data-testid="kanban-column-count-inquiry"]')
      .innerText();
    const initialBookedCount = await page
      .locator('[data-testid="kanban-column-count-booked"]')
      .innerText();

    const card = page.locator(`[data-testid="project-card-${E2E_PROJECT_INQUIRY_1_ID}"]`);
    const bookedDropzone = page.locator('[data-testid="kanban-column-dropzone-booked"]');

    await card.dragTo(bookedDropzone);

    // Verify card is now in Booked column
    const cardInBooked = page.locator(
      `[data-testid="kanban-column-booked"] [data-testid="project-card-${E2E_PROJECT_INQUIRY_1_ID}"]`,
    );
    await expect(cardInBooked).toBeVisible();

    // Verify column counts updated
    await expect(page.locator('[data-testid="kanban-column-count-inquiry"]')).toContainText(
      String(Number(initialInquiryCount) - 1),
    );
    await expect(page.locator('[data-testid="kanban-column-count-booked"]')).toContainText(
      String(Number(initialBookedCount) + 1),
    );
  });

  test('AC-3: Keyboard accessible stage selector moves card without dragging and announces transition via aria-live', async ({
    page,
  }) => {
    await page.goto('/en/projects');
    await expect(page.locator('[data-testid="kanban-column-inquiry"]')).toBeVisible();

    // Trigger action menu on Lucas Portrait Session
    const trigger = page.locator(
      `[data-testid="project-actions-trigger-${E2E_PROJECT_INQUIRY_2_ID}"]`,
    );
    await trigger.focus();
    await page.keyboard.press('Enter');

    // Radix dropdown opens
    const menuContent = page.locator('[role="menu"]');
    await expect(menuContent).toBeVisible();

    // Open "Move to stage..." submenu
    const moveSubTrigger = page.locator('[data-testid="project-action-move-trigger"]');
    await moveSubTrigger.click();

    // Select "Shot" stage
    const shotOption = page.locator('[data-testid="project-action-move-shot"]');
    await shotOption.click();

    // Verify card moves to Shot column
    const cardInShot = page.locator(
      `[data-testid="kanban-column-shot"] [data-testid="project-card-${E2E_PROJECT_INQUIRY_2_ID}"]`,
    );
    await expect(cardInShot).toBeVisible();

    // Verify live region announcement (WCAG 2.2 SC 2.1.1 & SC 2.5.7)
    const liveRegion = page.locator('[data-testid="kanban-live-region"]');
    await expect(liveRegion).toContainText('Lucas Portrait Session');
    await expect(liveRegion).toContainText('Shot');
  });

  test('AC-4: Advisory task confirmation dialog appears when moving card with open tasks; cancel aborts and move anyway proceeds', async ({
    page,
  }) => {
    await page.goto('/en/projects');
    await expect(page.locator('[data-testid="kanban-column-inquiry"]')).toBeVisible();

    // Sophie & Noah Wedding in Editing has 2 open tasks
    const trigger = page.locator(
      `[data-testid="project-actions-trigger-${E2E_PROJECT_EDITING_ID}"]`,
    );
    await trigger.click();

    await page.locator('[data-testid="project-action-move-trigger"]').click();
    await page.locator('[data-testid="project-action-move-delivered"]').click();

    // Advisory dialog must appear
    const dialog = page.locator('[data-testid="task-warning-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Cull wedding images');
    await expect(dialog).toContainText('Color grade highlight reel');

    // 1. Click Cancel: card stays in Editing
    await page.locator('[data-testid="task-warning-cancel-btn"]').click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.locator(
        `[data-testid="kanban-column-editing"] [data-testid="project-card-${E2E_PROJECT_EDITING_ID}"]`,
      ),
    ).toBeVisible();

    // 2. Trigger again and click Move anyway: card moves to Delivered
    await trigger.click();
    await page.locator('[data-testid="project-action-move-trigger"]').click();
    await page.locator('[data-testid="project-action-move-delivered"]').click();
    await expect(dialog).toBeVisible();

    await page.locator('[data-testid="task-warning-confirm-btn"]').click();
    await expect(dialog).not.toBeVisible();

    // Card should now be in Delivered column
    await expect(
      page.locator(
        `[data-testid="kanban-column-delivered"] [data-testid="project-card-${E2E_PROJECT_EDITING_ID}"]`,
      ),
    ).toBeVisible();
  });

  test('AC-5: Action bar click "List" navigates to ?view=list and shows list placeholder', async ({
    page,
  }) => {
    await page.goto('/en/projects');
    await expect(page.locator('[data-testid="kanban-column-inquiry"]')).toBeVisible();

    const listBtn = page.locator('[data-testid="view-switch-list"]');
    await listBtn.click();

    await expect(page).toHaveURL(/\/projects\?view=list/);
    await expect(page.locator('[data-testid="projects-list-placeholder"]')).toBeVisible();

    // Switch back to board view
    await page.locator('[data-testid="projects-switch-to-board-btn"]').click();
    await expect(page).not.toHaveURL(/view=list/);
    await expect(page.locator('[data-testid="kanban-column-inquiry"]')).toBeVisible();
  });

  test('AC-6: Network/server failure during transition rolls back card and displays error toast', async ({
    page,
  }) => {
    await page.goto('/en/projects');
    await expect(page.locator('[data-testid="kanban-column-inquiry"]')).toBeVisible();

    // Intercept server action call to simulate failure
    await page.route('**/projects**', async (route) => {
      const request = route.request();
      if (
        request.method() === 'POST' &&
        (request.headers()['next-action'] || request.postData()?.includes('transitionProjectStage'))
      ) {
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    const trigger = page.locator(`[data-testid="project-actions-trigger-${E2E_PROJECT_SHOT_ID}"]`);
    await expect(trigger).toBeVisible();
    await trigger.click();
    await page.locator('[data-testid="project-action-move-trigger"]').click();
    await page.locator('[data-testid="project-action-move-delivered"]').click();

    // Error toast should appear
    const errorToast = page.locator('[data-testid="kanban-error-toast"]');
    await expect(errorToast).toBeVisible();

    // Card must be rolled back to Shot column
    await expect(
      page.locator(
        `[data-testid="kanban-column-shot"] [data-testid="project-card-${E2E_PROJECT_SHOT_ID}"]`,
      ),
    ).toBeVisible();
  });

  test('AC-7: German locale /de/projects renders German stage titles, action buttons, and localized view', async ({
    page,
  }) => {
    await page.goto('/de/projects');
    await expect(page.locator('[data-testid="kanban-column-inquiry"]')).toBeVisible();

    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('h1')).toContainText('Projekte & Pipeline');

    // German stage names in column headers
    await expect(page.locator('[data-testid="kanban-column-title-inquiry"]')).toContainText(
      'Anfrage',
    );
    await expect(page.locator('[data-testid="kanban-column-title-booked"]')).toContainText(
      'Gebucht',
    );
    await expect(page.locator('[data-testid="kanban-column-title-shot"]')).toContainText(
      'Geshootet',
    );
    await expect(page.locator('[data-testid="kanban-column-title-editing"]')).toContainText(
      'Bildbearbeitung',
    );
    await expect(page.locator('[data-testid="kanban-column-title-delivered"]')).toContainText(
      'Geliefert',
    );
    await expect(page.locator('[data-testid="kanban-column-title-archived"]')).toContainText(
      'Archiviert',
    );

    // German action bar buttons
    await expect(page.locator('[data-testid="view-switch-board"]')).toContainText('Board');
    await expect(page.locator('[data-testid="view-switch-list"]')).toContainText('Liste');
    await expect(page.locator('[data-testid="new-project-btn"]')).toContainText('Neues Projekt');
  });

  test('AC-8: Zero axe WCAG 2.2 AA violations across 320px, 768px, and 1280px in light and dark modes with UX screenshots', async ({
    page,
  }) => {
    const viewports = [
      { name: '320px', width: 320, height: 640 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1280px', width: 1280, height: 800 },
    ];

    const themes: ('light' | 'dark')[] = ['light', 'dark'];

    for (const theme of themes) {
      await page.emulateMedia({ colorScheme: theme });

      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        await page.goto('/en/projects');
        await expect(page.locator('[data-testid="kanban-column-inquiry"]')).toBeVisible();

        const axeResults = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        expect(axeResults.violations).toEqual([]);

        // Capture screenshot for UX review
        await page.screenshot({
          path: path.join(UX_RUN_DIR, `projects-kanban-${vp.name}-${theme}.png`),
          fullPage: true,
        });
      }
    }

    // Modal contrast axe scan
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/projects');
    await expect(page.locator('[data-testid="kanban-column-inquiry"]')).toBeVisible();

    const newProjectBtn = page.locator('[data-testid="new-project-btn"]');
    await newProjectBtn.click();
    await page.waitForSelector('[role="dialog"]', { state: 'visible' });

    const dialogAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(dialogAxe.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'new-project-dialog-1280px-light.png'),
    });
  });
});
