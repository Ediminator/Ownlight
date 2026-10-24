import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    `translated-${key}${values ? JSON.stringify(values) : ''}`,
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

const mockRedirect = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string): void => {
    mockRedirect(url);
  },
}));

const mockRequireOwner = vi.fn<() => Promise<unknown>>();
vi.mock('@/server/auth/guards', () => ({
  requireOwner: (): Promise<unknown> => mockRequireOwner(),
}));

const mockGetCaldavAccountStatus = vi.fn<() => Promise<unknown>>();
vi.mock('@/server/integrations/caldav/repo', () => ({
  getCaldavAccountStatus: (): Promise<unknown> => mockGetCaldavAccountStatus(),
}));

vi.mock('@/server/integrations/caldav/actions', () => ({
  testCaldavConnectionAction: vi.fn(),
  saveCaldavAccountAction: vi.fn(),
  disconnectCaldavAccountAction: vi.fn(),
  triggerManualCaldavSyncAction: vi.fn(),
}));

import { CaldavIntegrationView } from '@/components/settings/caldav-integration-view';
import CaldavIntegrationPage from '@/app/[locale]/settings/integrations/caldav/page';
import type { CaldavAccountStatus } from '@/server/integrations/caldav/repo';

describe('CaldavIntegrationView Component & Page (AC-1, AC-2, AC-5, AC-8)', () => {
  it('AC-1: renders disconnected setup form with input fields, labels, and action button', () => {
    const disconnectedStatus: CaldavAccountStatus = {
      connected: false,
      serverUrl: null,
      username: null,
      selectedCalendarUrl: null,
      selectedCalendarName: null,
      lastSyncedAt: null,
      lastSyncError: null,
    };

    const html = renderToStaticMarkup(
      <CaldavIntegrationView initialStatus={disconnectedStatus} locale="en" />,
    );

    // Header and navigation
    expect(html).toContain('translated-title');
    expect(html).toContain('translated-wizardTitle');
    expect(html).toContain('translated-wizardDescription');
    expect(html).toContain('translated-backToSettings');
    expect(html).toContain('translated-badgeDisconnected');

    // Input fields and test connection button
    expect(html).toContain('translated-serverUrlLabel');
    expect(html).toContain('translated-usernameLabel');
    expect(html).toContain('translated-passwordLabel');
    expect(html).toContain('translated-testAndDiscoverButton');
    expect(html).toContain('data-testid="caldav-server-url-input"');
    expect(html).toContain('data-testid="caldav-username-input"');
    expect(html).toContain('data-testid="caldav-password-input"');
    expect(html).toContain('data-testid="caldav-test-connect-button"');
  });

  it('AC-2: renders connected integration card with active status, server details, and sync buttons', () => {
    const connectedStatus: CaldavAccountStatus = {
      connected: true,
      serverUrl: 'https://caldav.example.org',
      username: 'studio@example.org',
      selectedCalendarUrl: '/calendars/user/shoots/',
      selectedCalendarName: 'Client Shoots',
      lastSyncedAt: new Date('2026-10-24T01:30:00.000Z'),
      lastSyncError: null,
    };

    const html = renderToStaticMarkup(
      <CaldavIntegrationView initialStatus={connectedStatus} locale="en" />,
    );

    // Active status card
    expect(html).toContain('translated-activeCardTitle');
    expect(html).toContain('translated-activeCardDescription');
    expect(html).toContain('translated-badgeConnected');
    expect(html).toContain('https://caldav.example.org');
    expect(html).toContain('studio@example.org');
    expect(html).toContain('Client Shoots');

    // Action buttons
    expect(html).toContain('translated-syncNowButton');
    expect(html).toContain('translated-disconnectButton');
    expect(html).toContain('data-testid="caldav-sync-now-button"');
    expect(html).toContain('data-testid="caldav-disconnect-button"');
  });

  it('AC-8: CaldavIntegrationPage renders view when authenticated as owner', async () => {
    mockRequireOwner.mockResolvedValueOnce({ user: { id: 'owner-1', role: 'owner' } });
    mockGetCaldavAccountStatus.mockResolvedValueOnce({
      connected: false,
      serverUrl: null,
      username: null,
      selectedCalendarUrl: null,
      selectedCalendarName: null,
      lastSyncedAt: null,
      lastSyncError: null,
    });

    const pageElement = await CaldavIntegrationPage({
      params: Promise.resolve({ locale: 'en' }),
    });

    const html = renderToStaticMarkup(pageElement);
    expect(html).toContain('translated-wizardTitle');
  });

  it('AC-8: CaldavIntegrationPage redirects unauthenticated caller to sign-in', async () => {
    mockRequireOwner.mockRejectedValueOnce(new Error('Unauthenticated'));

    await CaldavIntegrationPage({
      params: Promise.resolve({ locale: 'en' }),
    });

    expect(mockRedirect).toHaveBeenCalledWith(
      '/en/sign-in?callbackUrl=/en/settings/integrations/caldav',
    );
  });
});
