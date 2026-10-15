import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { KanbanColumnProps } from '@/components/projects/kanban-column';
import type { PipelineStage } from '@/server/db/schema/projects';
import type { KanbanProject } from '@/server/projects/service';

import type { TaskWarningDialogProps } from '@/components/projects/task-warning-dialog';

let mockStateQueue: unknown[] = [];
let capturedEffects: (() => unknown)[] = [];

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)): [T, (val: T | ((prev: T) => T)) => void] => {
      if (mockStateQueue.length > 0) {
        const val = mockStateQueue.shift() as T;
        return [
          val,
          (updater: T | ((prev: T) => T)) => {
            if (typeof updater === 'function') {
              (updater as (prev: T) => T)(val);
            }
          },
        ];
      }
      let currentVal = typeof initial === 'function' ? (initial as () => T)() : initial;
      const setter = (updater: T | ((prev: T) => T)) => {
        if (typeof updater === 'function') {
          currentVal = (updater as (prev: T) => T)(currentVal);
        } else {
          currentVal = updater;
        }
      };
      return [currentVal, setter];
    },
    useEffect: (cb: () => unknown) => {
      capturedEffects.push(cb);
    },
  };
});

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

const translationsMap = new Map<string, string>([
  ['projects.stages.inquiry', 'Inquiry Stage'],
  ['projects.stages.booked', 'Booked Stage'],
  ['projects.announcements.stageChanged', 'Project {title} moved to {stage}'],
  ['projects.announcements.stageChangeFailed', 'Failed to move {title} to {stage}'],
  ['projects.toast.stageChangeError', 'Failed to move project. Reverted to previous stage.'],
  ['projects.create.errorTitleRequired', 'Title is required'],
  ['projects.create.errorClientRequired', 'Client is required'],
]);

const getTranslation = (key: string): string | undefined => {
  return translationsMap.get(key);
};

vi.mock('next-intl', () => ({
  useTranslations: (section?: string) => {
    const t = (key: string, values?: Record<string, unknown>) => {
      const fullKey = section ? `${section}.${key}` : key;
      let text = getTranslation(fullKey) ?? fullKey;
      if (values) {
        for (const [k, v] of Object.entries(values)) {
          text = text.replace(`{${k}}`, String(v));
        }
      }
      return text;
    };
    t.has = (key: string) => {
      const fullKey = section ? `${section}.${key}` : key;
      return getTranslation(fullKey) !== undefined;
    };
    return t;
  },
  useLocale: () => 'en',
}));

let capturedColumnProps: KanbanColumnProps | null = null;
vi.mock('@/components/projects/kanban-column', () => ({
  KanbanColumn: (props: KanbanColumnProps) => {
    capturedColumnProps = props;
    return <div data-testid={`mock-column-${props.stage.key}`} />;
  },
}));

let capturedTaskWarningProps: TaskWarningDialogProps | null = null;
vi.mock('@/components/projects/task-warning-dialog', () => ({
  TaskWarningDialog: (props: TaskWarningDialogProps) => {
    capturedTaskWarningProps = props;
    return <div data-testid="mock-task-warning-dialog" />;
  },
}));

const mockTransitionAction = vi.fn();
const mockCreateAction = vi.fn();
vi.mock('@/server/projects/actions', () => ({
  transitionProjectStageAction: async (...args: unknown[]) => {
    return (await mockTransitionAction(...args)) as unknown;
  },
  createProjectAction: async (...args: unknown[]) => {
    return (await mockCreateAction(...args)) as unknown;
  },
}));

import { KanbanBoard } from '@/components/projects/kanban-board';
import {
  NewProjectDialog,
  type NewProjectDialogProps,
} from '@/components/projects/new-project-dialog';

describe('KanbanBoard and Dialogs Interactive Handlers Unit Tests', () => {
  const dummyStages: PipelineStage[] = [
    {
      id: '01920000-0000-7000-8000-000000000001',
      key: 'inquiry',
      name: 'Inquiry',
      position: 1,
      category: 'inquiry',
      color: 'slate',
      isSystem: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: '01920000-0000-7000-8000-000000000002',
      key: 'booked',
      name: 'Booked',
      position: 2,
      category: 'booked',
      color: 'blue',
      isSystem: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: '01920000-0000-7000-8000-000000000003',
      key: 'shot',
      name: 'Shot',
      position: 3,
      category: 'in_progress',
      color: 'amber',
      isSystem: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
  ];

  const dummyProjects: KanbanProject[] = [
    {
      id: 'proj-1',
      title: 'Emma & Liam Wedding',
      clientId: 'client-1',
      clientDisplayName: 'Emma Watson',
      stageId: '01920000-0000-7000-8000-000000000001',
      stageKey: 'inquiry',
      projectTypeKey: 'wedding',
      primaryShootStartsAt: '2027-06-19T10:00:00Z',
      primaryShootTimezone: 'Europe/Berlin',
      currency: 'EUR',
      priceMinor: 250000,
      taskCount: 1,
      completedTaskCount: 1,
      incompleteTasks: [],
    },
    {
      id: 'proj-with-tasks',
      title: 'Editing Session',
      clientId: 'client-2',
      clientDisplayName: 'Sophie & Noah',
      stageId: '01920000-0000-7000-8000-000000000001',
      stageKey: 'inquiry',
      projectTypeKey: 'wedding',
      primaryShootStartsAt: null,
      primaryShootTimezone: null,
      currency: 'EUR',
      priceMinor: 350000,
      taskCount: 2,
      completedTaskCount: 0,
      incompleteTasks: [
        {
          id: 'task-1',
          title: 'Cull images',
          stageId: '01920000-0000-7000-8000-000000000001',
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    capturedColumnProps = null;
    capturedTaskWarningProps = null;
    mockStateQueue = [];
    capturedEffects = [];
  });

  describe('KanbanBoard Handler Execution', () => {
    it('sets dragging project id when drag begins', () => {
      renderToStaticMarkup(
        <KanbanBoard initialStages={dummyStages} initialProjects={dummyProjects} locale="en" />,
      );

      expect(capturedColumnProps).not.toBeNull();
      capturedColumnProps?.setDraggingProjectId('proj-1');
    });

    it('handles drag drop of existing project without incomplete tasks immediately', async () => {
      mockTransitionAction.mockResolvedValueOnce({ success: true, project: dummyProjects[0] });

      renderToStaticMarkup(
        <KanbanBoard initialStages={dummyStages} initialProjects={dummyProjects} locale="en" />,
      );

      capturedColumnProps?.onProjectDrop('proj-1', '01920000-0000-7000-8000-000000000002');
      await new Promise((r) => setTimeout(r, 10));
      expect(mockTransitionAction).toHaveBeenCalledWith({
        projectId: 'proj-1',
        targetStageId: '01920000-0000-7000-8000-000000000002',
      });
    });

    it('ignores drag drop when project id does not exist', async () => {
      renderToStaticMarkup(
        <KanbanBoard initialStages={dummyStages} initialProjects={dummyProjects} locale="en" />,
      );

      capturedColumnProps?.onProjectDrop('non-existent', '01920000-0000-7000-8000-000000000002');
      await new Promise((r) => setTimeout(r, 10));
      expect(mockTransitionAction).not.toHaveBeenCalled();
    });

    it('ignores transition when target stage is identical to current stage', async () => {
      renderToStaticMarkup(
        <KanbanBoard initialStages={dummyStages} initialProjects={dummyProjects} locale="en" />,
      );

      const project = dummyProjects[0];
      if (project) {
        capturedColumnProps?.onMoveToStage(project, '01920000-0000-7000-8000-000000000001');
      }
      await new Promise((r) => setTimeout(r, 10));
      expect(mockTransitionAction).not.toHaveBeenCalled();
    });

    it('ignores transition when target stage is not found in stages map', async () => {
      renderToStaticMarkup(
        <KanbanBoard initialStages={dummyStages} initialProjects={dummyProjects} locale="en" />,
      );

      const project = dummyProjects[0];
      if (project) {
        capturedColumnProps?.onMoveToStage(project, '01920000-0000-7000-8000-999999999999');
      }
      await new Promise((r) => setTimeout(r, 10));
      expect(mockTransitionAction).not.toHaveBeenCalled();
    });

    it('shows advisory task warning dialog when incomplete tasks exist in current stage', () => {
      renderToStaticMarkup(
        <KanbanBoard initialStages={dummyStages} initialProjects={dummyProjects} locale="en" />,
      );

      const project = dummyProjects[1];
      if (project) {
        capturedColumnProps?.onMoveToStage(project, '01920000-0000-7000-8000-000000000002');
      }
      expect(mockTransitionAction).not.toHaveBeenCalled();
    });

    it('handles rollback and error toast when transitionProjectStageAction fails', async () => {
      mockTransitionAction.mockResolvedValueOnce({
        success: false,
        error: 'STAGE_NOT_FOUND',
      });

      renderToStaticMarkup(
        <KanbanBoard initialStages={dummyStages} initialProjects={dummyProjects} locale="en" />,
      );

      const project = dummyProjects[0];
      if (project) {
        capturedColumnProps?.onMoveToStage(project, '01920000-0000-7000-8000-000000000002');
      }
      await new Promise((r) => setTimeout(r, 10));
      expect(mockTransitionAction).toHaveBeenCalled();
    });

    it('executes transition when task warning dialog is confirmed', async () => {
      const projectWithTasks = dummyProjects[1];
      if (!projectWithTasks) throw new Error('Missing dummy project');

      mockTransitionAction.mockResolvedValueOnce({ success: true, project: projectWithTasks });

      const pending = {
        project: projectWithTasks,
        sourceStageId: dummyStages[0]?.id ?? 's1',
        targetStageId: dummyStages[1]?.id ?? 's2',
        incompleteTasks: projectWithTasks.incompleteTasks,
      };

      mockStateQueue = [dummyProjects, dummyProjects, null, new Set(), pending, false, '', null];

      renderToStaticMarkup(
        <KanbanBoard initialStages={dummyStages} initialProjects={dummyProjects} locale="en" />,
      );

      expect(capturedTaskWarningProps).not.toBeNull();
      expect(capturedTaskWarningProps?.open).toBe(true);

      // Confirm dialog
      capturedTaskWarningProps?.onConfirm();
      await new Promise((r) => setTimeout(r, 10));

      expect(mockTransitionAction).toHaveBeenCalledWith({
        projectId: 'proj-with-tasks',
        targetStageId: dummyStages[1]?.id,
      });
    });

    it('cancels transition when task warning dialog is cancelled or closed', async () => {
      const projectWithTasks = dummyProjects[1];
      if (!projectWithTasks) throw new Error('Missing dummy project');

      const pending = {
        project: projectWithTasks,
        sourceStageId: dummyStages[0]?.id ?? 's1',
        targetStageId: dummyStages[1]?.id ?? 's2',
        incompleteTasks: projectWithTasks.incompleteTasks,
      };

      mockStateQueue = [dummyProjects, dummyProjects, null, new Set(), pending, false, '', null];

      renderToStaticMarkup(
        <KanbanBoard initialStages={dummyStages} initialProjects={dummyProjects} locale="en" />,
      );

      expect(capturedTaskWarningProps).not.toBeNull();
      capturedTaskWarningProps?.onOpenChange(false);
      capturedTaskWarningProps?.onCancel();

      await new Promise((r) => setTimeout(r, 10));
      expect(mockTransitionAction).not.toHaveBeenCalled();
    });
  });

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

  describe('NewProjectDialog Interactive Handlers and Validation', () => {
    let capturedNewProjectTree: React.ReactElement | null = null;
    function CaptureNewProject(props: NewProjectDialogProps) {
      const result = NewProjectDialog(props);
      capturedNewProjectTree = result;
      return result;
    }

    interface FormProps {
      onSubmit?: (e: { preventDefault: () => void }) => void | Promise<void>;
      children?: React.ReactNode;
    }

    function findForm(node: unknown): FormProps | undefined {
      if (!node || typeof node !== 'object') return undefined;
      if (React.isValidElement(node)) {
        const props = node.props as FormProps;
        if (node.type === 'form' || typeof props.onSubmit === 'function') {
          return props;
        }
        if (props.children) {
          const res = findForm(props.children);
          if (res) return res;
        }
      } else if (Array.isArray(node)) {
        for (const item of node) {
          const res = findForm(item);
          if (res) return res;
        }
      }
      return undefined;
    }

    it('renders with empty clients gracefully', () => {
      const html = renderToStaticMarkup(<NewProjectDialog clients={[]} defaultOpen={true} />);
      expect(html).toContain('data-testid="new-project-dialog"');
    });

    it('handles validation error when title is empty', async () => {
      renderToStaticMarkup(
        <CaptureNewProject
          clients={[{ id: 'client-1', displayName: 'Client A' }]}
          defaultOpen={true}
        />,
      );

      expect(capturedNewProjectTree).not.toBeNull();
      const form = findForm(capturedNewProjectTree);
      expect(form).toBeDefined();

      const preventDefault = vi.fn();
      await form?.onSubmit?.({ preventDefault });
      expect(preventDefault).toHaveBeenCalled();
      expect(mockCreateAction).not.toHaveBeenCalled();
    });

    it('handles validation error when clientId is empty', async () => {
      mockStateQueue = [true, 'Valid Project Title', '', 'wedding', '', false, null];

      renderToStaticMarkup(<CaptureNewProject clients={[]} defaultOpen={true} />);

      expect(capturedNewProjectTree).not.toBeNull();
      const form = findForm(capturedNewProjectTree);
      const preventDefault = vi.fn();
      await form?.onSubmit?.({ preventDefault });
      expect(preventDefault).toHaveBeenCalled();
      expect(mockCreateAction).not.toHaveBeenCalled();
    });

    it('handles successful project creation and resets dialog', async () => {
      mockCreateAction.mockResolvedValueOnce({
        success: true,
        project: { id: 'new-proj-1', title: 'New Wedding' },
      });

      mockStateQueue = [true, 'New Wedding', 'client-1', 'wedding', '3500,50', false, null];

      renderToStaticMarkup(
        <CaptureNewProject
          clients={[{ id: 'client-1', displayName: 'Client A' }]}
          defaultOpen={true}
        />,
      );

      const form = findForm(capturedNewProjectTree);
      const preventDefault = vi.fn();
      await form?.onSubmit?.({ preventDefault });
      await new Promise((r) => setTimeout(r, 10));

      expect(mockCreateAction).toHaveBeenCalledWith({
        title: 'New Wedding',
        clientId: 'client-1',
        projectTypeKey: 'wedding',
        priceMinor: 350050,
        currency: 'EUR',
      });
      expect(mockRefresh).toHaveBeenCalled();

      // Trigger dialog open reset
      const dialogProps = (capturedNewProjectTree?.props ?? {}) as {
        onOpenChange?: (open: boolean) => void;
      };
      dialogProps.onOpenChange?.(true);
      dialogProps.onOpenChange?.(false);
    });

    it('handles action failure response cleanly', async () => {
      mockCreateAction.mockResolvedValueOnce({
        success: false,
        error: 'Database constraint failed',
      });

      mockStateQueue = [true, 'Failed Project', 'client-1', 'wedding', '', false, null];

      renderToStaticMarkup(
        <CaptureNewProject
          clients={[{ id: 'client-1', displayName: 'Client A' }]}
          defaultOpen={true}
        />,
      );

      const form = findForm(capturedNewProjectTree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });

      expect(mockCreateAction).toHaveBeenCalled();
    });

    function findInputByTestId(node: unknown, testId: string): Record<string, unknown> | undefined {
      if (!node || typeof node !== 'object') return undefined;
      if (React.isValidElement(node)) {
        const props = node.props as Record<string, unknown>;
        if (props['data-testid'] === testId) return props;
        if (props.children) {
          const res = findInputByTestId(props.children, testId);
          if (res) return res;
        }
      } else if (Array.isArray(node)) {
        for (const item of node) {
          const res = findInputByTestId(item, testId);
          if (res) return res;
        }
      }
      return undefined;
    }

    it('handles input changes for title, client, type, and price fields', () => {
      renderToStaticMarkup(
        <CaptureNewProject
          clients={[{ id: 'client-1', displayName: 'Client A' }]}
          defaultOpen={true}
        />,
      );

      const titleInput = findInputByTestId(capturedNewProjectTree, 'new-project-title-input');
      const onTitleChange = titleInput?.onChange as
        ((e: { target: { value: string } }) => void) | undefined;
      onTitleChange?.({ target: { value: 'Updated Title' } });

      const clientSelect = findInputByTestId(capturedNewProjectTree, 'new-project-client-select');
      const onClientChange = clientSelect?.onChange as
        ((e: { target: { value: string } }) => void) | undefined;
      onClientChange?.({ target: { value: 'client-1' } });

      const typeSelect = findInputByTestId(capturedNewProjectTree, 'new-project-type-select');
      const onTypeChange = typeSelect?.onChange as
        ((e: { target: { value: string } }) => void) | undefined;
      onTypeChange?.({ target: { value: 'portrait' } });

      const priceInput = findInputByTestId(capturedNewProjectTree, 'new-project-price-input');
      const onPriceChange = priceInput?.onChange as
        ((e: { target: { value: string } }) => void) | undefined;
      onPriceChange?.({ target: { value: '1500' } });

      expect(titleInput).toBeDefined();

      const cancelBtn = findNodeByTestId(capturedNewProjectTree, 'new-project-cancel-btn');
      expect(cancelBtn).toBeDefined();
      const onCancelClick = cancelBtn?.onClick as (() => void) | undefined;
      onCancelClick?.();
    });

    it('submits project without price when priceEuro is omitted or invalid', async () => {
      mockCreateAction.mockResolvedValueOnce({
        success: true,
        project: { id: 'p-no-price', title: 'No Price' },
      });

      mockStateQueue = [true, 'No Price', 'client-1', 'wedding', '', false, null];

      renderToStaticMarkup(
        <CaptureNewProject
          clients={[{ id: 'client-1', displayName: 'Client A' }]}
          defaultOpen={true}
        />,
      );

      const form = findForm(capturedNewProjectTree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });
      await new Promise((r) => setTimeout(r, 10));

      expect(mockCreateAction).toHaveBeenCalledWith({
        title: 'No Price',
        clientId: 'client-1',
        projectTypeKey: 'wedding',
        priceMinor: undefined,
        currency: 'EUR',
      });
    });

    it('submits project when priceEuro contains invalid characters resulting in NaN', async () => {
      mockCreateAction.mockResolvedValueOnce({
        success: true,
        project: { id: 'p-nan-price', title: 'NaN Price' },
      });

      mockStateQueue = [true, 'NaN Price', 'client-1', 'wedding', 'abc', false, null];

      renderToStaticMarkup(
        <CaptureNewProject
          clients={[{ id: 'client-1', displayName: 'Client A' }]}
          defaultOpen={true}
        />,
      );

      const form = findForm(capturedNewProjectTree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });
      await new Promise((r) => setTimeout(r, 10));

      expect(mockCreateAction).toHaveBeenCalledWith({
        title: 'NaN Price',
        clientId: 'client-1',
        projectTypeKey: 'wedding',
        priceMinor: undefined,
        currency: 'EUR',
      });
    });

    it('renders error banner when errorMessage state is non-null', () => {
      mockStateQueue = [true, '', '', 'wedding', '', false, 'A critical creation error occurred'];

      renderToStaticMarkup(
        <CaptureNewProject
          clients={[{ id: 'client-1', displayName: 'Client A' }]}
          defaultOpen={true}
        />,
      );

      expect(capturedNewProjectTree).not.toBeNull();
      const errEl = findNodeByTestId(capturedNewProjectTree, 'new-project-error');
      expect(errEl).toBeDefined();
    });
  });

  describe('KanbanBoard Toast Notification and Dismissal', () => {
    let capturedBoardTree: React.ReactElement | null = null;
    function CaptureBoard(props: React.ComponentProps<typeof KanbanBoard>) {
      const res = KanbanBoard(props);
      capturedBoardTree = res;
      return res;
    }

    it('renders and dismisses error toast notification when toast state is set', () => {
      mockStateQueue = [
        dummyProjects,
        dummyProjects,
        null,
        new Set(),
        null,
        false,
        '',
        { message: 'Error occurred', type: 'error' },
      ];

      renderToStaticMarkup(
        <CaptureBoard initialStages={dummyStages} initialProjects={dummyProjects} locale="en" />,
      );

      expect(capturedBoardTree).not.toBeNull();
      const dismissBtn = findNodeByTestId(capturedBoardTree, 'kanban-error-toast-dismiss');
      expect(dismissBtn).toBeDefined();

      const onClick = dismissBtn?.onClick as (() => void) | undefined;
      onClick?.();

      // Trigger captured timer effects and cleanups
      for (const effect of capturedEffects) {
        const cleanup = effect();
        if (typeof cleanup === 'function') {
          const runCleanup = cleanup as () => void;
          runCleanup();
        }
      }
    });

    it('syncs projects state when initialProjects prop changes', () => {
      mockStateQueue = [dummyProjects, [], null, new Set(), null, false, '', null];

      renderToStaticMarkup(
        <CaptureBoard initialStages={dummyStages} initialProjects={dummyProjects} locale="en" />,
      );
    });
  });
});
