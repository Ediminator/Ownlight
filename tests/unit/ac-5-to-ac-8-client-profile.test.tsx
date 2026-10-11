import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClientProfile } from '@/components/clients/client-profile';
import type { ClientWithRelations } from '@/server/clients/repo';

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

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => '/en/clients/018f0000-0000-7000-8000-000000000042',
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
});
