import type { CalendarFeedSummaryLevel } from '@/server/db/schema/calendar';

export interface FeedSummaryOption {
  level: CalendarFeedSummaryLevel;
  labelKey: string;
  descriptionKey: string;
}

export const SUMMARY_LEVEL_OPTIONS: FeedSummaryOption[] = [
  {
    level: 'minimal',
    labelKey: 'summaryLevelSection.minimalLabel',
    descriptionKey: 'summaryLevelSection.minimalDesc',
  },
  {
    level: 'standard',
    labelKey: 'summaryLevelSection.standardLabel',
    descriptionKey: 'summaryLevelSection.standardDesc',
  },
  {
    level: 'full',
    labelKey: 'summaryLevelSection.fullLabel',
    descriptionKey: 'summaryLevelSection.fullDesc',
  },
];

export function buildFeedSubscriptionUrl(origin: string, token: string | null | undefined): string {
  const base = origin ? origin.replace(/\/+$/, '') : '';
  if (token) {
    return `${base}/api/calendar/feed/${token}.ics`;
  }
  // Masked placeholder when existing token is not retained in client memory
  return `${base}/api/calendar/feed/•••••••••••••••••••••••••••••••••••••••••••.ics`;
}

export function isTokenMasked(url: string): boolean {
  return url.includes('••••');
}

export function formatLastAccessedDate(
  date: Date | string | null | undefined,
  locale: string,
): string | null {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;

  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}
