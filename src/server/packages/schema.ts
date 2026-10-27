import { z } from 'zod';

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const packageIncludedItemInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1, 'Deliverable title is required').max(200),
    description: z.string().trim().nullable().optional(),
    quantity: z
      .number()
      .int('Quantity must be an integer')
      .min(1, 'Quantity must be at least 1')
      .default(1),
    position: z.number().int().min(0).optional(),
  })
  .strict();

export type PackageIncludedItemInput = z.infer<typeof packageIncludedItemInputSchema>;

export const createPackageSchema = z
  .object({
    name: z.string().trim().min(1, 'Package name is required').max(150).optional(),
    title: z.string().trim().min(1, 'Package title is required').max(150).optional(),
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
    projectTypeKey: z.string().trim().max(40).nullable().optional(),
    basePriceMinor: z
      .number()
      .int('basePriceMinor must be an integer')
      .min(0, 'basePriceMinor cannot be negative')
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
    includedItems: z.array(packageIncludedItemInputSchema).optional().default([]),
  })
  .refine((data) => Boolean(data.name ?? data.title), {
    message: 'Package name is required',
    path: ['name'],
  })
  .transform((data) => {
    const rawName = data.name ?? data.title ?? '';
    const resolvedName = rawName.trim();
    return {
      name: resolvedName,
      slug: data.slug,
      description: data.description ?? null,
      projectTypeKey: data.projectTypeKey ?? null,
      basePriceMinor: data.basePriceMinor,
      currency: data.currency.toUpperCase(),
      taxRateBasisPoints: data.taxRateBasisPoints,
      position: data.position,
      isActive: data.isActive,
      includedItems: data.includedItems,
    };
  });

export type CreatePackageInput = z.input<typeof createPackageSchema>;
export type ParsedCreatePackageInput = z.output<typeof createPackageSchema>;

export const updatePackageSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    title: z.string().trim().min(1).max(150).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(SLUG_REGEX, 'Slug must be kebab-case (lowercase letters, numbers, and single hyphens)')
      .optional(),
    description: z.string().trim().nullable().optional(),
    projectTypeKey: z.string().trim().max(40).nullable().optional(),
    basePriceMinor: z
      .number()
      .int('basePriceMinor must be an integer')
      .min(0, 'basePriceMinor cannot be negative')
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
    includedItems: z.array(packageIncludedItemInputSchema).optional(),
  })
  .transform((data) => {
    const result: {
      name?: string;
      slug?: string;
      description?: string | null;
      projectTypeKey?: string | null;
      basePriceMinor?: number;
      currency?: string;
      taxRateBasisPoints?: number;
      position?: number;
      isActive?: boolean;
      includedItems?: PackageIncludedItemInput[];
    } = {};

    const rawName = data.name ?? data.title;
    if (rawName !== undefined) {
      result.name = rawName.trim();
    }
    if (data.slug !== undefined) result.slug = data.slug;
    if (data.description !== undefined) result.description = data.description;
    if (data.projectTypeKey !== undefined) result.projectTypeKey = data.projectTypeKey;
    if (data.basePriceMinor !== undefined) result.basePriceMinor = data.basePriceMinor;
    if (data.currency !== undefined) result.currency = data.currency.toUpperCase();
    if (data.taxRateBasisPoints !== undefined) result.taxRateBasisPoints = data.taxRateBasisPoints;
    if (data.position !== undefined) result.position = data.position;
    if (data.isActive !== undefined) result.isActive = data.isActive;
    if (data.includedItems !== undefined) result.includedItems = data.includedItems;

    return result;
  });

export type UpdatePackageInput = z.input<typeof updatePackageSchema>;
export type ParsedUpdatePackageInput = z.output<typeof updatePackageSchema>;
