import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClientCreateForm } from '@/components/clients/client-create-form';
import { ClientDirectory } from '@/components/clients/client-directory';
import { EditDetailsDialog } from '@/components/clients/edit-details-dialog';
import { ContactDialog } from '@/components/clients/contact-dialog';
import { AddressDialog } from '@/components/clients/address-dialog';
import { TagsDialog } from '@/components/clients/tags-dialog';
import { ConfirmDialog } from '@/components/clients/confirm-dialog';
import { getClientErrorMessage } from '@/lib/client-errors';
import type { ClientWithRelations, ListClientsResult } from '@/server/clients/repo';
import type { ClientAddress, ClientContact } from '@/server/db/schema/clients';

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
      'clients.list.title': 'Clients',
      'clients.list.description': 'Directory of clients.',
      'clients.list.newClient': 'New client',
      'clients.list.emptyStateTitle': 'No clients yet',
      'clients.list.emptyStateDescription': 'Clients will appear here.',
      'clients.form.title': 'New client',
      'clients.form.description': 'Add a new client to your studio.',
      'clients.form.kindLabel': 'Client type',
      'clients.form.kindPerson': 'Person',
      'clients.form.kindCompany': 'Company',
      'clients.form.displayNameLabel': 'Display name',
      'clients.form.preferredLanguageLabel': 'Preferred language',
      'clients.form.primaryContactSection': 'Primary contact',
      'clients.form.givenNameLabel': 'First name',
      'clients.form.familyNameLabel': 'Last name',
      'clients.form.emailLabel': 'Email address',
      'clients.form.phoneLabel': 'Phone number',
      'clients.form.tagsLabel': 'Tags',
      'clients.form.tagsHint': 'Separate multiple tags with commas.',
      'clients.form.submit': 'Create client',
      'clients.form.submitting': 'Creating client...',
      'clients.form.cancel': 'Cancel',
      'clients.form.errorSummaryTitle': 'There are errors in the form',
      'clients.form.duplicateWarningTitle': 'Possible duplicate',
      'clients.form.duplicateWarningDescription':
        'A client with this email address already exists:',
      'clients.form.opensInNewTab': '(opens in a new tab)',
      'clients.form.createAnyway': 'Create anyway',
      'clients.form.cancelDuplicate': 'Cancel',
      'clients.form.editDetailsTitle': 'Edit client details',
      'clients.form.editDetailsDescription': 'Update client display name and preferences.',
      'clients.form.addContactTitle': 'Add contact',
      'clients.form.addContactDescription': 'Add an additional contact for this client.',
      'clients.form.editContactTitle': 'Edit contact',
      'clients.form.editContactDescription': 'Update contact details.',
      'clients.form.isPrimaryLabel': 'Make primary contact',
      'clients.form.removeContactTitle': 'Remove contact',
      'clients.form.removeContactConfirm': 'Are you sure you want to remove this contact?',
      'clients.form.remove': 'Remove',
      'clients.form.removing': 'Removing...',
      'clients.form.addAddressTitle': 'Add address',
      'clients.form.addAddressDescription': 'Add a postal or billing address.',
      'clients.form.editAddressTitle': 'Edit address',
      'clients.form.editAddressDescription': 'Update address details.',
      'clients.form.addressTypeLabel': 'Address type',
      'clients.form.addressTypePostal': 'Postal address',
      'clients.form.addressTypeBilling': 'Billing address',
      'clients.form.line1Label': 'Address line 1',
      'clients.form.line2Label': 'Address line 2 (optional)',
      'clients.form.postalCodeLabel': 'Postal code',
      'clients.form.cityLabel': 'City',
      'clients.form.regionLabel': 'State / Region (optional)',
      'clients.form.countryLabel': 'Country',
      'clients.form.selectCountry': 'Select country',
      'clients.form.removeAddressTitle': 'Remove address',
      'clients.form.removeAddressConfirm': 'Are you sure you want to remove this address?',
      'clients.form.editTagsTitle': 'Edit tags',
      'clients.form.editTagsDescription': 'Add or modify tags for this client.',
      'clients.form.save': 'Save changes',
      'clients.form.saving': 'Saving...',
      'clients.errors.VALIDATION_FAILED': 'Please check the form for invalid inputs.',
      'clients.errors.DUPLICATE_EMAIL': 'A client with this email address already exists.',
      'clients.errors.LIMIT_EXCEEDED': 'Limit exceeded.',
      'clients.errors.CLIENT_NEEDS_CONTACT': 'A client must have at least one contact.',
      'clients.errors.NOT_FOUND': 'Not found.',
      'clients.errors.UNAUTHORIZED': 'Unauthorized.',
      'clients.errors.FORBIDDEN': 'Forbidden.',
      'clients.errors.GENERIC_ERROR': 'An unexpected error occurred.',
      'clients.errors.displayNameRequired': 'Display name is required.',
      'clients.errors.nameRequired': 'At least one contact name is required.',
      'clients.errors.emailInvalid': 'Invalid email address format.',
      'clients.errors.phoneInvalid': 'Invalid phone number format.',
      'clients.errors.line1Required': 'Address line 1 is required.',
      'clients.errors.postalCodeRequired': 'Postal code is required.',
      'clients.errors.cityRequired': 'City is required.',
      'clients.errors.countryRequired': 'Country is required.',
    };
    const fullKey = `${namespace}.${key}`;
    return table[fullKey] ?? `[${key}]`;
  },
}));

function sampleClientWithRelations(): ClientWithRelations {
  const now = new Date('2026-04-01T12:00:00.000Z');
  return {
    client: {
      id: '018f0000-0000-7000-8000-000000000001',
      kind: 'person',
      displayName: 'Anna Schmidt',
      preferredLocale: 'de',
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

describe('TASK-0012: Unit tests for Client creation & editing UI', () => {
  beforeEach(() => {
    mockStateQueue = [];
    vi.clearAllMocks();
  });

  it('AC-1: ClientDirectory renders "New client" primary button in header and empty state', () => {
    const emptyClients: ListClientsResult = { items: [], total: 0, page: 1, pageSize: 25 };
    const html = renderToStaticMarkup(
      <ClientDirectory initialClients={emptyClients} tags={[]} locale="en" />,
    );

    expect(html).toContain('data-testid="new-client-btn"');
    expect(html).toContain('href="/en/clients/new"');
    expect(html).toContain('New client');

    expect(html).toContain('data-testid="empty-state-new-client-btn"');
  });

  it('AC-1: ClientCreateForm renders all required fields with accessible labels and autocomplete="off"', () => {
    const html = renderToStaticMarkup(<ClientCreateForm locale="en" defaultLocale="de" />);

    expect(html).toContain('New client');
    expect(html).toContain('href="/en/clients"');

    expect(html).toContain('data-testid="kind-person-radio"');
    expect(html).toContain('data-testid="kind-company-radio"');

    expect(html).toContain('data-testid="display-name-input"');
    expect(html).toContain('id="displayName"');

    expect(html).toContain('data-testid="preferred-locale-select"');

    expect(html).toContain('data-testid="given-name-input"');
    expect(html).toContain('data-testid="family-name-input"');
    expect(html).toContain('data-testid="email-input"');
    expect(html).toContain('data-testid="phone-input"');
    expect(html).toMatch(/id="givenName"[^>]*autocomplete="off"/i);
    expect(html).toMatch(/id="familyName"[^>]*autocomplete="off"/i);
    expect(html).toMatch(/id="email"[^>]*autocomplete="off"/i);
    expect(html).toMatch(/id="phone"[^>]*autocomplete="off"/i);

    expect(html).toContain('data-testid="tags-input"');
    expect(html).toContain('id="tags-hint"');
    expect(html).toContain('Separate multiple tags with commas.');

    expect(html).toContain('data-testid="submit-client-btn"');
  });

  it('AC-2: ClientCreateForm renders accessible error summary and aria-invalid on validation errors', () => {
    mockStateQueue = [
      'person',
      '',
      'en',
      '',
      '',
      'bad-email',
      'invalid-phone',
      '',
      false, // isSubmitting
      {
        displayName: 'Display name is required.',
        givenName: 'At least one contact name is required.',
        email: 'Invalid email address format.',
        phone: 'Invalid phone number format.',
      },
      [
        { fieldId: 'displayName', message: 'Display name is required.' },
        { fieldId: 'givenName', message: 'At least one contact name is required.' },
        { fieldId: 'email', message: 'Invalid email address format.' },
        { fieldId: 'phone', message: 'Invalid phone number format.' },
      ],
      null, // serverErrorMessage
      null, // duplicateMatches
    ];

    const html = renderToStaticMarkup(<ClientCreateForm locale="en" />);

    expect(html).toContain('data-testid="error-summary"');
    expect(html).toContain('There are errors in the form');
    expect(html).toContain('href="#displayName"');
    expect(html).toContain('href="#givenName"');
    expect(html).toContain('href="#email"');
    expect(html).toContain('href="#phone"');

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('data-testid="display-name-error"');
    expect(html).toContain('data-testid="given-name-error"');
    expect(html).toContain('data-testid="email-error"');
    expect(html).toContain('data-testid="phone-error"');
  });

  it('AC-3: ClientCreateForm renders duplicate warning with opens-in-new-tab and create-anyway', () => {
    mockStateQueue = [
      'person',
      'Anna Schmidt Duplicate',
      'en',
      'Anna',
      'Schmidt',
      'anna@example.com',
      '+49 151 23456789',
      'Wedding',
      false,
      {},
      [],
      null,
      [
        {
          clientId: '018f0000-0000-7000-8000-000000000001',
          displayName: 'Existing Anna Studio',
        },
      ],
    ];

    const html = renderToStaticMarkup(<ClientCreateForm locale="en" />);

    expect(html).toContain('data-testid="duplicate-warning"');
    expect(html).toContain('Possible duplicate');
    expect(html).toContain('A client with this email address already exists:');
    expect(html).toContain('href="/en/clients/018f0000-0000-7000-8000-000000000001"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('(opens in a new tab)');
    expect(html).toContain('data-testid="create-anyway-btn"');
    expect(html).toContain('data-testid="cancel-duplicate-btn"');
  });

  it('AC-9: ClientCreateForm renders pending state with disabled submit and spinner', () => {
    mockStateQueue = [
      'person',
      'Pending Client',
      'en',
      'Pending',
      'Person',
      'pending@example.com',
      '+49 151 23456789',
      'Test',
      true, // isSubmitting
      {},
      [],
      null,
      null,
    ];

    const html = renderToStaticMarkup(<ClientCreateForm locale="en" />);

    expect(html).toContain('disabled=""');
    expect(html).toContain('Creating client...');
    expect(html).toContain('animate-spin');
  });

  it('AC-15: ClientCreateForm renders server error alert without technical details', () => {
    mockStateQueue = [
      'company',
      'Error Studio Corp',
      'de',
      'Jane',
      'Doe',
      'jane@example.com',
      '+49 151 23456789',
      'Corporate',
      false,
      {},
      [],
      'An unexpected error occurred.',
      null,
    ];

    const html = renderToStaticMarkup(<ClientCreateForm locale="de" />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('An unexpected error occurred.');
    expect(html).not.toContain('SQL');
    expect(html).not.toContain('ECONNREFUSED');
  });

  it('AC-4: EditDetailsDialog renders kind, display name, and preferred locale fields', () => {
    const sample = sampleClientWithRelations();
    const html = renderToStaticMarkup(
      <EditDetailsDialog
        client={sample.client}
        isOpen={true}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(html).toContain('data-testid="edit-details-dialog"');
    expect(html).toContain('Edit client details');
    expect(html).toContain('data-testid="edit-kind-person-radio"');
    expect(html).toContain('data-testid="edit-kind-company-radio"');
    expect(html).toContain('data-testid="edit-display-name-input"');
    expect(html).toContain('data-testid="edit-preferred-locale-select"');
    expect(html).toContain('data-testid="save-details-btn"');
    expect(html).toContain('data-testid="cancel-edit-details-btn"');
  });

  it('AC-4: EditDetailsDialog handles closed state, validation errors, and pending state', () => {
    const sample = sampleClientWithRelations();

    const closedHtml = renderToStaticMarkup(
      <EditDetailsDialog
        client={sample.client}
        isOpen={false}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(closedHtml).not.toContain('data-testid="edit-details-dialog"');

    // Validation error state
    mockStateQueue = [
      'company',
      '',
      'en',
      false,
      null,
      'Display name is required.', // displayNameError
    ];
    const errorHtml = renderToStaticMarkup(
      <EditDetailsDialog
        client={sample.client}
        isOpen={true}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(errorHtml).toContain('data-testid="edit-display-name-error"');
    expect(errorHtml).toContain('Display name is required.');
    expect(errorHtml).toContain('aria-invalid="true"');

    // Generic error state
    mockStateQueue = [
      'person',
      'Name',
      'de',
      false,
      'Failed to update', // errorMessage
      null,
    ];
    const genericErrorHtml = renderToStaticMarkup(
      <EditDetailsDialog
        client={sample.client}
        isOpen={true}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(genericErrorHtml).toContain('data-testid="edit-details-error"');
    expect(genericErrorHtml).toContain('Failed to update');

    // Pending state
    mockStateQueue = [
      'person',
      'Name',
      'de',
      true, // isSubmitting
      null,
      null,
    ];
    const pendingHtml = renderToStaticMarkup(
      <EditDetailsDialog
        client={sample.client}
        isOpen={true}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(pendingHtml).toContain('Saving...');
    expect(pendingHtml).toContain('animate-spin');
  });

  it('AC-5: ContactDialog renders fields and primary contact toggle with autocomplete="off"', () => {
    const html = renderToStaticMarkup(
      <ContactDialog
        clientId="018f0000-0000-7000-8000-000000000001"
        locale="en"
        isOpen={true}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(html).toContain('data-testid="contact-dialog"');
    expect(html).toContain('Add contact');
    expect(html).toContain('data-testid="contact-given-name-input"');
    expect(html).toContain('data-testid="contact-family-name-input"');
    expect(html).toContain('data-testid="contact-email-input"');
    expect(html).toContain('data-testid="contact-phone-input"');
    expect(html).toContain('data-testid="contact-is-primary-checkbox"');
    expect(html).toMatch(/id="contact-givenName"[^>]*autocomplete="off"/i);
    expect(html).toMatch(/id="contact-familyName"[^>]*autocomplete="off"/i);
    expect(html).toMatch(/id="contact-email"[^>]*autocomplete="off"/i);
    expect(html).toMatch(/id="contact-phone"[^>]*autocomplete="off"/i);
  });

  it('AC-5: ContactDialog handles closed state, edit mode, duplicate warnings, errors, and pending', () => {
    const closedHtml = renderToStaticMarkup(
      <ContactDialog
        clientId="c1"
        locale="en"
        isOpen={false}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(closedHtml).not.toContain('data-testid="contact-dialog"');

    // Edit mode
    const contactToEdit: ClientContact = {
      id: 'contact-02',
      clientId: 'c1',
      givenName: 'Lukas',
      familyName: 'Weber',
      email: 'lukas@example.com',
      emailNormalized: 'lukas@example.com',
      phone: '+49 151 23456789',
      isPrimary: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const editHtml = renderToStaticMarkup(
      <ContactDialog
        clientId="c1"
        locale="en"
        isOpen={true}
        contactToEdit={contactToEdit}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(editHtml).toContain('Edit contact');
    expect(editHtml).toContain('value="Lukas"');
    expect(editHtml).toContain('value="Weber"');

    // Duplicate matches in contact dialog
    mockStateQueue = [
      'Anna',
      'Schmidt',
      'anna@example.com',
      '+49 151 23456789',
      false,
      false, // isSubmitting
      null, // errorMessage
      {}, // fieldErrors
      [{ clientId: 'other-client', displayName: 'Other Studio' }], // duplicateMatches
    ];
    const duplicateHtml = renderToStaticMarkup(
      <ContactDialog
        clientId="c1"
        locale="en"
        isOpen={true}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(duplicateHtml).toContain('data-testid="contact-duplicate-warning"');
    expect(duplicateHtml).toContain('Possible duplicate');
    expect(duplicateHtml).toContain('data-testid="contact-create-anyway-btn"');
    expect(duplicateHtml).toContain('data-testid="contact-cancel-duplicate-btn"');

    // Field errors state
    mockStateQueue = [
      '',
      '',
      'invalid',
      'invalid',
      false,
      false,
      null,
      {
        name: 'At least one contact name is required.',
        email: 'Invalid email address format.',
        phone: 'Invalid phone number format.',
      },
      null,
    ];
    const fieldErrorHtml = renderToStaticMarkup(
      <ContactDialog
        clientId="c1"
        locale="en"
        isOpen={true}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(fieldErrorHtml).toContain('data-testid="contact-name-error"');
    expect(fieldErrorHtml).toContain('data-testid="contact-email-error"');
    expect(fieldErrorHtml).toContain('data-testid="contact-phone-error"');

    // Generic error and pending state
    mockStateQueue = [
      'John',
      'Doe',
      'john@example.com',
      '',
      false,
      true, // isSubmitting
      'Server error occurred',
      {},
      null,
    ];
    const pendingHtml = renderToStaticMarkup(
      <ContactDialog
        clientId="c1"
        locale="en"
        isOpen={true}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(pendingHtml).toContain('data-testid="contact-error"');
    expect(pendingHtml).toContain('Saving...');
    expect(pendingHtml).toContain('Server error occurred');
  });

  it('AC-6: ConfirmDialog renders accessible confirmation dialog for destructive actions', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        isOpen={true}
        onOpenChange={vi.fn()}
        title="Remove contact"
        description="Are you sure you want to remove this contact?"
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain('data-testid="confirm-dialog"');
    expect(html).toContain('Remove contact');
    expect(html).toContain('Are you sure you want to remove this contact?');
    expect(html).toContain('data-testid="confirm-dialog-confirm-btn"');
    expect(html).toContain('data-testid="confirm-dialog-cancel-btn"');
  });

  it('AC-6: ConfirmDialog handles closed, error, custom label, and pending states', () => {
    const closedHtml = renderToStaticMarkup(
      <ConfirmDialog
        isOpen={false}
        onOpenChange={vi.fn()}
        title="Title"
        description="Desc"
        onConfirm={vi.fn()}
      />,
    );
    expect(closedHtml).not.toContain('data-testid="confirm-dialog"');

    // Error state
    const errorHtml = renderToStaticMarkup(
      <ConfirmDialog
        isOpen={true}
        onOpenChange={vi.fn()}
        title="Remove contact"
        description="Desc"
        errorMessage="A client must have at least one contact."
        onConfirm={vi.fn()}
      />,
    );
    expect(errorHtml).toContain('data-testid="confirm-dialog-error"');
    expect(errorHtml).toContain('A client must have at least one contact.');

    // Pending state
    const pendingHtml = renderToStaticMarkup(
      <ConfirmDialog
        isOpen={true}
        onOpenChange={vi.fn()}
        title="Remove"
        description="Desc"
        isSubmitting={true}
        onConfirm={vi.fn()}
      />,
    );
    expect(pendingHtml).toContain('Removing...');
    expect(pendingHtml).toContain('animate-spin');

    // Custom confirm label
    const customHtml = renderToStaticMarkup(
      <ConfirmDialog
        isOpen={true}
        onOpenChange={vi.fn()}
        title="Delete"
        description="Desc"
        confirmLabel="Confirm Delete"
        onConfirm={vi.fn()}
      />,
    );
    expect(customHtml).toContain('Confirm Delete');
  });

  it('AC-7: AddressDialog renders type, lines, postal code, city, region, and ISO country select', () => {
    const html = renderToStaticMarkup(
      <AddressDialog
        clientId="018f0000-0000-7000-8000-000000000001"
        locale="en"
        isOpen={true}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(html).toContain('data-testid="address-dialog"');
    expect(html).toContain('Add address');
    expect(html).toContain('data-testid="address-type-select"');
    expect(html).toContain('data-testid="address-line1-input"');
    expect(html).toContain('data-testid="address-line2-input"');
    expect(html).toContain('data-testid="address-postal-code-input"');
    expect(html).toContain('data-testid="address-city-input"');
    expect(html).toContain('data-testid="address-region-input"');
    expect(html).toContain('data-testid="address-country-select"');

    expect(html).toContain('value="DE"');
    expect(html).toContain('Germany');
  });

  it('AC-7: AddressDialog handles closed state, edit mode, validation errors, and pending', () => {
    const closedHtml = renderToStaticMarkup(
      <AddressDialog
        clientId="c1"
        locale="en"
        isOpen={false}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(closedHtml).not.toContain('data-testid="address-dialog"');

    // Edit mode
    const addressToEdit: ClientAddress = {
      id: 'addr-01',
      clientId: 'c1',
      type: 'billing',
      line1: 'Friedrichstraße 10',
      line2: 'Suite 4B',
      postalCode: '10117',
      city: 'Berlin',
      region: 'Berlin',
      countryCode: 'DE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const editHtml = renderToStaticMarkup(
      <AddressDialog
        clientId="c1"
        locale="de"
        isOpen={true}
        addressToEdit={addressToEdit}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(editHtml).toContain('Edit address');
    expect(editHtml).toContain('value="Friedrichstraße 10"');
    expect(editHtml).toContain('value="Suite 4B"');
    expect(editHtml).toContain('Deutschland');

    // Field errors state
    mockStateQueue = [
      'postal',
      '',
      '',
      '',
      '',
      '',
      '',
      false,
      null,
      {
        line1: 'Address line 1 is required.',
        postalCode: 'Postal code is required.',
        city: 'City is required.',
        countryCode: 'Country is required.',
      },
    ];
    const fieldErrorHtml = renderToStaticMarkup(
      <AddressDialog
        clientId="c1"
        locale="en"
        isOpen={true}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(fieldErrorHtml).toContain('data-testid="address-line1-error"');
    expect(fieldErrorHtml).toContain('data-testid="address-postal-error"');
    expect(fieldErrorHtml).toContain('data-testid="address-city-error"');

    // Generic error and pending
    mockStateQueue = [
      'postal',
      'Street 1',
      '',
      '10115',
      'Berlin',
      '',
      'DE',
      true, // isSubmitting
      'Failed to save address',
      {},
    ];
    const pendingHtml = renderToStaticMarkup(
      <AddressDialog
        clientId="c1"
        locale="en"
        isOpen={true}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(pendingHtml).toContain('data-testid="address-error"');
    expect(pendingHtml).toContain('Saving...');
    expect(pendingHtml).toContain('Failed to save address');
  });

  it('AC-8: TagsDialog renders comma-separated input with visible hint', () => {
    const html = renderToStaticMarkup(
      <TagsDialog
        clientId="018f0000-0000-7000-8000-000000000001"
        isOpen={true}
        onOpenChange={vi.fn()}
        currentTags={[{ id: 't1', name: 'Wedding' }]}
        onSuccess={vi.fn()}
      />,
    );

    expect(html).toContain('data-testid="tags-dialog"');
    expect(html).toContain('Edit tags');
    expect(html).toContain('data-testid="edit-tags-input"');
    expect(html).toContain('id="edit-tags-hint"');
    expect(html).toContain('Separate multiple tags with commas.');
    expect(html).toContain('value="Wedding"');
  });

  it('AC-8: TagsDialog handles closed, error, and pending states', () => {
    const closedHtml = renderToStaticMarkup(
      <TagsDialog
        clientId="c1"
        isOpen={false}
        onOpenChange={vi.fn()}
        currentTags={[]}
        onSuccess={vi.fn()}
      />,
    );
    expect(closedHtml).not.toContain('data-testid="tags-dialog"');

    // Error state
    mockStateQueue = [
      'Wedding, 2026',
      false,
      'Limit exceeded.', // errorMessage
    ];
    const errorHtml = renderToStaticMarkup(
      <TagsDialog
        clientId="c1"
        isOpen={true}
        onOpenChange={vi.fn()}
        currentTags={[]}
        onSuccess={vi.fn()}
      />,
    );
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('Limit exceeded.');

    // Pending state
    mockStateQueue = ['Wedding', true, null];
    const pendingHtml = renderToStaticMarkup(
      <TagsDialog
        clientId="c1"
        isOpen={true}
        onOpenChange={vi.fn()}
        currentTags={[]}
        onSuccess={vi.fn()}
      />,
    );
    expect(pendingHtml).toContain('Saving...');
    expect(pendingHtml).toContain('animate-spin');
  });

  it('AC-15: getClientErrorMessage maps known domain codes and provides generic error for server errors', () => {
    const mockT = (k: string) => `[${k}]`;
    expect(getClientErrorMessage('VALIDATION_FAILED', mockT)).toBe('[VALIDATION_FAILED]');
    expect(getClientErrorMessage('DUPLICATE_EMAIL', mockT)).toBe('[DUPLICATE_EMAIL]');
    expect(getClientErrorMessage('LIMIT_EXCEEDED', mockT)).toBe('[LIMIT_EXCEEDED]');
    expect(getClientErrorMessage('CLIENT_NEEDS_CONTACT', mockT)).toBe('[CLIENT_NEEDS_CONTACT]');
    expect(getClientErrorMessage('NOT_FOUND', mockT)).toBe('[NOT_FOUND]');
    expect(getClientErrorMessage('UNKNOWN_CODE', mockT)).toBe('[GENERIC_ERROR]');
    expect(getClientErrorMessage(undefined, mockT)).toBe('[GENERIC_ERROR]');
  });
});
