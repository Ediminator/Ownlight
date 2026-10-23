import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CalendarFeed } from '@/server/db/schema/calendar';
import {
  buildFeedSubscriptionUrl,
  isTokenMasked,
  formatLastAccessedDate,
  SUMMARY_LEVEL_OPTIONS,
} from '@/components/calendar/settings/feed-settings-helpers';

vi.mock('server-only', () => ({}));

const mockRedirect = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: vi.fn(),
}));

const mockGetTranslations = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock('next-intl/server', () => ({
  getTranslations: async (...args: unknown[]): Promise<unknown> => {
    return await mockGetTranslations(...args);
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: (section?: string) => (key: string, values?: Record<string, unknown>) => {
    return `${section ? `${section}.` : ''}${key}${values ? JSON.stringify(values) : ''}`;
  },
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
}));

const mockRequireOwner = vi.fn<() => Promise<unknown>>();
vi.mock('@/server/auth/guards', () => ({
  requireOwner: async (): Promise<unknown> => {
    return await mockRequireOwner();
  },
}));

const mockGetOrCreateActiveFeed = vi.fn<(userId: string) => Promise<unknown>>();
vi.mock('@/server/calendar/service', () => ({
  getOrCreateActiveFeed: async (userId: string): Promise<unknown> => {
    return await mockGetOrCreateActiveFeed(userId);
  },
}));

vi.mock('@/server/calendar/feed-actions', () => ({
  revokeFeedTokenAction: vi.fn().mockResolvedValue({ success: true }),
  updateFeedSummaryLevelAction: vi.fn().mockResolvedValue({ success: true }),
}));

import { CalendarFeedView } from '@/components/calendar/settings/calendar-feed-view';
import CalendarSettingsRootPage from '@/app/[locale]/settings/calendar/page';
import CalendarFeedPage, {
  generateMetadata as generateFeedMetadata,
} from '@/app/[locale]/settings/calendar/feed/page';

describe('TASK-0045: Calendar Feed Settings Helpers & Components', () => {
  const dummyFeed: CalendarFeed = {
    id: '01920000-0000-7000-8000-000000000001',
    name: 'Default Feed',
    tokenHash: 'synthetic-token-hash-hex-value-64-characters-0123456789abcdef01234567',
    summaryLevel: 'standard',
    isActive: true,
    lastAccessedAt: new Date('2026-10-23T14:30:00Z'),
    revokedAt: null,
    createdAt: new Date('2026-10-20T10:00:00Z'),
    updatedAt: new Date('2026-10-20T10:00:00Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('feed-settings-helpers.ts', () => {
    it('AC-10: buildFeedSubscriptionUrl builds full https url when token is provided', () => {
      const syntheticTokenValue = 'sample_raw_feed_token_value_32chars';
      const url = buildFeedSubscriptionUrl('https://studio.example.com', syntheticTokenValue);
      expect(url).toBe(`https://studio.example.com/api/calendar/feed/${syntheticTokenValue}.ics`);
    });

    it('AC-10: buildFeedSubscriptionUrl handles trailing slashes in origin', () => {
      const syntheticTokenValue = 'sample_raw_feed_token_value_32chars';
      const url = buildFeedSubscriptionUrl('https://studio.example.com///', syntheticTokenValue);
      expect(url).toBe(`https://studio.example.com/api/calendar/feed/${syntheticTokenValue}.ics`);
    });

    it('AC-10: buildFeedSubscriptionUrl returns masked placeholder when token is null or undefined', () => {
      const maskedUrl = buildFeedSubscriptionUrl('https://studio.example.com', null);
      expect(maskedUrl).toContain(
        '/api/calendar/feed/•••••••••••••••••••••••••••••••••••••••••••.ics',
      );
      expect(isTokenMasked(maskedUrl)).toBe(true);

      const unmaskedUrl = buildFeedSubscriptionUrl('https://studio.example.com', 'raw-token');
      expect(isTokenMasked(unmaskedUrl)).toBe(false);
    });

    it('AC-10: buildFeedSubscriptionUrl handles empty origin', () => {
      const syntheticTokenValue = 'sample_raw_feed_token_value_32chars';
      const url = buildFeedSubscriptionUrl('', syntheticTokenValue);
      expect(url).toBe(`/api/calendar/feed/${syntheticTokenValue}.ics`);
    });

    it('AC-10: formatLastAccessedDate formats dates in en and de locales and returns null for invalid dates', () => {
      expect(formatLastAccessedDate(null, 'en')).toBeNull();
      expect(formatLastAccessedDate(undefined, 'en')).toBeNull();
      expect(formatLastAccessedDate('not-a-valid-date', 'en')).toBeNull();

      const sampleDate = new Date('2026-10-23T14:30:00Z');
      const formattedEn = formatLastAccessedDate(sampleDate, 'en');
      expect(formattedEn).toBeTruthy();
      expect(typeof formattedEn).toBe('string');

      const formattedDe = formatLastAccessedDate(sampleDate.toISOString(), 'de');
      expect(formattedDe).toBeTruthy();
      expect(typeof formattedDe).toBe('string');
    });

    it('AC-11: SUMMARY_LEVEL_OPTIONS defines minimal, standard, and full levels', () => {
      expect(SUMMARY_LEVEL_OPTIONS).toHaveLength(3);
      expect(SUMMARY_LEVEL_OPTIONS.map((opt) => opt.level)).toEqual([
        'minimal',
        'standard',
        'full',
      ]);
    });
  });

  describe('CalendarFeedView (Static Render)', () => {
    it('AC-10: renders active feed with token, copy button, and level options', () => {
      const syntheticTokenValue = 'sample_raw_feed_token_value_32chars';
      const html = renderToStaticMarkup(
        <CalendarFeedView initialFeed={dummyFeed} initialToken={syntheticTokenValue} locale="en" />,
      );

      expect(html).toContain('settings.calendarFeed.title');
      expect(html).toContain('data-testid="feed-url-input"');
      expect(html).toContain('data-testid="copy-feed-url-button"');
      expect(html).toContain('data-testid="revoke-feed-button"');
      expect(html).toContain('settings.calendarFeed.urlSection.statusActive');
      expect(html).toContain('settings.calendarFeed.summaryLevelSection.minimalLabel');
      expect(html).toContain('settings.calendarFeed.summaryLevelSection.standardLabel');
      expect(html).toContain('settings.calendarFeed.summaryLevelSection.fullLabel');
      expect(html).toContain('settings.calendarFeed.instructions.appleTitle');
    });

    it('AC-10: renders masked token notice when initialToken is null', () => {
      const html = renderToStaticMarkup(
        <CalendarFeedView initialFeed={dummyFeed} initialToken={null} locale="de" />,
      );

      expect(html).toContain('settings.calendarFeed.urlSection.tokenHiddenNotice');
    });

    it('AC-12: renders revoked status badge when feed is inactive', () => {
      const revokedFeed: CalendarFeed = {
        ...dummyFeed,
        isActive: false,
        revokedAt: new Date('2026-10-23T12:00:00Z'),
      };

      const html = renderToStaticMarkup(
        <CalendarFeedView initialFeed={revokedFeed} initialToken={null} locale="en" />,
      );

      expect(html).toContain('settings.calendarFeed.urlSection.statusRevoked');
    });

    it('AC-10: renders never accessed message when lastAccessedAt is null', () => {
      const neverAccessedFeed: CalendarFeed = {
        ...dummyFeed,
        lastAccessedAt: null,
      };

      const html = renderToStaticMarkup(
        <CalendarFeedView initialFeed={neverAccessedFeed} initialToken="some-token" locale="en" />,
      );

      expect(html).toContain('settings.calendarFeed.urlSection.neverAccessed');
    });
  });

  describe('CalendarSettingsRootPage (app/[locale]/settings/calendar/page.tsx)', () => {
    it('redirects availability, schedules, and overrides query tabs to /settings/calendar/availability', async () => {
      await expect(
        CalendarSettingsRootPage({
          params: Promise.resolve({ locale: 'en' }),
          searchParams: Promise.resolve({ tab: 'availability' }),
        }),
      ).rejects.toThrow('REDIRECT:/en/settings/calendar/availability');
      expect(mockRedirect).toHaveBeenCalledWith('/en/settings/calendar/availability');

      mockRedirect.mockClear();
      await expect(
        CalendarSettingsRootPage({
          params: Promise.resolve({ locale: 'de' }),
          searchParams: Promise.resolve({ tab: 'schedules' }),
        }),
      ).rejects.toThrow('REDIRECT:/de/settings/calendar/availability');
      expect(mockRedirect).toHaveBeenCalledWith('/de/settings/calendar/availability');

      mockRedirect.mockClear();
      await expect(
        CalendarSettingsRootPage({
          params: Promise.resolve({ locale: 'en' }),
          searchParams: Promise.resolve({ tab: 'overrides' }),
        }),
      ).rejects.toThrow('REDIRECT:/en/settings/calendar/availability');
      expect(mockRedirect).toHaveBeenCalledWith('/en/settings/calendar/availability');
    });

    it('redirects feed or default query tab to /settings/calendar/feed', async () => {
      await expect(
        CalendarSettingsRootPage({
          params: Promise.resolve({ locale: 'en' }),
          searchParams: Promise.resolve({ tab: 'feed' }),
        }),
      ).rejects.toThrow('REDIRECT:/en/settings/calendar/feed');
      expect(mockRedirect).toHaveBeenCalledWith('/en/settings/calendar/feed');

      mockRedirect.mockClear();
      await expect(
        CalendarSettingsRootPage({
          params: Promise.resolve({ locale: 'de' }),
        }),
      ).rejects.toThrow('REDIRECT:/de/settings/calendar/feed');
      expect(mockRedirect).toHaveBeenCalledWith('/de/settings/calendar/feed');
    });
  });

  describe('CalendarFeedPage & generateMetadata (app/[locale]/settings/calendar/feed/page.tsx)', () => {
    it('generateFeedMetadata resolves localized title from getTranslations', async () => {
      mockGetTranslations.mockResolvedValueOnce((key: string) => `translated-${key}`);
      const meta = await generateFeedMetadata({
        params: Promise.resolve({ locale: 'en' }),
      });
      expect(meta.title).toBe('translated-title · Ownlight');
    });

    it('generateFeedMetadata uses fallback titles when getTranslations throws', async () => {
      mockGetTranslations.mockRejectedValueOnce(new Error('Translations error'));
      const metaDe = await generateFeedMetadata({
        params: Promise.resolve({ locale: 'de' }),
      });
      expect(metaDe.title).toBe('Kalender-Feed-Abonnement · Ownlight');

      mockGetTranslations.mockRejectedValueOnce(new Error('Translations error'));
      const metaEn = await generateFeedMetadata({
        params: Promise.resolve({ locale: 'en' }),
      });
      expect(metaEn.title).toBe('Calendar Feed Subscription · Ownlight');
    });

    it('redirects unauthenticated users to sign-in page', async () => {
      mockRequireOwner.mockRejectedValueOnce(new Error('UNAUTHENTICATED'));

      await expect(
        CalendarFeedPage({
          params: Promise.resolve({ locale: 'de' }),
        }),
      ).rejects.toThrow('REDIRECT:/de/sign-in?callbackUrl=/de/settings/calendar/feed');
      expect(mockRedirect).toHaveBeenCalledWith(
        '/de/sign-in?callbackUrl=/de/settings/calendar/feed',
      );
    });

    it('renders CalendarFeedView for authenticated owner', async () => {
      mockRequireOwner.mockResolvedValueOnce({
        user: { id: 'owner-user-1', role: 'owner' },
      });
      mockGetOrCreateActiveFeed.mockResolvedValueOnce({
        feed: dummyFeed,
        token: 'new-token-string',
      });

      const element = await CalendarFeedPage({
        params: Promise.resolve({ locale: 'en' }),
      });

      const html = renderToStaticMarkup(element);
      expect(html).toContain('settings.calendarFeed.title');
      expect(mockGetOrCreateActiveFeed).toHaveBeenCalledWith('owner-user-1');
    });
  });
});
