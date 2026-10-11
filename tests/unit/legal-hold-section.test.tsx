import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  LegalHoldSection,
  isHoldActiveDate,
  type ClientLegalHoldData,
} from '@/components/clients/legal-hold-section';
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

function getNestedValue(obj: unknown, path: string): unknown {
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
  useLocale: () => currentLocale,
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

vi.mock('server-only', () => ({}));

vi.mock('@/server/clients/legal-hold-actions', () => ({
  setLegalHoldAction: vi.fn(),
  releaseLegalHoldAction: vi.fn(),
}));

describe('TASK-0019: LegalHoldSection Component (AC-17, AC-18)', () => {
  beforeEach(() => {
    currentLocale = 'en';
  });

  describe('isHoldActiveDate helper', () => {
    it('returns true when until is null or undefined (indefinite hold)', () => {
      expect(isHoldActiveDate(null)).toBe(true);
      expect(isHoldActiveDate(undefined)).toBe(true);
    });

    it('returns true when until is in the future in studio timezone', () => {
      const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      expect(isHoldActiveDate(future, 'Europe/Berlin')).toBe(true);
    });

    it('returns false when until is in the past in studio timezone', () => {
      expect(isHoldActiveDate('2020-01-01', 'Europe/Berlin')).toBe(false);
    });
  });

  it('AC-17: renders switch with role="switch" and aria-checked="false" when no hold is active', () => {
    const html = renderToStaticMarkup(
      <LegalHoldSection
        clientId="018f0000-0000-7000-8000-000000000001"
        studioTimezone="Europe/Berlin"
        locale="en"
      />,
    );

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('Legal hold');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
  });

  it('AC-17: renders active hold with reason, dates, Edit and Release buttons, and switch aria-checked="true"', () => {
    const activeHold: ClientLegalHoldData = {
      id: '018f0000-0000-7000-8000-000000000010',
      clientId: '018f0000-0000-7000-8000-000000000001',
      reason: 'dispute',
      note: 'Pending contract dispute',
      until: '2028-12-31',
      setByActorType: 'owner',
      setByActorId: '018f0000-0000-7000-8000-000000000099',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    };

    const html = renderToStaticMarkup(
      <LegalHoldSection
        clientId="018f0000-0000-7000-8000-000000000001"
        initialHold={activeHold}
        studioTimezone="Europe/Berlin"
        locale="en"
      />,
    );

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('Dispute resolution');
    expect(html).toContain('Pending contract dispute');
    expect(html).toContain('Edit hold');
    expect(html).toContain('Release hold');
    expect(html).toContain('data-testid="edit-legal-hold-btn"');
    expect(html).toContain('data-testid="release-legal-hold-btn"');
  });

  it('AC-17: renders expired hold status when until date is in the past', () => {
    const expiredHold: ClientLegalHoldData = {
      id: '018f0000-0000-7000-8000-000000000011',
      clientId: '018f0000-0000-7000-8000-000000000001',
      reason: 'statutory',
      note: null,
      until: '2024-01-01',
      setByActorType: 'owner',
      setByActorId: '018f0000-0000-7000-8000-000000000099',
      createdAt: '2023-01-01T10:00:00Z',
      updatedAt: '2023-01-01T10:00:00Z',
    };

    const html = renderToStaticMarkup(
      <LegalHoldSection
        clientId="018f0000-0000-7000-8000-000000000001"
        initialHold={expiredHold}
        studioTimezone="Europe/Berlin"
        locale="en"
      />,
    );

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('Expired');
    expect(html).toContain('Statutory requirement');
    expect(html).toContain('Release hold');
  });

  it('AC-18: renders strings and German labels when locale is de', () => {
    currentLocale = 'de';
    const activeHold: ClientLegalHoldData = {
      id: '018f0000-0000-7000-8000-000000000012',
      clientId: '018f0000-0000-7000-8000-000000000001',
      reason: 'dispute',
      note: 'Rechtsstreit',
      until: '2028-12-31',
      setByActorType: 'owner',
      setByActorId: '018f0000-0000-7000-8000-000000000099',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    };

    const html = renderToStaticMarkup(
      <LegalHoldSection
        clientId="018f0000-0000-7000-8000-000000000001"
        initialHold={activeHold}
        studioTimezone="Europe/Berlin"
        locale="de"
      />,
    );

    expect(html).toContain('Löschsperre');
    expect(html).toContain('Rechtsstreit');
    expect(html).toContain('Löschsperre bearbeiten');
    expect(html).toContain('Löschsperre aufheben');
  });
});
