import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `translated-${key}`,
  useLocale: () => 'en',
}));

const mockSetTheme = vi.fn();
vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'light',
    setTheme: mockSetTheme,
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <div id="theme-provider">{children}</div>
  ),
}));

const mockReplace = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick} {...props}>
      {children}
    </a>
  ),
  usePathname: () => '/leads',
  useRouter: () => ({
    replace: mockReplace,
    push: vi.fn(),
  }),
}));

import { SkipLink } from '@/components/layout/skip-link';
import { NavLinks } from '@/components/layout/nav-links';
import { Sidebar } from '@/components/layout/sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { AppShell } from '@/components/layout/app-shell';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { LocaleSwitcher } from '@/components/i18n/locale-switcher';

describe('Shell Layout and Navigation Components', () => {
  it('renders SkipLink component', () => {
    const html = renderToStaticMarkup(<SkipLink />);
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('translated-skipLink');
  });

  it('renders NavLinks component with active and non-active links and triggers onNavigate', () => {
    const onNavigate = vi.fn();
    const html = renderToStaticMarkup(<NavLinks onNavigate={onNavigate} />);
    expect(html).toContain('href="/leads"');
    expect(html).toContain('aria-current="page"');

    // Trigger onNavigate
    const el = NavLinks({ onNavigate }) as React.ReactElement<{
      children: React.ReactElement<{
        children: React.ReactElement<{ onClick?: () => void }>;
      }>[];
    }>;
    const firstLi = el.props.children[0];
    if (!firstLi) throw new Error('Expected at least one nav item');
    firstLi.props.children.props.onClick?.();
    expect(onNavigate).toHaveBeenCalled();
  });

  it('renders NavLinks unread lead count badge when newLeadsCount > 0 and hides when 0', () => {
    const withBadgeHtml = renderToStaticMarkup(<NavLinks newLeadsCount={5} />);
    expect(withBadgeHtml).toContain('data-testid="new-leads-badge"');
    expect(withBadgeHtml).toContain('5');
    expect(withBadgeHtml).toContain('aria-label="translated-badgeAriaLabel"');

    const withoutBadgeHtml = renderToStaticMarkup(<NavLinks newLeadsCount={0} />);
    expect(withoutBadgeHtml).not.toContain('data-testid="new-leads-badge"');
  });

  it('renders Sidebar component', () => {
    const html = renderToStaticMarkup(<Sidebar />);
    expect(html).toContain('translated-title');
    expect(html).toContain('translated-owner');
  });

  it('renders MobileNav component', () => {
    const html = renderToStaticMarkup(<MobileNav />);
    expect(html).toContain('translated-openMenu');
  });

  it('renders AppShell component', () => {
    const html = renderToStaticMarkup(
      <AppShell>
        <div id="test-child">Dashboard Content</div>
      </AppShell>,
    );
    expect(html).toContain('main-content');
    expect(html).toContain('Dashboard Content');
  });

  it('renders AppShell component with focused layout when isAuthRoute is true', () => {
    const html = renderToStaticMarkup(
      <AppShell isAuthRoute={true}>
        <div id="auth-child">Auth Form Content</div>
      </AppShell>,
    );
    expect(html).toContain('main-content');
    expect(html).toContain('Auth Form Content');
    // Sidebar and mobile nav should NOT be rendered in focused auth layout
    expect(html).not.toContain('translated-openMenu');
    expect(html).not.toContain('translated-owner');
  });

  it('renders ThemeProvider and ThemeToggle, executing theme changes', () => {
    const providerHtml = renderToStaticMarkup(
      <ThemeProvider>
        <div>Theme Content</div>
      </ThemeProvider>,
    );
    expect(providerHtml).toContain('Theme Content');

    const toggleHtml = renderToStaticMarkup(<ThemeToggle />);
    expect(toggleHtml).toContain('translated-toggle');

    // Invoke theme options
    const toggleEl = ThemeToggle() as React.ReactElement<{
      children: [
        unknown,
        React.ReactElement<{
          children: React.ReactElement<{ onClick: () => void }>[];
        }>,
      ];
    }>;
    const content = toggleEl.props.children[1];
    const [itemLight, itemDark, itemSystem] = content.props.children;
    if (!itemLight || !itemDark || !itemSystem) {
      throw new Error('Expected theme items to be present');
    }
    itemLight.props.onClick();
    expect(mockSetTheme).toHaveBeenCalledWith('light');
    itemDark.props.onClick();
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
    itemSystem.props.onClick();
    expect(mockSetTheme).toHaveBeenCalledWith('system');
  });

  it('renders LocaleSwitcher component and switches locale', () => {
    let cookieStore = '';
    Object.defineProperty(globalThis, 'document', {
      value: {
        get cookie() {
          return cookieStore;
        },
        set cookie(val: string) {
          cookieStore = val;
        },
      },
      writable: true,
      configurable: true,
    });

    const switcherHtml = renderToStaticMarkup(<LocaleSwitcher />);
    expect(switcherHtml).toContain('translated-switcher');
    expect(switcherHtml).toContain('en');

    // Invoke switch locale
    const switcherEl = LocaleSwitcher() as React.ReactElement<{
      children: [
        unknown,
        React.ReactElement<{
          children: React.ReactElement<{ onClick: () => void }>[];
        }>,
      ];
    }>;
    const content = switcherEl.props.children[1];
    const [itemEn, itemDe] = content.props.children;
    if (!itemEn || !itemDe) {
      throw new Error('Expected locale items to be present');
    }

    // Switching to German
    itemDe.props.onClick();
    expect(cookieStore).toContain('NEXT_LOCALE=de');
    expect(mockReplace).toHaveBeenCalledWith('/leads', { locale: 'de' });

    // Switching to current locale (en) is a no-op
    itemEn.props.onClick();
  });
});
