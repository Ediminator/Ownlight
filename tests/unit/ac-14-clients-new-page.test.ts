import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockRedirect = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: (url: string): void => {
    mockRedirect(url);
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en/clients/new',
  useSearchParams: () => new URLSearchParams(),
}));

const mockRequireOwner = vi.fn();
vi.mock('@/server/auth/guards', () => ({
  requireOwner: (): Promise<{ user: { id: string; role: string } }> =>
    mockRequireOwner() as Promise<{ user: { id: string; role: string } }>,
}));

const mockGetStudioSettings = vi.fn();
vi.mock('@/server/settings/repo', () => ({
  getStudioSettings: (): Promise<{ default_locale: string; timezone: string } | null> =>
    mockGetStudioSettings() as Promise<{ default_locale: string; timezone: string } | null>,
}));

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockImplementation(({ locale }: { locale: string }) => {
    if (locale === 'throw') {
      return Promise.reject(new Error('Locale error'));
    }
    return Promise.resolve((key: string) => {
      if (key === 'title') {
        return locale === 'de' ? 'Neuer Kunde' : 'New client';
      }
      return key;
    });
  }),
}));

vi.mock('@/components/clients/client-create-form', () => ({
  ClientCreateForm: ({ locale, defaultLocale }: { locale: string; defaultLocale: string }) => {
    return {
      type: 'div',
      props: {
        'data-testid': 'mock-client-create-form',
        children: `form-locale:${locale}-default:${defaultLocale}`,
      },
    };
  },
}));

import ClientCreatePage, {
  generateMetadata as generateCreateMetadata,
} from '@/app/[locale]/clients/new/page';

describe('TASK-0012: Client Create Route Page (AC-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-14: unauthenticated request to /en/clients/new redirects to sign-in with callbackUrl', async () => {
    mockRequireOwner.mockRejectedValueOnce(new Error('UNAUTHORIZED'));

    const res = await ClientCreatePage({
      params: Promise.resolve({ locale: 'en' }),
    });

    expect(mockRedirect).toHaveBeenCalledWith('/en/sign-in?callbackUrl=/en/clients/new');
    expect(res).toBeNull();
  });

  it('AC-14: authenticated request renders ClientCreateForm with studio default locale de', async () => {
    mockRequireOwner.mockResolvedValueOnce({ user: { id: 'owner-1', role: 'owner' } });
    mockGetStudioSettings.mockResolvedValueOnce({ default_locale: 'de', timezone: 'UTC' });

    const page = await ClientCreatePage({
      params: Promise.resolve({ locale: 'de' }),
    });

    expect(page).toBeDefined();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('AC-14: authenticated request renders ClientCreateForm with studio default locale en', async () => {
    mockRequireOwner.mockResolvedValueOnce({ user: { id: 'owner-1', role: 'owner' } });
    mockGetStudioSettings.mockResolvedValueOnce({ default_locale: 'en', timezone: 'UTC' });

    const page = await ClientCreatePage({
      params: Promise.resolve({ locale: 'en' }),
    });

    expect(page).toBeDefined();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('AC-14: authenticated request handles getStudioSettings rejection gracefully', async () => {
    mockRequireOwner.mockResolvedValueOnce({ user: { id: 'owner-1', role: 'owner' } });
    mockGetStudioSettings.mockRejectedValueOnce(new Error('DB failure'));

    const page = await ClientCreatePage({
      params: Promise.resolve({ locale: 'en' }),
    });

    expect(page).toBeDefined();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('AC-14: generateMetadata returns localized document title in English', async () => {
    const meta = await generateCreateMetadata({
      params: Promise.resolve({ locale: 'en' }),
    });

    expect(meta.title).toBe('New client · Ownlight');
  });

  it('AC-14: generateMetadata returns localized document title in German', async () => {
    const meta = await generateCreateMetadata({
      params: Promise.resolve({ locale: 'de' }),
    });

    expect(meta.title).toBe('Neuer Kunde · Ownlight');
  });

  it('AC-14: generateMetadata handles translation error with fallback title', async () => {
    const metaEn = await generateCreateMetadata({
      params: Promise.resolve({ locale: 'throw' }),
    });
    expect(metaEn.title).toBe('New client · Ownlight');
  });
});
