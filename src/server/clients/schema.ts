import { z } from 'zod';
import { CLIENT_KINDS, CLIENT_LOCALES, ADDRESS_TYPES } from '@/server/db/schema/clients';

/**
 * Validates country code using Intl.DisplayNames without external dependencies.
 * Returns true only if code is 2 uppercase letters and resolves to a real region name.
 */
export function isValidCountryCode(code: string): boolean {
  if (!/^[A-Z]{2}$/.test(code)) return false;
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    const resolved = displayNames.of(code);
    return Boolean(resolved && resolved !== code && resolved !== 'Unknown Region');
  } catch {
    return false;
  }
}

/**
 * Normalizes email address by trimming and lower-casing per RFC requirements.
 */
export function normalizeEmail(email?: string | null): string | null {
  if (!email || typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

// Single-line text validator disallowing ASCII control characters ([\x00-\x1F\x7F])
export const singleLineString = (maxLength: number, minLength = 0) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(
      z
        .string()
        .min(
          minLength,
          minLength > 0 ? `Must be at least ${String(minLength)} characters.` : undefined,
        )
        .max(maxLength, `Must not exceed ${String(maxLength)} characters.`)
        .refine((s) => !/[\x00-\x1F\x7F]/.test(s), {
          message: 'ASCII control characters are not allowed.',
        }),
    );

export const phoneSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .max(32, 'Phone number must not exceed 32 characters.')
      .regex(/^\+?[0-9][0-9 ()/.-]{2,31}$/, 'Invalid phone number format.'),
  );

export const emailSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .email('Invalid email address format.')
      .max(254, 'Email must not exceed 254 characters.'),
  );

export const countryCodeSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(
    z
      .string()
      .length(2, 'Country code must be exactly two letters.')
      .refine(isValidCountryCode, { message: 'Invalid ISO 3166-1 alpha-2 country code.' }),
  );

export const uuidSchema = z.string().uuid('Invalid UUID format.');

/**
 * Primary contact input for create client action.
 */
export const primaryContactInputSchema = z
  .object({
    givenName: singleLineString(100, 0).optional().nullable(),
    familyName: singleLineString(100, 0).optional().nullable(),
    email: emailSchema.optional().nullable(),
    phone: phoneSchema.optional().nullable(),
  })
  .strict()
  .refine(
    (data) => {
      const hasGiven = typeof data.givenName === 'string' && data.givenName.trim().length > 0;
      const hasFamily = typeof data.familyName === 'string' && data.familyName.trim().length > 0;
      return hasGiven || hasFamily;
    },
    {
      message: 'At least one contact name (givenName or familyName) must be non-empty.',
      path: ['givenName'],
    },
  );

export type PrimaryContactInput = z.infer<typeof primaryContactInputSchema>;

/**
 * createClientAction input schema.
 */
export const createClientInputSchema = z
  .object({
    kind: z.enum(CLIENT_KINDS, {
      errorMap: () => ({ message: 'kind must be "person" or "company".' }),
    }),
    displayName: singleLineString(200, 1),
    preferredLocale: z.enum(CLIENT_LOCALES).optional(),
    googleContactsSyncEnabled: z.boolean().optional(),
    primaryContact: primaryContactInputSchema,
    acknowledgeDuplicates: z.boolean().optional(),
  })
  .strict();

export type CreateClientInput = z.infer<typeof createClientInputSchema>;

/**
 * updateClientAction input schema.
 */
export const updateClientInputSchema = z
  .object({
    clientId: uuidSchema,
    kind: z.enum(CLIENT_KINDS).optional(),
    displayName: singleLineString(200, 1).optional(),
    preferredLocale: z.enum(CLIENT_LOCALES).optional(),
    googleContactsSyncEnabled: z.boolean().optional(),
  })
  .strict();

export type UpdateClientInput = z.infer<typeof updateClientInputSchema>;

/**
 * addContactAction input schema.
 */
export const addContactInputSchema = z
  .object({
    clientId: uuidSchema,
    givenName: singleLineString(100, 0).optional().nullable(),
    familyName: singleLineString(100, 0).optional().nullable(),
    email: emailSchema.optional().nullable(),
    phone: phoneSchema.optional().nullable(),
    isPrimary: z.boolean().optional(),
    acknowledgeDuplicates: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) => {
      const hasGiven = typeof data.givenName === 'string' && data.givenName.trim().length > 0;
      const hasFamily = typeof data.familyName === 'string' && data.familyName.trim().length > 0;
      return hasGiven || hasFamily;
    },
    {
      message: 'At least one contact name (givenName or familyName) must be non-empty.',
      path: ['givenName'],
    },
  );

export type AddContactInput = z.infer<typeof addContactInputSchema>;

/**
 * updateContactAction input schema.
 */
export const updateContactInputSchema = z
  .object({
    clientId: uuidSchema,
    contactId: uuidSchema,
    givenName: singleLineString(100, 0).optional().nullable(),
    familyName: singleLineString(100, 0).optional().nullable(),
    email: emailSchema.optional().nullable(),
    phone: phoneSchema.optional().nullable(),
    isPrimary: z.boolean().optional(),
    acknowledgeDuplicates: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) => {
      // If either name was explicitly passed, verify at least one non-empty name exists
      const givenPassed = data.givenName !== undefined;
      const familyPassed = data.familyName !== undefined;
      if (givenPassed && familyPassed) {
        const hasGiven = typeof data.givenName === 'string' && data.givenName.trim().length > 0;
        const hasFamily = typeof data.familyName === 'string' && data.familyName.trim().length > 0;
        return hasGiven || hasFamily;
      }
      return true;
    },
    {
      message: 'At least one contact name (givenName or familyName) must be non-empty.',
      path: ['givenName'],
    },
  );

export type UpdateContactInput = z.infer<typeof updateContactInputSchema>;

/**
 * removeContactAction input schema.
 */
export const removeContactInputSchema = z
  .object({
    clientId: uuidSchema,
    contactId: uuidSchema,
  })
  .strict();

export type RemoveContactInput = z.infer<typeof removeContactInputSchema>;

/**
 * upsertAddressAction input schema.
 * Accepts both postal_code / postalCode and country_code / countryCode for flexibility.
 */
export const upsertAddressInputSchema = z
  .object({
    clientId: uuidSchema,
    type: z.enum(ADDRESS_TYPES, {
      errorMap: () => ({ message: 'type must be "postal" or "billing".' }),
    }),
    line1: singleLineString(200, 1),
    line2: singleLineString(200, 0).optional().nullable(),
    postalCode: singleLineString(20, 1).optional(),
    postal_code: singleLineString(20, 1).optional(),
    city: singleLineString(100, 1),
    region: singleLineString(100, 0).optional().nullable(),
    countryCode: countryCodeSchema.optional(),
    country_code: countryCodeSchema.optional(),
  })
  .strict()
  .refine((data) => data.postalCode !== undefined || data.postal_code !== undefined, {
    message: 'postalCode or postal_code is required.',
    path: ['postal_code'],
  })
  .refine((data) => data.countryCode !== undefined || data.country_code !== undefined, {
    message: 'countryCode or country_code is required.',
    path: ['country_code'],
  });

export type UpsertAddressInput = z.infer<typeof upsertAddressInputSchema>;

/**
 * removeAddressAction input schema.
 */
export const removeAddressInputSchema = z
  .object({
    clientId: uuidSchema,
    type: z.enum(ADDRESS_TYPES),
  })
  .strict();

export type RemoveAddressInput = z.infer<typeof removeAddressInputSchema>;

/**
 * getClientAction input schema.
 */
export const getClientInputSchema = z
  .object({
    clientId: uuidSchema,
  })
  .strict();

export type GetClientInput = z.infer<typeof getClientInputSchema>;

/**
 * Escapes PostgreSQL LIKE/ILIKE wildcard metacharacters (%, _, \) in search strings.
 */
export function escapeLikeWildcards(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

export const tagNameSchema = singleLineString(50, 1);

export const setClientTagsInputSchema = z
  .object({
    clientId: uuidSchema,
    tagNames: z.array(tagNameSchema),
  })
  .strict();

export type SetClientTagsInput = z.infer<typeof setClientTagsInputSchema>;

export const listTagsInputSchema = z.object({}).passthrough().optional();

export const searchQuerySchema = singleLineString(100, 1);

/**
 * listClientsAction input schema (updated in TASK-0010 with search and tag filters).
 */
export const listClientsInputSchema = z
  .object({
    page: z.number().int().min(1, 'page must be at least 1.').optional().default(1),
    pageSize: z
      .number()
      .int()
      .min(1, 'pageSize must be at least 1.')
      .max(100, 'pageSize must not exceed 100.')
      .optional()
      .default(25),
    q: searchQuerySchema.optional(),
    tagId: uuidSchema.optional(),
  })
  .strict();

export type ListClientsInput = z.infer<typeof listClientsInputSchema>;
