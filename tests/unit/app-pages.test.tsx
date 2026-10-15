import { describe, it, expect, vi } from 'vitest';
import React from 'react';

vi.mock('server-only', () => ({}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `translated-${key}`,
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi
    .fn()
    .mockImplementation(() => Promise.resolve((key: string) => `translated-${key}`)),
}));

import LeadsPage from '@/app/[locale]/leads/page';
import ClientsPage from '@/app/[locale]/clients/page';
import ProjectsPage, {
  generateMetadata as generateProjectsMetadata,
} from '@/app/[locale]/projects/page';
import CalendarPage from '@/app/[locale]/calendar/page';
import SettingsPage from '@/app/[locale]/settings/page';
import SignInPage from '@/app/[locale]/sign-in/page';
import ForgotPasswordPage from '@/app/[locale]/forgot-password/page';
import ResetPasswordPage from '@/app/[locale]/reset-password/page';
import VerifyEmailPage from '@/app/[locale]/verify-email/page';
import SetupPage from '@/app/[locale]/setup/page';
import { isSetupAvailable } from '@/server/auth/setup';

vi.mock('@/server/auth/setup', () => ({
  isSetupAvailable: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => ({ get: () => null }),
  notFound: vi.fn(),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

import ClientProfilePage from '@/app/[locale]/clients/[clientId]/page';

vi.mock('@/server/auth/guards', () => ({
  requireOwner: vi.fn().mockResolvedValue({ user: { id: 'owner-1', role: 'owner' } }),
}));

vi.mock('@/server/clients/service', () => ({
  getClientList: vi.fn().mockResolvedValue({
    success: true,
    data: { items: [], total: 0, page: 1, pageSize: 25 },
  }),
  listTags: vi.fn().mockResolvedValue({
    success: true,
    data: [],
  }),
  getClient: vi.fn().mockResolvedValue({
    success: true,
    data: {
      client: {
        id: '018f0000-0000-7000-8000-000000000001',
        kind: 'person',
        displayName: 'Test Client',
        preferredLocale: 'en',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      },
      contacts: [],
      addresses: [],
      tags: [],
    },
  }),
}));

vi.mock('@/server/settings/repo', () => ({
  getStudioSettings: vi.fn().mockResolvedValue({ timezone: 'UTC' }),
}));

vi.mock('@/server/leads/service', () => ({
  getLeadCounts: vi.fn().mockResolvedValue({
    all: 0,
    new: 0,
    contacted: 0,
    converted: 0,
    archived: 0,
    spam: 0,
  }),
  listLeads: vi.fn().mockResolvedValue({
    leads: [],
    nextCursor: null,
    hasMore: false,
  }),
}));

vi.mock('@/server/projects/service', () => ({
  getKanbanBoardData: vi.fn().mockResolvedValue({
    stages: [],
    projects: [],
  }),
}));

describe('App placeholder and auth pages', () => {
  it('renders LeadsPage component', async () => {
    const el = await LeadsPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders ClientsPage component', async () => {
    const el = await ClientsPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders ClientProfilePage component', async () => {
    const el = await ClientProfilePage({
      params: Promise.resolve({
        locale: 'en',
        clientId: '018f0000-0000-7000-8000-000000000001',
      }),
    });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders ProjectsPage component in default board view', async () => {
    const el = await ProjectsPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders ProjectsPage component in list view', async () => {
    const el = await ProjectsPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ view: 'list' }),
    });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders ProjectsPage in German locale with list view and fallback translations', async () => {
    const { getTranslations } = await import('next-intl/server');
    vi.mocked(getTranslations).mockRejectedValueOnce(new Error('Translation error'));

    const el = await ProjectsPage({
      params: Promise.resolve({ locale: 'de' }),
      searchParams: Promise.resolve({ view: 'list' }),
    });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders ProjectsPage in English locale with fallback translations', async () => {
    const { getTranslations } = await import('next-intl/server');
    vi.mocked(getTranslations).mockRejectedValueOnce(new Error('Translation error'));

    const el = await ProjectsPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ view: 'board' }),
    });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders ProjectsPage with loaded clients and handles getClientList failure', async () => {
    const { getClientList } = await import('@/server/clients/service');
    vi.mocked(getClientList).mockResolvedValueOnce({
      success: true,
      data: {
        items: [
          {
            id: 'client-1',
            displayName: 'Client A',
          } as unknown as import('@/server/clients/repo').ClientListItem,
        ],
        total: 1,
        page: 1,
        pageSize: 100,
      },
    });

    const elWithClients = await ProjectsPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    expect(React.isValidElement(elWithClients)).toBe(true);

    vi.mocked(getClientList).mockResolvedValueOnce({
      success: false,
      error: 'Failed to fetch clients',
    } as unknown as Awaited<ReturnType<typeof getClientList>>);

    const elFailed = await ProjectsPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    expect(React.isValidElement(elFailed)).toBe(true);
  });

  it('redirects unauthenticated users to sign-in on ProjectsPage', async () => {
    const { requireOwner } = await import('@/server/auth/guards');
    const { redirect } = await import('next/navigation');
    vi.mocked(requireOwner).mockRejectedValueOnce(new Error('Unauthorized'));

    const el = await ProjectsPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    expect(el).toBeNull();
    expect(redirect).toHaveBeenCalledWith('/en/sign-in?callbackUrl=/en/projects');
  });

  it('generates metadata for ProjectsPage', async () => {
    const metaEn = await generateProjectsMetadata({
      params: Promise.resolve({ locale: 'en' }),
    });
    expect(metaEn.title).toBeDefined();

    const { getTranslations } = await import('next-intl/server');
    vi.mocked(getTranslations).mockRejectedValueOnce(new Error('Metadata translation fail'));
    const metaDeFallback = await generateProjectsMetadata({
      params: Promise.resolve({ locale: 'de' }),
    });
    expect(metaDeFallback.title).toBe('Projekte & Pipeline · Ownlight');

    vi.mocked(getTranslations).mockRejectedValueOnce(new Error('Metadata translation fail en'));
    const metaEnFallback = await generateProjectsMetadata({
      params: Promise.resolve({ locale: 'en' }),
    });
    expect(metaEnFallback.title).toBe('Projects & Pipeline · Ownlight');
  });

  it('renders CalendarPage component', () => {
    const el = CalendarPage();
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders SettingsPage component', () => {
    const el = SettingsPage();
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders SignInPage component', async () => {
    const el = await SignInPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders ForgotPasswordPage component', async () => {
    const el = await ForgotPasswordPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders ResetPasswordPage component', async () => {
    const el = await ResetPasswordPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders VerifyEmailPage component', async () => {
    const el = await VerifyEmailPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders SetupPage component when setup is available', async () => {
    vi.mocked(isSetupAvailable).mockResolvedValueOnce(true);
    const el = await SetupPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('calls notFound in SetupPage when setup is disabled', async () => {
    vi.mocked(isSetupAvailable).mockResolvedValueOnce(false);
    const { notFound } = await import('next/navigation');
    await SetupPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(notFound).toHaveBeenCalled();
  });
});
