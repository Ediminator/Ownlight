import { headers, cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';

const SESSION_COOKIE_NAME = 'ownlight_session';
const SECURE_SESSION_COOKIE_NAME = '__Secure-ownlight_session';
import { routing } from '@/i18n/routing';
import { geistSans, geistMono } from '@/app/fonts';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { AppShell } from '@/components/layout/app-shell';
import enMessages from '../../../messages/en.json';
import deMessages from '../../../messages/de.json';
import '@/app/globals.css';

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

const AUTH_PATH_SEGMENTS = [
  'sign-in',
  'setup',
  'forgot-password',
  'reset-password',
  'verify-email',
  'f',
];

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = locale === 'de' ? deMessages : enMessages;

  let nonce: string | undefined;
  let isAuthRoute = false;
  try {
    const headersList = await headers();
    nonce = headersList.get('x-nonce') ?? undefined;
    const authHeader = headersList.get('x-is-auth-route');
    const pathnameHeader = headersList.get('x-pathname') ?? '';
    const matchesAuthSegment = AUTH_PATH_SEGMENTS.some((segment) =>
      pathnameHeader.includes(`/${segment}`),
    );
    isAuthRoute = authHeader === '1' || matchesAuthSegment;
  } catch {
    nonce = undefined;
    isAuthRoute = false;
  }

  // Check MFA forced enrolment (AC-8)
  let enforcementRedirect: string | null = null;
  if (!isAuthRoute) {
    try {
      const cookieStore = await cookies();
      const sessionToken =
        cookieStore.get(SECURE_SESSION_COOKIE_NAME)?.value ??
        cookieStore.get(SESSION_COOKIE_NAME)?.value;

      if (sessionToken) {
        const { checkMfaEnforcement } = await import('@/server/auth/mfa-enforcement');
        const headersList = await headers();
        const pathnameHeader = headersList.get('x-pathname') ?? '';
        enforcementRedirect = await checkMfaEnforcement(locale, pathnameHeader, sessionToken);
      }
    } catch {
      // Ignore layout inspection failures
    }
  }

  if (enforcementRedirect) {
    redirect(enforcementRedirect);
  }

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{messages.home.title}</title>
        <meta name="description" content={messages.home.subtitle} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
            nonce={nonce}
          >
            <AppShell isAuthRoute={isAuthRoute}>{children}</AppShell>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
