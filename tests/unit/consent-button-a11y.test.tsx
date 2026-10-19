import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';
import { ConsentSection } from '@/components/clients/consent-section';
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

describe('TASK-0049: WCAG 2.2 SC 2.5.3 (Label in Name) for Consent Record Button', () => {
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
        marketing: null,
        imageUsage: null,
        history: [],
      },
    ],
  };

  it('AC-1: in English (en), per-contact record button accessible name contains visible text "Record consent change" verbatim', () => {
    currentLocale = 'en';

    const visualText = enMessages.clients.consent.recordChange;
    expect(visualText).toBe('Record consent change');

    const accessibleName = enMessages.clients.consent.recordChangeFor.replace(
      '{name}',
      'Alice Cooper',
    );
    expect(accessibleName).toContain(visualText);
    expect(accessibleName.startsWith(visualText)).toBe(true);

    const html = renderToStaticMarkup(
      <ConsentSection
        clientId={sampleConsents.clientId}
        locale="en"
        studioTimezone="Europe/Berlin"
        initialConsents={sampleConsents}
        contacts={sampleContacts}
      />,
    );

    // Verify button rendered for Alice Cooper contains aria-label with the visual label verbatim
    expect(html).toContain(
      'data-testid="record-consent-contact-btn-018f0000-0000-7000-8000-000000000001"',
    );
    expect(html).toContain('aria-label="Record consent change for Alice Cooper"');
    expect(html).toContain(`<span>${visualText}</span>`);
  });

  it('AC-2: in German (de), per-contact record button accessible name contains visible text "Einwilligung erfassen" verbatim', () => {
    currentLocale = 'de';

    const visualText = deMessages.clients.consent.recordChange;
    expect(visualText).toBe('Einwilligung erfassen');

    const accessibleName = deMessages.clients.consent.recordChangeFor.replace(
      '{name}',
      'Alice Cooper',
    );
    expect(accessibleName).toContain(visualText);
    expect(accessibleName.startsWith(visualText)).toBe(true);

    const html = renderToStaticMarkup(
      <ConsentSection
        clientId={sampleConsents.clientId}
        locale="de"
        studioTimezone="Europe/Berlin"
        initialConsents={sampleConsents}
        contacts={sampleContacts}
      />,
    );

    // Verify button rendered for Alice Cooper contains aria-label with the visual label verbatim
    expect(html).toContain(
      'data-testid="record-consent-contact-btn-018f0000-0000-7000-8000-000000000001"',
    );
    expect(html).toContain('aria-label="Einwilligung erfassen für Alice Cooper"');
    expect(html).toContain(`<span>${visualText}</span>`);
  });
});
