import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  usePathname: () => '/en/projects',
}));

vi.mock('next-intl', () => ({
  useTranslations: (section?: string) => {
    const t = (key: string, values?: Record<string, unknown>) => {
      return `${section ? `${section}.` : ''}${key}${values ? JSON.stringify(values) : ''}`;
    };
    t.has = () => true;
    return t;
  },
  useLocale: () => 'en',
}));

import { KanbanBoard } from '@/components/projects/kanban-board';
import { KanbanColumn, type KanbanColumnProps } from '@/components/projects/kanban-column';
import { ProjectCard, type ProjectCardProps } from '@/components/projects/project-card';
import {
  TaskWarningDialog,
  type TaskWarningDialogProps,
} from '@/components/projects/task-warning-dialog';
import { NewProjectDialog } from '@/components/projects/new-project-dialog';
import type { KanbanProject } from '@/server/projects/service';
import type { PipelineStage } from '@/server/db/schema/projects';

function findNodeByTestId(node: unknown, testId: string): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (React.isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    if (props['data-testid'] === testId) return props;
    if (props.children) {
      const res = findNodeByTestId(props.children, testId);
      if (res) return res;
    }
  } else if (Array.isArray(node)) {
    for (const item of node) {
      const res = findNodeByTestId(item, testId);
      if (res) return res;
    }
  }
  return undefined;
}

let capturedCardTree: React.ReactElement | null = null;
function CaptureCard(props: ProjectCardProps) {
  const result = ProjectCard(props);
  capturedCardTree = result;
  return result;
}

let capturedColumnTree: React.ReactElement | null = null;
function CaptureColumn(props: KanbanColumnProps) {
  const result = KanbanColumn(props);
  capturedColumnTree = result;
  return result;
}

let capturedTaskWarningTree: React.ReactElement | null = null;
function CaptureTaskWarning(props: TaskWarningDialogProps) {
  const result = TaskWarningDialog(props);
  capturedTaskWarningTree = result;
  return result;
}

describe('Projects UI Components Unit Tests (renderToStaticMarkup)', () => {
  const dummyStageInquiry: PipelineStage = {
    id: '01920000-0000-7000-8000-000000000001',
    key: 'inquiry',
    name: 'Inquiry',
    position: 1,
    category: 'inquiry',
    color: 'slate',
    isSystem: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
  const dummyStageBooked: PipelineStage = {
    id: '01920000-0000-7000-8000-000000000002',
    key: 'booked',
    name: 'Booked',
    position: 2,
    category: 'booked',
    color: 'blue',
    isSystem: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
  const dummyStageShot: PipelineStage = {
    id: '01920000-0000-7000-8000-000000000003',
    key: 'shot',
    name: 'Shot',
    position: 3,
    category: 'in_progress',
    color: 'amber',
    isSystem: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
  const dummyStageEditing: PipelineStage = {
    id: '01920000-0000-7000-8000-000000000004',
    key: 'editing',
    name: 'Editing',
    position: 4,
    category: 'review',
    color: 'purple',
    isSystem: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
  const dummyStageDelivered: PipelineStage = {
    id: '01920000-0000-7000-8000-000000000005',
    key: 'delivered',
    name: 'Delivered',
    position: 5,
    category: 'completed',
    color: 'emerald',
    isSystem: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
  const dummyStageArchived: PipelineStage = {
    id: '01920000-0000-7000-8000-000000000006',
    key: 'archived',
    name: 'Archived',
    position: 6,
    category: 'archived',
    color: 'zinc',
    isSystem: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  const dummyStages: PipelineStage[] = [
    dummyStageInquiry,
    dummyStageBooked,
    dummyStageShot,
    dummyStageEditing,
    dummyStageDelivered,
    dummyStageArchived,
  ];

  const dummyProject1: KanbanProject = {
    id: 'proj-1',
    title: 'Emma & Liam Wedding',
    clientId: 'client-1',
    clientDisplayName: 'Emma Watson',
    stageId: '01920000-0000-7000-8000-000000000001',
    stageKey: 'inquiry',
    projectTypeKey: 'wedding',
    primaryShootStartsAt: '2027-06-19T10:00:00.000Z',
    primaryShootTimezone: 'Europe/Berlin',
    currency: 'EUR',
    priceMinor: 250000,
    taskCount: 5,
    completedTaskCount: 3,
    incompleteTasks: [
      { id: 'task-1', title: 'Task 1', stageId: '01920000-0000-7000-8000-000000000001' },
    ],
  };

  const dummyProject2: KanbanProject = {
    id: 'proj-2',
    title: 'Commercial Shoot',
    clientId: 'client-2',
    clientDisplayName: 'Acme Corp',
    stageId: '01920000-0000-7000-8000-000000000002',
    stageKey: 'booked',
    projectTypeKey: 'commercial',
    primaryShootStartsAt: null,
    primaryShootTimezone: null,
    currency: 'EUR',
    priceMinor: null,
    taskCount: 0,
    completedTaskCount: 0,
    incompleteTasks: [],
  };

  const dummyProjects: KanbanProject[] = [dummyProject1, dummyProject2];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ProjectCard Component', () => {
    it('renders project card with title link, client link, and formatted price', () => {
      const html = renderToStaticMarkup(
        <ProjectCard
          project={dummyProject1}
          stages={dummyStages}
          locale="en"
          onMoveToStage={vi.fn()}
        />,
      );

      expect(html).toContain('Emma &amp; Liam Wedding');
      expect(html).toContain('Emma Watson');
      expect(html).toContain('href="/en/projects/proj-1"');
      expect(html).toContain('href="/en/clients/client-1"');
      expect(html).toContain('€2,500.00');
      expect(html).toContain('data-testid="project-card-proj-1"');
      expect(html).toContain('data-testid="project-card-title-proj-1"');
      expect(html).toContain('data-testid="project-card-client-proj-1"');
      expect(html).toContain('data-testid="project-actions-trigger-proj-1"');
      expect(html).toContain('data-testid="project-card-tasks-proj-1"');
    });

    it('renders project card without price or shoot date cleanly', () => {
      const html = renderToStaticMarkup(
        <ProjectCard
          project={dummyProject2}
          stages={dummyStages}
          locale="en"
          onMoveToStage={vi.fn()}
          isDragging={true}
          isTransitioning={false}
        />,
      );

      expect(html).toContain('Commercial Shoot');
      expect(html).toContain('Acme Corp');
      expect(html).toContain('projects.card.noShootDate');
      expect(html).toContain('projects.card.noTasks');
      expect(html).not.toContain('€');
      expect(html).toContain('opacity-40');
      expect(html).toContain('border-dashed');
    });

    it('renders project card with transitioning styles when isTransitioning=true', () => {
      const html = renderToStaticMarkup(
        <ProjectCard
          project={dummyProject1}
          stages={dummyStages}
          locale="en"
          onMoveToStage={vi.fn()}
          isDragging={false}
          isTransitioning={true}
        />,
      );

      expect(html).toContain('pointer-events-none');
      expect(html).toContain('opacity-60');
    });

    it('renders project card in dragging state with dashed border and reduced opacity', () => {
      const html = renderToStaticMarkup(
        <ProjectCard
          project={dummyProject1}
          stages={dummyStages}
          locale="en"
          onMoveToStage={vi.fn()}
          isDragging={true}
          isTransitioning={false}
        />,
      );

      expect(html).toContain('opacity-40');
      expect(html).toContain('border-dashed');
      expect(html).toContain('border-primary');
    });

    it('formats custom project type fallback and handles drag start and end', () => {
      const customProject: KanbanProject = {
        ...dummyProject1,
        id: 'proj-custom',
        projectTypeKey: 'aerial_cinematography',
      };
      const onDragStart = vi.fn();
      const onDragEnd = vi.fn();

      renderToStaticMarkup(
        <CaptureCard
          project={customProject}
          stages={dummyStages}
          locale="en"
          onMoveToStage={vi.fn()}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />,
      );

      expect(capturedCardTree).not.toBeNull();
      const cardProps = (capturedCardTree?.props ?? {}) as {
        onDragStart?: (e: {
          dataTransfer: { setData: (k: string, v: string) => void; effectAllowed: string };
        }) => void;
        onDragEnd?: () => void;
      };

      const setData = vi.fn();
      cardProps.onDragStart?.({ dataTransfer: { setData, effectAllowed: '' } });
      expect(setData).toHaveBeenCalledWith('text/plain', 'proj-custom');
      expect(onDragStart).toHaveBeenCalledWith('proj-custom');

      cardProps.onDragEnd?.();
      expect(onDragEnd).toHaveBeenCalled();
    });

    it('invokes onMoveToStage from dropdown menu item', () => {
      const onMoveToStage = vi.fn();
      renderToStaticMarkup(
        <CaptureCard
          project={dummyProject1}
          stages={dummyStages}
          locale="en"
          onMoveToStage={onMoveToStage}
        />,
      );

      const stageItem = findNodeByTestId(capturedCardTree, 'project-action-move-booked');
      expect(stageItem).toBeDefined();
      const onClick = stageItem?.onClick as (() => void) | undefined;
      onClick?.();
      expect(onMoveToStage).toHaveBeenCalledWith(
        dummyProject1,
        '01920000-0000-7000-8000-000000000002',
      );
    });

    it('I1-U01 regression: renders DropdownMenu with modal={false} to prevent aria-hidden on board', () => {
      renderToStaticMarkup(
        <CaptureCard
          project={dummyProject1}
          stages={dummyStages}
          locale="en"
          onMoveToStage={vi.fn()}
        />,
      );

      function findNodeByProp(node: unknown, prop: string): Record<string, unknown> | undefined {
        if (!node || typeof node !== 'object') return undefined;
        if (React.isValidElement(node)) {
          const props = node.props as Record<string, unknown>;
          if (prop in props) return props;
          if (props.children) {
            const res = findNodeByProp(props.children, prop);
            if (res) return res;
          }
        } else if (Array.isArray(node)) {
          for (const item of node) {
            const res = findNodeByProp(item, prop);
            if (res) return res;
          }
        }
        return undefined;
      }

      const dropdownProps = findNodeByProp(capturedCardTree, 'modal');
      expect(dropdownProps).toBeDefined();
      expect(dropdownProps?.modal).toBe(false);
    });
  });

  describe('KanbanColumn Component', () => {
    it('renders column header with localized title, count, and project cards', () => {
      const html = renderToStaticMarkup(
        <KanbanColumn
          stage={dummyStageInquiry}
          allStages={dummyStages}
          projects={[dummyProject1]}
          locale="en"
          onMoveToStage={vi.fn()}
          onProjectDrop={vi.fn()}
          draggingProjectId={null}
          setDraggingProjectId={vi.fn()}
          transitioningProjectIds={new Set()}
        />,
      );

      expect(html).toContain('data-testid="kanban-column-inquiry"');
      expect(html).toContain('data-testid="kanban-column-title-inquiry"');
      expect(html).toContain('data-testid="kanban-column-count-inquiry"');
      expect(html).toContain('data-testid="kanban-column-total-inquiry"');
      expect(html).toContain('data-testid="project-card-proj-1"');
      expect(html).not.toContain('data-testid="kanban-column-empty-inquiry"');
    });

    it('renders column with project in transitioning state', () => {
      const html = renderToStaticMarkup(
        <KanbanColumn
          stage={dummyStageInquiry}
          allStages={dummyStages}
          projects={[dummyProject1]}
          locale="en"
          onMoveToStage={vi.fn()}
          onProjectDrop={vi.fn()}
          draggingProjectId="proj-1"
          setDraggingProjectId={vi.fn()}
          transitioningProjectIds={new Set(['proj-1'])}
        />,
      );

      expect(html).toContain('data-testid="kanban-column-dropzone-inquiry"');
      expect(html).toContain('pointer-events-none');
    });

    it('renders empty column state when zero projects exist', () => {
      const html = renderToStaticMarkup(
        <KanbanColumn
          stage={dummyStageArchived}
          allStages={dummyStages}
          projects={[]}
          locale="en"
          onMoveToStage={vi.fn()}
          onProjectDrop={vi.fn()}
          draggingProjectId={null}
          setDraggingProjectId={vi.fn()}
          transitioningProjectIds={new Set()}
        />,
      );

      expect(html).toContain('data-testid="kanban-column-archived"');
      expect(html).toContain('data-testid="kanban-column-empty-archived"');
      expect(html).toContain('projects.column.empty');
    });

    it('handles drag enter, over, leave and drop events on column drop zone', () => {
      const onProjectDrop = vi.fn();
      const setDraggingProjectId = vi.fn();

      renderToStaticMarkup(
        <CaptureColumn
          stage={dummyStageInquiry}
          allStages={dummyStages}
          projects={[dummyProject1]}
          locale="en"
          onMoveToStage={vi.fn()}
          onProjectDrop={onProjectDrop}
          draggingProjectId="proj-1"
          setDraggingProjectId={setDraggingProjectId}
          transitioningProjectIds={new Set()}
        />,
      );

      const dropzone = findNodeByTestId(capturedColumnTree, 'kanban-column-dropzone-inquiry');
      expect(dropzone).toBeDefined();

      const onDragOver = dropzone?.onDragOver as
        | ((e: { preventDefault: () => void; dataTransfer: { dropEffect: string } }) => void)
        | undefined;
      const preventDefault = vi.fn();
      const dataTransfer = { dropEffect: '' };
      onDragOver?.({ preventDefault, dataTransfer });
      expect(preventDefault).toHaveBeenCalled();
      expect(dataTransfer.dropEffect).toBe('move');

      const onDragEnter = dropzone?.onDragEnter as
        ((e: { preventDefault: () => void }) => void) | undefined;
      onDragEnter?.({ preventDefault });

      const onDragLeave = dropzone?.onDragLeave as
        | ((e: {
            currentTarget: { contains: (n: unknown) => boolean };
            relatedTarget: unknown;
          }) => void)
        | undefined;
      onDragLeave?.({ currentTarget: { contains: () => false }, relatedTarget: {} });
      onDragLeave?.({ currentTarget: { contains: () => true }, relatedTarget: {} });

      const onDrop = dropzone?.onDrop as
        | ((e: {
            preventDefault: () => void;
            dataTransfer: { getData: (k: string) => string };
          }) => void)
        | undefined;
      onDrop?.({ preventDefault, dataTransfer: { getData: () => 'proj-1' } });
      expect(onProjectDrop).toHaveBeenCalledWith('proj-1', dummyStageInquiry.id);

      // Drop with empty id
      onDrop?.({ preventDefault, dataTransfer: { getData: () => '' } });
    });

    it('handles card drag start and drag end within column', () => {
      const setDraggingProjectId = vi.fn();

      renderToStaticMarkup(
        <CaptureColumn
          stage={dummyStageInquiry}
          allStages={dummyStages}
          projects={[dummyProject1]}
          locale="en"
          onMoveToStage={vi.fn()}
          onProjectDrop={vi.fn()}
          draggingProjectId={null}
          setDraggingProjectId={setDraggingProjectId}
          transitioningProjectIds={new Set()}
        />,
      );

      function findCardProps(
        node: unknown,
      ): { onDragStart?: (id: string) => void; onDragEnd?: () => void } | undefined {
        if (!node || typeof node !== 'object') return undefined;
        if (React.isValidElement(node)) {
          const p = node.props as {
            onDragStart?: (id: string) => void;
            onDragEnd?: () => void;
            children?: React.ReactNode;
          };
          if (typeof p.onDragStart === 'function' && typeof p.onDragEnd === 'function') {
            return p;
          }
          if (p.children) return findCardProps(p.children);
        } else if (Array.isArray(node)) {
          for (const item of node) {
            const found = findCardProps(item);
            if (found) return found;
          }
        }
        return undefined;
      }

      const cardProps = findCardProps(capturedColumnTree);
      expect(cardProps).toBeDefined();
      cardProps?.onDragStart?.('proj-1');
      expect(setDraggingProjectId).toHaveBeenCalledWith('proj-1');
      cardProps?.onDragEnd?.();
      expect(setDraggingProjectId).toHaveBeenCalledWith(null);
    });
  });

  describe('KanbanBoard Component', () => {
    it('renders kanban board with all columns and live region', () => {
      const html = renderToStaticMarkup(
        <KanbanBoard initialStages={dummyStages} initialProjects={dummyProjects} locale="en" />,
      );

      expect(html).toContain('data-testid="kanban-live-region"');
      expect(html).toContain('data-testid="kanban-column-inquiry"');
      expect(html).toContain('data-testid="kanban-column-booked"');
      expect(html).toContain('data-testid="kanban-column-shot"');
      expect(html).toContain('data-testid="kanban-column-editing"');
      expect(html).toContain('data-testid="kanban-column-delivered"');
      expect(html).toContain('data-testid="kanban-column-archived"');
    });
  });

  describe('TaskWarningDialog Component', () => {
    it('renders task warning dialog with task list and buttons when open', () => {
      const html = renderToStaticMarkup(
        <TaskWarningDialog
          open={true}
          onOpenChange={vi.fn()}
          currentStageName="Editing"
          targetStageName="Delivered"
          incompleteTasks={[
            { id: 't-1', title: 'Color grading' },
            { id: 't-2', title: 'Export previews' },
          ]}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(html).toContain('data-testid="task-warning-dialog"');
      expect(html).toContain('Color grading');
      expect(html).toContain('Export previews');
      expect(html).toContain('data-testid="task-warning-cancel-btn"');
      expect(html).toContain('data-testid="task-warning-confirm-btn"');
    });

    it('renders closed dialog without content when open=false', () => {
      const html = renderToStaticMarkup(
        <TaskWarningDialog
          open={false}
          onOpenChange={vi.fn()}
          currentStageName="Editing"
          targetStageName="Delivered"
          incompleteTasks={[]}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(html).not.toContain('data-testid="task-warning-dialog"');
    });

    it('handles isConfirming=true, empty task list, and onOpenChange calling onCancel', () => {
      const onCancel = vi.fn();
      const onOpenChange = vi.fn();
      const onConfirm = vi.fn();

      renderToStaticMarkup(
        <CaptureTaskWarning
          open={true}
          onOpenChange={onOpenChange}
          currentStageName="Editing"
          targetStageName="Delivered"
          incompleteTasks={[]}
          onConfirm={onConfirm}
          onCancel={onCancel}
          isConfirming={true}
        />,
      );

      expect(capturedTaskWarningTree).not.toBeNull();
      const dialogProps = (capturedTaskWarningTree?.props ?? {}) as {
        onOpenChange?: (open: boolean) => void;
      };
      dialogProps.onOpenChange?.(false);
      expect(onCancel).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);

      dialogProps.onOpenChange?.(true);
      expect(onOpenChange).toHaveBeenCalledWith(true);

      const confirmBtn = findNodeByTestId(capturedTaskWarningTree, 'task-warning-confirm-btn');
      const onClickConfirm = confirmBtn?.onClick as (() => void) | undefined;
      onClickConfirm?.();
      expect(onConfirm).toHaveBeenCalled();

      const cancelBtn = findNodeByTestId(capturedTaskWarningTree, 'task-warning-cancel-btn');
      const onClickCancel = cancelBtn?.onClick as (() => void) | undefined;
      onClickCancel?.();
      expect(onCancel).toHaveBeenCalledTimes(2);
    });
  });

  describe('NewProjectDialog Component', () => {
    it('renders new project button', () => {
      const html = renderToStaticMarkup(
        <NewProjectDialog
          clients={[
            { id: 'c-1', displayName: 'Client A' },
            { id: 'c-2', displayName: 'Client B' },
          ]}
        />,
      );

      expect(html).toContain('data-testid="new-project-btn"');
      expect(html).toContain('projects.newProject');
    });
  });
});
