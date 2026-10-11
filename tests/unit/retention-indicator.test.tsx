import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RetentionIndicator } from '@/components/clients/retention-indicator';
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

describe('TASK-0019: RetentionIndicator (AC-18, AC-20)', () => {
  beforeEach(() => {
    currentLocale = 'en';
  });

  it('AC-20: displays scheduled automatic erasure date when no active hold is in place', () => {
    // Activity 12 months ago with 36-month retention -> scheduled in 24 months
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);

    const html = renderToStaticMarkup(
      <RetentionIndicator
        lastActivityAt={twelveMonthsAgo}
        hasActiveHold={false}
        retentionMonths={36}
        locale="en"
      />,
    );

    expect(html).toContain('Data retention');
    expect(html).toContain('Scheduled for automatic erasure on');
    expect(html).not.toContain('Automatic erasure is paused by an active legal hold');
  });

  it('AC-20: displays paused status when client has an active legal hold', () => {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);

    const html = renderToStaticMarkup(
      <RetentionIndicator
        lastActivityAt={twelveMonthsAgo}
        hasActiveHold={true}
        retentionMonths={36}
        locale="en"
      />,
    );

    expect(html).toContain('Data retention');
    expect(html).toContain('Automatic erasure is paused by an active legal hold');
    expect(html).not.toContain('Scheduled for automatic erasure on');
  });

  it('AC-20: displays pending automatic erasure when client is past the retention cutoff without a hold', () => {
    // Activity 40 months ago with 36-month retention -> past cutoff
    const now = new Date();
    const fortyMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 40, 1);

    const html = renderToStaticMarkup(
      <RetentionIndicator
        lastActivityAt={fortyMonthsAgo}
        hasActiveHold={false}
        retentionMonths={36}
        locale="en"
      />,
    );

    expect(html).toContain('Pending automatic erasure');
  });

  it('AC-18: renders retention indicator correctly in German (de)', () => {
    currentLocale = 'de';
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);

    // Active hold in German
    const htmlHold = renderToStaticMarkup(
      <RetentionIndicator
        lastActivityAt={twelveMonthsAgo}
        hasActiveHold={true}
        retentionMonths={36}
        locale="de"
      />,
    );
    expect(htmlHold).toContain('Datenaufbewahrung');
    expect(htmlHold).toContain('Automatische Löschung ist durch eine aktive Löschsperre pausiert');

    // Scheduled erasure in German
    const htmlScheduled = renderToStaticMarkup(
      <RetentionIndicator
        lastActivityAt={twelveMonthsAgo}
        hasActiveHold={false}
        retentionMonths={36}
        locale="de"
      />,
    );
    expect(htmlScheduled).toContain('Automatische Löschung am');
    expect(htmlScheduled).toContain('ohne weitere Aktivitäten geplant');
  });
});
