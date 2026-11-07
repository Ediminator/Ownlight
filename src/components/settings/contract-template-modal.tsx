'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  createContractTemplateModalController,
  createModalDialogHandlers,
  initialTemplateFormData,
  interpolateContractPreview,
  TOKEN_CATEGORIES,
  SAMPLE_COMMISSION_DATA,
  SAMPLE_COMMISSION_DATA_DE,
  type ContractTemplateFormData,
  type ContractTemplateFormErrors,
} from './contracts-helpers';
import type { ContractTemplate } from '@/server/db/schema/contracts';

export interface ContractTemplateModalProps {
  template: ContractTemplate | null;
  isOpen: boolean;
  isSubmitting: boolean;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  isDuplicate?: boolean;
  initialErrors?: ContractTemplateFormErrors;
  initialClauseTab?: 'en' | 'de';
  onClose: () => void;
  onSave: (payload: ContractTemplateFormData) => Promise<boolean>;
}

const PROJECT_TYPE_OPTIONS = [
  { value: '', labelKey: 'modal.projectTypeNone' },
  { value: 'wedding', labelKey: 'list.projectTypes.wedding' },
  { value: 'portrait', labelKey: 'list.projectTypes.portrait' },
  { value: 'commercial', labelKey: 'list.projectTypes.commercial' },
  { value: 'event', labelKey: 'list.projectTypes.event' },
  { value: 'video', labelKey: 'list.projectTypes.video' },
  { value: 'engagement', labelKey: 'list.projectTypes.engagement' },
  { value: 'editorial', labelKey: 'list.projectTypes.editorial' },
];

interface ContractTemplateModalFormProps {
  template: ContractTemplate | null;
  isSubmitting: boolean;
  isDuplicate: boolean;
  initialErrors?: ContractTemplateFormErrors;
  initialClauseTab?: 'en' | 'de';
  onClose: () => void;
  onSave: (payload: ContractTemplateFormData) => Promise<boolean>;
}

function ContractTemplateModalForm({
  template,
  isSubmitting,
  isDuplicate,
  initialErrors,
  initialClauseTab = 'en',
  onClose,
  onSave,
}: ContractTemplateModalFormProps) {
  const t = useTranslations('settings.contracts');

  const [formData, setFormData] = React.useState<ContractTemplateFormData>(() =>
    initialTemplateFormData(template, isDuplicate),
  );
  const [errors, setErrors] = React.useState<ContractTemplateFormErrors>(initialErrors ?? {});
  const [activeClauseTab, setActiveClauseTab] = React.useState<'en' | 'de'>(initialClauseTab);
  const [announcement, setAnnouncement] = React.useState('');

  const controller = createContractTemplateModalController({
    formData,
    setFormData,
    setErrors,
    activeClauseTab,
    setActiveClauseTab,
    setLiveAnnouncement: setAnnouncement,
    onClose,
    onSave,
    t,
  });

  const activeText = activeClauseTab === 'en' ? formData.contentEn : formData.contentDe;
  const sampleData = activeClauseTab === 'de' ? SAMPLE_COMMISSION_DATA_DE : SAMPLE_COMMISSION_DATA;
  const previewText = interpolateContractPreview(activeText, sampleData);

  const modalTitle = isDuplicate
    ? t('modal.duplicateTitle')
    : template
      ? t('modal.editTitle')
      : t('modal.createTitle');

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-xl font-bold">{modalTitle}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('modal.description')}
        </DialogDescription>
      </DialogHeader>

      {/* Screen Reader Live Region for Token Insertion */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="token-announcement"
      >
        {announcement}
      </div>

      <form onSubmit={controller.handleSubmit} className="space-y-6 mt-2">
        {/* Top Metadata Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Name */}
          <div>
            <label
              htmlFor="template-name-input"
              className="block text-sm font-medium text-foreground mb-1"
            >
              {t('modal.nameLabel')} <span className="text-destructive">*</span>
            </label>
            <input
              id="template-name-input"
              type="text"
              required
              data-testid="contract-template-name-input"
              value={formData.name}
              onChange={controller.handleNameChange}
              placeholder={t('modal.namePlaceholder')}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'template-name-error' : undefined}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px]"
            />
            {errors.name && (
              <p id="template-name-error" role="alert" className="text-xs text-destructive mt-1">
                {errors.name}
              </p>
            )}
          </div>

          {/* Slug */}
          <div>
            <label
              htmlFor="template-slug-input"
              className="block text-sm font-medium text-foreground mb-1"
            >
              {t('modal.slugLabel')} <span className="text-destructive">*</span>
            </label>
            <input
              id="template-slug-input"
              type="text"
              required
              data-testid="contract-template-slug-input"
              value={formData.slug}
              onChange={controller.handleSlugChange}
              placeholder={t('modal.slugPlaceholder')}
              aria-invalid={Boolean(errors.slug)}
              aria-describedby={errors.slug ? 'template-slug-error' : 'template-slug-help'}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px]"
            />
            {errors.slug ? (
              <p id="template-slug-error" role="alert" className="text-xs text-destructive mt-1">
                {errors.slug}
              </p>
            ) : (
              <p id="template-slug-help" className="text-xs text-muted-foreground mt-1">
                {t('modal.slugHelp')}
              </p>
            )}
          </div>

          {/* Project Type */}
          <div>
            <label
              htmlFor="template-project-type-select"
              className="block text-sm font-medium text-foreground mb-1"
            >
              {t('modal.projectTypeLabel')}
            </label>
            <select
              id="template-project-type-select"
              data-testid="contract-template-project-type-select"
              value={formData.projectTypeKey}
              onChange={controller.handleProjectTypeChange}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px]"
            >
              {PROJECT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>

          {/* Default template toggle */}
          <div className="flex items-center space-x-3 pt-6">
            <input
              type="checkbox"
              id="template-default-toggle"
              data-testid="contract-template-default-toggle"
              checked={formData.isDefault}
              onChange={controller.handleDefaultChange}
              className="h-4 w-4 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
            />
            <label
              htmlFor="template-default-toggle"
              className="text-sm font-medium text-foreground cursor-pointer select-none"
            >
              {t('modal.defaultToggleLabel')}
            </label>
          </div>
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="template-description-input"
            className="block text-sm font-medium text-foreground mb-1"
          >
            {t('modal.descriptionLabel')}
          </label>
          <input
            id="template-description-input"
            type="text"
            data-testid="contract-template-description-input"
            value={formData.description}
            onChange={controller.handleDescriptionChange}
            placeholder={t('modal.descriptionPlaceholder')}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? 'template-desc-error' : undefined}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px]"
          />
          {errors.description && (
            <p id="template-desc-error" role="alert" className="text-xs text-destructive mt-1">
              {errors.description}
            </p>
          )}
        </div>

        {/* Bilingual Clause Editor and Live Preview */}
        <div className="space-y-4 border-t pt-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {t('modal.clauseEditorTitle')}
            </h3>
            <p className="text-xs text-muted-foreground">{t('modal.clauseEditorHelp')}</p>
          </div>

          {/* Language Switcher Tabs */}
          <div
            role="tablist"
            aria-label={t('modal.clauseEditorTitle')}
            className="flex border-b border-border space-x-2"
          >
            <button
              type="button"
              id="clause-tab-en"
              role="tab"
              aria-selected={activeClauseTab === 'en'}
              aria-controls="clause-panel-en"
              tabIndex={activeClauseTab === 'en' ? 0 : -1}
              data-testid="tab-clause-en"
              onClick={controller.handleSelectEnClauseTab}
              className={cn(
                'px-3 py-2 text-sm font-medium border-b-2 transition-colors min-h-[36px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                activeClauseTab === 'en'
                  ? 'border-primary text-primary font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t('modal.tabEnglish')}
            </button>
            <button
              type="button"
              id="clause-tab-de"
              role="tab"
              aria-selected={activeClauseTab === 'de'}
              aria-controls="clause-panel-de"
              tabIndex={activeClauseTab === 'de' ? 0 : -1}
              data-testid="tab-clause-de"
              onClick={controller.handleSelectDeClauseTab}
              className={cn(
                'px-3 py-2 text-sm font-medium border-b-2 transition-colors min-h-[36px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                activeClauseTab === 'de'
                  ? 'border-primary text-primary font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t('modal.tabGerman')}
            </button>
          </div>

          {/* Side-by-side or stacked editor and live preview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Textarea Editor */}
            <div className="space-y-2">
              {activeClauseTab === 'en' ? (
                <div id="clause-panel-en" role="tabpanel" aria-labelledby="clause-tab-en">
                  <label
                    htmlFor="content-en-textarea"
                    className="block text-xs font-medium text-muted-foreground mb-1"
                  >
                    {t('modal.contentEnLabel')} <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    id="content-en-textarea"
                    required
                    rows={12}
                    data-testid="contract-template-content-en-input"
                    value={formData.contentEn}
                    onChange={controller.handleContentEnChange}
                    placeholder={t('modal.contentEnPlaceholder')}
                    aria-invalid={Boolean(errors.contentEn)}
                    aria-describedby={errors.contentEn ? 'content-en-error' : undefined}
                    className="w-full font-mono text-xs sm:text-sm rounded-md border border-input bg-background p-3 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring leading-relaxed"
                  />
                  {errors.contentEn && (
                    <p id="content-en-error" role="alert" className="text-xs text-destructive mt-1">
                      {errors.contentEn}
                    </p>
                  )}
                </div>
              ) : (
                <div id="clause-panel-de" role="tabpanel" aria-labelledby="clause-tab-de">
                  <label
                    htmlFor="content-de-textarea"
                    className="block text-xs font-medium text-muted-foreground mb-1"
                  >
                    {t('modal.contentDeLabel')} <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    id="content-de-textarea"
                    required
                    rows={12}
                    data-testid="contract-template-content-de-input"
                    value={formData.contentDe}
                    onChange={controller.handleContentDeChange}
                    placeholder={t('modal.contentDePlaceholder')}
                    aria-invalid={Boolean(errors.contentDe)}
                    aria-describedby={errors.contentDe ? 'content-de-error' : undefined}
                    className="w-full font-mono text-xs sm:text-sm rounded-md border border-input bg-background p-3 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring leading-relaxed"
                  />
                  {errors.contentDe && (
                    <p id="content-de-error" role="alert" className="text-xs text-destructive mt-1">
                      {errors.contentDe}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Embedded MergeFieldPreviewCard */}
            <div
              data-testid="merge-field-preview-card"
              className="flex flex-col rounded-md border bg-muted/30 p-3 sm:p-4 space-y-2 h-full"
            >
              <div className="flex items-center justify-between pb-2 border-b">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  <span>{t('modal.previewTitle')}</span>
                </div>
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-secondary text-secondary-foreground border border-border">
                  {t('modal.previewBadge')}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto max-h-[300px] text-xs sm:text-sm whitespace-pre-wrap font-sans text-foreground leading-relaxed">
                {previewText ? (
                  previewText
                ) : (
                  <span className="text-muted-foreground italic text-xs">
                    {t('modal.previewEmpty')}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Merge Token Palette */}
          <div data-testid="token-palette" className="space-y-2 pt-2 border-t">
            <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('modal.tokenPaletteTitle')}
            </span>
            <div className="space-y-3">
              {TOKEN_CATEGORIES.map((cat) => (
                <div key={cat.id} className="space-y-1">
                  <span className="block text-[11px] font-medium text-muted-foreground">
                    {t(cat.nameKey)}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {cat.tokens.map((tokenItem) => (
                      <button
                        key={tokenItem.token}
                        type="button"
                        data-testid={`token-chip-${tokenItem.token.replace('.', '-')}`}
                        data-token={tokenItem.token}
                        onClick={controller.handleTokenButtonClick}
                        className="inline-flex items-center rounded-md border border-input bg-background/80 hover:bg-secondary px-2 py-1 text-xs font-mono text-foreground transition-colors hover:text-secondary-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[28px]"
                      >
                        {tokenItem.chipText}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Form Actions Footer */}
        <DialogFooter className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-4 border-t">
          <Button
            type="button"
            variant="outline"
            data-testid="template-modal-cancel-btn"
            onClick={onClose}
            disabled={isSubmitting}
            className="w-full sm:w-auto"
          >
            {t('modal.cancelButton')}
          </Button>
          <Button
            type="submit"
            data-testid="save-template-btn"
            disabled={isSubmitting}
            className="w-full sm:w-auto bg-primary text-primary-foreground shadow-sm"
          >
            {isSubmitting ? t('modal.savingButton') : t('modal.saveButton')}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function ContractTemplateModal({
  template,
  isOpen,
  isSubmitting,
  triggerRef,
  isDuplicate = false,
  initialErrors,
  initialClauseTab,
  onClose,
  onSave,
}: ContractTemplateModalProps) {
  const dialogHandlers = createModalDialogHandlers(onClose, triggerRef);

  return (
    <Dialog open={isOpen} onOpenChange={dialogHandlers.onOpenChange}>
      <DialogContent
        data-testid="contract-template-modal"
        className="max-w-4xl max-h-[92vh] overflow-y-auto p-4 sm:p-6"
        onCloseAutoFocus={dialogHandlers.onCloseAutoFocus}
      >
        {isOpen && (
          <ContractTemplateModalForm
            key={`${template?.id ?? 'new'}-${isDuplicate ? 'dup' : 'edit'}`}
            template={template}
            isSubmitting={isSubmitting}
            isDuplicate={isDuplicate}
            initialErrors={initialErrors}
            initialClauseTab={initialClauseTab}
            onClose={onClose}
            onSave={onSave}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
