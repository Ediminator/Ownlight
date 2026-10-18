'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Users,
  Plus,
  Trash2,
  Mail,
  Phone,
  Star,
  ShieldCheck,
  Briefcase,
  Loader2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ProjectDetailParticipant } from '@/server/projects/service';
import {
  createProjectParticipantAction,
  deleteProjectParticipantAction,
} from '@/server/projects/actions';

export interface ClientContactOption {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface ParticipantsSectionProps {
  projectId: string;
  participants: ProjectDetailParticipant[];
  clientContacts: ClientContactOption[];
  locale: string;
  onParticipantsChange?: (participants: ProjectDetailParticipant[]) => void;
}

export function ParticipantsSection({
  projectId,
  participants: initialParticipants,
  clientContacts,
  onParticipantsChange,
}: ParticipantsSectionProps) {
  const t = useTranslations('projects.detail.participants');
  const tDetail = useTranslations('projects.detail');

  const [participants, setParticipants] =
    React.useState<ProjectDetailParticipant[]>(initialParticipants);

  // Add Participant State
  const [isAddOpen, setIsAddOpen] = React.useState(false);
  const [sourceType, setSourceType] = React.useState<'client' | 'vendor'>('vendor');
  const [contactId, setContactId] = React.useState<string>('');
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [isPrimary, setIsPrimary] = React.useState(false);
  const [notes, setNotes] = React.useState('');
  const [isAdding, setIsAdding] = React.useState(false);
  const [addError, setAddError] = React.useState<string | null>(null);

  // Delete Participant State
  const [deletingParticipant, setDeletingParticipant] =
    React.useState<ProjectDetailParticipant | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const handleOpenAdd = () => {
    // If client contacts available and no client participant yet, default to client
    const hasClientContacts = clientContacts.length > 0;
    setSourceType(hasClientContacts ? 'client' : 'vendor');
    setContactId(clientContacts[0]?.id ?? '');
    setName('');
    setRole(hasClientContacts ? 'Client' : '');
    setEmail('');
    setPhone('');
    setIsPrimary(false);
    setNotes('');
    setAddError(null);
    setIsAddOpen(true);
  };

  const handleSourceTypeChange = (type: 'client' | 'vendor') => {
    setSourceType(type);
    if (type === 'client') {
      const selectedContact = clientContacts.find((c) => c.id === contactId) ?? clientContacts[0];
      if (selectedContact) {
        setContactId(selectedContact.id);
        setName(selectedContact.displayName);
        setEmail(selectedContact.email ?? '');
        setPhone(selectedContact.phone ?? '');
        setRole('Client');
      }
    } else {
      setContactId('');
      setName('');
      setEmail('');
      setPhone('');
      setRole('');
    }
  };

  const handleContactSelect = (selectedId: string) => {
    setContactId(selectedId);
    const selectedContact = clientContacts.find((c) => c.id === selectedId);
    if (selectedContact) {
      setName(selectedContact.displayName);
      setEmail(selectedContact.email ?? '');
      setPhone(selectedContact.phone ?? '');
    }
  };

  const handleCreateParticipant = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (isAdding) return;

    if (!role.trim()) {
      setAddError('Role is required');
      return;
    }

    if (sourceType === 'client' && !contactId) {
      setAddError('Please select a client contact');
      return;
    }

    if (sourceType === 'vendor' && !name.trim()) {
      setAddError('Participant name is required');
      return;
    }

    setIsAdding(true);
    setAddError(null);

    try {
      const isClientSource = sourceType === 'client';
      const resolvedName = isClientSource
        ? (clientContacts.find((c) => c.id === contactId)?.displayName ?? name.trim())
        : name.trim();

      const res = await createProjectParticipantAction({
        projectId,
        contactId: isClientSource ? contactId : null,
        name: resolvedName,
        email: email.trim() ? email.trim() : null,
        phone: phone.trim() ? phone.trim() : null,
        role: role.trim(),
        isPrimary,
        notes: notes.trim() ? notes.trim() : null,
      });

      if (!res.success) {
        setAddError(res.error);
        return;
      }

      const created = res.data.participant as ProjectDetailParticipant;
      const enhanced: ProjectDetailParticipant = {
        ...created,
        contactDisplayName: isClientSource ? resolvedName : null,
      };

      const updated = [...participants, enhanced];
      setParticipants(updated);
      onParticipantsChange?.(updated);
      setIsAddOpen(false);
    } catch {
      setAddError('An unexpected error occurred');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteParticipant = async () => {
    if (!deletingParticipant || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await deleteProjectParticipantAction({
        participantId: deletingParticipant.id,
      });

      if (!res.success) {
        setDeleteError(res.error);
        return;
      }

      const updated = participants.filter((p) => p.id !== deletingParticipant.id);
      setParticipants(updated);
      onParticipantsChange?.(updated);
      setDeletingParticipant(null);
    } catch {
      setDeleteError('An unexpected error occurred');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section
      aria-labelledby="participants-section-heading"
      className="rounded-lg border bg-card p-4 sm:p-6 text-card-foreground shadow-sm space-y-4"
      data-testid="participants-section"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-4">
        <div>
          <h2 id="participants-section-heading" className="text-lg font-semibold text-foreground">
            {t('title')}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t('description')}</p>
        </div>

        <Button
          type="button"
          onClick={handleOpenAdd}
          data-testid="add-participant-btn"
          className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[36px]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{t('addParticipant')}</span>
        </Button>
      </div>

      {participants.length === 0 ? (
        <p
          className="text-sm text-muted-foreground py-6 text-center"
          data-testid="participants-empty"
        >
          {t('empty')}
        </p>
      ) : (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4"
          data-testid="participants-list"
        >
          {participants.map((p) => {
            const isClientContact = Boolean(p.contactId);
            const displayName = p.contactDisplayName ?? p.name ?? 'Participant';

            return (
              <div
                key={p.id}
                className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-2xs hover:shadow-xs transition-all space-y-3 flex flex-col justify-between"
                data-testid={`participant-card-${p.id}`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3
                          className="font-semibold text-foreground text-sm sm:text-base truncate"
                          data-testid={`participant-name-${p.id}`}
                        >
                          {displayName}
                        </h3>

                        {p.isPrimary && (
                          <span
                            data-testid="primary-participant-badge"
                            className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400 px-2 py-0.5 text-2xs font-semibold shrink-0"
                          >
                            <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                            <span>{t('primaryBadge')}</span>
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span
                          className="inline-flex items-center rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-xs font-medium"
                          data-testid={`participant-role-${p.id}`}
                        >
                          {p.role}
                        </span>

                        {isClientContact ? (
                          <span
                            data-testid="client-contact-badge"
                            className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-2xs font-medium text-secondary-foreground"
                          >
                            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                            <span>{t('clientContactBadge')}</span>
                          </span>
                        ) : (
                          <span
                            data-testid="external-vendor-badge"
                            className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground"
                          >
                            <Briefcase className="h-3 w-3" aria-hidden="true" />
                            <span>{t('externalBadge')}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setDeletingParticipant(p);
                        setDeleteError(null);
                      }}
                      data-testid={`delete-participant-btn-${p.id}`}
                      aria-label={`${t('deleteParticipant')}: ${displayName}`}
                      className="p-1.5 rounded-md text-red-600 dark:text-red-400 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] flex items-center justify-center shrink-0 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="space-y-1 text-xs text-muted-foreground pt-1">
                    {p.email && (
                      <div className="flex items-center gap-1.5 truncate">
                        <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <a
                          href={`mailto:${p.email}`}
                          className="hover:underline hover:text-foreground text-primary truncate"
                          data-testid={`participant-email-${p.id}`}
                        >
                          {p.email}
                        </a>
                      </div>
                    )}

                    {p.phone && (
                      <div className="flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <a
                          href={`tel:${p.phone}`}
                          className="hover:underline hover:text-foreground truncate"
                          data-testid={`participant-phone-${p.id}`}
                        >
                          {p.phone}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Participant Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent data-testid="add-participant-dialog" className="max-w-md">
          <form
            onSubmit={(e) => {
              void handleCreateParticipant(e);
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t('addParticipant')}</DialogTitle>
              <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            {addError && (
              <div
                role="alert"
                className="rounded-md bg-destructive/10 p-3 text-xs text-destructive"
                data-testid="add-participant-error"
              >
                {addError}
              </div>
            )}

            <div className="space-y-3">
              {/* Participant Source Switch */}
              {clientContacts.length > 0 && (
                <div className="space-y-1.5">
                  <span className="block text-xs font-medium text-foreground">
                    {t('typeLabel')}
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        handleSourceTypeChange('client');
                      }}
                      data-testid="add-participant-source-client"
                      className={`flex items-center justify-center gap-1.5 rounded-md border p-2 text-xs font-medium transition-colors min-h-[44px] sm:min-h-[36px] ${
                        sourceType === 'client'
                          ? 'border-primary bg-primary/10 text-primary font-semibold'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <Users className="h-4 w-4" aria-hidden="true" />
                      <span>{t('typeClientContact')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        handleSourceTypeChange('vendor');
                      }}
                      data-testid="add-participant-source-vendor"
                      className={`flex items-center justify-center gap-1.5 rounded-md border p-2 text-xs font-medium transition-colors min-h-[44px] sm:min-h-[36px] ${
                        sourceType === 'vendor'
                          ? 'border-primary bg-primary/10 text-primary font-semibold'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <Briefcase className="h-4 w-4" aria-hidden="true" />
                      <span>{t('typeExternalVendor')}</span>
                    </button>
                  </div>
                </div>
              )}

              {sourceType === 'client' && clientContacts.length > 0 ? (
                <div>
                  <label
                    htmlFor="add-participant-contact"
                    className="block text-xs font-medium text-foreground mb-1"
                  >
                    {t('selectContact')}
                  </label>
                  <select
                    id="add-participant-contact"
                    value={contactId}
                    onChange={(e) => {
                      handleContactSelect(e.target.value);
                    }}
                    data-testid="add-participant-contact-select"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                  >
                    {clientContacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.displayName} {c.isPrimary ? `(${t('primaryBadge')})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="add-participant-name"
                    className="block text-xs font-medium text-foreground mb-1"
                  >
                    {t('nameLabel')}
                  </label>
                  <input
                    id="add-participant-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                    }}
                    data-testid="add-participant-name-input"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="add-participant-role"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('roleLabel')}
                </label>
                <input
                  id="add-participant-role"
                  type="text"
                  required
                  value={role}
                  onChange={(e) => {
                    setRole(e.target.value);
                  }}
                  placeholder={t('rolePlaceholder')}
                  data-testid="add-participant-role-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>

              {sourceType === 'vendor' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="add-participant-email"
                      className="block text-xs font-medium text-foreground mb-1"
                    >
                      {t('emailLabel')}
                    </label>
                    <input
                      id="add-participant-email"
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                      }}
                      data-testid="add-participant-email-input"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="add-participant-phone"
                      className="block text-xs font-medium text-foreground mb-1"
                    >
                      {t('phoneLabel')}
                    </label>
                    <input
                      id="add-participant-phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                      }}
                      data-testid="add-participant-phone-input"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <input
                  id="add-participant-is-primary"
                  type="checkbox"
                  checked={isPrimary}
                  onChange={(e) => {
                    setIsPrimary(e.target.checked);
                  }}
                  data-testid="add-participant-is-primary-checkbox"
                  className="h-4 w-4 rounded border-border text-primary focus:ring-ring min-h-[24px] min-w-[24px]"
                />
                <label
                  htmlFor="add-participant-is-primary"
                  className="text-xs font-medium text-foreground cursor-pointer select-none"
                >
                  {t('isPrimaryLabel')}
                </label>
              </div>

              <div>
                <label
                  htmlFor="add-participant-notes"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('notesLabel')}
                </label>
                <textarea
                  id="add-participant-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                  }}
                  data-testid="add-participant-notes-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsAddOpen(false);
                }}
                disabled={isAdding}
                data-testid="add-participant-cancel-btn"
                className="min-h-[44px] sm:min-h-[36px]"
              >
                {tDetail('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={isAdding}
                data-testid="add-participant-submit-btn"
                className="min-h-[44px] sm:min-h-[36px]"
              >
                {isAdding ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                    <span>{t('submitting')}</span>
                  </>
                ) : (
                  <span>{t('submit')}</span>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Participant Confirmation Dialog */}
      <Dialog
        open={Boolean(deletingParticipant)}
        onOpenChange={(open) => {
          if (!open) setDeletingParticipant(null);
        }}
      >
        <DialogContent data-testid="delete-participant-dialog" className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('deleteParticipant')}</DialogTitle>
            <DialogDescription>{t('deleteConfirm')}</DialogDescription>
          </DialogHeader>

          {deleteError && (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 p-3 text-xs text-destructive"
              data-testid="delete-participant-error"
            >
              {deleteError}
            </div>
          )}

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeletingParticipant(null);
              }}
              disabled={isDeleting}
              data-testid="delete-participant-cancel-btn"
              className="min-h-[44px] sm:min-h-[36px]"
            >
              {tDetail('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void handleDeleteParticipant();
              }}
              disabled={isDeleting}
              data-testid="delete-participant-confirm-btn"
              className="min-h-[44px] sm:min-h-[36px]"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                  <span>{tDetail('deleting')}</span>
                </>
              ) : (
                <span>{t('deleteParticipant')}</span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
