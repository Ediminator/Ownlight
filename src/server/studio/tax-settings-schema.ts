import { z } from 'zod';

export const DEFAULT_KLEINUNTERNEHMER_NOTICES = {
  de: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
  en: 'According to § 19 UStG, no value added tax is charged.',
} as const;

/**
 * Returns the effective statutory notice string for a studio operating under §19 UStG.
 * If custom notice is empty, falls back to standard statutory text for the given locale.
 * Returns null if the studio is not registered as Kleinunternehmer.
 */
export function getEffectiveKleinunternehmerNotice(
  settings: {
    is_kleinunternehmer?: boolean;
    kleinunternehmer_notice?: string | null;
  },
  locale = 'en',
): string | null {
  if (!settings.is_kleinunternehmer) {
    return null;
  }

  if (settings.kleinunternehmer_notice && settings.kleinunternehmer_notice.trim().length > 0) {
    return settings.kleinunternehmer_notice.trim();
  }

  return locale === 'de'
    ? DEFAULT_KLEINUNTERNEHMER_NOTICES.de
    : DEFAULT_KLEINUNTERNEHMER_NOTICES.en;
}

export const updateStudioTaxSettingsSchema = z
  .object({
    taxNumber: z
      .string()
      .trim()
      .max(50, 'Tax number cannot exceed 50 characters')
      .nullable()
      .optional(),
    vatId: z.string().trim().max(50, 'VAT ID cannot exceed 50 characters').nullable().optional(),
    isKleinunternehmer: z.boolean().optional(),
    kleinunternehmerNotice: z.string().trim().nullable().optional(),
    defaultTaxRateBasisPoints: z
      .number()
      .int('defaultTaxRateBasisPoints must be an integer')
      .min(0, 'defaultTaxRateBasisPoints cannot be negative')
      .max(10000, 'defaultTaxRateBasisPoints cannot exceed 10000')
      .optional(),
    pricesIncludeTax: z.boolean().optional(),
  })
  .strict();

export type UpdateStudioTaxSettingsInput = z.input<typeof updateStudioTaxSettingsSchema>;
export type ParsedUpdateStudioTaxSettingsInput = z.output<typeof updateStudioTaxSettingsSchema>;
