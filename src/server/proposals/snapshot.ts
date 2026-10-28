import {
  type Proposal,
  type ProposalLineItem,
  type ProposalStatus,
  type AcceptedOptionsSnapshot,
} from '@/server/db/schema/proposals';
import type { Package, CatalogueItem } from '@/server/db/schema/packages';
import { calculateProposalTotals } from './calculator';
import type { ProposalLineItemInput } from './schema';

export class ProposalImmutableError extends Error {
  public readonly code = 'IMMUTABLE_PROPOSAL';
  public readonly statusCode = 400;

  constructor(message = 'Cannot modify an accepted or superseded proposal') {
    super(message);
    this.name = 'ProposalImmutableError';
  }
}

export class ProposalStateTransitionError extends Error {
  public readonly code = 'INVALID_STATE_TRANSITION';
  public readonly statusCode = 400;

  constructor(from: string, to: string) {
    super(`Cannot transition proposal status from '${from}' to '${to}'`);
    this.name = 'ProposalStateTransitionError';
  }
}

/**
 * Valid state transitions mapping per ADR-0018 §2.1.
 * - 'draft' can transition to: 'sent', 'accepted', 'superseded'.
 * - 'sent' can transition to: 'accepted', 'declined', 'expired', 'superseded'.
 * - 'declined' can transition to: 'superseded'.
 * - 'expired' can transition to: 'superseded'.
 * - 'accepted' has NO valid forward transitions (statutory commercial lock).
 * - 'superseded' has NO valid forward transitions.
 */
const VALID_TRANSITIONS = new Map<ProposalStatus, readonly ProposalStatus[]>([
  ['draft', ['sent', 'accepted', 'superseded']],
  ['sent', ['accepted', 'declined', 'expired', 'superseded']],
  ['declined', ['superseded']],
  ['expired', ['superseded']],
  ['accepted', []],
  ['superseded', []],
]);

/**
 * Checks whether a proposed state transition is valid according to the proposal state machine.
 */
export function canTransitionProposalStatus(from: ProposalStatus, to: ProposalStatus): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed ? allowed.includes(to) : false;
}

/**
 * Asserts that a state transition is legal, throwing a typed error if prohibited.
 */
export function assertProposalTransitionAllowed(from: ProposalStatus, to: ProposalStatus): void {
  if (from === 'accepted') {
    throw new ProposalImmutableError(
      'Cannot transition an accepted proposal; accepted commercial records are permanently locked',
    );
  }

  if (!canTransitionProposalStatus(from, to)) {
    throw new ProposalStateTransitionError(from, to);
  }
}

/**
 * Asserts that a proposal is in an editable status (draft or sent).
 * Throws ProposalImmutableError if proposal is accepted or superseded.
 */
export function assertProposalEditable(proposal: { status: ProposalStatus }): void {
  if (proposal.status === 'accepted') {
    throw new ProposalImmutableError(
      'Cannot modify an accepted proposal; commercial terms are permanently locked',
    );
  }
  if (proposal.status === 'superseded') {
    throw new ProposalImmutableError('Cannot modify a superseded proposal');
  }
}

/**
 * Deep-copies package attributes into a proposal line item structure (ADR-0018 §2.1).
 * Isolates the proposal from future edits or deletions to the source package.
 */
export function snapshotPackageToLineItem(
  pkg: Package,
  overrides?: Partial<ProposalLineItemInput>,
): ProposalLineItemInput {
  return {
    packageId: pkg.id,
    catalogueItemId: null,
    itemType: 'base_package',
    name: pkg.name,
    description: pkg.description ?? null,
    unitPriceMinor: pkg.basePriceMinor,
    quantity: 1,
    minQuantity: 1,
    maxQuantity: 1,
    taxRateBasisPoints: pkg.taxRateBasisPoints,
    isOptional: false,
    isSelected: true,
    position: overrides?.position ?? 0,
    ...overrides,
  };
}

/**
 * Deep-copies catalogue item attributes into a proposal line item structure (ADR-0018 §2.1).
 * Isolates the proposal from future edits or deletions to the source catalogue item.
 */
export function snapshotCatalogueItemToLineItem(
  item: CatalogueItem,
  overrides?: Partial<ProposalLineItemInput>,
): ProposalLineItemInput {
  return {
    packageId: null,
    catalogueItemId: item.id,
    itemType: 'addon',
    name: item.name,
    description: item.description ?? null,
    unitPriceMinor: item.unitPriceMinor,
    quantity: 1,
    minQuantity: 0,
    maxQuantity: 1,
    taxRateBasisPoints: item.taxRateBasisPoints,
    isOptional: true,
    isSelected: true,
    position: overrides?.position ?? 0,
    ...overrides,
  };
}

/**
 * Serializes an immutable JSON snapshot capturing all selected line items, quantities,
 * and monetary totals at the exact moment of acceptance (ADR-0018 §1.5 / §3.3).
 */
export function createAcceptedOptionsSnapshot(
  proposal: Proposal,
  lineItems: ProposalLineItem[],
  acceptanceDetails?: {
    acceptedByName?: string | null;
    acceptedByEmail?: string | null;
  },
): AcceptedOptionsSnapshot {
  const selectedItems = lineItems.filter((i) => i.isSelected && i.quantity > 0);

  const calcResult = calculateProposalTotals(
    selectedItems.map((item) => ({
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      taxRateBasisPoints: item.taxRateBasisPoints,
      isSelected: true,
    })),
    {
      pricesIncludeTax: proposal.pricesIncludeTax,
      isKleinunternehmer: proposal.isKleinunternehmer,
    },
  );

  return {
    acceptedAt: new Date().toISOString(),
    acceptedByName: acceptanceDetails?.acceptedByName ?? null,
    acceptedByEmail: acceptanceDetails?.acceptedByEmail ?? null,
    subtotalMinor: calcResult.subtotalMinor,
    taxMinor: calcResult.taxMinor,
    totalMinor: calcResult.totalMinor,
    currency: proposal.currency,
    pricesIncludeTax: proposal.pricesIncludeTax,
    isKleinunternehmer: proposal.isKleinunternehmer,
    taxBreakdown: calcResult.breakdown.map((b) => ({
      taxRateBasisPoints: b.taxRateBasisPoints,
      taxRatePercentFormatted: b.taxRatePercentFormatted,
      netMinor: b.netMinor,
      taxMinor: b.taxMinor,
      grossMinor: b.grossMinor,
    })),
    items: selectedItems.map((item) => ({
      id: item.id,
      packageId: item.packageId ?? null,
      catalogueItemId: item.catalogueItemId ?? null,
      itemType: item.itemType,
      name: item.name,
      description: item.description ?? null,
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      taxRateBasisPoints: item.taxRateBasisPoints,
      lineTotalMinor: item.unitPriceMinor * item.quantity,
    })),
  };
}
