import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  updateStudioTaxSettingsSchema,
  DEFAULT_KLEINUNTERNEHMER_NOTICES,
  getEffectiveKleinunternehmerNotice,
} from '@/server/studio/tax-settings-schema';

describe('TASK-0056: Studio Tax Settings Schema Validation (AC-6, AC-8)', () => {
  it('AC-6: validates and parses complete studio tax settings payload', () => {
    const validPayload = {
      taxNumber: '12/345/67890',
      vatId: 'DE123456789',
      isKleinunternehmer: true,
      kleinunternehmerNotice: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
      defaultTaxRateBasisPoints: 0,
      pricesIncludeTax: true,
    };

    const parsed = updateStudioTaxSettingsSchema.parse(validPayload);
    expect(parsed.taxNumber).toBe('12/345/67890');
    expect(parsed.vatId).toBe('DE123456789');
    expect(parsed.isKleinunternehmer).toBe(true);
    expect(parsed.kleinunternehmerNotice).toBe(
      'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    );
    expect(parsed.defaultTaxRateBasisPoints).toBe(0);
    expect(parsed.pricesIncludeTax).toBe(true);
  });

  it('AC-6: provides standard statutory default notices in German and English per ADR-0018 §1.1', () => {
    expect(DEFAULT_KLEINUNTERNEHMER_NOTICES.de).toBe(
      'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    );
    expect(DEFAULT_KLEINUNTERNEHMER_NOTICES.en).toBe(
      'According to § 19 UStG, no value added tax is charged.',
    );

    // When kleinunternehmer is true and custom notice is null or empty, helper returns statutory default
    const germanDefault = getEffectiveKleinunternehmerNotice(
      { is_kleinunternehmer: true, kleinunternehmer_notice: null },
      'de',
    );
    expect(germanDefault).toBe(DEFAULT_KLEINUNTERNEHMER_NOTICES.de);

    const englishDefault = getEffectiveKleinunternehmerNotice(
      { is_kleinunternehmer: true, kleinunternehmer_notice: '' },
      'en',
    );
    expect(englishDefault).toBe(DEFAULT_KLEINUNTERNEHMER_NOTICES.en);

    // When custom notice is provided, custom notice is returned
    const customNotice = getEffectiveKleinunternehmerNotice(
      { is_kleinunternehmer: true, kleinunternehmer_notice: 'Custom statutory note.' },
      'de',
    );
    expect(customNotice).toBe('Custom statutory note.');

    // When is_kleinunternehmer is false, returns null
    const notKleinunternehmer = getEffectiveKleinunternehmerNotice(
      { is_kleinunternehmer: false, kleinunternehmer_notice: null },
      'de',
    );
    expect(notKleinunternehmer).toBeNull();
  });

  it('AC-8: rejects negative default_tax_rate_basis_points with ZodError', () => {
    expect(() =>
      updateStudioTaxSettingsSchema.parse({
        defaultTaxRateBasisPoints: -100,
      }),
    ).toThrow(ZodError);
  });

  it('AC-8: rejects default_tax_rate_basis_points exceeding 10000 with ZodError', () => {
    expect(() =>
      updateStudioTaxSettingsSchema.parse({
        defaultTaxRateBasisPoints: 12000,
      }),
    ).toThrow(ZodError);
  });

  it('AC-8: rejects taxNumber or vatId exceeding 50 characters', () => {
    expect(() =>
      updateStudioTaxSettingsSchema.parse({
        taxNumber: 'X'.repeat(51),
      }),
    ).toThrow(ZodError);

    expect(() =>
      updateStudioTaxSettingsSchema.parse({
        vatId: 'DE' + '9'.repeat(50),
      }),
    ).toThrow(ZodError);
  });
});
