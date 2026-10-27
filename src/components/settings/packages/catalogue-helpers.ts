import { convertPriceMajorToMinor, convertPriceMinorToMajorString } from '@/lib/currency';
import { SLUG_REGEX } from '@/server/packages/schema';
import {
  CATALOGUE_CATEGORIES,
  type CatalogueCategory,
  type CatalogueItem,
} from '@/server/db/schema/packages';
import { computeSlugFromTitle, parseTaxRateToBasisPoints } from './packages-helpers';

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

export interface CatalogueFormState {
  formData: CatalogueItemFormData;
  errors: CatalogueItemFormErrors;
  isSlugManuallyEdited: boolean;
}

export type CatalogueFormAction =
  | { type: 'SET_NAME'; name: string }
  | { type: 'SET_SLUG'; slug: string }
  | { type: 'SET_CATEGORY'; category: CatalogueCategory }
  | { type: 'SET_PRICE'; unitPriceMajor: string }
  | { type: 'SET_TAX_RATE_PRESET'; preset: string }
  | { type: 'SET_CUSTOM_TAX_RATE'; percent: string }
  | { type: 'SET_DESCRIPTION'; description: string }
  | { type: 'SET_ACTIVE'; isActive: boolean }
  | { type: 'SET_ERRORS'; errors: CatalogueItemFormErrors }
  | { type: 'RESET'; item: CatalogueItem | null };

export function initCatalogueFormState(item?: CatalogueItem | null): CatalogueFormState {
  return {
    formData: catalogueItemToFormData(item),
    errors: {},
    isSlugManuallyEdited: Boolean(item?.slug),
  };
}

export function catalogueFormReducer(
  state: CatalogueFormState,
  action: CatalogueFormAction,
): CatalogueFormState {
  switch (action.type) {
    case 'SET_NAME': {
      const computedSlug = computeSlugFromTitle(
        action.name,
        state.formData.slug,
        state.isSlugManuallyEdited,
      );
      return {
        ...state,
        formData: {
          ...state.formData,
          name: action.name,
          slug: computedSlug,
        },
        errors: state.errors.name ? { ...state.errors, name: undefined } : state.errors,
      };
    }
    case 'SET_SLUG': {
      return {
        ...state,
        isSlugManuallyEdited: true,
        formData: {
          ...state.formData,
          slug: action.slug,
        },
        errors: state.errors.slug ? { ...state.errors, slug: undefined } : state.errors,
      };
    }
    case 'SET_CATEGORY': {
      return {
        ...state,
        formData: {
          ...state.formData,
          category: action.category,
        },
        errors: state.errors.category ? { ...state.errors, category: undefined } : state.errors,
      };
    }
    case 'SET_PRICE': {
      return {
        ...state,
        formData: {
          ...state.formData,
          unitPriceMajor: action.unitPriceMajor,
        },
        errors: state.errors.unitPrice ? { ...state.errors, unitPrice: undefined } : state.errors,
      };
    }
    case 'SET_TAX_RATE_PRESET': {
      if (action.preset === 'custom') {
        return {
          ...state,
          formData: {
            ...state.formData,
            taxRateBasisPoints: 1900,
            taxRateCustomPercent: '19',
          },
          errors: state.errors.taxRate ? { ...state.errors, taxRate: undefined } : state.errors,
        };
      }
      const bps = parseInt(action.preset, 10);
      return {
        ...state,
        formData: {
          ...state.formData,
          taxRateBasisPoints: bps,
          taxRateCustomPercent: (bps / 100).toString(),
        },
        errors: state.errors.taxRate ? { ...state.errors, taxRate: undefined } : state.errors,
      };
    }
    case 'SET_CUSTOM_TAX_RATE': {
      const bps = parseTaxRateToBasisPoints(action.percent);
      return {
        ...state,
        formData: {
          ...state.formData,
          taxRateCustomPercent: action.percent,
          taxRateBasisPoints: bps ?? -1,
        },
        errors: state.errors.taxRate ? { ...state.errors, taxRate: undefined } : state.errors,
      };
    }
    case 'SET_DESCRIPTION': {
      return {
        ...state,
        formData: {
          ...state.formData,
          description: action.description,
        },
      };
    }
    case 'SET_ACTIVE': {
      return {
        ...state,
        formData: {
          ...state.formData,
          isActive: action.isActive,
        },
      };
    }
    case 'SET_ERRORS': {
      return {
        ...state,
        errors: action.errors,
      };
    }
    case 'RESET': {
      return initCatalogueFormState(action.item);
    }
    default:
      return state;
  }
}

export function buildCatalogueItemSavePayload(formData: CatalogueItemFormData) {
  const minor = convertPriceMajorToMinor(formData.unitPriceMajor) ?? 0;
  return {
    id: formData.id,
    name: formData.name.trim(),
    slug: formData.slug.trim(),
    category: formData.category,
    unitPriceMinor: minor,
    taxRateBasisPoints: formData.taxRateBasisPoints,
    description: formData.description.trim() ? formData.description.trim() : null,
    isActive: formData.isActive,
  };
}

export function createCatalogueItemModalHandlers(
  dispatch: (action: CatalogueFormAction) => void,
  formData: CatalogueItemFormData,
  onSave: (payload: ReturnType<typeof buildCatalogueItemSavePayload>) => Promise<boolean>,
  onClose: () => void,
) {
  return {
    handleNameChange: (e: { target: { value: string } }) => {
      dispatch({ type: 'SET_NAME', name: e.target.value });
    },
    handleSlugChange: (e: { target: { value: string } }) => {
      dispatch({ type: 'SET_SLUG', slug: e.target.value });
    },
    handleCategoryChange: (e: { target: { value: string } }) => {
      dispatch({ type: 'SET_CATEGORY', category: e.target.value as CatalogueCategory });
    },
    handleUnitPriceChange: (e: { target: { value: string } }) => {
      dispatch({ type: 'SET_PRICE', unitPriceMajor: e.target.value });
    },
    handleTaxRatePresetChange: (e: { target: { value: string } }) => {
      dispatch({ type: 'SET_TAX_RATE_PRESET', preset: e.target.value });
    },
    handleCustomTaxRateChange: (e: { target: { value: string } }) => {
      dispatch({ type: 'SET_CUSTOM_TAX_RATE', percent: e.target.value });
    },
    handleDescriptionChange: (e: { target: { value: string } }) => {
      dispatch({ type: 'SET_DESCRIPTION', description: e.target.value });
    },
    handleSubmit: async (e?: { preventDefault: () => void }) => {
      e?.preventDefault();
      const validation = validateCatalogueItemForm(formData);
      if (!validation.isValid) {
        dispatch({ type: 'SET_ERRORS', errors: validation.errors });
        return false;
      }
      const payload = buildCatalogueItemSavePayload(formData);
      const ok = await onSave(payload);
      if (ok) {
        onClose();
      }
      return ok;
    },
    onSubmit: (e?: { preventDefault: () => void }) => {
      e?.preventDefault();
      void (async () => {
        const validation = validateCatalogueItemForm(formData);
        if (!validation.isValid) {
          dispatch({ type: 'SET_ERRORS', errors: validation.errors });
          return;
        }
        const payload = buildCatalogueItemSavePayload(formData);
        const ok = await onSave(payload);
        if (ok) {
          onClose();
        }
      })();
    },
  };
}

export function useCatalogueSectionHandlers(params: {
  triggerRef: { current: HTMLElement | null };
  setEditingItem: (item: CatalogueItem | null) => void;
  setIsModalOpen: (open: boolean) => void;
  setIsModalSubmitting: (submitting: boolean) => void;
  setCategoryFilter: (category: string) => void;
  setShowArchived: (updater: (prev: boolean) => boolean) => void;
  onSaveCatalogueItem: (
    payload: ReturnType<typeof buildCatalogueItemSavePayload>,
  ) => Promise<boolean>;
  onArchiveCatalogueItem: (id: string, isActive?: boolean) => Promise<boolean>;
  initialItems: CatalogueItem[];
}) {
  return {
    handleOpenCreateModal: (e: { currentTarget: HTMLElement }) => {
      params.triggerRef.current = e.currentTarget;
      params.setEditingItem(null);
      params.setIsModalOpen(true);
    },
    handleOpenEditModal: (item: CatalogueItem, e: { currentTarget: HTMLElement }) => {
      params.triggerRef.current = e.currentTarget;
      params.setEditingItem(item);
      params.setIsModalOpen(true);
    },
    handleSaveModal: async (payload: ReturnType<typeof buildCatalogueItemSavePayload>) => {
      params.setIsModalSubmitting(true);
      try {
        return await params.onSaveCatalogueItem(payload);
      } finally {
        params.setIsModalSubmitting(false);
      }
    },
    handleToggleArchive: async (item: CatalogueItem) => {
      await params.onArchiveCatalogueItem(item.id, !item.isActive);
    },
    onCategoryFilterChange: (e: { target: { value: string } }) => {
      params.setCategoryFilter(e.target.value);
    },
    onShowArchivedChange: () => {
      params.setShowArchived((prev) => !prev);
    },
    handleCloseModal: () => {
      params.setIsModalOpen(false);
    },
    onEditItemClick: (e: { currentTarget: { dataset: { itemId?: string } } }) => {
      const id = e.currentTarget.dataset.itemId;
      const item = params.initialItems.find((i) => i.id === id);
      if (item) {
        params.triggerRef.current = e.currentTarget as unknown as HTMLElement;
        params.setEditingItem(item);
        params.setIsModalOpen(true);
      }
    },
    onToggleArchiveClick: (e: { currentTarget: { dataset: { itemId?: string } } }) => {
      const id = e.currentTarget.dataset.itemId;
      const item = params.initialItems.find((i) => i.id === id);
      if (item) {
        void params.onArchiveCatalogueItem(item.id, !item.isActive);
      }
    },
  };
}

export const createCatalogueSectionHandlers = useCatalogueSectionHandlers;
