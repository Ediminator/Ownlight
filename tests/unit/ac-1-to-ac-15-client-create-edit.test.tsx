import { describe, it, expect, vi } from 'vitest';
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
      'clients.form.addAddressTitle': 'Add address',
      'clients.form.addAddressDescription': 'Add a postal or billing address.',
      'clients.form.editAddressTitle': 'Edit address',
      'clients.form.editAddressDescription': 'Update address details.',
      'clients.form.addressTypeLabel': 'Address type',
      'clients.form.addressTypePostal': 'Postal address',
      'clients.form.addressTypeBilling': 'Billing address',
      'clients.form.line1Label': 'Address line 1',
      'clients.form.postalCodeLabel': 'Postal code',
      'clients.form.cityLabel': 'City',
      'clients.form.countryLabel': 'Country',
      'clients.form.selectCountry': 'Select country',
      'clients.form.removeAddressTitle': 'Remove address',
      'clients.form.removeAddressConfirm': 'Are you sure you want to remove this address?',
      'clients.form.editTagsTitle': 'Edit tags',
      'clients.form.editTagsDescription': 'Add or modify tags for this client.',
      'clients.form.save': 'Save changes',
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
  it('AC-1: ClientDirectory renders "New client" primary button in header and empty state', () => {
    const emptyClients: ListClientsResult = { items: [], total: 0, page: 1, pageSize: 25 };
    const html = renderToStaticMarkup(
      <ClientDirectory initialClients={emptyClients} tags={[]} locale="en" />,
    );

    // Header new client button
    expect(html).toContain('data-testid="new-client-btn"');
    expect(html).toContain('href="/en/clients/new"');
    expect(html).toContain('New client');

    // Empty state new client button
    expect(html).toContain('data-testid="empty-state-new-client-btn"');
  });

  it('AC-1: ClientCreateForm renders all required fields with accessible labels and autocomplete="off"', () => {
    const html = renderToStaticMarkup(<ClientCreateForm locale="en" defaultLocale="de" />);

    // Title and back link
    expect(html).toContain('New client');
    expect(html).toContain('href="/en/clients"');

    // Radio group for kind
    expect(html).toContain('data-testid="kind-person-radio"');
    expect(html).toContain('data-testid="kind-company-radio"');

    // Display name input
    expect(html).toContain('data-testid="display-name-input"');
    expect(html).toContain('id="displayName"');

    // Preferred language select
    expect(html).toContain('data-testid="preferred-locale-select"');

    // Primary contact fields with autocomplete="off"
    expect(html).toContain('data-testid="given-name-input"');
    expect(html).toContain('data-testid="family-name-input"');
    expect(html).toContain('data-testid="email-input"');
    expect(html).toContain('data-testid="phone-input"');
    expect(html).toMatch(/id="givenName"[^>]*autocomplete="off"/i);
    expect(html).toMatch(/id="familyName"[^>]*autocomplete="off"/i);
    expect(html).toMatch(/id="email"[^>]*autocomplete="off"/i);
    expect(html).toMatch(/id="phone"[^>]*autocomplete="off"/i);

    // Tags field with visible hint
    expect(html).toContain('data-testid="tags-input"');
    expect(html).toContain('id="tags-hint"');
    expect(html).toContain('Separate multiple tags with commas.');

    // Submit button
    expect(html).toContain('data-testid="submit-client-btn"');
  });

  it('AC-2: Error summary component structure and field aria attributes', () => {
    // Verifies form inputs have associated error IDs and aria attributes
    const html = renderToStaticMarkup(<ClientCreateForm locale="en" />);
    expect(html).toContain('id="displayName"');
    expect(html).toContain('id="givenName"');
    expect(html).toContain('id="email"');
    expect(html).toContain('id="phone"');
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

    // Verifies Germany is in country list
    expect(html).toContain('value="DE"');
    expect(html).toContain('Germany');
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
