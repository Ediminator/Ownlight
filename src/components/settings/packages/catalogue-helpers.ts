import { convertPriceMajorToMinor, convertPriceMinorToMajorString } from '@/lib/currency';
import { SLUG_REGEX } from '@/server/packages/schema';
import {
  CATALOGUE_CATEGORIES,
  type CatalogueCategory,
  type CatalogueItem,
} from '@/server/db/schema/packages';

export interface CatalogueItemFormData {
  id?: string;
  name: string;
  slug: string;
  category: CatalogueCategory;
  unitPriceMajor: string;
  taxRateBasisPoints: number;
  taxRateCustomPercent: string;
  description: string;
  isActive: boolean;
}

export interface CatalogueItemFormErrors {
  name?: string;
  slug?: string;
  category?: string;
  unitPrice?: string;
  taxRate?: string;
  general?: string;
}

/**
 * Validates catalogue item modal form inputs before submission.
 */
export function validateCatalogueItemForm(data: CatalogueItemFormData): {
  isValid: boolean;
  errors: CatalogueItemFormErrors;
} {
  const errors: CatalogueItemFormErrors = {};

  if (!data.name.trim()) {
    errors.name = 'Item name is required';
  }

  const slug = data.slug.trim();
  if (!slug) {
    errors.slug = 'Slug is required';
  } else if (!SLUG_REGEX.test(slug)) {
    errors.slug = 'Slug must be kebab-case (lowercase letters, numbers, and single hyphens)';
  }

  if (!CATALOGUE_CATEGORIES.includes(data.category)) {
    errors.category = 'Invalid catalogue category';
  }

  const minor = convertPriceMajorToMinor(data.unitPriceMajor);
  if (minor === undefined || minor < 0) {
    errors.unitPrice = 'Unit price must be a non-negative number';
  }

  if (
    typeof data.taxRateBasisPoints !== 'number' ||
    !Number.isInteger(data.taxRateBasisPoints) ||
    data.taxRateBasisPoints < 0 ||
    data.taxRateBasisPoints > 10000
  ) {
    errors.taxRate = 'Tax rate must be between 0% and 100%';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Filters a catalogue item list by category and optionally active status.
 */
export function filterCatalogueItems(
  items: CatalogueItem[],
  categoryFilter: string,
  showArchived = false,
): CatalogueItem[] {
  return items.filter((item) => {
    if (!showArchived && !item.isActive) {
      return false;
    }
    if (categoryFilter && categoryFilter !== 'all' && item.category !== categoryFilter) {
      return false;
    }
    return true;
  });
}

/**
 * Converts a catalogue item to form data.
 */
export function catalogueItemToFormData(item?: CatalogueItem | null): CatalogueItemFormData {
  if (!item) {
    return {
      name: '',
      slug: '',
      category: 'service',
      unitPriceMajor: '',
      taxRateBasisPoints: 1900,
      taxRateCustomPercent: '19',
      description: '',
      isActive: true,
    };
  }

  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    category: item.category,
    unitPriceMajor: convertPriceMinorToMajorString(item.unitPriceMinor, item.currency),
    taxRateBasisPoints: item.taxRateBasisPoints,
    taxRateCustomPercent: (item.taxRateBasisPoints / 100).toString(),
    description: item.description ?? '',
    isActive: item.isActive,
  };
}

/**
 * Returns Tailwind badge classes based on category.
 */
export function getCategoryBadgeClasses(category: CatalogueCategory): string {
  switch (category) {
    case 'service':
      return 'border-primary/20 bg-primary/10 text-primary dark:border-primary/30 dark:bg-primary/20';
    case 'product':
      return 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300 dark:border-blue-500/30 dark:bg-blue-500/20';
    case 'travel':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300 dark:border-amber-500/30 dark:bg-amber-500/20';
    case 'licensing':
      return 'border-purple-500/20 bg-purple-500/10 text-purple-700 dark:text-purple-300 dark:border-purple-500/30 dark:bg-purple-500/20';
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
}
