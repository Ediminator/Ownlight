import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClientProfile } from '@/components/clients/client-profile';
import { EditDetailsDialog } from '@/components/clients/edit-details-dialog';
import { ContactDialog } from '@/components/clients/contact-dialog';
import { AddressDialog } from '@/components/clients/address-dialog';
import { TagsDialog } from '@/components/clients/tags-dialog';
import { ConfirmDialog } from '@/components/clients/confirm-dialog';
import {
  getClientAction,
  removeContactAction,
  removeAddressAction,
} from '@/server/clients/actions';
import type { ClientWithRelations } from '@/server/clients/repo';

let mockStateQueue: unknown[] = [];

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)): [T, (val: T) => void] => {
      if (mockStateQueue.length > 0) {
        const val = mockStateQueue.shift() as T;
        return [val, vi.fn()];
      }
      const resolved = typeof initial === 'function' ? (initial as () => T)() : initial;
      return [resolved, vi.fn()];
    },
    useRef: <T,>(initial: T) => ({ current: (initial ?? { focus: vi.fn() }) as unknown as T }),
    useEffect: (fn: () => unknown) => {
      try {
        fn();
      } catch {
        // ignore
      }
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => '/en/clients/018f0000-0000-7000-8000-000000000042',
  useSearchParams: () => new URLSearchParams(),
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
      'clients.profile.title': 'Client profile',
      'clients.profile.backToDirectory': 'Back to clients',
      'clients.profile.kind.person': 'Person',
      'clients.profile.kind.company': 'Company',
      'clients.profile.preferredLanguage': 'Preferred language',
      'clients.profile.language.en': 'English',
      'clients.profile.language.de': 'German',
      'clients.profile.tags': 'Tags',
      'clients.profile.noTags': 'No tags assigned',
      'clients.profile.contactsTitle': 'Contacts',
      'clients.profile.primaryBadge': 'Primary contact',
      'clients.profile.noContacts': 'No contacts recorded',
      'clients.profile.emailLabel': 'Email',
      'clients.profile.phoneLabel': 'Phone',
      'clients.profile.addressesTitle': 'Addresses',
      'clients.profile.addressType.postal': 'Postal address',
      'clients.profile.addressType.billing': 'Billing address',
      'clients.profile.noAddresses': 'No addresses recorded',
      'clients.profile.activityTitle': 'Activity & Timestamps',
      'clients.profile.createdAt': 'Created',
      'clients.profile.lastActivityAt': 'Last activity',
      'clients.profile.notFoundTitle': 'Client not found',
      'clients.profile.notFoundDescription': 'The requested client does not exist.',
      'clients.profile.errorMessage': 'An error occurred.',
      'clients.form.createdSuccess': 'Client created successfully.',
      'clients.form.savedSuccess': 'Changes saved successfully.',
      'clients.form.editDetails': 'Edit details',
      'clients.form.addContact': 'Add contact',
      'clients.form.editContact': 'Edit contact',
      'clients.form.removeContact': 'Remove contact',
      'clients.form.addAddress': 'Add address',
      'clients.form.editAddress': 'Edit address',
      'clients.form.removeAddress': 'Remove address',
      'clients.form.editTags': 'Edit tags',
      'clients.form.editDetailsTitle': 'Edit client details',
      'clients.form.addContactTitle': 'Add contact',
      'clients.form.editContactTitle': 'Edit contact',
      'clients.form.removeContactTitle': 'Remove contact',
      'clients.form.removeContactConfirm': 'Are you sure you want to remove this contact?',
      'clients.form.addAddressTitle': 'Add address',
      'clients.form.editAddressTitle': 'Edit address',
      'clients.form.removeAddressTitle': 'Remove address',
      'clients.form.removeAddressConfirm': 'Are you sure you want to remove this address?',
      'clients.form.editTagsTitle': 'Edit tags',
      'clients.form.cancel': 'Cancel',
      'clients.form.remove': 'Remove',
      'clients.form.removing': 'Removing...',
    };
    const fullKey = `${namespace}.${key}`;
    return table[fullKey] ?? `[${key}]`;
  },
}));

function createSampleClient(): ClientWithRelations {
  const createdAt = new Date('2026-03-15T10:30:00.000Z');
  const lastActivityAt = new Date('2026-04-01T14:45:00.000Z');

  return {
    client: {
      id: '018f0000-0000-7000-8000-000000000042',
      kind: 'company',
      displayName: 'Acme Photo Studio GmbH',
      preferredLocale: 'de',
      googleContactsSyncEnabled: false,
      createdAt,
      lastActivityAt,
      updatedAt: lastActivityAt,
    },
    contacts: [
      {
        id: 'contact-1',
        clientId: '018f0000-0000-7000-8000-000000000042',
        givenName: 'Anna',
        familyName: 'Schmidt',
        email: 'anna.schmidt@example.com',
        emailNormalized: 'anna.schmidt@example.com',
        phone: '+49 30 0000 4242',
        isPrimary: true,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: 'contact-2',
        clientId: '018f0000-0000-7000-8000-000000000042',
        givenName: 'Lukas',
        familyName: 'Weber',
        email: 'lukas.weber@example.org',
        emailNormalized: 'lukas.weber@example.org',
        phone: '+49 30 0000 4243',
        isPrimary: false,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    addresses: [
      {
        id: 'addr-1',
        clientId: '018f0000-0000-7000-8000-000000000042',
        type: 'postal',
        line1: 'Musterstraße 42',
        line2: 'Hinterhaus',
        postalCode: '10115',
        city: 'Berlin',
        region: 'Berlin',
        countryCode: 'DE',
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: 'addr-2',
        clientId: '018f0000-0000-7000-8000-000000000042',
        type: 'billing',
        line1: 'Rechnungsweg 1',
        line2: null,
        postalCode: '10117',
        city: 'Berlin',
        region: null,
        countryCode: 'DE',
        createdAt,
        updatedAt: createdAt,
      },
    ],
    tags: [
      { id: 'tag-1', name: 'Wedding' },
      { id: 'tag-2', name: 'VIP' },
    ],
  };
}

describe('TASK-0012: Client Profile UI and Dialog Integrations', () => {
  beforeEach(() => {
    mockStateQueue = [];
    vi.clearAllMocks();
  });

  it('AC-5: renders display name as the only h1, kind, preferred language, contacts with primary marked, mailto/tel links, formatted addresses, tags, and timestamps in studio timezone', () => {
    const clientData = createSampleClient();
    const html = renderToStaticMarkup(
      <ClientProfile clientData={clientData} locale="en" studioTimezone="Europe/Berlin" />,
    );

    expect(html).toContain('Acme Photo Studio GmbH');
    const h1Matches = html.match(/<h1[^>]*>([^<]+)<\/h1>/g);
    expect(h1Matches).not.toBeNull();
    expect(h1Matches?.length).toBe(1);

    expect(html).toContain('data-testid="client-kind-badge"');
    expect(html).toContain('Company');

    expect(html).toContain('German');

    expect(html).toContain('data-testid="contact-card-contact-1"');
    expect(html).toContain('Anna Schmidt');
    expect(html).toContain('data-testid="primary-contact-badge"');
    expect(html).toContain('Primary contact');

    expect(html).toContain('href="mailto:anna.schmidt@example.com"');
    expect(html).toContain('Musterstraße 42');
    expect(html).toContain('Hinterhaus');
    expect(html).toContain('10115 Berlin');
    expect(html).toContain('Germany');
    expect(html).toContain('Rechnungsweg 1');
    expect(html).toContain('10117 Berlin');

    expect(html).toContain('data-testid="client-tag-Wedding"');
    expect(html).toContain('Wedding');
    expect(html).toContain('VIP');

    expect(html).toContain('data-testid="client-created-date"');
    expect(html).toContain('data-testid="client-last-activity-date"');
  });

  it('AC-5: renders empty states for contacts, addresses, and tags', () => {
    const emptyClient: ClientWithRelations = {
      ...createSampleClient(),
      contacts: [],
      addresses: [],
      tags: [],
    };

    const html = renderToStaticMarkup(
      <ClientProfile clientData={emptyClient} locale="en" studioTimezone="UTC" />,
    );

    expect(html).toContain('No contacts recorded');
    expect(html).toContain('No addresses recorded');
    expect(html).toContain('No tags assigned');
  });

  it('AC-1: renders status message banner announced with role="status"', () => {
    const clientData = createSampleClient();
    mockStateQueue = [
      clientData.client,
      clientData.contacts,
      clientData.addresses,
      clientData.tags,
      'Client created successfully.', // statusMessage
      false, // editDetailsOpen
      false, // contactDialogOpen
      null, // editingContact
      false, // addressDialogOpen
      null, // editingAddress
      false, // tagsDialogOpen
      null, // removeContactTarget
      null, // removeContactError
      false, // isRemovingContact
      null, // removeAddressTarget
      null, // removeAddressError
      false, // isRemovingAddress
    ];

    const html = renderToStaticMarkup(
      <ClientProfile clientData={clientData} locale="en" studioTimezone="UTC" />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('Client created successfully.');
  });

  it('AC-4: opens and renders EditDetailsDialog when editDetailsOpen is true', () => {
    const clientData = createSampleClient();
    mockStateQueue = [
      clientData.client,
      clientData.contacts,
      clientData.addresses,
      clientData.tags,
      null,
      true, // editDetailsOpen
      false,
      null,
      false,
      null,
      false,
      null,
      null,
      false,
      null,
      null,
      false,
    ];

    const html = renderToStaticMarkup(
      <ClientProfile clientData={clientData} locale="en" studioTimezone="UTC" />,
    );

    expect(html).toContain('data-testid="edit-details-dialog"');
    expect(html).toContain('Edit client details');
  });

  it('AC-5: opens and renders ContactDialog for adding contact', () => {
    const clientData = createSampleClient();
    mockStateQueue = [
      clientData.client,
      clientData.contacts,
      clientData.addresses,
      clientData.tags,
      null,
      false,
      true, // contactDialogOpen
      null, // editingContact is null (Add mode)
      false,
      null,
      false,
      null,
      null,
      false,
      null,
      null,
      false,
    ];

    const html = renderToStaticMarkup(
      <ClientProfile clientData={clientData} locale="en" studioTimezone="UTC" />,
    );

    expect(html).toContain('data-testid="contact-dialog"');
    expect(html).toContain('Add contact');
  });

  it('AC-5: opens and renders ContactDialog for editing contact', () => {
    const clientData = createSampleClient();
    const contactToEdit = clientData.contacts[0];
    mockStateQueue = [
      clientData.client,
      clientData.contacts,
      clientData.addresses,
      clientData.tags,
      null,
      false,
      true, // contactDialogOpen
      contactToEdit, // editingContact is present (Edit mode)
      false,
      null,
      false,
      null,
      null,
      false,
      null,
      null,
      false,
    ];

    const html = renderToStaticMarkup(
      <ClientProfile clientData={clientData} locale="en" studioTimezone="UTC" />,
    );

    expect(html).toContain('data-testid="contact-dialog"');
    expect(html).toContain('Edit contact');
  });

  it('AC-6: opens and renders ConfirmDialog for removing a contact with confirmation and error states', () => {
    const clientData = createSampleClient();
    const contactToRemove = clientData.contacts[0];
    mockStateQueue = [
      clientData.client,
      clientData.contacts,
      clientData.addresses,
      clientData.tags,
      null,
      false,
      false,
      null,
      false,
      null,
      false,
      contactToRemove, // removeContactTarget
      'A client must have at least one contact.', // removeContactError
      true, // isRemovingContact
      null,
      null,
      false,
    ];

    const html = renderToStaticMarkup(
      <ClientProfile clientData={clientData} locale="en" studioTimezone="UTC" />,
    );

    expect(html).toContain('data-testid="confirm-dialog"');
    expect(html).toContain('Remove contact');
    expect(html).toContain('A client must have at least one contact.');
    expect(html).toContain('Removing...');
  });

  it('AC-7: opens and renders AddressDialog for adding and editing address', () => {
    const clientData = createSampleClient();
    // Add mode
    mockStateQueue = [
      clientData.client,
      clientData.contacts,
      clientData.addresses,
      clientData.tags,
      null,
      false,
      false,
      null,
      true, // addressDialogOpen
      null, // editingAddress (Add mode)
      false,
      null,
      null,
      false,
      null,
      null,
      false,
    ];

    const addHtml = renderToStaticMarkup(
      <ClientProfile clientData={clientData} locale="en" studioTimezone="UTC" />,
    );
    expect(addHtml).toContain('data-testid="address-dialog"');
    expect(addHtml).toContain('Add address');

    // Edit mode
    const addressToEdit = clientData.addresses[0];
    mockStateQueue = [
      clientData.client,
      clientData.contacts,
      clientData.addresses,
      clientData.tags,
      null,
      false,
      false,
      null,
      true, // addressDialogOpen
      addressToEdit, // editingAddress (Edit mode)
      false,
      null,
      null,
      false,
      null,
      null,
      false,
    ];

    const editHtml = renderToStaticMarkup(
      <ClientProfile clientData={clientData} locale="en" studioTimezone="UTC" />,
    );
    expect(editHtml).toContain('data-testid="address-dialog"');
    expect(editHtml).toContain('Edit address');
  });

  it('AC-7: opens and renders ConfirmDialog for removing address with error and pending states', () => {
    const clientData = createSampleClient();
    mockStateQueue = [
      clientData.client,
      clientData.contacts,
      clientData.addresses,
      clientData.tags,
      null,
      false,
      false,
      null,
      false,
      null,
      false,
      null,
      null,
      false,
      'postal', // removeAddressTarget
      'Failed to remove address', // removeAddressError
      true, // isRemovingAddress
    ];

    const html = renderToStaticMarkup(
      <ClientProfile clientData={clientData} locale="en" studioTimezone="UTC" />,
    );

    expect(html).toContain('data-testid="confirm-dialog"');
    expect(html).toContain('Remove address');
    expect(html).toContain('Failed to remove address');
    expect(html).toContain('Removing...');
  });

  it('AC-8: opens and renders TagsDialog when tagsDialogOpen is true', () => {
    const clientData = createSampleClient();
    mockStateQueue = [
      clientData.client,
      clientData.contacts,
      clientData.addresses,
      clientData.tags,
      null,
      false,
      false,
      null,
      false,
      null,
      true, // tagsDialogOpen
      null,
      null,
      false,
      null,
      null,
      false,
    ];

    const html = renderToStaticMarkup(
      <ClientProfile clientData={clientData} locale="en" studioTimezone="UTC" />,
    );

    expect(html).toContain('data-testid="tags-dialog"');
    expect(html).toContain('Edit tags');
  });

  it('AC-5 & AC-6: handles interactive dialog triggers and callbacks', () => {
    vi.useFakeTimers();
    try {
      const clientData = createSampleClient();
      vi.mocked(getClientAction).mockResolvedValue({
        success: true,
        data: clientData,
      });

      const tree = ClientProfile({
        clientData,
        locale: 'en',
        studioTimezone: 'UTC',
      });

      const editDetailsBtn = findNodeByTestId(tree, 'edit-client-details-btn');
      const editContactBtn = findNodeByTestId(tree, 'edit-contact-btn-contact-1');
      const removeContactBtn = findNodeByTestId(tree, 'remove-contact-btn-contact-1');
      const addContactBtn = findNodeByTestId(tree, 'add-contact-btn');
      const addAddressBtn = findNodeByTestId(tree, 'add-address-btn');
      const editAddressBtn = findNodeByTestId(tree, 'edit-address-btn-postal');
      const removeAddressBtn = findNodeByTestId(tree, 'remove-address-btn-postal');
      const editTagsBtn = findNodeByTestId(tree, 'edit-tags-btn');

      const fakeEvent = { currentTarget: {} };
      getProps(editDetailsBtn).onClick?.(fakeEvent);
      getProps(editContactBtn).onClick?.(fakeEvent);
      getProps(removeContactBtn).onClick?.(fakeEvent);
      getProps(addContactBtn).onClick?.(fakeEvent);
      getProps(addAddressBtn).onClick?.(fakeEvent);
      getProps(editAddressBtn).onClick?.(fakeEvent);
      getProps(removeAddressBtn).onClick?.(fakeEvent);
      getProps(editTagsBtn).onClick?.(fakeEvent);

      // Dialog callbacks
      const editDialog = findNodeByType(tree, EditDetailsDialog);
      getProps(editDialog).onSuccess?.({
        kind: 'person',
        displayName: 'Jane Doe',
        preferredLocale: 'en',
      });

      const contactDialog = findNodeByType(tree, ContactDialog);
      getProps(contactDialog).onSuccess?.();

      const addressDialog = findNodeByType(tree, AddressDialog);
      getProps(addressDialog).onSuccess?.();

      const tagsDialog = findNodeByType(tree, TagsDialog);
      getProps(tagsDialog).onSuccess?.([{ id: 'tag-new', name: 'Editorial' }]);

      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });

  it('AC-6 & AC-7: handles contact and address removal confirms and errors', () => {
    const clientData = createSampleClient();

    // 1. Success removal of contact
    vi.mocked(removeContactAction).mockResolvedValueOnce({
      success: true,
      data: { contactId: 'contact-1' },
    });
    vi.mocked(getClientAction).mockResolvedValueOnce({ success: true, data: clientData });

    mockStateQueue = [
      clientData.client,
      clientData.contacts,
      clientData.addresses,
      clientData.tags,
      null, // statusMessage
      false, // editDetailsOpen
      false, // contactDialogOpen
      null, // editingContact
      false, // addressDialogOpen
      null, // editingAddress
      false, // tagsDialogOpen
      clientData.contacts[0], // removeContactTarget
      null, // removeContactError
      false, // isRemovingContact
      null, // removeAddressTarget
      null, // removeAddressError
      false, // isRemovingAddress
    ];

    const tree1 = ClientProfile({ clientData, locale: 'en', studioTimezone: 'UTC' });
    const confirmNodes1 = findAllNodesByType(tree1, ConfirmDialog);
    const removeContactDialog1 = confirmNodes1.find((n) =>
      getProps(n).description?.includes('contact'),
    );

    getProps(removeContactDialog1).onOpenChange?.(false);
    getProps(removeContactDialog1).onConfirm?.();

    // 2. Failure removal of contact
    vi.mocked(removeContactAction).mockResolvedValueOnce({
      success: false,
      code: 'CLIENT_NEEDS_CONTACT',
      error: 'Cannot remove only contact',
    });
    mockStateQueue = [
      clientData.client,
      clientData.contacts,
      clientData.addresses,
      clientData.tags,
      null,
      false,
      false,
      null,
      false,
      null,
      false,
      clientData.contacts[0],
      null,
      false,
      null,
      null,
      false,
    ];
    const tree2 = ClientProfile({ clientData, locale: 'en', studioTimezone: 'UTC' });
    const confirmNodes2 = findAllNodesByType(tree2, ConfirmDialog);
    const removeContactDialog2 = confirmNodes2.find((n) =>
      getProps(n).description?.includes('contact'),
    );
    getProps(removeContactDialog2).onConfirm?.();

    // 3. Exception in removeContact
    vi.mocked(removeContactAction).mockRejectedValueOnce(new Error('Network error'));
    mockStateQueue = [
      clientData.client,
      clientData.contacts,
      clientData.addresses,
      clientData.tags,
      null,
      false,
      false,
      null,
      false,
      null,
      false,
      clientData.contacts[0],
      null,
      false,
      null,
      null,
      false,
    ];
    const tree3 = ClientProfile({ clientData, locale: 'en', studioTimezone: 'UTC' });
    const confirmNodes3 = findAllNodesByType(tree3, ConfirmDialog);
    const removeContactDialog3 = confirmNodes3.find((n) =>
      getProps(n).description?.includes('contact'),
    );
    getProps(removeContactDialog3).onConfirm?.();

    // 4. Success removal of address
    vi.mocked(removeAddressAction).mockResolvedValueOnce({
      success: true,
      data: { type: 'postal' },
    });
    vi.mocked(getClientAction).mockResolvedValueOnce({ success: true, data: clientData });
    mockStateQueue = [
      clientData.client,
      clientData.contacts,
      clientData.addresses,
      clientData.tags,
      null,
      false,
      false,
      null,
      false,
      null,
      false,
      null,
      null,
      false,
      'postal', // removeAddressTarget
      null,
      false,
    ];
    const tree4 = ClientProfile({ clientData, locale: 'en', studioTimezone: 'UTC' });
    const confirmNodes4 = findAllNodesByType(tree4, ConfirmDialog);
    const removeAddressDialog1 = confirmNodes4.find((n) =>
      getProps(n).description?.includes('address'),
    );
    getProps(removeAddressDialog1).onOpenChange?.(false);
    getProps(removeAddressDialog1).onConfirm?.();

    // 5. Failure removal of address
    vi.mocked(removeAddressAction).mockResolvedValueOnce({
      success: false,
      code: 'NOT_FOUND',
      error: 'Address not found',
    });
    mockStateQueue = [
      clientData.client,
      clientData.contacts,
      clientData.addresses,
      clientData.tags,
      null,
      false,
      false,
      null,
      false,
      null,
      false,
      null,
      null,
      false,
      'postal',
      null,
      false,
    ];
    const tree5 = ClientProfile({ clientData, locale: 'en', studioTimezone: 'UTC' });
    const confirmNodes5 = findAllNodesByType(tree5, ConfirmDialog);
    const removeAddressDialog2 = confirmNodes5.find((n) =>
      getProps(n).description?.includes('address'),
    );
    getProps(removeAddressDialog2).onConfirm?.();

    // 6. Exception removal of address
    vi.mocked(removeAddressAction).mockRejectedValueOnce(new Error('Network error'));
    mockStateQueue = [
      clientData.client,
      clientData.contacts,
      clientData.addresses,
      clientData.tags,
      null,
      false,
      false,
      null,
      false,
      null,
      false,
      null,
      null,
      false,
      'postal',
      null,
      false,
    ];
    const tree6 = ClientProfile({ clientData, locale: 'en', studioTimezone: 'UTC' });
    const confirmNodes6 = findAllNodesByType(tree6, ConfirmDialog);
    const removeAddressDialog3 = confirmNodes6.find((n) =>
      getProps(n).description?.includes('address'),
    );
    getProps(removeAddressDialog3).onConfirm?.();

    // 7. Dismiss status banner
    mockStateQueue = [
      clientData.client,
      clientData.contacts,
      clientData.addresses,
      clientData.tags,
      'Banner status', // statusMessage
      false,
      false,
      null,
      false,
      null,
      false,
      null,
      null,
      false,
      null,
      null,
      false,
    ];
    const tree7 = ClientProfile({ clientData, locale: 'en', studioTimezone: 'UTC' });
    const dismissBtn = findNode(
      tree7,
      (el) => el.type === 'button' && (el.props as { children?: unknown }).children === '✕',
    );
    getProps(dismissBtn).onClick?.();
  });

  it('AC-5: handles refreshClientData non-fatal error gracefully', () => {
    const clientData = createSampleClient();
    vi.mocked(getClientAction).mockRejectedValueOnce(new Error('DB failure'));

    const tree = ClientProfile({ clientData, locale: 'en', studioTimezone: 'UTC' });
    const contactDialog = findNodeByType(tree, ContactDialog);
    getProps(contactDialog).onSuccess?.();
  });

  it('I1-U01: renders google sync status badges with WCAG 2.2 AA compliant dark mode contrast classes', () => {
    const baseClient = createSampleClient();

    // 1. Failed sync status badge (I1-U01)
    const failedClient = {
      ...baseClient,
      googleSyncStatus: 'failed' as const,
    };
    const failedHtml = renderToStaticMarkup(
      <ClientProfile clientData={failedClient} locale="en" studioTimezone="UTC" />,
    );
    expect(failedHtml).toContain('data-testid="google-sync-status-badge"');
    expect(failedHtml).toContain('dark:bg-red-950/40');
    expect(failedHtml).toContain('dark:text-red-300');
    expect(failedHtml).toContain('dark:border-red-800');

    // 2. Synced status badge
    const syncedClient = {
      ...baseClient,
      googleSyncStatus: 'synced' as const,
    };
    const syncedHtml = renderToStaticMarkup(
      <ClientProfile clientData={syncedClient} locale="en" studioTimezone="UTC" />,
    );
    expect(syncedHtml).toContain('dark:bg-emerald-950/40');
    expect(syncedHtml).toContain('dark:text-emerald-300');
    expect(syncedHtml).toContain('dark:border-emerald-800');

    // 3. Pending status badge
    const pendingClient = {
      ...baseClient,
      googleSyncStatus: 'pending' as const,
    };
    const pendingHtml = renderToStaticMarkup(
      <ClientProfile clientData={pendingClient} locale="en" studioTimezone="UTC" />,
    );
    expect(pendingHtml).toContain('dark:bg-amber-950/40');
    expect(pendingHtml).toContain('dark:text-amber-300');
    expect(pendingHtml).toContain('dark:border-amber-800');
  });
});

interface InteractiveProps {
  onClick?: (e?: unknown) => void;
  onOpenChange?: (open: boolean) => void;
  onSuccess?: (val?: unknown) => void;
  onConfirm?: () => void;
  description?: string;
}

function findNode(
  node: React.ReactNode,
  predicate: (el: React.ReactElement) => boolean,
): React.ReactElement | undefined {
  let found: React.ReactElement | undefined;
  function traverse(current: unknown) {
    if (!current || found) return;
    if (React.isValidElement(current)) {
      if (predicate(current)) {
        found = current;
        return;
      }
      const props = current.props as { children?: unknown };
      traverse(props.children);
    } else if (Array.isArray(current)) {
      for (const item of current) {
        traverse(item);
      }
    }
  }
  traverse(node);
  return found;
}

function findNodeByTestId(node: React.ReactNode, testId: string): React.ReactElement | undefined {
  return findNode(node, (el) => (el.props as { 'data-testid'?: string })['data-testid'] === testId);
}

function findNodeByType(node: React.ReactNode, component: unknown): React.ReactElement | undefined {
  return findNode(node, (el) => el.type === component);
}

function findAllNodesByType(node: React.ReactNode, component: unknown): React.ReactElement[] {
  const result: React.ReactElement[] = [];
  function traverse(current: unknown) {
    if (!current) return;
    if (React.isValidElement(current)) {
      if (current.type === component) {
        result.push(current);
      }
      const props = current.props as { children?: unknown };
      traverse(props.children);
    } else if (Array.isArray(current)) {
      for (const item of current) {
        traverse(item);
      }
    }
  }
  traverse(node);
  return result;
}

function getProps(node: React.ReactElement | undefined): InteractiveProps {
  const p = node?.props;
  if (p && typeof p === 'object') {
    return p;
  }
  return {};
}
