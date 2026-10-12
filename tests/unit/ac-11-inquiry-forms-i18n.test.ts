import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

interface MessageCatalogue {
  inquiryForms?: {
    defaultAcknowledgement?: string;
  };
}

describe('TASK-0024: AC-11 Default Privacy Notice Texts and Acknowledgement Phrasing', () => {
  const enPath = path.resolve(import.meta.dirname, '../../messages/en.json');
  const dePath = path.resolve(import.meta.dirname, '../../messages/de.json');

  it('AC-11: default texts exist in both messages/en.json and messages/de.json', () => {
    expect(fs.existsSync(enPath), 'messages/en.json must exist').toBe(true);
    expect(fs.existsSync(dePath), 'messages/de.json must exist').toBe(true);

    const en = JSON.parse(fs.readFileSync(enPath, 'utf8')) as MessageCatalogue;
    const de = JSON.parse(fs.readFileSync(dePath, 'utf8')) as MessageCatalogue;

    expect(en.inquiryForms).toBeDefined();
    expect(en.inquiryForms?.defaultAcknowledgement).toBeDefined();
    expect(typeof en.inquiryForms?.defaultAcknowledgement).toBe('string');
    expect((en.inquiryForms?.defaultAcknowledgement ?? '').length).toBeGreaterThan(0);

    expect(de.inquiryForms).toBeDefined();
    expect(de.inquiryForms?.defaultAcknowledgement).toBeDefined();
    expect(typeof de.inquiryForms?.defaultAcknowledgement).toBe('string');
    expect((de.inquiryForms?.defaultAcknowledgement ?? '').length).toBeGreaterThan(0);
  });

  it('AC-11: English text is phrased as an acknowledgement ("I have read..."), not as consent', () => {
    const en = JSON.parse(fs.readFileSync(enPath, 'utf8')) as MessageCatalogue;
    const text: string = en.inquiryForms?.defaultAcknowledgement ?? '';

    // Must be phrased as acknowledgement
    expect(text.toLowerCase()).toContain('i have read');
    expect(text.toLowerCase()).toContain('acknowledge');

    // Must NOT be phrased as consent (Art. 6(1)(b) vs Art. 6(1)(a) GDPR)
    expect(text.toLowerCase()).not.toContain('consent');
    expect(text.toLowerCase()).not.toContain('agree to');
    expect(text.toLowerCase()).not.toContain('opt in');
    expect(text.toLowerCase()).not.toContain('permission');
  });

  it('AC-11: German text is phrased as an acknowledgement ("Ich habe die Datenschutzerklärung zur Kenntnis genommen...")', () => {
    const de = JSON.parse(fs.readFileSync(dePath, 'utf8')) as MessageCatalogue;
    const text: string = de.inquiryForms?.defaultAcknowledgement ?? '';

    expect(text).toContain('Ich habe die Datenschutzerklärung zur Kenntnis genommen');
    expect(text.toLowerCase()).not.toContain('willige');
    expect(text.toLowerCase()).not.toContain('stimme zu');
  });
});
