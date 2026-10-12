import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Shield, Cloud } from 'lucide-react';

export default function SettingsPage() {
  const t = useTranslations('pages.settings');
  const tSec = useTranslations('settings.security');
  const tInt = useTranslations('settings.integrations');

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-primary shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold">{tSec('title')}</h2>
              <p className="text-sm text-muted-foreground">{tSec('description')}</p>
            </div>
          </div>
          <div>
            <Link
              href="/settings/security"
              className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 min-h-[36px] py-2 px-4 shadow-sm"
            >
              {tSec('manage')}
            </Link>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <Cloud className="h-6 w-6 text-primary shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold">{tInt('google.title')}</h2>
              <p className="text-sm text-muted-foreground">{tInt('google.description')}</p>
            </div>
          </div>
          <div>
            <Link
              href="/settings/integrations/google"
              className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 min-h-[36px] py-2 px-4 shadow-sm"
            >
              {tInt('manage')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
