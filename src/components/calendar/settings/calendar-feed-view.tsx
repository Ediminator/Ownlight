'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  CalendarClock,
  Rss,
  Copy,
  Check,
  RotateCcw,
  AlertTriangle,
  ChevronRight,
  ShieldCheck,
  Smartphone,
  Calendar as CalendarIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { CalendarFeed, CalendarFeedSummaryLevel } from '@/server/db/schema/calendar';
import {
  buildFeedSubscriptionUrl,
  formatLastAccessedDate,
  SUMMARY_LEVEL_OPTIONS,
} from './feed-settings-helpers';
import {
  revokeFeedTokenAction,
  updateFeedSummaryLevelAction,
} from '@/server/calendar/feed-actions';

interface CalendarFeedViewProps {
  initialFeed: CalendarFeed;
  initialToken?: string | null;
  locale: string;
}

const NOOP_SUBSCRIBE = () => () => {
  // Static origin has no external store subscription events
};

export function CalendarFeedView({ initialFeed, initialToken, locale }: CalendarFeedViewProps) {
  const t = useTranslations('settings.calendarFeed');
  const [feed, setFeed] = React.useState<CalendarFeed>(initialFeed);
  const [currentToken, setCurrentToken] = React.useState<string | null>(initialToken ?? null);
  const [copied, setCopied] = React.useState<boolean>(false);
  const [copyFeedback, setCopyFeedback] = React.useState<string | null>(null);
  const [summaryLevel, setSummaryLevel] = React.useState<CalendarFeedSummaryLevel>(
    initialFeed.summaryLevel,
  );
  const [isUpdatingLevel, setIsUpdatingLevel] = React.useState<boolean>(false);
  const [levelFeedback, setLevelFeedback] = React.useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [revokeDialogOpen, setRevokeDialogOpen] = React.useState<boolean>(false);
  const [isRevoking, setIsRevoking] = React.useState<boolean>(false);
  const [revokeFeedback, setRevokeFeedback] = React.useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const revokeTriggerRef = React.useRef<HTMLButtonElement>(null);

  const origin = React.useSyncExternalStore(
    NOOP_SUBSCRIBE,
    () => (typeof window !== 'undefined' ? window.location.origin : ''),
    () => '',
  );

  const feedUrl = buildFeedSubscriptionUrl(origin, currentToken);
  const isMasked = !currentToken;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setCopyFeedback(t('urlSection.copied'));
      setTimeout(() => {
        setCopied(false);
        setCopyFeedback(null);
      }, 3000);
    } catch {
      setCopyFeedback(t('urlSection.copyError'));
    }
  };

  const handleSummaryLevelChange = async (newLevel: CalendarFeedSummaryLevel) => {
    setSummaryLevel(newLevel);
    setIsUpdatingLevel(true);
    setLevelFeedback(null);

    try {
      const result = await updateFeedSummaryLevelAction({
        feedId: feed.id,
        summaryLevel: newLevel,
      });

      if (result.success) {
        setFeed(result.data);
        setLevelFeedback({ text: t('summaryLevelSection.saveSuccess') });
      } else {
        setLevelFeedback({ text: t('summaryLevelSection.saveError'), error: true });
      }
    } catch {
      setLevelFeedback({ text: t('summaryLevelSection.saveError'), error: true });
    } finally {
      setIsUpdatingLevel(false);
      setTimeout(() => {
        setLevelFeedback(null);
      }, 4000);
    }
  };

  const handleRevokeConfirm = async () => {
    setIsRevoking(true);
    setRevokeFeedback(null);

    try {
      const result = await revokeFeedTokenAction({ feedId: feed.id });

      if (result.success) {
        setFeed(result.data.feed);
        setCurrentToken(result.data.token);
        setRevokeDialogOpen(false);
        setRevokeFeedback({ text: t('revokeSection.revokeSuccess') });
      } else {
        setRevokeFeedback({ text: t('revokeSection.revokeError'), error: true });
      }
    } catch {
      setRevokeFeedback({ text: t('revokeSection.revokeError'), error: true });
    } finally {
      setIsRevoking(false);
      setTimeout(() => {
        setRevokeFeedback(null);
      }, 5000);
    }
  };

  const formattedLastAccessed = formatLastAccessedDate(feed.lastAccessedAt, locale);

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="calendar-feed-settings-page">
      {/* Breadcrumbs */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Link
          href="/settings"
          className="hover:text-foreground transition-colors"
          data-testid="breadcrumb-settings"
        >
          {t('breadcrumbs.settings')}
        </Link>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />
        <Link
          href="/settings/calendar/availability"
          className="hover:text-foreground transition-colors"
        >
          {t('breadcrumbs.calendar')}
        </Link>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />
        <span className="font-medium text-foreground select-none" aria-current="page">
          {t('breadcrumbs.feed')}
        </span>
      </nav>

      {/* Page Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground max-w-3xl">{t('description')}</p>
      </div>

      {/* Calendar Settings Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Calendar settings tabs"
        className="flex border-b border-border gap-2"
      >
        <Link
          href="/settings/calendar/availability"
          role="tab"
          aria-selected={false}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('tabs.availability')}</span>
        </Link>
        <Link
          href="/settings/calendar/feed"
          role="tab"
          aria-selected={true}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 border-primary text-foreground -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Rss className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('tabs.feed')}</span>
        </Link>
      </div>

      {/* Feed Status and URL Card */}
      <div className="rounded-lg border bg-card p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="space-y-0.5">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {t('urlSection.title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('urlSection.description')}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                feed.isActive
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
              )}
            >
              {feed.isActive ? t('urlSection.statusActive') : t('urlSection.statusRevoked')}
            </span>
          </div>
        </div>

        {/* URL Input and Copy Button */}
        <div className="space-y-2">
          <label
            htmlFor="feed-url-input"
            className="text-xs font-medium text-foreground uppercase tracking-wider"
          >
            {t('urlSection.feedUrlLabel')}
          </label>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1">
              <input
                id="feed-url-input"
                data-testid="feed-url-input"
                type="text"
                readOnly
                value={feedUrl}
                aria-describedby="feed-url-hint"
                className="w-full rounded-md border border-input bg-muted/40 px-3 py-2 text-sm font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring select-all"
              />
            </div>
            <Button
              type="button"
              variant="default"
              data-testid="copy-feed-url-button"
              onClick={() => {
                void handleCopy();
              }}
              className="gap-2 shrink-0"
            >
              {copied ? (
                <Check className="h-4 w-4 text-primary-foreground" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4 text-primary-foreground" aria-hidden="true" />
              )}
              <span>{copied ? t('urlSection.copied') : t('urlSection.copyUrl')}</span>
            </Button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-muted-foreground gap-2 pt-1">
            <div id="feed-url-hint">
              {isMasked ? (
                <span className="text-amber-700 dark:text-amber-400 font-medium">
                  {t('urlSection.tokenHiddenNotice')}
                </span>
              ) : (
                <span>
                  {feed.lastAccessedAt && formattedLastAccessed
                    ? t('urlSection.lastAccessed', { date: formattedLastAccessed })
                    : t('urlSection.neverAccessed')}
                </span>
              )}
            </div>
            {copyFeedback && (
              <div
                role="status"
                aria-live="polite"
                className="text-emerald-700 dark:text-emerald-400 font-medium"
              >
                {copyFeedback}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Summary Level Card */}
      <div className="rounded-lg border bg-card p-6 shadow-xs space-y-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {t('summaryLevelSection.title')}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">{t('summaryLevelSection.description')}</p>
        </div>

        <fieldset className="space-y-3 pt-2">
          <legend className="sr-only">{t('summaryLevelSection.fieldLabel')}</legend>
          {SUMMARY_LEVEL_OPTIONS.map((opt) => {
            const isSelected = summaryLevel === opt.level;
            const inputId = `summary-level-${opt.level}`;
            const descId = `summary-desc-${opt.level}`;

            return (
              <div
                key={opt.level}
                data-testid={`summary-level-option-${opt.level}`}
                className={cn(
                  'flex items-start gap-3 p-4 rounded-lg border transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/5 dark:bg-primary/10'
                    : 'border-border hover:bg-muted/30',
                )}
              >
                <input
                  id={inputId}
                  type="radio"
                  name="summaryLevel"
                  value={opt.level}
                  checked={isSelected}
                  disabled={isUpdatingLevel}
                  onChange={() => {
                    void handleSummaryLevelChange(opt.level);
                  }}
                  aria-describedby={descId}
                  className="mt-1 h-4 w-4 text-primary border-input focus:ring-primary focus:ring-offset-2"
                />
                <label htmlFor={inputId} className="space-y-1 select-none cursor-pointer flex-1">
                  <span className="block text-sm font-semibold text-foreground">
                    {t(opt.labelKey)}
                  </span>
                  <span id={descId} className="block text-xs text-muted-foreground leading-relaxed">
                    {t(opt.descriptionKey)}
                  </span>
                </label>
              </div>
            );
          })}
        </fieldset>

        {levelFeedback && (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              'text-xs font-medium pt-1',
              levelFeedback.error ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400',
            )}
          >
            {levelFeedback.text}
          </div>
        )}
      </div>

      {/* Revocation Card */}
      <div className="rounded-lg border border-rose-200 dark:border-rose-950/50 bg-rose-50/20 dark:bg-rose-950/10 p-6 shadow-xs space-y-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <AlertTriangle
              className="h-5 w-5 text-rose-600 dark:text-rose-400"
              aria-hidden="true"
            />
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {t('revokeSection.title')}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">{t('revokeSection.description')}</p>
        </div>

        <div className="pt-1 flex flex-col sm:flex-row sm:items-center gap-3">
          <Button
            ref={revokeTriggerRef}
            type="button"
            variant="destructive"
            data-testid="revoke-feed-button"
            onClick={() => {
              setRevokeDialogOpen(true);
            }}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span>{t('revokeSection.revokeBtn')}</span>
          </Button>

          {revokeFeedback && (
            <div
              role="status"
              aria-live="polite"
              className={cn(
                'text-xs font-medium',
                revokeFeedback.error
                  ? 'text-destructive'
                  : 'text-emerald-700 dark:text-emerald-400',
              )}
            >
              {revokeFeedback.text}
            </div>
          )}
        </div>
      </div>

      {/* Device Setup Guides */}
      <div className="rounded-lg border bg-card p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {t('instructions.title')}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
          {/* Apple Calendar */}
          <div className="rounded-md border p-4 bg-muted/20 space-y-2">
            <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
              <CalendarIcon className="h-4 w-4 text-primary" aria-hidden="true" />
              <h3>{t('instructions.appleTitle')}</h3>
            </div>
            <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-4 leading-relaxed">
              <li>{t('instructions.appleStep1')}</li>
              <li>{t('instructions.appleStep2')}</li>
              <li>{t('instructions.appleStep3')}</li>
            </ol>
          </div>

          {/* Google Calendar */}
          <div className="rounded-md border p-4 bg-muted/20 space-y-2">
            <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
              <CalendarIcon className="h-4 w-4 text-primary" aria-hidden="true" />
              <h3>{t('instructions.googleTitle')}</h3>
            </div>
            <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-4 leading-relaxed">
              <li>{t('instructions.googleStep1')}</li>
              <li>{t('instructions.googleStep2')}</li>
              <li>{t('instructions.googleStep3')}</li>
            </ol>
          </div>

          {/* Microsoft Outlook */}
          <div className="rounded-md border p-4 bg-muted/20 space-y-2">
            <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
              <CalendarIcon className="h-4 w-4 text-primary" aria-hidden="true" />
              <h3>{t('instructions.outlookTitle')}</h3>
            </div>
            <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-4 leading-relaxed">
              <li>{t('instructions.outlookStep1')}</li>
              <li>{t('instructions.outlookStep2')}</li>
              <li>{t('instructions.outlookStep3')}</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Revocation Confirmation Dialog */}
      <Dialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <DialogContent
          data-testid="revoke-confirmation-dialog"
          closeAriaLabel={locale === 'de' ? 'Schließen' : 'Close'}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            revokeTriggerRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('revokeSection.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('revokeSection.dialogDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={isRevoking}
              onClick={() => {
                setRevokeDialogOpen(false);
              }}
            >
              {t('revokeSection.cancelBtn')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="confirm-revoke-button"
              disabled={isRevoking}
              onClick={() => {
                void handleRevokeConfirm();
              }}
            >
              {isRevoking ? t('revokeSection.revoking') : t('revokeSection.confirmBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
