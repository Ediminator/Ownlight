import { calculateProposalTotals, type TaxCalculationResult } from '@/server/proposals/calculator';

export type PublicProposalLifecycleState = 'active' | 'expired' | 'revoked' | 'accepted';

export interface PublicLineItem {
  id: string;
  itemType: 'base_package' | 'addon' | 'custom';
  name: string;
  description?: string | null;
  unitPriceMinor: number;
  quantity: number;
  minQuantity: number;
  maxQuantity: number;
  taxRateBasisPoints: number;
  isOptional: boolean;
  isSelected: boolean;
  position: number;
}

export interface ClientItemSelection {
  isSelected: boolean;
  quantity: number;
}

/**
 * Resolves proposal lifecycle state based on commercial status, revocation, and expiration dates.
 */
export function resolveProposalLifecycleState(
  proposal: {
    status: string;
    tokenRevokedAt?: Date | string | null;
    validUntil?: Date | string | null;
  },
  now: Date = new Date(),
): PublicProposalLifecycleState {
  if (proposal.status === 'accepted') {
    return 'accepted';
  }
  if (proposal.tokenRevokedAt !== null && proposal.tokenRevokedAt !== undefined) {
    return 'revoked';
  }
  if (proposal.validUntil) {
    const validUntilDate = new Date(proposal.validUntil);
    if (validUntilDate.getTime() < now.getTime()) {
      return 'expired';
    }
  }
  return 'active';
}

/**
 * Formats an integer minor currency value into localized currency string.
 */
export function formatProposalCurrency(
  minorUnits: number,
  currency = 'EUR',
  locale = 'en',
): string {
  const amount = minorUnits / 100;
  try {
    return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `€${amount.toFixed(2)}`;
  }
}

/**
 * Formats an ISO date string or Date object into localized medium date.
 */
export function formatProposalDate(dateValue: Date | string, locale = 'en'): string {
  const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) {
    return String(dateValue);
  }
  try {
    return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-US', {
      dateStyle: 'medium',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Calculates real-time proposal totals based on user selections and quantities.
 */
export function calculateLiveTotals(
  items: PublicLineItem[],
  selections: Record<string, ClientItemSelection>,
  options: {
    pricesIncludeTax: boolean;
    isKleinunternehmer: boolean;
  },
): TaxCalculationResult {
  const calculationItems = items.map((item) => {
    const userSelection = selections[item.id];
    let isSelected = item.isSelected;
    let quantity = item.quantity;

    if (item.itemType === 'base_package') {
      isSelected = true;
      quantity = Math.max(1, item.quantity);
    } else if (item.isOptional) {
      if (userSelection) {
        isSelected = userSelection.isSelected;
        quantity = userSelection.quantity;
      }
    } else {
      isSelected = true;
    }

    return {
      unitPriceMinor: item.unitPriceMinor,
      quantity,
      taxRateBasisPoints: item.taxRateBasisPoints,
      isSelected,
    };
  });

  return calculateProposalTotals(calculationItems, options);
}

export interface AcceptanceFormErrors {
  name?: string;
  email?: string;
  agreement?: string;
}

/**
 * Validates the acceptance modal inputs.
 */
export function validateAcceptanceForm(
  name: string,
  email: string,
  agreement: boolean,
  t: (key: string) => string,
): { valid: boolean; errors: AcceptanceFormErrors } {
  const errors: AcceptanceFormErrors = {};

  const cleanName = name.trim();
  if (!cleanName) {
    errors.name = t('nameRequired');
  }

  const cleanEmail = email.trim();
  if (!cleanEmail) {
    errors.email = t('emailRequired');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    errors.email = t('emailInvalid');
  }

  if (!agreement) {
    errors.agreement = t('agreementRequired');
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Toggles an optional add-on selection state.
 */
export function applyAddonToggle(
  currentSelections: Record<string, ClientItemSelection>,
  id: string,
  checked: boolean,
): Record<string, ClientItemSelection> {
  const existing = Reflect.get(currentSelections, id) as ClientItemSelection | undefined;
  const current = existing ?? { isSelected: false, quantity: 1 };
  return {
    ...currentSelections,
    [id]: {
      ...current,
      isSelected: checked,
    },
  };
}

/**
 * Adjusts quantity for an item within its minQuantity and maxQuantity limits.
 */
export function applyQuantityChange(
  currentSelections: Record<string, ClientItemSelection>,
  item: PublicLineItem,
  delta: number,
): Record<string, ClientItemSelection> {
  const existing = Reflect.get(currentSelections, item.id) as ClientItemSelection | undefined;
  const current = existing ?? { isSelected: true, quantity: item.quantity };
  const newQty = Math.max(item.minQuantity, Math.min(item.maxQuantity, current.quantity + delta));
  return {
    ...currentSelections,
    [item.id]: {
      ...current,
      quantity: newQty,
      isSelected: newQty > 0 ? true : current.isSelected,
    },
  };
}

/**
 * Builds acceptance server action payload from user selections and line items.
 */
export function buildAcceptProposalPayload(
  token: string,
  name: string,
  email: string,
  selections: Record<string, ClientItemSelection>,
  lineItems: PublicLineItem[],
) {
  const selectedOptions = Object.entries(selections)
    .filter(([id, sel]) => {
      const item = lineItems.find((i) => i.id === id);
      return sel.isSelected && item?.itemType !== 'base_package';
    })
    .map(([id, sel]) => ({
      id,
      quantity: sel.quantity,
    }));

  return {
    token,
    acceptedByName: name.trim(),
    acceptedByEmail: email.trim(),
    selectedOptions,
    agreementConfirmed: true,
  };
}

export interface AcceptanceModalFormState {
  name: string;
  email: string;
  agreement: boolean;
  touched: boolean;
  errors: AcceptanceFormErrors;
}

export function createInitialModalFormState(
  defaultName = '',
  defaultEmail = '',
): AcceptanceModalFormState {
  return {
    name: defaultName,
    email: defaultEmail,
    agreement: false,
    touched: false,
    errors: {},
  };
}

export type ModalFormAction =
  | { type: 'CHANGE_NAME'; value: string; t: (k: string) => string }
  | { type: 'CHANGE_EMAIL'; value: string; t: (k: string) => string }
  | { type: 'CHANGE_AGREEMENT'; value: boolean; t: (k: string) => string }
  | { type: 'SET_DEFAULTS'; defaultName: string; defaultEmail: string }
  | { type: 'SUBMIT_ATTEMPT'; t: (k: string) => string };

export function modalFormReducer(
  state: AcceptanceModalFormState,
  action: ModalFormAction,
): AcceptanceModalFormState {
  switch (action.type) {
    case 'CHANGE_NAME': {
      const errors = state.touched
        ? validateAcceptanceForm(action.value, state.email, state.agreement, action.t).errors
        : state.errors;
      return { ...state, name: action.value, errors };
    }
    case 'CHANGE_EMAIL': {
      const errors = state.touched
        ? validateAcceptanceForm(state.name, action.value, state.agreement, action.t).errors
        : state.errors;
      return { ...state, email: action.value, errors };
    }
    case 'CHANGE_AGREEMENT': {
      const errors = state.touched
        ? validateAcceptanceForm(state.name, state.email, action.value, action.t).errors
        : state.errors;
      return { ...state, agreement: action.value, errors };
    }
    case 'SET_DEFAULTS': {
      return {
        ...state,
        name: state.name || action.defaultName,
        email: state.email || action.defaultEmail,
      };
    }
    case 'SUBMIT_ATTEMPT': {
      const validation = validateAcceptanceForm(state.name, state.email, state.agreement, action.t);
      return {
        ...state,
        touched: true,
        errors: validation.errors,
      };
    }
    default:
      return state;
  }
}

export interface ModalControllerParams {
  state: AcceptanceModalFormState;
  dispatch: (action: ModalFormAction) => void;
  t: (k: string) => string;
  triggerRef?: { current: { focus: () => void } | null } | null;
  onClose?: () => void;
  onSubmit: (data: { name: string; email: string }) => Promise<void> | void;
}

export function createAcceptanceModalController(params: ModalControllerParams) {
  const { state, dispatch, t, triggerRef, onClose, onSubmit } = params;

  return {
    handleOpenChange: (open: boolean) => {
      if (!open && onClose) onClose();
    },
    handleNameChange: (e: { target: { value: string } } | string) => {
      const value = typeof e === 'string' ? e : e.target.value;
      dispatch({ type: 'CHANGE_NAME', value, t });
    },
    handleEmailChange: (e: { target: { value: string } } | string) => {
      const value = typeof e === 'string' ? e : e.target.value;
      dispatch({ type: 'CHANGE_EMAIL', value, t });
    },
    handleAgreementChange: (e: { target: { checked: boolean } } | boolean) => {
      const value = typeof e === 'boolean' ? e : e.target.checked;
      dispatch({ type: 'CHANGE_AGREEMENT', value, t });
    },
    handleCloseAutoFocus: (e: { preventDefault: () => void }) => {
      e.preventDefault();
      triggerRef?.current?.focus();
    },
    handleSubmit: async (e?: { preventDefault: () => void }) => {
      e?.preventDefault();
      dispatch({ type: 'SUBMIT_ATTEMPT', t });
      const validation = validateAcceptanceForm(state.name, state.email, state.agreement, t);
      if (!validation.valid) {
        return false;
      }
      await onSubmit({ name: state.name.trim(), email: state.email.trim() });
      return true;
    },
  };
}

export interface ViewControllerParams {
  token: string;
  lineItems: PublicLineItem[];
  setSelections: (
    updater: (prev: Record<string, ClientItemSelection>) => Record<string, ClientItemSelection>,
  ) => void;
  setIsSubmitting: (submitting: boolean) => void;
  setServerError: (error: string | null) => void;
  setModalOpen: (open: boolean) => void;
  setCurrentStatus: (status: string) => void;
  setAcceptedDetails: (details: {
    acceptedAt: string;
    acceptedByName: string;
    acceptedByEmail: string;
  }) => void;
  acceptAction: (payload: {
    token: string;
    acceptedByName: string;
    acceptedByEmail: string;
    selectedOptions: { id: string; quantity: number }[];
    agreementConfirmed: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
}

export function createProposalViewController(params: ViewControllerParams) {
  const {
    token,
    lineItems,
    setSelections,
    setIsSubmitting,
    setServerError,
    setModalOpen,
    setCurrentStatus,
    setAcceptedDetails,
    acceptAction,
  } = params;

  return {
    handleOpenModal: () => {
      setModalOpen(true);
    },
    handleCloseModal: () => {
      setModalOpen(false);
    },
    handleToggleAddon: (id: string, checked: boolean) => {
      setSelections((prev) => applyAddonToggle(prev, id, checked));
    },
    handleToggleAddonById: (e: {
      currentTarget: { getAttribute: (name: string) => string | null; checked: boolean };
    }) => {
      const id = e.currentTarget.getAttribute('data-item-id');
      const isChecked = e.currentTarget.checked;
      if (id) {
        setSelections((prev) => applyAddonToggle(prev, id, isChecked));
      }
    },
    handleQuantityChange: (id: string, delta: number) => {
      const item = lineItems.find((i) => i.id === id);
      if (!item) return;
      setSelections((prev) => applyQuantityChange(prev, item, delta));
    },
    handleDecreaseQuantity: (e: {
      currentTarget: { getAttribute: (name: string) => string | null };
    }) => {
      const id = e.currentTarget.getAttribute('data-item-id');
      if (!id) return;
      const item = lineItems.find((i) => i.id === id);
      if (item) {
        setSelections((prev) => applyQuantityChange(prev, item, -1));
      }
    },
    handleIncreaseQuantity: (e: {
      currentTarget: { getAttribute: (name: string) => string | null };
    }) => {
      const id = e.currentTarget.getAttribute('data-item-id');
      if (!id) return;
      const item = lineItems.find((i) => i.id === id);
      if (item) {
        setSelections((prev) => applyQuantityChange(prev, item, 1));
      }
    },
    handleAcceptSubmit: async (
      formData: { name: string; email: string },
      selections: Record<string, ClientItemSelection>,
    ) => {
      setIsSubmitting(true);
      setServerError(null);

      const payload = buildAcceptProposalPayload(
        token,
        formData.name,
        formData.email,
        selections,
        lineItems,
      );

      try {
        const result = await acceptAction(payload);
        if (result.success) {
          setModalOpen(false);
          setCurrentStatus('accepted');
          setAcceptedDetails({
            acceptedAt: new Date().toISOString(),
            acceptedByName: formData.name,
            acceptedByEmail: formData.email,
          });
          return { success: true };
        } else {
          setServerError(result.error ?? 'Failed to accept proposal');
          return { success: false, error: result.error };
        }
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : 'Internal error processing acceptance';
        setServerError(errorMsg);
        return { success: false, error: errorMsg };
      } finally {
        setIsSubmitting(false);
      }
    },
  };
}
