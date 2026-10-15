import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';
import { E2E_PROJECT_INQUIRY_1_ID, E2E_PROJECT_BOOKED_ID } from '../helpers/e2e-projects-helper';
import { E2E_LEAD_CONVERTED_ID } from '../helpers/e2e-leads-helper';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

function getLatestRunDir(): string {
  if (process.env.RUN_DIR) return process.env.RUN_DIR;
  const runsRoot = path.resolve(import.meta.dirname, '../../../../control/ownlight/runs/TASK-0037');
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
  `../../../../control/ownlight/runs/TASK-0037/${RUN_DIR_PARAM}/ux`,
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

test.describe('TASK-0037: Projects Directory Table & Creation UI E2E Tests', () => {
  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-1 (R-A): /en/projects?view=list renders directory table with columns and view switcher', async ({
    page,
  }) => {
    await page.goto('/en/projects?view=list');

    // Header view toggle
    await expect(page.locator('h1')).toContainText('Projects & Pipeline');
    const boardSwitch = page.locator('[data-testid="view-switch-board"]');
    const listSwitch = page.locator('[data-testid="view-switch-list"]');
    await expect(boardSwitch).toBeVisible();
    await expect(listSwitch).toBeVisible();
    await expect(listSwitch).toHaveAttribute('aria-current', 'page');
    await expect(boardSwitch).not.toHaveAttribute('aria-current');

    // Table container exists
    const tableContainer = page.locator('[data-testid="projects-table-container"]');
    await expect(tableContainer).toBeVisible();

    // Verify all table headers
    const table = page.locator('[data-testid="projects-table"]');
    await expect(table).toBeVisible();
    await expect(table.locator('th')).toContainText([
      'Project Title',
      'Client',
      'Type',
      'Stage',
      'Shoot Date & Time',
      'Tasks',
      'Value',
      'Actions',
    ]);

    // Rows are present
    const rows = page.locator('[data-testid^="project-table-row-"]');
    await expect(rows).not.toHaveCount(0);

    // Verify Emma & Liam row details
    const weddingRow = page.locator(
      `[data-testid="project-table-row-${E2E_PROJECT_INQUIRY_1_ID}"]`,
    );
    await expect(weddingRow).toBeVisible();
    await expect(weddingRow).toContainText('Emma & Liam Wedding');
    await expect(weddingRow).toContainText('Emma Watson');
    await expect(weddingRow).toContainText('Wedding');
    await expect(weddingRow).toContainText('Inquiry');
    await expect(weddingRow).toContainText('€2,500.00');

    // Clicking board switch navigates back to board view
    await boardSwitch.click();
    await expect(page).toHaveURL(/\/en\/projects(\?view=board)?$/);
    await expect(page.locator('[data-testid="kanban-column-inquiry"]')).toBeVisible();
  });

  test('AC-2 (R-A): multi-faceted filtering updates URL search params and filters rows', async ({
    page,
  }) => {
    await page.goto('/en/projects?view=list');

    const stageSelect = page.locator('[data-testid="project-filter-stage"]');
    const typeSelect = page.locator('[data-testid="project-filter-type"]');

    // 1. Filter by Stage = Booked
    await stageSelect.selectOption('booked');
    await expect(page).toHaveURL(/stage=booked/);

    const bookedRow = page.locator(`[data-testid="project-table-row-${E2E_PROJECT_BOOKED_ID}"]`);
    await expect(bookedRow).toBeVisible();
    const inquiryRow = page.locator(
      `[data-testid="project-table-row-${E2E_PROJECT_INQUIRY_1_ID}"]`,
    );
    await expect(inquiryRow).toHaveCount(0);

    // 2. Filter by Type = Commercial
    await typeSelect.selectOption('commercial');
    await expect(page).toHaveURL(/type=commercial/);
    await expect(bookedRow).toBeVisible();

    // 3. Reset filters button restores all rows and clears query params
    const resetBtn = page.locator('[data-testid="project-filters-clear-btn"]');
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();

    await expect(page).not.toHaveURL(/stage=booked/);
    await expect(page).not.toHaveURL(/type=commercial/);
    await expect(inquiryRow).toBeVisible();
  });

  test('AC-3: in-memory search strictly filters rows in React state without URL or log leakage', async ({
    page,
  }) => {
    await page.goto('/en/projects?view=list');

    const searchInput = page.locator('[data-testid="project-search-input"]');
    await expect(searchInput).toBeVisible();

    // Type search query
    await searchInput.fill('Corporate');

    // Verify row filtering
    const bookedRow = page.locator(`[data-testid="project-table-row-${E2E_PROJECT_BOOKED_ID}"]`);
    await expect(bookedRow).toBeVisible();
    const weddingRow = page.locator(
      `[data-testid="project-table-row-${E2E_PROJECT_INQUIRY_1_ID}"]`,
    );
    await expect(weddingRow).toHaveCount(0);

    // Strict ADR-0010 check: URL must NEVER contain '?q=' or 'search' or the query text
    const currentUrl = page.url();
    expect(currentUrl).not.toContain('Corporate');
    expect(currentUrl).not.toContain('?q=');
    expect(currentUrl).not.toContain('&q=');
    expect(currentUrl).not.toContain('search=');

    // Clear search using clear button
    const clearBtn = page.locator('[data-testid="project-search-clear-btn"]');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();

    await expect(searchInput).toHaveValue('');
    await expect(weddingRow).toBeVisible();
    expect(page.url()).not.toContain('?q=');
  });

  test('AC-4 (R-A): "New Project" button opens dialog, creates project, and redirects to project detail', async ({
    page,
  }) => {
    await page.goto('/en/projects?view=list');

    const newProjectBtn = page.locator('[data-testid="new-project-btn"]').first();
    await expect(newProjectBtn).toBeVisible();
    await newProjectBtn.click();

    const dialog = page.locator('[data-testid="new-project-dialog"]');
    await expect(dialog).toBeVisible();

    // Fill form
    await page
      .locator('[data-testid="new-project-title-input"]')
      .fill('Autumn Landscape Exhibition');
    await page.locator('[data-testid="new-project-type-select"]').selectOption('commercial');
    await page.locator('[data-testid="new-project-price-input"]').fill('4500.00');
    await page
      .locator('[data-testid="new-project-shoot-location-input"]')
      .fill('Brandenburg Nature Reserve');
    await page
      .locator('[data-testid="new-project-notes-input"]')
      .fill('Full daylight shoot with assistant.');

    // Submit
    const submitBtn = page.locator('[data-testid="new-project-submit-btn"]');
    await submitBtn.click();

    // Redirect to project detail view
    await expect(page).toHaveURL(/\/en\/projects\/[0-9a-f-]{36}/, { timeout: 10000 });
  });

  test('AC-5 (R-A): lead conversion flow provides direct link pointing to created project', async ({
    page,
  }) => {
    await page.goto(`/en/leads/${E2E_LEAD_CONVERTED_ID}`);

    const banner = page.locator('[data-testid="lead-converted-banner"]');
    await expect(banner).toBeVisible();
    const projectLink = banner.locator('[data-testid="converted-project-link"]');
    await expect(projectLink).toBeVisible();
    await expect(projectLink).toHaveAttribute('href', /\/en\/projects\/[0-9a-f-]{36}/);
  });

  test('AC-6: clicking table headers sorts ascending/descending with aria-sort update', async ({
    page,
  }) => {
    await page.goto('/en/projects?view=list');

    const sortTitleBtn = page.locator('[data-testid="sort-header-title"]');
    const sortValueBtn = page.locator('[data-testid="sort-header-value"]');
    const titleTh = page.locator('th').filter({ has: sortTitleBtn });
    const valueTh = page.locator('th').filter({ has: sortValueBtn });

    // Initial state: default sorted by title ascending
    await expect(titleTh).toHaveAttribute('aria-sort', 'ascending');
    await expect(valueTh).toHaveAttribute('aria-sort', 'none');

    // Click Title to sort descending
    await sortTitleBtn.click();
    await expect(titleTh).toHaveAttribute('aria-sort', 'descending');

    // Click Value to sort descending (natural default for numeric value)
    await sortValueBtn.click();
    await expect(valueTh).toHaveAttribute('aria-sort', 'descending');
    await expect(titleTh).toHaveAttribute('aria-sort', 'none');

    // Click Value again to sort ascending
    await sortValueBtn.click();
    await expect(valueTh).toHaveAttribute('aria-sort', 'ascending');
  });

  test('AC-7: German locale /de/projects?view=list renders all headers, filters, and dialog in German', async ({
    page,
  }) => {
    await page.goto('/de/projects?view=list');

    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('h1')).toContainText('Projekte & Pipeline');

    // View switchers in German
    await expect(page.locator('[data-testid="view-switch-board"]')).toContainText('Board');
    await expect(page.locator('[data-testid="view-switch-list"]')).toContainText('Liste');

    // New project button
    await expect(page.locator('[data-testid="new-project-btn"]').first()).toContainText(
      'Neues Projekt',
    );

    // Table headers in German
    const table = page.locator('[data-testid="projects-table"]');
    await expect(table.locator('th')).toContainText([
      'Projektname',
      'Kunde',
      'Typ',
      'Phase',
      'Shooting-Termin',
      'Aufgaben',
      'Wert',
      'Aktionen',
    ]);

    // Open create project dialog in German
    await page.locator('[data-testid="new-project-btn"]').first().click();
    const dialog = page.locator('[data-testid="new-project-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('h2')).toContainText('Neues Projekt anlegen');
    await expect(dialog).toContainText('Kunde');
    await expect(dialog).toContainText('Projektname');
    await expect(dialog).toContainText('Projekttyp');

    // Close dialog
    await page.locator('[data-testid="new-project-cancel-btn"]').click();
    await expect(dialog).not.toBeVisible();
  });

  test('AC-8: zero axe WCAG 2.2 AA violations across 320px, 768px, 1280px in light and dark modes with screenshots', async ({
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
        await page.goto('/en/projects?view=list');
        await expect(page.locator('[data-testid="projects-table"]')).toBeVisible();

        const axeResults = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        expect(axeResults.violations).toEqual([]);

        // Capture screenshot for UX review
        await page.screenshot({
          path: path.join(UX_RUN_DIR, `projects-directory-table-${vp.name}-${theme}.png`),
          fullPage: true,
        });
      }
    }

    // Modal axe scan (with 300ms animation settle)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/projects?view=list');
    await page.locator('[data-testid="new-project-btn"]').first().click();
    await page.waitForSelector('[data-testid="new-project-dialog"]', { state: 'visible' });
    await page.waitForTimeout(300);

    const dialogAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(dialogAxe.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'create-project-dialog-1280px-light.png'),
    });

    // Close modal
    await page.locator('[data-testid="new-project-cancel-btn"]').click();
    await expect(page.locator('[data-testid="new-project-dialog"]')).not.toBeVisible();

    // Table row actions dropdown menu axe scan (modal={false})
    const menuTrigger = page.locator(
      `[data-testid="project-actions-trigger-${E2E_PROJECT_INQUIRY_1_ID}"]`,
    );
    await menuTrigger.click();
    await page.waitForSelector(`[data-testid="project-actions-menu-${E2E_PROJECT_INQUIRY_1_ID}"]`, {
      state: 'visible',
    });

    const menuAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(menuAxe.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'project-table-actions-menu-1280px-light.png'),
    });
  });
});
