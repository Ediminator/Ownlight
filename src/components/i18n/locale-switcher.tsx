'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Globe } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function LocaleSwitcher() {
  const currentLocale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('locale');

  const switchLocale = (newLocale: 'en' | 'de') => {
    if (newLocale === currentLocale) return;
    // Set strictly necessary preference cookie compliant with TDDDG §25 (<= 12 months)
    document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000; SameSite=Lax`;
    router.replace(pathname, { locale: newLocale });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`${t('switcher')}, ${currentLocale.toUpperCase()}`}
          data-testid="locale-switcher-trigger"
          className="gap-2"
        >
          <Globe className="h-4 w-4" />
          <span className="uppercase text-xs font-semibold">{currentLocale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          data-testid="locale-option-en"
          onClick={() => {
            switchLocale('en');
          }}
          className={currentLocale === 'en' ? 'font-bold' : ''}
        >
          {t('en')}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="locale-option-de"
          onClick={() => {
            switchLocale('de');
          }}
          className={currentLocale === 'de' ? 'font-bold' : ''}
        >
          {t('de')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
