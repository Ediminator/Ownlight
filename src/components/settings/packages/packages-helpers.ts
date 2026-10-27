import { generateSlug } from '@/lib/slug';
import { convertPriceMajorToMinor, convertPriceMinorToMajorString } from '@/lib/currency';
import { SLUG_REGEX, type PackageIncludedItemInput } from '@/server/packages/schema';
import type { PackageWithIncludedItems } from '@/server/packages/repo';

export interface PackageFormData {
  id?: string;
  name: string;
  slug: string;
  projectTypeKey: string;
  basePriceMajor: string;
  taxRateBasisPoints: number;
  taxRateCustomPercent: string;
  description: string;
  includedItems: PackageIncludedItemInput[];
}

export interface PackageFormErrors {
  name?: string;
  slug?: string;
  basePrice?: string;
  taxRate?: string;
  deliverables?: Record<number, { title?: string; quantity?: string }>;
  general?: string;
}

/**
 * Formats a basis points tax rate into a human-friendly percentage string.
 * e.g. 1900 -> "19%", 700 -> "7%", 1950 -> "19.5%"
 */
export function formatTaxRateBasisPoints(bps: number): string {
  const percent = bps / 100;
  return Number.isInteger(percent)
    ? `${percent.toString()}%`
    : `${percent.toFixed(2).replace(/\.?0+$/, '')}%`;
}

/**
 * Parses user input (string or number, e.g. "19", "19%", "7.5", "7,5") into integer basis points (0-10000).
 * Returns null if the value is invalid or out of range.
 */
export function parseTaxRateToBasisPoints(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 100) return null;
    return Math.round(value * 100);
  }
  const trimmed = value.trim().replace('%', '').replace(',', '.');
  if (trimmed === '') return null;
  const num = parseFloat(trimmed);
  if (Number.isNaN(num) || !Number.isFinite(num) || num < 0 || num > 100) {
    return null;
  }
  return Math.round(num * 100);
}

/**
 * Generates or updates a kebab-case slug based on title unless user has overridden it.
 */
export function computeSlugFromTitle(
  title: string,
  currentSlug: string,
  isUserEdited = false,
): string {
  if (isUserEdited && currentSlug.trim() !== '') {
    return currentSlug;
  }
  return generateSlug(title);
}

/**
 * Splits packages into active and archived lists, maintaining position ordering.
 */
export function splitPackagesByActiveStatus(packagesList: PackageWithIncludedItems[]): {
  active: PackageWithIncludedItems[];
  archived: PackageWithIncludedItems[];
} {
  const active: PackageWithIncludedItems[] = [];
  const archived: PackageWithIncludedItems[] = [];

  for (const pkg of packagesList) {
    if (pkg.isActive) {
      active.push(pkg);
    } else {
      archived.push(pkg);
    }
  }

  return { active, archived };
}

/**
 * Filters a packages list by project type key.
 * If typeFilter is 'all' or empty, all packages are returned.
 */
export function filterPackagesByProjectType(
  packagesList: PackageWithIncludedItems[],
  typeFilter: string,
): PackageWithIncludedItems[] {
  if (!typeFilter || typeFilter === 'all') {
    return packagesList;
  }
  return packagesList.filter(
    (pkg) => (pkg.projectTypeKey ?? '').toLowerCase() === typeFilter.toLowerCase(),
  );
}

/**
 * Immutably moves a deliverable in an array from one index to another, updating positions.
 */
export function moveDeliverable<T extends { position?: number }>(
  items: T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
    return items;
  }
  const copy = [...items];
  const [removed] = copy.splice(fromIndex, 1);
  if (!removed) return items;
  copy.splice(toIndex, 0, removed);
  return copy.map((item, index) => ({
    ...item,
    position: index,
  }));
}

/**
 * Validates package modal form inputs before submission.
 */
export function validatePackageForm(data: PackageFormData): {
  isValid: boolean;
  errors: PackageFormErrors;
} {
  const errors: PackageFormErrors = {};

  if (!data.name.trim()) {
    errors.name = 'Package title is required';
  }

  const slug = data.slug.trim();
  if (!slug) {
    errors.slug = 'Slug is required';
  } else if (!SLUG_REGEX.test(slug)) {
    errors.slug = 'Slug must be kebab-case (lowercase letters, numbers, and single hyphens)';
  }

  const minor = convertPriceMajorToMinor(data.basePriceMajor);
  if (minor === undefined || minor < 0) {
    errors.basePrice = 'Base price must be a non-negative number';
  }

  if (
    typeof data.taxRateBasisPoints !== 'number' ||
    !Number.isInteger(data.taxRateBasisPoints) ||
    data.taxRateBasisPoints < 0 ||
    data.taxRateBasisPoints > 10000
  ) {
    errors.taxRate = 'Tax rate must be between 0% and 100%';
  }

  const deliverableErrors: Record<number, { title?: string; quantity?: string }> = {};
  data.includedItems.forEach((item, index) => {
    const itemErrors: { title?: string; quantity?: string } = {};
    if (!item.title.trim()) {
      itemErrors.title = 'Deliverable title is required';
    }
    if (typeof item.quantity !== 'number' || item.quantity < 1) {
      itemErrors.quantity = 'Quantity must be at least 1';
    }
    if (Object.keys(itemErrors).length > 0) {
      Object.assign(deliverableErrors, { [index]: itemErrors });
    }
  });

  if (Object.keys(deliverableErrors).length > 0) {
    errors.deliverables = deliverableErrors;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Converts package record to initial form data.
 */
export function packageToFormData(pkg?: PackageWithIncludedItems | null): PackageFormData {
  if (!pkg) {
    return {
      name: '',
      slug: '',
      projectTypeKey: '',
      basePriceMajor: '',
      taxRateBasisPoints: 1900,
      taxRateCustomPercent: '19',
      description: '',
      includedItems: [],
    };
  }

  return {
    id: pkg.id,
    name: pkg.name,
    slug: pkg.slug,
    projectTypeKey: pkg.projectTypeKey ?? '',
    basePriceMajor: convertPriceMinorToMajorString(pkg.basePriceMinor, pkg.currency),
    taxRateBasisPoints: pkg.taxRateBasisPoints,
    taxRateCustomPercent: (pkg.taxRateBasisPoints / 100).toString(),
    description: pkg.description ?? '',
    includedItems: pkg.includedItems.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      quantity: item.quantity,
      position: item.position,
    })),
  };
}
