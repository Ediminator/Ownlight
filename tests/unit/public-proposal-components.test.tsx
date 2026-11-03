import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

import {
  type PublicLineItem,
  type ClientItemSelection,
  resolveProposalLifecycleState,
  formatProposalCurrency,
  formatProposalDate,
  calculateLiveTotals,
  validateAcceptanceForm,
  applyAddonToggle,
  applyQuantityChange,
  buildAcceptProposalPayload,
  createInitialModalFormState,
  modalFormReducer,
  createAcceptanceModalController,
  createProposalViewController,
} from '@/components/proposals/public/public-proposal-helpers';
import { PublicProposalView } from '@/components/proposals/public/public-proposal-view';
import { AcceptProposalModal } from '@/components/proposals/public/accept-proposal-modal';
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

// Helper to resolve translation string from json or throw if key is missing
function createStrictMockTranslator(messagesObj: Record<string, unknown>, baseNamespace: string) {
  return (key: string, params?: Record<string, unknown>) => {
    const fullPath = `${baseNamespace}.${key}`;
    const parts = fullPath.split('.');
    let current: unknown = messagesObj;
    for (const part of parts) {
      if (!current || typeof current !== 'object') {
        throw new Error(`Missing translation key: ${fullPath}`);
      }
      if (!Object.prototype.hasOwnProperty.call(current, part)) {
        throw new Error(`Missing translation key: ${fullPath}`);
      }
      current = Reflect.get(current as Record<string, unknown>, part);
    }
    if (typeof current !== 'string') {
      throw new Error(`Missing translation key: ${fullPath}`);
    }
    let res = current;
    if (params) {
      for (const [pk, pv] of Object.entries(params)) {
        res = res.replaceAll(`{${pk}}`, String(pv));
      }
    }
    return res;
  };
}

let currentLocale = 'en';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    const messages = currentLocale === 'de' ? deMessages : enMessages;
    return createStrictMockTranslator(messages, ns);
  },
}));

vi.mock('@/server/proposals/public-actions', () => ({
  acceptProposalAction: vi.fn(),
}));

describe('TASK-0062: Public Proposal Components & Helpers', () => {
  const mockLineItems: PublicLineItem[] = [
    {
      id: 'item-base-1',
      itemType: 'base_package',
      name: 'Full Day Wedding Coverage',
      description: '8 hours of shooting, 400+ high-res images',
      unitPriceMinor: 200000, // €2,000.00 gross
      quantity: 1,
      minQuantity: 1,
      maxQuantity: 1,
      taxRateBasisPoints: 1900,
      isOptional: false,
      isSelected: true,
      position: 0,
    },
    {
      id: 'item-addon-drone',
      itemType: 'addon',
      name: 'Drone Aerial Footage',
      description: '4K aerial ceremony coverage',
      unitPriceMinor: 35000, // €350.00 gross
      quantity: 1,
      minQuantity: 0,
      maxQuantity: 2,
      taxRateBasisPoints: 1900,
      isOptional: true,
      isSelected: false,
      position: 1,
    },
    {
      id: 'item-addon-album',
      itemType: 'addon',
      name: 'Handcrafted Linen Album',
      description: '30 pages 30x30cm fine art print',
      unitPriceMinor: 45000, // €450.00 gross
      quantity: 1,
      minQuantity: 0,
      maxQuantity: 5,
      taxRateBasisPoints: 1900,
      isOptional: true,
      isSelected: true,
      position: 2,
    },
  ];

  describe('resolveProposalLifecycleState', () => {
    it('AC-3: resolves to "accepted" when status is accepted', () => {
      const state = resolveProposalLifecycleState({
        status: 'accepted',
        tokenRevokedAt: null,
        validUntil: '2026-12-31T00:00:00Z',
      });
      expect(state).toBe('accepted');
    });

    it('AC-5: resolves to "revoked" when tokenRevokedAt is set', () => {
      const state = resolveProposalLifecycleState({
        status: 'sent',
        tokenRevokedAt: '2026-11-01T12:00:00Z',
        validUntil: '2026-12-31T00:00:00Z',
      });
      expect(state).toBe('revoked');
    });

    it('AC-4: resolves to "expired" when validUntil is in the past', () => {
      const past = new Date('2026-10-01T00:00:00Z');
      const state = resolveProposalLifecycleState(
        {
          status: 'sent',
          tokenRevokedAt: null,
          validUntil: past.toISOString(),
        },
        new Date('2026-11-01T00:00:00Z'),
      );
      expect(state).toBe('expired');
    });

    it('AC-1: resolves to "active" when sent and unexpired without revocation', () => {
      const future = new Date('2026-12-01T00:00:00Z');
      const state = resolveProposalLifecycleState(
        {
          status: 'sent',
          tokenRevokedAt: null,
          validUntil: future.toISOString(),
        },
        new Date('2026-11-01T00:00:00Z'),
      );
      expect(state).toBe('active');
    });
  });

  describe('calculateLiveTotals pure helper', () => {
    it('AC-2: reactively recalculates subtotal, VAT, and total matching integer minor units', () => {
      // Base package (200000) + Linen album (45000 * 2) = 290000 gross
      const selections = {
        'item-base-1': { isSelected: true, quantity: 1 },
        'item-addon-drone': { isSelected: false, quantity: 1 },
        'item-addon-album': { isSelected: true, quantity: 2 },
      };

      const result = calculateLiveTotals(mockLineItems, selections, {
        pricesIncludeTax: true,
        isKleinunternehmer: false,
      });

      expect(result.totalMinor).toBe(290000); // €2,900.00
      expect(result.subtotalMinor).toBe(290000);
      expect(result.taxMinor).toBeGreaterThan(0);
      expect(result.breakdown).toHaveLength(1);
      const b0 = result.breakdown[0];
      expect(b0).toBeDefined();
      if (!b0) throw new Error('Breakdown element missing');
      expect(b0.taxRateBasisPoints).toBe(1900);
      expect(b0.grossMinor).toBe(290000);
      expect(b0.netMinor + b0.taxMinor).toBe(290000);
    });

    it('AC-2: enforces zero VAT in Kleinunternehmer mode (§19 UStG)', () => {
      const selections = {
        'item-base-1': { isSelected: true, quantity: 1 },
        'item-addon-drone': { isSelected: true, quantity: 1 },
        'item-addon-album': { isSelected: false, quantity: 1 },
      };

      const result = calculateLiveTotals(mockLineItems, selections, {
        pricesIncludeTax: true,
        isKleinunternehmer: true,
      });

      expect(result.totalMinor).toBe(235000); // 200000 + 35000
      expect(result.subtotalMinor).toBe(235000);
      expect(result.taxMinor).toBe(0);
      expect(result.breakdown).toHaveLength(0);
    });
  });

  describe('validateAcceptanceForm', () => {
    const t = (k: string) => `err_${k}`;

    it('AC-3: validates required name and valid email and agreement', () => {
      const res = validateAcceptanceForm('Emma Watson', 'emma@example.com', true, t);
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual({});
    });

    it('AC-3: flags missing name, invalid email, and unconfirmed agreement', () => {
      const res = validateAcceptanceForm('', 'not-an-email', false, t);
      expect(res.valid).toBe(false);
      expect(res.errors.name).toBe('err_nameRequired');
      expect(res.errors.email).toBe('err_emailInvalid');
      expect(res.errors.agreement).toBe('err_agreementRequired');
    });
  });

  describe('applyAddonToggle & applyQuantityChange & buildAcceptProposalPayload', () => {
    it('AC-2: toggles addon selection state', () => {
      const init = {
        'item-1': { isSelected: false, quantity: 1 },
      };
      const toggledOn = applyAddonToggle(init, 'item-1', true);
      expect(toggledOn['item-1']?.isSelected).toBe(true);

      const toggledOff = applyAddonToggle(toggledOn, 'item-1', false);
      expect(toggledOff['item-1']?.isSelected).toBe(false);
    });

    it('AC-2: clamps quantity between minQuantity and maxQuantity', () => {
      const init = {
        'item-addon-album': { isSelected: true, quantity: 1 },
      };
      const albumItem = mockLineItems[2];
      expect(albumItem).toBeDefined();
      if (!albumItem) throw new Error('Album line item missing');

      // Increment
      const incremented = applyQuantityChange(init, albumItem, 2);
      expect(incremented['item-addon-album']?.quantity).toBe(3);

      // Decrement below min
      const decremented = applyQuantityChange(incremented, albumItem, -10);
      expect(decremented['item-addon-album']?.quantity).toBe(albumItem.minQuantity);

      // Increment above max
      const maxed = applyQuantityChange(incremented, albumItem, 10);
      expect(maxed['item-addon-album']?.quantity).toBe(albumItem.maxQuantity);
    });

    it('AC-3: buildAcceptProposalPayload filters selected add-ons and structures payload', () => {
      const selections = {
        'item-base-1': { isSelected: true, quantity: 1 },
        'item-addon-drone': { isSelected: true, quantity: 2 },
        'item-addon-album': { isSelected: false, quantity: 1 },
      };

      const payload = buildAcceptProposalPayload(
        'tok-xyz',
        'Emma Watson',
        'emma@example.com',
        selections,
        mockLineItems,
      );

      expect(payload.token).toBe('tok-xyz');
      expect(payload.acceptedByName).toBe('Emma Watson');
      expect(payload.acceptedByEmail).toBe('emma@example.com');
      expect(payload.agreementConfirmed).toBe(true);
      expect(payload.selectedOptions).toEqual([{ id: 'item-addon-drone', quantity: 2 }]);
    });
  });

  describe('formatProposalCurrency & formatProposalDate', () => {
    it('formats currency correctly in en and de locales', () => {
      const enVal = formatProposalCurrency(250000, 'EUR', 'en');
      const deVal = formatProposalCurrency(250000, 'EUR', 'de');
      expect(enVal).toContain('2,500.00');
      expect(deVal).toContain('2.500,00');
    });

    it('formats dates consistently', () => {
      const date = new Date('2026-11-20T10:00:00Z');
      expect(formatProposalDate(date, 'en')).toBeTruthy();
      expect(formatProposalDate(date, 'de')).toBeTruthy();
    });

    it('handles invalid date values gracefully in formatProposalDate', () => {
      expect(formatProposalDate('not-a-date')).toBe('not-a-date');
    });

    it('handles fallback formatting when currency is invalid in formatProposalCurrency', () => {
      const res = formatProposalCurrency(10000, 'INVALID_CURRENCY_CODE', 'en');
      expect(res).toBe('€100.00');
    });
  });

  describe('calculateLiveTotals edge cases', () => {
    it('includes non-optional custom deliverables by default', () => {
      const customItem: PublicLineItem = {
        id: 'item-custom-1',
        itemType: 'custom',
        name: 'Extra Hour',
        unitPriceMinor: 15000,
        quantity: 1,
        minQuantity: 1,
        maxQuantity: 1,
        taxRateBasisPoints: 1900,
        isOptional: false,
        isSelected: true,
        position: 3,
      };

      const result = calculateLiveTotals(
        [customItem],
        {},
        {
          pricesIncludeTax: true,
          isKleinunternehmer: false,
        },
      );

      expect(result.totalMinor).toBe(15000);
    });

    it('resolveProposalLifecycleState handles null validUntil and undefined tokenRevokedAt', () => {
      const state = resolveProposalLifecycleState({
        status: 'sent',
        tokenRevokedAt: null,
        validUntil: null,
      });
      expect(state).toBe('active');
    });
  });

  describe('Static rendering verification in EN and DE', () => {
    const activeProposalData = {
      id: 'prop-123',
      title: 'Emma & Liam Wedding Coverage',
      status: 'sent',
      currency: 'EUR',
      subtotalMinor: 200000,
      taxMinor: 31933,
      totalMinor: 200000,
      pricesIncludeTax: true,
      isKleinunternehmer: false,
      validUntil: '2026-12-31T23:59:59Z',
      tokenRevokedAt: null,
      acceptedAt: null,
      acceptedByName: null,
      acceptedByEmail: null,
      lineItems: mockLineItems,
    };

    it('AC-1: renders active proposal view in EN with all deliverables without missing keys', () => {
      currentLocale = 'en';
      const html = renderToStaticMarkup(
        <PublicProposalView
          proposal={activeProposalData}
          studioName="Light & Shadow Studios"
          token="secret-token-123"
          locale="en"
          clientContactName="Emma Watson"
          clientContactEmail="emma@example.com"
        />,
      );

      expect(html).toContain('Light &amp; Shadow Studios');
      expect(html).toContain('Emma &amp; Liam Wedding Coverage');
      expect(html).toContain('Full Day Wedding Coverage');
      expect(html).toContain('Drone Aerial Footage');
      expect(html).toContain('Handcrafted Linen Album');
      expect(html).toContain('accept-proposal-btn');
    });

    it('AC-7: renders active proposal view in DE with all translations without missing keys', () => {
      currentLocale = 'de';
      const html = renderToStaticMarkup(
        <PublicProposalView
          proposal={activeProposalData}
          studioName="Licht &amp; Schatten Fotografie"
          token="secret-token-123"
          locale="de"
          clientContactName="Emma Watson"
          clientContactEmail="emma@example.com"
        />,
      );

      expect(html).toContain('Licht &amp; Schatten Fotografie');
      expect(html).toContain('Basispaket');
      expect(html).toContain('Optionale Zusatzleistungen');
      expect(html).toContain('Preisübersicht');
      expect(html).toContain('Angebot annehmen');
      expect(html).not.toContain('undefined');
    });

    it('AC-4: renders expired proposal view with expired banner', () => {
      currentLocale = 'en';
      const expiredData = {
        ...activeProposalData,
        validUntil: '2026-10-01T00:00:00Z',
      };
      const html = renderToStaticMarkup(
        <PublicProposalView
          proposal={expiredData}
          studioName="Light &amp; Shadow Studios"
          token="secret-token-123"
          locale="en"
        />,
      );

      expect(html).toContain('proposal-expired-banner');
      expect(html).toContain('Proposal Expired');
    });

    it('AC-5: renders revoked proposal view with revoked banner', () => {
      currentLocale = 'en';
      const revokedData = {
        ...activeProposalData,
        tokenRevokedAt: '2026-11-01T00:00:00Z',
      };
      const html = renderToStaticMarkup(
        <PublicProposalView
          proposal={revokedData}
          studioName="Light &amp; Shadow Studios"
          token="secret-token-123"
          locale="en"
        />,
      );

      expect(html).toContain('proposal-revoked-banner');
      expect(html).toContain('Link No Longer Active');
    });

    it('AC-3: renders accepted proposal view with confirmation banner', () => {
      currentLocale = 'en';
      const acceptedData = {
        ...activeProposalData,
        status: 'accepted',
        acceptedAt: '2026-11-02T15:30:00Z',
        acceptedByName: 'Emma Watson',
        acceptedByEmail: 'emma@example.com',
      };
      const html = renderToStaticMarkup(
        <PublicProposalView
          proposal={acceptedData}
          studioName="Light &amp; Shadow Studios"
          token="secret-token-123"
          locale="en"
        />,
      );

      expect(html).toContain('proposal-accepted-banner');
      expect(html).toContain('Proposal Accepted');
      expect(html).toContain('Emma Watson');
      expect(html).toContain('emma@example.com');
    });

    it('AC-3 / AC-7: renders AcceptProposalModal in open state in EN and DE', () => {
      currentLocale = 'en';
      const enHtml = renderToStaticMarkup(
        <AcceptProposalModal
          isOpen={true}
          onClose={() => {
            /* no-op */
          }}
          proposalTitle="Wedding Photography"
          formattedTotal="€2,000.00"
          isSubmitting={false}
          defaultName="Emma Watson"
          defaultEmail="emma@example.com"
          onSubmit={() => {
            /* no-op */
          }}
        />,
      );

      expect(enHtml).toContain('accept-proposal-dialog');
      expect(enHtml).toContain('accepted-name-input');
      expect(enHtml).toContain('accepted-email-input');
      expect(enHtml).toContain('agreement-checkbox');
      expect(enHtml).toContain('Confirm &amp; Accept Proposal');

      currentLocale = 'de';
      const deHtml = renderToStaticMarkup(
        <AcceptProposalModal
          isOpen={true}
          onClose={() => {
            /* no-op */
          }}
          proposalTitle="Hochzeitsfotografie"
          formattedTotal="2.000,00 €"
          isSubmitting={false}
          defaultName="Emma Watson"
          defaultEmail="emma@example.com"
          onSubmit={() => {
            /* no-op */
          }}
        />,
      );

      expect(deHtml).toContain('accept-proposal-dialog');
      expect(deHtml).toContain('Verbindlich annehmen');
      expect(deHtml).toContain('Vollständiger Name');
      expect(deHtml).toContain('E-Mail-Adresse');
    });

    it('renders AcceptProposalModal with serverError and isSubmitting state', () => {
      currentLocale = 'en';
      const html = renderToStaticMarkup(
        <AcceptProposalModal
          isOpen={true}
          onClose={() => {
            /* no-op */
          }}
          proposalTitle="Wedding Photography"
          formattedTotal="€2,000.00"
          isSubmitting={true}
          serverError="Database connection error occurred"
          defaultName="Emma Watson"
          defaultEmail="emma@example.com"
          onSubmit={() => {
            /* no-op */
          }}
        />,
      );

      expect(html).toContain('accept-proposal-error');
      expect(html).toContain('Database connection error occurred');
      expect(html).toContain('disabled');
    });

    it('renders AcceptProposalModal with initial validation errors', () => {
      currentLocale = 'en';
      const html = renderToStaticMarkup(
        <AcceptProposalModal
          isOpen={true}
          onClose={() => {
            /* no-op */
          }}
          proposalTitle="Wedding Photography"
          formattedTotal="€2,000.00"
          isSubmitting={false}
          initialErrors={{
            name: 'Name is required.',
            email: 'Please provide a valid email.',
            agreement: 'You must agree before accepting.',
          }}
          onSubmit={() => {
            /* no-op */
          }}
        />,
      );

      expect(html).toContain('accepted-by-name-error');
      expect(html).toContain('Name is required.');
      expect(html).toContain('accepted-by-email-error');
      expect(html).toContain('Please provide a valid email.');
      expect(html).toContain('agreement-error');
      expect(html).toContain('You must agree before accepting.');
    });

    it('renders PublicProposalView in Kleinunternehmer mode with custom tax notice', () => {
      currentLocale = 'en';
      const kleinData = {
        ...activeProposalData,
        isKleinunternehmer: true,
        taxNotice: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
      };
      const html = renderToStaticMarkup(
        <PublicProposalView
          proposal={kleinData}
          studioName="Light & Shadow Studios"
          token="secret-token-123"
          locale="en"
        />,
      );

      expect(html).toContain('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.');
    });
  });

  describe('modalFormReducer & createAcceptanceModalController unit tests', () => {
    const dummyT = (k: string) => `trans_${k}`;

    it('modalFormReducer handles CHANGE_NAME, CHANGE_EMAIL, CHANGE_AGREEMENT when untouched and touched', () => {
      let state = createInitialModalFormState();
      expect(state.name).toBe('');
      expect(state.touched).toBe(false);

      // Untouched changes: errors not populated
      state = modalFormReducer(state, { type: 'CHANGE_NAME', value: 'Alice', t: dummyT });
      expect(state.name).toBe('Alice');
      expect(state.errors).toEqual({});

      state = modalFormReducer(state, { type: 'CHANGE_EMAIL', value: 'invalid-email', t: dummyT });
      expect(state.email).toBe('invalid-email');
      expect(state.errors).toEqual({});

      state = modalFormReducer(state, { type: 'CHANGE_AGREEMENT', value: true, t: dummyT });
      expect(state.agreement).toBe(true);

      // Submit attempt sets touched to true and populates validation errors
      state = modalFormReducer(state, { type: 'SUBMIT_ATTEMPT', t: dummyT });
      expect(state.touched).toBe(true);
      expect(state.errors.email).toBe('trans_emailInvalid');

      // Now changes update errors live
      state = modalFormReducer(state, {
        type: 'CHANGE_EMAIL',
        value: 'alice@example.com',
        t: dummyT,
      });
      expect(state.errors.email).toBeUndefined();

      state = modalFormReducer(state, { type: 'CHANGE_NAME', value: '', t: dummyT });
      expect(state.errors.name).toBe('trans_nameRequired');

      state = modalFormReducer(state, { type: 'CHANGE_AGREEMENT', value: false, t: dummyT });
      expect(state.errors.agreement).toBe('trans_agreementRequired');

      // SET_DEFAULTS action
      state = modalFormReducer(state, {
        type: 'SET_DEFAULTS',
        defaultName: 'Default Bob',
        defaultEmail: 'bob@example.com',
      });
      expect(state.name).toBe('Default Bob'); // name was empty, so updated

      // Default fallback
      // @ts-expect-error test invalid action type fallback
      const unchanged = modalFormReducer(state, { type: 'UNKNOWN_ACTION' });
      expect(unchanged).toBe(state);
    });

    it('createAcceptanceModalController executes actions, focus restore, and submit', async () => {
      const dispatchedActions: unknown[] = [];
      const dispatch = (action: unknown) => dispatchedActions.push(action);
      const focusSpy = vi.fn();
      const triggerRef = { current: { focus: focusSpy } };
      const onSubmitSpy = vi.fn();

      const state = {
        name: 'Emma Watson',
        email: 'emma@example.com',
        agreement: true,
        touched: true,
        errors: {},
      };

      const onCloseSpy = vi.fn();
      const controller = createAcceptanceModalController({
        state,
        dispatch,
        t: dummyT,
        triggerRef,
        onClose: onCloseSpy,
        onSubmit: onSubmitSpy,
      });

      controller.handleNameChange('Emma');
      expect(dispatchedActions[0]).toEqual({ type: 'CHANGE_NAME', value: 'Emma', t: dummyT });

      controller.handleNameChange({ target: { value: 'Emma 2' } });
      expect(dispatchedActions[1]).toEqual({ type: 'CHANGE_NAME', value: 'Emma 2', t: dummyT });

      controller.handleEmailChange('emma2@example.com');
      expect(dispatchedActions[2]).toEqual({
        type: 'CHANGE_EMAIL',
        value: 'emma2@example.com',
        t: dummyT,
      });

      controller.handleEmailChange({ target: { value: 'emma3@example.com' } });
      expect(dispatchedActions[3]).toEqual({
        type: 'CHANGE_EMAIL',
        value: 'emma3@example.com',
        t: dummyT,
      });

      controller.handleAgreementChange(false);
      expect(dispatchedActions[4]).toEqual({ type: 'CHANGE_AGREEMENT', value: false, t: dummyT });

      controller.handleAgreementChange({ target: { checked: true } });
      expect(dispatchedActions[5]).toEqual({ type: 'CHANGE_AGREEMENT', value: true, t: dummyT });

      controller.handleOpenChange(false);
      expect(onCloseSpy).toHaveBeenCalled();
      controller.handleOpenChange(true);

      const preventDefaultSpy = vi.fn();
      controller.handleCloseAutoFocus({ preventDefault: preventDefaultSpy });
      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();

      // Submit when valid
      const success = await controller.handleSubmit();
      expect(success).toBe(true);
      expect(onSubmitSpy).toHaveBeenCalledWith({ name: 'Emma Watson', email: 'emma@example.com' });

      // Submit when invalid
      const invalidController = createAcceptanceModalController({
        state: { ...state, name: '' },
        dispatch,
        t: dummyT,
        triggerRef,
        onSubmit: onSubmitSpy,
      });
      const invalidSuccess = await invalidController.handleSubmit({ preventDefault: vi.fn() });
      expect(invalidSuccess).toBe(false);
    });
  });

  describe('createProposalViewController unit tests', () => {
    it('handles addon toggling and quantity adjustments correctly', () => {
      let currentSelections: Record<string, ClientItemSelection> = {
        'item-base-1': { isSelected: true, quantity: 1 },
      };
      const setSelections = (
        updater: (prev: Record<string, ClientItemSelection>) => Record<string, ClientItemSelection>,
      ) => {
        currentSelections = updater(currentSelections);
      };
      const setModalOpen = vi.fn();

      const controller = createProposalViewController({
        token: 'token-123',
        lineItems: mockLineItems,
        setSelections,
        setIsSubmitting: vi.fn(),
        setServerError: vi.fn(),
        setModalOpen,
        setCurrentStatus: vi.fn(),
        setAcceptedDetails: vi.fn(),
        acceptAction: vi.fn(),
      });

      // Modal open/close
      controller.handleOpenModal();
      expect(setModalOpen).toHaveBeenCalledWith(true);
      controller.handleCloseModal();
      expect(setModalOpen).toHaveBeenCalledWith(false);

      // Toggle addon on
      controller.handleToggleAddon('item-addon-drone', true);
      expect(currentSelections['item-addon-drone']?.isSelected).toBe(true);

      // Toggle addon by DOM event
      controller.handleToggleAddonById({
        currentTarget: {
          getAttribute: () => 'item-addon-drone',
          checked: false,
        },
      });
      expect(currentSelections['item-addon-drone']?.isSelected).toBe(false);

      // Change quantity on existing item
      controller.handleQuantityChange('item-addon-drone', 1);
      expect(currentSelections['item-addon-drone']?.quantity).toBe(2);

      // Quantity change by DOM events
      controller.handleIncreaseQuantity({
        currentTarget: { getAttribute: () => 'item-addon-drone' },
      });
      expect(currentSelections['item-addon-drone']?.quantity).toBe(2); // capped at max 2

      controller.handleDecreaseQuantity({
        currentTarget: { getAttribute: () => 'item-addon-drone' },
      });
      expect(currentSelections['item-addon-drone']?.quantity).toBe(1);

      // Null attribute handlers
      controller.handleToggleAddonById({
        currentTarget: { getAttribute: () => null, checked: true },
      });
      controller.handleIncreaseQuantity({
        currentTarget: { getAttribute: () => null },
      });
      controller.handleDecreaseQuantity({
        currentTarget: { getAttribute: () => null },
      });

      // Change quantity on non-existent item (no crash)
      controller.handleQuantityChange('non-existent-id', 1);
    });

    it('handles accept submission success, business failure, and network error', async () => {
      const setIsSubmitting = vi.fn();
      const setServerError = vi.fn();
      const setModalOpen = vi.fn();
      const setCurrentStatus = vi.fn();
      const setAcceptedDetails = vi.fn();

      // Case 1: Success
      const mockSuccessAction = vi.fn().mockResolvedValue({ success: true });
      const controller = createProposalViewController({
        token: 'token-123',
        lineItems: mockLineItems,
        setSelections: vi.fn(),
        setIsSubmitting,
        setServerError,
        setModalOpen,
        setCurrentStatus,
        setAcceptedDetails,
        acceptAction: mockSuccessAction,
      });

      const resSuccess = await controller.handleAcceptSubmit(
        { name: 'Emma Watson', email: 'emma@example.com' },
        { 'item-base-1': { isSelected: true, quantity: 1 } },
      );
      expect(resSuccess.success).toBe(true);
      expect(setModalOpen).toHaveBeenCalledWith(false);
      expect(setCurrentStatus).toHaveBeenCalledWith('accepted');
      expect(setAcceptedDetails).toHaveBeenCalled();

      // Case 2: Business failure (e.g. expired or invalid)
      const mockFailAction = vi
        .fn()
        .mockResolvedValue({ success: false, error: 'Proposal expired' });
      const controllerFail = createProposalViewController({
        token: 'token-123',
        lineItems: mockLineItems,
        setSelections: vi.fn(),
        setIsSubmitting,
        setServerError,
        setModalOpen,
        setCurrentStatus,
        setAcceptedDetails,
        acceptAction: mockFailAction,
      });

      const resFail = await controllerFail.handleAcceptSubmit(
        { name: 'Emma Watson', email: 'emma@example.com' },
        { 'item-base-1': { isSelected: true, quantity: 1 } },
      );
      expect(resFail.success).toBe(false);
      expect(resFail.error).toBe('Proposal expired');
      expect(setServerError).toHaveBeenCalledWith('Proposal expired');

      // Case 3: Thrown exception (e.g. network failure)
      const mockThrowAction = vi.fn().mockRejectedValue(new Error('Network drop'));
      const controllerThrow = createProposalViewController({
        token: 'token-123',
        lineItems: mockLineItems,
        setSelections: vi.fn(),
        setIsSubmitting,
        setServerError,
        setModalOpen,
        setCurrentStatus,
        setAcceptedDetails,
        acceptAction: mockThrowAction,
      });

      const resThrow = await controllerThrow.handleAcceptSubmit(
        { name: 'Emma Watson', email: 'emma@example.com' },
        { 'item-base-1': { isSelected: true, quantity: 1 } },
      );
      expect(resThrow.success).toBe(false);
      expect(resThrow.error).toBe('Network drop');
      expect(setServerError).toHaveBeenCalledWith('Network drop');
    });
  });
});
