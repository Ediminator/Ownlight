import { generateSlug } from '@/lib/slug';
import { convertPriceMajorToMinor, convertPriceMinorToMajorString } from '@/lib/currency';
import { SLUG_REGEX, type PackageIncludedItemInput } from '@/server/packages/schema';
import type { PackageWithIncludedItems } from '@/server/packages/repo';
import type { CatalogueItem } from '@/server/db/schema/packages';
import type { StudioSettings } from '@/server/db/schema/studio-settings';

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
export function validatePackageForm(
  data: PackageFormData,
  t?: (key: string) => string,
): {
  isValid: boolean;
  errors: PackageFormErrors;
} {
  const errors: PackageFormErrors = {};

  if (!data.name.trim()) {
    errors.name = t ? t('modal.errors.titleRequired') : 'Package title is required';
  }

  const slug = data.slug.trim();
  if (!slug) {
    errors.slug = t ? t('modal.errors.slugRequired') : 'Slug is required';
  } else if (!SLUG_REGEX.test(slug)) {
    errors.slug = t
      ? t('modal.errors.slugInvalid')
      : 'Slug must be kebab-case (lowercase letters, numbers, and single hyphens)';
  }

  const minor = convertPriceMajorToMinor(data.basePriceMajor);
  if (minor === undefined || minor < 0) {
    errors.basePrice = t
      ? t('modal.errors.priceInvalid')
      : 'Base price must be a non-negative number';
  }

  if (
    typeof data.taxRateBasisPoints !== 'number' ||
    !Number.isInteger(data.taxRateBasisPoints) ||
    data.taxRateBasisPoints < 0 ||
    data.taxRateBasisPoints > 10000
  ) {
    errors.taxRate = t ? t('modal.errors.taxRateInvalid') : 'Tax rate must be between 0% and 100%';
  }

  const deliverableErrors: Record<number, { title?: string; quantity?: string }> = {};
  data.includedItems.forEach((item, index) => {
    const itemErrors: { title?: string; quantity?: string } = {};
    if (!item.title.trim()) {
      itemErrors.title = t
        ? t('modal.errors.deliverableTitleRequired')
        : 'Deliverable title is required';
    }
    if (typeof item.quantity !== 'number' || item.quantity < 1) {
      itemErrors.quantity = t
        ? t('modal.errors.deliverableQuantityInvalid')
        : 'Quantity must be at least 1';
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

export interface PackageFormState {
  formData: PackageFormData;
  errors: PackageFormErrors;
  isSlugManuallyEdited: boolean;
}

export type PackageFormAction =
  | { type: 'SET_TITLE'; title: string }
  | { type: 'SET_SLUG'; slug: string }
  | { type: 'SET_PROJECT_TYPE'; projectTypeKey: string }
  | { type: 'SET_BASE_PRICE'; basePriceMajor: string }
  | { type: 'SET_TAX_RATE_PRESET'; preset: string }
  | { type: 'SET_CUSTOM_TAX_RATE'; percent: string }
  | { type: 'SET_DESCRIPTION'; description: string }
  | { type: 'ADD_DELIVERABLE' }
  | { type: 'UPDATE_DELIVERABLE_TITLE'; index: number; title: string }
  | { type: 'UPDATE_DELIVERABLE_DESC'; index: number; description: string }
  | { type: 'UPDATE_DELIVERABLE_QTY'; index: number; quantity: number }
  | { type: 'REMOVE_DELIVERABLE'; index: number }
  | { type: 'MOVE_DELIVERABLE'; from: number; to: number }
  | { type: 'SET_ERRORS'; errors: PackageFormErrors }
  | { type: 'RESET'; pkg: PackageWithIncludedItems | null };

export function initPackageFormState(pkg?: PackageWithIncludedItems | null): PackageFormState {
  return {
    formData: packageToFormData(pkg),
    errors: {},
    isSlugManuallyEdited: Boolean(pkg?.slug),
  };
}

export function packageFormReducer(
  state: PackageFormState,
  action: PackageFormAction,
): PackageFormState {
  switch (action.type) {
    case 'SET_TITLE': {
      const computedSlug = computeSlugFromTitle(
        action.title,
        state.formData.slug,
        state.isSlugManuallyEdited,
      );
      return {
        ...state,
        formData: {
          ...state.formData,
          name: action.title,
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
    case 'SET_PROJECT_TYPE': {
      return {
        ...state,
        formData: {
          ...state.formData,
          projectTypeKey: action.projectTypeKey,
        },
      };
    }
    case 'SET_BASE_PRICE': {
      return {
        ...state,
        formData: {
          ...state.formData,
          basePriceMajor: action.basePriceMajor,
        },
        errors: state.errors.basePrice ? { ...state.errors, basePrice: undefined } : state.errors,
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
    case 'ADD_DELIVERABLE': {
      return {
        ...state,
        formData: {
          ...state.formData,
          includedItems: [
            ...state.formData.includedItems,
            {
              title: '',
              description: '',
              quantity: 1,
              position: state.formData.includedItems.length,
            },
          ],
        },
      };
    }
    case 'UPDATE_DELIVERABLE_TITLE': {
      const updated = state.formData.includedItems.map((item, i) =>
        i === action.index ? { ...item, title: action.title } : item,
      );
      let newDeliverablesErrors = state.errors.deliverables;
      if (newDeliverablesErrors?.[action.index]) {
        const rest = Object.fromEntries(
          Object.entries(newDeliverablesErrors).filter(([key]) => key !== action.index.toString()),
        );
        newDeliverablesErrors = Object.keys(rest).length > 0 ? rest : undefined;
      }
      return {
        ...state,
        formData: { ...state.formData, includedItems: updated },
        errors: { ...state.errors, deliverables: newDeliverablesErrors },
      };
    }
    case 'UPDATE_DELIVERABLE_DESC': {
      const updated = state.formData.includedItems.map((item, i) =>
        i === action.index ? { ...item, description: action.description } : item,
      );
      return {
        ...state,
        formData: { ...state.formData, includedItems: updated },
      };
    }
    case 'UPDATE_DELIVERABLE_QTY': {
      const updated = state.formData.includedItems.map((item, i) =>
        i === action.index ? { ...item, quantity: action.quantity } : item,
      );
      return {
        ...state,
        formData: { ...state.formData, includedItems: updated },
      };
    }
    case 'REMOVE_DELIVERABLE': {
      const filtered = state.formData.includedItems.filter((_, i) => i !== action.index);
      return {
        ...state,
        formData: {
          ...state.formData,
          includedItems: filtered.map((item, idx) => ({ ...item, position: idx })),
        },
      };
    }
    case 'MOVE_DELIVERABLE': {
      return {
        ...state,
        formData: {
          ...state.formData,
          includedItems: moveDeliverable(state.formData.includedItems, action.from, action.to),
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
      return initPackageFormState(action.pkg);
    }
    default:
      return state;
  }
}

export function buildPackageSavePayload(formData: PackageFormData) {
  const minor = convertPriceMajorToMinor(formData.basePriceMajor) ?? 0;
  return {
    id: formData.id,
    name: formData.name.trim(),
    slug: formData.slug.trim(),
    projectTypeKey: formData.projectTypeKey.trim() ? formData.projectTypeKey.trim() : null,
    basePriceMinor: minor,
    taxRateBasisPoints: formData.taxRateBasisPoints,
    description: formData.description.trim() ? formData.description.trim() : null,
    includedItems: formData.includedItems.map((item, idx) => ({
      id: item.id,
      title: item.title.trim(),
      description: item.description?.trim() ? item.description.trim() : null,
      quantity: item.quantity,
      position: idx,
    })),
  };
}

export function createModalDialogHandlers(
  onClose: () => void,
  triggerRef?: { current: { focus: () => void } | null } | null,
) {
  return {
    onOpenChange: (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    onCloseAutoFocus: (e: { preventDefault: () => void }) => {
      e.preventDefault();
      triggerRef?.current?.focus();
    },
  };
}

export function handleDeliverableFieldChange(
  dispatch: (action: PackageFormAction) => void,
  index: number,
  field: 'title' | 'description' | 'quantity',
  value: string | number,
) {
  if (field === 'title') {
    dispatch({ type: 'UPDATE_DELIVERABLE_TITLE', index, title: String(value) });
  } else if (field === 'description') {
    dispatch({ type: 'UPDATE_DELIVERABLE_DESC', index, description: String(value) });
  } else {
    dispatch({ type: 'UPDATE_DELIVERABLE_QTY', index, quantity: Number(value) || 1 });
  }
}

export function handleDeliverableReorderOrRemove(
  dispatch: (action: PackageFormAction) => void,
  action: 'up' | 'down' | 'remove',
  index: number,
) {
  if (action === 'up') {
    dispatch({ type: 'MOVE_DELIVERABLE', from: index, to: index - 1 });
  } else if (action === 'down') {
    dispatch({ type: 'MOVE_DELIVERABLE', from: index, to: index + 1 });
  } else {
    dispatch({ type: 'REMOVE_DELIVERABLE', index });
  }
}

export function createDeliverableRowHandlers(
  dispatch: (action: PackageFormAction) => void,
  index: number,
) {
  return {
    onTitleChange: (e: { target: { value: string } }) => {
      handleDeliverableFieldChange(dispatch, index, 'title', e.target.value);
    },
    onQtyChange: (e: { target: { value: string } }) => {
      handleDeliverableFieldChange(dispatch, index, 'quantity', e.target.value);
    },
    onDescChange: (e: { target: { value: string } }) => {
      handleDeliverableFieldChange(dispatch, index, 'description', e.target.value);
    },
    onMoveUp: () => {
      handleDeliverableReorderOrRemove(dispatch, 'up', index);
    },
    onMoveDown: () => {
      handleDeliverableReorderOrRemove(dispatch, 'down', index);
    },
    onRemove: () => {
      handleDeliverableReorderOrRemove(dispatch, 'remove', index);
    },
  };
}

export function createPackageModalHandlers(
  dispatch: (action: PackageFormAction) => void,
  formData: PackageFormData,
  onSave: (payload: ReturnType<typeof buildPackageSavePayload>) => Promise<boolean>,
  onClose: () => void,
  t?: (key: string) => string,
) {
  return {
    handleTitleChange: (e: { target: { value: string } }) => {
      dispatch({ type: 'SET_TITLE', title: e.target.value });
    },
    handleSlugChange: (e: { target: { value: string } }) => {
      dispatch({ type: 'SET_SLUG', slug: e.target.value });
    },
    handleProjectTypeChange: (e: { target: { value: string } }) => {
      dispatch({ type: 'SET_PROJECT_TYPE', projectTypeKey: e.target.value });
    },
    handleBasePriceChange: (e: { target: { value: string } }) => {
      dispatch({ type: 'SET_BASE_PRICE', basePriceMajor: e.target.value });
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
    handleAddDeliverable: () => {
      dispatch({ type: 'ADD_DELIVERABLE' });
    },
    handleSubmit: async (e?: { preventDefault: () => void }) => {
      e?.preventDefault();
      const validation = validatePackageForm(formData, t);
      if (!validation.isValid) {
        dispatch({ type: 'SET_ERRORS', errors: validation.errors });
        return false;
      }
      const payload = buildPackageSavePayload(formData);
      const ok = await onSave(payload);
      if (ok) {
        onClose();
      }
      return ok;
    },
    onSubmit: (e?: { preventDefault: () => void }) => {
      e?.preventDefault();
      void (async () => {
        const validation = validatePackageForm(formData, t);
        if (!validation.isValid) {
          dispatch({ type: 'SET_ERRORS', errors: validation.errors });
          return;
        }
        const payload = buildPackageSavePayload(formData);
        const ok = await onSave(payload);
        if (ok) {
          onClose();
        }
      })();
    },
  };
}

export function createArchiveDialogHandlers<T>(
  onClose: () => void,
  onConfirm: (item: T) => void,
  item: T | null,
  triggerRef?: { current: { focus: () => void } | null } | null,
) {
  const modal = createModalDialogHandlers(onClose, triggerRef);
  return {
    ...modal,
    handleConfirm: () => {
      if (item) onConfirm(item);
    },
  };
}

export function usePackagesSectionHandlers(params: {
  triggerRef: { current: HTMLElement | null };
  setEditingPackage: (pkg: PackageWithIncludedItems | null) => void;
  setIsModalOpen: (open: boolean) => void;
  setArchivingPackage: (pkg: PackageWithIncludedItems | null) => void;
  setIsModalSubmitting: (submitting: boolean) => void;
  setIsArchiveSubmitting: (submitting: boolean) => void;
  setTypeFilter: (filter: string) => void;
  setShowArchived: (updater: (prev: boolean) => boolean) => void;
  onSavePackage: (payload: ReturnType<typeof buildPackageSavePayload>) => Promise<boolean>;
  onArchivePackage: (id: string, isActive?: boolean) => Promise<boolean>;
  initialPackages: PackageWithIncludedItems[];
}) {
  const handleConfirmArchive = async (pkg: PackageWithIncludedItems) => {
    params.setIsArchiveSubmitting(true);
    try {
      await params.onArchivePackage(pkg.id, false);
      params.setArchivingPackage(null);
    } finally {
      params.setIsArchiveSubmitting(false);
    }
  };

  return {
    handleOpenCreateModal: (e: { currentTarget: HTMLElement }) => {
      params.triggerRef.current = e.currentTarget;
      params.setEditingPackage(null);
      params.setIsModalOpen(true);
    },
    handleOpenEditModal: (pkg: PackageWithIncludedItems, e: { currentTarget: HTMLElement }) => {
      params.triggerRef.current = e.currentTarget;
      params.setEditingPackage(pkg);
      params.setIsModalOpen(true);
    },
    handleOpenArchiveDialog: (pkg: PackageWithIncludedItems, e: { currentTarget: HTMLElement }) => {
      params.triggerRef.current = e.currentTarget;
      params.setArchivingPackage(pkg);
    },
    handleSaveModal: async (payload: ReturnType<typeof buildPackageSavePayload>) => {
      params.setIsModalSubmitting(true);
      try {
        return await params.onSavePackage(payload);
      } finally {
        params.setIsModalSubmitting(false);
      }
    },
    handleConfirmArchive,
    onConfirmArchive: (pkg: PackageWithIncludedItems) => {
      void handleConfirmArchive(pkg);
    },
    handleRestore: async (pkgId: string) => {
      await params.onArchivePackage(pkgId, true);
    },
    onTypeFilterChange: (e: { target: { value: string } }) => {
      params.setTypeFilter(e.target.value);
    },
    onToggleShowArchived: () => {
      params.setShowArchived((prev) => !prev);
    },
    onCloseModal: () => {
      params.setIsModalOpen(false);
    },
    onCloseArchiveDialog: () => {
      params.setArchivingPackage(null);
    },
    onEditPackageClick: (e: {
      currentTarget: { dataset: { pkgId?: string; packageId?: string } };
    }) => {
      const id = e.currentTarget.dataset.pkgId ?? e.currentTarget.dataset.packageId;
      const pkg = params.initialPackages.find((p) => p.id === id);
      if (pkg) {
        params.triggerRef.current = e.currentTarget as unknown as HTMLElement;
        params.setEditingPackage(pkg);
        params.setIsModalOpen(true);
      }
    },
    onArchivePackageClick: (e: {
      currentTarget: { dataset: { pkgId?: string; packageId?: string } };
    }) => {
      const id = e.currentTarget.dataset.pkgId ?? e.currentTarget.dataset.packageId;
      const pkg = params.initialPackages.find((p) => p.id === id);
      if (pkg) {
        params.triggerRef.current = e.currentTarget as unknown as HTMLElement;
        params.setArchivingPackage(pkg);
      }
    },
    onRestorePackageClick: (e: {
      currentTarget: { dataset: { pkgId?: string; packageId?: string } };
    }) => {
      const id = e.currentTarget.dataset.pkgId ?? e.currentTarget.dataset.packageId;
      if (id) {
        void params.onArchivePackage(id, true);
      }
    },
  };
}

export const createPackagesSectionHandlers = usePackagesSectionHandlers;

export function createPackagesViewHandlers(
  setActiveTab: (tab: 'packages' | 'catalogue' | 'tax') => void,
) {
  const tabs = ['packages', 'catalogue', 'tax'] as const;
  return {
    onTabClick: (e: { currentTarget: { dataset: { tab?: string } } }) => {
      const tab = e.currentTarget.dataset.tab as 'packages' | 'catalogue' | 'tax' | undefined;
      if (tab) setActiveTab(tab);
    },
    onTabKeyDown: (e: { key: string; currentTarget: { dataset: { index?: string } } }) => {
      const currentIndex = parseInt(e.currentTarget.dataset.index ?? '0', 10);
      let targetIndex = -1;
      if (e.key === 'ArrowRight') targetIndex = (currentIndex + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') targetIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') targetIndex = 0;
      else if (e.key === 'End') targetIndex = tabs.length - 1;

      if (targetIndex >= 0) {
        const nextTab = tabs[targetIndex];
        if (nextTab) {
          setActiveTab(nextTab);
          if (typeof document !== 'undefined') {
            const btn = document.getElementById(`tab-${nextTab}`);
            btn?.focus();
          }
        }
      }
    },
  };
}

export function createPackagesViewActionHandlers(params: {
  setPackagesList: (
    updater: (prev: PackageWithIncludedItems[]) => PackageWithIncludedItems[],
  ) => void;
  setCatalogueList: (updater: (prev: CatalogueItem[]) => CatalogueItem[]) => void;
  setTaxSettings: (settings: StudioSettings) => void;
  router: { refresh: () => void };
  savePackageAction: (
    payload: ReturnType<typeof buildPackageSavePayload>,
  ) => Promise<{ success: boolean; data?: PackageWithIncludedItems }>;
  archivePackageAction: (payload: {
    id: string;
    isActive?: boolean;
  }) => Promise<{ success: boolean }>;
  saveCatalogueItemAction: (payload: {
    id?: string;
    name: string;
    slug: string;
    category: CatalogueItem['category'];
    unitPriceMinor: number;
    taxRateBasisPoints: number;
    description: string | null;
    isActive: boolean;
  }) => Promise<{ success: boolean; data?: CatalogueItem }>;
  archiveCatalogueItemAction: (payload: {
    id: string;
    isActive?: boolean;
  }) => Promise<{ success: boolean }>;
  updateStudioTaxSettingsAction: (payload: {
    taxNumber?: string | null;
    vatId?: string | null;
    isKleinunternehmer?: boolean;
    kleinunternehmerNotice?: string | null;
    defaultTaxRateBasisPoints?: number;
    pricesIncludeTax?: boolean;
  }) => Promise<{ success: boolean; data?: StudioSettings }>;
}) {
  return {
    handleSavePackage: async (payload: ReturnType<typeof buildPackageSavePayload>) => {
      const res = await params.savePackageAction(payload);
      if (res.success && res.data) {
        const saved = res.data;
        params.setPackagesList((prev) => {
          const index = prev.findIndex((p) => p.id === saved.id);
          if (index >= 0) {
            return prev.map((p, i) => (i === index ? saved : p));
          }
          return [saved, ...prev];
        });
        params.router.refresh();
        return true;
      }
      return false;
    },
    handleArchivePackage: async (id: string, isActive = false) => {
      const res = await params.archivePackageAction({ id, isActive });
      if (res.success) {
        params.setPackagesList((prev) =>
          prev.map((pkg) => (pkg.id === id ? { ...pkg, isActive } : pkg)),
        );
        params.router.refresh();
        return true;
      }
      return false;
    },
    handleSaveCatalogueItem: async (payload: {
      id?: string;
      name: string;
      slug: string;
      category: CatalogueItem['category'];
      unitPriceMinor: number;
      taxRateBasisPoints: number;
      description: string | null;
      isActive: boolean;
    }) => {
      const res = await params.saveCatalogueItemAction(payload);
      if (res.success && res.data) {
        const saved = res.data;
        params.setCatalogueList((prev) => {
          const index = prev.findIndex((i) => i.id === saved.id);
          if (index >= 0) {
            return prev.map((item, i) => (i === index ? saved : item));
          }
          return [saved, ...prev];
        });
        params.router.refresh();
        return true;
      }
      return false;
    },
    handleArchiveCatalogueItem: async (id: string, isActive = false) => {
      const res = await params.archiveCatalogueItemAction({ id, isActive });
      if (res.success) {
        params.setCatalogueList((prev) =>
          prev.map((item) => (item.id === id ? { ...item, isActive } : item)),
        );
        params.router.refresh();
        return true;
      }
      return false;
    },
    handleUpdateTaxSettings: async (payload: {
      taxNumber?: string | null;
      vatId?: string | null;
      isKleinunternehmer?: boolean;
      kleinunternehmerNotice?: string | null;
      defaultTaxRateBasisPoints?: number;
      pricesIncludeTax?: boolean;
    }) => {
      const res = await params.updateStudioTaxSettingsAction(payload);
      if (res.success && res.data) {
        params.setTaxSettings(res.data);
        params.router.refresh();
        return true;
      }
      return false;
    },
  };
}
