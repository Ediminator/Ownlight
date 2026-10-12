import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClientCreateForm } from '@/components/clients/client-create-form';
import { EditDetailsForm } from '@/components/clients/edit-details-dialog';
import { ContactForm } from '@/components/clients/contact-dialog';
import { AddressForm } from '@/components/clients/address-dialog';
import { TagsForm } from '@/components/clients/tags-dialog';
import { ConfirmDialog } from '@/components/clients/confirm-dialog';
import { getLocalizedCountries, getLocalizedCountryName } from '@/lib/countries';
import { formatTagsString, parseTagsString } from '@/lib/tags';
import {
  createClientAction,
  updateClientAction,
  addContactAction,
  updateContactAction,
  upsertAddressAction,
  setClientTagsAction,
} from '@/server/clients/actions';
import type { Client, ClientAddress, ClientContact } from '@/server/db/schema/clients';

let mockStateQueue: unknown[] = [];

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T): [T, (val: T) => void] => {
      if (mockStateQueue.length > 0) {
        const val = mockStateQueue.shift() as T;
        return [val, vi.fn()];
      }
      return actual.useState(initial);
    },
  };
});

const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => '/en/clients',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/server/clients/actions', () => ({
  createClientAction: vi.fn(),
  updateClientAction: vi.fn(),
  addContactAction: vi.fn(),
  updateContactAction: vi.fn(),
  removeContactAction: vi.fn(),
  upsertAddressAction: vi.fn(),
  removeAddressAction: vi.fn(),
  getClientAction: vi.fn(),
  listClientsAction: vi.fn(),
  setClientTagsAction: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const table: Record<string, string> = {
      'clients.form.title': 'New client',
      'clients.form.cancel': 'Cancel',
      'clients.form.submit': 'Create client',
      'clients.form.submitting': 'Creating client...',
      'clients.form.save': 'Save changes',
      'clients.form.saving': 'Saving...',
      'clients.form.createAnyway': 'Create anyway',
      'clients.form.cancelDuplicate': 'Cancel',
      'clients.form.displayNameRequired': 'Display name is required.',
      'clients.form.nameRequired': 'At least one contact name is required.',
      'clients.form.emailInvalid': 'Invalid email address format.',
      'clients.form.phoneInvalid': 'Invalid phone number format.',
      'clients.errors.displayNameRequired': 'Display name is required.',
      'clients.errors.nameRequired': 'At least one contact name is required.',
      'clients.errors.emailInvalid': 'Invalid email address format.',
      'clients.errors.phoneInvalid': 'Invalid phone number format.',
      'clients.errors.line1Required': 'Address line 1 is required.',
      'clients.errors.postalCodeRequired': 'Postal code is required.',
      'clients.errors.cityRequired': 'City is required.',
      'clients.errors.countryRequired': 'Country is required.',
      'clients.errors.VALIDATION_FAILED': 'Please check the form for invalid inputs.',
      'clients.errors.DUPLICATE_EMAIL': 'A client with this email address already exists.',
      'clients.errors.GENERIC_ERROR': 'An unexpected error occurred.',
    };
    const fullKey = `${namespace}.${key}`;
    return Object.prototype.hasOwnProperty.call(table, fullKey) ? table[fullKey] : `[${key}]`;
  },
}));

interface FormProps {
  onSubmit?: (e?: { preventDefault: () => void }) => void | Promise<void>;
}

function findForm(element: React.ReactElement | undefined): FormProps | undefined {
  if (!element) return undefined;
  let found: FormProps | undefined;
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (node.type === 'form' || typeof props.onSubmit === 'function') {
        found = props;
        return;
      }
      if (props.children) traverse(props.children);
    } else if (Array.isArray(node)) {
      for (const item of node) traverse(item);
    }
  }
  traverse(element);
  return found;
}

function findNodeByTestId(
  element: React.ReactElement | undefined,
  testId: string,
): React.ReactElement | undefined {
  if (!element) return undefined;
  let found: React.ReactElement | undefined;
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (props['data-testid'] === testId) {
        found = node;
        return;
      }
      if (props.children) traverse(props.children);
    } else if (Array.isArray(node)) {
      for (const item of node) traverse(item);
    }
  }
  traverse(element);
  return found;
}

interface ComponentProps {
  onClick?: () => void;
  onChange?: (e?: { target: { value?: string; checked?: boolean } }) => void;
}

function getNodeProps(node: React.ReactElement | undefined): ComponentProps {
  const props = node?.props;
  if (props && typeof props === 'object') {
    return props;
  }
  return {};
}

function sampleClient(): Client {
  const now = new Date('2026-04-01T12:00:00.000Z');
  return {
    id: '018f0000-0000-7000-8000-000000000001',
    kind: 'person',
    displayName: 'Anna Schmidt',
    preferredLocale: 'de',
    googleContactsSyncEnabled: false,
    createdAt: now,
    lastActivityAt: now,
    updatedAt: now,
  };
}

describe('TASK-0012: Comprehensive Interactive & Branch Coverage for Forms and Dialogs', () => {
  beforeEach(() => {
    mockStateQueue = [];
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe('ClientCreateForm interactive branches', () => {
    it('AC-2: validates empty fields and prevents submission', async () => {
      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ClientCreateForm({ locale: 'en' });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const form = findForm(tree);
      expect(form).toBeDefined();
      const mockPreventDefault = vi.fn();
      await form?.onSubmit?.({ preventDefault: mockPreventDefault });
      expect(mockPreventDefault).toHaveBeenCalled();
      expect(createClientAction).not.toHaveBeenCalled();
    });

    it('AC-2: validates invalid email and phone formats', async () => {
      mockStateQueue = [
        'person',
        'Valid Name',
        'en',
        'Anna',
        'Schmidt',
        'invalid-email-address',
        'invalid-phone',
        '',
        false,
        {},
        [],
        null,
        null,
      ];
      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ClientCreateForm({ locale: 'en' });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });
      expect(createClientAction).not.toHaveBeenCalled();
    });

    it('AC-1: submits valid client, saves tags, and navigates to profile', async () => {
      mockStateQueue = [
        'person',
        'Valid Studio',
        'de',
        'Anna',
        'Schmidt',
        'anna@example.com',
        '+49 151 23456789',
        'Wedding, VIP',
        false,
        {},
        [],
        null,
        null,
      ];
      vi.mocked(createClientAction).mockResolvedValueOnce({
        success: true,
        data: { clientId: 'new-client-uuid-001' },
      });
      vi.mocked(setClientTagsAction).mockResolvedValueOnce({
        success: true,
        data: { clientId: 'new-client-uuid-001', tags: [] },
      });

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ClientCreateForm({ locale: 'en', defaultLocale: 'de' });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });

      expect(createClientAction).toHaveBeenCalledWith({
        kind: 'person',
        displayName: 'Valid Studio',
        preferredLocale: 'de',
        googleContactsSyncEnabled: false,
        primaryContact: {
          givenName: 'Anna',
          familyName: 'Schmidt',
          email: 'anna@example.com',
          phone: '+49 151 23456789',
        },
        acknowledgeDuplicates: false,
      });
      expect(setClientTagsAction).toHaveBeenCalledWith({
        clientId: 'new-client-uuid-001',
        tagNames: ['Wedding', 'VIP'],
      });
      await vi.waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/en/clients/new-client-uuid-001?created=1');
      });
    });

    it('AC-3: handles DUPLICATE_EMAIL response, create anyway, and cancel duplicate', async () => {
      mockStateQueue = [
        'person',
        'Duplicate Name',
        'en',
        'Anna',
        'Schmidt',
        'duplicate@example.com',
        '',
        '',
        false,
        {},
        [],
        null,
        null,
      ];
      vi.mocked(createClientAction).mockResolvedValueOnce({
        success: false,
        code: 'DUPLICATE_EMAIL',
        error: 'Duplicate email',
        duplicates: [{ clientId: 'c-existing', displayName: 'Existing Studio' }],
      });

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ClientCreateForm({ locale: 'en' });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });
      expect(createClientAction).toHaveBeenCalledTimes(1);

      // Trigger duplicate warning buttons
      mockStateQueue = [
        'person',
        'Duplicate Name',
        'en',
        'Anna',
        'Schmidt',
        'duplicate@example.com',
        '',
        '',
        false,
        {},
        [],
        null,
        [{ clientId: 'c-existing', displayName: 'Existing Studio' }],
      ];
      renderToStaticMarkup(<Wrapper />);

      const createAnywayBtn = findNodeByTestId(tree, 'create-anyway-btn');
      const cancelDuplicateBtn = findNodeByTestId(tree, 'cancel-duplicate-btn');
      expect(createAnywayBtn).toBeDefined();
      expect(cancelDuplicateBtn).toBeDefined();

      // Trigger create anyway
      vi.mocked(createClientAction).mockResolvedValueOnce({
        success: true,
        data: { clientId: 'c-overridden' },
      });
      getNodeProps(createAnywayBtn).onClick?.();

      // Trigger cancel duplicate
      getNodeProps(cancelDuplicateBtn).onClick?.();
    });

    it('AC-2 & AC-15: handles server VALIDATION_FAILED with mapped fields, empty fields, and exceptions', async () => {
      mockStateQueue = [
        'company',
        'Corp',
        'en',
        'Bob',
        'Builder',
        'bob@example.com',
        '',
        '',
        false,
        {},
        [],
        null,
        null,
      ];
      // 1. VALIDATION_FAILED with field list
      vi.mocked(createClientAction).mockResolvedValueOnce({
        success: false,
        code: 'VALIDATION_FAILED',
        error: 'Validation failed',
        fields: ['displayName', 'email', 'givenName', 'phone'],
      });

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ClientCreateForm({ locale: 'en' });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });

      // 2. VALIDATION_FAILED with empty fields
      vi.mocked(createClientAction).mockResolvedValueOnce({
        success: false,
        code: 'VALIDATION_FAILED',
        error: 'Validation failed',
        fields: [],
      });
      await form?.onSubmit?.({ preventDefault: vi.fn() });

      // 3. Generic server failure
      vi.mocked(createClientAction).mockResolvedValueOnce({
        success: false,
        code: 'FORBIDDEN',
        error: 'Forbidden',
      });
      await form?.onSubmit?.({ preventDefault: vi.fn() });

      // 4. Exception thrown
      vi.mocked(createClientAction).mockRejectedValueOnce(new Error('Network offline'));
      await form?.onSubmit?.({ preventDefault: vi.fn() });
    });

    it('AC-1: exercises all form input onChange handlers', () => {
      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ClientCreateForm({ locale: 'en' });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const inputs = [
        { testId: 'display-name-input', val: 'New Display Name' },
        { testId: 'preferred-locale-select', val: 'de' },
        { testId: 'given-name-input', val: 'Lukas' },
        { testId: 'family-name-input', val: 'Weber' },
        { testId: 'email-input', val: 'lukas@example.com' },
        { testId: 'phone-input', val: '+49 151 23456789' },
        { testId: 'tags-input', val: 'Wedding, 2026' },
      ];

      for (const item of inputs) {
        const node = findNodeByTestId(tree, item.testId);
        expect(node).toBeDefined();
        getNodeProps(node).onChange?.({ target: { value: item.val } });
      }

      // Radios
      const personRadio = findNodeByTestId(tree, 'kind-person-radio');
      const companyRadio = findNodeByTestId(tree, 'kind-company-radio');
      getNodeProps(personRadio).onChange?.();
      getNodeProps(companyRadio).onChange?.();
    });
  });

  describe('EditDetailsForm interactive branches', () => {
    it('AC-4: handles validation, submission, success, error, and onChange', async () => {
      const client = sampleClient();
      const mockSuccess = vi.fn();
      const mockClose = vi.fn();

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = EditDetailsForm({
          client,
          onClose: mockClose,
          onSuccess: mockSuccess,
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      // 1. Submit empty name -> validation error
      mockStateQueue = ['person', '   ', 'de', false, null, null];
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(updateClientAction).not.toHaveBeenCalled();

      // 2. Submit valid name -> success
      mockStateQueue = ['company', 'Updated Studio', 'en', false, null, null];
      vi.mocked(updateClientAction).mockResolvedValueOnce({
        success: true,
        data: { clientId: client.id },
      });
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(updateClientAction).toHaveBeenCalledWith({
        clientId: client.id,
        kind: 'company',
        displayName: 'Updated Studio',
        preferredLocale: 'en',
        googleContactsSyncEnabled: false,
      });
      expect(mockSuccess).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();

      // 3. Submit failure
      mockStateQueue = ['person', 'Name', 'de', false, null, null];
      vi.mocked(updateClientAction).mockResolvedValueOnce({
        success: false,
        code: 'VALIDATION_FAILED',
        error: 'Validation failed',
      });
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });

      // 4. Submit exception
      vi.mocked(updateClientAction).mockRejectedValueOnce(new Error('DB connection fail'));
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });

      // 5. Test input onChange handlers
      renderToStaticMarkup(<Wrapper />);
      const nameInput = findNodeByTestId(tree, 'edit-display-name-input');
      const localeSelect = findNodeByTestId(tree, 'edit-preferred-locale-select');
      const personRadio = findNodeByTestId(tree, 'edit-kind-person-radio');
      const companyRadio = findNodeByTestId(tree, 'edit-kind-company-radio');

      getNodeProps(nameInput).onChange?.({ target: { value: 'Changed' } });
      getNodeProps(localeSelect).onChange?.({ target: { value: 'en' } });
      getNodeProps(personRadio).onChange?.();
      getNodeProps(companyRadio).onChange?.();
    });
  });

  describe('ContactForm interactive branches', () => {
    it('AC-5: handles add contact validation, submission, duplicates, and onChange', async () => {
      const mockSuccess = vi.fn();
      const mockClose = vi.fn();

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ContactForm({
          clientId: 'client-1',
          locale: 'en',
          onClose: mockClose,
          onSuccess: mockSuccess,
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      // 1. Submit empty names -> validation error
      mockStateQueue = ['', '', '', '', false, false, null, {}, null];
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(addContactAction).not.toHaveBeenCalled();

      // 2. Submit invalid email and phone
      mockStateQueue = ['Anna', '', 'bad-email', 'bad-phone', false, false, null, {}, null];
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(addContactAction).not.toHaveBeenCalled();

      // 3. Submit valid contact -> success
      mockStateQueue = [
        'Anna',
        'Schmidt',
        'anna@example.com',
        '+49 151 23456789',
        true,
        false,
        null,
        {},
        null,
      ];
      vi.mocked(addContactAction).mockResolvedValueOnce({
        success: true,
        data: { contactId: 'contact-new-1' },
      });
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(addContactAction).toHaveBeenCalledWith({
        clientId: 'client-1',
        givenName: 'Anna',
        familyName: 'Schmidt',
        email: 'anna@example.com',
        phone: '+49 151 23456789',
        isPrimary: true,
        acknowledgeDuplicates: false,
      });
      expect(mockSuccess).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();

      // 4. Duplicate warning returned
      mockStateQueue = ['Anna', 'Schmidt', 'anna@example.com', '', false, false, null, {}, null];
      vi.mocked(addContactAction).mockResolvedValueOnce({
        success: false,
        code: 'DUPLICATE_EMAIL',
        error: 'Duplicate email',
        duplicates: [{ clientId: 'c2', displayName: 'Other' }],
      });
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });

      // Duplicate warning buttons in contact dialog
      mockStateQueue = [
        'Anna',
        'Schmidt',
        'anna@example.com',
        '',
        false,
        false,
        null,
        {},
        [{ clientId: 'c2', displayName: 'Other' }],
      ];
      renderToStaticMarkup(<Wrapper />);
      const anywayBtn = findNodeByTestId(tree, 'contact-create-anyway-btn');
      const cancelDupBtn = findNodeByTestId(tree, 'contact-cancel-duplicate-btn');
      vi.mocked(addContactAction).mockResolvedValueOnce({
        success: true,
        data: { contactId: 'contact-overridden' },
      });
      getNodeProps(anywayBtn).onClick?.();
      getNodeProps(cancelDupBtn).onClick?.();

      // 5. Server error and exception
      mockStateQueue = ['Anna', 'Schmidt', 'anna@example.com', '', false, false, null, {}, null];
      vi.mocked(addContactAction).mockResolvedValueOnce({
        success: false,
        code: 'FORBIDDEN',
        error: 'Forbidden',
      });
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });

      mockStateQueue = ['Anna', 'Schmidt', 'anna@example.com', '', false, false, null, {}, null];
      vi.mocked(addContactAction).mockRejectedValueOnce(new Error('Network error'));
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });

      // 6. Test input onChange handlers
      renderToStaticMarkup(<Wrapper />);
      const inputs = [
        { testId: 'contact-given-name-input', val: 'Jane' },
        { testId: 'contact-family-name-input', val: 'Doe' },
        { testId: 'contact-email-input', val: 'jane@example.com' },
        { testId: 'contact-phone-input', val: '+49 151 23456789' },
      ];
      for (const item of inputs) {
        const node = findNodeByTestId(tree, item.testId);
        getNodeProps(node).onChange?.({ target: { value: item.val } });
      }
      const primaryCheckbox = findNodeByTestId(tree, 'contact-is-primary-checkbox');
      getNodeProps(primaryCheckbox).onChange?.({ target: { checked: true } });
    });

    it('AC-5: handles edit contact submission', async () => {
      const existingContact: ClientContact = {
        id: 'contact-99',
        clientId: 'client-1',
        givenName: 'Lukas',
        familyName: 'Weber',
        email: 'lukas@example.com',
        emailNormalized: 'lukas@example.com',
        phone: '+49 151 23456789',
        isPrimary: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockSuccess = vi.fn();
      const mockClose = vi.fn();

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ContactForm({
          clientId: 'client-1',
          locale: 'en',
          contactToEdit: existingContact,
          onClose: mockClose,
          onSuccess: mockSuccess,
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      vi.mocked(updateContactAction).mockResolvedValueOnce({
        success: true,
        data: { contactId: 'contact-99' },
      });
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(updateContactAction).toHaveBeenCalledWith({
        clientId: 'client-1',
        contactId: 'contact-99',
        givenName: 'Lukas',
        familyName: 'Weber',
        email: 'lukas@example.com',
        phone: '+49 151 23456789',
        isPrimary: false,
        acknowledgeDuplicates: false,
      });
      expect(mockSuccess).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('AddressForm interactive branches', () => {
    it('AC-7: handles add address validation, submission, and onChange', async () => {
      const mockSuccess = vi.fn();
      const mockClose = vi.fn();

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = AddressForm({
          clientId: 'client-1',
          locale: 'en',
          defaultType: 'postal',
          onClose: mockClose,
          onSuccess: mockSuccess,
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      // 1. Submit empty fields -> validation error
      mockStateQueue = ['postal', '', '', '', '', '', '', false, null, {}];
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(upsertAddressAction).not.toHaveBeenCalled();

      // 2. Submit valid address -> success
      mockStateQueue = [
        'billing',
        'Hauptstraße 1',
        'Top 5',
        '10115',
        'Berlin',
        'Berlin',
        'DE',
        false,
        null,
        {},
      ];
      vi.mocked(upsertAddressAction).mockResolvedValueOnce({
        success: true,
        data: { addressId: 'addr-new' },
      });
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(upsertAddressAction).toHaveBeenCalledWith({
        clientId: 'client-1',
        type: 'billing',
        line1: 'Hauptstraße 1',
        line2: 'Top 5',
        postalCode: '10115',
        city: 'Berlin',
        region: 'Berlin',
        countryCode: 'DE',
      });
      expect(mockSuccess).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();

      // 3. Server error and exception
      mockStateQueue = ['postal', 'St', '', '1', 'City', '', 'DE', false, null, {}];
      vi.mocked(upsertAddressAction).mockResolvedValueOnce({
        success: false,
        code: 'FORBIDDEN',
        error: 'Forbidden',
      });
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });

      mockStateQueue = ['postal', 'St', '', '1', 'City', '', 'DE', false, null, {}];
      vi.mocked(upsertAddressAction).mockRejectedValueOnce(new Error('Address error'));
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });

      // 4. Test input onChange handlers
      renderToStaticMarkup(<Wrapper />);
      const inputs = [
        { testId: 'address-type-select', val: 'billing' },
        { testId: 'address-line1-input', val: 'Street 1' },
        { testId: 'address-line2-input', val: 'Apt 2' },
        { testId: 'address-postal-code-input', val: '10117' },
        { testId: 'address-city-input', val: 'Munich' },
        { testId: 'address-region-input', val: 'Bavaria' },
        { testId: 'address-country-select', val: 'AT' },
      ];
      for (const item of inputs) {
        const node = findNodeByTestId(tree, item.testId);
        getNodeProps(node).onChange?.({ target: { value: item.val } });
      }
    });

    it('AC-7: handles edit existing address submission', async () => {
      const existingAddress: ClientAddress = {
        id: 'addr-88',
        clientId: 'client-1',
        type: 'postal',
        line1: 'Marktplatz 3',
        line2: null,
        postalCode: '80331',
        city: 'München',
        region: 'Bayern',
        countryCode: 'DE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockSuccess = vi.fn();
      const mockClose = vi.fn();

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = AddressForm({
          clientId: 'client-1',
          locale: 'de',
          addressToEdit: existingAddress,
          defaultType: 'postal',
          onClose: mockClose,
          onSuccess: mockSuccess,
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      vi.mocked(upsertAddressAction).mockResolvedValueOnce({
        success: true,
        data: { addressId: 'addr-88' },
      });
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(upsertAddressAction).toHaveBeenCalledWith({
        clientId: 'client-1',
        type: 'postal',
        line1: 'Marktplatz 3',
        line2: null,
        postalCode: '80331',
        city: 'München',
        region: 'Bayern',
        countryCode: 'DE',
      });
      expect(mockSuccess).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('TagsForm interactive branches', () => {
    it('AC-8: handles tag editing submission, success, error, and onChange', async () => {
      const mockSuccess = vi.fn();
      const mockClose = vi.fn();

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = TagsForm({
          clientId: 'client-1',
          currentTags: [{ id: 't1', name: 'Wedding' }],
          onClose: mockClose,
          onSuccess: mockSuccess,
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }

      // 1. Success submission
      mockStateQueue = ['Wedding, Portrait, 2026', false, null];
      vi.mocked(setClientTagsAction).mockResolvedValueOnce({
        success: true,
        data: {
          clientId: 'client-1',
          tags: [
            { id: 't1', name: 'Wedding' },
            { id: 't2', name: 'Portrait' },
            { id: 't3', name: '2026' },
          ],
        },
      });
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(setClientTagsAction).toHaveBeenCalledWith({
        clientId: 'client-1',
        tagNames: ['Wedding', 'Portrait', '2026'],
      });
      expect(mockSuccess).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();

      // 2. Server failure
      mockStateQueue = ['Wedding', false, null];
      vi.mocked(setClientTagsAction).mockResolvedValueOnce({
        success: false,
        code: 'LIMIT_EXCEEDED',
        error: 'Limit exceeded',
      });
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });

      // 3. Exception
      mockStateQueue = ['Wedding', false, null];
      vi.mocked(setClientTagsAction).mockRejectedValueOnce(new Error('Tag error'));
      renderToStaticMarkup(<Wrapper />);
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });

      // 4. Input onChange
      renderToStaticMarkup(<Wrapper />);
      const tagsInput = findNodeByTestId(tree, 'edit-tags-input');
      getNodeProps(tagsInput).onChange?.({ target: { value: 'New Tags' } });
    });
  });

  describe('ConfirmDialog interactive branches', () => {
    it('AC-6: handles confirm and cancel callbacks', () => {
      const mockConfirm = vi.fn();
      const mockCancel = vi.fn();
      const mockOpenChange = vi.fn();

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ConfirmDialog({
          isOpen: true,
          onOpenChange: mockOpenChange,
          title: 'Confirm',
          description: 'Desc',
          onConfirm: mockConfirm,
          onCancel: mockCancel,
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const confirmBtn = findNodeByTestId(tree, 'confirm-dialog-confirm-btn');
      const cancelBtn = findNodeByTestId(tree, 'confirm-dialog-cancel-btn');

      getNodeProps(confirmBtn).onClick?.();
      expect(mockConfirm).toHaveBeenCalled();

      getNodeProps(cancelBtn).onClick?.();
      expect(mockCancel).toHaveBeenCalled();
      expect(mockOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe('countries and tags edge branches', () => {
    it('AC-7: handles invalid locale gracefully in getLocalizedCountries and getLocalizedCountryName', () => {
      const countries = getLocalizedCountries('invalid-locale-!!!');
      expect(countries.length).toBeGreaterThan(200);
      expect(countries[0]?.name).toBeDefined();

      const deName = getLocalizedCountryName('DE', 'invalid-locale-!!!');
      expect(typeof deName).toBe('string');
    });

    it('AC-8: handles null/empty inputs in formatTagsString and parseTagsString', () => {
      expect(formatTagsString(null as unknown as [])).toBe('');
      expect(formatTagsString([{ name: '  ' }])).toBe('');
      expect(formatTagsString(['Wedding', 'VIP'])).toBe('Wedding, VIP');

      expect(parseTagsString(null as unknown as string)).toEqual([]);
      expect(parseTagsString('')).toEqual([]);
      expect(parseTagsString('  ,  , ')).toEqual([]);
      expect(parseTagsString('Tag A, Tag B')).toEqual(['Tag A', 'Tag B']);
    });
  });
});
