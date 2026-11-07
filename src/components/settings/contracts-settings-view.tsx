'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { ChevronRight, FileText, PenTool } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ContractTemplatesList } from './contract-templates-list';
import { ContractTemplateModal } from './contract-template-modal';
import { StudioSigningSettingsCard } from './studio-signing-settings-card';
import {
  createContractTemplateAction,
  updateContractTemplateAction,
  archiveContractTemplateAction,
  updateStudioSigningSettingsAction,
} from '@/server/contracts/actions';
import type { ContractTemplate } from '@/server/db/schema/contracts';
import type { StudioSettings } from '@/server/db/schema/studio-settings';
import { createContractsSettingsViewController } from './contracts-helpers';

export type ContractsTab = 'templates' | 'signing';

export interface ContractsSettingsViewProps {
  initialTemplates: ContractTemplate[];
  initialSigningSettings: StudioSettings;
  defaultTab?: ContractsTab;
}

export function ContractsSettingsView({
  initialTemplates,
  initialSigningSettings,
  defaultTab = 'templates',
}: ContractsSettingsViewProps) {
  const t = useTranslations('settings.contracts');
  const router = useRouter();

  const [activeTab, setActiveTab] = React.useState<ContractsTab>(defaultTab);
  const [templates, setTemplates] = React.useState<ContractTemplate[]>(initialTemplates);
  const [signingSettings, setSigningSettings] =
    React.useState<StudioSettings>(initialSigningSettings);

  // Modal State
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [editingTemplate, setEditingTemplate] = React.useState<ContractTemplate | null>(null);
  const [isDuplicate, setIsDuplicate] = React.useState(false);
  const [isSubmittingTemplate, setIsSubmittingTemplate] = React.useState(false);
  const modalTriggerRef = React.useRef<HTMLButtonElement | null>(null);

  const controller = createContractsSettingsViewController({
    setActiveTab,
    setEditingTemplate,
    setIsDuplicate,
    setIsModalOpen,
    setIsSubmittingTemplate,
    setTemplates,
    setSigningSettings,
    router,
    createContractAction: createContractTemplateAction,
    updateContractAction: updateContractTemplateAction,
    archiveContractAction: archiveContractTemplateAction,
    updateSigningAction: updateStudioSigningSettingsAction,
  });

  const tabs = [
    {
      id: 'templates' as const,
      testId: 'tab-templates',
      label: t('tabs.templates'),
      icon: FileText,
      onSelect: controller.handleSelectTemplatesTab,
      onKeyDown: controller.handleTemplatesTabKeyDown,
    },
    {
      id: 'signing' as const,
      testId: 'tab-signing',
      label: t('tabs.signing'),
      icon: PenTool,
      onSelect: controller.handleSelectSigningTab,
      onKeyDown: controller.handleSigningTabKeyDown,
    },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="contracts-settings-view">
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
        <span className="font-medium text-foreground select-none" aria-current="page">
          {t('breadcrumbs.contracts')}
        </span>
      </nav>

      {/* Page Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground max-w-3xl">{t('description')}</p>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label={t('tabs.tablistAria')}
        className="flex border-b border-border space-x-2"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isSelected = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              id={`contracts-tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={isSelected}
              aria-controls={`contracts-tabpanel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              data-testid={tab.testId}
              onClick={tab.onSelect}
              onKeyDown={tab.onKeyDown}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors min-h-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                isSelected
                  ? 'border-primary text-primary font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      {activeTab === 'templates' && (
        <div
          role="tabpanel"
          id="contracts-tabpanel-templates"
          data-testid="tabpanel-templates"
          aria-labelledby="contracts-tab-templates"
          className="pt-2 focus:outline-none"
        >
          <ContractTemplatesList
            templates={templates}
            onNewTemplate={controller.handleNewTemplate}
            onEditTemplate={controller.handleEditTemplate}
            onDuplicateTemplate={controller.handleDuplicateTemplate}
            onArchiveTemplate={controller.handleArchiveTemplate}
            onRestoreTemplate={controller.handleRestoreTemplate}
          />
        </div>
      )}

      {activeTab === 'signing' && (
        <div
          role="tabpanel"
          id="contracts-tabpanel-signing"
          data-testid="tabpanel-signing"
          aria-labelledby="contracts-tab-signing"
          className="pt-2 focus:outline-none"
        >
          <StudioSigningSettingsCard
            initialSettings={signingSettings}
            onSave={controller.handleSaveSigningSettings}
          />
        </div>
      )}

      {/* Template Create / Edit Modal */}
      <ContractTemplateModal
        template={editingTemplate}
        isOpen={isModalOpen}
        isSubmitting={isSubmittingTemplate}
        triggerRef={modalTriggerRef}
        isDuplicate={isDuplicate}
        onClose={controller.handleCloseModal}
        onSave={controller.handleSaveTemplate}
      />
    </div>
  );
}
