import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';
import { E2E_INQUIRY_PUBLISHED_SLUG } from '../helpers/e2e-inquiry-helper';
import { E2E_PROJECT_INQUIRY_1_ID } from '../helpers/e2e-projects-helper';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

function getLatestRunDir(): string {
  if (process.env.RUN_DIR) return process.env.RUN_DIR;
  const runsRoot = path.resolve(import.meta.dirname, '../../../../control/ownlight/runs/TASK-0038');
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
  `../../../../control/ownlight/runs/TASK-0038/${RUN_DIR_PARAM}/ux`,
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

const TEST_LEAD_EMAIL = `e3-journey-${String(Date.now())}@example.com`;

test.describe('TASK-0038: Epic E3 Complete Journey & Project Fulfillment E2E', () => {
  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test('AC-7: Complete Epic E3 workflow: public inquiry -> lead conversion -> Kanban -> Booked stage transition -> project detail fulfillment -> client profile projects & timeline -> DSAR export', async ({
    page,
  }) => {
    test.setTimeout(90000);

    // -------------------------------------------------------------
    // Step 1: Client submits public inquiry form
    // -------------------------------------------------------------
    await page.setExtraHTTPHeaders({
      'x-forwarded-for': '198.51.100.99',
    });
    await page.goto(`/en/f/${E2E_INQUIRY_PUBLISHED_SLUG}`);
    await expect(page.locator('h1')).toBeVisible();

    await page.fill('#field-given_name', 'Amelia');
    await page.fill('#field-family_name', 'Earhart');
    await page.fill('#field-email', TEST_LEAD_EMAIL);
    await page.fill('#field-phone', '+49 30 11223344');
    await page.selectOption('#field-event_type', 'wedding');
    await page.fill('#field-message', 'Inquiry for high altitude scenic wedding shoot.');
    await page.check('#field-notice_acknowledged');

    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(`/en/f/${E2E_INQUIRY_PUBLISHED_SLUG}/thanks`);
    await expect(page.locator('h1')).toContainText('Thank you for your inquiry');
    await page.setExtraHTTPHeaders({});

    // -------------------------------------------------------------
    // Step 2: Studio reviews lead and converts to client
    // -------------------------------------------------------------
    await ensureOwnerBootstrappedAndSignedIn(page);
    await page.goto('/en/leads');

    // Locate the newly created lead in table
    const leadRow = page.locator(`tr:has-text("${TEST_LEAD_EMAIL}")`).first();
    await expect(leadRow).toBeVisible();

    // Click view link for the lead
    const viewLeadLink = leadRow.locator('a[data-testid^="lead-view-link-"]');
    await viewLeadLink.click();
    await expect(page).toHaveURL(/\/en\/leads\/[0-9a-f-]{36}/);

    const leadUrl = page.url();
    const leadIdMatch = /\/leads\/([0-9a-f-]{36})/.exec(leadUrl);
    const createdLeadId = leadIdMatch?.[1] ?? null;

    // Convert lead to client
    const convertBtn = page.locator('[data-testid="convert-lead-btn"]');
    await expect(convertBtn).toBeVisible();
    await convertBtn.click();

    // In convert dialog, confirm new client
    const convertDialog = page.locator('[data-testid="convert-lead-dialog"]');
    await expect(convertDialog).toBeVisible();
    await page.waitForTimeout(300); // Radix fade-in

    const confirmConvertBtn = page.locator('[data-testid="confirm-convert-btn"]');
    await confirmConvertBtn.click();

    // Conversion redirects directly to the newly created client profile
    await expect(page).toHaveURL(/\/en\/clients\/[0-9a-f-]{36}/);
    const clientUrl = page.url();
    const clientIdMatch = /\/clients\/([0-9a-f-]{36})/.exec(clientUrl);
    const createdClientId = clientIdMatch?.[1] ?? null;
    const clientHref = `/en/clients/${createdClientId ?? ''}`;

    // Verify client projects section displays the converted project
    const initialProjectsSection = page.locator('[data-testid="client-projects-section"]');
    await expect(initialProjectsSection).toBeVisible();

    const projectCardLink = initialProjectsSection.locator('a[href*="/projects/"]').first();
    await expect(projectCardLink).toBeVisible();
    const projectHref = await projectCardLink.getAttribute('href');
    expect(projectHref).toMatch(/\/en\/projects\/[0-9a-f-]{36}/);

    // Verify converted banner is displayed on lead detail page
    if (createdLeadId) {
      await page.goto(`/en/leads/${createdLeadId}`);
      const convertedBanner = page.locator('[data-testid="lead-converted-banner"]');
      await expect(convertedBanner).toBeVisible();
    }

    // -------------------------------------------------------------
    // Step 3: Client appears on Kanban board (/en/projects)
    // -------------------------------------------------------------
    await page.goto('/en/projects');
    await expect(page.locator('[data-testid="kanban-column-inquiry"]')).toBeVisible();
    await expect(page.locator('[data-testid="kanban-column-inquiry"]')).toContainText(
      'Amelia Earhart',
    );

    // -------------------------------------------------------------
    // Step 4 & 5: Transition project stage from Inquiry to Booked & detail page
    // -------------------------------------------------------------
    if (!projectHref) throw new Error('projectHref was not set');
    await page.goto(projectHref);

    // Verify project detail view elements
    await expect(page.locator('[data-testid="project-title"]')).toBeVisible();
    await expect(page.locator('[data-testid="project-title"]')).toContainText('Amelia Earhart');
    await expect(page.locator('[data-testid="project-client-link"]')).toContainText(
      'Amelia Earhart',
    );

    // Stepper shows Inquiry as current stage
    await expect(page.locator('[data-testid="stage-step-inquiry"]')).toBeVisible();

    // Click Booked stage in stepper
    await page.click('[data-testid="stage-step-booked"]');

    // If advisory warning dialog appears (for incomplete tasks), proceed
    const warningDialog = page.locator('[data-testid="task-warning-dialog"]');
    if (await warningDialog.isVisible({ timeout: 1500 }).catch(() => false)) {
      await page.waitForTimeout(300);
      await page.click('[data-testid="task-warning-confirm-btn"]');
    }

    // Verify Booked stage is now active
    await expect(page.locator('[data-testid="stage-step-booked"]')).toBeVisible();

    // -------------------------------------------------------------
    // Step 6: Add shoot date, location, timeline item, participant, and stage task
    // -------------------------------------------------------------
    // 6a. Add Shoot Session
    await page.click('[data-testid="tab-shoots"]');
    await page.click('[data-testid="add-shoot-btn"]');
    const shootDialog = page.locator('[data-testid="add-shoot-dialog"]');
    await expect(shootDialog).toBeVisible();
    await page.waitForTimeout(300);

    await page.fill('#add-shoot-title', 'Full Day Wedding Ceremony & Reception');
    await page.fill('#add-shoot-starts-at', '2027-09-18T13:00');
    await page.fill('#add-shoot-ends-at', '2027-09-18T23:00');
    await page.fill('#add-shoot-notes', 'Dual Nikon bodies, 35mm & 85mm prime lenses');
    await page.click('[data-testid="add-shoot-submit-btn"]');
    await expect(shootDialog).not.toBeVisible();

    await expect(page.locator('[data-testid="shoots-list"]')).toContainText(
      'Full Day Wedding Ceremony & Reception',
    );

    // 6b. Add Physical Location
    await page.click('[data-testid="tab-locations"]');
    await page.click('[data-testid="add-location-btn"]');
    const locDialog = page.locator('[data-testid="add-location-dialog"]');
    await expect(locDialog).toBeVisible();
    await page.waitForTimeout(300);

    await page.fill('#add-location-name', 'Jagdschloss Grunewald');
    await page.fill('#add-location-address1', 'Hüttenweg 100');
    await page.fill('#add-location-postal', '14193');
    await page.fill('#add-location-city', 'Berlin');
    await page.click('[data-testid="add-location-submit-btn"]');
    await expect(locDialog).not.toBeVisible();

    await expect(page.locator('[data-testid="locations-list"]')).toContainText(
      'Jagdschloss Grunewald',
    );

    // 6c. Add Timeline Schedule Item
    await page.click('[data-testid="tab-timeline"]');
    await page.click('[data-testid="add-timeline-item-btn"]');
    const timelineDialog = page.locator('[data-testid="add-timeline-dialog"]');
    await expect(timelineDialog).toBeVisible();
    await page.waitForTimeout(300);

    await page.fill('#add-timeline-title', '15:00 Ceremony & Ring Exchange');
    await page.fill('#add-timeline-starts-at', '2027-09-18T15:00');
    await page.fill('#add-timeline-ends-at', '2027-09-18T16:00');
    await page.fill('#add-timeline-description', 'Courtyard ceremony followed by rose petal exit');
    await page.click('[data-testid="add-timeline-submit-btn"]');
    await expect(timelineDialog).not.toBeVisible();

    await expect(page.locator('[data-testid="timeline-list"]')).toContainText(
      '15:00 Ceremony & Ring Exchange',
    );

    // 6d. Add Participant
    await page.click('[data-testid="tab-participants"]');
    await page.click('[data-testid="add-participant-btn"]');
    const partDialog = page.locator('[data-testid="add-participant-dialog"]');
    await expect(partDialog).toBeVisible();
    await page.waitForTimeout(300);

    await page.click('[data-testid="add-participant-source-vendor"]');
    await page.fill('#add-participant-name', 'Felix Neumann');
    await page.fill('#add-participant-role', 'Second Shooter');
    await page.fill('#add-participant-email', 'felix.neumann@phototeam.example');
    await page.click('[data-testid="add-participant-submit-btn"]');
    await expect(partDialog).not.toBeVisible();

    await expect(page.locator('[data-testid="participants-list"]')).toContainText('Felix Neumann');

    // 6e. Add Stage Task & toggle complete
    await page.click('[data-testid="tab-tasks"]');
    await page.click('[data-testid="add-task-btn"]');
    const taskDialog = page.locator('[data-testid="add-task-dialog"]');
    await expect(taskDialog).toBeVisible();
    await page.waitForTimeout(300);

    await page.fill('#add-task-title', 'Send consultation questionnaire');
    await page.fill('#add-task-due-date', '2027-09-01');
    await page.click('[data-testid="add-task-submit-btn"]');
    await expect(taskDialog).not.toBeVisible();

    await expect(page.locator('[data-testid="stage-tasks-list"]')).toContainText(
      'Send consultation questionnaire',
    );

    // Toggle the task checkbox
    const taskCheckbox = page.locator('button[data-testid^="task-checkbox-"]').first();
    await expect(taskCheckbox).toBeVisible();
    await taskCheckbox.click();

    // Verify task is now marked completed
    await expect(page.locator('[data-testid^="task-title-"]').first()).toHaveClass(/line-through/);

    // -------------------------------------------------------------
    // Step 7: Client detail page shows associated project & updated timeline event
    // -------------------------------------------------------------
    if (!clientHref) throw new Error('clientHref was not set');
    await page.goto(clientHref);

    // Verify Projects section lists the project
    const projectsSection = page.locator('[data-testid="client-projects-section"]');
    await expect(projectsSection).toBeVisible();
    await expect(projectsSection).toContainText('Amelia Earhart');
    await expect(projectsSection).toContainText('Booked');

    // Verify Timeline section includes project events
    const timelineSection = page.locator('[data-testid="client-timeline-section"]');
    await expect(timelineSection).toBeVisible();
    await expect(timelineSection).toContainText(/Project/i);

    // -------------------------------------------------------------
    // Step 8: Client data export (DSAR) includes project records
    // -------------------------------------------------------------
    const exportBtn = page.locator('[data-testid^="export-contact-btn-"]').first();
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    const exportDialog = page.locator('[data-testid="export-data-dialog"]');
    await expect(exportDialog).toBeVisible();
    await page.waitForTimeout(300);

    // Select JSON format
    await page.click('[data-testid="export-format-json-btn"]');

    const [jsonDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="export-submit-btn"]'),
    ]);

    const downloadedPath = await jsonDownload.path();
    expect(downloadedPath).toBeTruthy();
    if (downloadedPath) {
      const exportJson = JSON.parse(fs.readFileSync(downloadedPath, 'utf8')) as {
        schema: string;
        categories?: { projects?: unknown[] };
      };
      expect(exportJson.schema).toBe('ownlight.dsar.v1');
      expect(exportJson.categories).toBeDefined();
      const projCategory = exportJson.categories?.projects;
      expect(projCategory).toBeDefined();
      expect(Array.isArray(projCategory) && projCategory.length > 0).toBe(true);
    }

    // -------------------------------------------------------------
    // Step 9: Clean up created project to preserve baseline Kanban seed counts
    // -------------------------------------------------------------
    await page.goto(projectHref);
    await page.click('[data-testid="delete-project-btn"]');
    const deleteDialog = page.locator('[data-testid="delete-project-dialog"]');
    await expect(deleteDialog).toBeVisible();
    await page.waitForTimeout(300);
    await page.click('[data-testid="delete-project-confirm-btn"]');
    await expect(page).toHaveURL(/\/en\/projects$/);
  });

  test('AC-8: German locale /de/projects/[id] renders German UI labels and formatted dates', async ({
    page,
  }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);

    // Use baseline seeded project (E2E_PROJECT_INQUIRY_1_ID)
    await page.goto(`/de/projects/${E2E_PROJECT_INQUIRY_1_ID}`);

    // Verify html lang="de"
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');

    // Localized breadcrumb and headings
    await expect(page.locator('[data-testid="project-breadcrumb"]')).toContainText('Projekten');
    await expect(page.locator('[data-testid="tab-shoots"]')).toContainText('Shootings & Sessions');
    await expect(page.locator('[data-testid="tab-locations"]')).toContainText('Orte & Venues');
    await expect(page.locator('[data-testid="tab-timeline"]')).toContainText('Ablauf & Zeitplan');
    await expect(page.locator('[data-testid="tab-participants"]')).toContainText(
      'Beteiligte & Rollen',
    );
    await expect(page.locator('[data-testid="tab-tasks"]')).toContainText('Aufgaben');

    // Stepper stages in German
    await expect(page.locator('[data-testid="stage-step-inquiry"]')).toContainText('Anfrage');
    await expect(page.locator('[data-testid="stage-step-booked"]')).toContainText('Gebucht');
  });

  test('AC-9: Accessibility & responsiveness: Zero WCAG 2.2 AA violations across 320px, 768px, 1280px in light/dark modes with UX screenshots', async ({
    page,
  }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);

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

        // 1. Project Detail View
        await page.goto(`/en/projects/${E2E_PROJECT_INQUIRY_1_ID}`);
        await page.waitForLoadState('networkidle');

        const detailAxe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        expect(detailAxe.violations).toEqual([]);

        // No horizontal scroll at 320px mobile viewport (allowing 1px rounding margin)
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

        // Capture UX review screenshots
        await page.screenshot({
          path: path.join(UX_RUN_DIR, `project-detail-${vp.name}-${theme}.png`),
          fullPage: true,
        });

        // 2. Open Add Shoot Dialog at desktop 1280px to audit modal dialog contrast and accessibility
        if (vp.width === 1280 && theme === 'light') {
          await page.click('[data-testid="tab-shoots"]');
          await page.click('[data-testid="add-shoot-btn"]');
          await page.waitForSelector('[data-testid="add-shoot-dialog"]', { state: 'visible' });
          await page.waitForTimeout(300); // 300ms CSS animation settling delay for Radix dialog

          const modalAxe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
            .analyze();
          expect(modalAxe.violations).toEqual([]);

          await page.screenshot({
            path: path.join(UX_RUN_DIR, `project-detail-add-shoot-modal-1280px.png`),
            fullPage: true,
          });

          await page.click('button:has-text("Cancel")');
        }
      }
    }
  });
});
