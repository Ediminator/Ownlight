import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { generateHtmlExport, escapeHtml } from '@/server/privacy/export/html';
import type { ExportCollectedData } from '@/server/privacy/export/types';

describe('TASK-0015: DSAR HTML export generator (AC-2, AC-11)', () => {
  const sampleExportData: ExportCollectedData = {
    schema: 'ownlight.dsar.v1',
    generated_at: '2026-10-11T12:00:00.000Z',
    studio: {
      name: 'Lumière Photo Studio',
    },
    subject: {
      id: 'c0000000-0000-4000-8000-000000000001',
      display_name: 'Jane Doe',
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      phone: '+49 151 12345678',
      role: 'primary',
      created_at: '2026-01-15T09:30:00.000Z',
      updated_at: '2026-03-20T14:15:00.000Z',
    },
    categories: {
      client: [
        {
          display_name: 'Jane Doe',
          kind: 'person',
          preferred_language: 'de',
          created_at: '2026-01-15T09:30:00.000Z',
          last_activity_at: '2026-03-20T14:15:00.000Z',
        },
      ],
      addresses: [
        {
          type: 'postal',
          street: 'Musterstraße 42',
          postal_code: '10115',
          city: 'Berlin',
          country: 'DE',
        },
      ],
      tags: [{ name: 'hochzeit' }],
      notes: [
        {
          id: 'n0000000-0000-4000-8000-000000000001',
          body: '<img src=x onerror=alert(1)>',
          created_at: '2026-02-01T10:00:00.000Z',
        },
        {
          id: 'n0000000-0000-4000-8000-000000000002',
          body: '<script>alert("xss")</script>',
          created_at: '2026-02-02T10:00:00.000Z',
        },
      ],
      timeline: [
        {
          type: 'client.created',
          occurred_at: '2026-01-15T09:30:00.000Z',
          actor_type: 'user',
          data: {},
        },
      ],
      consents: [
        {
          purpose: 'marketing',
          status: 'granted',
          effective_on: '2026-01-15',
          method: 'form',
          scope: null,
        },
      ],
      audit: [
        {
          action: 'client.updated',
          occurred_at: '2026-03-20T14:15:00.000Z',
          outcome: 'success',
        },
      ],
    },
  };

  it('AC-2: generates German document with Art. 15(1) disclosures when locale is de', () => {
    const html = generateHtmlExport(sampleExportData, 'de');

    // Root html element has lang="de"
    expect(html).toContain('<html lang="de">');

    // Title and headings in German
    expect(html).toContain('Datenauskunft (Art. 15 DSGVO / CCPA)');
    expect(html).toContain('Lumière Photo Studio');
    expect(html).toContain('Jane Doe');

    // Art. 15(1) Disclosures per category
    expect(html).toContain('Verarbeitungszweck');
    expect(html).toContain('Rechtsgrundlage');
    expect(html).toContain('Speicherdauer');

    // Art. 15(1) General disclosures
    expect(html).toContain('Empfänger');
    expect(html).toContain('Datenherkunft');
    expect(html).toContain('Ihre Rechte als betroffene Person');
    expect(html).toContain('Recht auf Berichtigung (Art. 16 DSGVO)');
    expect(html).toContain('Recht auf Löschung / „Recht auf Vergessenwerden“ (Art. 17 DSGVO)');
    expect(html).toContain('Recht auf Einschränkung der Verarbeitung (Art. 18 DSGVO)');
    expect(html).toContain('Recht auf Datenübertragbarkeit (Art. 20 DSGVO)');
    expect(html).toContain('Widerspruchsrecht (Art. 21 DSGVO)');
    expect(html).toContain('Beschwerderecht bei einer Aufsichtsbehörde (Art. 77 DSGVO)');
  });

  it('AC-2: escapes malicious input like <img src=x onerror=alert(1)> and <script>', () => {
    const html = generateHtmlExport(sampleExportData, 'de');

    // Malicious tags must be strictly HTML-escaped
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');

    // Dangerous unescaped constructs must NOT exist in the document
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>alert("xss")</script>');
  });

  it('AC-2: contains no <script> element, no inline event handlers, and no http/https resource URLs', () => {
    const html = generateHtmlExport(sampleExportData, 'de');

    // No <script> tags anywhere
    expect(html).not.toMatch(/<script\b/i);

    // No inline event handlers on any HTML element (e.g. <tag onclick=...>)
    expect(html).not.toMatch(/<[a-zA-Z0-9_-]+[^>]*\s+on[a-zA-Z]+\s*=/i);

    // No external http:// or https:// resource links (no fonts, no images, no CDN stylesheets)
    expect(html).not.toMatch(/(src|href|url)\s*=\s*['"]?https?:\/\//i);
  });

  it('AC-11: generated HTML document has title, heading hierarchy, and data tables with scope="col"', () => {
    const html = generateHtmlExport(sampleExportData, 'en');

    expect(html).toContain('<html lang="en">');
    expect(html).toContain(
      '<title>Personal Data Export (GDPR Art. 15 / CCPA) – Jane Doe · Lumière Photo Studio</title>',
    );

    // Heading hierarchy: h1 -> h2 -> h3
    expect(html).toContain('<h1');
    expect(html).toContain('<h2');
    expect(html).toContain('<h3');

    // Accessible tables with <th scope="col">
    expect(html).toContain('<th scope="col">');
  });

  it('escapeHtml unit tests correctly encode HTML special characters and handle edge cases', () => {
    expect(escapeHtml('<div class="test">&\'</div>')).toBe(
      '&lt;div class=&quot;test&quot;&gt;&amp;&#39;&lt;/div&gt;',
    );
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(12345)).toBe('12345');
    expect(escapeHtml(true)).toBe('true');
    expect(escapeHtml(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00.000Z');
  });
});
