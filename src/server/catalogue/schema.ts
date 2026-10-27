import { z } from 'zod';
import { CATALOGUE_CATEGORIES, type CatalogueCategory } from '@/server/db/schema/packages';
import { SLUG_REGEX } from '@/server/packages/schema';

export const catalogueCategorySchema = z.enum(CATALOGUE_CATEGORIES);

export const createCatalogueItemSchema = z
  .object({
    name: z.string().trim().min(1, 'Catalogue item name is required').max(150),
    slug: z
      .string()
      .trim()
      .min(1, 'Slug is required')
      .max(100)
      .regex(
        SLUG_REGEX,
        'Slug must be kebab-case (lowercase letters, numbers, and single hyphens)',
      ),
    description: z.string().trim().nullable().optional(),
    category: catalogueCategorySchema.default('service'),
    unitPriceMinor: z
      .number()
      .int('unitPriceMinor must be an integer')
      .min(0, 'unitPriceMinor cannot be negative')
      .default(0),
    currency: z.string().length(3, 'Currency must be 3 characters').default('EUR'),
    taxRateBasisPoints: z
      .number()
      .int('taxRateBasisPoints must be an integer')
      .min(0, 'taxRateBasisPoints cannot be negative')
      .max(10000, 'taxRateBasisPoints cannot exceed 10000 (100%)')
      .default(1900),
    position: z.number().int().min(0).default(0),
    isActive: z.boolean().default(true),
  })
  .transform((data) => ({
    name: data.name.trim(),
    slug: data.slug,
    description: data.description ?? null,
    category: data.category,
    unitPriceMinor: data.unitPriceMinor,
    currency: data.currency.toUpperCase(),
    taxRateBasisPoints: data.taxRateBasisPoints,
    position: data.position,
    isActive: data.isActive,
  }));

export type CreateCatalogueItemInput = z.input<typeof createCatalogueItemSchema>;
export type ParsedCreateCatalogueItemInput = z.output<typeof createCatalogueItemSchema>;

export const updateCatalogueItemSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(SLUG_REGEX, 'Slug must be kebab-case (lowercase letters, numbers, and single hyphens)')
      .optional(),
    description: z.string().trim().nullable().optional(),
    category: catalogueCategorySchema.optional(),
    unitPriceMinor: z
      .number()
      .int('unitPriceMinor must be an integer')
      .min(0, 'unitPriceMinor cannot be negative')
      .optional(),
    currency: z.string().length(3).optional(),
    taxRateBasisPoints: z
      .number()
      .int()
      .min(0, 'taxRateBasisPoints cannot be negative')
      .max(10000, 'taxRateBasisPoints cannot exceed 10000')
      .optional(),
    position: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .transform((data) => {
    const result: {
      name?: string;
      slug?: string;
      description?: string | null;
      category?: CatalogueCategory;
      unitPriceMinor?: number;
      currency?: string;
      taxRateBasisPoints?: number;
      position?: number;
      isActive?: boolean;
    } = {};

    if (data.name !== undefined) result.name = data.name.trim();
    if (data.slug !== undefined) result.slug = data.slug;
    if (data.description !== undefined) result.description = data.description;
    if (data.category !== undefined) result.category = data.category;
    if (data.unitPriceMinor !== undefined) result.unitPriceMinor = data.unitPriceMinor;
    if (data.currency !== undefined) result.currency = data.currency.toUpperCase();
    if (data.taxRateBasisPoints !== undefined) result.taxRateBasisPoints = data.taxRateBasisPoints;
    if (data.position !== undefined) result.position = data.position;
    if (data.isActive !== undefined) result.isActive = data.isActive;

    return result;
  });

export type UpdateCatalogueItemInput = z.input<typeof updateCatalogueItemSchema>;
export type ParsedUpdateCatalogueItemInput = z.output<typeof updateCatalogueItemSchema>;

export const saveCatalogueItemActionInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, 'Catalogue item name is required').max(150),
    slug: z
      .string()
      .trim()
      .min(1, 'Slug is required')
      .max(100)
      .regex(
        SLUG_REGEX,
        'Slug must be kebab-case (lowercase letters, numbers, and single hyphens)',
      ),
    description: z.string().trim().nullable().optional(),
    category: catalogueCategorySchema.default('service'),
    unitPriceMinor: z
      .number()
      .int('unitPriceMinor must be an integer')
      .min(0, 'Unit price cannot be negative')
      .default(0),
    currency: z.string().length(3, 'Currency must be 3 characters').default('EUR'),
    taxRateBasisPoints: z
      .number()
      .int('taxRateBasisPoints must be an integer')
      .min(0, 'Tax rate cannot be negative')
      .max(10000, 'Tax rate cannot exceed 100%')
      .default(1900),
    position: z.number().int().min(0).default(0),
    isActive: z.boolean().default(true),
  })
  .strict();

export type SaveCatalogueItemActionInput = z.infer<typeof saveCatalogueItemActionInputSchema>;

export const archiveCatalogueItemActionInputSchema = z
  .object({
    id: z.string().uuid('Valid catalogue item ID is required'),
    isActive: z.boolean().optional().default(false),
  })
  .strict();

export type ArchiveCatalogueItemActionInput = z.infer<typeof archiveCatalogueItemActionInputSchema>;
