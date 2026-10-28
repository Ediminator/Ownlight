import { describe, it, expect, vi } from 'vitest';
import {
  createInitialProposalState,
  proposalBuilderReducer,
  calculateProposalStateTotals,
  validateProposalForm,
  validateSendModal,
  buildSaveDraftPayload,
  buildSendPayload,
  getDefaultExpirationDateString,
  formatDeliverablesDescription,
  parseDeliverablesFromDescription,
  type ProposalBuilderState,
  type ProposalBuilderAction,
} from '@/components/proposals/proposal-builder-helpers';
import type { SaveDraftProposalInput } from '@/server/proposals/schema';
import type { PackageWithIncludedItems } from '@/server/packages/repo';
import type { CatalogueItem } from '@/server/db/schema/packages';

const mockPackage: PackageWithIncludedItems = {
  id: '01920000-0000-7000-8000-000000000101',
  name: 'Full Day Wedding Coverage',
  slug: 'wedding-full-day',
  description: 'Comprehensive 8-hour wedding photography',
  projectTypeKey: 'wedding',
  basePriceMinor: 280000,
  currency: 'EUR',
  taxRateBasisPoints: 1900,
  position: 1,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  includedItems: [
    {
      id: '01920000-0000-7000-8000-000000000111',
      packageId: '01920000-0000-7000-8000-000000000101',
      title: '8 Hours Continuous Coverage',
      description: 'Prep to first dance',
      quantity: 1,
      position: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: '01920000-0000-7000-8000-000000000112',
      packageId: '01920000-0000-7000-8000-000000000101',
      title: '400+ Edited High-Resolution Images',
      description: 'Full resolution download',
      quantity: 400,
      position: 2,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
  ],
};

const mockCatalogueItem: CatalogueItem = {
  id: '01920000-0000-7000-8000-000000000301',
  name: 'Extra Hour Coverage',
  slug: 'extra-hour-coverage',
  description: 'Additional hour on location',
  category: 'service',
  unitPriceMinor: 25000,
  currency: 'EUR',
  taxRateBasisPoints: 1900,
  position: 1,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const mockStudioSettings = {
  currency: 'EUR',
  isKleinunternehmer: false,
  pricesIncludeTax: true,
  defaultTaxRateBasisPoints: 1900,
  kleinunternehmerNotice: null,
};

const mockProject = {
  id: '01920000-0000-7000-8000-000000000071',
  title: 'Emma & Liam Wedding',
  projectTypeKey: 'wedding',
  currency: 'EUR',
};

const mockClient = {
  id: '01920000-0000-7000-8000-000000000081',
  displayName: 'Emma Watson',
  email: 'emma@example.com',
  phone: '+49 30 123456',
};

// Translator mock
const mockT = (key: string) => key;

describe('TASK-0061: Proposal Builder Form & Helpers Unit Tests', () => {
  it('AC-1: selecting a base package from package selector populates title, base price, and included deliverables', () => {
    let state = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: mockStudioSettings,
      packages: [mockPackage],
    });

    expect(state.selectedPackageId).toBeNull();
    expect(state.basePackageItem).toBeNull();
    expect(state.deliverables).toHaveLength(0);

    // Select base package
    state = proposalBuilderReducer(state, {
      type: 'SELECT_PACKAGE',
      pkg: mockPackage,
    });

    expect(state.selectedPackageId).toBe(mockPackage.id);
    expect(state.title).toBe('Emma & Liam Wedding — Full Day Wedding Coverage');
    expect(state.basePackageItem).not.toBeNull();
    expect(state.basePackageItem?.name).toBe('Full Day Wedding Coverage');
    expect(state.basePackageItem?.unitPriceMinor).toBe(280000);
    expect(state.basePackageItem?.unitPriceMajor).toBe('2800.00');
    expect(state.basePackageItem?.taxRateBasisPoints).toBe(1900);
    expect(state.basePackageItem?.isOptional).toBe(false);
    expect(state.basePackageItem?.isSelected).toBe(true);

    // Bundled deliverables populated
    expect(state.deliverables).toHaveLength(2);
    expect(state.deliverables[0]?.title).toBe('8 Hours Continuous Coverage');
    expect(state.deliverables[1]?.title).toBe('400+ Edited High-Resolution Images');

    // Deliverables can be added or removed for this proposal
    state = proposalBuilderReducer(state, {
      type: 'ADD_DELIVERABLE',
      title: 'Drone Footage (Custom Deliverable)',
      quantity: 1,
    });
    expect(state.deliverables).toHaveLength(3);
    expect(state.deliverables[2]?.title).toBe('Drone Footage (Custom Deliverable)');

    state = proposalBuilderReducer(state, {
      type: 'REMOVE_DELIVERABLE',
      index: 1,
    });
    expect(state.deliverables).toHaveLength(2);
    expect(state.deliverables[1]?.title).toBe('Drone Footage (Custom Deliverable)');
  });

  it('AC-2: adding catalogue add-on item, marking as optional with max quantity 2, and adding inline custom item updates financial summary reactively', () => {
    let state = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: mockStudioSettings,
      packages: [mockPackage],
    });

    // 1. Select base package (2800.00 EUR Gross, 19% VAT)
    state = proposalBuilderReducer(state, {
      type: 'SELECT_PACKAGE',
      pkg: mockPackage,
    });

    let totals = calculateProposalStateTotals(state);
    // 280000 Gross => net: Math.round(280000 * 10000 / 11900) = 235294, tax: 44706, total: 280000
    expect(totals.totalMinor).toBe(280000);
    expect(totals.taxMinor).toBe(44706);
    expect(totals.subtotalMinor).toBe(280000);

    // 2. Add catalogue add-on item (250.00 EUR Gross, 19% VAT)
    state = proposalBuilderReducer(state, {
      type: 'ADD_CATALOGUE_ADDON',
      item: mockCatalogueItem,
    });
    expect(state.addonItems).toHaveLength(1);
    expect(state.addonItems[0]?.name).toBe('Extra Hour Coverage');
    expect(state.addonItems[0]?.unitPriceMinor).toBe(25000);
    expect(state.addonItems[0]?.isOptional).toBe(false);

    // Mark as optional
    state = proposalBuilderReducer(state, {
      type: 'UPDATE_ITEM_FIELD',
      index: 0,
      field: 'isOptional',
      value: true,
    });
    expect(state.addonItems[0]?.isOptional).toBe(true);

    // Set max quantity to 2
    state = proposalBuilderReducer(state, {
      type: 'UPDATE_ITEM_FIELD',
      index: 0,
      field: 'maxQuantity',
      value: 2,
    });
    expect(state.addonItems[0]?.maxQuantity).toBe(2);

    // 3. Add inline custom line item (150.00 EUR Gross, 19% VAT)
    state = proposalBuilderReducer(state, {
      type: 'ADD_CUSTOM_ITEM',
    });
    expect(state.addonItems).toHaveLength(2);
    expect(state.addonItems[1]?.itemType).toBe('custom');

    state = proposalBuilderReducer(state, {
      type: 'UPDATE_ITEM_FIELD',
      index: 1,
      field: 'name',
      value: 'Second Photographer Travel Fee',
    });
    state = proposalBuilderReducer(state, {
      type: 'UPDATE_ITEM_FIELD',
      index: 1,
      field: 'unitPriceMajor',
      value: '150.00',
    });
    expect(state.addonItems[1]?.name).toBe('Second Photographer Travel Fee');
    expect(state.addonItems[1]?.unitPriceMinor).toBe(15000);

    // Recalculate totals: 280000 (package) + 25000 (addon) + 15000 (custom) = 320000 Gross
    // Net: Math.round(320000 * 10000 / 11900) = 268908
    // Tax: 320000 - 268908 = 51092
    totals = calculateProposalStateTotals(state);
    expect(totals.totalMinor).toBe(320000);
    expect(totals.taxMinor).toBe(51092);
    expect(totals.subtotalMinor).toBe(320000);
    expect(totals.breakdown).toHaveLength(1);
    expect(totals.breakdown[0]?.taxRateBasisPoints).toBe(1900);
    expect(totals.breakdown[0]?.taxMinor).toBe(51092);
  });

  it('AC-3: buildSaveDraftPayload correctly formats draft proposal and line items for PostgreSQL persistence', () => {
    let state = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: mockStudioSettings,
      packages: [mockPackage],
    });

    state = proposalBuilderReducer(state, {
      type: 'SELECT_PACKAGE',
      pkg: mockPackage,
    });

    state = proposalBuilderReducer(state, {
      type: 'ADD_CATALOGUE_ADDON',
      item: mockCatalogueItem,
    });

    const payload = buildSaveDraftPayload(state);
    expect(payload.projectId).toBe(mockProject.id);
    expect(payload.clientId).toBe(mockClient.id);
    expect(payload.title).toBe('Emma & Liam Wedding — Full Day Wedding Coverage');
    expect(payload.currency).toBe('EUR');
    expect(payload.pricesIncludeTax).toBe(true);
    expect(payload.isKleinunternehmer).toBe(false);

    expect(payload.lineItems).toBeDefined();
    const lineItems = payload.lineItems ?? [];
    expect(lineItems).toHaveLength(2);
    // Line item 0: base_package
    expect(lineItems[0]?.itemType).toBe('base_package');
    expect(lineItems[0]?.packageId).toBe(mockPackage.id);
    expect(lineItems[0]?.name).toBe('Full Day Wedding Coverage');
    expect(lineItems[0]?.unitPriceMinor).toBe(280000);
    expect(lineItems[0]?.position).toBe(0);

    // Line item 1: addon
    expect(lineItems[1]?.itemType).toBe('addon');
    expect(lineItems[1]?.catalogueItemId).toBe(mockCatalogueItem.id);
    expect(lineItems[1]?.name).toBe('Extra Hour Coverage');
    expect(lineItems[1]?.unitPriceMinor).toBe(25000);
    expect(lineItems[1]?.position).toBe(1);
  });

  it('AC-4: buildSendPayload validates default 14-day validity date and client recipient email', () => {
    const fixedNow = new Date('2026-06-01T12:00:00Z');
    const defaultDate = getDefaultExpirationDateString(fixedNow);
    expect(defaultDate).toBe('2026-06-15');

    const state = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: mockStudioSettings,
      packages: [mockPackage],
      proposal: {
        id: '01920000-0000-7000-8000-000000000201',
        projectId: mockProject.id,
        clientId: mockClient.id,
        title: 'Draft Proposal',
        status: 'draft',
        version: 1,
        currency: 'EUR',
        subtotalMinor: 280000,
        taxMinor: 44706,
        totalMinor: 280000,
        pricesIncludeTax: true,
        isKleinunternehmer: false,
        taxNotice: null,
        validUntil: null,
        tokenHash: 'abc',
        tokenRevokedAt: null,
        sentAt: null,
        acceptedAt: null,
        declinedAt: null,
        declineReason: null,
        acceptedByName: null,
        acceptedByEmail: null,
        acceptanceIpAnonymized: null,
        acceptanceUserAgent: null,
        acceptedOptionsSnapshot: null,
        internalNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lineItems: [],
      },
    });

    expect(state.sendModalEmail).toBe('emma@example.com');
    expect(state.sendModalDate).toBeTruthy();

    const validation = validateSendModal(state, mockT);
    expect(validation.isValid).toBe(true);

    const sendPayload = buildSendPayload(state);
    expect(sendPayload.proposalId).toBe('01920000-0000-7000-8000-000000000201');
    expect(sendPayload.recipientEmail).toBe('emma@example.com');
    expect(sendPayload.validUntil).toBeInstanceOf(Date);
  });

  it('AC-6: validateProposalForm catches empty title, negative item prices, and disables actions', () => {
    let state = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: mockStudioSettings,
      packages: [mockPackage],
    });

    // 1. Empty title validation
    state = proposalBuilderReducer(state, {
      type: 'SET_TITLE',
      title: '   ',
    });
    let result = validateProposalForm(state, mockT);
    expect(result.isValid).toBe(false);
    expect(result.errors.title).toBe('validation.titleRequired');

    // 2. Valid title but negative item price
    state = proposalBuilderReducer(state, {
      type: 'SET_TITLE',
      title: 'Valid Wedding Proposal',
    });
    state = proposalBuilderReducer(state, {
      type: 'SELECT_PACKAGE',
      pkg: mockPackage,
    });
    state = proposalBuilderReducer(state, {
      type: 'ADD_CUSTOM_ITEM',
    });
    state = proposalBuilderReducer(state, {
      type: 'UPDATE_ITEM_FIELD',
      index: 0,
      field: 'name',
      value: 'Custom Travel',
    });
    state = proposalBuilderReducer(state, {
      type: 'UPDATE_ITEM_FIELD',
      index: 0,
      field: 'unitPriceMajor',
      value: '-50.00',
    });

    result = validateProposalForm(state, mockT);
    expect(result.isValid).toBe(false);
    expect(result.errors.items?.[0]?.unitPrice).toBe('validation.negativePrice');

    // 3. Send modal validation catches expiration date in the past
    state = proposalBuilderReducer(state, {
      type: 'SET_SEND_MODAL_DATE',
      date: '2020-01-01',
    });
    const modalValidation = validateSendModal(state, mockT);
    expect(modalValidation.isValid).toBe(false);
    expect(modalValidation.errors.sendDate).toBe('validation.dateInPast');
  });

  it('AC-2: handles Kleinunternehmer mode (§ 19 UStG) where tax is 0 minor units and total equals subtotal', () => {
    const kleinunternehmerSettings = {
      ...mockStudioSettings,
      isKleinunternehmer: true,
      kleinunternehmerNotice: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    };

    let state = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: kleinunternehmerSettings,
      packages: [mockPackage],
    });

    state = proposalBuilderReducer(state, {
      type: 'SELECT_PACKAGE',
      pkg: mockPackage,
    });

    const totals = calculateProposalStateTotals(state);
    expect(totals.totalMinor).toBe(280000);
    expect(totals.taxMinor).toBe(0);
    expect(totals.subtotalMinor).toBe(280000);
    expect(totals.breakdown).toHaveLength(0);
  });

  it('AC-2: handles Net pricing display mode where VAT is added on top of net amount', () => {
    const netPricingSettings = {
      ...mockStudioSettings,
      pricesIncludeTax: false,
    };

    let state = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: netPricingSettings,
      packages: [mockPackage],
    });

    state = proposalBuilderReducer(state, {
      type: 'SELECT_PACKAGE',
      pkg: mockPackage,
    });

    // Net: 280000, Tax (19%): Math.round(280000 * 1900 / 10000) = 53200, Gross Total: 333200
    const totals = calculateProposalStateTotals(state);
    expect(totals.subtotalMinor).toBe(280000);
    expect(totals.taxMinor).toBe(53200);
    expect(totals.totalMinor).toBe(333200);
  });

  it('handles item reordering and deliverable formatting cleanly', () => {
    let state = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: mockStudioSettings,
      packages: [mockPackage],
    });

    state = proposalBuilderReducer(state, {
      type: 'ADD_CUSTOM_ITEM',
    });
    state = proposalBuilderReducer(state, {
      type: 'UPDATE_ITEM_FIELD',
      index: 0,
      field: 'name',
      value: 'Item A',
    });

    state = proposalBuilderReducer(state, {
      type: 'ADD_CUSTOM_ITEM',
    });
    state = proposalBuilderReducer(state, {
      type: 'UPDATE_ITEM_FIELD',
      index: 1,
      field: 'name',
      value: 'Item B',
    });

    expect(state.addonItems[0]?.name).toBe('Item A');
    expect(state.addonItems[1]?.name).toBe('Item B');

    // Move Item B up
    state = proposalBuilderReducer(state, {
      type: 'MOVE_ITEM',
      from: 1,
      to: 0,
    });
    expect(state.addonItems[0]?.name).toBe('Item B');
    expect(state.addonItems[1]?.name).toBe('Item A');

    // Remove item
    state = proposalBuilderReducer(state, {
      type: 'REMOVE_ITEM',
      index: 0,
    });
    expect(state.addonItems).toHaveLength(1);
    expect(state.addonItems[0]?.name).toBe('Item A');

    // Deliverables formatting & parsing
    const deliverables = [
      { id: '1', title: '8 Hours Shoot', quantity: 1 },
      { id: '2', title: 'Edited Photos', quantity: 50 },
    ];
    const desc = formatDeliverablesDescription('Base package overview', deliverables);
    expect(desc).toContain('Base package overview');
    expect(desc).toContain('• 8 Hours Shoot');
    expect(desc).toContain('• 50x Edited Photos');

    const parsed = parseDeliverablesFromDescription(desc);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.title).toBe('8 Hours Shoot');
    expect(parsed[1]?.quantity).toBe(50);
  });

  it('handles remaining reducer actions and edge cases', () => {
    let state = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: mockStudioSettings,
      packages: [mockPackage],
    });

    state = proposalBuilderReducer(state, {
      type: 'SELECT_PACKAGE',
      pkg: mockPackage,
    });

    // UPDATE_BASE_PACKAGE_PRICE
    state = proposalBuilderReducer(state, {
      type: 'UPDATE_BASE_PACKAGE_PRICE',
      majorPrice: '3000.00',
    });
    expect(state.basePackageItem?.unitPriceMinor).toBe(300000);

    // Negative base price
    state = proposalBuilderReducer(state, {
      type: 'UPDATE_BASE_PACKAGE_PRICE',
      majorPrice: '-10.00',
    });
    expect(state.basePackageItem?.unitPriceMinor).toBe(-1);

    // UPDATE_BASE_PACKAGE_TAX_RATE
    state = proposalBuilderReducer(state, {
      type: 'UPDATE_BASE_PACKAGE_TAX_RATE',
      taxRateBasisPoints: 700,
    });
    expect(state.basePackageItem?.taxRateBasisPoints).toBe(700);

    // UPDATE_DELIVERABLE_TITLE and UPDATE_DELIVERABLE_QTY
    state = proposalBuilderReducer(state, {
      type: 'UPDATE_DELIVERABLE_TITLE',
      index: 0,
      title: 'Updated Title',
    });
    expect(state.deliverables[0]?.title).toBe('Updated Title');

    state = proposalBuilderReducer(state, {
      type: 'UPDATE_DELIVERABLE_QTY',
      index: 0,
      quantity: 5,
    });
    expect(state.deliverables[0]?.quantity).toBe(5);

    // SELECT_PACKAGE with null resets package
    state = proposalBuilderReducer(state, {
      type: 'SELECT_PACKAGE',
      pkg: null,
    });
    expect(state.selectedPackageId).toBeNull();
    expect(state.basePackageItem).toBeNull();
    expect(state.deliverables).toHaveLength(0);

    // SET_SAVING, SET_SENDING, SET_LINK_COPIED, SET_SAVE_SUCCESS, SET_GENERAL_ERROR
    state = proposalBuilderReducer(state, { type: 'SET_SAVING', saving: true });
    expect(state.isSaving).toBe(true);
    state = proposalBuilderReducer(state, { type: 'SET_SENDING', sending: true });
    expect(state.isSending).toBe(true);
    state = proposalBuilderReducer(state, { type: 'SET_LINK_COPIED', copied: true });
    expect(state.linkCopied).toBe(true);
    state = proposalBuilderReducer(state, { type: 'SET_SAVE_SUCCESS', success: true });
    expect(state.saveSuccess).toBe(true);
    state = proposalBuilderReducer(state, { type: 'SET_GENERAL_ERROR', error: 'Custom Error' });
    expect(state.generalError).toBe('Custom Error');

    // buildSendPayload throws if proposal id is missing
    expect(() => buildSendPayload(state)).toThrow('Cannot send proposal without saved ID');

    // parseDeliverablesFromDescription handles null or text without deliverables
    expect(parseDeliverablesFromDescription(null)).toEqual([]);
    expect(parseDeliverablesFromDescription('')).toEqual([]);
    expect(parseDeliverablesFromDescription('Just plain text')).toEqual([]);
  });

  it('exercises createProposalBuilderActionHandlers flows (save, send, copy)', async () => {
    let state = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: mockStudioSettings,
      packages: [mockPackage],
    });

    state = proposalBuilderReducer(state, {
      type: 'SELECT_PACKAGE',
      pkg: mockPackage,
    });

    const dispatched: ProposalBuilderAction[] = [];
    const dispatch = (action: ProposalBuilderAction) => {
      dispatched.push(action);
      state = proposalBuilderReducer(state, action);
    };

    const mockRouter = {
      push: () => {
        /* no-op in mock */
      },
    };
    const savedId = '01920000-0000-7000-8000-000000000999';

    const saveDraftAction = (input: unknown) => {
      const payload = input as SaveDraftProposalInput;
      return Promise.resolve({
        success: true as const,
        data: {
          id: savedId,
          projectId: mockProject.id,
          clientId: mockClient.id,
          title: payload.title,
          status: 'draft' as const,
          version: 1,
          currency: 'EUR',
          subtotalMinor: 280000,
          taxMinor: 44706,
          totalMinor: 280000,
          pricesIncludeTax: true,
          isKleinunternehmer: false,
          taxNotice: null,
          validUntil: null,
          tokenHash: 'xyz',
          tokenRevokedAt: null,
          sentAt: null,
          acceptedAt: null,
          declinedAt: null,
          declineReason: null,
          acceptedByName: null,
          acceptedByEmail: null,
          acceptanceIpAnonymized: null,
          acceptanceUserAgent: null,
          acceptedOptionsSnapshot: null,
          internalNotes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          lineItems: [],
        },
      });
    };

    const sendAction = () =>
      Promise.resolve({
        success: true as const,
        data: {
          proposalId: savedId,
          rawToken: 'token123',
          tokenUrl: 'http://localhost:3000/p/token123',
        },
      });

    const handlers = (
      await import('@/components/proposals/proposal-builder-helpers')
    ).createProposalBuilderActionHandlers({
      state,
      getState: () => state,
      dispatch,
      t: mockT,
      router: mockRouter,
      locale: 'en',
      saveDraftAction,
      sendAction,
    });

    // Save draft on new proposal
    await handlers.onSaveDraft();
    expect(state.id).toBe(savedId);
    expect(state.saveSuccess).toBe(true);

    // Open send modal on saved proposal
    const handlersSaved = (
      await import('@/components/proposals/proposal-builder-helpers')
    ).createProposalBuilderActionHandlers({
      state,
      getState: () => state,
      dispatch,
      t: mockT,
      router: mockRouter,
      locale: 'en',
      saveDraftAction,
      sendAction,
    });

    await handlersSaved.onOpenSendModal();
    expect(state.sendModalOpen).toBe(true);

    // Submit send proposal
    await handlersSaved.onSubmitSendProposal();
    expect(state.status).toBe('sent');
    expect(state.sentResult?.tokenUrl).toBe('http://localhost:3000/p/token123');
    expect(state.sendModalOpen).toBe(false);

    // Copy link
    // mock navigator.clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: () => Promise.resolve(),
      },
    });
    await handlersSaved.onCopyLink();
    expect(state.linkCopied).toBe(true);

    // Copy link when sentResult is null
    state = { ...state, sentResult: null, linkCopied: false };
    await handlersSaved.onCopyLink();
    expect(state.linkCopied).toBe(false);

    // Test onOpenSendModal when proposal is unsaved
    let unsavedState = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: mockStudioSettings,
      packages: [mockPackage],
    });
    unsavedState = proposalBuilderReducer(unsavedState, {
      type: 'SELECT_PACKAGE',
      pkg: mockPackage,
    });

    const unsavedHandlers = (
      await import('@/components/proposals/proposal-builder-helpers')
    ).createProposalBuilderActionHandlers({
      state: unsavedState,
      getState: () => unsavedState,
      dispatch: (act) => {
        unsavedState = proposalBuilderReducer(unsavedState, act);
      },
      t: mockT,
      router: mockRouter,
      locale: 'en',
      saveDraftAction,
      sendAction,
    });

    await unsavedHandlers.onOpenSendModal();
    expect(unsavedState.id).toBe(savedId);
    expect(unsavedState.sendModalOpen).toBe(true);

    // Test onOpenSendModal with invalid form
    unsavedState = { ...unsavedState, id: undefined, title: '  ' };
    await unsavedHandlers.onOpenSendModal();
    expect(unsavedState.generalError).toBeTruthy();

    // Test onSaveDraft with validation failure
    let invalidState = { ...unsavedState, title: '' };
    const invalidHandlers = (
      await import('@/components/proposals/proposal-builder-helpers')
    ).createProposalBuilderActionHandlers({
      state: invalidState,
      getState: () => invalidState,
      dispatch: (act) => {
        invalidState = proposalBuilderReducer(invalidState, act);
      },
      t: mockT,
      router: mockRouter,
      locale: 'en',
      saveDraftAction,
      sendAction,
    });
    await invalidHandlers.onSaveDraft();
    expect(invalidState.generalError).toBeTruthy();

    // Test onSaveDraft server action error
    let failState = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: mockStudioSettings,
      packages: [mockPackage],
    });
    const failingHandlers = (
      await import('@/components/proposals/proposal-builder-helpers')
    ).createProposalBuilderActionHandlers({
      state: failState,
      getState: () => failState,
      dispatch: (act) => {
        failState = proposalBuilderReducer(failState, act);
      },
      t: mockT,
      router: mockRouter,
      locale: 'en',
      saveDraftAction: () =>
        Promise.resolve({ success: false, code: 'FORBIDDEN', error: 'Forbidden' }),
      sendAction: () => Promise.resolve({ success: false, code: 'ERROR', error: 'Send Error' }),
    });
    await failingHandlers.onSaveDraft();
    expect(failState.generalError).toBe('Forbidden');

    // Test onSaveDraft thrown exception
    const throwingHandlers = (
      await import('@/components/proposals/proposal-builder-helpers')
    ).createProposalBuilderActionHandlers({
      state: failState,
      getState: () => failState,
      dispatch: (act) => {
        failState = proposalBuilderReducer(failState, act);
      },
      t: mockT,
      router: mockRouter,
      locale: 'en',
      saveDraftAction: () => Promise.reject(new Error('Boom')),
      sendAction: () => Promise.reject(new Error('Boom Send')),
    });
    await throwingHandlers.onSaveDraft();
    expect(failState.generalError).toBe('Boom');

    // Test onSubmitSendProposal invalid date
    failState = { ...failState, id: 'some-id', sendModalDate: '2020-01-01' };
    await failingHandlers.onSubmitSendProposal();
    expect(failState.generalError).toBeTruthy();

    // Test onSubmitSendProposal server failure
    failState = { ...failState, sendModalDate: getDefaultExpirationDateString() };
    await failingHandlers.onSubmitSendProposal();
    expect(failState.generalError).toBe('Send Error');

    // Test onSubmitSendProposal exception
    await throwingHandlers.onSubmitSendProposal();
    expect(failState.generalError).toBe('Boom Send');

    // Test onOpenSendModal when unsaved and saveDraftAction fails
    let unsavedFailState = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: mockStudioSettings,
      packages: [mockPackage],
    });
    const unsavedFailingHandlers = (
      await import('@/components/proposals/proposal-builder-helpers')
    ).createProposalBuilderActionHandlers({
      state: unsavedFailState,
      getState: () => unsavedFailState,
      dispatch: (act) => {
        unsavedFailState = proposalBuilderReducer(unsavedFailState, act);
      },
      t: mockT,
      router: mockRouter,
      locale: 'en',
      saveDraftAction: () => Promise.resolve({ success: false, code: 'ERR', error: 'Save Failed' }),
      sendAction: () => Promise.resolve({ success: false, code: 'ERR', error: 'Send Error' }),
    });
    await unsavedFailingHandlers.onOpenSendModal();
    expect(unsavedFailState.generalError).toBe('Save Failed');

    // Test default reducer case and out-of-range MOVE_ITEM
    const defaultState = proposalBuilderReducer(unsavedFailState, {
      type: 'NON_EXISTENT_ACTION',
    } as unknown as ProposalBuilderAction);
    expect(defaultState).toBe(unsavedFailState);

    const invalidMove = proposalBuilderReducer(unsavedFailState, {
      type: 'MOVE_ITEM',
      from: -1,
      to: 0,
    });
    expect(invalidMove).toBe(unsavedFailState);

    const emailSet = proposalBuilderReducer(unsavedFailState, {
      type: 'SET_SEND_MODAL_EMAIL',
      email: 'test@example.com',
    });
    expect(emailSet.sendModalEmail).toBe('test@example.com');

    // Test validateProposalForm with long title
    const longTitleState = { ...unsavedFailState, title: 'a'.repeat(250) };
    const longTitleRes = validateProposalForm(longTitleState, mockT);
    expect(longTitleRes.isValid).toBe(false);
    expect(longTitleRes.errors.title).toBe('validation.titleTooLong');

    // Test formatDeliverablesDescription with empty
    expect(formatDeliverablesDescription('', [])).toBe('');

    // Test createInitialProposalState with populated proposal and matched package
    const existingHydratedState = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: mockStudioSettings,
      packages: [mockPackage],
      proposal: {
        id: '01920000-0000-7000-8000-000000000201',
        projectId: mockProject.id,
        clientId: mockClient.id,
        title: 'Hydrated Proposal',
        status: 'draft',
        version: 1,
        currency: 'EUR',
        subtotalMinor: 305000,
        taxMinor: 48697,
        totalMinor: 305000,
        pricesIncludeTax: true,
        isKleinunternehmer: false,
        taxNotice: null,
        validUntil: new Date('2026-12-31T23:59:59.999Z'),
        tokenHash: 'abc',
        tokenRevokedAt: null,
        sentAt: null,
        acceptedAt: null,
        declinedAt: null,
        declineReason: null,
        acceptedByName: null,
        acceptedByEmail: null,
        acceptanceIpAnonymized: null,
        acceptanceUserAgent: null,
        acceptedOptionsSnapshot: null,
        internalNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lineItems: [
          {
            id: 'item-1',
            proposalId: '01920000-0000-7000-8000-000000000201',
            packageId: mockPackage.id,
            catalogueItemId: null,
            itemType: 'base_package',
            name: 'Base Package',
            description: 'Included Deliverables:\n- 1x Album\n* Prints\nPlain line',
            unitPriceMinor: 280000,
            quantity: 1,
            minQuantity: 1,
            maxQuantity: 1,
            taxRateBasisPoints: 1900,
            isOptional: false,
            isSelected: true,
            position: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'item-2',
            proposalId: '01920000-0000-7000-8000-000000000201',
            packageId: null,
            catalogueItemId: mockCatalogueItem.id,
            itemType: 'addon',
            name: 'Extra Hour',
            description: null,
            unitPriceMinor: 25000,
            quantity: 1,
            minQuantity: 0,
            maxQuantity: 2,
            taxRateBasisPoints: 1900,
            isOptional: true,
            isSelected: true,
            position: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'item-3',
            proposalId: '01920000-0000-7000-8000-000000000201',
            packageId: null,
            catalogueItemId: null,
            itemType: 'custom',
            name: 'Custom Shoot',
            description: null,
            unitPriceMinor: 10000,
            quantity: 1,
            minQuantity: 0,
            maxQuantity: 1,
            taxRateBasisPoints: 1900,
            isOptional: false,
            isSelected: true,
            position: 2,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    });
    expect(existingHydratedState.basePackageItem?.name).toBe('Base Package');
    expect(existingHydratedState.addonItems).toHaveLength(2);
    expect(existingHydratedState.deliverables.length).toBeGreaterThan(0);

    // Test fallback deliverables parsing when package is not in packages list
    const unlistedPkgState = createInitialProposalState({
      project: mockProject,
      client: mockClient,
      studioSettings: mockStudioSettings,
      packages: [],
      proposal: {
        id: '01920000-0000-7000-8000-000000000201',
        projectId: mockProject.id,
        clientId: mockClient.id,
        title: 'Unlisted Pkg Proposal',
        status: 'draft',
        version: 1,
        currency: 'EUR',
        subtotalMinor: 280000,
        taxMinor: 44706,
        totalMinor: 280000,
        pricesIncludeTax: true,
        isKleinunternehmer: false,
        taxNotice: null,
        validUntil: null,
        tokenHash: 'abc',
        tokenRevokedAt: null,
        sentAt: null,
        acceptedAt: null,
        declinedAt: null,
        declineReason: null,
        acceptedByName: null,
        acceptedByEmail: null,
        acceptanceIpAnonymized: null,
        acceptanceUserAgent: null,
        acceptedOptionsSnapshot: null,
        internalNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lineItems: [
          {
            id: 'item-1',
            proposalId: '01920000-0000-7000-8000-000000000201',
            packageId: 'unlisted-package-id',
            catalogueItemId: null,
            itemType: 'base_package',
            name: 'Custom Base',
            description: 'Included Deliverables:\n- 1x Album\n* Prints\nPlain line',
            unitPriceMinor: 280000,
            quantity: 1,
            minQuantity: 1,
            maxQuantity: 1,
            taxRateBasisPoints: 1900,
            isOptional: false,
            isSelected: true,
            position: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    });
    expect(unlistedPkgState.deliverables).toHaveLength(2);

    // Test validateProposalForm basePackageItem with negative price and addon empty name
    const currentBase = existingHydratedState.basePackageItem;
    const currentAddon = existingHydratedState.addonItems[0];
    if (!currentBase || !currentAddon) {
      throw new Error('Expected hydrated state to have basePackageItem and addon');
    }
    const invalidItemsState: ProposalBuilderState = {
      ...existingHydratedState,
      basePackageItem: {
        ...currentBase,
        unitPriceMinor: -100,
      },
      addonItems: [
        {
          ...currentAddon,
          name: '  ',
        },
      ],
    };
    const invalidItemsRes = validateProposalForm(invalidItemsState, mockT);
    expect(invalidItemsRes.isValid).toBe(false);
    expect(invalidItemsRes.errors.basePackage?.unitPrice).toBe('validation.negativePrice');
    expect(invalidItemsRes.errors.items?.[0]?.name).toBe('validation.nameRequired');

    // Test validateSendModal with empty date and invalid email
    const invalidModalState: ProposalBuilderState = {
      ...existingHydratedState,
      sendModalDate: '',
      sendModalEmail: 'invalid-email',
    };
    const invalidModalRes = validateSendModal(invalidModalState, mockT);
    expect(invalidModalRes.isValid).toBe(false);
    expect(invalidModalRes.errors.sendDate).toBe('validation.dateInPast');
    expect(invalidModalRes.errors.sendEmail).toBe('validation.invalidEmail');

    // Test non-Error exception handling in handlers
    let nonErrorState: ProposalBuilderState = {
      ...existingHydratedState,
      id: 'some-id',
      sendModalDate: getDefaultExpirationDateString(),
    };
    const nonErrorHandlers = (
      await import('@/components/proposals/proposal-builder-helpers')
    ).createProposalBuilderActionHandlers({
      state: nonErrorState,
      getState: () => nonErrorState,
      dispatch: (act) => {
        nonErrorState = proposalBuilderReducer(nonErrorState, act);
      },
      t: mockT,
      router: mockRouter,
      locale: 'en',
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- explicitly testing non-Error string exception fallback
      saveDraftAction: () => Promise.reject('String save error'),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- explicitly testing non-Error string exception fallback
      sendAction: () => Promise.reject('String send error'),
    });
    await nonErrorHandlers.onSaveDraft();
    expect(nonErrorState.generalError).toBe('Error saving draft proposal');

    await nonErrorHandlers.onSubmitSendProposal();
    expect(nonErrorState.generalError).toBe('Error sending proposal');

    // Test send modal error when sendDate is valid but email is invalid
    const invalidEmailState: ProposalBuilderState = {
      ...nonErrorState,
      sendModalEmail: 'not-an-email',
    };
    const emailErrHandlers = (
      await import('@/components/proposals/proposal-builder-helpers')
    ).createProposalBuilderActionHandlers({
      state: invalidEmailState,
      getState: () => invalidEmailState,
      dispatch: (act) => {
        nonErrorState = proposalBuilderReducer(nonErrorState, act);
      },
      t: mockT,
      router: mockRouter,
      locale: 'en',
      saveDraftAction: () => Promise.resolve({ success: true as const, data: null as never }),
      sendAction: () => Promise.resolve({ success: true as const, data: null as never }),
    });
    await emailErrHandlers.onSubmitSendProposal();
    expect(nonErrorState.generalError).toBe('validation.invalidEmail');

    // Test onCopyLink clipboard exception handling
    Object.assign(navigator, {
      clipboard: {
        writeText: () => Promise.reject(new Error('Clipboard denied')),
      },
    });
    const clipboardFailState: ProposalBuilderState = {
      ...nonErrorState,
      sentResult: { proposalId: 'p-1', rawToken: 'tok', tokenUrl: 'http://test' },
      linkCopied: false,
    };
    const clipboardFailHandlers = (
      await import('@/components/proposals/proposal-builder-helpers')
    ).createProposalBuilderActionHandlers({
      state: clipboardFailState,
      getState: () => clipboardFailState,
      dispatch: (act) => {
        nonErrorState = proposalBuilderReducer(nonErrorState, act);
      },
      t: mockT,
      router: mockRouter,
      locale: 'en',
      saveDraftAction: () => Promise.resolve({ success: true as const, data: null as never }),
      sendAction: () => Promise.resolve({ success: true as const, data: null as never }),
    });
    await clipboardFailHandlers.onCopyLink();
    expect(nonErrorState.linkCopied).toBe(true);

    // Test UPDATE_BASE_PACKAGE_PRICE and TAX_RATE when basePackageItem is null
    const noBaseState = { ...failState, basePackageItem: null };
    expect(
      proposalBuilderReducer(noBaseState, { type: 'UPDATE_BASE_PACKAGE_PRICE', majorPrice: '100' }),
    ).toBe(noBaseState);
    expect(
      proposalBuilderReducer(noBaseState, {
        type: 'UPDATE_BASE_PACKAGE_TAX_RATE',
        taxRateBasisPoints: 1900,
      }),
    ).toBe(noBaseState);

    // Test onOpenSendModal with valid title but negative item price
    let invalidItemSendState: ProposalBuilderState = {
      ...failState,
      id: undefined,
      title: 'Valid Title',
      basePackageItem: {
        ...mockPackage,
        itemType: 'base_package' as const,
        unitPriceMajor: '-10',
        unitPriceMinor: -1,
        quantity: 1,
        minQuantity: 1,
        maxQuantity: 1,
        position: 0,
        isOptional: false,
        isSelected: true,
      },
      addonItems: [
        {
          id: '1',
          itemType: 'custom' as const,
          name: 'Item 1',
          unitPriceMajor: '-5',
          unitPriceMinor: -1,
          quantity: 1,
          minQuantity: 0,
          maxQuantity: 1,
          taxRateBasisPoints: 1900,
          isOptional: false,
          isSelected: true,
          position: 0,
        },
      ],
    };
    const invalidItemSendHandlers = (
      await import('@/components/proposals/proposal-builder-helpers')
    ).createProposalBuilderActionHandlers({
      state: invalidItemSendState,
      getState: () => invalidItemSendState,
      dispatch: (act) => {
        invalidItemSendState = proposalBuilderReducer(invalidItemSendState, act);
      },
      t: mockT,
      router: mockRouter,
      locale: 'en',
      saveDraftAction: () => Promise.resolve({ success: true as const, data: null as never }),
      sendAction: () => Promise.resolve({ success: true as const, data: null as never }),
    });
    await invalidItemSendHandlers.onOpenSendModal();
    expect(invalidItemSendState.generalError).toBe('validation.negativePrice');

    // Test onSaveDraft with existing proposal id (no router.push)
    const existingDraftState: ProposalBuilderState = { ...failState, id: 'some-existing-id' };
    let savedState: ProposalBuilderState = existingDraftState;
    const existingSaveHandlers = (
      await import('@/components/proposals/proposal-builder-helpers')
    ).createProposalBuilderActionHandlers({
      state: existingDraftState,
      getState: () => savedState,
      dispatch: (act) => {
        savedState = proposalBuilderReducer(savedState, act);
      },
      t: mockT,
      router: mockRouter,
      locale: 'en',
      saveDraftAction,
      sendAction,
    });
    await existingSaveHandlers.onSaveDraft();
    expect(savedState.saveSuccess).toBe(true);
  });

  it('exercises createProposalBuilderViewHandlers and row helper controllers', async () => {
    const {
      createProposalBuilderViewHandlers,
      createDeliverableRowHandlers,
      createAddonRowHandlers,
    } = await import('@/components/proposals/proposal-builder-helpers');

    const dispatched: ProposalBuilderAction[] = [];
    const dispatch = (act: ProposalBuilderAction) => {
      dispatched.push(act);
    };
    const viewHandlers = createProposalBuilderViewHandlers(dispatch);

    viewHandlers.onTitleChange('New Title');
    viewHandlers.onSelectPackage(mockPackage);
    viewHandlers.onUpdateBasePrice('2500.00');
    viewHandlers.onUpdateTaxRate(700);
    viewHandlers.onAddDeliverable('Album', 1);
    viewHandlers.onUpdateDeliverableTitle(0, 'Updated Album');
    viewHandlers.onUpdateDeliverableQty(0, 2);
    viewHandlers.onRemoveDeliverable(0);
    viewHandlers.onAddCatalogueItem(mockCatalogueItem);
    viewHandlers.onAddCustomItem();
    viewHandlers.onUpdateItemField(0, 'name', 'Custom Item');
    viewHandlers.onMoveItem(0, 1);
    viewHandlers.onRemoveItem(0);
    viewHandlers.onCloseSendModal();
    viewHandlers.onSendDateChange('2026-10-10');
    viewHandlers.onSendEmailChange('client@example.com');
    viewHandlers.handleTitleInputChange({
      target: { value: 'Input Title' },
    } as unknown as React.ChangeEvent<HTMLInputElement>);

    expect(dispatched).toHaveLength(18);
    expect(dispatched[0]).toEqual({ type: 'SET_TITLE', title: 'New Title' });
    expect(dispatched[1]).toEqual({ type: 'SELECT_PACKAGE', pkg: mockPackage });
    expect(dispatched[2]).toEqual({ type: 'UPDATE_BASE_PACKAGE_PRICE', majorPrice: '2500.00' });

    // Deliverable row handlers
    const delUpdated: unknown[] = [];
    const delHandlers = createDeliverableRowHandlers(
      1,
      (idx, title) => {
        delUpdated.push({ idx, title });
      },
      (idx, qty) => {
        delUpdated.push({ idx, qty });
      },
      (idx) => {
        delUpdated.push({ removeIdx: idx });
      },
    );
    delHandlers.handleQtyChange({
      target: { value: '3' },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
    delHandlers.handleTitleChange({
      target: { value: 'Canvas' },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
    delHandlers.handleRemove();
    expect(delUpdated).toEqual([{ idx: 1, qty: 3 }, { idx: 1, title: 'Canvas' }, { removeIdx: 1 }]);

    // Addon row handlers
    const addonUpdated: unknown[] = [];
    const addonHandlers = createAddonRowHandlers(
      2,
      (idx, field, value) => {
        addonUpdated.push({ idx, field, value });
      },
      (from, to) => {
        addonUpdated.push({ moveFrom: from, moveTo: to });
      },
      (idx) => {
        addonUpdated.push({ removeIdx: idx });
      },
    );
    addonHandlers.handleNameChange({
      target: { value: 'Drone' },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
    addonHandlers.handlePriceChange({
      target: { value: '450.00' },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
    addonHandlers.handleQuantityChange({
      target: { value: '2' },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
    addonHandlers.handleMaxQuantityChange({
      target: { value: '5' },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
    addonHandlers.handleTaxRateChange({
      target: { value: '1900' },
    } as unknown as React.ChangeEvent<HTMLSelectElement>);
    addonHandlers.handleOptionalChange({
      target: { checked: true },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
    addonHandlers.handleMoveUp();
    addonHandlers.handleMoveDown();
    addonHandlers.handleRemove();

    expect(addonUpdated).toHaveLength(9);
    expect(addonUpdated[0]).toEqual({ idx: 2, field: 'name', value: 'Drone' });
    expect(addonUpdated[5]).toEqual({ idx: 2, field: 'isOptional', value: true });
    expect(addonUpdated[6]).toEqual({ moveFrom: 2, moveTo: 1 });
    expect(addonUpdated[7]).toEqual({ moveFrom: 2, moveTo: 3 });
    expect(addonUpdated[8]).toEqual({ removeIdx: 2 });
  });

  it('exercises createPackageSectionController, createAddonSectionController, and createSendModalController', async () => {
    const {
      createPackageSectionController,
      createAddonSectionController,
      createSendModalController,
    } = await import('@/components/proposals/proposal-builder-helpers');

    // Package Section Controller
    const pkgActions: unknown[] = [];
    let delTitle = '';
    let delQty = '1';
    const pkgController = createPackageSectionController(
      (pkg) => {
        pkgActions.push({ selectPkg: pkg });
      },
      (price) => {
        pkgActions.push({ basePrice: price });
      },
      (rate) => {
        pkgActions.push({ taxRate: rate });
      },
      (title, qty) => {
        pkgActions.push({ addDel: title, qty });
      },
      [mockPackage],
      (val) => {
        delTitle = val;
      },
      (val) => {
        delQty = val;
      },
    );

    pkgController.handlePackageSelectChange('');
    expect(pkgActions[0]).toEqual({ selectPkg: null });

    pkgController.handlePackageSelectChange(mockPackage.id);
    expect(pkgActions[1]).toEqual({ selectPkg: mockPackage });

    pkgController.handleBasePriceChange({
      target: { value: '3000.00' },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
    expect(pkgActions[2]).toEqual({ basePrice: '3000.00' });

    pkgController.handleTaxRateChange({
      target: { value: '700' },
    } as unknown as React.ChangeEvent<HTMLSelectElement>);
    expect(pkgActions[3]).toEqual({ taxRate: 700 });

    expect(pkgController.handleAddDeliverable('  ', '1')).toBe(false);
    expect(pkgController.handleAddDeliverable('Prints', '5')).toBe(true);
    expect(pkgActions[4]).toEqual({ addDel: 'Prints', qty: 5 });

    pkgController.handleTitleInputChange({
      target: { value: 'New Deliverable' },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
    expect(delTitle).toBe('New Deliverable');

    pkgController.handleQtyInputChange({
      target: { value: '3' },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
    expect(delQty).toBe('3');

    const fakePreventDefault = vi.fn();
    const fakeSubmitEvent = {
      preventDefault: fakePreventDefault,
    } as unknown as React.SyntheticEvent;

    // Invalid submit (blank title)
    expect(pkgController.handleAddDeliverableSubmit('', '1')(fakeSubmitEvent)).toBe(false);
    expect(fakePreventDefault).toHaveBeenCalled();

    // Valid submit
    expect(pkgController.handleAddDeliverableSubmit('Albums', '2')(fakeSubmitEvent)).toBe(true);
    expect(delTitle).toBe('');
    expect(delQty).toBe('1');

    // Addon Section Controller
    const addonActions: unknown[] = [];
    let selectedCatId = '';
    const addonController = createAddonSectionController(
      [mockCatalogueItem],
      (item) => {
        addonActions.push(item);
      },
      (id) => {
        selectedCatId = id;
      },
    );

    expect(addonController.findAndAddCatalogueItem('')).toBe(false);
    expect(addonController.findAndAddCatalogueItem('non-existent-id')).toBe(false);
    expect(addonController.findAndAddCatalogueItem(mockCatalogueItem.id)).toBe(true);
    expect(addonActions[0]).toEqual(mockCatalogueItem);
    expect(selectedCatId).toBe('');

    addonController.handleCatalogueSelectChange({
      target: { value: mockCatalogueItem.id },
    } as unknown as React.ChangeEvent<HTMLSelectElement>);
    expect(selectedCatId).toBe(mockCatalogueItem.id);

    // handleAddCatalogueClick curried handler
    expect(addonController.handleAddCatalogueClick('')()).toBe(false);
    expect(addonController.handleAddCatalogueClick('unknown-id')()).toBe(false);
    expect(addonController.handleAddCatalogueClick(mockCatalogueItem.id)()).toBe(true);

    // Send Modal Controller
    let modalClosed = false;
    let modalDate = '';
    let modalEmail = '';
    const mockFocus = vi.fn();
    const mockTriggerRef = { current: { focus: mockFocus } as unknown as HTMLElement };

    const modalController = createSendModalController(
      () => {
        modalClosed = true;
      },
      (date) => {
        modalDate = date;
      },
      (email) => {
        modalEmail = email;
      },
      mockTriggerRef,
    );

    modalController.handleOpenChange(true);
    expect(modalClosed).toBe(false);

    modalController.handleOpenChange(false);
    expect(modalClosed).toBe(true);

    const fakeClosePreventDefault = vi.fn();
    const fakeCloseEvent = { preventDefault: fakeClosePreventDefault } as unknown as Event;
    modalController.handleCloseAutoFocus(fakeCloseEvent);
    expect(fakeClosePreventDefault).toHaveBeenCalled();
    expect(mockFocus).toHaveBeenCalled();

    modalController.handleDateChange({
      target: { value: '2026-06-30' },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
    expect(modalDate).toBe('2026-06-30');

    modalController.handleEmailChange({
      target: { value: 'client@example.com' },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
    expect(modalEmail).toBe('client@example.com');
  });
});
