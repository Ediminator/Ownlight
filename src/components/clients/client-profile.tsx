'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Tag,
  UserCheck,
  Pencil,
  Plus,
  Trash2,
  CheckCircle2,
  Download,
  UserX,
  Cloud,
  FolderKanban,
  CheckSquare,
} from 'lucide-react';
import type { ClientWithRelations, ClientTagItem } from '@/server/clients/repo';
import type { ClientProjectSummary } from '@/server/projects/service';
import type { ClientGoogleSyncStatus } from '@/server/integrations/google/outbox';
import type { ErasureSubject } from '@/server/privacy/erasure/types';
import type {
  Client,
  ClientContact,
  ClientAddress,
  ClientKind,
  ClientLocale,
  AddressType,
} from '@/server/db/schema/clients';
import { formatDateTime, formatCurrency, formatDate } from '@/lib/formatters';
import { getLocalizedCountryName } from '@/lib/countries';
import {
  removeContactAction,
  removeAddressAction,
  getClientAction,
} from '@/server/clients/actions';
import { getClientErrorMessage } from '@/lib/client-errors';
import { EditDetailsDialog } from './edit-details-dialog';
import { ContactDialog } from './contact-dialog';
import { AddressDialog } from './address-dialog';
import { TagsDialog } from './tags-dialog';
import { ConfirmDialog } from './confirm-dialog';
import { ClientTimeline } from './client-timeline';
import { ConsentSection } from './consent-section';
import { ExportDataDialog } from './export-data-dialog';
import { ErasureDialog } from './erasure-dialog';
import { LegalHoldSection, type ClientLegalHoldData, isHoldActiveDate } from './legal-hold-section';
import { RetentionIndicator } from './retention-indicator';
import type { ListTimelineResult } from '@/server/timeline/repo';
import type { ClientConsentsResult } from '@/server/consents/repo';

export interface ClientProfileProps {
  clientData: ClientWithRelations;
  locale: string;
  studioTimezone: string;
  initialTimeline?: ListTimelineResult;
  initialConsents?: ClientConsentsResult;
  initialLegalHold?: ClientLegalHoldData | null;
  retentionMonths?: number;
  initialProjects?: ClientProjectSummary[];
}

export function ClientProfile({
  clientData,
  locale,
  studioTimezone,
  initialTimeline,
  initialConsents,
  initialLegalHold,
  retentionMonths,
  initialProjects = [],
}: ClientProfileProps) {
  const t = useTranslations('clients.profile');
  const tForm = useTranslations('clients.form');
  const tErrors = useTranslations('clients.errors');
  const tDanger = useTranslations('clients.dangerZone');
  const tErasure = useTranslations('privacy.erasure');
  const tGoogleSync = useTranslations('clients.googleSync');
  const searchParams = useSearchParams();
  const router = useRouter();

  // Component state
  const [client, setClient] = React.useState<Client>(clientData.client);
  const [contacts, setContacts] = React.useState<ClientContact[]>(clientData.contacts);
  const [addresses, setAddresses] = React.useState<ClientAddress[]>(clientData.addresses);
  const [tags, setTags] = React.useState<ClientTagItem[]>(clientData.tags);
  const projects = initialProjects ?? [];

  // Status message for screen reader announcements and banner (AC-1, AC-13)
  const [statusMessage, setStatusMessage] = React.useState<string | null>(() =>
    searchParams.get('created') === '1' ? tForm('createdSuccess') : null,
  );

  // Focus targets for post-save keyboard navigation (AC-13)
  const statusRef = React.useRef<HTMLDivElement>(null);
  const detailsHeadingRef = React.useRef<HTMLHeadingElement>(null);
  const contactsHeadingRef = React.useRef<HTMLHeadingElement>(null);
  const addressesHeadingRef = React.useRef<HTMLHeadingElement>(null);
  const tagsSectionRef = React.useRef<HTMLDivElement>(null);

  // Trigger refs for post-dismiss focus restoration (AC-13)
  const editDetailsTriggerRef = React.useRef<HTMLButtonElement>(null);
  const contactTriggerRef = React.useRef<HTMLElement | null>(null);
  const addressTriggerRef = React.useRef<HTMLElement | null>(null);
  const tagsTriggerRef = React.useRef<HTMLElement | null>(null);
  const confirmTriggerRef = React.useRef<HTMLElement | null>(null);
  const deleteClientTriggerRef = React.useRef<HTMLButtonElement>(null);
  const erasureTriggerRef = React.useRef<HTMLElement | null>(null);

  // Dialog open states
  const [editDetailsOpen, setEditDetailsOpen] = React.useState(
    () => searchParams.get('edit') === 'true' || searchParams.get('edit') === '1',
  );
  const [contactDialogOpen, setContactDialogOpen] = React.useState(false);
  const [editingContact, setEditingContact] = React.useState<ClientContact | null>(null);
  const [addressDialogOpen, setAddressDialogOpen] = React.useState(false);
  const [editingAddress, setEditingAddress] = React.useState<ClientAddress | null>(null);
  const [tagsDialogOpen, setTagsDialogOpen] = React.useState(false);

  // Confirm removal dialog states
  const [removeContactTarget, setRemoveContactTarget] = React.useState<ClientContact | null>(null);
  const [removeContactError, setRemoveContactError] = React.useState<string | null>(null);
  const [isRemovingContact, setIsRemovingContact] = React.useState(false);

  const [removeAddressTarget, setRemoveAddressTarget] = React.useState<AddressType | null>(null);
  const [removeAddressError, setRemoveAddressError] = React.useState<string | null>(null);
  const [isRemovingAddress, setIsRemovingAddress] = React.useState(false);

  // DSAR personal data export dialog states (TASK-0015)
  const [exportContactTarget, setExportContactTarget] = React.useState<ClientContact | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = React.useState(false);

  // Erasure dialog states (TASK-0016)
  const [erasureSubject, setErasureSubject] = React.useState<ErasureSubject | null>(null);
  const [erasureDialogOpen, setErasureDialogOpen] = React.useState(false);
  const [erasureContactName, setErasureContactName] = React.useState<string | undefined>(undefined);

  // Legal hold state (TASK-0019)
  const [currentHold, setCurrentHold] = React.useState<ClientLegalHoldData | null>(
    initialLegalHold ?? null,
  );
  const isHoldActive = currentHold ? isHoldActiveDate(currentHold.until, studioTimezone) : false;

  // Google Contacts sync status (TASK-0021)
  const [syncStatus, setSyncStatus] = React.useState<ClientGoogleSyncStatus>(
    clientData.googleSyncStatus ??
      (clientData.client.googleContactsSyncEnabled ? 'synced' : 'not_synced'),
  );

  // Focus announcement on mount if created (AC-1)
  React.useEffect(() => {
    if (statusMessage) {
      statusRef.current?.focus();
    }
  }, [statusMessage]);

  const announceAndFocus = (message: string, targetRef?: React.RefObject<HTMLElement | null>) => {
    setStatusMessage(message);
    setTimeout(() => {
      if (targetRef?.current) {
        targetRef.current.focus();
      } else {
        statusRef.current?.focus();
      }
    }, 50);
  };

  const refreshClientData = async () => {
    try {
      const res = await getClientAction({ clientId: client.id });
      if (res.success) {
        setClient(res.data.client);
        setContacts(res.data.contacts);
        setAddresses(res.data.addresses);
        setTags(res.data.tags);
      }
    } catch {
      // Non-fatal
    }
  };

  // Edit details success
  const handleDetailsSuccess = (updated: {
    kind: ClientKind;
    displayName: string;
    preferredLocale: ClientLocale;
    googleContactsSyncEnabled?: boolean;
  }) => {
    setClient((prev) => ({
      ...prev,
      kind: updated.kind,
      displayName: updated.displayName,
      preferredLocale: updated.preferredLocale,
      googleContactsSyncEnabled:
        updated.googleContactsSyncEnabled ?? prev.googleContactsSyncEnabled,
    }));
    if (updated.googleContactsSyncEnabled !== undefined) {
      setSyncStatus(updated.googleContactsSyncEnabled ? 'pending' : 'not_synced');
    }
    announceAndFocus(tForm('savedSuccess'), detailsHeadingRef);
  };

  // Contact add/edit success
  const handleContactSuccess = async () => {
    await refreshClientData();
    announceAndFocus(tForm('savedSuccess'), contactsHeadingRef);
  };

  // Confirm remove contact
  const handleConfirmRemoveContact = async () => {
    if (!removeContactTarget || isRemovingContact) return;

    setIsRemovingContact(true);
    setRemoveContactError(null);

    try {
      const res = await removeContactAction({
        clientId: client.id,
        contactId: removeContactTarget.id,
      });

      if (!res.success) {
        // AC-6: Single contact removal shows localized CLIENT_NEEDS_CONTACT message
        setRemoveContactError(getClientErrorMessage(res.code, tErrors));
        return;
      }

      await refreshClientData();
      setRemoveContactTarget(null);
      announceAndFocus(tForm('savedSuccess'), contactsHeadingRef);
    } catch {
      setRemoveContactError(tErrors('GENERIC_ERROR'));
    } finally {
      setIsRemovingContact(false);
    }
  };

  // Address add/edit success
  const handleAddressSuccess = async () => {
    await refreshClientData();
    announceAndFocus(tForm('savedSuccess'), addressesHeadingRef);
  };

  // Confirm remove address
  const handleConfirmRemoveAddress = async () => {
    if (!removeAddressTarget || isRemovingAddress) return;

    setIsRemovingAddress(true);
    setRemoveAddressError(null);

    try {
      const res = await removeAddressAction({
        clientId: client.id,
        type: removeAddressTarget,
      });

      if (!res.success) {
        setRemoveAddressError(getClientErrorMessage(res.code, tErrors));
        return;
      }

      await refreshClientData();
      setRemoveAddressTarget(null);
      announceAndFocus(tForm('savedSuccess'), addressesHeadingRef);
    } catch {
      setRemoveAddressError(tErrors('GENERIC_ERROR'));
    } finally {
      setIsRemovingAddress(false);
    }
  };

  // Tags success
  const handleTagsSuccess = (newTags: ClientTagItem[]) => {
    setTags(newTags);
    announceAndFocus(tForm('savedSuccess'), tagsSectionRef);
  };

  const cleanPhoneForHref = (phone: string | null) => {
    if (!phone) return '';
    return phone.replace(/[^\d+]/g, '');
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto" data-testid="client-profile-view">
      {/* Back Link */}
      <div>
        <Link
          href={`/${locale}/clients`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-2 py-1 min-h-[44px]"
          data-testid="back-to-directory-link"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{t('backToDirectory')}</span>
        </Link>
      </div>

      {/* Localized status announcement banner (AC-1, AC-13) */}
      {statusMessage && (
        <div
          ref={statusRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className="rounded-lg border border-primary/30 bg-primary/10 p-4 text-primary flex items-center justify-between gap-3 focus:outline-none focus:ring-2 focus:ring-primary"
          data-testid="profile-status-message"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>{statusMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setStatusMessage(null);
            }}
            className="text-xs font-semibold hover:underline rounded p-1 min-h-[32px] min-w-[32px]"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header Card (Details + Tags) */}
      <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-2 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                data-testid="client-kind-badge"
              >
                {client.kind === 'company' ? t('kind.company') : t('kind.person')}
              </span>
              <span
                className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                data-testid="client-locale-badge"
              >
                {t('preferredLanguage')}:{' '}
                {client.preferredLocale === 'de' ? t('language.de') : t('language.en')}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium border ${
                  syncStatus === 'synced'
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                    : syncStatus === 'pending'
                      ? 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                      : syncStatus === 'failed'
                        ? 'bg-destructive/10 text-destructive border-destructive/20 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800'
                        : 'bg-muted text-muted-foreground border-border'
                }`}
                data-testid="google-sync-status-badge"
              >
                <Cloud className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span>
                  {syncStatus === 'synced'
                    ? tGoogleSync('statusSynced')
                    : syncStatus === 'pending'
                      ? tGoogleSync('statusPending')
                      : syncStatus === 'failed'
                        ? tGoogleSync('statusFailed')
                        : tGoogleSync('statusNotSynced')}
                </span>
              </span>
            </div>

            <h1
              ref={detailsHeadingRef}
              tabIndex={-1}
              className="text-2xl md:text-3xl font-bold tracking-tight text-foreground break-words focus:outline-none"
              data-testid="client-display-name"
            >
              {client.displayName}
            </h1>
          </div>

          {/* Edit Client Details Button */}
          <button
            type="button"
            ref={editDetailsTriggerRef}
            onClick={() => {
              setEditDetailsOpen(true);
            }}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] shrink-0"
            data-testid="edit-client-details-btn"
          >
            <Pencil className="h-4 w-4 mr-1.5" aria-hidden="true" />
            <span>{t('editDetails')}</span>
          </button>
        </div>

        {/* Tags Section */}
        <div
          ref={tagsSectionRef}
          tabIndex={-1}
          className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t focus:outline-none"
          data-testid="client-tags-section"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-xs font-medium text-muted-foreground mr-1">{t('tags')}:</span>
            {tags.length > 0 ? (
              tags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
                  data-testid={`client-tag-${tag.name}`}
                >
                  {tag.name}
                </span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">{t('noTags')}</span>
            )}
          </div>

          {/* Edit Tags Button */}
          <button
            type="button"
            onClick={(e) => {
              tagsTriggerRef.current = e.currentTarget;
              setTagsDialogOpen(true);
            }}
            className="inline-flex items-center rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring px-2 py-1 min-h-[36px]"
            data-testid="edit-tags-btn"
          >
            <Pencil className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
            <span>{t('editTags')}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Contacts Section */}
        <section
          aria-labelledby="contacts-heading"
          className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2
                id="contacts-heading"
                ref={contactsHeadingRef}
                tabIndex={-1}
                className="text-lg font-semibold text-foreground focus:outline-none"
              >
                {t('contactsTitle')}
              </h2>
            </div>
            <button
              type="button"
              onClick={(e) => {
                contactTriggerRef.current = e.currentTarget;
                setEditingContact(null);
                setContactDialogOpen(true);
              }}
              className="inline-flex items-center rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[36px]"
              data-testid="add-contact-btn"
            >
              <Plus className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              <span>{t('addContact')}</span>
            </button>
          </div>

          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noContacts')}</p>
          ) : (
            <div className="space-y-4 divide-y divide-border">
              {contacts.map((contact, idx) => {
                const fullName =
                  [contact.givenName, contact.familyName].filter(Boolean).join(' ') ||
                  client.displayName;
                const cleanPhone = cleanPhoneForHref(contact.phone);

                return (
                  <div
                    key={contact.id}
                    className={`space-y-2 ${idx > 0 ? 'pt-4' : ''}`}
                    data-testid={`contact-card-${contact.id}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-foreground">{fullName}</span>
                        {contact.isPrimary && (
                          <span
                            className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium"
                            data-testid="primary-contact-badge"
                          >
                            {t('primaryBadge')}
                          </span>
                        )}
                      </div>

                      {/* Contact Action Buttons */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            contactTriggerRef.current = e.currentTarget;
                            setExportContactTarget(contact);
                            setExportDialogOpen(true);
                          }}
                          className="rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[32px] min-w-[32px] flex items-center justify-center"
                          data-testid={`export-contact-btn-${contact.id}`}
                          aria-label={`${t('exportData')}: ${fullName}`}
                          title={t('exportData')}
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            contactTriggerRef.current = e.currentTarget;
                            setEditingContact(contact);
                            setContactDialogOpen(true);
                          }}
                          className="rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[32px] min-w-[32px] flex items-center justify-center"
                          data-testid={`edit-contact-btn-${contact.id}`}
                          aria-label={`${t('editContact')}: ${fullName}`}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            confirmTriggerRef.current = e.currentTarget;
                            setRemoveContactTarget(contact);
                            setRemoveContactError(null);
                          }}
                          className="rounded p-1.5 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[32px] min-w-[32px] flex items-center justify-center"
                          data-testid={`remove-contact-btn-${contact.id}`}
                          aria-label={`${t('removeContact')}: ${fullName}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            erasureTriggerRef.current = e.currentTarget;
                            setErasureSubject({
                              kind: 'contact',
                              clientId: client.id,
                              contactId: contact.id,
                            });
                            setErasureContactName(fullName);
                            setErasureDialogOpen(true);
                          }}
                          className="rounded p-1.5 text-red-700 dark:text-red-400 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[32px] min-w-[32px] flex items-center justify-center"
                          data-testid={`erase-contact-btn-${contact.id}`}
                          aria-label={`${t('erasePerson')}: ${fullName}`}
                          title={t('erasePerson')}
                        >
                          <UserX className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-sm">
                      {contact.email && (
                        <div className="flex items-center gap-2">
                          <Mail
                            className="h-4 w-4 text-muted-foreground shrink-0"
                            aria-hidden="true"
                          />
                          <a
                            href={`mailto:${contact.email}`}
                            className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-h-[24px] inline-flex items-center break-all"
                            data-testid={`contact-email-link-${contact.id}`}
                          >
                            {contact.email}
                          </a>
                        </div>
                      )}

                      {contact.phone && (
                        <div className="flex items-center gap-2">
                          <Phone
                            className="h-4 w-4 text-muted-foreground shrink-0"
                            aria-hidden="true"
                          />
                          <a
                            href={`tel:${cleanPhone}`}
                            className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-h-[24px] inline-flex items-center"
                            data-testid={`contact-phone-link-${contact.id}`}
                          >
                            {contact.phone}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Addresses Section */}
        <section
          aria-labelledby="addresses-heading"
          className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2
                id="addresses-heading"
                ref={addressesHeadingRef}
                tabIndex={-1}
                className="text-lg font-semibold text-foreground focus:outline-none"
              >
                {t('addressesTitle')}
              </h2>
            </div>
            <button
              type="button"
              onClick={(e) => {
                addressTriggerRef.current = e.currentTarget;
                setEditingAddress(null);
                setAddressDialogOpen(true);
              }}
              className="inline-flex items-center rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[36px]"
              data-testid="add-address-btn"
            >
              <Plus className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              <span>{t('addAddress')}</span>
            </button>
          </div>

          {addresses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noAddresses')}</p>
          ) : (
            <div className="space-y-4 divide-y divide-border">
              {addresses.map((addr, idx) => (
                <div
                  key={addr.id}
                  className={`space-y-1 text-sm ${idx > 0 ? 'pt-4' : ''}`}
                  data-testid={`address-card-${addr.type}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-medium text-xs uppercase tracking-wider text-muted-foreground block">
                      {addr.type === 'billing' ? t('addressType.billing') : t('addressType.postal')}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          addressTriggerRef.current = e.currentTarget;
                          setEditingAddress(addr);
                          setAddressDialogOpen(true);
                        }}
                        className="rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[32px] min-w-[32px] flex items-center justify-center"
                        data-testid={`edit-address-btn-${addr.type}`}
                        aria-label={`${t('editAddress')}: ${addr.type}`}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          confirmTriggerRef.current = e.currentTarget;
                          setRemoveAddressTarget(addr.type);
                          setRemoveAddressError(null);
                        }}
                        className="rounded p-1.5 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[32px] min-w-[32px] flex items-center justify-center"
                        data-testid={`remove-address-btn-${addr.type}`}
                        aria-label={`${t('removeAddress')}: ${addr.type}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <div className="text-foreground">{addr.line1}</div>
                  {addr.line2 && <div className="text-foreground">{addr.line2}</div>}
                  <div className="text-foreground">
                    {addr.postalCode} {addr.city}
                  </div>
                  {addr.region && <div className="text-muted-foreground">{addr.region}</div>}
                  <div className="font-medium text-foreground">
                    {getLocalizedCountryName(addr.countryCode, locale)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Consent Section (TASK-0014) */}
      <ConsentSection
        clientId={client.id}
        locale={locale}
        studioTimezone={studioTimezone}
        initialConsents={initialConsents}
        contacts={contacts.map((c) => ({
          id: c.id,
          name: [c.givenName, c.familyName].filter(Boolean).join(' ') || 'Unnamed Contact',
          isPrimary: c.isPrimary,
        }))}
        onConsentRecorded={(msg) => {
          announceAndFocus(msg);
        }}
      />

      {/* Projects Section (TASK-0038 / AC-6) */}
      <section
        aria-labelledby="client-projects-heading"
        className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-4"
        data-testid="client-projects-section"
      >
        {(() => {
          const projectList = projects ?? [];
          return (
            <>
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2">
                  <FolderKanban className="h-5 w-5 text-primary" aria-hidden="true" />
                  <h2
                    id="client-projects-heading"
                    className="text-lg font-semibold text-foreground"
                  >
                    {t('projectsTitle')}
                  </h2>
                </div>
                {projectList.length > 0 && (
                  <span
                    className="text-xs font-medium text-muted-foreground"
                    data-testid="client-projects-count"
                  >
                    {projectList.length}
                  </span>
                )}
              </div>

              {projectList.length === 0 ? (
                <p
                  className="text-sm text-muted-foreground py-2"
                  data-testid="client-projects-empty"
                >
                  {t('noProjects')}
                </p>
              ) : (
                <div
                  className="grid grid-cols-1 md:grid-cols-2 gap-3"
                  data-testid="client-projects-list"
                >
                  {projectList.map((p) => {
                    const formattedDate = p.primaryShootStartsAt
                      ? formatDate(p.primaryShootStartsAt, locale, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : null;
                    const formattedPrice =
                      p.priceMinor !== null
                        ? formatCurrency(p.priceMinor, p.currency, locale)
                        : null;

                    return (
                      <div
                        key={p.id}
                        className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-2xs hover:shadow-sm transition-all space-y-2 flex flex-col justify-between"
                        data-testid={`client-project-card-${p.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <Link
                            href={`/${locale}/projects/${p.id}`}
                            className="font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded text-sm sm:text-base leading-snug line-clamp-2"
                            data-testid={`client-project-link-${p.id}`}
                          >
                            {p.title}
                          </Link>

                          <span
                            data-testid={`client-project-stage-${p.id}`}
                            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize shrink-0 bg-primary/10 text-primary border border-primary/20"
                          >
                            {p.stageName}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-1">
                          <span
                            data-testid={`client-project-date-${p.id}`}
                            className="inline-flex items-center gap-1"
                          >
                            <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span>{formattedDate ?? t('noShootDate')}</span>
                          </span>

                          {p.taskCount > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <CheckSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span>
                                {t('tasksCount', {
                                  completed: p.completedTaskCount,
                                  total: p.taskCount,
                                })}
                              </span>
                            </span>
                          )}

                          {formattedPrice && (
                            <span className="font-medium text-foreground ml-auto">
                              {formattedPrice}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          );
        })()}
      </section>

      {/* Timeline & Notes Section (TASK-0013) */}
      <ClientTimeline
        clientId={client.id}
        locale={locale}
        studioTimezone={studioTimezone}
        initialItems={initialTimeline?.items}
        initialNextCursor={initialTimeline?.nextCursor}
      />

      {/* Timestamps Section */}
      <section
        aria-labelledby="activity-heading"
        className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-3"
      >
        <div className="flex items-center gap-2 border-b pb-3">
          <Calendar className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 id="activity-heading" className="text-lg font-semibold text-foreground">
            {t('activityTitle')}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">
              {t('createdAt')}
            </span>
            <span className="font-medium text-foreground" data-testid="client-created-date">
              {formatDateTime(client.createdAt, locale, { timeZone: studioTimezone })}
            </span>
          </div>

          <div>
            <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">
              {t('lastActivityAt')}
            </span>
            <span className="font-medium text-foreground" data-testid="client-last-activity-date">
              {formatDateTime(client.lastActivityAt, locale, { timeZone: studioTimezone })}
            </span>
          </div>
        </div>
      </section>

      {/* Retention & Erasure Indicator (AC-20) */}
      <RetentionIndicator
        lastActivityAt={client.lastActivityAt}
        hasActiveHold={isHoldActive}
        retentionMonths={retentionMonths}
        locale={locale}
      />

      {/* Legal Hold Section (AC-16, AC-17) */}
      <LegalHoldSection
        clientId={client.id}
        initialHold={initialLegalHold}
        studioTimezone={studioTimezone}
        locale={locale}
        onHoldChange={(newHold) => {
          setCurrentHold(newHold);
        }}
      />

      {/* Danger Zone Section (AC-10) */}
      <section
        aria-labelledby="danger-zone-heading"
        className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-card-foreground shadow-sm space-y-4"
        data-testid="danger-zone-section"
      >
        <div className="border-b border-destructive/20 pb-3">
          <h2
            id="danger-zone-heading"
            className="text-lg font-semibold text-red-700 dark:text-red-400"
          >
            {tDanger('title')}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">{tDanger('description')}</p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {tDanger('deleteClientTitle')}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tDanger('deleteClientDescription')}
            </p>
          </div>
          <button
            type="button"
            ref={deleteClientTriggerRef}
            onClick={() => {
              erasureTriggerRef.current = deleteClientTriggerRef.current;
              setErasureSubject({ kind: 'client', clientId: client.id });
              setErasureContactName(undefined);
              setErasureDialogOpen(true);
            }}
            className="inline-flex items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground shadow-sm hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 min-h-[44px] shrink-0"
            data-testid="delete-client-btn"
          >
            <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
            <span>{tDanger('deleteClientButton')}</span>
          </button>
        </div>
      </section>

      {/* Dialogs */}
      <EditDetailsDialog
        client={client}
        isOpen={editDetailsOpen}
        onOpenChange={setEditDetailsOpen}
        triggerRef={editDetailsTriggerRef}
        onSuccess={handleDetailsSuccess}
      />

      <ContactDialog
        clientId={client.id}
        locale={locale}
        isOpen={contactDialogOpen}
        onOpenChange={setContactDialogOpen}
        contactToEdit={editingContact}
        triggerRef={contactTriggerRef}
        onSuccess={() => {
          void handleContactSuccess();
        }}
      />

      <AddressDialog
        clientId={client.id}
        locale={locale}
        isOpen={addressDialogOpen}
        onOpenChange={setAddressDialogOpen}
        addressToEdit={editingAddress}
        triggerRef={addressTriggerRef}
        onSuccess={() => {
          void handleAddressSuccess();
        }}
      />

      <TagsDialog
        clientId={client.id}
        isOpen={tagsDialogOpen}
        onOpenChange={setTagsDialogOpen}
        currentTags={tags}
        triggerRef={tagsTriggerRef}
        onSuccess={handleTagsSuccess}
      />

      {/* Confirm Remove Contact Dialog (AC-6) */}
      <ConfirmDialog
        isOpen={Boolean(removeContactTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveContactTarget(null);
            setRemoveContactError(null);
          }
        }}
        title={tForm('removeContactTitle')}
        description={tForm('removeContactConfirm')}
        errorMessage={removeContactError}
        isSubmitting={isRemovingContact}
        triggerRef={confirmTriggerRef}
        onConfirm={() => {
          void handleConfirmRemoveContact();
        }}
      />

      {/* Confirm Remove Address Dialog (AC-7) */}
      <ConfirmDialog
        isOpen={Boolean(removeAddressTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveAddressTarget(null);
            setRemoveAddressError(null);
          }
        }}
        title={tForm('removeAddressTitle')}
        description={tForm('removeAddressConfirm')}
        errorMessage={removeAddressError}
        isSubmitting={isRemovingAddress}
        triggerRef={confirmTriggerRef}
        onConfirm={() => {
          void handleConfirmRemoveAddress();
        }}
      />

      {/* Export Personal Data Dialog (AC-9, TASK-0015) */}
      <ExportDataDialog
        contact={exportContactTarget}
        clientDisplayName={client.displayName}
        preferredLocale={client.preferredLocale}
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        triggerRef={contactTriggerRef}
        onDownloadStarted={() => {
          announceAndFocus(t('exportDataDescription'), contactTriggerRef);
        }}
      />

      {/* Erasure Dialog (AC-10, TASK-0016) */}
      <ErasureDialog
        subject={erasureSubject}
        clientDisplayName={client.displayName}
        contactName={erasureContactName}
        open={erasureDialogOpen}
        onOpenChange={(open) => {
          setErasureDialogOpen(open);
          if (!open) {
            setErasureSubject(null);
            setErasureContactName(undefined);
          }
        }}
        triggerRef={erasureTriggerRef}
        onSuccess={(subjectKind) => {
          if (subjectKind === 'client') {
            router.push(`/${locale}/clients?deleted=1`);
          } else {
            void refreshClientData();
            announceAndFocus(tErasure('successContact'), contactsHeadingRef);
          }
        }}
      />
    </div>
  );
}
