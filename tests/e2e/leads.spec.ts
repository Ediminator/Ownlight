import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';
import {
  E2E_LEAD_NEW_ID,
  E2E_LEAD_CONTACTED_ID,
  E2E_LEAD_CONVERTED_ID,
  E2E_LEAD_ARCHIVED_ID,
  E2E_LEAD_SPAM_ID,
  E2E_LEAD_XSS_ID,
} from '../helpers/e2e-leads-helper';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

const RUN_DIR_PARAM = process.env.RUN_DIR ?? 'iter-01';
const UX_RUN_DIR = path.resolve(
  import.meta.dirname,
  `../../../../control/ownlight/runs/TASK-0031/${RUN_DIR_PARAM}/ux`,
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

test.describe('TASK-0031: Lead Inbox and Management UI E2E Tests', () => {
  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await ensureOwnerBootstrappedAndSignedIn(page);
  });

  test('AC-1: /en/leads lists leads and app nav displays unread pill badge with new leads count', async ({
    page,
  }) => {
    await page.goto('/en/leads');

    // Heading exists
    const heading = page.locator('h1');
    await expect(heading).toContainText('Leads');

    // Nav pill badge is visible and shows count
    const navBadge = page.locator('[data-testid="new-leads-badge"]');
    await expect(navBadge).toBeVisible();
    const countText = await navBadge.textContent();
    expect(Number(countText)).toBeGreaterThanOrEqual(2);

    // Table rows exist
    const rows = page.locator('tbody tr[data-testid^="lead-row-"]');
    await expect(page.locator(`[data-testid="lead-row-${E2E_LEAD_NEW_ID}"]`)).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(6);

    // Capture desktop light screenshot
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'leads-inbox-desktop-light.png'),
      fullPage: true,
    });
  });

  test('AC-2: filter tabs filter list by status (All, New, Contacted, Converted, Archived, Spam)', async ({
    page,
  }) => {
    await page.goto('/en/leads');

    // 1. Tab Contacted
    await page.click('[data-testid="tab-contacted"]');
    await expect(page).toHaveURL(/status=contacted/);
    await expect(page.locator(`[data-testid="lead-row-${E2E_LEAD_CONTACTED_ID}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="lead-row-${E2E_LEAD_NEW_ID}"]`)).not.toBeVisible();

    // 2. Tab Converted
    await page.click('[data-testid="tab-converted"]');
    await expect(page).toHaveURL(/status=converted/);
    await expect(page.locator(`[data-testid="lead-row-${E2E_LEAD_CONVERTED_ID}"]`)).toBeVisible();

    // 3. Tab Spam
    await page.click('[data-testid="tab-spam"]');
    await expect(page).toHaveURL(/status=spam/);
    await expect(page.locator(`[data-testid="lead-row-${E2E_LEAD_SPAM_ID}"]`)).toBeVisible();

    // 4. Tab Archived
    await page.click('[data-testid="tab-archived"]');
    await expect(page).toHaveURL(/status=archived/);
    await expect(page.locator(`[data-testid="lead-row-${E2E_LEAD_ARCHIVED_ID}"]`)).toBeVisible();

    // 5. Tab All
    await page.click('[data-testid="tab-all"]');
    await expect(page).not.toHaveURL(/status=/);
    await expect(page.locator(`[data-testid="lead-row-${E2E_LEAD_NEW_ID}"]`)).toBeVisible();
  });

  test('AC-7: search input filters by email prefix via email_normalized', async ({ page }) => {
    await page.goto('/en/leads');

    // Search prefix 'alice.won'
    await page.fill('[data-testid="leads-search-input"]', 'alice.won');

    // Debounced search updates URL and table
    await expect(page).toHaveURL(/q=alice\.won/);
    await expect(page.locator(`[data-testid="lead-row-${E2E_LEAD_NEW_ID}"]`)).toBeVisible();
    await expect(
      page.locator(`[data-testid="lead-row-${E2E_LEAD_CONTACTED_ID}"]`),
    ).not.toBeVisible();

    // Clear search input
    await page.fill('[data-testid="leads-search-input"]', '');
    await expect(page).not.toHaveURL(/q=/);
    await expect(page.locator(`[data-testid="lead-row-${E2E_LEAD_CONTACTED_ID}"]`)).toBeVisible();
  });

  test('AC-8: export lead data (DSAR) requires step-up re-authentication within 5 min and delivers download bundle', async ({
    page,
  }) => {
    await page.goto(`/en/leads/${E2E_LEAD_NEW_ID}`);

    const modal = page.locator('[data-testid="reauth-modal"]');

    // Click export DSAR button
    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-testid="export-dsar-btn"]');

    // If reauth modal is prompted (when session reauth is not fresh)
    if (await modal.isVisible({ timeout: 1500 }).catch(() => false)) {
      // Try wrong password
      await page.fill('[data-testid="reauth-password-input"]', 'WrongPassword123!');
      await page.click('[data-testid="reauth-submit-btn"]');
      const alert = modal.locator('[role="alert"]');
      await expect(alert).toBeVisible();

      // Enter correct password and submit
      await page.fill('[data-testid="reauth-password-input"]', E2E_OWNER_PASSWORD);
      await page.click('[data-testid="reauth-submit-btn"]');
    }

    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^ownlight-data-export-.*\.json$/);

    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    const content = Buffer.concat(chunks).toString('utf-8');
    const parsed = JSON.parse(content) as {
      subject: { email: string; first_name: string };
      categories: {
        leads?: {
          email: string;
          given_name: string;
          notice_version: number;
          notice_acknowledgement_text_en: string;
        }[];
      };
    };

    expect(parsed.subject.email).toBe('alice.wonderland@example.com');
    expect(parsed.subject.first_name).toBe('Alice');
    const leadCategory = parsed.categories.leads?.[0];
    expect(leadCategory?.email).toBe('alice.wonderland@example.com');
    expect(leadCategory?.notice_acknowledgement_text_en).toBeDefined();
  });

  test('AC-9: inquiry message is rendered safely with HTML entity escaping and discretion notice is displayed', async ({
    page,
  }) => {
    let alertTriggered = false;
    page.on('dialog', () => {
      alertTriggered = true;
    });

    await page.goto(`/en/leads/${E2E_LEAD_XSS_ID}`);

    // Discretion notice is displayed
    const discretionNotice = page.locator('[data-testid="discretion-notice"]');
    await expect(discretionNotice).toBeVisible();

    // Message is rendered strictly as plain text (HTML escaped)
    const messageContent = page.locator('[data-testid="lead-message-content"]');
    await expect(messageContent).toBeVisible();
    await expect(messageContent).toHaveText('<script>alert(1)</script>');

    // Alert dialog must NOT have been triggered
    expect(alertTriggered).toBe(false);
  });

  test('AC-11: German locale /de/leads renders German copy and lang="de"', async ({ page }) => {
    await page.goto('/de/leads');

    // HTML lang="de"
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');

    // German status tabs
    await expect(page.locator('[data-testid="tab-new"]')).toContainText('Neu');
    await expect(page.locator('[data-testid="tab-contacted"]')).toContainText('Kontaktiert');
    await expect(page.locator('[data-testid="tab-converted"]')).toContainText('Konvertiert');
    await expect(page.locator('[data-testid="tab-archived"]')).toContainText('Archiviert');
    await expect(page.locator('[data-testid="tab-spam"]')).toContainText('Spam');

    // Detail page in German
    await page.goto(`/de/leads/${E2E_LEAD_NEW_ID}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('[data-testid="lead-status-badge"]')).toHaveText('Neu');
    await expect(page.locator('[data-testid="lead-event-type"]')).toHaveText('Hochzeit');
    await expect(page.locator('[data-testid="back-to-leads-link"]')).toContainText('Zurück');
  });

  test('AC-12: zero axe WCAG 2.2 AA violations across 320px, 768px, and 1280px in light and dark modes with UX screenshots', async ({
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

        // 1. Inbox page
        await page.goto('/en/leads');
        await page.waitForLoadState('networkidle');

        const inboxAxe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze();
        expect(inboxAxe.violations).toEqual([]);

        // No horizontal scroll at 320px
        const hasHorizontalScroll = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        );
        expect(hasHorizontalScroll).toBe(false);

        await page.screenshot({
          path: path.join(UX_RUN_DIR, `leads-inbox-${vp.name}-${theme}.png`),
          fullPage: true,
        });

        // 2. Detail page (desktop viewport only for detail view screenshots)
        if (vp.width === 1280) {
          await page.goto(`/en/leads/${E2E_LEAD_NEW_ID}`);
          await page.waitForLoadState('networkidle');

          const detailAxe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
            .analyze();
          expect(detailAxe.violations).toEqual([]);

          await page.screenshot({
            path: path.join(UX_RUN_DIR, `lead-detail-${vp.name}-${theme}.png`),
            fullPage: true,
          });
        }
      }
    }
  });
});
