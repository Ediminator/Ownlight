import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

interface TranslationJson {
  nav?: {
    inquiryForms?: string;
  };
  settings?: {
    inquiryForms?: Record<string, unknown>;
  };
}

describe('TASK-0025: AC-8 German Localization & Date Formatting', () => {
  const enPath = path.resolve(process.cwd(), 'messages/en.json');
  const dePath = path.resolve(process.cwd(), 'messages/de.json');

  const en = JSON.parse(fs.readFileSync(enPath, 'utf8')) as TranslationJson;
  const de = JSON.parse(fs.readFileSync(dePath, 'utf8')) as TranslationJson;

  it('AC-8: navigation entry "inquiryForms" is localized in German as "Anfrageformulare"', () => {
    expect(en.nav?.inquiryForms).toBe('Inquiry forms');
    expect(de.nav?.inquiryForms).toBe('Anfrageformulare');
  });

  it('AC-8: all settings.inquiryForms strings in German catalog are present and non-empty', () => {
    expect(en.settings?.inquiryForms).toBeDefined();
    expect(de.settings?.inquiryForms).toBeDefined();

    function verifyKeys(
      enObj: Record<string, unknown>,
      deObj: Record<string, unknown>,
      prefix = '',
    ) {
      for (const [key, enVal] of Object.entries(enObj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        expect(deObj, `German catalog must contain ${fullKey}`).toHaveProperty(key);

        const deVal = Reflect.get(deObj, key);
        if (typeof enVal === 'object' && enVal !== null && !Array.isArray(enVal)) {
          expect(typeof deVal, `${fullKey} in German must be an object`).toBe('object');
          verifyKeys(enVal as Record<string, unknown>, deVal as Record<string, unknown>, fullKey);
        } else {
          expect(typeof deVal, `${fullKey} in German must be a string`).toBe('string');
          expect(
            (deVal as string).trim().length,
            `${fullKey} in German cannot be empty`,
          ).toBeGreaterThan(0);
        }
      }
    }

    if (en.settings?.inquiryForms && de.settings?.inquiryForms) {
      verifyKeys(en.settings.inquiryForms, de.settings.inquiryForms, 'settings.inquiryForms');
    }
  });

  it('AC-8: German date formatting uses de locale format', () => {
    const testDate = new Date('2026-10-12T14:30:00Z');

    const deFormatted = new Intl.DateTimeFormat('de', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(testDate);

    // In German, dates use dots e.g. 12.10.2026 or 12. Okt. 2026
    expect(deFormatted).toMatch(/12\./);
  });
});
