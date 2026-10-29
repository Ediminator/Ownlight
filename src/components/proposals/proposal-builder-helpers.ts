import type { Dispatch } from 'react';
import { convertPriceMajorToMinor, convertPriceMinorToMajorString } from '@/lib/currency';

export function generateClientRowId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  const ts = BigInt(Date.now());
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  // Version 7: 0b0111xxxx
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  // Variant: 0b10xxxxxx
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
import { calculateProposalTotals, type TaxCalculationResult } from '@/server/proposals/calculator';
import type { ProposalWithLineItems } from '@/server/proposals/repo';
import type { PackageWithIncludedItems } from '@/server/packages/repo';
import type { CatalogueItem } from '@/server/db/schema/packages';
import type { SaveDraftProposalInput, SendProposalInput } from '@/server/proposals/schema';
import type { ProposalActionResult } from '@/server/proposals/actions';
import type { SendProposalResult } from '@/server/proposals/service';

export interface DeliverableItemState {
  id: string;
  title: string;
  quantity: number;
}

export interface ProposalLineItemState {
  id?: string;
  packageId?: string | null;
  catalogueItemId?: string | null;
  itemType: 'base_package' | 'addon' | 'custom';
  name: string;
  description?: string | null;
  unitPriceMinor: number;
  unitPriceMajor: string;
  quantity: number;
  minQuantity: number;
  maxQuantity: number;
  taxRateBasisPoints: number;
  isOptional: boolean;
  isSelected: boolean;
  position: number;
}

export interface ProposalBuilderState {
  id?: string;
  projectId: string;
  clientId: string;
  title: string;
  currency: string;
  pricesIncludeTax: boolean;
  isKleinunternehmer: boolean;
  taxNotice?: string | null;
  validUntil?: string | null;
  internalNotes?: string | null;
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'superseded';

  // Base Package details
  selectedPackageId: string | null;
  basePackageItem: ProposalLineItemState | null;
  deliverables: DeliverableItemState[];

  // Attached Line Items (Addons & Custom)
  addonItems: ProposalLineItemState[];

  // Send modal state
  sendModalOpen: boolean;
  sendModalDate: string; // YYYY-MM-DD
  sendModalEmail: string;

  // Sent link / banner state
  sentResult: SendProposalResult | null;
  linkCopied: boolean;

  // Status flags
  isSaving: boolean;
  isSending: boolean;
  generalError?: string | null;
  saveSuccess: boolean;
}

export interface ProposalBuilderErrors {
  title?: string;
  basePackage?: { unitPrice?: string };
  items?: Record<number, { name?: string; unitPrice?: string }>;
  sendDate?: string;
  sendEmail?: string;
  general?: string;
}

export type ProposalBuilderAction =
  | { type: 'SET_TITLE'; title: string }
  | { type: 'SELECT_PACKAGE'; pkg: PackageWithIncludedItems | null }
  | { type: 'UPDATE_BASE_PACKAGE_PRICE'; majorPrice: string }
  | { type: 'UPDATE_BASE_PACKAGE_TAX_RATE'; taxRateBasisPoints: number }
  | { type: 'ADD_DELIVERABLE'; title: string; quantity?: number }
  | { type: 'UPDATE_DELIVERABLE_TITLE'; index: number; title: string }
  | { type: 'UPDATE_DELIVERABLE_QTY'; index: number; quantity: number }
  | { type: 'REMOVE_DELIVERABLE'; index: number }
  | { type: 'ADD_CATALOGUE_ADDON'; item: CatalogueItem }
  | { type: 'ADD_CUSTOM_ITEM' }
  | {
      type: 'UPDATE_ITEM_FIELD';
      index: number;
      field: keyof ProposalLineItemState;
      value: unknown;
    }
  | { type: 'MOVE_ITEM'; from: number; to: number }
  | { type: 'REMOVE_ITEM'; index: number }
  | { type: 'SET_SEND_MODAL_OPEN'; open: boolean }
  | { type: 'SET_SEND_MODAL_DATE'; date: string }
  | { type: 'SET_SEND_MODAL_EMAIL'; email: string }
  | { type: 'SET_SAVING'; saving: boolean }
  | { type: 'SET_SENDING'; sending: boolean }
  | { type: 'SET_SENT_RESULT'; result: SendProposalResult | null }
  | { type: 'SET_LINK_COPIED'; copied: boolean }
  | { type: 'SET_SAVE_SUCCESS'; success: boolean }
  | { type: 'SET_GENERAL_ERROR'; error?: string | null }
  | { type: 'SET_SAVED_PROPOSAL'; id: string; status: ProposalBuilderState['status'] };

export function getDefaultExpirationDateString(now = new Date()): string {
  const future = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  return future.toISOString().split('T')[0] ?? '';
}

export function formatDeliverablesDescription(
  baseDescription: string | null | undefined,
  deliverables: DeliverableItemState[],
): string {
  const parts: string[] = [];
  if (baseDescription?.trim()) {
    parts.push(baseDescription.trim());
  }
  if (deliverables.length > 0) {
    parts.push(
      'Included Deliverables:\n' +
        deliverables
          .map((d) => `• ${d.quantity > 1 ? `${String(d.quantity)}x ` : ''}${d.title}`)
          .join('\n'),
    );
  }
  return parts.join('\n\n');
}

export function parseDeliverablesFromDescription(
  description: string | null | undefined,
): DeliverableItemState[] {
  if (!description) return [];
  const lines = description.split('\n');
  const deliverables: DeliverableItemState[] = [];
  let readingDeliverables = false;
  const qtyRegex = /^(\d+)x\s+(.+)$/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.toLowerCase().includes('included deliverables:')) {
      readingDeliverables = true;
      continue;
    }
    if (readingDeliverables) {
      if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*')) {
        const itemText = line.replace(/^[•\-*]\s*/, '').trim();
        const qtyMatch = qtyRegex.exec(itemText);
        if (qtyMatch?.[1] && qtyMatch[2]) {
          deliverables.push({
            id: generateClientRowId(),
            title: qtyMatch[2].trim(),
            quantity: parseInt(qtyMatch[1], 10) || 1,
          });
        } else {
          deliverables.push({
            id: generateClientRowId(),
            title: itemText,
            quantity: 1,
          });
        }
      }
    }
  }

  return deliverables;
}

export interface InitialStateParams {
  project: {
    id: string;
    title: string;
    projectTypeKey?: string | null;
    currency?: string;
  };
  client: {
    id: string;
    displayName: string;
    email?: string | null;
    phone?: string | null;
  };
  studioSettings: {
    currency: string;
    isKleinunternehmer: boolean;
    pricesIncludeTax: boolean;
    defaultTaxRateBasisPoints: number;
    kleinunternehmerNotice?: string | null;
  };
  packages: PackageWithIncludedItems[];
  proposal?: ProposalWithLineItems | null;
}

export function createInitialProposalState({
  project,
  client,
  studioSettings,
  packages,
  proposal,
}: InitialStateParams): ProposalBuilderState {
  const currency = proposal?.currency ?? project.currency ?? studioSettings.currency;
  const pricesIncludeTax = proposal?.pricesIncludeTax ?? studioSettings.pricesIncludeTax;
  const isKleinunternehmer = proposal?.isKleinunternehmer ?? studioSettings.isKleinunternehmer;
  const taxNotice = proposal?.taxNotice ?? studioSettings.kleinunternehmerNotice ?? null;

  if (proposal) {
    const baseItem = proposal.lineItems.find((i) => i.itemType === 'base_package');
    const addonRows = proposal.lineItems.filter(
      (i) => i.itemType === 'addon' || i.itemType === 'custom',
    );

    let deliverables: DeliverableItemState[] = [];
    if (baseItem?.packageId) {
      const matchedPackage = packages.find((p) => p.id === baseItem.packageId);
      if (matchedPackage && matchedPackage.includedItems.length > 0) {
        deliverables = matchedPackage.includedItems.map((inc) => ({
          id: inc.id,
          title: inc.title,
          quantity: inc.quantity,
        }));
      }
    }
    if (deliverables.length === 0 && baseItem?.description) {
      deliverables = parseDeliverablesFromDescription(baseItem.description);
    }

    const basePackageItem: ProposalLineItemState | null = baseItem
      ? {
          id: baseItem.id,
          packageId: baseItem.packageId,
          catalogueItemId: null,
          itemType: 'base_package',
          name: baseItem.name,
          description: baseItem.description,
          unitPriceMinor: baseItem.unitPriceMinor,
          unitPriceMajor: convertPriceMinorToMajorString(baseItem.unitPriceMinor, currency),
          quantity: baseItem.quantity,
          minQuantity: baseItem.minQuantity,
          maxQuantity: baseItem.maxQuantity,
          taxRateBasisPoints: baseItem.taxRateBasisPoints,
          isOptional: baseItem.isOptional,
          isSelected: baseItem.isSelected,
          position: baseItem.position,
        }
      : null;

    const addonItems: ProposalLineItemState[] = addonRows.map((item) => ({
      id: item.id,
      packageId: null,
      catalogueItemId: item.catalogueItemId,
      itemType: item.itemType === 'custom' ? 'custom' : 'addon',
      name: item.name,
      description: item.description,
      unitPriceMinor: item.unitPriceMinor,
      unitPriceMajor: convertPriceMinorToMajorString(item.unitPriceMinor, currency),
      quantity: item.quantity,
      minQuantity: item.minQuantity,
      maxQuantity: item.maxQuantity,
      taxRateBasisPoints: item.taxRateBasisPoints,
      isOptional: item.isOptional,
      isSelected: item.isSelected,
      position: item.position,
    }));

    const validUntilStr = proposal.validUntil
      ? (new Date(proposal.validUntil).toISOString().split('T')[0] ?? '')
      : getDefaultExpirationDateString();

    return {
      id: proposal.id,
      projectId: proposal.projectId,
      clientId: proposal.clientId,
      title: proposal.title,
      currency,
      pricesIncludeTax,
      isKleinunternehmer,
      taxNotice,
      validUntil: proposal.validUntil ? new Date(proposal.validUntil).toISOString() : null,
      internalNotes: proposal.internalNotes,
      status: proposal.status,
      selectedPackageId: baseItem?.packageId ?? null,
      basePackageItem,
      deliverables,
      addonItems,
      sendModalOpen: false,
      sendModalDate: validUntilStr,
      sendModalEmail: client.email ?? '',
      sentResult: null,
      linkCopied: false,
      isSaving: false,
      isSending: false,
      saveSuccess: false,
    };
  }

  // Creating new proposal
  return {
    projectId: project.id,
    clientId: client.id,
    title: `${project.title} — Proposal`,
    currency,
    pricesIncludeTax,
    isKleinunternehmer,
    taxNotice,
    validUntil: null,
    internalNotes: null,
    status: 'draft',
    selectedPackageId: null,
    basePackageItem: null,
    deliverables: [],
    addonItems: [],
    sendModalOpen: false,
    sendModalDate: getDefaultExpirationDateString(),
    sendModalEmail: client.email ?? '',
    sentResult: null,
    linkCopied: false,
    isSaving: false,
    isSending: false,
    saveSuccess: false,
  };
}

export function calculateProposalStateTotals(state: ProposalBuilderState): TaxCalculationResult {
  const allItems = [...(state.basePackageItem ? [state.basePackageItem] : []), ...state.addonItems];

  return calculateProposalTotals(
    allItems.map((item) => ({
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      taxRateBasisPoints: item.taxRateBasisPoints,
      isSelected: item.isSelected,
    })),
    {
      pricesIncludeTax: state.pricesIncludeTax,
      isKleinunternehmer: state.isKleinunternehmer,
    },
  );
}

export function validateProposalForm(
  state: ProposalBuilderState,
  t: (key: string) => string,
): { isValid: boolean; errors: ProposalBuilderErrors } {
  const errors: ProposalBuilderErrors = {};

  const trimmedTitle = state.title.trim();
  if (!trimmedTitle) {
    errors.title = t('validation.titleRequired');
  } else if (trimmedTitle.length > 200) {
    errors.title = t('validation.titleTooLong');
  }

  const itemErrors: Record<number, { name?: string; unitPrice?: string }> = {};

  // Validate base package item if present
  if (state.basePackageItem) {
    if (state.basePackageItem.unitPriceMinor < 0) {
      errors.basePackage = { unitPrice: t('validation.negativePrice') };
    }
  }

  // Validate addon / custom items
  state.addonItems.forEach((item, index) => {
    const errorEntry: { name?: string; unitPrice?: string } = {};
    if (!item.name.trim()) {
      errorEntry.name = t('validation.nameRequired');
    }
    if (item.unitPriceMinor < 0) {
      errorEntry.unitPrice = t('validation.negativePrice');
    }
    if (errorEntry.name || errorEntry.unitPrice) {
      // eslint-disable-next-line security/detect-object-injection -- index is bounded numeric array index from forEach
      itemErrors[index] = errorEntry;
    }
  });

  if (Object.keys(itemErrors).length > 0) {
    errors.items = itemErrors;
  }

  const isValid = !errors.title && !errors.basePackage && !errors.items && !errors.general;
  return { isValid, errors };
}

export function validateSendModal(
  state: ProposalBuilderState,
  t: (key: string) => string,
): { isValid: boolean; errors: ProposalBuilderErrors } {
  const errors: ProposalBuilderErrors = {};

  if (!state.sendModalDate) {
    errors.sendDate = t('validation.dateInPast');
  } else {
    const targetDate = new Date(`${state.sendModalDate}T23:59:59.999Z`);
    if (targetDate.getTime() <= Date.now()) {
      errors.sendDate = t('validation.dateInPast');
    }
  }

  if (state.sendModalEmail.trim()) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(state.sendModalEmail.trim())) {
      errors.sendEmail = t('validation.invalidEmail');
    }
  }

  const isValid = !errors.sendDate && !errors.sendEmail;
  return { isValid, errors };
}

export function proposalBuilderReducer(
  state: ProposalBuilderState,
  action: ProposalBuilderAction,
): ProposalBuilderState {
  switch (action.type) {
    case 'SET_TITLE': {
      return { ...state, title: action.title, saveSuccess: false };
    }

    case 'SELECT_PACKAGE': {
      const pkg = action.pkg;
      if (!pkg) {
        return {
          ...state,
          selectedPackageId: null,
          basePackageItem: null,
          deliverables: [],
          saveSuccess: false,
        };
      }

      const deliverables: DeliverableItemState[] = pkg.includedItems.map((inc) => ({
        id: inc.id,
        title: inc.title,
        quantity: inc.quantity,
      }));

      const basePackageItem: ProposalLineItemState = {
        id: state.basePackageItem?.id,
        packageId: pkg.id,
        catalogueItemId: null,
        itemType: 'base_package',
        name: pkg.name,
        description: pkg.description,
        unitPriceMinor: pkg.basePriceMinor,
        unitPriceMajor: convertPriceMinorToMajorString(pkg.basePriceMinor, state.currency),
        quantity: 1,
        minQuantity: 1,
        maxQuantity: 1,
        taxRateBasisPoints: pkg.taxRateBasisPoints,
        isOptional: false,
        isSelected: true,
        position: 0,
      };

      // Set proposal title if generic
      let updatedTitle = state.title;
      if (
        !updatedTitle.trim() ||
        updatedTitle.endsWith('— Proposal') ||
        updatedTitle === 'Proposal'
      ) {
        const prefix = state.title.includes('—') ? state.title.split('—')[0]?.trim() : state.title;
        updatedTitle = `${prefix ?? 'Project'} — ${pkg.name}`;
      }

      return {
        ...state,
        selectedPackageId: pkg.id,
        basePackageItem,
        deliverables,
        title: updatedTitle,
        saveSuccess: false,
      };
    }

    case 'UPDATE_BASE_PACKAGE_PRICE': {
      if (!state.basePackageItem) return state;
      const minor = convertPriceMajorToMinor(action.majorPrice, state.currency);
      const isNegative = action.majorPrice.trim().startsWith('-');
      const finalMinor = isNegative ? -1 : (minor ?? 0);

      return {
        ...state,
        basePackageItem: {
          ...state.basePackageItem,
          unitPriceMajor: action.majorPrice,
          unitPriceMinor: finalMinor,
        },
        saveSuccess: false,
      };
    }

    case 'UPDATE_BASE_PACKAGE_TAX_RATE': {
      if (!state.basePackageItem) return state;
      return {
        ...state,
        basePackageItem: {
          ...state.basePackageItem,
          taxRateBasisPoints: action.taxRateBasisPoints,
        },
        saveSuccess: false,
      };
    }

    case 'ADD_DELIVERABLE': {
      const newDeliverable: DeliverableItemState = {
        id: generateClientRowId(),
        title: action.title,
        quantity: action.quantity ?? 1,
      };
      return {
        ...state,
        deliverables: [...state.deliverables, newDeliverable],
        saveSuccess: false,
      };
    }

    case 'UPDATE_DELIVERABLE_TITLE': {
      const deliverables = state.deliverables.map((d, i) =>
        i === action.index ? { ...d, title: action.title } : d,
      );
      return { ...state, deliverables, saveSuccess: false };
    }

    case 'UPDATE_DELIVERABLE_QTY': {
      const deliverables = state.deliverables.map((d, i) =>
        i === action.index ? { ...d, quantity: action.quantity } : d,
      );
      return { ...state, deliverables, saveSuccess: false };
    }

    case 'REMOVE_DELIVERABLE': {
      const deliverables = state.deliverables.filter((_, i) => i !== action.index);
      return { ...state, deliverables, saveSuccess: false };
    }

    case 'ADD_CATALOGUE_ADDON': {
      const item = action.item;
      const newItem: ProposalLineItemState = {
        id: generateClientRowId(),
        packageId: null,
        catalogueItemId: item.id,
        itemType: 'addon',
        name: item.name,
        description: item.description,
        unitPriceMinor: item.unitPriceMinor,
        unitPriceMajor: convertPriceMinorToMajorString(item.unitPriceMinor, state.currency),
        quantity: 1,
        minQuantity: 0,
        maxQuantity: 1,
        taxRateBasisPoints: item.taxRateBasisPoints,
        isOptional: false,
        isSelected: true,
        position: state.addonItems.length,
      };
      return {
        ...state,
        addonItems: [...state.addonItems, newItem],
        saveSuccess: false,
      };
    }

    case 'ADD_CUSTOM_ITEM': {
      const defaultTax = state.basePackageItem?.taxRateBasisPoints ?? 1900;
      const newItem: ProposalLineItemState = {
        id: generateClientRowId(),
        packageId: null,
        catalogueItemId: null,
        itemType: 'custom',
        name: '',
        description: '',
        unitPriceMinor: 0,
        unitPriceMajor: '0.00',
        quantity: 1,
        minQuantity: 0,
        maxQuantity: 1,
        taxRateBasisPoints: defaultTax,
        isOptional: false,
        isSelected: true,
        position: state.addonItems.length,
      };
      return {
        ...state,
        addonItems: [...state.addonItems, newItem],
        saveSuccess: false,
      };
    }

    case 'UPDATE_ITEM_FIELD': {
      const { index, field, value } = action;
      const items = state.addonItems.map((item, i) => {
        if (i !== index) return item;
        if (field === 'unitPriceMajor') {
          const strVal = String(value);
          const minor = convertPriceMajorToMinor(strVal, state.currency);
          const isNegative = strVal.trim().startsWith('-');
          const finalMinor = isNegative ? -1 : (minor ?? 0);
          return {
            ...item,
            unitPriceMajor: strVal,
            unitPriceMinor: finalMinor,
          };
        }
        return { ...item, [field]: value };
      });
      return { ...state, addonItems: items, saveSuccess: false };
    }

    case 'MOVE_ITEM': {
      const { from, to } = action;
      if (from < 0 || from >= state.addonItems.length || to < 0 || to >= state.addonItems.length) {
        return state;
      }
      const items = [...state.addonItems];
      const [moved] = items.splice(from, 1);
      if (moved) {
        items.splice(to, 0, moved);
      }
      return {
        ...state,
        addonItems: items.map((it, idx) => ({ ...it, position: idx })),
        saveSuccess: false,
      };
    }

    case 'REMOVE_ITEM': {
      const items = state.addonItems.filter((_, i) => i !== action.index);
      return {
        ...state,
        addonItems: items.map((it, idx) => ({ ...it, position: idx })),
        saveSuccess: false,
      };
    }

    case 'SET_SEND_MODAL_OPEN': {
      return { ...state, sendModalOpen: action.open };
    }

    case 'SET_SEND_MODAL_DATE': {
      return { ...state, sendModalDate: action.date };
    }

    case 'SET_SEND_MODAL_EMAIL': {
      return { ...state, sendModalEmail: action.email };
    }

    case 'SET_SAVING': {
      return { ...state, isSaving: action.saving };
    }

    case 'SET_SENDING': {
      return { ...state, isSending: action.sending };
    }

    case 'SET_SENT_RESULT': {
      return {
        ...state,
        sentResult: action.result,
        status: action.result ? 'sent' : state.status,
      };
    }

    case 'SET_LINK_COPIED': {
      return { ...state, linkCopied: action.copied };
    }

    case 'SET_SAVE_SUCCESS': {
      return { ...state, saveSuccess: action.success };
    }

    case 'SET_GENERAL_ERROR': {
      return { ...state, generalError: action.error ?? null };
    }

    case 'SET_SAVED_PROPOSAL': {
      return { ...state, id: action.id, status: action.status, saveSuccess: true };
    }

    default:
      return state;
  }
}

export function buildSaveDraftPayload(state: ProposalBuilderState): SaveDraftProposalInput {
  const allItems: SaveDraftProposalInput['lineItems'] = [];

  if (state.basePackageItem) {
    const descWithDeliverables = formatDeliverablesDescription(
      state.basePackageItem.description,
      state.deliverables,
    );
    allItems.push({
      id: state.basePackageItem.id,
      packageId: state.basePackageItem.packageId ?? null,
      catalogueItemId: null,
      itemType: 'base_package',
      name: state.basePackageItem.name.trim(),
      description: descWithDeliverables || null,
      unitPriceMinor: Math.max(0, state.basePackageItem.unitPriceMinor),
      quantity: 1,
      minQuantity: 1,
      maxQuantity: 1,
      taxRateBasisPoints: state.basePackageItem.taxRateBasisPoints,
      isOptional: false,
      isSelected: true,
      position: 0,
    });
  }

  state.addonItems.forEach((item, index) => {
    allItems.push({
      id: item.id,
      packageId: null,
      catalogueItemId: item.catalogueItemId ?? null,
      itemType: item.itemType,
      name: item.name.trim(),
      description: item.description?.trim() ? item.description.trim() : null,
      unitPriceMinor: Math.max(0, item.unitPriceMinor),
      quantity: item.quantity,
      minQuantity: item.minQuantity,
      maxQuantity: item.maxQuantity,
      taxRateBasisPoints: item.taxRateBasisPoints,
      isOptional: item.isOptional,
      isSelected: item.isSelected,
      position: state.basePackageItem ? index + 1 : index,
    });
  });

  return {
    id: state.id,
    projectId: state.projectId,
    clientId: state.clientId,
    title: state.title.trim(),
    currency: state.currency,
    pricesIncludeTax: state.pricesIncludeTax,
    isKleinunternehmer: state.isKleinunternehmer,
    taxNotice: state.taxNotice ?? null,
    validUntil: state.validUntil ? new Date(state.validUntil) : null,
    internalNotes: state.internalNotes ?? null,
    lineItems: allItems,
  };
}

export function buildSendPayload(state: ProposalBuilderState): SendProposalInput {
  if (!state.id) {
    throw new Error('Cannot send proposal without saved ID');
  }

  const validUntil = state.sendModalDate
    ? new Date(`${state.sendModalDate}T23:59:59.999Z`)
    : undefined;

  return {
    proposalId: state.id,
    validUntil,
    recipientEmail: state.sendModalEmail.trim() || undefined,
  };
}

export interface ProposalBuilderViewActionHandlersParams {
  state: ProposalBuilderState;
  getState?: () => ProposalBuilderState;
  dispatch: Dispatch<ProposalBuilderAction>;
  t: (key: string) => string;
  router: { push: (url: string) => void };
  locale?: string;
  saveDraftAction: (input: unknown) => Promise<ProposalActionResult<ProposalWithLineItems>>;
  sendAction: (input: unknown) => Promise<ProposalActionResult<SendProposalResult>>;
}

export function createProposalBuilderActionHandlers({
  state: initialState,
  getState,
  dispatch,
  t,
  router,
  saveDraftAction,
  sendAction,
}: ProposalBuilderViewActionHandlersParams) {
  const getCurrentState = () => (getState ? getState() : initialState);

  const onSaveDraft = async () => {
    const state = getCurrentState();
    const { isValid, errors } = validateProposalForm(state, t);
    if (!isValid) {
      dispatch({
        type: 'SET_GENERAL_ERROR',
        error: errors.title ?? Object.values(errors.items ?? {})[0]?.unitPrice,
      });
      return;
    }

    dispatch({ type: 'SET_SAVING', saving: true });
    dispatch({ type: 'SET_GENERAL_ERROR', error: null });

    try {
      const payload = buildSaveDraftPayload(state);
      const result = await saveDraftAction(payload);

      if (result.success) {
        dispatch({
          type: 'SET_SAVED_PROPOSAL',
          id: result.data.id,
          status: result.data.status,
        });
        if (!state.id) {
          // Redirect to edit route
          router.push(`/projects/${state.projectId}/proposals/${result.data.id}`);
        }
      } else {
        dispatch({ type: 'SET_GENERAL_ERROR', error: result.error });
      }
    } catch (err) {
      dispatch({
        type: 'SET_GENERAL_ERROR',
        error: err instanceof Error ? err.message : 'Error saving draft proposal',
      });
    } finally {
      dispatch({ type: 'SET_SAVING', saving: false });
    }
  };

  const onOpenSendModal = async () => {
    const state = getCurrentState();
    // If proposal has not been saved yet, save it first
    if (!state.id) {
      const { isValid, errors } = validateProposalForm(state, t);
      if (!isValid) {
        dispatch({
          type: 'SET_GENERAL_ERROR',
          error: errors.title ?? Object.values(errors.items ?? {})[0]?.unitPrice,
        });
        return;
      }
      dispatch({ type: 'SET_SAVING', saving: true });
      try {
        const payload = buildSaveDraftPayload(state);
        const result = await saveDraftAction(payload);
        if (result.success) {
          dispatch({
            type: 'SET_SAVED_PROPOSAL',
            id: result.data.id,
            status: result.data.status,
          });
          dispatch({ type: 'SET_SEND_MODAL_OPEN', open: true });
        } else {
          dispatch({ type: 'SET_GENERAL_ERROR', error: result.error });
        }
      } finally {
        dispatch({ type: 'SET_SAVING', saving: false });
      }
      return;
    }

    dispatch({ type: 'SET_SEND_MODAL_OPEN', open: true });
  };

  const onSubmitSendProposal = async () => {
    const state = getCurrentState();
    const { isValid, errors } = validateSendModal(state, t);
    if (!isValid) {
      dispatch({
        type: 'SET_GENERAL_ERROR',
        error: errors.sendDate ?? errors.sendEmail,
      });
      return;
    }

    dispatch({ type: 'SET_SENDING', sending: true });
    dispatch({ type: 'SET_GENERAL_ERROR', error: null });

    try {
      const payload = buildSendPayload(state);
      const result = await sendAction(payload);

      if (result.success) {
        dispatch({ type: 'SET_SENT_RESULT', result: result.data });
        dispatch({ type: 'SET_SEND_MODAL_OPEN', open: false });
      } else {
        dispatch({ type: 'SET_GENERAL_ERROR', error: result.error });
      }
    } catch (err) {
      dispatch({
        type: 'SET_GENERAL_ERROR',
        error: err instanceof Error ? err.message : 'Error sending proposal',
      });
    } finally {
      dispatch({ type: 'SET_SENDING', sending: false });
    }
  };

  const onCopyLink = async () => {
    const state = getCurrentState();
    if (!state.sentResult?.tokenUrl) return;
    try {
      await navigator.clipboard.writeText(state.sentResult.tokenUrl);
    } catch {
      // Ignore clipboard permission issues in headless environments
    }
    dispatch({ type: 'SET_LINK_COPIED', copied: true });
  };

  return {
    onSaveDraft,
    onOpenSendModal,
    onSubmitSendProposal,
    onCopyLink,
  };
}

export function createProposalBuilderViewHandlers(dispatch: Dispatch<ProposalBuilderAction>) {
  return {
    onTitleChange: (title: string) => {
      dispatch({ type: 'SET_TITLE', title });
    },
    onSelectPackage: (pkg: PackageWithIncludedItems | null) => {
      dispatch({ type: 'SELECT_PACKAGE', pkg });
    },
    onUpdateBasePrice: (majorPrice: string) => {
      dispatch({ type: 'UPDATE_BASE_PACKAGE_PRICE', majorPrice });
    },
    onUpdateTaxRate: (taxRateBasisPoints: number) => {
      dispatch({ type: 'UPDATE_BASE_PACKAGE_TAX_RATE', taxRateBasisPoints });
    },
    onAddDeliverable: (title: string, quantity?: number) => {
      dispatch({ type: 'ADD_DELIVERABLE', title, quantity });
    },
    onUpdateDeliverableTitle: (index: number, title: string) => {
      dispatch({ type: 'UPDATE_DELIVERABLE_TITLE', index, title });
    },
    onUpdateDeliverableQty: (index: number, quantity: number) => {
      dispatch({ type: 'UPDATE_DELIVERABLE_QTY', index, quantity });
    },
    onRemoveDeliverable: (index: number) => {
      dispatch({ type: 'REMOVE_DELIVERABLE', index });
    },
    onAddCatalogueItem: (item: CatalogueItem) => {
      dispatch({ type: 'ADD_CATALOGUE_ADDON', item });
    },
    onAddCustomItem: () => {
      dispatch({ type: 'ADD_CUSTOM_ITEM' });
    },
    onUpdateItemField: (index: number, field: keyof ProposalLineItemState, value: unknown) => {
      dispatch({ type: 'UPDATE_ITEM_FIELD', index, field, value });
    },
    onMoveItem: (from: number, to: number) => {
      dispatch({ type: 'MOVE_ITEM', from, to });
    },
    onRemoveItem: (index: number) => {
      dispatch({ type: 'REMOVE_ITEM', index });
    },
    onCloseSendModal: () => {
      dispatch({ type: 'SET_SEND_MODAL_OPEN', open: false });
      dispatch({ type: 'SET_SENT_RESULT', result: null });
    },
    onSendDateChange: (date: string) => {
      dispatch({ type: 'SET_SEND_MODAL_DATE', date });
    },
    onSendEmailChange: (email: string) => {
      dispatch({ type: 'SET_SEND_MODAL_EMAIL', email });
    },
    handleTitleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      dispatch({ type: 'SET_TITLE', title: e.target.value });
    },
  };
}

export function createDeliverableRowHandlers(
  index: number,
  onUpdateTitle: (index: number, title: string) => void,
  onUpdateQty: (index: number, qty: number) => void,
  onRemove: (index: number) => void,
) {
  return {
    handleQtyChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdateQty(index, parseInt(e.target.value, 10) || 1);
    },
    handleTitleChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdateTitle(index, e.target.value);
    },
    handleRemove: () => {
      onRemove(index);
    },
  };
}

export function createAddonRowHandlers(
  index: number,
  onUpdateField: (index: number, field: keyof ProposalLineItemState, value: unknown) => void,
  onMoveItem: (from: number, to: number) => void,
  onRemoveItem: (index: number) => void,
) {
  return {
    handleNameChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdateField(index, 'name', e.target.value);
    },
    handlePriceChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdateField(index, 'unitPriceMajor', e.target.value);
    },
    handleQuantityChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdateField(index, 'quantity', parseInt(e.target.value, 10) || 0);
    },
    handleMaxQuantityChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdateField(index, 'maxQuantity', parseInt(e.target.value, 10) || 1);
    },
    handleTaxRateChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
      onUpdateField(index, 'taxRateBasisPoints', parseInt(e.target.value, 10));
    },
    handleOptionalChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdateField(index, 'isOptional', e.target.checked);
    },
    handleMoveUp: () => {
      onMoveItem(index, index - 1);
    },
    handleMoveDown: () => {
      onMoveItem(index, index + 1);
    },
    handleRemove: () => {
      onRemoveItem(index);
    },
  };
}

export function createPackageSectionController(
  onSelectPackage: (pkg: PackageWithIncludedItems | null) => void,
  onUpdateBasePrice: (majorPrice: string) => void,
  onUpdateTaxRate: (taxRateBasisPoints: number) => void,
  onAddDeliverable: (title: string, quantity?: number) => void,
  packages: PackageWithIncludedItems[],
  setNewDeliverableTitle?: (val: string) => void,
  setNewDeliverableQty?: (val: string) => void,
) {
  return {
    handlePackageSelectChange: (e: React.ChangeEvent<HTMLSelectElement> | string) => {
      const pkgId = typeof e === 'string' ? e : e.target.value;
      if (!pkgId) {
        onSelectPackage(null);
        return;
      }
      const found = packages.find((p) => p.id === pkgId) ?? null;
      onSelectPackage(found);
    },
    handleBasePriceChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdateBasePrice(e.target.value);
    },
    handleTaxRateChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
      onUpdateTaxRate(parseInt(e.target.value, 10));
    },
    handleAddDeliverable: (title: string, qtyStr: string) => {
      if (!title.trim()) return false;
      const qty = parseInt(qtyStr, 10) || 1;
      onAddDeliverable(title.trim(), qty);
      return true;
    },
    handleQtyInputChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setNewDeliverableQty?.(e.target.value);
    },
    handleTitleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setNewDeliverableTitle?.(e.target.value);
    },
    handleAddDeliverableSubmit: (title: string, qtyStr: string) => (e: React.SyntheticEvent) => {
      e.preventDefault();
      if (!title.trim()) return false;
      const qty = parseInt(qtyStr, 10) || 1;
      onAddDeliverable(title.trim(), qty);
      setNewDeliverableTitle?.('');
      setNewDeliverableQty?.('1');
      return true;
    },
  };
}

export function createAddonSectionController(
  catalogueItems: CatalogueItem[],
  onAddCatalogueItem: (item: CatalogueItem) => void,
  setSelectedCatalogueId?: (id: string) => void,
) {
  return {
    findAndAddCatalogueItem: (catalogueId: string) => {
      if (!catalogueId) return false;
      const item = catalogueItems.find((i) => i.id === catalogueId);
      if (item) {
        onAddCatalogueItem(item);
        setSelectedCatalogueId?.('');
        return true;
      }
      return false;
    },
    handleCatalogueSelectChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSelectedCatalogueId?.(e.target.value);
    },
    handleAddCatalogueClick: (selectedCatalogueId: string) => () => {
      if (!selectedCatalogueId) return false;
      const item = catalogueItems.find((i) => i.id === selectedCatalogueId);
      if (item) {
        onAddCatalogueItem(item);
        setSelectedCatalogueId?.('');
        return true;
      }
      return false;
    },
  };
}

export function createSendModalController(
  onClose: () => void,
  onDateChange?: (date: string) => void,
  onEmailChange?: (email: string) => void,
  triggerRef?: React.RefObject<HTMLElement | null>,
) {
  return {
    handleOpenChange: (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    handleCloseAutoFocus: (e: Event) => {
      e.preventDefault();
      triggerRef?.current?.focus();
    },
    handleDateChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      onDateChange?.(e.target.value);
    },
    handleEmailChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      onEmailChange?.(e.target.value);
    },
  };
}
