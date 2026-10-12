import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TagsDialog, TagsForm } from '@/components/clients/tags-dialog';
import { ConfirmDialog } from '@/components/clients/confirm-dialog';
import { ContactDialog, ContactForm } from '@/components/clients/contact-dialog';
import { EditDetailsDialog, EditDetailsForm } from '@/components/clients/edit-details-dialog';
import { AddressDialog } from '@/components/clients/address-dialog';
import { ClientProfile } from '@/components/clients/client-profile';
import {
  setClientTagsAction,
  updateContactAction,
  addContactAction,
  updateClientAction,
} from '@/server/clients/actions';
import type { ClientWithRelations } from '@/server/clients/repo';
import type { ClientContact, ClientAddress } from '@/server/db/schema/clients';

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
      try {
        return actual.useState(initial);
      } catch {
        return [initial, vi.fn()];
      }
    },
  };
});

let mockCreatedParam: string | null = null;
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en/clients',
  useSearchParams: () => ({
    get: (key: string) => (key === 'created' ? mockCreatedParam : null),
  }),
}));

vi.mock('server-only', () => ({}));

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

vi.mock('@/server/timeline/actions', () => ({
  addNoteAction: vi.fn(),
  updateNoteAction: vi.fn(),
  deleteNoteAction: vi.fn(),
  listTimelineAction: vi
    .fn()
    .mockResolvedValue({ success: true, data: { items: [], nextCursor: null } }),
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const table: Record<string, string> = {
      'clients.form.title': 'New client',
      'clients.form.cancel': 'Cancel',
      'clients.form.save': 'Save',
      'clients.form.saving': 'Saving...',
      'clients.form.remove': 'Remove',
      'clients.form.removing': 'Removing...',
      'clients.form.editTagsTitle': 'Edit tags',
      'clients.form.editTagsDescription': 'Edit tags description',
      'clients.form.editContactTitle': 'Edit contact',
      'clients.form.editContactDescription': 'Edit contact description',
      'clients.form.addContactTitle': 'Add contact',
      'clients.form.addContactDescription': 'Add contact description',
      'clients.form.editDetailsTitle': 'Edit details',
      'clients.form.editDetailsDescription': 'Edit details description',
      'clients.form.editAddressTitle': 'Edit address',
      'clients.form.editAddressDescription': 'Edit address description',
      'clients.form.addAddressTitle': 'Add address',
      'clients.form.addAddressDescription': 'Add address description',
      'clients.form.createdSuccess': 'Client created successfully.',
      'clients.errors.LIMIT_EXCEEDED': 'Tag limit exceeded (maximum 20).',
      'clients.errors.VALIDATION_FAILED': 'Validation failed.',
      'clients.errors.DUPLICATE_EMAIL': 'Duplicate email found.',
      'clients.errors.CLIENT_NEEDS_CONTACT': 'A client must have at least one contact.',
      'clients.errors.NOT_FOUND': 'Record not found.',
      'clients.errors.GENERIC_ERROR': 'An unexpected error occurred.',
      'clients.errors.displayNameRequired': 'Display name is required.',
      'clients.profile.language.en': 'English',
      'clients.profile.language.de': 'German',
      'clients.profile.noTags': 'No tags assigned',
      'clients.profile.tags': 'Tags',
      'clients.profile.contactsTitle': 'Contacts',
      'clients.profile.addressesTitle': 'Addresses',
      'clients.profile.preferredLanguage': 'Preferred language',
    };
    const fullKey = `${namespace}.${key}`;
    return Object.prototype.hasOwnProperty.call(table, fullKey) ? table[fullKey] : `[${key}]`;
  },
}));

interface ComponentProps {
  onClick?: (e?: unknown) => void;
  onChange?: (e?: { target?: { value?: string; checked?: boolean } }) => void;
  onClose?: () => void;
  onCloseAutoFocus?: (e: { preventDefault: () => void }) => void;
  [key: string]: unknown;
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

function findForm(
  element: React.ReactElement | undefined,
): { onSubmit?: (e?: { preventDefault: () => void }) => void | Promise<void> } | undefined {
  if (!element) return undefined;
  let found:
    { onSubmit?: (e?: { preventDefault: () => void }) => void | Promise<void> } | undefined;
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

function findNodeWithProp(
  element: React.ReactElement | undefined,
  propName: string,
): React.ReactElement | undefined {
  if (!element) return undefined;
  let found: React.ReactElement | undefined;
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (propName in props) {
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

function getProps(element: React.ReactElement | undefined): ComponentProps {
  return (element?.props ?? {}) as ComponentProps;
}

function sampleClientData(): ClientWithRelations {
  const now = new Date('2026-04-01T12:00:00.000Z');
  return {
    client: {
      id: '018f0000-0000-7000-8000-000000000001',
      kind: 'person',
      displayName: 'Anna Schmidt',
      preferredLocale: 'en',
      googleContactsSyncEnabled: false,
      createdAt: now,
      lastActivityAt: now,
      updatedAt: now,
    },
    contacts: [
      {
        id: 'contact-01',
        clientId: '018f0000-0000-7000-8000-000000000001',
        givenName: 'Anna',
        familyName: 'Schmidt',
        email: 'anna@example.com',
        emailNormalized: 'anna@example.com',
        phone: '+49 30 0000 0001',
        isPrimary: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    addresses: [],
    tags: [{ id: 'tag-1', name: 'Wedding' }],
  };
}

describe('Iteration 3 Branch Coverage Boost for Dialogs and Client Profile', () => {
  beforeEach(() => {
    mockStateQueue = [];
    mockCreatedParam = null;
    vi.clearAllMocks();
  });

  describe('TagsDialog & TagsForm branch coverage', () => {
    it('TagsForm: enforces client-side limit > 20 tags', async () => {
      const mockSuccess = vi.fn();
      const mockClose = vi.fn();
      // 21 distinct tags
      const tags21 = Array.from({ length: 21 }, (_, i) => `Tag${String(i)}`).join(', ');
      mockStateQueue = [tags21, false, null];

      const tree = TagsForm({
        clientId: 'client-1',
        currentTags: [],
        onClose: mockClose,
        onSuccess: mockSuccess,
      });

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });

      expect(setClientTagsAction).not.toHaveBeenCalled();
      expect(mockSuccess).not.toHaveBeenCalled();
      expect(mockClose).not.toHaveBeenCalled();
    });

    it('TagsForm: early returns when isSubmitting is true', async () => {
      const mockSuccess = vi.fn();
      const mockClose = vi.fn();
      mockStateQueue = ['Wedding', true, null]; // isSubmitting = true

      const tree = TagsForm({
        clientId: 'client-1',
        currentTags: [],
        onClose: mockClose,
        onSuccess: mockSuccess,
      });

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });
      expect(setClientTagsAction).not.toHaveBeenCalled();
    });

    it('TagsForm: handles server error with unknown code falling back to generic error', async () => {
      const mockSuccess = vi.fn();
      const mockClose = vi.fn();
      mockStateQueue = ['Wedding', false, null];

      vi.mocked(setClientTagsAction).mockResolvedValueOnce({
        success: false,
        code: 'UNEXPECTED_UNKNOWN_CODE' as unknown as 'LIMIT_EXCEEDED',
        error: 'Unknown error',
      });

      const tree = TagsForm({
        clientId: 'client-1',
        currentTags: [],
        onClose: mockClose,
        onSuccess: mockSuccess,
      });

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });
      expect(mockSuccess).not.toHaveBeenCalled();
      expect(mockClose).not.toHaveBeenCalled();
    });

    it('TagsForm: cancel button invokes onClose', () => {
      const mockClose = vi.fn();
      mockStateQueue = ['Wedding', false, null];
      const tree = TagsForm({
        clientId: 'client-1',
        currentTags: [],
        onClose: mockClose,
        onSuccess: vi.fn(),
      });

      const cancelBtn = findNodeByTestId(tree, 'cancel-tags-btn');
      getProps(cancelBtn).onClick?.();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('TagsDialog: handles triggerRef auto focus and dialog onClose wrapper', () => {
      const mockOpenChange = vi.fn();
      const mockFocus = vi.fn();
      const fakeTrigger = { current: { focus: mockFocus } as unknown as HTMLElement };

      mockStateQueue = ['Wedding', false, null];
      const treeWithTrigger = TagsDialog({
        clientId: 'client-1',
        isOpen: true,
        onOpenChange: mockOpenChange,
        currentTags: [],
        triggerRef: fakeTrigger,
        onSuccess: vi.fn(),
      });

      // DialogContent onCloseAutoFocus
      const content = findNodeByTestId(treeWithTrigger, 'tags-dialog');
      const fakeEvent = { preventDefault: vi.fn() };
      getProps(content).onCloseAutoFocus?.(fakeEvent);
      expect(fakeEvent.preventDefault).toHaveBeenCalled();
      expect(mockFocus).toHaveBeenCalled();

      // Check onClose wrapper inside TagsDialog invokes onOpenChange(false)
      const formNode = findNodeWithProp(treeWithTrigger, 'onClose');
      getProps(formNode).onClose?.();
      expect(mockOpenChange).toHaveBeenCalledWith(false);

      // Dialog without triggerRef
      mockStateQueue = ['Wedding', false, null];
      const treeNoTrigger = TagsDialog({
        clientId: 'client-1',
        isOpen: true,
        onOpenChange: mockOpenChange,
        currentTags: [],
        onSuccess: vi.fn(),
      });
      const contentNoTrigger = findNodeByTestId(treeNoTrigger, 'tags-dialog');
      const fakeEvent2 = { preventDefault: vi.fn() };
      getProps(contentNoTrigger).onCloseAutoFocus?.(fakeEvent2);
      expect(fakeEvent2.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('ConfirmDialog branch coverage', () => {
    it('handles cancel without onCancel callback provided', () => {
      const mockOpenChange = vi.fn();
      const tree = ConfirmDialog({
        isOpen: true,
        onOpenChange: mockOpenChange,
        title: 'Delete',
        description: 'Are you sure?',
        onConfirm: vi.fn(),
        // onCancel is deliberately omitted
      });

      const cancelBtn = findNodeByTestId(tree, 'confirm-dialog-cancel-btn');
      getProps(cancelBtn).onClick?.();
      expect(mockOpenChange).toHaveBeenCalledWith(false);
    });

    it('handles onCloseAutoFocus with and without triggerRef', () => {
      const mockFocus = vi.fn();
      const fakeTrigger = { current: { focus: mockFocus } as unknown as HTMLElement };

      const tree = ConfirmDialog({
        isOpen: true,
        onOpenChange: vi.fn(),
        title: 'Delete',
        description: 'Are you sure?',
        triggerRef: fakeTrigger,
        onConfirm: vi.fn(),
      });

      const content = findNodeByTestId(tree, 'confirm-dialog');
      const fakeEvent = { preventDefault: vi.fn() };
      getProps(content).onCloseAutoFocus?.(fakeEvent);
      expect(fakeEvent.preventDefault).toHaveBeenCalled();
      expect(mockFocus).toHaveBeenCalled();

      // Without trigger
      const treeNoTrigger = ConfirmDialog({
        isOpen: true,
        onOpenChange: vi.fn(),
        title: 'Delete',
        description: 'Are you sure?',
        onConfirm: vi.fn(),
      });
      const contentNoTrigger = findNodeByTestId(treeNoTrigger, 'confirm-dialog');
      const fakeEvent2 = { preventDefault: vi.fn() };
      getProps(contentNoTrigger).onCloseAutoFocus?.(fakeEvent2);
      expect(fakeEvent2.preventDefault).not.toHaveBeenCalled();
    });

    it('renders with default remove label when confirmLabel is omitted and handles isSubmitting', () => {
      const treeSubmitting = ConfirmDialog({
        isOpen: true,
        onOpenChange: vi.fn(),
        title: 'Delete',
        description: 'Are you sure?',
        isSubmitting: true,
        onConfirm: vi.fn(),
      });
      const html = renderToStaticMarkup(treeSubmitting);
      expect(html).toContain('animate-spin');
      expect(html).toContain('Removing...');
    });
  });

  describe('ContactDialog & ContactForm branch coverage', () => {
    const existingContact: ClientContact = {
      id: 'c-existing-1',
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

    it('ContactForm: early returns when isSubmitting is true', async () => {
      mockStateQueue = ['Lukas', 'Weber', 'lukas@example.com', '', false, true, null, {}, null];
      const tree = ContactForm({
        clientId: 'client-1',
        locale: 'en',
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      });
      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });
      expect(addContactAction).not.toHaveBeenCalled();
    });

    it('ContactForm: edit mode handles duplicate email without top-level duplicates array (fallback to data.duplicates)', async () => {
      const mockSuccess = vi.fn();
      const mockClose = vi.fn();
      mockStateQueue = ['Lukas', 'Weber', 'lukas@example.com', '', false, false, null, {}, null];

      vi.mocked(updateContactAction).mockResolvedValueOnce({
        success: false,
        code: 'DUPLICATE_EMAIL',
        error: 'Duplicate email',
        duplicates: undefined,
        data: { duplicates: [{ clientId: 'c2', displayName: 'Studio B' }] },
      } as unknown as Awaited<ReturnType<typeof updateContactAction>>);

      const tree = ContactForm({
        clientId: 'client-1',
        locale: 'en',
        contactToEdit: existingContact,
        onClose: mockClose,
        onSuccess: mockSuccess,
      });

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });
      expect(updateContactAction).toHaveBeenCalled();
      expect(mockSuccess).not.toHaveBeenCalled();
    });

    it('ContactForm: edit mode handles duplicate email fallback to empty array when data is undefined', async () => {
      mockStateQueue = ['Lukas', 'Weber', 'lukas@example.com', '', false, false, null, {}, null];

      vi.mocked(updateContactAction).mockResolvedValueOnce({
        success: false,
        code: 'DUPLICATE_EMAIL',
        error: 'Duplicate email',
        duplicates: undefined,
        data: undefined,
      } as unknown as Awaited<ReturnType<typeof updateContactAction>>);

      const tree = ContactForm({
        clientId: 'client-1',
        locale: 'en',
        contactToEdit: existingContact,
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      });

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });
      expect(updateContactAction).toHaveBeenCalled();
    });

    it('ContactForm: edit mode handles server error and exception rejection', async () => {
      // Server error with CLIENT_NEEDS_CONTACT
      mockStateQueue = ['Lukas', 'Weber', 'lukas@example.com', '', false, false, null, {}, null];
      vi.mocked(updateContactAction).mockResolvedValueOnce({
        success: false,
        code: 'CLIENT_NEEDS_CONTACT',
        error: 'Client needs contact',
      });
      const tree = ContactForm({
        clientId: 'client-1',
        locale: 'en',
        contactToEdit: existingContact,
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      });
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });

      // Rejection
      mockStateQueue = ['Lukas', 'Weber', 'lukas@example.com', '', false, false, null, {}, null];
      vi.mocked(updateContactAction).mockRejectedValueOnce(new Error('Network error'));
      const tree2 = ContactForm({
        clientId: 'client-1',
        locale: 'en',
        contactToEdit: existingContact,
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      });
      await findForm(tree2)?.onSubmit?.({ preventDefault: vi.fn() });
    });

    it('ContactForm: add mode handles duplicate fallback and generic error', async () => {
      mockStateQueue = ['New', 'Contact', 'new@example.com', '', false, false, null, {}, null];
      vi.mocked(addContactAction).mockResolvedValueOnce({
        success: false,
        code: 'DUPLICATE_EMAIL',
        error: 'Duplicate',
        duplicates: undefined,
        data: { duplicates: [{ clientId: 'c3', displayName: 'Studio C' }] },
      } as unknown as Awaited<ReturnType<typeof addContactAction>>);

      const tree = ContactForm({
        clientId: 'client-1',
        locale: 'en',
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      });
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });

      // Add mode error with unknown code
      mockStateQueue = ['New', 'Contact', 'new@example.com', '', false, false, null, {}, null];
      vi.mocked(addContactAction).mockResolvedValueOnce({
        success: false,
        code: 'UNKNOWN_CODE' as unknown as 'LIMIT_EXCEEDED',
        error: 'Unknown',
      });
      const tree2 = ContactForm({
        clientId: 'client-1',
        locale: 'en',
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      });
      await findForm(tree2)?.onSubmit?.({ preventDefault: vi.fn() });

      // Add mode exception
      mockStateQueue = ['New', 'Contact', 'new@example.com', '', false, false, null, {}, null];
      vi.mocked(addContactAction).mockRejectedValueOnce(new Error('Network failure'));
      const tree3 = ContactForm({
        clientId: 'client-1',
        locale: 'en',
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      });
      await findForm(tree3)?.onSubmit?.({ preventDefault: vi.fn() });
    });

    it('ContactForm: cancel button invokes onClose and primary checkbox changes', () => {
      const mockClose = vi.fn();
      mockStateQueue = ['', '', '', '', false, false, null, {}, null];
      const tree = ContactForm({
        clientId: 'client-1',
        locale: 'en',
        onClose: mockClose,
        onSuccess: vi.fn(),
      });

      const cancelBtn = findNodeByTestId(tree, 'cancel-contact-btn');
      getProps(cancelBtn).onClick?.();
      expect(mockClose).toHaveBeenCalledTimes(1);

      const checkbox = findNodeByTestId(tree, 'primary-contact-checkbox');
      getProps(checkbox).onChange?.({ target: { checked: true } });
    });

    it('ContactDialog: handles edit mode title, triggerRef auto focus, and dialog onClose wrapper', () => {
      const mockOpenChange = vi.fn();
      const mockFocus = vi.fn();
      const fakeTrigger = { current: { focus: mockFocus } as unknown as HTMLElement };

      mockStateQueue = ['Lukas', 'Weber', 'lukas@example.com', '', false, false, null, {}, null];
      const treeEdit = ContactDialog({
        clientId: 'client-1',
        locale: 'en',
        isOpen: true,
        contactToEdit: existingContact,
        triggerRef: fakeTrigger,
        onOpenChange: mockOpenChange,
        onSuccess: vi.fn(),
      });

      const content = findNodeByTestId(treeEdit, 'contact-dialog');
      const fakeEvent = { preventDefault: vi.fn() };
      getProps(content).onCloseAutoFocus?.(fakeEvent);
      expect(fakeEvent.preventDefault).toHaveBeenCalled();
      expect(mockFocus).toHaveBeenCalled();

      // Check onClose wrapper inside ContactDialog calls onOpenChange(false)
      const formNode = findNodeWithProp(treeEdit, 'onClose');
      getProps(formNode).onClose?.();
      expect(mockOpenChange).toHaveBeenCalledWith(false);

      // Add mode without triggerRef
      mockStateQueue = ['', '', '', '', false, false, null, {}, null];
      const treeAdd = ContactDialog({
        clientId: 'client-1',
        locale: 'en',
        isOpen: true,
        onOpenChange: mockOpenChange,
        onSuccess: vi.fn(),
      });
      const contentAdd = findNodeByTestId(treeAdd, 'contact-dialog');
      const fakeEvent2 = { preventDefault: vi.fn() };
      getProps(contentAdd).onCloseAutoFocus?.(fakeEvent2);
      expect(fakeEvent2.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('EditDetailsDialog & EditDetailsForm branch coverage', () => {
    const client = sampleClientData().client;

    it('EditDetailsForm: early returns when isSubmitting is true', async () => {
      mockStateQueue = ['person', 'Name', 'de', true, null, null];
      const tree = EditDetailsForm({
        client,
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      });
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(updateClientAction).not.toHaveBeenCalled();
    });

    it('EditDetailsForm: handles server error with NOT_FOUND and cancel button click', async () => {
      const mockClose = vi.fn();
      mockStateQueue = ['person', 'Updated Name', 'de', false, null, null];
      vi.mocked(updateClientAction).mockResolvedValueOnce({
        success: false,
        code: 'NOT_FOUND',
        error: 'Client not found',
      });

      const tree = EditDetailsForm({
        client,
        onClose: mockClose,
        onSuccess: vi.fn(),
      });
      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });

      // Click cancel
      const cancelBtn = findNodeByTestId(tree, 'cancel-edit-details-btn');
      getProps(cancelBtn).onClick?.();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('EditDetailsDialog: handles triggerRef auto focus and dialog onClose wrapper', () => {
      const mockOpenChange = vi.fn();
      const mockFocus = vi.fn();
      const fakeTrigger = { current: { focus: mockFocus } as unknown as HTMLElement };

      mockStateQueue = ['person', 'Anna Schmidt', 'en', false, null, null];
      const tree = EditDetailsDialog({
        client,
        isOpen: true,
        triggerRef: fakeTrigger,
        onOpenChange: mockOpenChange,
        onSuccess: vi.fn(),
      });

      const content = findNodeByTestId(tree, 'edit-details-dialog');
      const fakeEvent = { preventDefault: vi.fn() };
      getProps(content).onCloseAutoFocus?.(fakeEvent);
      expect(fakeEvent.preventDefault).toHaveBeenCalled();
      expect(mockFocus).toHaveBeenCalled();

      // Check onClose wrapper inside EditDetailsDialog calls onOpenChange(false)
      const formNode = findNodeWithProp(tree, 'onClose');
      getProps(formNode).onClose?.();
      expect(mockOpenChange).toHaveBeenCalledWith(false);

      // Without trigger
      mockStateQueue = ['person', 'Anna Schmidt', 'en', false, null, null];
      const treeNoTrigger = EditDetailsDialog({
        client,
        isOpen: true,
        onOpenChange: mockOpenChange,
        onSuccess: vi.fn(),
      });
      const contentNoTrigger = findNodeByTestId(treeNoTrigger, 'edit-details-dialog');
      const fakeEvent2 = { preventDefault: vi.fn() };
      getProps(contentNoTrigger).onCloseAutoFocus?.(fakeEvent2);
      expect(fakeEvent2.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('ClientProfile branches: locale en, created param, empty tags', () => {
    it('ClientProfile: renders with preferred language English and announced created param', () => {
      mockCreatedParam = '1';
      const clientData = sampleClientData();
      clientData.client.preferredLocale = 'en';

      const html = renderToStaticMarkup(
        <ClientProfile clientData={clientData} locale="en" studioTimezone="UTC" />,
      );

      expect(html).toContain('English');
      expect(html).toContain('Client created successfully.');
    });

    it('ClientProfile: renders empty tags state when tags array is empty', () => {
      const clientData = sampleClientData();
      clientData.tags = [];

      const html = renderToStaticMarkup(
        <ClientProfile clientData={clientData} locale="en" studioTimezone="UTC" />,
      );

      expect(html).toContain('No tags assigned');
    });
  });

  describe('AddressDialog branch coverage', () => {
    const existingAddress: ClientAddress = {
      id: 'addr-existing-1',
      clientId: 'client-1',
      type: 'billing',
      line1: 'Friedrichstraße 10',
      line2: null,
      postalCode: '10117',
      city: 'Berlin',
      region: null,
      countryCode: 'DE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('AddressDialog: handles triggerRef auto focus and dialog onClose wrapper', () => {
      const mockOpenChange = vi.fn();
      const mockFocus = vi.fn();
      const fakeTrigger = { current: { focus: mockFocus } as unknown as HTMLElement };

      mockStateQueue = [
        'billing',
        'Friedrichstraße 10',
        '',
        '10117',
        'Berlin',
        '',
        'DE',
        false,
        null,
        {},
      ];
      const tree = AddressDialog({
        clientId: 'client-1',
        locale: 'en',
        isOpen: true,
        addressToEdit: existingAddress,
        triggerRef: fakeTrigger,
        onOpenChange: mockOpenChange,
        onSuccess: vi.fn(),
      });

      const content = findNodeByTestId(tree, 'address-dialog');
      const fakeEvent = { preventDefault: vi.fn() };
      getProps(content).onCloseAutoFocus?.(fakeEvent);
      expect(fakeEvent.preventDefault).toHaveBeenCalled();
      expect(mockFocus).toHaveBeenCalled();

      // Check onClose wrapper inside AddressDialog calls onOpenChange(false)
      const formNode = findNodeWithProp(tree, 'onClose');
      getProps(formNode).onClose?.();
      expect(mockOpenChange).toHaveBeenCalledWith(false);

      // Without trigger
      mockStateQueue = [
        'billing',
        'Friedrichstraße 10',
        '',
        '10117',
        'Berlin',
        '',
        'DE',
        false,
        null,
        {},
      ];
      const treeNoTrigger = AddressDialog({
        clientId: 'client-1',
        locale: 'en',
        isOpen: true,
        addressToEdit: existingAddress,
        onOpenChange: mockOpenChange,
        onSuccess: vi.fn(),
      });
      const contentNoTrigger = findNodeByTestId(treeNoTrigger, 'address-dialog');
      const fakeEvent2 = { preventDefault: vi.fn() };
      getProps(contentNoTrigger).onCloseAutoFocus?.(fakeEvent2);
      expect(fakeEvent2.preventDefault).not.toHaveBeenCalled();
    });

    it('AddressDialog: edit mode renders with edit title and addressToEdit', () => {
      const html = renderToStaticMarkup(
        <AddressDialog
          clientId="client-1"
          locale="en"
          isOpen={true}
          addressToEdit={existingAddress}
          onOpenChange={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );
      expect(html).toContain('Edit address');
      expect(html).toContain('value="Friedrichstraße 10"');
    });
  });

  describe('Additional ContactForm branch coverage for empty optional fields', () => {
    const existingContact: ClientContact = {
      id: 'c-existing-2',
      clientId: 'client-1',
      givenName: 'Lukas',
      familyName: null,
      email: null,
      emailNormalized: null,
      phone: null,
      isPrimary: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('ContactForm: edit mode passes null for empty email, phone, and familyName', async () => {
      mockStateQueue = ['Lukas', '', '', '', false, false, null, {}, null];
      vi.mocked(updateContactAction).mockResolvedValueOnce({
        success: true,
        data: { contactId: existingContact.id },
      });

      const tree = ContactForm({
        clientId: 'client-1',
        locale: 'en',
        contactToEdit: existingContact,
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      });

      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(updateContactAction).toHaveBeenCalledWith({
        clientId: 'client-1',
        contactId: existingContact.id,
        givenName: 'Lukas',
        familyName: null,
        email: null,
        phone: null,
        isPrimary: false,
        acknowledgeDuplicates: false,
      });
    });

    it('ContactForm: add mode passes null for empty familyName and phone, and handles duplicate fallback to empty array', async () => {
      mockStateQueue = ['SoloGiven', '', 'solo@example.com', '', false, false, null, {}, null];
      vi.mocked(addContactAction).mockResolvedValueOnce({
        success: false,
        code: 'DUPLICATE_EMAIL',
        error: 'Duplicate email',
        duplicates: undefined,
        data: undefined,
      } as unknown as Awaited<ReturnType<typeof addContactAction>>);

      const tree = ContactForm({
        clientId: 'client-1',
        locale: 'en',
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      });

      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(addContactAction).toHaveBeenCalledWith({
        clientId: 'client-1',
        givenName: 'SoloGiven',
        familyName: null,
        email: 'solo@example.com',
        phone: null,
        isPrimary: false,
        acknowledgeDuplicates: false,
      });
    });
  });
});
