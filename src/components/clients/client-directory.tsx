'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, X, Loader2, AlertCircle, Users, Plus } from 'lucide-react';
import { listClientsAction } from '@/server/clients/actions';
import type { ListClientsResult, TagSummaryItem } from '@/server/clients/repo';

export interface ClientDirectoryProps {
  initialClients: ListClientsResult;
  tags: TagSummaryItem[];
  locale: string;
  initialTagId?: string;
  initialPage?: number;
  initialError?: string | null;
}

export function ClientDirectory({
  initialClients,
  tags,
  locale,
  initialTagId = '',
  initialPage = 1,
  initialError = null,
}: ClientDirectoryProps) {
  const t = useTranslations('clients.list');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ADR-0010: Search term is stored strictly in memory/state. Never in URL, local storage, or logs.
  const [searchTerm, setSearchTerm] = React.useState('');
  const [clientsResult, setClientsResult] = React.useState<ListClientsResult>(initialClients);
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(initialError);
  const [liveAnnouncement, setLiveAnnouncement] = React.useState<string>('');

  // Derive tagId and page directly from URL search params (or fallback to initial props)
  const urlTagParam = searchParams.get('tagId');
  const currentTagId = urlTagParam ?? initialTagId;

  const urlPageParam = searchParams.get('page');
  const parsedPage = urlPageParam ? parseInt(urlPageParam, 10) : initialPage;
  const currentPage = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;

  const totalPages = Math.max(1, Math.ceil(clientsResult.total / clientsResult.pageSize));

  // Update URL search parameters without touching search term (ADR-0010)
  const updateUrlParams = React.useCallback(
    (page: number, tagId: string) => {
      const params = new URLSearchParams();
      if (page > 1) {
        params.set('page', String(page));
      }
      if (tagId) {
        params.set('tagId', tagId);
      }
      const qs = params.toString();
      const newUrl = qs ? `${pathname}?${qs}` : pathname;
      router.replace(newUrl);
    },
    [pathname, router],
  );

  const fetchClients = React.useCallback(
    async (pageToFetch: number, tagIdToFetch: string, termToFetch: string) => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const queryTerm = termToFetch.trim();
        const res = await listClientsAction({
          page: pageToFetch,
          pageSize: 25,
          q: queryTerm.length > 0 ? queryTerm : undefined,
          tagId: tagIdToFetch || undefined,
        });

        if (!res.success) {
          // AC-13: Generic localized error message, zero internal details
          setErrorMessage(t('errorMessage'));
          setLiveAnnouncement(t('errorMessage'));
          return;
        }

        setClientsResult(res.data);

        // Announce count to polite live region
        const countText = t('resultsSummary', { count: res.data.total });
        setLiveAnnouncement(countText);
      } catch {
        // AC-13: Catch any unexpected failure and render generic localized message
        setErrorMessage(t('errorMessage'));
        setLiveAnnouncement(t('errorMessage'));
      } finally {
        setIsLoading(false);
      }
    },
    [t],
  );

  const handleSearchSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    updateUrlParams(1, currentTagId);
    void fetchClients(1, currentTagId, searchTerm);
  };

  const handleClearSearch = () => {
    setSearchTerm('');
    updateUrlParams(1, currentTagId);
    void fetchClients(1, currentTagId, '');
  };

  const handleTagChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newTagId = e.target.value;
    updateUrlParams(1, newTagId);
    void fetchClients(1, newTagId, searchTerm);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages || isLoading) return;
    updateUrlParams(newPage, currentTagId);
    void fetchClients(newPage, currentTagId, searchTerm);
  };

  const hasFilterActive = searchTerm.trim().length > 0 || currentTagId.length > 0;
  const isZeroClientsDatabase = clientsResult.total === 0 && !hasFilterActive;
  const isZeroSearchResults = clientsResult.total === 0 && hasFilterActive;

  return (
    <div className="space-y-6">
      {/* Polite Live Region for screen readers (AC-2) */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="client-directory-live-region"
      >
        {liveAnnouncement}
      </div>

      {/* Page Title, Subtitle & Action */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            {t('title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Link
          href={`/${locale}/clients/new`}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] shrink-0"
          data-testid="new-client-btn"
        >
          <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
          {t('newClient')}
        </Link>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        {/* Search Input (AC-2) */}
        <form
          onSubmit={handleSearchSubmit}
          className="flex-1 flex flex-col gap-1.5"
          role="search"
          data-testid="client-search-form"
        >
          <label htmlFor="client-search" className="text-sm font-medium text-foreground">
            {t('searchLabel')}
          </label>
          <div className="relative flex items-center">
            <Search
              aria-hidden="true"
              className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none"
            />
            <input
              id="client-search"
              type="search"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
              }}
              placeholder={t('searchPlaceholder')}
              autoComplete="off"
              className="w-full rounded-md border border-input bg-background pl-9 pr-24 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[44px]"
              data-testid="client-search-input"
            />
            <div className="absolute right-2 flex items-center gap-1">
              {searchTerm && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  aria-label={t('clearSearch')}
                  className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[32px] min-w-[32px] flex items-center justify-center"
                  data-testid="client-search-clear-btn"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <button
                type="submit"
                disabled={isLoading}
                className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[36px]"
                data-testid="client-search-submit-btn"
              >
                {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('searchButton')}
              </button>
            </div>
          </div>
        </form>

        {/* Tag Filter (AC-3) */}
        <div className="w-full sm:w-64 flex flex-col gap-1.5">
          <label htmlFor="client-tag-filter" className="text-sm font-medium text-foreground">
            {t('tagFilterLabel')}
          </label>
          <select
            id="client-tag-filter"
            value={currentTagId}
            onChange={handleTagChange}
            disabled={isLoading}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[44px]"
            data-testid="client-tag-filter"
          >
            <option value="">{t('allTags')}</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name} ({tag.clientCount})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Error state (AC-13) */}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive flex items-start gap-3"
          data-testid="client-directory-error"
        >
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm font-medium">{errorMessage}</div>
        </div>
      )}

      {/* Empty State: Zero Clients in database (AC-4) */}
      {isZeroClientsDatabase && !isLoading && !errorMessage && (
        <div
          className="rounded-lg border bg-card p-12 text-center text-card-foreground shadow-sm flex flex-col items-center justify-center space-y-3"
          data-testid="client-empty-state"
        >
          <div className="rounded-full bg-muted p-3">
            <Users className="h-6 w-6 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">{t('emptyStateTitle')}</h2>
          <p className="text-sm text-muted-foreground max-w-sm">{t('emptyStateDescription')}</p>
          <Link
            href={`/${locale}/clients/new`}
            className="mt-2 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
            data-testid="empty-state-new-client-btn"
          >
            <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {t('newClient')}
          </Link>
        </div>
      )}

      {/* No Search Results: Active search/tag matches zero (AC-4) */}
      {isZeroSearchResults && !isLoading && !errorMessage && (
        <div
          className="rounded-lg border bg-card p-12 text-center text-card-foreground shadow-sm flex flex-col items-center justify-center space-y-3"
          data-testid="client-no-results-state"
        >
          <div className="rounded-full bg-muted p-3">
            <Search className="h-6 w-6 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">{t('noResultsTitle')}</h2>
          <p className="text-sm text-muted-foreground max-w-sm">{t('noResultsDescription')}</p>
          {searchTerm && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="mt-2 inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground min-h-[44px]"
            >
              {t('clearSearch')}
            </button>
          )}
        </div>
      )}

      {/* Results View: Table (Desktop >= 768px) and Stacked List (Mobile < 768px) */}
      {clientsResult.items.length > 0 && (
        <div className="space-y-4">
          {/* Desktop Table (≥ 768px) */}
          <div className="hidden md:block rounded-lg border bg-card shadow-sm overflow-hidden">
            <table className="w-full text-left text-sm" data-testid="client-table">
              <caption className="sr-only">{t('tableCaption')}</caption>
              <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t('columnName')}
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t('columnPrimaryContact')}
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t('columnEmail')}
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t('columnPhone')}
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t('columnTags')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {clientsResult.items.map((client) => {
                  const contactName =
                    [client.primaryContact.givenName, client.primaryContact.familyName]
                      .filter(Boolean)
                      .join(' ') || t('noValue');

                  return (
                    <tr
                      key={client.id}
                      className="hover:bg-muted/40 transition-colors"
                      data-testid={`client-row-${client.id}`}
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        <Link
                          href={`/${locale}/clients/${client.id}`}
                          className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-h-[24px] inline-flex items-center"
                          aria-label={t('viewProfile', { name: client.displayName })}
                        >
                          {client.displayName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{contactName}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {client.primaryContact.email ?? t('noValue')}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {client.primaryContact.phone ?? t('noValue')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {client.tags.length > 0 ? (
                            client.tags.map((tag) => (
                              <span
                                key={tag.id}
                                className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                              >
                                {tag.name}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">{t('noTags')}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked List (< 768px down to 320px) (AC-10) */}
          <div className="block md:hidden space-y-3" data-testid="client-stacked-list">
            {clientsResult.items.map((client) => {
              const contactName =
                [client.primaryContact.givenName, client.primaryContact.familyName]
                  .filter(Boolean)
                  .join(' ') || t('noValue');

              return (
                <div
                  key={client.id}
                  className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm space-y-2.5 max-w-full break-words"
                  data-testid={`client-card-${client.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/${locale}/clients/${client.id}`}
                      className="font-semibold text-base text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-h-[32px] inline-flex items-center"
                      aria-label={t('viewProfile', { name: client.displayName })}
                    >
                      {client.displayName}
                    </Link>
                  </div>

                  <div className="text-sm space-y-1 text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground text-xs uppercase tracking-wider block">
                        {t('columnPrimaryContact')}:
                      </span>
                      <span>{contactName}</span>
                    </div>

                    {client.primaryContact.email && (
                      <div>
                        <span className="font-medium text-foreground text-xs uppercase tracking-wider block">
                          {t('columnEmail')}:
                        </span>
                        <span className="break-all">{client.primaryContact.email}</span>
                      </div>
                    )}

                    {client.primaryContact.phone && (
                      <div>
                        <span className="font-medium text-foreground text-xs uppercase tracking-wider block">
                          {t('columnPhone')}:
                        </span>
                        <span>{client.primaryContact.phone}</span>
                      </div>
                    )}
                  </div>

                  {client.tags.length > 0 && (
                    <div className="pt-1 flex flex-wrap gap-1">
                      {client.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pagination Controls (AC-1) */}
          <div
            className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2"
            data-testid="client-pagination"
          >
            <div className="text-sm text-muted-foreground" data-testid="pagination-summary">
              {t('pageSummary', { page: currentPage, totalPages })}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  handlePageChange(currentPage - 1);
                }}
                disabled={currentPage <= 1 || isLoading}
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[44px] min-w-[44px]"
                data-testid="pagination-prev-btn"
              >
                {t('previousPage')}
              </button>
              <button
                type="button"
                onClick={() => {
                  handlePageChange(currentPage + 1);
                }}
                disabled={currentPage >= totalPages || isLoading}
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[44px] min-w-[44px]"
                data-testid="pagination-next-btn"
              >
                {t('nextPage')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
