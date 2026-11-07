'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Pencil, Copy, Archive, RotateCcw, Search, FileCheck2 } from 'lucide-react';
import {
  filterContractTemplates,
  createContractTemplatesListController,
  getProjectTypeLabelKey,
} from './contracts-helpers';
import type { ContractTemplate } from '@/server/db/schema/contracts';

export interface ContractTemplatesListProps {
  templates: ContractTemplate[];
  onNewTemplate: () => void;
  onEditTemplate: (template: ContractTemplate) => void;
  onDuplicateTemplate: (template: ContractTemplate) => void;
  onArchiveTemplate: (template: ContractTemplate) => Promise<boolean>;
  onRestoreTemplate: (template: ContractTemplate) => Promise<boolean>;
  initialProjectTypeKey?: string;
  initialShowArchived?: boolean;
  initialSearchQuery?: string;
  initialTemplateToArchive?: ContractTemplate | null;
}

const PROJECT_TYPE_FILTER_OPTIONS = [
  { value: '', labelKey: 'list.filterAll' },
  { value: 'wedding', labelKey: 'list.projectTypes.wedding' },
  { value: 'portrait', labelKey: 'list.projectTypes.portrait' },
  { value: 'commercial', labelKey: 'list.projectTypes.commercial' },
  { value: 'event', labelKey: 'list.projectTypes.event' },
  { value: 'video', labelKey: 'list.projectTypes.video' },
  { value: 'engagement', labelKey: 'list.projectTypes.engagement' },
  { value: 'editorial', labelKey: 'list.projectTypes.editorial' },
] as const;

export function ContractTemplatesList({
  templates,
  onNewTemplate,
  onEditTemplate,
  onDuplicateTemplate,
  onArchiveTemplate,
  onRestoreTemplate,
  initialProjectTypeKey = '',
  initialShowArchived = false,
  initialSearchQuery = '',
  initialTemplateToArchive = null,
}: ContractTemplatesListProps) {
  const t = useTranslations('settings.contracts');

  const [projectTypeKey, setProjectTypeKey] = React.useState(initialProjectTypeKey);
  const [showArchived, setShowArchived] = React.useState(initialShowArchived);
  const [searchQuery, setSearchQuery] = React.useState(initialSearchQuery);

  // Archive confirmation modal state
  const [templateToArchive, setTemplateToArchive] = React.useState<ContractTemplate | null>(
    initialTemplateToArchive,
  );
  const [isArchiving, setIsArchiving] = React.useState(false);

  const controller = createContractTemplatesListController({
    templates,
    onEditTemplate,
    onDuplicateTemplate,
    setProjectTypeKey,
    setSearchQuery,
    showArchived,
    setShowArchived,
    templateToArchive,
    setTemplateToArchive,
    setIsArchiving,
    onArchiveTemplate,
    onRestoreTemplate,
  });

  const archivedCount = templates.filter((t) => !t.isActive).length;

  const filtered = filterContractTemplates(templates, {
    projectTypeKey,
    showArchived,
    searchQuery,
  });

  return (
    <div className="space-y-6" data-testid="contract-templates-list-container">
      {/* List Header & Action Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {t('list.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('list.description')}</p>
        </div>
        <Button
          type="button"
          onClick={onNewTemplate}
          data-testid="create-template-button"
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground min-h-[38px] w-full sm:w-auto shadow-sm"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{t('list.createButton')}</span>
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-muted/20 p-3 rounded-lg border">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
          {/* Project Type Filter */}
          <div className="relative min-w-[180px]">
            <select
              aria-label={t('list.filterByType')}
              data-testid="template-project-type-filter"
              value={projectTypeKey}
              onChange={controller.handleProjectTypeChange}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[36px]"
            >
              {PROJECT_TYPE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>

          {/* Search Input */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              aria-label={t('list.filterSearchPlaceholder')}
              data-testid="template-search-input"
              value={searchQuery}
              onChange={controller.handleSearchChange}
              placeholder={t('list.filterSearchPlaceholder')}
              className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[36px]"
            />
          </div>
        </div>

        {/* Toggle Archived */}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="toggle-archived-templates-btn"
            onClick={controller.handleToggleArchived}
            className="w-full sm:w-auto min-h-[36px]"
          >
            {showArchived
              ? t('list.hideArchived')
              : t('list.showArchived', { count: archivedCount })}
          </Button>
        </div>
      </div>

      {/* Templates List Table / Cards */}
      {filtered.length === 0 ? (
        <div
          data-testid="templates-empty-state"
          className="rounded-lg border border-dashed p-8 text-center bg-card text-card-foreground"
        >
          <FileCheck2 className="mx-auto h-10 w-10 text-muted-foreground/60 mb-3" />
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {showArchived ? t('list.emptyArchived') : t('list.emptyActive')}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card text-card-foreground shadow-xs">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 border-b text-xs font-semibold uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3">
                  {t('list.table.name')}
                </th>
                <th scope="col" className="px-4 py-3 hidden sm:table-cell">
                  {t('list.table.slug')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('list.table.projectType')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('list.table.status')}
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  {t('list.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((item) => (
                <tr
                  key={item.id}
                  data-testid={`contract-template-row-${item.slug}`}
                  className="hover:bg-muted/30 transition-colors"
                >
                  {/* Name & Description & Default Badge */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        data-testid={`template-name-${item.slug}`}
                        className="font-medium text-foreground"
                      >
                        {item.name}
                      </span>
                      {item.isDefault && (
                        <span
                          data-testid={`template-default-badge-${item.slug}`}
                          className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20"
                        >
                          {t('list.defaultBadge')}
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 max-w-md">
                        {item.description}
                      </p>
                    )}
                  </td>

                  {/* Slug */}
                  <td className="px-4 py-3.5 hidden sm:table-cell">
                    <code
                      data-testid={`template-slug-${item.slug}`}
                      className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
                    >
                      {item.slug}
                    </code>
                  </td>

                  {/* Project Type */}
                  <td className="px-4 py-3.5">
                    <span
                      data-testid={`template-type-${item.slug}`}
                      className="inline-flex items-center rounded-md border border-input px-2 py-0.5 text-xs capitalize text-foreground bg-background"
                    >
                      {t(getProjectTypeLabelKey(item.projectTypeKey))}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3.5">
                    {item.isActive ? (
                      <span
                        data-testid={`template-active-badge-${item.slug}`}
                        className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20"
                      >
                        {t('list.activeBadge')}
                      </span>
                    ) : (
                      <span
                        data-testid={`template-archived-badge-${item.slug}`}
                        className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium text-muted-foreground border border-muted"
                      >
                        {t('list.archivedBadge')}
                      </span>
                    )}
                  </td>

                  {/* Quick Actions */}
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      {/* Edit */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-testid={`edit-template-${item.slug}`}
                        data-slug={item.slug}
                        onClick={controller.handleEditRowClick}
                        className="h-8 px-2 text-foreground hover:bg-muted"
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                        <span className="sr-only md:not-sr-only md:inline">
                          {t('list.editAction')}
                        </span>
                      </Button>

                      {/* Duplicate */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-testid={`duplicate-template-${item.slug}`}
                        data-slug={item.slug}
                        onClick={controller.handleDuplicateRowClick}
                        className="h-8 px-2 text-foreground hover:bg-muted"
                      >
                        <Copy className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                        <span className="sr-only md:not-sr-only md:inline">
                          {t('list.duplicateAction')}
                        </span>
                      </Button>

                      {/* Archive / Restore */}
                      {item.isActive ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-testid={`archive-template-${item.slug}`}
                          data-slug={item.slug}
                          onClick={controller.handleArchiveRowClick}
                          className="h-8 px-2 text-red-600 dark:text-red-400 hover:bg-destructive/10"
                        >
                          <Archive className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                          <span className="sr-only md:not-sr-only md:inline">
                            {t('list.archiveAction')}
                          </span>
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-testid={`restore-template-${item.slug}`}
                          data-slug={item.slug}
                          onClick={controller.handleRestoreRowClick}
                          className="h-8 px-2 text-primary hover:bg-primary/10"
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                          <span className="sr-only md:not-sr-only md:inline">
                            {t('list.restoreAction')}
                          </span>
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Archive Confirmation Dialog */}
      <Dialog
        open={Boolean(templateToArchive)}
        onOpenChange={controller.handleArchiveDialogOpenChange}
      >
        <DialogContent
          data-testid="contract-template-archive-dialog"
          className="max-w-md p-4 sm:p-6"
          onCloseAutoFocus={controller.handleArchiveDialogCloseAutoFocus}
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">{t('list.archiveDialog.title')}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-2">
              {t('list.archiveDialog.description', {
                name: templateToArchive?.name ?? '',
              })}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-4 border-t mt-4">
            <Button
              type="button"
              variant="outline"
              data-testid="cancel-archive-btn"
              onClick={controller.handleCloseArchiveDialog}
              disabled={isArchiving}
              className="w-full sm:w-auto"
            >
              {t('list.archiveDialog.cancelButton')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="confirm-archive-btn"
              onClick={controller.handleConfirmArchiveClick}
              disabled={isArchiving}
              className="w-full sm:w-auto"
            >
              {t('list.archiveDialog.confirmButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
