import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import {
  E2E_INQUIRY_PUBLISHED_SLUG,
  E2E_INQUIRY_PUBLISHED_ID,
} from '../helpers/e2e-inquiry-helper';
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from '../helpers/e2e-global-setup';

const VALID_SETUP_TOKEN =
  process.env.SETUP_TOKEN ?? 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';

const RUN_DIR_PARAM = process.env.RUN_DIR ?? 'iter-01';
const UX_RUN_DIR = path.resolve(
  import.meta.dirname,
  `../../../../control/ownlight/runs/TASK-0028/${RUN_DIR_PARAM}/ux`,
);

async function ensureOwnerSignedIn(page: import('@playwright/test').Page) {
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

test.describe('TASK-0028: Iframe Embed and Share Settings E2E Tests', () => {
  const slug = E2E_INQUIRY_PUBLISHED_SLUG;
  const formId = E2E_INQUIRY_PUBLISHED_ID;

  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test('AC-1 (R-A): GET /{locale}/f/{slug}/embed sets frame-ancestors CSP, omits X-Frame-Options, and renders without app chrome', async ({
    page,
    request,
  }) => {
    const res = await request.get(`/en/f/${slug}/embed`);
    expect(res.status()).toBe(200);

    const headers = res.headers();
    expect(headers['x-frame-options']).toBeUndefined();

    const csp = headers['content-security-policy'] ?? '';
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain('https://photographer.example');

    // Load in browser and verify chromeless rendering
    await page.goto(`/en/f/${slug}/embed`);
    await expect(page.locator('header')).toHaveCount(0);
    await expect(page.locator('[data-testid="sidebar"]')).toHaveCount(0);
    await expect(page.locator('form')).toBeVisible();
    await expect(page.locator('input[name="delivery_mode"]')).toHaveValue('embed');
  });

  test('AC-11: visitor submits form from inside iframe via submitInquiryAction, lands on embed thanks page inside iframe', async ({
    page,
  }) => {
    // Navigate to a parent page and mount an iframe pointing to embed route
    await page.goto('/en');
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>External Photographer Site</title></head>
        <body style="margin: 0; padding: 20px;">
          <h1>Photographer Portfolio</h1>
          <iframe id="inquiry-iframe" src="/en/f/${slug}/embed" width="100%" height="750" frameborder="0"></iframe>
        </body>
      </html>
    `);

    const frame = page.frameLocator('#inquiry-iframe');
    await expect(frame.locator('form')).toBeVisible();

    // Fill form
    await frame.locator('#field-given_name').fill('Elizabeth');
    await frame.locator('#field-family_name').fill('Schuyler');
    await frame.locator('#field-email').fill('elizabeth.schuyler@example.com');
    await frame.locator('#field-phone').fill('+49 30 99887766');
    await frame.locator('#field-notice_acknowledged').check();

    // Submit
    await frame.locator('button[type="submit"]').click();

    // The iframe itself navigates to embed thanks page
    await expect(frame.locator('h1')).toContainText('Thank you for your inquiry');
    await expect(frame.locator('p')).toContainText(
      'Your inquiry has been received. We will get back to you shortly.',
    );

    // Embed thanks page has NO back button or studio header
    await expect(frame.locator('a[href="/"]')).toHaveCount(0);
    await expect(frame.locator('header')).toHaveCount(0);

    // Parent page did not navigate away
    expect(page.url()).not.toContain('/thanks');
  });

  test('AC-12: embed routes set no Set-Cookie header and do not read owner session cookies', async ({
    page,
    request,
  }) => {
    // 1. GET /en/f/{slug}/embed returns no Set-Cookie header
    const resEmbed = await request.get(`/en/f/${slug}/embed`);
    expect(resEmbed.headers()['set-cookie']).toBeUndefined();

    // 2. GET /en/f/{slug}/embed/thanks returns no Set-Cookie header
    const resThanks = await request.get(`/en/f/${slug}/embed/thanks`);
    expect(resThanks.headers()['set-cookie']).toBeUndefined();

    // 3. Request with owner cookie still renders chromeless form
    await page.context().addCookies([
      {
        name: 'ownlight_session',
        value: 'mock-session-cookie',
        domain: 'localhost',
        path: '/',
      },
    ]);

    await page.goto(`/en/f/${slug}/embed`);
    await expect(page.locator('[data-testid="sidebar"]')).toHaveCount(0);
    await expect(page.locator('header')).toHaveCount(0);
  });

  test('AC-13: German locale /de/f/{slug}/embed renders with lang="de", German labels, and German confirmation', async ({
    page,
  }) => {
    await page.goto(`/de/f/${slug}/embed`);

    // Verify HTML lang attribute
    const htmlLang = await page.locator('html').getAttribute('lang');
    expect(htmlLang).toBe('de');

    // German field labels
    await expect(page.locator('label[for="field-given_name"]')).toContainText('Vorname');
    await expect(page.locator('label[for="field-family_name"]')).toContainText('Nachname');
    await expect(page.locator('label[for="field-email"]')).toContainText('E-Mail-Adresse');
    await expect(page.locator('label[for="field-phone"]')).toContainText('Telefonnummer');
    await expect(page.locator('button[type="submit"]')).toContainText('Anfrage senden');

    // Navigate to German thanks page
    await page.goto(`/de/f/${slug}/embed/thanks`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('h1')).toContainText('Vielen Dank für Ihre Anfrage');
  });

  test('AC-10 (R-A): Share & embed panel in form settings displays hosted link, iframe snippet, HTML form snippet, and copy buttons with aria-live', async ({
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await ensureOwnerSignedIn(page);

    await page.goto(`/en/settings/inquiry-forms/${formId}`);
    await expect(page.locator('h1')).toContainText('General Inquiries');

    // Verify Share & embed section
    const shareSection = page.locator('[data-testid="share-embed-section"]');
    await expect(shareSection).toBeVisible();

    // Hosted URL input
    const hostedInput = page.locator('[data-testid="hosted-url-input"]');
    await expect(hostedInput).toBeVisible();
    await expect(hostedInput).toHaveValue(new RegExp(`/en/f/${slug}`));

    // Copy hosted link button
    const copyHostedBtn = page.locator('[data-testid="copy-hosted-link-button"]');
    await expect(copyHostedBtn).toBeVisible();
    await copyHostedBtn.click();
    await expect(
      page.locator('[data-testid="copy-hosted-link-button"] span[role="status"]'),
    ).toContainText('Copied!');

    // Iframe snippet
    const iframeSnippet = page.locator('[data-testid="iframe-snippet-code"]');
    await expect(iframeSnippet).toBeVisible();
    await expect(iframeSnippet).toContainText(`<iframe src=`);
    await expect(iframeSnippet).toContainText(`/en/f/${slug}/embed`);

    // Copy iframe snippet button
    const copyIframeBtn = page.locator('[data-testid="copy-iframe-snippet-button"]');
    await expect(copyIframeBtn).toBeVisible();
    await copyIframeBtn.click();
    await expect(
      page.locator('[data-testid="copy-iframe-snippet-button"] span[role="status"]'),
    ).toContainText('Copied!');

    // Script-free HTML snippet
    const htmlSnippet = page.locator('[data-testid="html-form-snippet-code"]');
    await expect(htmlSnippet).toBeVisible();
    await expect(htmlSnippet).toContainText('<form method="POST"');
    await expect(htmlSnippet).toContainText(`/api/public/forms/${slug}/submissions`);

    // Copy HTML snippet button
    const copyHtmlBtn = page.locator('[data-testid="copy-html-snippet-button"]');
    await expect(copyHtmlBtn).toBeVisible();
    await copyHtmlBtn.click();
    await expect(
      page.locator('[data-testid="copy-html-snippet-button"] span[role="status"]'),
    ).toContainText('Copied!');

    // Capture screenshot of settings share panel for UX review
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'share-embed-settings-1280px.png'),
      fullPage: true,
    });
  });

  test('AC-14: zero WCAG 2.2 AA violations across 320px, 768px, and 1280px viewports and dark/light themes', async ({
    page,
  }) => {
    const viewports = [
      { name: '320px', width: 320, height: 640 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1280px', width: 1280, height: 800 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/en/f/${slug}/embed`);
      await page.waitForLoadState('networkidle');

      // Axe WCAG 2.2 AA scan
      const axeResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      expect(axeResults.violations).toEqual([]);

      // Responsive check: no horizontal scrolling at 320px (SC 1.4.10)
      const hasHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasHorizontalScroll).toBe(false);

      // Capture screenshot for UX review
      await page.screenshot({
        path: path.join(UX_RUN_DIR, `embed-form-${vp.name}.png`),
        fullPage: true,
      });
    }

    // Dark mode check
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`/en/f/${slug}/embed`);
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });

    const darkAxeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(darkAxeResults.violations).toEqual([]);

    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'embed-form-dark-768px.png'),
      fullPage: true,
    });

    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
    });

    // German embed form screenshot
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/de/f/${slug}/embed`);
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'embed-form-de-1280px.png'),
      fullPage: true,
    });

    // Embed thanks screenshot
    await page.goto(`/en/f/${slug}/embed/thanks`);
    await page.screenshot({
      path: path.join(UX_RUN_DIR, 'embed-thanks-1280px.png'),
      fullPage: true,
    });
  });
});
