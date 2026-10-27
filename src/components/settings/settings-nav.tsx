'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Shield, Cloud, ClipboardList, CalendarClock, Rss, Package } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

interface SettingsNavProps {
  className?: string;
}

export function SettingsNav({ className }: SettingsNavProps) {
  const tSec = useTranslations('settings.security');
  const tInt = useTranslations('settings.integrations.google');
  const tInq = useTranslations('settings.inquiryForms');
  const tAvail = useTranslations('settings.availability');
  const tFeed = useTranslations('settings.calendarFeed');
  const tPkg = useTranslations('settings.packages');
  const pathname = usePathname();

  const links = [
    {
      href: '/settings/security',
      label: tSec('title'),
      shortLabel: 'Security',
      icon: Shield,
    },
    {
      href: '/settings/calendar/availability',
      label: tAvail('title'),
      shortLabel: tAvail('navLabel'),
      icon: CalendarClock,
    },
    {
      href: '/settings/packages',
      label: tPkg('title'),
      shortLabel: tPkg('navLabel'),
      icon: Package,
    },
    {
      href: '/settings/calendar/feed',
      label: tFeed('title'),
      shortLabel: tFeed('navLabel'),
      icon: Rss,
    },
    {
      href: '/settings/integrations/google',
      label: tInt('title'),
      shortLabel: 'Google Workspace',
      icon: Cloud,
    },
    {
      href: '/settings/inquiry-forms',
      label: tInq('title'),
      shortLabel: tInq('title'),
      icon: ClipboardList,
    },
  ];

  return (
    <nav
      aria-label="Settings subnavigation"
      className={cn('flex flex-wrap gap-2 border-b pb-3 mb-6', className)}
    >
      {links.map((item) => {
        const Icon = item.icon;
        const isActive = pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors min-h-[36px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              isActive
                ? 'bg-secondary text-secondary-foreground font-semibold shadow-xs'
                : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{item.shortLabel}</span>
          </Link>
        );
      })}
    </nav>
  );
}
