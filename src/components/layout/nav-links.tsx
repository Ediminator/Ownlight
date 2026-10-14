'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { LayoutDashboard, Inbox, Users, FolderKanban, Calendar, Settings } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

interface NavLinksProps {
  onNavigate?: () => void;
  className?: string;
  newLeadsCount?: number;
}

interface LeadCountBadgeProps {
  count?: number;
}

function LeadCountBadge({ count }: LeadCountBadgeProps) {
  const t = useTranslations('leads');
  const [fetchedCount, setFetchedCount] = React.useState<number | null>(null);
  const pathname = usePathname();
  const displayCount = count ?? fetchedCount;

  React.useEffect(() => {
    if (count !== undefined) {
      return;
    }
    let isMounted = true;
    import('@/server/leads/actions')
      .then((m) => m.getLeadCountsAction())
      .then((res) => {
        if (isMounted && res.success) {
          setFetchedCount(res.data.new);
        }
      })
      .catch(() => undefined);
    return () => {
      isMounted = false;
    };
  }, [count, pathname]);

  if (typeof displayCount !== 'number' || displayCount <= 0) {
    return null;
  }

  return (
    <span
      data-testid="new-leads-badge"
      aria-label={t('badgeAriaLabel', { count: displayCount })}
      className="ml-auto inline-flex items-center justify-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
    >
      {displayCount}
    </span>
  );
}

export function NavLinks({ onNavigate, className, newLeadsCount }: NavLinksProps) {
  const t = useTranslations('nav');
  const pathname = usePathname();

  const links = [
    { href: '/', label: t('dashboard'), icon: LayoutDashboard },
    { href: '/leads', label: t('leads'), icon: Inbox, isLeads: true },
    { href: '/clients', label: t('clients'), icon: Users },
    { href: '/projects', label: t('projects'), icon: FolderKanban },
    { href: '/calendar', label: t('calendar'), icon: Calendar },
    { href: '/settings', label: t('settings'), icon: Settings },
  ];

  return (
    <ul className={cn('space-y-1', className)}>
      {links.map((item) => {
        const Icon = item.icon;
        const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);

        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                isActive
                  ? 'bg-accent text-accent-foreground font-semibold shadow-sm'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
              {item.isLeads && <LeadCountBadge count={newLeadsCount} />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
