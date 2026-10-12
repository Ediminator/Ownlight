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

vi.mock('@/server/integrations/google/actions', () => ({
  initiateGoogleConnectAction: vi.fn().mockResolvedValue({
    success: true,
    data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?mock=1' },
  }),
  disconnectGoogleAction: vi.fn().mockResolvedValue({
    success: true,
    data: { disconnected: true },
  }),
}));

import { GoogleIntegrationView } from '@/components/settings/google-integration-view';
import type { GoogleIntegrationDetails } from '@/server/integrations/google/service';

describe('GoogleIntegrationView Component (AC-1, AC-8)', () => {
  const redirectUri = 'https://studio.example.com/api/integrations/google/callback';

  it('AC-1: renders unconfigured state with warning, redirect URI, and disabled connect button', () => {
    const unconfiguredStatus: GoogleIntegrationDetails = {
      status: 'unconfigured',
      configured: false,
      connected: false,
      scope: null,
    };

    const html = renderToStaticMarkup(
      <GoogleIntegrationView
        initialStatus={unconfiguredStatus}
        locale="en"
        redirectUri={redirectUri}
      />,
    );

    // Warning alert
    expect(html).toContain('translated-unconfiguredAlertTitle');
    expect(html).toContain('translated-unconfiguredAlertDescription');

    // Shows redirect URI so administrator can configure Google Cloud Console
    expect(html).toContain(redirectUri);

    // Connect button is disabled
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*translated-connectButton.*<\/button>/s);
  });

  it('AC-8: renders disconnected state with enabled connect button and scopes', () => {
    const disconnectedStatus: GoogleIntegrationDetails = {
      status: 'disconnected',
      configured: true,
      connected: false,
      scope: null,
    };

    const html = renderToStaticMarkup(
      <GoogleIntegrationView
        initialStatus={disconnectedStatus}
        locale="en"
        redirectUri={redirectUri}
      />,
    );

    // Shows status badge
    expect(html).toContain('translated-badgeDisconnected');

    // Connect button is enabled (not disabled)
    expect(html).toContain('translated-connectButton');
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>.*translated-connectButton.*<\/button>/s);

    // Scopes info
    expect(html).toContain('translated-grantedScopes');
    expect(html).toContain('translated-contactsScopeLabel');
  });

  it('AC-8: renders connected state with status badge and disconnect action', () => {
    const connectedStatus: GoogleIntegrationDetails = {
      status: 'connected',
      configured: true,
      connected: true,
      scope: 'https://www.googleapis.com/auth/contacts',
      connectedAt: new Date('2026-10-12T00:00:00Z'),
    };

    const html = renderToStaticMarkup(
      <GoogleIntegrationView
        initialStatus={connectedStatus}
        locale="en"
        redirectUri={redirectUri}
      />,
    );

    // Shows connected badge
    expect(html).toContain('translated-badgeConnected');

    // Shows disconnect trigger button
    expect(html).toContain('translated-disconnectButton');

    // Connect button is not shown in connected state
    expect(html).not.toContain('translated-connectButton');
  });

  it('AC-8: renders success notification banner when redirected after successful OAuth flow', () => {
    const connectedStatus: GoogleIntegrationDetails = {
      status: 'connected',
      configured: true,
      connected: true,
      scope: 'https://www.googleapis.com/auth/contacts',
      connectedAt: new Date(),
    };

    const html = renderToStaticMarkup(
      <GoogleIntegrationView
        initialStatus={connectedStatus}
        locale="en"
        redirectUri={redirectUri}
        initialNotification={{ type: 'success', code: 'connected' }}
      />,
    );

    expect(html).toContain('translated-successConnectedAlert');
  });

  it('AC-8: satisfies minimum touch target size (at least 24x24 px, recommended 44x44 px)', () => {
    const disconnectedStatus: GoogleIntegrationDetails = {
      status: 'disconnected',
      configured: true,
      connected: false,
      scope: null,
    };

    const html = renderToStaticMarkup(
      <GoogleIntegrationView
        initialStatus={disconnectedStatus}
        locale="en"
        redirectUri={redirectUri}
      />,
    );

    // Buttons and links must have touch target utility classes (min-h-[44px] or min-h-[40px] or py-2.5)
    expect(html).toContain('min-h-');
  });

  it('AC-8, I1-V01, I1-U01: renders localized back to settings link without hardcoded English copy', () => {
    const unconfiguredStatus: GoogleIntegrationDetails = {
      status: 'unconfigured',
      configured: false,
      connected: false,
      scope: null,
    };

    const html = renderToStaticMarkup(
      <GoogleIntegrationView
        initialStatus={unconfiguredStatus}
        locale="de"
        redirectUri={redirectUri}
      />,
    );

    expect(html).toContain('translated-backToSettings');
    expect(html).not.toContain('<span>Back to Settings</span>');
  });

  it('AC-8, I1-V03, I1-U03: formats connection timestamp using the provided locale prop', () => {
    const connectedStatus: GoogleIntegrationDetails = {
      status: 'connected',
      configured: true,
      connected: true,
      scope: 'https://www.googleapis.com/auth/contacts',
      connectedAt: new Date('2026-10-12T12:00:00Z'),
    };

    const dateTimeSpy = vi.spyOn(Intl, 'DateTimeFormat');

    renderToStaticMarkup(
      <GoogleIntegrationView
        initialStatus={connectedStatus}
        locale="de"
        redirectUri={redirectUri}
      />,
    );

    expect(dateTimeSpy).toHaveBeenCalledWith('de', expect.any(Object));
    dateTimeSpy.mockRestore();
  });

  it('AC-8, I1-U02: applies break-words, hyphens-auto, and responsive padding to prevent 320px clipping', () => {
    const unconfiguredStatus: GoogleIntegrationDetails = {
      status: 'unconfigured',
      configured: false,
      connected: false,
      scope: null,
    };

    const html = renderToStaticMarkup(
      <GoogleIntegrationView
        initialStatus={unconfiguredStatus}
        locale="de"
        redirectUri={redirectUri}
      />,
    );

    expect(html).toContain('break-words');
    expect(html).toContain('hyphens-auto');
    expect(html).toContain('p-4 sm:p-6');
  });

  it('AC-8, I2-U01: disconnect button includes dark:text-red-400 for WCAG 2.2 AA contrast in dark mode', () => {
    const connectedStatus: GoogleIntegrationDetails = {
      status: 'connected',
      configured: true,
      connected: true,
      scope: 'https://www.googleapis.com/auth/contacts',
      connectedAt: new Date('2026-10-12T12:00:00Z'),
    };

    const html = renderToStaticMarkup(
      <GoogleIntegrationView
        initialStatus={connectedStatus}
        locale="en"
        redirectUri={redirectUri}
      />,
    );

    expect(html).toContain('dark:text-red-400');
    expect(html).toContain('dark:hover:bg-red-950/30');
  });
});
