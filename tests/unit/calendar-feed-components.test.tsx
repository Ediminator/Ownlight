import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CalendarFeed } from '@/server/db/schema/calendar';
import {
  buildFeedSubscriptionUrl,
  isTokenMasked,
  formatLastAccessedDate,
  SUMMARY_LEVEL_OPTIONS,
  NOOP_SUBSCRIBE,
  getClientWindowOrigin,
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

import {
  revokeFeedTokenAction,
  updateFeedSummaryLevelAction,
} from '@/server/calendar/feed-actions';

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

    it('NOOP_SUBSCRIBE and getClientWindowOrigin provide external store helpers', () => {
      const unsub = NOOP_SUBSCRIBE();
      expect(typeof unsub).toBe('function');
      unsub();

      expect(getClientWindowOrigin()).toBe('');

      const originalWindow = globalThis.window;
      Object.defineProperty(globalThis, 'window', {
        value: { location: { origin: 'https://custom.origin' } },
        configurable: true,
        writable: true,
      });
      expect(getClientWindowOrigin()).toBe('https://custom.origin');
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
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

    it('I1-U01 regression: renders revoke-feed-button and revocation confirmation dialog markup', () => {
      const html = renderToStaticMarkup(
        <CalendarFeedView initialFeed={dummyFeed} initialToken="some-token" locale="de" />,
      );

      expect(html).toContain('data-testid="revoke-feed-button"');
      expect(html).toContain('settings.calendarFeed.revokeSection.revokeBtn');
    });

    it('renders copied state and feedback when initialCopied is true', () => {
      const html = renderToStaticMarkup(
        <CalendarFeedView
          initialFeed={dummyFeed}
          initialToken="some-token"
          locale="en"
          initialCopied={true}
          initialCopyFeedback="Copied to clipboard"
        />,
      );

      expect(html).toContain('Copied to clipboard');
    });

    it('renders level feedback in both success and error styles', () => {
      const htmlSuccess = renderToStaticMarkup(
        <CalendarFeedView
          initialFeed={dummyFeed}
          initialToken="some-token"
          locale="en"
          initialLevelFeedback={{ text: 'Saved successfully', error: false }}
          initialIsUpdatingLevel={true}
        />,
      );
      expect(htmlSuccess).toContain('Saved successfully');
      expect(htmlSuccess).toContain('text-emerald-700');

      const htmlError = renderToStaticMarkup(
        <CalendarFeedView
          initialFeed={dummyFeed}
          initialToken="some-token"
          locale="en"
          initialLevelFeedback={{ text: 'Failed to update', error: true }}
        />,
      );
      expect(htmlError).toContain('Failed to update');
      expect(htmlError).toContain('text-destructive');
    });

    it('renders revoke feedback in both success and error styles', () => {
      const htmlSuccess = renderToStaticMarkup(
        <CalendarFeedView
          initialFeed={dummyFeed}
          initialToken="some-token"
          locale="en"
          initialRevokeFeedback={{ text: 'Revoked successfully', error: false }}
          initialRevokeDialogOpen={true}
          initialIsRevoking={true}
        />,
      );
      expect(htmlSuccess).toContain('Revoked successfully');
      expect(htmlSuccess).toContain('settings.calendarFeed.revokeSection.revoking');

      const htmlError = renderToStaticMarkup(
        <CalendarFeedView
          initialFeed={dummyFeed}
          initialToken="some-token"
          locale="en"
          initialRevokeFeedback={{ text: 'Revocation failed', error: true }}
        />,
      );
      expect(htmlError).toContain('Revocation failed');
      expect(htmlError).toContain('text-destructive');
    });
  });

  describe('CalendarFeedView (Interactive Handlers & Branches)', () => {
    let capturedViewTree: React.ReactElement | null = null;
    function CaptureCalendarFeedView(props: React.ComponentProps<typeof CalendarFeedView>) {
      const res = CalendarFeedView(props);
      capturedViewTree = res;
      return res;
    }

    function findNodeByTestId(node: unknown, testId: string): Record<string, unknown> | undefined {
      if (!node || typeof node !== 'object') return undefined;
      if (React.isValidElement(node)) {
        const props = node.props as Record<string, unknown>;
        if (props['data-testid'] === testId) return props;
        if (props.children) {
          const res = findNodeByTestId(props.children, testId);
          if (res) return res;
        }
      } else if (Array.isArray(node)) {
        for (const item of node) {
          const res = findNodeByTestId(item, testId);
          if (res) return res;
        }
      }
      return undefined;
    }

    function findInputInNode(node: unknown): Record<string, unknown> | undefined {
      if (!node || typeof node !== 'object') return undefined;
      if (React.isValidElement(node)) {
        if (node.type === 'input') return node.props as Record<string, unknown>;
        const props = node.props as Record<string, unknown>;
        if (props.children) {
          const res = findInputInNode(props.children);
          if (res) return res;
        }
      } else if (Array.isArray(node)) {
        for (const item of node) {
          const res = findInputInNode(item);
          if (res) return res;
        }
      } else {
        const obj = node as Record<string, unknown>;
        if (obj.children) {
          return findInputInNode(obj.children);
        }
      }
      return undefined;
    }

    function findButtonsInNode(node: unknown): Record<string, unknown>[] {
      const buttons: Record<string, unknown>[] = [];
      function traverse(n: unknown): void {
        if (!n || typeof n !== 'object') return;
        if (React.isValidElement(n)) {
          const props = n.props as Record<string, unknown>;
          if (typeof props.onClick === 'function') {
            buttons.push(props);
          }
          if (props.children) traverse(props.children);
        } else if (Array.isArray(n)) {
          for (const item of n) traverse(item);
        } else {
          const obj = n as Record<string, unknown>;
          if (obj.children) traverse(obj.children);
        }
      }
      traverse(node);
      return buttons;
    }

    it('handles copy button click when clipboard succeeds', async () => {
      vi.useFakeTimers();
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      renderToStaticMarkup(
        <CaptureCalendarFeedView initialFeed={dummyFeed} initialToken="test-token" locale="en" />,
      );

      const copyBtn = findNodeByTestId(capturedViewTree, 'copy-feed-url-button');
      expect(copyBtn).toBeDefined();
      const onClick = copyBtn?.onClick as (() => Promise<void>) | undefined;
      await onClick?.();

      expect(writeTextMock).toHaveBeenCalled();

      vi.advanceTimersByTime(3500);
      vi.useRealTimers();
    });

    it('handles copy button click when clipboard fails (I1-U02 error path)', async () => {
      const writeTextMock = vi.fn().mockRejectedValue(new Error('Clipboard denied'));
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      renderToStaticMarkup(
        <CaptureCalendarFeedView initialFeed={dummyFeed} initialToken="test-token" locale="de" />,
      );

      const copyBtn = findNodeByTestId(capturedViewTree, 'copy-feed-url-button');
      const onClick = copyBtn?.onClick as (() => Promise<void>) | undefined;
      await onClick?.();

      expect(writeTextMock).toHaveBeenCalled();
    });

    it('handles summary level change successfully', async () => {
      vi.useFakeTimers();
      const mockUpdate = vi.mocked(updateFeedSummaryLevelAction);
      mockUpdate.mockResolvedValueOnce({
        success: true,
        data: { ...dummyFeed, summaryLevel: 'minimal' },
      });

      renderToStaticMarkup(
        <CaptureCalendarFeedView initialFeed={dummyFeed} initialToken="test-token" locale="en" />,
      );

      const minimalOption = findNodeByTestId(capturedViewTree, 'summary-level-option-minimal');
      expect(minimalOption).toBeDefined();
      const radioInput = findInputInNode(minimalOption);
      expect(radioInput).toBeDefined();
      const onChange = radioInput?.onChange as (() => Promise<void>) | undefined;
      await onChange?.();

      expect(mockUpdate).toHaveBeenCalledWith({
        feedId: dummyFeed.id,
        summaryLevel: 'minimal',
      });

      vi.advanceTimersByTime(4500);
      vi.useRealTimers();
    });

    it('handles summary level change failure and exception', async () => {
      const mockUpdate = vi.mocked(updateFeedSummaryLevelAction);
      mockUpdate.mockResolvedValueOnce({
        success: false,
        code: 'INTERNAL_ERROR',
        error: 'UPDATE_FAILED',
      });

      renderToStaticMarkup(
        <CaptureCalendarFeedView initialFeed={dummyFeed} initialToken="test-token" locale="en" />,
      );

      const fullOption = findNodeByTestId(capturedViewTree, 'summary-level-option-full');
      const radioInput = findInputInNode(fullOption);
      const onChange = radioInput?.onChange as (() => Promise<void>) | undefined;
      await onChange?.();

      expect(mockUpdate).toHaveBeenCalledWith({
        feedId: dummyFeed.id,
        summaryLevel: 'full',
      });

      mockUpdate.mockRejectedValueOnce(new Error('Network error'));
      await onChange?.();
    });

    it('handles revoke confirmation, dialog open/close, and focus restoration', async () => {
      vi.useFakeTimers();
      const mockRevoke = vi.mocked(revokeFeedTokenAction);
      const syntheticRegeneratedToken = 'new-regenerated-feed-token-32chars';
      mockRevoke.mockResolvedValueOnce({
        success: true,
        data: {
          feed: { ...dummyFeed, id: '01920000-0000-7000-8000-000000000002' },
          token: syntheticRegeneratedToken,
          previousFeedId: dummyFeed.id,
        },
      });

      renderToStaticMarkup(
        <CaptureCalendarFeedView initialFeed={dummyFeed} initialToken="test-token" locale="en" />,
      );

      // 1. Open dialog via revoke-feed-button
      const revokeBtn = findNodeByTestId(capturedViewTree, 'revoke-feed-button');
      expect(revokeBtn).toBeDefined();
      const onRevokeClick = revokeBtn?.onClick as (() => void) | undefined;
      onRevokeClick?.();

      // 2. Test dialog onCloseAutoFocus
      const dialogContent = findNodeByTestId(capturedViewTree, 'revoke-confirmation-dialog');
      expect(dialogContent).toBeDefined();
      const onCloseAutoFocus = dialogContent?.onCloseAutoFocus as
        ((e: { preventDefault: () => void }) => void) | undefined;
      const preventDefault = vi.fn();
      onCloseAutoFocus?.({ preventDefault });
      expect(preventDefault).toHaveBeenCalled();

      // 3. Confirm revocation
      const confirmBtn = findNodeByTestId(capturedViewTree, 'confirm-revoke-button');
      expect(confirmBtn).toBeDefined();
      const onConfirmClick = confirmBtn?.onClick as (() => Promise<void>) | undefined;
      await onConfirmClick?.();

      expect(mockRevoke).toHaveBeenCalledWith({ feedId: dummyFeed.id });

      vi.advanceTimersByTime(5500);
      vi.useRealTimers();
    });

    it('handles revoke error and cancel button dismissal', async () => {
      const mockRevoke = vi.mocked(revokeFeedTokenAction);
      mockRevoke.mockResolvedValueOnce({
        success: false,
        code: 'INTERNAL_ERROR',
        error: 'REVOKE_FAILED',
      });

      renderToStaticMarkup(
        <CaptureCalendarFeedView initialFeed={dummyFeed} initialToken="test-token" locale="de" />,
      );

      const confirmBtn = findNodeByTestId(capturedViewTree, 'confirm-revoke-button');
      const onConfirmClick = confirmBtn?.onClick as (() => Promise<void>) | undefined;
      await onConfirmClick?.();

      mockRevoke.mockRejectedValueOnce(new Error('Revoke network crash'));
      await onConfirmClick?.();

      const dialogContent = findNodeByTestId(capturedViewTree, 'revoke-confirmation-dialog');
      const buttons = findButtonsInNode(dialogContent);
      const cancelBtn = buttons.find((b) => b['data-testid'] !== 'confirm-revoke-button');
      const onCancelClick = cancelBtn?.onClick as (() => void) | undefined;
      onCancelClick?.();
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
      const testTokenValue = 'synthetic-feed-token-value';
      mockGetOrCreateActiveFeed.mockResolvedValueOnce({
        feed: dummyFeed,
        token: testTokenValue,
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
