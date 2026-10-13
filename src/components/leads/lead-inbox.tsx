'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import {
  Inbox,
  Search,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Archive,
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { changeLeadStatusAction, deleteLeadsAction } from '@/server/leads/actions';
import type { Lead, LeadStatus } from '@/server/db/schema/leads';
import type { LeadCounts } from '@/server/leads/schema';

export interface LeadInboxProps {
  initialLeads: Lead[];
  initialCounts: LeadCounts;
  locale: string;
  initialStatus?: LeadStatus | 'all';
  initialEmailQuery?: string;
  initialPage?: number;
  hasMore?: boolean;
}

export function LeadInbox({
  initialLeads,
  initialCounts,
  locale,
  initialStatus = 'all',
  initialEmailQuery = '',
  initialPage = 1,
  hasMore = false,
}: LeadInboxProps) {
  const t = useTranslations('leads');
  const router = useRouter();

  const [currentStatus, setCurrentStatus] = React.useState<LeadStatus | 'all'>(initialStatus);
  const [searchQuery, setSearchQuery] = React.useState<string>(initialEmailQuery);
  const [page, setPage] = React.useState<number>(initialPage);

  const [leadsList, setLeadsList] = React.useState<Lead[]>(initialLeads);
  const [counts, setCounts] = React.useState<LeadCounts>(initialCounts);

  const [prevInitialLeads, setPrevInitialLeads] = React.useState(initialLeads);
  if (prevInitialLeads !== initialLeads) {
    setPrevInitialLeads(initialLeads);
    setLeadsList(initialLeads);
  }

  const [prevInitialCounts, setPrevInitialCounts] = React.useState(initialCounts);
  if (prevInitialCounts !== initialCounts) {
    setPrevInitialCounts(initialCounts);
    setCounts(initialCounts);
  }

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const [deleteModalOpen, setDeleteModalOpen] = React.useState(false);
  const [deleteSpamModalOpen, setDeleteSpamModalOpen] = React.useState(false);

  const updateUrl = React.useCallback(
    (newStatus: LeadStatus | 'all', newQuery: string, newPage: number) => {
      const params = new URLSearchParams();
      if (newStatus !== 'all') params.set('status', newStatus);
      if (newQuery.trim().length > 0) params.set('q', newQuery.trim());
      if (newPage > 1) params.set('page', String(newPage));
      const str = params.toString();
      router.push(`/${locale}/leads${str ? '?' + str : ''}`);
    },
    [locale, router],
  );

  // Tab change
  const handleTabChange = (newStatus: LeadStatus | 'all') => {
    setCurrentStatus(newStatus);
    setSelectedIds(new Set());
    setPage(1);
    updateUrl(newStatus, searchQuery, 1);
  };

  // Search debounced
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
  };

  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== initialEmailQuery) {
        setPage(1);
        updateUrl(currentStatus, searchQuery, 1);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [searchQuery, currentStatus, initialEmailQuery, updateUrl]);

  // Selection
  const allSelected = leadsList.length > 0 && selectedIds.size === leadsList.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(leadsList.map((l) => l.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Bulk status change
  const handleBulkStatusChange = async (targetStatus: LeadStatus) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    for (const id of ids) {
      await changeLeadStatusAction({ leadId: id, targetStatus });
    }

    setLeadsList((prev) =>
      prev.map((l) => (selectedIds.has(l.id) ? { ...l, status: targetStatus } : l)),
    );
    setSelectedIds(new Set());
    router.refresh();
  };

  // Bulk delete confirmation
  const handleConfirmBulkDelete = async () => {
    setIsDeleting(true);
    setErrorMsg(null);
    try {
      const ids = Array.from(selectedIds);
      const res = await deleteLeadsAction({ leadIds: ids });
      if (res.success) {
        setLeadsList((prev) => prev.filter((l) => !selectedIds.has(l.id)));
        setSelectedIds(new Set());
        setDeleteModalOpen(false);
        router.refresh();
      } else {
        if (res.code === 'CONVERTED_LEAD') {
          setErrorMsg(t('dialogs.errorConverted'));
        } else {
          setErrorMsg(res.error || 'Failed to delete leads');
        }
      }
    } finally {
      setIsDeleting(false);
    }
  };

  // Delete all spam confirmation
  const handleConfirmDeleteAllSpam = async () => {
    setIsDeleting(true);
    setErrorMsg(null);
    try {
      const res = await deleteLeadsAction({ deleteAllSpam: true });
      if (res.success) {
        setLeadsList([]);
        setSelectedIds(new Set());
        setDeleteSpamModalOpen(false);
        router.refresh();
      } else {
        setErrorMsg(res.error || 'Failed to delete spam leads');
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const tabs: { key: LeadStatus | 'all'; label: string; count: number }[] = [
    { key: 'all', label: t('tabs.all'), count: counts.all },
    { key: 'new', label: t('tabs.new'), count: counts.new },
    { key: 'contacted', label: t('tabs.contacted'), count: counts.contacted },
    { key: 'converted', label: t('tabs.converted'), count: counts.converted },
    { key: 'archived', label: t('tabs.archived'), count: counts.archived },
    { key: 'spam', label: t('tabs.spam'), count: counts.spam },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Inbox className="h-6 w-6 text-primary" aria-hidden="true" />
            <span>{t('title')}</span>
          </h1>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <label htmlFor="lead-search-input" className="sr-only">
            {t('search.label')}
          </label>
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            id="lead-search-input"
            type="search"
            data-testid="leads-search-input"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder={t('search.placeholder')}
            className="w-full pl-9 pr-4 py-2 text-sm bg-background border border-input rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Tabs */}
      <nav aria-label="Lead filter tabs" className="flex border-b border-border overflow-x-auto">
        <div className="flex gap-2 min-w-full sm:min-w-0" role="tablist">
          {tabs.map((tab) => {
            const isActive = currentStatus === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                data-testid={`tab-${tab.key}`}
                onClick={() => {
                  handleTabChange(tab.key);
                }}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? 'border-primary text-primary font-semibold'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  data-testid={`tab-count-${tab.key}`}
                  className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs ${
                    isActive
                      ? 'bg-primary/10 text-primary font-bold'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div
          data-testid="bulk-action-bar"
          role="region"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center justify-between gap-3 p-3 bg-muted/80 border border-border rounded-lg shadow-sm"
        >
          <div className="flex items-center gap-2">
            <span data-testid="selected-count" className="text-sm font-semibold text-foreground">
              {t('bulk.selectedCount', { count: selectedIds.size })}
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedIds(new Set());
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline ml-2"
            >
              {t('bulk.clearSelection')}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="bulk-mark-contacted-btn"
              onClick={() => {
                void handleBulkStatusChange('contacted');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
            >
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
              <span>{t('bulk.markContacted')}</span>
            </button>
            <button
              type="button"
              data-testid="bulk-mark-spam-btn"
              onClick={() => {
                void handleBulkStatusChange('spam');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
              <span>{t('bulk.markSpam')}</span>
            </button>
            <button
              type="button"
              data-testid="bulk-archive-btn"
              onClick={() => {
                void handleBulkStatusChange('archived');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
            >
              <Archive className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <span>{t('bulk.archive')}</span>
            </button>
            <button
              type="button"
              data-testid="bulk-delete-btn"
              onClick={() => {
                setDeleteModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('bulk.deleteSelected')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Spam Tab Shortcut */}
      {currentStatus === 'spam' && leadsList.length > 0 && selectedIds.size === 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            data-testid="delete-all-spam-btn"
            onClick={() => {
              setDeleteSpamModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-md bg-destructive/10 text-destructive dark:text-red-400 hover:bg-destructive/20 border border-destructive/20 dark:border-red-900/40 transition-colors"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <span>{t('bulk.deleteAllSpam')}</span>
          </button>
        </div>
      )}

      {/* Leads Table */}
      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" role="table">
            <thead className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              <tr>
                <th scope="col" className="p-3 w-10 text-center">
                  <input
                    type="checkbox"
                    aria-label={t('table.selectAll')}
                    data-testid="select-all-checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-primary cursor-pointer"
                  />
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold whitespace-nowrap">
                  {t('table.receivedAt')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold min-w-[130px]">
                  {t('table.fullName')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold min-w-[180px] max-w-[240px]">
                  {t('table.email')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold hidden lg:table-cell">
                  {t('table.phone')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold hidden md:table-cell">
                  {t('table.eventType')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold whitespace-nowrap">
                  {t('table.status')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold hidden sm:table-cell">
                  {t('table.verification')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold hidden xl:table-cell">
                  {t('table.deliveryMode')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold hidden 2xl:table-cell">
                  {t('table.autoReply')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                  {t('table.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leadsList.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-muted-foreground">
                    <p className="font-semibold text-base">
                      {searchQuery || currentStatus !== 'all'
                        ? t('table.emptyFilter')
                        : t('table.emptyTitle')}
                    </p>
                    <p className="text-xs mt-1">{t('table.emptyDescription')}</p>
                  </td>
                </tr>
              ) : (
                leadsList.map((lead) => {
                  const isChecked = selectedIds.has(lead.id);
                  const fullName =
                    [lead.givenName, lead.familyName].filter(Boolean).join(' ') || '—';
                  const dateStr = new Date(lead.receivedAt).toLocaleDateString(locale, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  });

                  return (
                    <tr
                      key={lead.id}
                      data-testid={`lead-row-${lead.id}`}
                      className={`hover:bg-muted/40 transition-colors ${
                        isChecked ? 'bg-primary/5' : ''
                      }`}
                    >
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          aria-label={t('table.selectRow', { name: fullName })}
                          data-testid={`select-lead-${lead.id}`}
                          checked={isChecked}
                          onChange={() => {
                            toggleSelectRow(lead.id);
                          }}
                          className="h-4 w-4 rounded border-input text-primary focus:ring-primary cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap text-xs">
                        {dateStr}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-foreground">
                        <Link
                          href={`/leads/${lead.id}`}
                          data-testid={`lead-link-${lead.id}`}
                          className="hover:underline font-semibold text-primary inline-flex items-center gap-1"
                        >
                          <span>{fullName}</span>
                        </Link>
                        <div className="md:hidden text-xs text-muted-foreground mt-0.5">
                          {lead.eventTypeKey ? t(`eventTypes.${lead.eventTypeKey}`) : ''}
                        </div>
                      </td>
                      <td
                        className="px-3 py-2.5 text-muted-foreground text-xs min-w-[180px] max-w-[240px] truncate"
                        title={lead.email ?? ''}
                      >
                        {lead.email ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground text-xs hidden lg:table-cell whitespace-nowrap">
                        {lead.phone ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground text-xs hidden md:table-cell">
                        {lead.eventTypeKey ? t(`eventTypes.${lead.eventTypeKey}`) : '—'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <StatusBadge status={lead.status} t={t} />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap hidden sm:table-cell">
                        <VerificationBadge verification={lead.verification} t={t} />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground hidden xl:table-cell">
                        <span className="capitalize">{t(`deliveryMode.${lead.deliveryMode}`)}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground hidden 2xl:table-cell">
                        <span>{t(`autoReplyStatus.${lead.autoReplyStatus}`)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <Link
                          href={`/leads/${lead.id}`}
                          data-testid={`lead-view-link-${lead.id}`}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                        >
                          <span>{t('table.view')}</span>
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20 text-xs">
          <span className="text-muted-foreground">{t('pagination.page', { page })}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => {
                const newPage = page - 1;
                setPage(newPage);
                updateUrl(currentStatus, searchQuery, newPage);
              }}
              className="px-3 py-1 rounded border border-border bg-background text-foreground disabled:opacity-40 disabled:pointer-events-none hover:bg-muted"
            >
              {t('pagination.prev')}
            </button>
            <button
              type="button"
              disabled={!hasMore}
              onClick={() => {
                const newPage = page + 1;
                setPage(newPage);
                updateUrl(currentStatus, searchQuery, newPage);
              }}
              className="px-3 py-1 rounded border border-border bg-background text-foreground disabled:opacity-40 disabled:pointer-events-none hover:bg-muted"
            >
              {t('pagination.next')}
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog: Delete Selected */}
      <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <DialogContent data-testid="delete-selected-modal">
          <DialogHeader>
            <DialogTitle>{t('dialogs.deleteSelectedTitle')}</DialogTitle>
            <DialogDescription className="text-sm text-zinc-700 dark:text-zinc-300">
              {t('dialogs.deleteSelectedDescription', { count: selectedIds.size })}
            </DialogDescription>
          </DialogHeader>

          {errorMsg && (
            <div
              role="alert"
              className="p-3 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 font-medium"
            >
              {errorMsg}
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => {
                setDeleteModalOpen(false);
              }}
              className="px-4 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-medium"
            >
              {t('dialogs.cancel')}
            </button>
            <button
              type="button"
              data-testid="confirm-delete-selected-btn"
              disabled={isDeleting}
              onClick={() => {
                void handleConfirmBulkDelete();
              }}
              className="px-4 py-2 text-sm rounded-md bg-red-700 hover:bg-red-800 dark:bg-red-700 dark:hover:bg-red-800 text-white font-semibold"
            >
              {isDeleting ? t('dialogs.deleting') : t('dialogs.confirmDelete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog: Delete All Spam */}
      <Dialog open={deleteSpamModalOpen} onOpenChange={setDeleteSpamModalOpen}>
        <DialogContent data-testid="delete-all-spam-modal">
          <DialogHeader>
            <DialogTitle>{t('dialogs.deleteAllSpamTitle')}</DialogTitle>
            <DialogDescription className="text-sm text-zinc-700 dark:text-zinc-300">
              {t('dialogs.deleteAllSpamDescription')}
            </DialogDescription>
          </DialogHeader>

          {errorMsg && (
            <div
              role="alert"
              className="p-3 text-xs rounded bg-destructive/10 text-destructive border border-destructive/20 font-medium"
            >
              {errorMsg}
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => {
                setDeleteSpamModalOpen(false);
              }}
              className="px-4 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-medium"
            >
              {t('dialogs.cancel')}
            </button>
            <button
              type="button"
              data-testid="confirm-delete-all-spam-btn"
              disabled={isDeleting}
              onClick={() => {
                void handleConfirmDeleteAllSpam();
              }}
              className="px-4 py-2 text-sm rounded-md bg-red-700 hover:bg-red-800 dark:bg-red-700 dark:hover:bg-red-800 text-white font-semibold"
            >
              {isDeleting ? t('dialogs.deleting') : t('dialogs.confirmDelete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status, t }: { status: LeadStatus; t: (key: string) => string }) {
  let badgeColor =
    'bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-300 border-blue-300 dark:border-blue-800';

  if (status === 'contacted') {
    badgeColor =
      'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300 border-amber-300 dark:border-amber-800';
  } else if (status === 'converted') {
    badgeColor =
      'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800';
  } else if (status === 'archived') {
    badgeColor = 'bg-muted text-foreground border-border';
  } else if (status === 'spam') {
    badgeColor =
      'bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-300 border-rose-300 dark:border-rose-800';
  }

  return (
    <span
      data-testid={`lead-status-badge-${status}`}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${badgeColor}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}

function VerificationBadge({
  verification,
  t,
}: {
  verification: 'verified' | 'unverified';
  t: (key: string) => string;
}) {
  const isVerified = verification === 'verified';
  return (
    <span
      data-testid={`lead-verification-badge-${verification}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
        isVerified
          ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
          : 'bg-muted text-foreground border-border'
      }`}
    >
      {isVerified ? (
        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
      ) : (
        <ShieldAlert className="h-3 w-3" aria-hidden="true" />
      )}
      <span>{t(`verification.${verification}`)}</span>
    </span>
  );
}
