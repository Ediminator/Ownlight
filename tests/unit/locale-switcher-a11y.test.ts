import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

let currentMockLocale: 'en' | 'de' = 'en';
const mockReplace = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => currentMockLocale,
  useTranslations: (namespace?: string) => {
    return (key: string) => {
      if (namespace === 'locale') {
        if (currentMockLocale === 'en') {
          if (key === 'switcher') return 'Switch language';
          if (key === 'en') return 'English';
          if (key === 'de') return 'Deutsch';
        } else {
          if (key === 'switcher') return 'Sprache wechseln';
          if (key === 'en') return 'English';
          if (key === 'de') return 'Deutsch';
        }
      }
      return `${String(namespace)}.${key}`;
    };
  },
}));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/projects',
  useRouter: () => ({
    replace: mockReplace,
    push: vi.fn(),
  }),
}));

import { LocaleSwitcher } from '@/components/i18n/locale-switcher';

describe('TASK-0048: LocaleSwitcher WCAG 2.2 SC 2.5.3 (Label in Name) A11y', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentMockLocale = 'en';
  });

  it('matches message catalogue definitions for locale switcher', () => {
    expect(enMessages.locale.switcher).toBe('Switch language');
    expect(deMessages.locale.switcher).toBe('Sprache wechseln');
  });

  it('AC-1: when rendered in English (en), trigger button accessible name contains visual text "EN"', () => {
    currentMockLocale = 'en';
    const html = renderToStaticMarkup(React.createElement(LocaleSwitcher));

    // The button must have data-testid="locale-switcher-trigger"
    expect(html).toContain('data-testid="locale-switcher-trigger"');

    // Extract aria-label from the trigger button
    const ariaLabelMatch = /aria-label="([^"]+)"/.exec(html);
    expect(ariaLabelMatch).not.toBeNull();
    const ariaLabel = ariaLabelMatch?.[1] ?? '';

    // The visible text displayed in the button
    const visibleText = 'EN';

    // Must match expected accessible name format containing visible text
    expect(ariaLabel).toBe('Switch language, EN');

    // Strict WCAG 2.5.3 check: accessible name must contain visible text
    expect(ariaLabel.toUpperCase()).toContain(visibleText);
  });

  it('AC-2: when rendered in German (de), trigger button accessible name contains visual text "DE"', () => {
    currentMockLocale = 'de';
    const html = renderToStaticMarkup(React.createElement(LocaleSwitcher));

    expect(html).toContain('data-testid="locale-switcher-trigger"');

    const ariaLabelMatch = /aria-label="([^"]+)"/.exec(html);
    expect(ariaLabelMatch).not.toBeNull();
    const ariaLabel = ariaLabelMatch?.[1] ?? '';

    const visibleText = 'DE';

    // Must match expected accessible name format containing visible text
    expect(ariaLabel).toBe('Sprache wechseln, DE');

    // Strict WCAG 2.5.3 check: accessible name must contain visible text
    expect(ariaLabel.toUpperCase()).toContain(visibleText);
  });

  it('Regression check: verifies old label without visible text fails WCAG 2.5.3 Label in Name invariant', () => {
    const oldEnglishLabel = 'Switch language';
    const oldGermanLabel = 'Sprache wechseln';

    // The old labels did not contain the visible text "EN" or "DE"
    expect(oldEnglishLabel.toUpperCase().includes('EN')).toBe(false);
    expect(oldGermanLabel.toUpperCase().includes('DE')).toBe(false);
  });

  it('preserves functional locale switching and sets compliant cookie', () => {
    let cookieStore = '';
    Object.defineProperty(globalThis, 'document', {
      value: {
        get cookie() {
          return cookieStore;
        },
        set cookie(val: string) {
          cookieStore = val;
        },
      },
      writable: true,
      configurable: true,
    });

    currentMockLocale = 'en';
    const switcherEl = LocaleSwitcher() as React.ReactElement<{
      children: [
        unknown,
        React.ReactElement<{
          children: React.ReactElement<{ onClick: () => void }>[];
        }>,
      ];
    }>;
    const content = switcherEl.props.children[1];
    const [itemEn, itemDe] = content.props.children;
    if (!itemEn || !itemDe) {
      throw new Error('Expected locale items to be present');
    }

    // Switch to de
    itemDe.props.onClick();
    expect(cookieStore).toContain('NEXT_LOCALE=de');
    expect(mockReplace).toHaveBeenCalledWith('/projects', { locale: 'de' });

    // Switch to current locale (en) is a no-op
    mockReplace.mockClear();
    itemEn.props.onClick();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
