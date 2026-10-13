import Link from 'next/link';
import { useTranslations } from 'next-intl';

export const dynamic = 'force-dynamic';

/**
 * Public confirmation page following inquiry submission (AC-1, AC-12, AC-13).
 * Static confirmation without any lead or personal data shown.
 */
export default function InquiryThanksPage() {
  const t = useTranslations('inquiry.public.thanks');

  return (
    <div className="w-full max-w-lg mx-auto px-4 py-16 text-center space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t('title')}
        </h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>
      <div>
        <Link
          href="/"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors"
        >
          {t('backHome')}
        </Link>
      </div>
    </div>
  );
}
