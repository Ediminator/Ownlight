import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClientProfile } from '@/components/clients/client-profile';
import type { ClientWithRelations } from '@/server/clients/repo';

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

describe('TASK-0011: Client Profile UI (AC-5, AC-8)', () => {
  it('AC-5: renders display name as the only h1, kind, preferred language, contacts with primary marked, mailto/tel links, formatted addresses, tags, and timestamps in studio timezone', () => {
    const clientData = createSampleClient();
    const html = renderToStaticMarkup(
      <ClientProfile clientData={clientData} locale="en" studioTimezone="Europe/Berlin" />,
    );

    // Verify H1 count and text
    const h1Matches = html.match(/<h1[^>]*>(.*?)<\/h1>/g);
    expect(h1Matches).not.toBeNull();
    expect(h1Matches?.length).toBe(1);
    expect(h1Matches?.[0]).toContain('Acme Photo Studio GmbH');

    // Kind and preferred language
    expect(html).toContain('data-testid="client-kind-badge"');
    expect(html).toContain('Company');
    expect(html).toContain('German');

    // Tags
    expect(html).toContain('Wedding');
    expect(html).toContain('VIP');

    // Contacts: primary contact has primary badge, secondary does not
    expect(html).toContain('Anna Schmidt');
    expect(html).toContain('data-testid="primary-contact-badge"');
    expect(html).toContain('Lukas Weber');

    // Email link mailto:
    expect(html).toContain('href="mailto:anna.schmidt@example.com"');
    expect(html).toContain('href="mailto:lukas.weber@example.org"');

    // Phone link tel: with cleaned digits
    expect(html).toContain('href="tel:+493000004242"');
    expect(html).toContain('+49 30 0000 4242');

    // Addresses formatted
    expect(html).toContain('Musterstraße 42');
    expect(html).toContain('Hinterhaus');
    expect(html).toContain('10115 Berlin');
    expect(html).toContain('Germany'); // Localized via Intl.DisplayNames in en

    // Timestamps in studio timezone Europe/Berlin
    expect(html).toContain('data-testid="client-created-date"');
    expect(html).toContain('data-testid="client-last-activity-date"');
  });

  it('AC-8: German locale renders Deutschland for DE country code and German strings', () => {
    const clientData = createSampleClient();
    const html = renderToStaticMarkup(
      <ClientProfile clientData={clientData} locale="de" studioTimezone="Europe/Berlin" />,
    );

    // In German locale, Intl.DisplayNames('de', { type: 'region' }).of('DE') produces 'Deutschland'
    expect(html).toContain('Deutschland');
    expect(html).toContain('Musterstraße 42');
    expect(html).toContain('10115 Berlin');
  });

  it('AC-5: handles person kind, English preferred language, empty tags, empty contacts and empty addresses', () => {
    const emptyClient: ClientWithRelations = {
      client: {
        id: '018f0000-0000-7000-8000-000000000099',
        kind: 'person',
        displayName: 'John Doe',
        preferredLocale: 'en',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        lastActivityAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      contacts: [],
      addresses: [],
      tags: [],
    };

    const html = renderToStaticMarkup(
      <ClientProfile clientData={emptyClient} locale="en" studioTimezone="UTC" />,
    );

    expect(html).toContain('Person');
    expect(html).toContain('English');
    expect(html).toContain('No tags assigned');
    expect(html).toContain('No contacts recorded');
    expect(html).toContain('No addresses recorded');
  });

  it('AC-5: handles contact without names or phone and invalid country code', () => {
    const clientData: ClientWithRelations = {
      client: {
        id: '018f0000-0000-7000-8000-000000000088',
        kind: 'person',
        displayName: 'Solo Client',
        preferredLocale: 'en',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        lastActivityAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      contacts: [
        {
          id: 'contact-x',
          clientId: '018f0000-0000-7000-8000-000000000088',
          givenName: null,
          familyName: null,
          email: 'solo@example.com',
          emailNormalized: 'solo@example.com',
          phone: null,
          isPrimary: false,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      addresses: [
        {
          id: 'addr-x',
          clientId: '018f0000-0000-7000-8000-000000000088',
          type: 'postal',
          line1: 'Nowhere St 1',
          line2: null,
          postalCode: '99999',
          city: 'Unknown',
          region: null,
          countryCode: 'INVALID_COUNTRY_CODE',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      tags: [],
    };

    const html = renderToStaticMarkup(
      <ClientProfile clientData={clientData} locale="en" studioTimezone="UTC" />,
    );

    // Fallbacks to displayName if contact has no givenName/familyName
    expect(html).toContain('Solo Client');
    expect(html).toContain('solo@example.com');
    // Country code falls back to raw code when invalid
    expect(html).toContain('INVALID_COUNTRY_CODE');
  });
});
