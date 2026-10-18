'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { MapPin, Plus, Pencil, Trash2, FileText, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { Shoot } from '@/server/db/schema/projects';
import type { ProjectDetailShootLocation } from '@/server/projects/service';
import {
  createShootLocationAction,
  updateShootLocationAction,
  deleteShootLocationAction,
} from '@/server/projects/actions';

export interface LocationsSectionProps {
  projectId: string;
  shoots: Shoot[];
  locations: ProjectDetailShootLocation[];
  locale: string;
  onLocationsChange?: (locations: ProjectDetailShootLocation[]) => void;
}

export function LocationsSection({
  shoots,
  locations: initialLocations,
  onLocationsChange,
}: LocationsSectionProps) {
  const t = useTranslations('projects.detail.locations');
  const tDetail = useTranslations('projects.detail');

  const [locations, setLocations] = React.useState<ProjectDetailShootLocation[]>(initialLocations);

  // Add Location State
  const [isAddOpen, setIsAddOpen] = React.useState(false);
  const [addShootId, setAddShootId] = React.useState<string>(shoots[0]?.id ?? '');
  const [addName, setAddName] = React.useState('');
  const [addAddress1, setAddAddress1] = React.useState('');
  const [addAddress2, setAddAddress2] = React.useState('');
  const [addPostalCode, setAddPostalCode] = React.useState('');
  const [addCity, setAddCity] = React.useState('');
  const [addCountryCode, setAddCountryCode] = React.useState('DE');
  const [addNotes, setAddNotes] = React.useState('');
  const [isAdding, setIsAdding] = React.useState(false);
  const [addError, setAddError] = React.useState<string | null>(null);

  // Edit Location State
  const [editingLocation, setEditingLocation] = React.useState<ProjectDetailShootLocation | null>(
    null,
  );
  const [editName, setEditName] = React.useState('');
  const [editAddress1, setEditAddress1] = React.useState('');
  const [editAddress2, setEditAddress2] = React.useState('');
  const [editPostalCode, setEditPostalCode] = React.useState('');
  const [editCity, setEditCity] = React.useState('');
  const [editCountryCode, setEditCountryCode] = React.useState('DE');
  const [editNotes, setEditNotes] = React.useState('');
  const [isEditing, setIsEditing] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);

  // Delete Location State
  const [deletingLocation, setDeletingLocation] = React.useState<ProjectDetailShootLocation | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const handleOpenAdd = () => {
    setAddShootId(shoots[0]?.id ?? '');
    setAddName('');
    setAddAddress1('');
    setAddAddress2('');
    setAddPostalCode('');
    setAddCity('');
    setAddCountryCode('DE');
    setAddNotes('');
    setAddError(null);
    setIsAddOpen(true);
  };

  const handleCreateLocation = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (isAdding) return;

    if (!addShootId) {
      setAddError('A shoot session is required');
      return;
    }
    if (!addName.trim()) {
      setAddError('Location name is required');
      return;
    }

    setIsAdding(true);
    setAddError(null);

    try {
      const res = await createShootLocationAction({
        shootId: addShootId,
        name: addName.trim(),
        addressLine1: addAddress1.trim() ? addAddress1.trim() : null,
        addressLine2: addAddress2.trim() ? addAddress2.trim() : null,
        postalCode: addPostalCode.trim() ? addPostalCode.trim() : null,
        city: addCity.trim() ? addCity.trim() : null,
        countryCode: addCountryCode.trim().slice(0, 2).toUpperCase()
          ? addCountryCode.trim().slice(0, 2).toUpperCase()
          : null,
        notes: addNotes.trim() ? addNotes.trim() : null,
        order: locations.length + 1,
      });

      if (!res.success) {
        setAddError(res.error);
        return;
      }

      const shootObj = shoots.find((s) => s.id === addShootId);
      const createdLocation: ProjectDetailShootLocation = {
        ...(res.data.location as ProjectDetailShootLocation),
        shootTitle: shootObj?.title,
      };

      const updated = [...locations, createdLocation].sort((a, b) => a.order - b.order);
      setLocations(updated);
      onLocationsChange?.(updated);
      setIsAddOpen(false);
    } catch {
      setAddError('An unexpected error occurred');
    } finally {
      setIsAdding(false);
    }
  };

  const handleOpenEdit = (loc: ProjectDetailShootLocation) => {
    setEditingLocation(loc);
    setEditName(loc.name);
    setEditAddress1(loc.addressLine1 ?? '');
    setEditAddress2(loc.addressLine2 ?? '');
    setEditPostalCode(loc.postalCode ?? '');
    setEditCity(loc.city ?? '');
    setEditCountryCode(loc.countryCode ?? 'DE');
    setEditNotes(loc.notes ?? '');
    setEditError(null);
  };

  const handleUpdateLocation = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!editingLocation || isEditing) return;

    if (!editName.trim()) {
      setEditError('Location name is required');
      return;
    }

    setIsEditing(true);
    setEditError(null);

    try {
      const res = await updateShootLocationAction({
        locationId: editingLocation.id,
        name: editName.trim(),
        addressLine1: editAddress1.trim() || null,
        addressLine2: editAddress2.trim() || null,
        postalCode: editPostalCode.trim() || null,
        city: editCity.trim() || null,
        countryCode: editCountryCode.trim().slice(0, 2).toUpperCase() || null,
        notes: editNotes.trim() || null,
      });

      if (!res.success) {
        setEditError(res.error);
        return;
      }

      const updated = res.data.location as ProjectDetailShootLocation;
      const updatedList = locations.map((l) =>
        l.id === updated.id ? { ...updated, shootTitle: l.shootTitle } : l,
      );

      setLocations(updatedList);
      onLocationsChange?.(updatedList);
      setEditingLocation(null);
    } catch {
      setEditError('An unexpected error occurred');
    } finally {
      setIsEditing(false);
    }
  };

  const handleDeleteLocation = async () => {
    if (!deletingLocation || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await deleteShootLocationAction({
        locationId: deletingLocation.id,
      });

      if (!res.success) {
        setDeleteError(res.error);
        return;
      }

      const updatedList = locations.filter((l) => l.id !== deletingLocation.id);
      setLocations(updatedList);
      onLocationsChange?.(updatedList);
      setDeletingLocation(null);
    } catch {
      setDeleteError('An unexpected error occurred');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section
      aria-labelledby="locations-section-heading"
      className="rounded-lg border bg-card p-4 sm:p-6 text-card-foreground shadow-sm space-y-4"
      data-testid="locations-section"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-4">
        <div>
          <h2 id="locations-section-heading" className="text-lg font-semibold text-foreground">
            {t('title')}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t('description')}</p>
        </div>

        <Button
          type="button"
          onClick={handleOpenAdd}
          disabled={shoots.length === 0}
          data-testid="add-location-btn"
          className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[36px]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{t('addLocation')}</span>
        </Button>
      </div>

      {locations.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center" data-testid="locations-empty">
          {t('empty')}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="locations-list">
          {locations.map((loc) => {
            const addressParts = [
              loc.addressLine1,
              loc.addressLine2,
              [loc.postalCode, loc.city].filter(Boolean).join(' '),
              loc.countryCode,
            ]
              .filter(Boolean)
              .join(', ');

            return (
              <div
                key={loc.id}
                className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-2xs hover:shadow-xs transition-all space-y-3 flex flex-col justify-between"
                data-testid={`location-card-${loc.id}`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5 min-w-0">
                      <h3
                        className="font-semibold text-foreground text-base truncate"
                        data-testid={`location-name-${loc.id}`}
                      >
                        {loc.name}
                      </h3>

                      {loc.shootTitle && (
                        <span className="inline-flex items-center rounded bg-secondary px-2 py-0.5 text-2xs font-medium text-secondary-foreground">
                          {loc.shootTitle}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          handleOpenEdit(loc);
                        }}
                        data-testid={`edit-location-btn-${loc.id}`}
                        aria-label={`${t('editLocation')}: ${loc.name}`}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] flex items-center justify-center transition-colors"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setDeletingLocation(loc);
                          setDeleteError(null);
                        }}
                        data-testid={`delete-location-btn-${loc.id}`}
                        aria-label={`${t('deleteLocation')}: ${loc.name}`}
                        className="p-1.5 rounded-md text-red-600 dark:text-red-400 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] flex items-center justify-center transition-colors"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {addressParts ? (
                    <div
                      className="flex items-start gap-1.5 text-xs text-muted-foreground"
                      data-testid={`location-address-${loc.id}`}
                    >
                      <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{addressParts}</span>
                    </div>
                  ) : null}

                  {loc.notes && (
                    <div
                      className="rounded bg-muted/40 p-2.5 text-xs text-muted-foreground space-y-1"
                      data-testid={`location-notes-${loc.id}`}
                    >
                      <div className="flex items-center gap-1.5 font-medium text-foreground text-2xs uppercase tracking-wider">
                        <FileText className="h-3 w-3" aria-hidden="true" />
                        <span>{t('notesLabel')}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{loc.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Location Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent data-testid="add-location-dialog" className="max-w-md">
          <form
            onSubmit={(e) => {
              void handleCreateLocation(e);
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t('addLocation')}</DialogTitle>
              <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            {addError && (
              <div
                role="alert"
                className="rounded-md bg-destructive/10 p-3 text-xs text-destructive"
                data-testid="add-location-error"
              >
                {addError}
              </div>
            )}

            <div className="space-y-3">
              {shoots.length > 1 && (
                <div>
                  <label
                    htmlFor="add-location-shoot"
                    className="block text-xs font-medium text-foreground mb-1"
                  >
                    {t('shootLabel')}
                  </label>
                  <select
                    id="add-location-shoot"
                    value={addShootId}
                    onChange={(e) => {
                      setAddShootId(e.target.value);
                    }}
                    data-testid="add-location-shoot-select"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                  >
                    {shoots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label
                  htmlFor="add-location-name"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('nameLabel')}
                </label>
                <input
                  id="add-location-name"
                  type="text"
                  required
                  value={addName}
                  onChange={(e) => {
                    setAddName(e.target.value);
                  }}
                  placeholder={t('namePlaceholder')}
                  data-testid="add-location-name-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>

              <div>
                <label
                  htmlFor="add-location-address1"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('address1Label')}
                </label>
                <input
                  id="add-location-address1"
                  type="text"
                  value={addAddress1}
                  onChange={(e) => {
                    setAddAddress1(e.target.value);
                  }}
                  data-testid="add-location-address1-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="add-location-postal"
                    className="block text-xs font-medium text-foreground mb-1"
                  >
                    {t('postalCodeLabel')}
                  </label>
                  <input
                    id="add-location-postal"
                    type="text"
                    value={addPostalCode}
                    onChange={(e) => {
                      setAddPostalCode(e.target.value);
                    }}
                    data-testid="add-location-postal-input"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="add-location-city"
                    className="block text-xs font-medium text-foreground mb-1"
                  >
                    {t('cityLabel')}
                  </label>
                  <input
                    id="add-location-city"
                    type="text"
                    value={addCity}
                    onChange={(e) => {
                      setAddCity(e.target.value);
                    }}
                    data-testid="add-location-city-input"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="add-location-country"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('countryCodeLabel')}
                </label>
                <input
                  id="add-location-country"
                  type="text"
                  maxLength={2}
                  value={addCountryCode}
                  onChange={(e) => {
                    setAddCountryCode(e.target.value);
                  }}
                  data-testid="add-location-country-input"
                  className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>

              <div>
                <label
                  htmlFor="add-location-notes"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('notesLabel')}
                </label>
                <textarea
                  id="add-location-notes"
                  rows={3}
                  value={addNotes}
                  onChange={(e) => {
                    setAddNotes(e.target.value);
                  }}
                  placeholder={t('notesPlaceholder')}
                  data-testid="add-location-notes-input"
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
                data-testid="add-location-cancel-btn"
                className="min-h-[44px] sm:min-h-[36px]"
              >
                {tDetail('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={isAdding}
                data-testid="add-location-submit-btn"
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

      {/* Edit Location Dialog */}
      <Dialog
        open={Boolean(editingLocation)}
        onOpenChange={(open) => {
          if (!open) setEditingLocation(null);
        }}
      >
        <DialogContent data-testid="edit-location-dialog" className="max-w-md">
          <form
            onSubmit={(e) => {
              void handleUpdateLocation(e);
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t('editLocation')}</DialogTitle>
              <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            {editError && (
              <div
                role="alert"
                className="rounded-md bg-destructive/10 p-3 text-xs text-destructive"
                data-testid="edit-location-error"
              >
                {editError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="edit-location-name"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('nameLabel')}
                </label>
                <input
                  id="edit-location-name"
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => {
                    setEditName(e.target.value);
                  }}
                  data-testid="edit-location-name-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-location-address1"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('address1Label')}
                </label>
                <input
                  id="edit-location-address1"
                  type="text"
                  value={editAddress1}
                  onChange={(e) => {
                    setEditAddress1(e.target.value);
                  }}
                  data-testid="edit-location-address1-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="edit-location-postal"
                    className="block text-xs font-medium text-foreground mb-1"
                  >
                    {t('postalCodeLabel')}
                  </label>
                  <input
                    id="edit-location-postal"
                    type="text"
                    value={editPostalCode}
                    onChange={(e) => {
                      setEditPostalCode(e.target.value);
                    }}
                    data-testid="edit-location-postal-input"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-location-city"
                    className="block text-xs font-medium text-foreground mb-1"
                  >
                    {t('cityLabel')}
                  </label>
                  <input
                    id="edit-location-city"
                    type="text"
                    value={editCity}
                    onChange={(e) => {
                      setEditCity(e.target.value);
                    }}
                    data-testid="edit-location-city-input"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="edit-location-notes"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('notesLabel')}
                </label>
                <textarea
                  id="edit-location-notes"
                  rows={3}
                  value={editNotes}
                  onChange={(e) => {
                    setEditNotes(e.target.value);
                  }}
                  data-testid="edit-location-notes-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingLocation(null);
                }}
                disabled={isEditing}
                data-testid="edit-location-cancel-btn"
                className="min-h-[44px] sm:min-h-[36px]"
              >
                {tDetail('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={isEditing}
                data-testid="edit-location-submit-btn"
                className="min-h-[44px] sm:min-h-[36px]"
              >
                {isEditing ? (
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

      {/* Delete Location Confirmation Dialog */}
      <Dialog
        open={Boolean(deletingLocation)}
        onOpenChange={(open) => {
          if (!open) setDeletingLocation(null);
        }}
      >
        <DialogContent data-testid="delete-location-dialog" className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('deleteLocation')}</DialogTitle>
            <DialogDescription>{t('deleteConfirm')}</DialogDescription>
          </DialogHeader>

          {deleteError && (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 p-3 text-xs text-destructive"
              data-testid="delete-location-error"
            >
              {deleteError}
            </div>
          )}

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeletingLocation(null);
              }}
              disabled={isDeleting}
              data-testid="delete-location-cancel-btn"
              className="min-h-[44px] sm:min-h-[36px]"
            >
              {tDetail('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void handleDeleteLocation();
              }}
              disabled={isDeleting}
              data-testid="delete-location-confirm-btn"
              className="min-h-[44px] sm:min-h-[36px]"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                  <span>{tDetail('deleting')}</span>
                </>
              ) : (
                <span>{t('deleteLocation')}</span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
