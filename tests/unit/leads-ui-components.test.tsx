import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Lead } from '@/server/db/schema/leads';
import type { LeadCounts } from '@/server/leads/schema';
import type { LeadWithDetails } from '@/server/leads/service';

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
  usePathname: () => '/en/leads',
}));

vi.mock('next-intl', () => ({
  useTranslations: (section?: string) => (key: string, values?: Record<string, unknown>) => {
    return `${section ? `${section}.` : ''}${key}${values ? JSON.stringify(values) : ''}`;
  },
  useLocale: () => 'en',
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
  usePathname: () => '/en/leads',
}));

const mockChangeLeadStatusAction = vi.fn();
const mockDeleteLeadsAction = vi.fn();
const mockExportLeadDsarAction = vi.fn();
const mockReauthenticateAction = vi.fn();

vi.mock('@/server/leads/actions', () => ({
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

import { LeadInbox } from '@/components/leads/lead-inbox';
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

const dummyCounts: LeadCounts = {
  all: 5,
  new: 2,
  contacted: 1,
  converted: 1,
  archived: 0,
  spam: 1,
};

describe('LeadInbox Component (Unit Tests)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders lead inbox with table and status tabs', () => {
    const leads = [
      createDummyLead({ id: 'lead-1', status: 'new', verification: 'verified' }),
      createDummyLead({
        id: 'lead-2',
        status: 'contacted',
        verification: 'unverified',
        email: 'contacted@example.org',
      }),
      createDummyLead({
        id: 'lead-3',
        status: 'converted',
        clientId: '018f0000-0000-7000-8000-000000000099',
      }),
      createDummyLead({ id: 'lead-4', status: 'spam' }),
      createDummyLead({ id: 'lead-5', status: 'archived' }),
    ];

    const html = renderToStaticMarkup(
      <LeadInbox
        initialLeads={leads}
        initialCounts={dummyCounts}
        locale="en"
        initialStatus="all"
        initialEmailQuery=""
        initialPage={1}
        hasMore={true}
      />,
    );

    expect(html).toContain('leads.title');
    expect(html).toContain('leads.tabs.all');
    expect(html).toContain('leads.tabs.new');
    expect(html).toContain('leads.tabs.contacted');
    expect(html).toContain('leads.tabs.converted');
    expect(html).toContain('leads.tabs.archived');
    expect(html).toContain('leads.tabs.spam');

    expect(html).toContain('client@example.org');
    expect(html).toContain('contacted@example.org');
    expect(html).toContain('leads.verification.verified');
    expect(html).toContain('leads.verification.unverified');
    expect(html).toContain('leads.pagination.next');
    expect(html).toContain('leads.pagination.prev');
  });

  it('renders empty state when leads list is empty', () => {
    const html = renderToStaticMarkup(
      <LeadInbox
        initialLeads={[]}
        initialCounts={{ all: 0, new: 0, contacted: 0, converted: 0, archived: 0, spam: 0 }}
        locale="en"
        initialStatus="new"
      />,
    );

    expect(html).toContain('leads.table.emptyFilter');
  });

  it('renders spam shortcut button when on spam tab', () => {
    const html = renderToStaticMarkup(
      <LeadInbox
        initialLeads={[createDummyLead({ id: 'lead-spam', status: 'spam' })]}
        initialCounts={dummyCounts}
        locale="en"
        initialStatus="spam"
      />,
    );

    expect(html).toContain('leads.bulk.deleteAllSpam');
  });

  it('renders German copy when locale is de', () => {
    const html = renderToStaticMarkup(
      <LeadInbox
        initialLeads={[createDummyLead()]}
        initialCounts={dummyCounts}
        locale="de"
        initialStatus="all"
      />,
    );

    expect(html).toContain('leads.title');
  });
});

describe('LeadDetailView Component (Unit Tests)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders lead detail view with contact card, shoot card, message card, and compliance card', () => {
    const detail: LeadWithDetails = {
      lead: createDummyLead({
        givenName: 'Alice',
        familyName: 'Smith',
        email: 'alice@example.org',
        phone: '+49 30 987654',
        eventTypeKey: 'elopement',
        eventDate: '2026-08-15',
        eventLocation: 'Potsdam',
        message: 'Can we book sunset photos? <script>alert(1)</script>',
      }),
      formName: 'Summer Weddings Form',
      noticeVersion: {
        id: 'notice-v1',
        formId: 'form-1',
        version: 1,
        acknowledgementTextEn: 'I acknowledge the privacy notice.',
        acknowledgementTextDe: 'Ich nehme die Datenschutzerklärung zur Kenntnis.',
        privacyPolicyUrl: 'https://example.org/privacy',
        createdByActorId: 'actor-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      formEventTypes: [
        { key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' },
        { key: 'elopement', label_en: 'Elopement', label_de: 'Elopement' },
      ],
    };

    const html = renderToStaticMarkup(<LeadDetailView leadWithDetails={detail} locale="en" />);

    expect(html).toContain('Alice Smith');
    expect(html).toContain('alice@example.org');
    expect(html).toContain('+49 30 987654');
    expect(html).toContain('2026-08-15');
    expect(html).toContain('Potsdam');
    expect(html).toContain('Summer Weddings Form');
    expect(html).toContain('leads.detail.discretionNotice');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('leads.actions.exportDsar');
    expect(html).toContain('leads.actions.markContacted');
    expect(html).toContain('leads.actions.markSpam');
    expect(html).toContain('leads.actions.archive');
    expect(html).toContain('leads.actions.delete');
    expect(html).toContain('I acknowledge the privacy notice.');
  });

  it('renders converted status badge when lead is converted', () => {
    const detail: LeadWithDetails = {
      lead: createDummyLead({
        status: 'converted',
        clientId: '018f0000-0000-7000-8000-000000000088',
        convertedAt: new Date('2026-10-11T12:00:00Z'),
      }),
      formName: 'General Form',
      noticeVersion: null,
      formEventTypes: null,
    };

    const html = renderToStaticMarkup(<LeadDetailView leadWithDetails={detail} locale="en" />);

    expect(html).toContain('leads.status.converted');
  });

  it('renders German notice text when locale is de', () => {
    const detail: LeadWithDetails = {
      lead: createDummyLead({ locale: 'de' }),
      formName: 'Kontaktformular',
      noticeVersion: {
        id: 'notice-v2',
        formId: 'form-1',
        version: 2,
        acknowledgementTextEn: 'English notice',
        acknowledgementTextDe: 'Deutscher Hinweis zur Datenverarbeitung.',
        privacyPolicyUrl: 'https://example.org/datenschutz',
        createdByActorId: 'actor-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      formEventTypes: null,
    };

    const html = renderToStaticMarkup(<LeadDetailView leadWithDetails={detail} locale="de" />);

    expect(html).toContain('Deutscher Hinweis zur Datenverarbeitung.');
  });

  it('renders default notSpecified values when optional shoot and message fields are missing', () => {
    const detail: LeadWithDetails = {
      lead: createDummyLead({
        eventDate: null,
        eventLocation: null,
        eventTypeKey: null,
        message: null,
        phone: null,
      }),
      formName: null,
      noticeVersion: null,
      formEventTypes: null,
    };

    const html = renderToStaticMarkup(<LeadDetailView leadWithDetails={detail} locale="en" />);
    expect(html).toContain('leads.detail.notSpecified');
  });

  it('omits current status action button when lead already has that status', () => {
    const contactedDetail: LeadWithDetails = {
      lead: createDummyLead({ status: 'contacted' }),
      formName: 'Form',
      noticeVersion: null,
      formEventTypes: null,
    };
    const contactedHtml = renderToStaticMarkup(
      <LeadDetailView leadWithDetails={contactedDetail} locale="en" />,
    );
    expect(contactedHtml).not.toContain('leads.actions.markContacted');
    expect(contactedHtml).toContain('leads.actions.markSpam');

    const spamDetail: LeadWithDetails = {
      lead: createDummyLead({ status: 'spam' }),
      formName: 'Form',
      noticeVersion: null,
      formEventTypes: null,
    };
    const spamHtml = renderToStaticMarkup(
      <LeadDetailView leadWithDetails={spamDetail} locale="en" />,
    );
    expect(spamHtml).not.toContain('leads.actions.markSpam');

    const archivedDetail: LeadWithDetails = {
      lead: createDummyLead({ status: 'archived' }),
      formName: 'Form',
      noticeVersion: null,
      formEventTypes: null,
    };
    const archivedHtml = renderToStaticMarkup(
      <LeadDetailView leadWithDetails={archivedDetail} locale="en" />,
    );
    expect(archivedHtml).not.toContain('leads.actions.archive');
  });
});
