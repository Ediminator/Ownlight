import { useTranslations } from 'next-intl';

export const dynamic = 'force-dynamic';

/**
 * Public embed confirmation page following iframe inquiry submission (AC-11, AC-12, AC-13).
 * Clean confirmation view styled for embed iframe, without lead data or outer app chrome.
 */
export default function EmbedThanksPage() {
  const t = useTranslations('inquiry.public.thanks');

  return (
    <div className="w-full max-w-lg mx-auto px-4 py-12 text-center space-y-4">
      <div className="space-y-2">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
    </div>
  );
}
