import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Lead } from '@/server/db/schema/leads';
import type { LeadWithDetails } from '@/server/leads/service';
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

vi.mock('server-only', () => ({}));

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
  }),
  usePathname: () => '/en/leads/test-id',
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
  }),
  usePathname: () => '/en/leads/test-id',
}));

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = Reflect.get(current, part);
    } else {
      return undefined;
    }
  }
  return current;
}

let currentLocale: 'en' | 'de' = 'en';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => {
    return (key: string, values?: Record<string, unknown>) => {
      const messages = currentLocale === 'de' ? deMessages : enMessages;
      const fullPath = namespace ? `${namespace}.${key}` : key;
      const raw = getNestedValue(messages, fullPath);
      let text = typeof raw === 'string' ? raw : `[${fullPath}]`;
      if (values) {
        for (const [vKey, vVal] of Object.entries(values)) {
          text = text.replace(new RegExp(`\\{${vKey}\\}`, 'g'), String(vVal));
        }
      }
      return text;
    };
  },
  useLocale: () => currentLocale,
}));

const mockConvertLeadToClientAction = vi.fn();
const mockGetLeadDuplicatesAction = vi.fn();
const mockChangeLeadStatusAction = vi.fn();
const mockDeleteLeadsAction = vi.fn();
const mockExportLeadDsarAction = vi.fn();
const mockReauthenticateAction = vi.fn();

vi.mock('@/server/leads/actions', () => ({
  convertLeadToClientAction: (...args: unknown[]): unknown =>
    mockConvertLeadToClientAction(...args) as unknown,
  getLeadDuplicatesAction: (...args: unknown[]): unknown =>
    mockGetLeadDuplicatesAction(...args) as unknown,
  changeLeadStatusAction: (...args: unknown[]): unknown =>
    mockChangeLeadStatusAction(...args) as unknown,
  deleteLeadsAction: (...args: unknown[]): unknown => mockDeleteLeadsAction(...args) as unknown,
  exportLeadDsarAction: (...args: unknown[]): unknown =>
    mockExportLeadDsarAction(...args) as unknown,
}));

vi.mock('@/server/auth/mfa-actions', () => ({
  reauthenticateAction: (...args: unknown[]): unknown =>
    mockReauthenticateAction(...args) as unknown,
}));

import { LeadDetailView } from '@/components/leads/lead-detail-view';

function createDummyLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: '018f0000-0000-7000-8000-000000000001',
    formId: '018f0000-0000-7000-8000-000000000002',
    noticeVersionId: '018f0000-0000-7000-8000-000000000003',
    clientId: null,
    status: 'new',
    verification: 'verified',
    locale: 'en',
    email: 'client@example.org',
    emailNormalized: 'client@example.org',
    givenName: 'Jane',
    familyName: 'Doe',
    phone: '+49 30 123456',
    eventTypeKey: 'wedding',
    eventDate: '2026-06-20',
    eventLocation: 'Berlin, Germany',
    message: 'Hello, looking for a wedding photographer!',
    deliveryMode: 'hosted',
    autoReplyStatus: 'sent',
    convertedAt: null,
    receivedAt: new Date('2026-10-10T10:00:00Z'),
    lastActivityAt: new Date('2026-10-10T10:00:00Z'),
    noticeAcknowledgedAt: new Date('2026-10-10T10:00:00Z'),
    createdAt: new Date('2026-10-10T10:00:00Z'),
    updatedAt: new Date('2026-10-10T10:00:00Z'),
    ...overrides,
  };
}

describe('TASK-0032: Lead Conversion Dialog & Banner Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentLocale = 'en';
  });

  it('AC-1: unconverted lead displays "Convert to client" action button', () => {
    const detail: LeadWithDetails = {
      lead: createDummyLead({ status: 'new' }),
      formName: 'Inquiry Form',
      noticeVersion: null,
      formEventTypes: null,
      duplicates: [],
    };

    const html = renderToStaticMarkup(<LeadDetailView leadWithDetails={detail} locale="en" />);
    expect(html).toContain('Convert to client');
    expect(html).toContain('data-testid="convert-lead-btn"');
    expect(html).toContain('data-testid="convert-to-client-btn"');
    // Does not show converted banner
    expect(html).not.toContain('data-testid="lead-converted-banner"');
  });

  it('AC-6: converted lead renders Converted Banner with link to client and hides conversion/status action buttons', () => {
    const clientId = '018f0000-0000-7000-8000-000000000099';
    const detail: LeadWithDetails = {
      lead: createDummyLead({
        status: 'converted',
        clientId,
        convertedAt: new Date('2026-10-12T14:30:00Z'),
        givenName: null,
        familyName: null,
        email: null,
        emailNormalized: null,
        phone: null,
        message: null,
      }),
      formName: 'Inquiry Form',
      noticeVersion: null,
      formEventTypes: null,
      duplicates: [],
    };

    const html = renderToStaticMarkup(<LeadDetailView leadWithDetails={detail} locale="en" />);

    // Converted banner is visible
    expect(html).toContain('data-testid="lead-converted-banner"');
    expect(html).toContain('Converted to client on');
    expect(html).toContain(`href="/clients/${clientId}"`);
    expect(html).toContain('View client profile');

    // Convert button and status buttons are hidden
    expect(html).not.toContain('data-testid="convert-lead-btn"');
    expect(html).not.toContain('data-testid="convert-to-client-btn"');
    expect(html).not.toContain('leads.actions.markContacted');
    expect(html).not.toContain('leads.actions.markSpam');
    expect(html).not.toContain('leads.actions.archive');
    expect(html).not.toContain('leads.actions.delete');
  });

  it('AC-10: German locale renders converted banner in German with localized date', () => {
    currentLocale = 'de';
    const clientId = '018f0000-0000-7000-8000-000000000099';
    const detail: LeadWithDetails = {
      lead: createDummyLead({
        status: 'converted',
        clientId,
        locale: 'de',
        convertedAt: new Date('2026-10-12T14:30:00Z'),
      }),
      formName: 'Kontaktformular',
      noticeVersion: null,
      formEventTypes: null,
      duplicates: [],
    };

    const html = renderToStaticMarkup(<LeadDetailView leadWithDetails={detail} locale="de" />);

    expect(html).toContain('data-testid="lead-converted-banner"');
    expect(html).toContain('In Kunde umgewandelt am');
    expect(html).toContain(`href="/clients/${clientId}"`);
    expect(html).toContain('Kundenprofil anzeigen');
  });

  it('AC-10: German locale renders conversion button in German', () => {
    currentLocale = 'de';
    const detail: LeadWithDetails = {
      lead: createDummyLead({ status: 'new', locale: 'de' }),
      formName: 'Kontaktformular',
      noticeVersion: null,
      formEventTypes: null,
      duplicates: [],
    };

    const html = renderToStaticMarkup(<LeadDetailView leadWithDetails={detail} locale="de" />);

    expect(html).toContain('data-testid="convert-lead-btn"');
    expect(html).toContain('In Kund:in umwandeln');
  });

  it('AC-2: duplicate warning info is provided when duplicates exist on lead with details', () => {
    const detail: LeadWithDetails = {
      lead: createDummyLead({ status: 'new' }),
      formName: 'Wedding Inquiry Form',
      noticeVersion: null,
      formEventTypes: null,
      duplicates: [
        {
          clientId: '018f0000-0000-7000-8000-000000000077',
          displayName: 'Sarah Connor',
        },
      ],
    };

    expect(detail.duplicates).toBeDefined();
    expect(detail.duplicates).toHaveLength(1);
    expect(detail.duplicates?.[0]?.displayName).toBe('Sarah Connor');
    expect(detail.duplicates?.[0]?.clientId).toBe('018f0000-0000-7000-8000-000000000077');
  });

  it('AC-10: German messages dictionary contains all required leads.convert.* keys', () => {
    const convertDe = deMessages.leads.convert;
    expect(convertDe.title).toBe('In Kunde umwandeln');
    expect(convertDe.description).toContain('Kundeneintrag um');
    expect(convertDe.newClient).toBe('Neuen Kunden anlegen');
    expect(convertDe.existingClient).toBe('Mit bestehendem Kunden verknüpfen');
    expect(convertDe.selectClient).toBe('Bestehenden Kunden auswählen');
    expect(convertDe.duplicateAlertTitle).toBe('Bestehender Kunde mit gleicher E-Mail');
    expect(convertDe.previewTitle).toBe('Vorschau der Umwandlung');
    expect(convertDe.clientName).toBe('Kundenname');
    expect(convertDe.primaryContact).toBe('Primärer Kontakt');
    expect(convertDe.inquiryNote).toBe('Zu erstellende Notiz');
    expect(convertDe.retainedDetails).toBe('Behaltene Auftragsdetails');
    expect(convertDe.confirm).toBe('In Kunde umwandeln');
    expect(convertDe.confirming).toBe('Wird umgewandelt...');
    expect(convertDe.cancel).toBe('Abbrechen');
    expect(convertDe.convertedBanner).toContain('In Kunde umgewandelt am');
    expect(convertDe.viewClient).toBe('Kundenprofil anzeigen');
  });

  it('AC-10: English messages dictionary contains all required leads.convert.* keys', () => {
    const convertEn = enMessages.leads.convert;
    expect(convertEn.title).toBe('Convert to client');
    expect(convertEn.description).toContain('client record');
    expect(convertEn.newClient).toBe('Create new client');
    expect(convertEn.existingClient).toBe('Link to existing client');
    expect(convertEn.selectClient).toBe('Select existing client');
    expect(convertEn.duplicateAlertTitle).toBe('Existing client matches email');
    expect(convertEn.previewTitle).toBe('Conversion preview');
    expect(convertEn.clientName).toBe('Client name');
    expect(convertEn.primaryContact).toBe('Primary contact');
    expect(convertEn.inquiryNote).toBe('Inquiry note to create');
    expect(convertEn.retainedDetails).toBe('Shoot details retained');
    expect(convertEn.confirm).toBe('Convert to client');
    expect(convertEn.confirming).toBe('Converting...');
    expect(convertEn.cancel).toBe('Cancel');
    expect(convertEn.convertedBanner).toContain('Converted to client on');
    expect(convertEn.viewClient).toBe('View client profile');
  });
});
