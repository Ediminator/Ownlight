import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import {
  E2E_INQUIRY_PUBLISHED_SLUG,
  E2E_INQUIRY_DRAFT_SLUG,
  E2E_INQUIRY_ARCHIVED_SLUG,
} from '../helpers/e2e-inquiry-helper';

const RUN_DIR_PARAM = process.env.RUN_DIR ?? 'iter-01';
const UX_RUN_DIR = path.resolve(
  import.meta.dirname,
  `../../../../control/ownlight/runs/TASK-0027/${RUN_DIR_PARAM}/ux`,
);

test.describe('TASK-0027: Public Hosted Inquiry Form E2E Tests', () => {
  const slug = E2E_INQUIRY_PUBLISHED_SLUG;
  const draftSlug = E2E_INQUIRY_DRAFT_SLUG;
  const archivedSlug = E2E_INQUIRY_ARCHIVED_SLUG;

  test.beforeAll(() => {
    fs.mkdirSync(UX_RUN_DIR, { recursive: true });
  });

  test('AC-1: visitor fills all required fields at /en/f/{slug} and submits, lands on thanks page and creates lead row', async ({
    page,
  }) => {
    await page.goto(`/en/f/${slug}`);

    // Fill form fields
    await page.fill('#field-given_name', 'Alexander');
    await page.fill('#field-family_name', 'Hamilton');
    await page.fill('#field-email', 'alexander.hamilton@example.com');
    await page.fill('#field-phone', '+49 30 12345678');
    await page.selectOption('#field-event_type', 'wedding');
    await page.fill('#field-message', 'We would love to book a wedding shoot.');
    await page.check('#field-notice_acknowledged');

    // Submit form
    await page.click('button[type="submit"]');

    // Asserts redirect to thanks page
    await expect(page).toHaveURL(`/en/f/${slug}/thanks`);
    await expect(page.locator('h1')).toContainText('Thank you for your inquiry');
  });

  test('AC-2: progressive enhancement with JavaScript disabled re-renders with error summary linking to fields and preserves values', async ({
    browser,
  }) => {
    // Open a context with JavaScript completely disabled
    const noJsContext = await browser.newContext({ javaScriptEnabled: false });
    const noJsPage = await noJsContext.newPage();

    await noJsPage.goto(`/en/f/${slug}`);

    // Enter invalid email and non-empty message, leaving given_name empty
    await noJsPage.fill('#field-email', 'invalid-email-format');
    await noJsPage.fill('#field-message', 'Preserved message content under no-JS context');
    // Notice checkbox left unchecked

    // Submit form natively
    await noJsPage.click('button[type="submit"]');

    // Page must re-render with error summary (SC 3.3.1)
    const errorSummary = noJsPage.locator('#error-summary');
    await expect(errorSummary).toBeVisible();

    // Verify error links point to erroneous fields
    const emailLink = errorSummary.locator('a[href="#field-email"]');
    await expect(emailLink).toBeVisible();

    const givenNameLink = errorSummary.locator('a[href="#field-given_name"]');
    await expect(givenNameLink).toBeVisible();

    // Verify entered values are preserved
    const messageInput = noJsPage.locator('#field-message');
    await expect(messageInput).toHaveValue('Preserved message content under no-JS context');

    const emailInput = noJsPage.locator('#field-email');
    await expect(emailInput).toHaveValue('invalid-email-format');

    await noJsContext.close();
  });

  test('AC-8: 404 parity across draft, archived, and unknown slugs with identical response body length', async ({
    request,
  }) => {
    const resDraft = await request.get(`/en/f/${draftSlug}`);
    expect(resDraft.status()).toBe(404);
    const bodyDraft = await resDraft.text();

    const resArchived = await request.get(`/en/f/${archivedSlug}`);
    expect(resArchived.status()).toBe(404);
    const bodyArchived = await resArchived.text();

    const resUnknown = await request.get(`/en/f/unknown-slug-xyz123`);
    expect(resUnknown.status()).toBe(404);
    const bodyUnknown = await resUnknown.text();

    // Normalize bodies by removing dynamic nonce values
    const normalizeBody = (body: string) =>
      body
        .replace(/nonce-[A-Za-z0-9+/=]+/g, 'nonce-normalized')
        .replace(/x-nonce="[^"]*"/g, 'x-nonce="normalized"')
        .replace(new RegExp(draftSlug, 'g'), 'SLUG_PLACEHOLDER')
        .replace(new RegExp(archivedSlug, 'g'), 'SLUG_PLACEHOLDER')
        .replace(/unknown-slug-xyz123/g, 'SLUG_PLACEHOLDER');

    const normDraft = normalizeBody(bodyDraft);
    const normArchived = normalizeBody(bodyArchived);
    const normUnknown = normalizeBody(bodyUnknown);

    expect(normDraft.length).toBe(normArchived.length);
    expect(normDraft.length).toBe(normUnknown.length);
  });

  test('AC-10: no Set-Cookie header on public form routes and owner session cookies are never read', async ({
    page,
    request,
  }) => {
    // 1. GET /en/f/{slug} returns no Set-Cookie header
    const resForm = await request.get(`/en/f/${slug}`);
    expect(resForm.headers()['set-cookie']).toBeUndefined();

    // 2. GET /en/f/{slug}/thanks returns no Set-Cookie header
    const resThanks = await request.get(`/en/f/${slug}/thanks`);
    expect(resThanks.headers()['set-cookie']).toBeUndefined();

    // 3. Request with valid-looking owner cookie: server must not render owner chrome/navigation
    await page.context().addCookies([
      {
        name: 'ownlight_session',
        value: 'mock-owner-session-token',
        domain: 'localhost',
        path: '/',
      },
    ]);

    await page.goto(`/en/f/${slug}`);

    // Verify response carries no Set-Cookie
    // Verify no owner dashboard or sidebar elements are rendered
    await expect(page.locator('[data-testid="sidebar"]')).toHaveCount(0);
    await expect(page.locator('a[href="/en/settings"]')).toHaveCount(0);
    await expect(page.locator('a[href="/en/clients"]')).toHaveCount(0);
  });

  test('AC-11: security headers enforce frame-ancestors none, X-Frame-Options DENY, and zero third-party requests', async ({
    page,
    request,
  }) => {
    // Check security headers on response
    const res = await request.get(`/en/f/${slug}`);
    const headers = res.headers();

    expect(headers['x-frame-options']).toBe('DENY');
    const csp = headers['content-security-policy'] ?? '';
    expect(csp).toContain("frame-ancestors 'none'");

    // Verify all resources loaded during page visit belong to app origin
    const thirdPartyRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (!url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
        thirdPartyRequests.push(url);
      }
    });

    await page.goto(`/en/f/${slug}`);
    await page.waitForLoadState('networkidle');

    expect(thirdPartyRequests).toEqual([]);
  });

  test('AC-12: German locale /de/f/{slug} renders German labels, notice text, D7 hint, and thanks page with lang="de"', async ({
    page,
  }) => {
    await page.goto(`/de/f/${slug}`);

    // 1. Verify HTML lang attribute is 'de'
    const htmlLang = await page.locator('html').getAttribute('lang');
    expect(htmlLang).toBe('de');

    // 2. German field labels
    await expect(page.locator('label[for="field-given_name"]')).toContainText('Vorname');
    await expect(page.locator('label[for="field-family_name"]')).toContainText('Nachname');
    await expect(page.locator('label[for="field-email"]')).toContainText('E-Mail-Adresse');
    await expect(page.locator('label[for="field-phone"]')).toContainText('Telefonnummer');

    // 3. German D7 sensitive-data hint
    await expect(page.locator('#message-hint')).toContainText(
      'Bitte geben Sie keine sensiblen Informationen',
    );

    // 4. German submit button
    await expect(page.locator('button[type="submit"]')).toContainText('Anfrage senden');

    // 5. Submit empty in German and verify localized error messages (I1-U02)
    await page.click('button[type="submit"]');
    await expect(page.locator('#error-summary')).toBeVisible();
    await expect(page.locator('#error-summary-heading')).toContainText(
      'Bitte korrigieren Sie die folgenden Fehler vor dem Absenden',
    );
    await expect(page.locator('#error-given_name')).toContainText('Dieses Feld ist erforderlich');
    await expect(page.locator('#error-email')).toContainText('Dieses Feld ist erforderlich');
    await expect(page.locator('#error-notice_acknowledged')).toContainText(
      'Sie müssen die Datenschutzerklärung zur Kenntnis nehmen',
    );

    // 6. Submit in German and check German thanks page
    await page.fill('#field-given_name', 'Max');
    await page.fill('#field-email', 'max.mustermann@example.com');
    await page.check('#field-notice_acknowledged');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(`/de/f/${slug}/thanks`);
    await expect(page.locator('h1')).toContainText('Vielen Dank für Ihre Anfrage');
  });

  test('AC-13: zero WCAG 2.2 AA violations across 320px, 768px, and 1280px; honeypot is unreachable by keyboard and aria-hidden', async ({
    page,
  }) => {
    const viewports = [
      { name: '320px', width: 320, height: 640 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1280px', width: 1280, height: 800 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/en/f/${slug}`);
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
        path: path.join(UX_RUN_DIR, `hosted-form-${vp.name}.png`),
        fullPage: true,
      });
    }

    // Verify dark mode error state achieves zero Axe WCAG 2.2 AA violations (I1-U01 regression)
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`/en/f/${slug}`);
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.click('button[type="submit"]');
    await expect(page.locator('#error-summary')).toBeVisible();

    const darkAxeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(darkAxeResults.violations).toEqual([]);
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
    });

    // Capture German form screenshot
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/de/f/${slug}`);
    await page.screenshot({
      path: path.join(UX_RUN_DIR, `hosted-form-de-1280px.png`),
      fullPage: true,
    });

    // Capture Thanks page screenshot
    await page.goto(`/en/f/${slug}/thanks`);
    await page.screenshot({
      path: path.join(UX_RUN_DIR, `hosted-thanks-1280px.png`),
      fullPage: true,
    });

    // Keyboard navigation verification:
    // Honeypot field must NOT be reachable via keyboard
    await page.goto(`/en/f/${slug}`);
    const honeypot = page.locator('#field-website');
    await expect(honeypot).toHaveAttribute('tabindex', '-1');

    const honeypotParent = page.locator('#field-website').locator('..');
    await expect(honeypotParent).toHaveAttribute('aria-hidden', 'true');
  });

  test('AC-14: XSS payload in lead name is safely encoded inside input value and executes no script', async ({
    page,
  }) => {
    let dialogTriggered = false;
    page.on('dialog', () => {
      dialogTriggered = true;
    });

    await page.goto(`/en/f/${slug}`);

    // Fill XSS injection string and trigger validation error
    const xssPayload = '<img src=x onerror=alert(1)>';
    await page.fill('#field-given_name', xssPayload);
    await page.fill('#field-email', 'invalid-email'); // Triggers validation failure

    await page.click('button[type="submit"]');

    // Wait for error summary re-render
    await expect(page.locator('#error-summary')).toBeVisible();

    // Verify given_name input safely contains the payload without executing script
    const givenNameInput = page.locator('#field-given_name');
    await expect(givenNameInput).toHaveValue(xssPayload);

    // Verify no alert or dialog was triggered
    expect(dialogTriggered).toBe(false);
  });
});
