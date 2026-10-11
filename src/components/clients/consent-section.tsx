'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  CircleDashed,
  Plus,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { ClientConsentsResult, ConsentItemView } from '@/server/consents/repo';
import { listConsentsAction } from '@/server/consents/actions';
import { formatDate } from '@/lib/formatters';
import { ConsentDialog } from './consent-dialog';

export interface ConsentSectionProps {
  clientId: string;
  locale: string;
  studioTimezone: string;
  initialConsents?: ClientConsentsResult;
  contacts: { id: string; name: string; isPrimary: boolean }[];
  onConsentRecorded?: (message: string) => void;
}

export function ConsentSection({
  clientId,
  locale,
  studioTimezone,
  initialConsents,
  contacts,
  onConsentRecorded,
}: ConsentSectionProps) {
  const t = useTranslations('clients.consent');

  const [consentsData, setConsentsData] = React.useState<ClientConsentsResult>(() => {
    if (initialConsents) return initialConsents;
    return {
      clientId,
      contacts: contacts.map((c) => ({
        contactId: c.id,
        contactName: c.name,
        isPrimary: c.isPrimary,
        marketing: null,
        imageUsage: null,
        history: [],
      })),
    };
  });

  // Track expanded history per contact
  const [expandedContacts, setExpandedContacts] = React.useState<Set<string>>(() => new Set());

  // Dialog state
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selectedContactId, setSelectedContactId] = React.useState<string | undefined>(undefined);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const toggleHistory = (contactId: string) => {
    setExpandedContacts((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }
      return next;
    });
  };

  const handleOpenDialog = (targetContactId?: string, buttonEl?: HTMLButtonElement | null) => {
    if (buttonEl) {
      (triggerRef as { current: HTMLButtonElement | null }).current = buttonEl;
    }
    setSelectedContactId(targetContactId ?? contacts[0]?.id);
    setDialogOpen(true);
  };

  const reloadConsents = async () => {
    try {
      const res = await listConsentsAction({ clientId });
      if (res.success) {
        setConsentsData(res.data);
      }
    } catch {
      // Non-fatal
    }
  };

  const handleSuccess = (message: string) => {
    void reloadConsents();
    onConsentRecorded?.(message);
  };

  const dialogContacts = contacts.map((c) => ({ id: c.id, name: c.name }));

  const renderStatusRow = (
    purposeKey: 'marketing' | 'image_usage',
    title: string,
    record: ConsentItemView | null,
    contactId: string,
  ) => {
    let statusText: string;
    let icon;

    if (!record) {
      statusText = t('noConsent');
      icon = <CircleDashed className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />;
    } else if (record.status === 'granted') {
      const formattedDate = formatDate(record.effectiveOn, locale, {
        timeZone: studioTimezone,
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const methodLabel = t(`methods.${record.method}`);
      statusText = `${t('grantedOn', { date: formattedDate })} · ${methodLabel}`;
      if (record.scope) {
        statusText += ` · ${t('scopePrefix', { scope: record.scope })}`;
      }
      icon = (
        <CheckCircle2
          className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0"
          aria-hidden="true"
        />
      );
    } else {
      const formattedDate = formatDate(record.effectiveOn, locale, {
        timeZone: studioTimezone,
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const methodLabel = t(`methods.${record.method}`);
      statusText = `${t('withdrawnOn', { date: formattedDate })} · ${methodLabel}`;
      icon = (
        <XCircle
          className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0"
          aria-hidden="true"
        />
      );
    }

    return (
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-sm py-1.5"
        data-testid={`consent-row-${contactId}-${purposeKey}`}
      >
        <span className="font-medium text-foreground min-w-[140px]">{title}</span>
        <div className="flex items-center gap-2 flex-1 sm:justify-end text-muted-foreground">
          {icon}
          <span
            className={
              record?.status === 'granted' ? 'text-foreground font-medium' : 'text-muted-foreground'
            }
            data-testid={`consent-status-${contactId}-${purposeKey}`}
          >
            {statusText}
          </span>
        </div>
      </div>
    );
  };

  return (
    <section
      aria-labelledby="consent-heading"
      className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-4"
    >
      <div className="flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2
            id="consent-heading"
            tabIndex={-1}
            className="text-lg font-semibold text-foreground focus:outline-none"
          >
            {t('title')}
          </h2>
        </div>
        <button
          ref={triggerRef}
          type="button"
          onClick={(e) => {
            handleOpenDialog(undefined, e.currentTarget);
          }}
          className="inline-flex items-center rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[36px]"
          data-testid="record-consent-btn"
        >
          <Plus className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
          <span>{t('recordChange')}</span>
        </button>
      </div>

      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noConsent')}</p>
      ) : (
        <div className="space-y-6 divide-y divide-border">
          {contacts.map((contact, idx) => {
            const summary = consentsData.contacts.find((c) => c.contactId === contact.id) ?? {
              contactId: contact.id,
              contactName: contact.name,
              isPrimary: contact.isPrimary,
              marketing: null,
              imageUsage: null,
              history: [],
            };

            const isExpanded = expandedContacts.has(contact.id);
            const historyId = `consent-history-${contact.id}`;

            return (
              <div
                key={contact.id}
                className={`space-y-3 ${idx > 0 ? 'pt-5' : ''}`}
                data-testid={`consent-contact-card-${contact.id}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">{contact.name}</span>
                    {contact.isPrimary && (
                      <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">
                        Primary
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      handleOpenDialog(contact.id, e.currentTarget);
                    }}
                    className="inline-flex items-center rounded-md border border-input bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[32px]"
                    data-testid={`record-consent-contact-btn-${contact.id}`}
                    aria-label={t('recordChangeFor', { name: contact.name })}
                  >
                    <Plus className="h-3 w-3 mr-1" aria-hidden="true" />
                    <span>{t('recordChange')}</span>
                  </button>
                </div>

                {/* Per-Purpose Current Status */}
                <div className="space-y-1 rounded-md bg-muted/30 p-3 border border-border/50">
                  {renderStatusRow(
                    'marketing',
                    t('purposes.marketing'),
                    summary.marketing,
                    contact.id,
                  )}
                  <div className="border-t border-border/40" />
                  {renderStatusRow(
                    'image_usage',
                    t('purposes.image_usage'),
                    summary.imageUsage,
                    contact.id,
                  )}
                </div>

                {/* Expandable History (AC-10) */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      toggleHistory(contact.id);
                    }}
                    aria-expanded={isExpanded}
                    aria-controls={historyId}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-h-[28px]"
                    data-testid={`consent-history-toggle-${contact.id}`}
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{t('history.toggleHide')}</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{t('history.toggleShow', { count: summary.history.length })}</span>
                      </>
                    )}
                  </button>

                  {isExpanded && (
                    <div
                      id={historyId}
                      className="mt-2 space-y-2 pl-2 border-l-2 border-primary/30"
                      data-testid={`consent-history-list-${contact.id}`}
                    >
                      {summary.history.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t('history.empty')}</p>
                      ) : (
                        summary.history.map((item) => {
                          const itemDate = formatDate(item.effectiveOn, locale, {
                            timeZone: studioTimezone,
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          });
                          const purposeLabel = t(`purposes.${item.purpose}`);
                          const statusLabel = t(`statuses.${item.status}`);
                          const methodLabel = t(`methods.${item.method}`);

                          return (
                            <div
                              key={item.id}
                              className="text-xs text-foreground bg-muted/20 p-2.5 rounded border border-border/40 space-y-1"
                              data-testid={`consent-history-item-${item.id}`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1">
                                <span className="font-semibold text-foreground">
                                  {purposeLabel} ·{' '}
                                  <span
                                    className={
                                      item.status === 'granted'
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-amber-600 dark:text-amber-400'
                                    }
                                  >
                                    {statusLabel}
                                  </span>
                                </span>
                                <time dateTime={item.effectiveOn} className="text-muted-foreground">
                                  {itemDate} · {methodLabel}
                                </time>
                              </div>
                              {item.scope && (
                                <p className="text-muted-foreground">
                                  {t('scopePrefix', { scope: item.scope })}
                                </p>
                              )}
                              {item.evidenceNote && (
                                <p className="text-muted-foreground italic">
                                  {t('evidencePrefix', { note: item.evidenceNote })}
                                </p>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Record Consent Change Dialog */}
      <ConsentDialog
        clientId={clientId}
        contacts={dialogContacts}
        initialContactId={selectedContactId}
        studioTimezone={studioTimezone}
        isOpen={dialogOpen}
        onOpenChange={setDialogOpen}
        triggerRef={triggerRef}
        onSuccess={handleSuccess}
      />
    </section>
  );
}
