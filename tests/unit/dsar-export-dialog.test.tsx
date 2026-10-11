import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="mock-dialog">{children}</div> : null,
  DialogContent: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <div data-testid="mock-dialog-content" {...props}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
  DialogDescription: ({
    children,
    id,
    className,
  }: {
    children: React.ReactNode;
    id?: string;
    className?: string;
  }) => (
    <p id={id} className={className}>
      {children}
    </p>
  ),
  DialogFooter: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <footer className={className}>{children}</footer>
  ),
}));

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = Reflect.get(current, part);
    } else {
      return undefined;
    }
  }
  return current;
}

let currentLocale: 'en' | 'de' = 'en';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => {
    return (key: string, values?: Record<string, unknown>) => {
      const messages = currentLocale === 'de' ? deMessages : enMessages;
      const fullPath = namespace ? `${namespace}.${key}` : key;
      const raw = getNestedValue(messages, fullPath);
      let text = typeof raw === 'string' ? raw : `[${fullPath}]`;
      if (values) {
        for (const [vKey, vVal] of Object.entries(values)) {
          text = text.replace(new RegExp(`\\{${vKey}\\}`, 'g'), String(vVal));
        }
      }
      return text;
    };
  },
}));

import { ExportDataDialog } from '@/components/clients/export-data-dialog';

describe('TASK-0015: ExportDataDialog component (AC-9, AC-10, AC-11, AC-12)', () => {
  const mockContact = {
    id: 'c0000000-0000-4000-8000-000000000001',
    givenName: 'Jane',
    familyName: 'Doe',
  };

  beforeEach(() => {
    currentLocale = 'en';
  });

  it('AC-9: renders export dialog with Art. 15(4) review notice and format choices in English', () => {
    const html = renderToStaticMarkup(
      <ExportDataDialog
        contact={mockContact}
        clientDisplayName="Jane Doe"
        preferredLocale="en"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    // Dialog title with contact name
    expect(html).toContain('Export personal data');
    expect(html).toContain('Jane Doe');

    // Art. 15(4) review notice
    expect(html).toContain('Third-party data review required (Art. 15(4) GDPR)');
    expect(html).toContain(
      'Before delivering this export to the data subject, carefully review the contents for third-party personal data',
    );

    // Format choices
    expect(html).toContain('Machine-readable data (JSON)');
    expect(html).toContain('Printable document (HTML)');
    expect(html).toContain('data-testid="export-format-html-btn"');
    expect(html).toContain('data-testid="export-format-json-btn"');

    // Action buttons
    expect(html).toContain('Generate and download');
    expect(html).toContain('Cancel');
  });

  it('AC-10: renders export dialog in German with all strings sourced from de.json', () => {
    currentLocale = 'de';
    const html = renderToStaticMarkup(
      <ExportDataDialog
        contact={mockContact}
        clientDisplayName="Jane Doe"
        preferredLocale="de"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    // German strings from de.json
    expect(html).toContain('Personenbezogene Daten exportieren');
    expect(html).toContain('Prüfung auf Drittpersonendaten erforderlich (Art. 15 Abs. 4 DSGVO)');
    expect(html).toContain(
      'Bevor Sie diesen Export an die betroffene Person weiterleiten, prüfen Sie bitte enthaltene Notizen',
    );
    expect(html).toContain('Maschinenlesbare Daten (JSON)');
    expect(html).toContain('Druckbares Dokument (HTML)');
    expect(html).toContain('Erstellen und herunterladen');
    expect(html).toContain('Abbrechen');

    // Ensure no fallback bracket strings like [privacy.export...]
    expect(html).not.toMatch(/\[privacy\.export\./);
  });

  it('AC-11 & AC-12: ensures accessible form markup and mobile touch targets >= 24px', () => {
    const html = renderToStaticMarkup(
      <ExportDataDialog
        contact={mockContact}
        clientDisplayName="Jane Doe"
        preferredLocale="en"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    // Form controls are properly associated with labels
    expect(html).toContain('for="export-locale-select"');
    expect(html).toContain('id="export-locale-select"');

    // Interactive button targets meet WCAG 2.2 AA target size (>= 24px, min-h-[40px] and min-h-[56px])
    expect(html).toContain('min-h-[56px]');
    expect(html).toContain('min-h-[40px]');

    // Responsive container classes preventing horizontal scroll at 320px
    expect(html).toContain('max-w-md');
    expect(html).toContain('w-full');
  });

  it('AC-9: renders nothing when open is false', () => {
    const html = renderToStaticMarkup(
      <ExportDataDialog
        contact={mockContact}
        clientDisplayName="Jane Doe"
        preferredLocale="en"
        open={false}
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toBe('');
  });
});
