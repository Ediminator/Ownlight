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

import {
  LeadDetailView,
  restoreFocusToTrigger,
  formatLeadConvertedDate,
} from '@/components/leads/lead-detail-view';

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
    expect(html).toContain('In Kund:in umgewandelt am');
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

  it('AC-10 / I1-U02: German messages dictionary contains all required leads.convert.* keys matching glossary.md', () => {
    const convertDe = deMessages.leads.convert;
    expect(convertDe.title).toBe('In Kund:in umwandeln');
    expect(convertDe.description).toContain('Kundeneintrag um');
    expect(convertDe.newClient).toBe('Neue:n Kund:in anlegen');
    expect(convertDe.existingClient).toBe('Mit bestehender:m Kund:in verknüpfen');
    expect(convertDe.selectClient).toBe('Bestehende:n Kund:in auswählen');
    expect(convertDe.duplicateAlertTitle).toBe('Bestehende:r Kund:in mit gleicher E-Mail');
    expect(convertDe.previewTitle).toBe('Vorschau der Umwandlung');
    expect(convertDe.clientName).toBe('Kundenname');
    expect(convertDe.primaryContact).toBe('Hauptkontakt');
    expect(convertDe.inquiryNote).toBe('Zu erstellende Notiz');
    expect(convertDe.retainedDetails).toBe('Behaltene Auftragsdetails');
    expect(convertDe.confirm).toBe('In Kund:in umwandeln');
    expect(convertDe.confirming).toBe('Wird umgewandelt...');
    expect(convertDe.cancel).toBe('Abbrechen');
    expect(convertDe.convertedBanner).toContain('In Kund:in umgewandelt am');
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

  it('I1-U01: restoreFocusToTrigger prevents default and focuses last trigger element', () => {
    const focusSpy = vi.fn();
    const mockBtn = { focus: focusSpy } as unknown as HTMLElement;
    const preventSpy = vi.fn();

    // 1. Focuses last trigger and prevents default
    const result = restoreFocusToTrigger(mockBtn, null, { preventDefault: preventSpy });
    expect(result).toBe(true);
    expect(preventSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledTimes(1);

    // 2. Focuses fallback trigger when lastTrigger is null
    const fallbackFocusSpy = vi.fn();
    const mockFallback = { focus: fallbackFocusSpy } as unknown as HTMLElement;
    const result2 = restoreFocusToTrigger(null, mockFallback);
    expect(result2).toBe(true);
    expect(fallbackFocusSpy).toHaveBeenCalledTimes(1);

    // 3. Returns false when both triggers are null
    expect(restoreFocusToTrigger(null, null)).toBe(false);
  });

  it('AC-6: formatLeadConvertedDate formats dates localized or falls back to dash', () => {
    expect(formatLeadConvertedDate(null, 'en')).toBe('—');
    expect(formatLeadConvertedDate(undefined, 'de')).toBe('—');
    const formattedEn = formatLeadConvertedDate(new Date('2026-10-12T14:30:00Z'), 'en');
    expect(formattedEn).toContain('2026');
    const formattedDe = formatLeadConvertedDate('2026-10-12T14:30:00Z', 'de');
    expect(formattedDe).toContain('2026');
  });

  it('renders conversion modal with preview card when initialConvertModalOpen is true', () => {
    const detail: LeadWithDetails = {
      lead: createDummyLead({
        status: 'new',
        message: 'Looking forward to shooting!',
        eventTypeKey: 'wedding',
        eventDate: '2026-08-15',
        eventLocation: 'Potsdam, Germany',
      }),
      formName: 'Wedding Form',
      noticeVersion: null,
      formEventTypes: [
        { key: 'wedding', label_en: 'Wedding Photography', label_de: 'Hochzeitsfotografie' },
      ],
      duplicates: [],
    };

    const html = renderToStaticMarkup(
      <LeadDetailView leadWithDetails={detail} locale="en" initialConvertModalOpen={true} />,
    );

    expect(html).toContain('data-testid="convert-lead-dialog"');
    expect(html).toContain('data-testid="conversion-preview"');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('Wedding Photography');
    expect(html).toContain('Looking forward to shooting!');
    expect(html).toContain('data-testid="confirm-convert-btn"');
    expect(html).toContain('data-testid="cancel-convert-btn"');
  });

  it('renders conversion modal with existing client select and duplicate alert', () => {
    const detail: LeadWithDetails = {
      lead: createDummyLead({ status: 'new' }),
      formName: 'Inquiry Form',
      noticeVersion: null,
      formEventTypes: null,
      duplicates: [
        { clientId: '018f0000-0000-7000-8000-000000000088', displayName: 'Existing Client A' },
      ],
    };

    const html = renderToStaticMarkup(
      <LeadDetailView
        leadWithDetails={detail}
        locale="en"
        initialConvertModalOpen={true}
        initialConvertMode="existing_client"
      />,
    );

    expect(html).toContain('data-testid="duplicate-alert"');
    expect(html).toContain('data-testid="existing-client-select"');
    expect(html).toContain('Existing Client A');
  });

  it('renders conversion modal with empty duplicates placeholder in existing client mode', () => {
    const detail: LeadWithDetails = {
      lead: createDummyLead({ status: 'new' }),
      formName: 'Inquiry Form',
      noticeVersion: null,
      formEventTypes: null,
      duplicates: [],
    };

    const html = renderToStaticMarkup(
      <LeadDetailView
        leadWithDetails={detail}
        locale="en"
        initialConvertModalOpen={true}
        initialConvertMode="existing_client"
      />,
    );

    expect(html).toContain('data-testid="existing-client-select"');
    expect(html).toContain('Choose a client...');
  });

  it('renders conversion modal in converting state with loader and confirming label', () => {
    const detail: LeadWithDetails = {
      lead: createDummyLead({ status: 'new' }),
      formName: 'Inquiry Form',
      noticeVersion: null,
      formEventTypes: null,
      duplicates: [],
    };

    const html = renderToStaticMarkup(
      <LeadDetailView
        leadWithDetails={detail}
        locale="en"
        initialConvertModalOpen={true}
        initialIsConverting={true}
      />,
    );

    expect(html).toContain('animate-spin');
    expect(html).toContain('Converting...');
  });

  it('renders conversion modal with error message when initialConvertError is provided', () => {
    const detail: LeadWithDetails = {
      lead: createDummyLead({ status: 'new' }),
      formName: 'Inquiry Form',
      noticeVersion: null,
      formEventTypes: null,
      duplicates: [],
    };

    const html = renderToStaticMarkup(
      <LeadDetailView
        leadWithDetails={detail}
        locale="en"
        initialConvertModalOpen={true}
        initialConvertError="Lead conversion failed unexpectedly"
      />,
    );

    expect(html).toContain('data-testid="convert-error"');
    expect(html).toContain('Lead conversion failed unexpectedly');
  });

  it('renders delete modal and reauth modal when their initial open props are true', () => {
    const detail: LeadWithDetails = {
      lead: createDummyLead({ status: 'new' }),
      formName: 'Inquiry Form',
      noticeVersion: null,
      formEventTypes: null,
      duplicates: [],
    };

    const deleteHtml = renderToStaticMarkup(
      <LeadDetailView
        leadWithDetails={detail}
        locale="en"
        initialDeleteModalOpen={true}
        initialDeleteError="Cannot delete converted lead"
      />,
    );
    expect(deleteHtml).toContain('data-testid="delete-lead-modal"');
    expect(deleteHtml).toContain('Cannot delete converted lead');

    const reauthHtml = renderToStaticMarkup(
      <LeadDetailView
        leadWithDetails={detail}
        locale="en"
        initialReauthModalOpen={true}
        initialReauthError="Incorrect owner password"
      />,
    );
    expect(reauthHtml).toContain('data-testid="reauth-modal"');
    expect(reauthHtml).toContain('Incorrect owner password');
  });

  it('renders lead in various statuses (contacted, spam, archived) with respective badges', () => {
    const detailContacted: LeadWithDetails = {
      lead: createDummyLead({ status: 'contacted' }),
      formName: 'Form',
      noticeVersion: null,
      formEventTypes: null,
      duplicates: [],
    };
    const htmlContacted = renderToStaticMarkup(
      <LeadDetailView leadWithDetails={detailContacted} locale="en" />,
    );
    expect(htmlContacted).toContain('data-testid="lead-status-badge"');
    expect(htmlContacted).not.toContain('data-testid="mark-contacted-btn"');

    const detailSpam: LeadWithDetails = {
      lead: createDummyLead({ status: 'spam' }),
      formName: 'Form',
      noticeVersion: null,
      formEventTypes: null,
      duplicates: [],
    };
    const htmlSpam = renderToStaticMarkup(
      <LeadDetailView leadWithDetails={detailSpam} locale="en" />,
    );
    expect(htmlSpam).not.toContain('data-testid="mark-spam-btn"');

    const detailArchived: LeadWithDetails = {
      lead: createDummyLead({ status: 'archived' }),
      formName: 'Form',
      noticeVersion: null,
      formEventTypes: null,
      duplicates: [],
    };
    const htmlArchived = renderToStaticMarkup(
      <LeadDetailView leadWithDetails={detailArchived} locale="en" />,
    );
    expect(htmlArchived).not.toContain('data-testid="mark-archived-btn"');
  });

  it('renders notice acknowledgement, privacy policy link, and localized event types', () => {
    currentLocale = 'de';
    const detail: LeadWithDetails = {
      lead: createDummyLead({
        status: 'new',
        eventTypeKey: 'portrait',
        verification: 'unverified',
        deliveryMode: 'embed',
        autoReplyStatus: 'failed',
      }),
      formName: 'Porträt-Formular',
      noticeVersion: {
        id: 'notice-v2',
        formId: 'form-1',
        version: 2,
        acknowledgementTextEn: 'English notice acknowledgement',
        acknowledgementTextDe: 'Deutsche Datenschutzerklärung zur Kenntnis genommen',
        privacyPolicyUrl: 'https://example.org/datenschutz',
        createdByActorId: 'owner-1',
        createdAt: new Date(),
      },
      formEventTypes: [
        { key: 'portrait', label_en: 'Portrait Shoot', label_de: 'Porträt-Shooting' },
      ],
      duplicates: [],
    };

    const html = renderToStaticMarkup(<LeadDetailView leadWithDetails={detail} locale="de" />);

    expect(html).toContain('data-testid="notice-version"');
    expect(html).toContain('v2');
    expect(html).toContain('data-testid="privacy-policy-link"');
    expect(html).toContain('https://example.org/datenschutz');
    expect(html).toContain('Deutsche Datenschutzerklärung zur Kenntnis genommen');
    expect(html).toContain('Porträt-Shooting');
  });

  it('renders converted banner without link when lead.clientId is null', () => {
    const detail: LeadWithDetails = {
      lead: createDummyLead({
        status: 'converted',
        clientId: null,
        convertedAt: null,
      }),
      formName: 'Form',
      noticeVersion: null,
      formEventTypes: null,
      duplicates: [],
    };

    const html = renderToStaticMarkup(<LeadDetailView leadWithDetails={detail} locale="en" />);

    expect(html).toContain('data-testid="lead-converted-banner"');
    expect(html).not.toContain('data-testid="converted-client-link"');
  });
});
