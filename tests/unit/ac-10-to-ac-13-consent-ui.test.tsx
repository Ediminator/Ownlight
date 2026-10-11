import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import { ConsentSection } from '@/components/clients/consent-section';
import { ConsentDialog } from '@/components/clients/consent-dialog';
import type { ClientConsentsResult } from '@/server/consents/repo';

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

vi.mock('@/server/consents/actions', () => ({
  recordConsentAction: vi.fn(),
  listConsentsAction: vi.fn(),
}));

describe('TASK-0014: Consent UI components (AC-10 to AC-13)', () => {
  const sampleContacts = [
    { id: '018f0000-0000-7000-8000-000000000001', name: 'Alice Cooper', isPrimary: true },
    { id: '018f0000-0000-7000-8000-000000000002', name: 'Bob Cooper', isPrimary: false },
  ];

  const sampleConsents: ClientConsentsResult = {
    clientId: '018f0000-0000-7000-8000-000000000010',
    contacts: [
      {
        contactId: '018f0000-0000-7000-8000-000000000001',
        contactName: 'Alice Cooper',
        isPrimary: true,
        marketing: {
          id: '018f0000-0000-7000-8000-000000000021',
          contactId: '018f0000-0000-7000-8000-000000000001',
          purpose: 'marketing',
          status: 'granted',
          effectiveOn: '2026-10-10',
          method: 'in_person',
          scope: null,
          evidenceNote: 'Paper signed at studio',
          recordedByActorType: 'owner',
          createdAt: new Date('2026-10-10T10:00:00Z'),
        },
        imageUsage: {
          id: '018f0000-0000-7000-8000-000000000022',
          contactId: '018f0000-0000-7000-8000-000000000001',
          purpose: 'image_usage',
          status: 'withdrawn',
          effectiveOn: '2026-10-11',
          method: 'email',
          scope: 'Website portfolio',
          evidenceNote: 'Client email confirmation',
          recordedByActorType: 'owner',
          createdAt: new Date('2026-10-11T12:00:00Z'),
        },
        history: [
          {
            id: '018f0000-0000-7000-8000-000000000022',
            contactId: '018f0000-0000-7000-8000-000000000001',
            purpose: 'image_usage',
            status: 'withdrawn',
            effectiveOn: '2026-10-11',
            method: 'email',
            scope: 'Website portfolio',
            evidenceNote: 'Client email confirmation',
            recordedByActorType: 'owner',
            createdAt: new Date('2026-10-11T12:00:00Z'),
          },
          {
            id: '018f0000-0000-7000-8000-000000000020',
            contactId: '018f0000-0000-7000-8000-000000000001',
            purpose: 'image_usage',
            status: 'granted',
            effectiveOn: '2026-09-01',
            method: 'paper_form',
            scope: 'Website portfolio',
            evidenceNote: 'Paper form 2026-09',
            recordedByActorType: 'owner',
            createdAt: new Date('2026-09-01T10:00:00Z'),
          },
          {
            id: '018f0000-0000-7000-8000-000000000021',
            contactId: '018f0000-0000-7000-8000-000000000001',
            purpose: 'marketing',
            status: 'granted',
            effectiveOn: '2026-10-10',
            method: 'in_person',
            scope: null,
            evidenceNote: 'Paper signed at studio',
            recordedByActorType: 'owner',
            createdAt: new Date('2026-10-10T10:00:00Z'),
          },
        ],
      },
      {
        contactId: '018f0000-0000-7000-8000-000000000002',
        contactName: 'Bob Cooper',
        isPrimary: false,
        marketing: null,
        imageUsage: null,
        history: [],
      },
    ],
  };

  beforeEach(() => {
    currentLocale = 'en';
    vi.clearAllMocks();
  });

  describe('AC-10: Consent section rendering, dialog controls, and status update workflow', () => {
    it('AC-10: renders Consent section heading (h2), contacts cards, and record change triggers', () => {
      const html = renderToStaticMarkup(
        <ConsentSection
          clientId={sampleConsents.clientId}
          locale="en"
          studioTimezone="Europe/Berlin"
          initialConsents={sampleConsents}
          contacts={sampleContacts}
        />,
      );

      // Section heading is h2 with id consent-heading
      expect(html).toContain('<h2 id="consent-heading"');
      expect(html).toContain('Consent</h2>');

      // Top record change button present
      expect(html).toContain('data-testid="record-consent-btn"');
      expect(html).toContain('Record consent change');

      // Primary badge on Alice
      expect(html).toContain('Alice Cooper');
      expect(html).toContain('Primary');

      // Bob Cooper present
      expect(html).toContain('Bob Cooper');

      // Per-contact record change button
      expect(html).toContain(
        'data-testid="record-consent-contact-btn-018f0000-0000-7000-8000-000000000001"',
      );
      expect(html).toContain(
        'data-testid="record-consent-contact-btn-018f0000-0000-7000-8000-000000000002"',
      );

      // Marketing granted status for Alice
      expect(html).toContain(
        'data-testid="consent-status-018f0000-0000-7000-8000-000000000001-marketing"',
      );
      expect(html).toContain('Granted on October 10, 2026 · In person');

      // Image usage withdrawn status for Alice
      expect(html).toContain(
        'data-testid="consent-status-018f0000-0000-7000-8000-000000000001-image_usage"',
      );
      expect(html).toContain('Withdrawn on October 11, 2026 · Email');

      // Bob has no consent recorded
      expect(html).toContain(
        'data-testid="consent-status-018f0000-0000-7000-8000-000000000002-marketing"',
      );
      expect(html).toContain('No consent recorded');
      expect(html).toContain(
        'data-testid="consent-status-018f0000-0000-7000-8000-000000000002-image_usage"',
      );

      // History toggle buttons exist with count
      expect(html).toContain(
        'data-testid="consent-history-toggle-018f0000-0000-7000-8000-000000000001"',
      );
      expect(html).toContain('Show history (3)');
      expect(html).toContain(
        'data-testid="consent-history-toggle-018f0000-0000-7000-8000-000000000002"',
      );
      expect(html).toContain('Show history (0)');
    });

    it('AC-10: ConsentDialog renders all required fields, contact selector, dates, methods, scope, evidence note, and buttons', () => {
      const html = renderToStaticMarkup(
        <ConsentDialog
          clientId={sampleConsents.clientId}
          contacts={sampleContacts}
          initialContactId={sampleContacts[0]?.id}
          studioTimezone="Europe/Berlin"
          isOpen={true}
          onOpenChange={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      // Dialog title and description
      expect(html).toContain('Record consent change');
      expect(html).toContain('Record offline consent granted or withdrawn for a contact.');

      // Contact selector for multiple contacts
      expect(html).toContain('data-testid="consent-contact-select"');
      expect(html).toContain('Alice Cooper</option>');
      expect(html).toContain('Bob Cooper</option>');

      // Purpose radio buttons
      expect(html).toContain('data-testid="consent-purpose-marketing"');
      expect(html).toContain('data-testid="consent-purpose-image-usage"');

      // Status radio buttons
      expect(html).toContain('data-testid="consent-status-granted"');
      expect(html).toContain('data-testid="consent-status-withdrawn"');

      // Effective on date input with max constraint
      expect(html).toContain('data-testid="consent-effective-on-input"');
      expect(html).toContain('type="date"');
      expect(html).toMatch(/max="\d{4}-\d{2}-\d{2}"/);

      // Method selector with all 5 methods
      expect(html).toContain('data-testid="consent-method-select"');
      expect(html).toContain('value="in_person"');
      expect(html).toContain('value="paper_form"');
      expect(html).toContain('value="email"');
      expect(html).toContain('value="phone"');
      expect(html).toContain('value="other"');

      // Scope and Evidence note inputs with max length 500
      expect(html).toContain('data-testid="consent-scope-input"');
      expect(html).toContain('maxLength="500"');
      expect(html).toContain('data-testid="consent-evidence-input"');

      // Action buttons
      expect(html).toContain('data-testid="consent-dialog-cancel-btn"');
      expect(html).toContain('data-testid="consent-dialog-submit-btn"');
      expect(html).toContain('Save record');
    });

    it('AC-10: single contact renders read-only display instead of dropdown select', () => {
      const html = renderToStaticMarkup(
        <ConsentDialog
          clientId={sampleConsents.clientId}
          contacts={sampleContacts.slice(0, 1)}
          studioTimezone="Europe/Berlin"
          isOpen={true}
          onOpenChange={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      expect(html).not.toContain('data-testid="consent-contact-select"');
      expect(html).toContain('id="consent-contact-display"');
      expect(html).toContain('value="Alice Cooper"');
      expect(html).toContain('readOnly=""');
    });
  });

  describe('AC-11: German localization (de.json) and date formatting', () => {
    beforeEach(() => {
      currentLocale = 'de';
    });

    it('AC-11: renders German strings for titles, purposes, statuses, and methods in ConsentSection', () => {
      const html = renderToStaticMarkup(
        <ConsentSection
          clientId={sampleConsents.clientId}
          locale="de"
          studioTimezone="Europe/Berlin"
          initialConsents={sampleConsents}
          contacts={sampleContacts}
        />,
      );

      // Section heading in German
      expect(html).toContain('Einwilligung</h2>');
      expect(html).toContain('Einwilligung erfassen');

      // Purposes in German
      expect(html).toContain('Werbeeinwilligung');
      expect(html).toContain('Einwilligung zur Bildnutzung');

      // Status text and German date format
      // In de, October is Oktober
      expect(html).toContain('Erteilt am');
      expect(html).toContain('Oktober 2026');
      expect(html).toContain('Persönlich');

      // Image usage status
      expect(html).toContain('Widerrufen am');
      expect(html).toContain('E-Mail');

      // Empty consent in German
      expect(html).toContain('Keine Einwilligung erfasst');

      // History button in German
      expect(html).toContain('Verlauf anzeigen (3)');
      expect(html).toContain('Verlauf anzeigen (0)');
    });

    it('AC-11: renders German strings in ConsentDialog', () => {
      const html = renderToStaticMarkup(
        <ConsentDialog
          clientId={sampleConsents.clientId}
          contacts={sampleContacts}
          studioTimezone="Europe/Berlin"
          isOpen={true}
          onOpenChange={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      expect(html).toContain('Einwilligung erfassen');
      expect(html).toContain(
        'Erfassen Sie eine erteilte oder widerrufene Einwilligung eines Kontakts.',
      );
      expect(html).toContain('Kontakt');
      expect(html).toContain('Zweck');
      expect(html).toContain('Status');
      expect(html).toContain('Erteilt');
      expect(html).toContain('Widerrufen');
      expect(html).toContain('Gültigkeitsdatum');
      expect(html).toContain('Art der Einholung');
      expect(html).toContain('Umfang der Vereinbarung');
      expect(html).toContain('Nachweis-Notiz');
      expect(html).toContain('Abbrechen');
      expect(html).toContain('Eintrag speichern');
    });
  });

  describe('AC-12: Accessibility and non-color-alone status indicators (WCAG 2.2 AA / SC 1.4.1)', () => {
    it('AC-12: status is conveyed via clear text label, not by color alone', () => {
      const html = renderToStaticMarkup(
        <ConsentSection
          clientId={sampleConsents.clientId}
          locale="en"
          studioTimezone="Europe/Berlin"
          initialConsents={sampleConsents}
          contacts={sampleContacts}
        />,
      );

      // Verify that status text contains explicit wording
      const marketingMatch =
        /data-testid="consent-status-018f0000-0000-7000-8000-000000000001-marketing"[^>]*>([^<]+)</.exec(
          html,
        );
      expect(marketingMatch?.[1]).toContain('Granted on');

      const imageMatch =
        /data-testid="consent-status-018f0000-0000-7000-8000-000000000001-image_usage"[^>]*>([^<]+)</.exec(
          html,
        );
      expect(imageMatch?.[1]).toContain('Withdrawn on');

      const bobMatch =
        /data-testid="consent-status-018f0000-0000-7000-8000-000000000002-marketing"[^>]*>([^<]+)</.exec(
          html,
        );
      expect(bobMatch?.[1]).toContain('No consent recorded');
    });

    it('AC-12: ConsentDialog has accessible dialog description and form controls are properly labelled', () => {
      const html = renderToStaticMarkup(
        <ConsentDialog
          clientId={sampleConsents.clientId}
          contacts={sampleContacts}
          studioTimezone="Europe/Berlin"
          isOpen={true}
          onOpenChange={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      // Accessible description referenced by aria-describedby
      expect(html).toContain('aria-describedby="consent-dialog-desc"');
      expect(html).toContain('id="consent-dialog-desc"');

      // Labels match input ids
      expect(html).toContain('for="consent-contact-select"');
      expect(html).toContain('id="consent-contact-select"');

      expect(html).toContain('for="purpose-marketing"');
      expect(html).toContain('id="purpose-marketing"');

      expect(html).toContain('for="purpose-image-usage"');
      expect(html).toContain('id="purpose-image-usage"');

      expect(html).toContain('for="status-granted"');
      expect(html).toContain('id="status-granted"');

      expect(html).toContain('for="status-withdrawn"');
      expect(html).toContain('id="status-withdrawn"');

      expect(html).toContain('for="consent-effective-on"');
      expect(html).toContain('id="consent-effective-on"');

      expect(html).toContain('for="consent-method-select"');
      expect(html).toContain('id="consent-method-select"');

      expect(html).toContain('for="consent-scope-input"');
      expect(html).toContain('id="consent-scope-input"');

      expect(html).toContain('for="consent-evidence-input"');
      expect(html).toContain('id="consent-evidence-input"');
    });

    it('AC-12: buttons have accessible names for screen readers', () => {
      const html = renderToStaticMarkup(
        <ConsentSection
          clientId={sampleConsents.clientId}
          locale="en"
          studioTimezone="Europe/Berlin"
          initialConsents={sampleConsents}
          contacts={sampleContacts}
        />,
      );

      expect(html).toContain('aria-label="Record consent change for Alice Cooper"');
      expect(html).toContain('aria-label="Record consent change for Bob Cooper"');
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain(
        'aria-controls="consent-history-018f0000-0000-7000-8000-000000000001"',
      );
    });
  });

  describe('AC-13: Touch targets (>= 24x24 px), fieldset/legend grouping (SC 1.3.1), and 320px responsive compatibility', () => {
    it('AC-13: radio groups are wrapped in fieldset with legend', () => {
      const html = renderToStaticMarkup(
        <ConsentDialog
          clientId={sampleConsents.clientId}
          contacts={sampleContacts}
          studioTimezone="Europe/Berlin"
          isOpen={true}
          onOpenChange={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      // Purpose fieldset and legend
      expect(html).toMatch(/<fieldset[^>]*>[\s\S]*?<legend[^>]*>[\s\S]*?Purpose[\s\S]*?<\/legend>/);

      // Status fieldset and legend
      expect(html).toMatch(/<fieldset[^>]*>[\s\S]*?<legend[^>]*>[\s\S]*?Status[\s\S]*?<\/legend>/);
    });

    it('AC-13: interactive controls have minimum touch target dimensions >= 24x24 px', () => {
      const htmlSection = renderToStaticMarkup(
        <ConsentSection
          clientId={sampleConsents.clientId}
          locale="en"
          studioTimezone="Europe/Berlin"
          initialConsents={sampleConsents}
          contacts={sampleContacts}
        />,
      );

      // Action buttons have min-h >= 24px (e.g. min-h-[36px], min-h-[32px], min-h-[28px])
      expect(htmlSection).toContain('min-h-[36px]');
      expect(htmlSection).toContain('min-h-[32px]');
      expect(htmlSection).toContain('min-h-[28px]');

      const htmlDialog = renderToStaticMarkup(
        <ConsentDialog
          clientId={sampleConsents.clientId}
          contacts={sampleContacts}
          studioTimezone="Europe/Berlin"
          isOpen={true}
          onOpenChange={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      // Form inputs and buttons in dialog have min-h-[44px]
      expect(htmlDialog).toContain('min-h-[44px]');
    });

    it('AC-13: responsive markup avoids fixed overflow styles exceeding 320px', () => {
      const htmlSection = renderToStaticMarkup(
        <ConsentSection
          clientId={sampleConsents.clientId}
          locale="en"
          studioTimezone="Europe/Berlin"
          initialConsents={sampleConsents}
          contacts={sampleContacts}
        />,
      );

      // Verify no hardcoded fixed width over 320px
      expect(htmlSection).not.toMatch(/width:\s*[3-9]\d{2,}px/);
      expect(htmlSection).not.toMatch(/w-\[[3-9]\d{2,}px\]/);
    });
  });

  describe('AC-10: ConsentDialog focus management', () => {
    it('AC-10: focus returns to trigger on dialog close via onCloseAutoFocus', () => {
      const triggerButton = { focus: vi.fn() };
      const triggerRef = { current: triggerButton as unknown as HTMLElement };

      const tree = ConsentDialog({
        clientId: sampleConsents.clientId,
        contacts: sampleContacts,
        studioTimezone: 'Europe/Berlin',
        isOpen: true,
        onOpenChange: vi.fn(),
        triggerRef,
        onSuccess: vi.fn(),
      });

      interface DialogElementProps {
        children: {
          props: {
            onCloseAutoFocus?: (e: { preventDefault: () => void }) => void;
          };
        };
      }

      const dialogContent = (tree as React.ReactElement<DialogElementProps>).props.children;
      expect(dialogContent).toBeDefined();

      const onCloseAutoFocus = dialogContent.props.onCloseAutoFocus;
      expect(typeof onCloseAutoFocus).toBe('function');

      const preventDefault = vi.fn();
      onCloseAutoFocus?.({ preventDefault });

      expect(preventDefault).toHaveBeenCalled();
      expect(triggerButton.focus).toHaveBeenCalled();
    });
  });
});
