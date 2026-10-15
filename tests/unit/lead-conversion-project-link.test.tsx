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
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => {
    const localizedHref =
      href.startsWith('/') && !href.startsWith(`/${currentLocale}`)
        ? `/${currentLocale}${href}`
        : href;
    return (
      <a href={localizedHref} {...props}>
        {children}
      </a>
    );
  },
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

vi.mock('@/server/leads/actions', () => ({
  convertLeadToClientAction: vi.fn(),
  getLeadDuplicatesAction: vi.fn().mockResolvedValue({ success: true, duplicates: [] }),
  changeLeadStatusAction: vi.fn(),
  deleteLeadsAction: vi.fn(),
  exportLeadDsarAction: vi.fn(),
}));

vi.mock('@/server/auth/mfa-actions', () => ({
  reauthenticateAction: vi.fn(),
}));

import { LeadDetailView } from '@/components/leads/lead-detail-view';

function createDummyLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: '018f0000-0000-7000-8000-000000000001',
    formId: '018f0000-0000-7000-8000-000000000002',
    noticeVersionId: '018f0000-0000-7000-8000-000000000003',
    clientId: '018f0000-0000-7000-8000-000000000099',
    status: 'converted',
    verification: 'verified',
    locale: 'en',
    email: null,
    emailNormalized: null,
    givenName: null,
    familyName: null,
    phone: null,
    eventTypeKey: 'wedding',
    eventDate: '2026-06-20',
    eventLocation: 'Berlin, Germany',
    message: null,
    deliveryMode: 'hosted',
    autoReplyStatus: 'sent',
    convertedAt: new Date('2026-10-12T14:30:00Z'),
    receivedAt: new Date('2026-10-10T10:00:00Z'),
    lastActivityAt: new Date('2026-10-10T10:00:00Z'),
    noticeAcknowledgedAt: new Date('2026-10-10T10:00:00Z'),
    createdAt: new Date('2026-10-10T10:00:00Z'),
    updatedAt: new Date('2026-10-10T10:00:00Z'),
    ...overrides,
  };
}

describe('TASK-0037: Lead Conversion Project Link Unit Tests (AC-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentLocale = 'en';
  });

  it('AC-5: Converted banner on /leads/[id] renders link to linked project when present', () => {
    const projectId = '018f0000-0000-7000-8000-000000000077';
    const detail: LeadWithDetails = {
      lead: createDummyLead(),
      formName: 'Inquiry Form',
      noticeVersion: null,
      formEventTypes: null,
      duplicates: [],
      project: {
        id: projectId,
        title: 'Jane Doe - Wedding',
      },
    };

    const html = renderToStaticMarkup(<LeadDetailView leadWithDetails={detail} locale="en" />);

    expect(html).toContain('data-testid="lead-converted-banner"');
    expect(html).toContain('data-testid="converted-project-link"');
    expect(html).toContain(`href="/en/projects/${projectId}"`);
    expect(html).toContain('View project');
  });

  it('AC-5 / AC-7: Renders German project link "Projekt ansehen" when locale is de', () => {
    currentLocale = 'de';
    const projectId = '018f0000-0000-7000-8000-000000000077';
    const detail: LeadWithDetails = {
      lead: createDummyLead(),
      formName: 'Inquiry Form',
      noticeVersion: null,
      formEventTypes: null,
      duplicates: [],
      project: {
        id: projectId,
        title: 'Jane Doe - Wedding',
      },
    };

    const html = renderToStaticMarkup(<LeadDetailView leadWithDetails={detail} locale="de" />);

    expect(html).toContain('data-testid="converted-project-link"');
    expect(html).toContain(`href="/de/projects/${projectId}"`);
    expect(html).toContain('Projekt ansehen');
  });
});
