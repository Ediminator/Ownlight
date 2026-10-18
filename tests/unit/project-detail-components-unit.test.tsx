import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
    useCallback: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
    useMemo: <T,>(fn: () => T): T => fn(),
    useRef: <T,>(val: T): { current: T } => ({ current: val }),
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
  usePathname: () => '/en/projects/proj-123',
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

vi.mock('@/server/projects/actions', () => ({
  updateProjectAction: vi.fn().mockResolvedValue({ success: true }),
  deleteProjectAction: vi.fn().mockResolvedValue({ success: true }),
  transitionProjectStageAction: vi.fn().mockResolvedValue({ success: true }),
  createShootAction: vi.fn().mockResolvedValue({
    success: true,
    data: {
      shoot: {
        id: 'shoot-new',
        projectId: 'proj-123',
        title: 'New Shoot',
        startsAt: new Date('2027-06-12T10:00:00Z'),
        endsAt: new Date('2027-06-12T18:00:00Z'),
        timezone: 'UTC',
        notes: null,
      },
    },
  }),
  updateShootAction: vi.fn().mockResolvedValue({
    success: true,
    data: {
      shoot: {
        id: 'shoot-1',
        projectId: 'proj-123',
        title: 'Updated Shoot',
        startsAt: new Date('2027-06-12T10:00:00Z'),
        endsAt: new Date('2027-06-12T18:00:00Z'),
        timezone: 'UTC',
        notes: null,
      },
    },
  }),
  deleteShootAction: vi.fn().mockResolvedValue({ success: true }),
  createShootLocationAction: vi.fn().mockResolvedValue({
    success: true,
    data: { location: { id: 'loc-new', name: 'New Loc', order: 1 } },
  }),
  updateShootLocationAction: vi.fn().mockResolvedValue({
    success: true,
    data: { location: { id: 'loc-1', name: 'Updated Loc' } },
  }),
  deleteShootLocationAction: vi.fn().mockResolvedValue({ success: true }),
  createShootTimelineItemAction: vi.fn().mockResolvedValue({
    success: true,
    data: { item: { id: 'ti-new', title: 'New Item', startsAt: '2027-06-12T10:00:00Z', order: 1 } },
  }),
  updateShootTimelineItemAction: vi.fn().mockResolvedValue({
    success: true,
    data: { item: { id: 'time-1', title: 'Updated Item', startsAt: '2027-06-12T10:00:00Z' } },
  }),
  deleteShootTimelineItemAction: vi.fn().mockResolvedValue({ success: true }),
  createProjectParticipantAction: vi.fn().mockResolvedValue({
    success: true,
    data: { participant: { id: 'p-new', name: 'New Part', role: 'Vendor' } },
  }),
  deleteProjectParticipantAction: vi.fn().mockResolvedValue({ success: true }),
  createProjectTaskAction: vi.fn().mockResolvedValue({
    success: true,
    data: {
      taskId: 't-new',
      task: { id: 't-new', title: 'New Task', isCompleted: false, order: 1 },
    },
  }),
  toggleProjectTaskAction: vi.fn().mockResolvedValue({
    success: true,
    data: { task: { id: 'task-1', title: 'Task 1', isCompleted: true } },
  }),
  deleteProjectTaskAction: vi.fn().mockResolvedValue({ success: true }),
}));

import { ProjectDetailView } from '@/components/projects/project-detail-view';
import { ShootsSection } from '@/components/projects/shoots-section';
import { LocationsSection } from '@/components/projects/locations-section';
import { TimelineScheduleSection } from '@/components/projects/timeline-schedule-section';
import { ParticipantsSection } from '@/components/projects/participants-section';
import { StageTasksSection } from '@/components/projects/stage-tasks-section';
import { TaskWarningDialog } from '@/components/projects/task-warning-dialog';
import type {
  ProjectDetailData,
  ProjectDetailShootLocation,
  ProjectDetailTimelineItem,
  ProjectDetailParticipant,
} from '@/server/projects/service';
import type { Shoot, ProjectTask, PipelineStage } from '@/server/db/schema/projects';
import * as projectActions from '@/server/projects/actions';

interface FormProps {
  onSubmit?: (e: { preventDefault: () => void }) => Promise<void> | void;
}

interface CommonNodeProps {
  'data-testid'?: string;
  onClick?: () => Promise<void> | void;
  onChange?: (e: unknown) => void;
  onSubmit?: (e: { preventDefault: () => void }) => Promise<void> | void;
  onOpenChange?: (open: boolean) => void;
  children?: unknown;
  [key: string]: unknown;
}

function findNode<P extends CommonNodeProps = CommonNodeProps>(
  node: unknown,
  predicate: (el: React.ReactElement<CommonNodeProps>) => boolean,
): React.ReactElement<P> | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (React.isValidElement(node)) {
    const el = node as React.ReactElement<CommonNodeProps>;
    if (predicate(el)) return el as React.ReactElement<P>;
    const props = el.props as { children?: unknown };
    if (props.children) {
      const res = findNode<P>(props.children, predicate);
      if (res) return res;
    }
  } else if (Array.isArray(node)) {
    for (const item of node) {
      const res = findNode<P>(item, predicate);
      if (res) return res;
    }
  }
  return undefined;
}

function findNodeByTestId(node: unknown, testId: string): CommonNodeProps | undefined {
  const el = findNode(node, (e) => e.props['data-testid'] === testId);
  return el ? el.props : undefined;
}

function findAllNodes<P extends CommonNodeProps = CommonNodeProps>(
  node: unknown,
  predicate: (el: React.ReactElement<CommonNodeProps>) => boolean,
): React.ReactElement<P>[] {
  const matches: React.ReactElement<P>[] = [];
  function walk(current: unknown) {
    if (!current || typeof current !== 'object') return;
    if (React.isValidElement(current)) {
      const el = current as React.ReactElement<CommonNodeProps>;
      if (predicate(el)) matches.push(el as React.ReactElement<P>);
      const props = el.props as { children?: unknown };
      if (props.children) walk(props.children);
    } else if (Array.isArray(current)) {
      for (const item of current) walk(item);
    }
  }
  walk(node);
  return matches;
}

function findForm(node: unknown): FormProps | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (React.isValidElement(node)) {
    if (node.type === 'form') {
      return node.props as FormProps;
    }
    const props = node.props as Record<string, unknown>;
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

function findFormBySubmitTestId(tree: unknown, submitTestId: string): FormProps | undefined {
  let found: FormProps | undefined;
  function walk(current: unknown): void {
    if (!current || typeof current !== 'object' || found) return;
    if (React.isValidElement(current)) {
      if (current.type === 'form') {
        const btn = findNodeByTestId(current, submitTestId);
        if (btn) {
          found = current.props as FormProps;
          return;
        }
      }
      const props = current.props as Record<string, unknown>;
      if (props.children) walk(props.children);
    } else if (Array.isArray(current)) {
      for (const item of current) walk(item);
    }
  }
  walk(tree);
  return found;
}

describe('Project Detail Components Comprehensive Unit Tests', () => {
  beforeEach(() => {
    mockStateQueue = [];
    capturedEffects = [];
    vi.clearAllMocks();
  });

  const dummyStages: [PipelineStage, ...PipelineStage[]] = [
    {
      id: 'stage-1',
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
      id: 'stage-2',
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
      id: 'stage-3',
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

  const dummyShoots: [Shoot, ...Shoot[]] = [
    {
      id: 'shoot-1',
      projectId: 'proj-123',
      title: 'Wedding Ceremony & Reception',
      startsAt: new Date('2027-06-12T13:00:00Z'),
      endsAt: new Date('2027-06-12T22:00:00Z'),
      timezone: 'Europe/Berlin',
      notes: 'Bring 70-200mm f/2.8 and portable flashes for evening reception.',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
  ];

  const dummyLocations: ProjectDetailShootLocation[] = [
    {
      id: 'loc-1',
      shootId: 'shoot-1',
      name: 'Charlottenburg Palace',
      addressLine1: 'Spandauer Damm 20',
      addressLine2: null,
      postalCode: '14059',
      city: 'Berlin',
      countryCode: 'DE',
      notes: 'Check-in at gate 2',
      order: 1,
      shootTitle: 'Wedding Ceremony & Reception',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
  ];

  const dummyTimeline: [ProjectDetailTimelineItem, ...ProjectDetailTimelineItem[]] = [
    {
      id: 'time-1',
      shootId: 'shoot-1',
      locationId: 'loc-1',
      title: '14:00 First Look',
      description: 'Private garden area behind main hall',
      startsAt: new Date('2027-06-12T14:00:00Z'),
      endsAt: new Date('2027-06-12T14:45:00Z'),
      order: 1,
      shootTitle: 'Wedding Ceremony & Reception',
      locationName: 'Charlottenburg Palace',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
  ];

  const dummyParticipants: ProjectDetailParticipant[] = [
    {
      id: 'part-1',
      projectId: 'proj-123',
      contactId: null,
      name: 'Maria Schmidt',
      role: 'Second Shooter',
      email: 'maria.schmidt@photo.example',
      phone: '+49 151 98765432',
      isPrimary: false,
      notes: 'Brings drone and lighting gear',
      contactDisplayName: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: 'part-2',
      projectId: 'proj-123',
      contactId: 'contact-1',
      name: 'Hannah Weber',
      role: 'Bride',
      email: 'hannah@example.com',
      phone: '+49 30 11223344',
      isPrimary: true,
      notes: null,
      contactDisplayName: 'Hannah Weber',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
  ];

  const dummyTasks: [ProjectTask, ...ProjectTask[]] = [
    {
      id: 'task-1',
      projectId: 'proj-123',
      stageId: 'stage-1',
      title: 'Send consultation questionnaire',
      isCompleted: false,
      dueDate: new Date('2027-01-15T00:00:00Z'),
      order: 1,
      completedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: 'task-2',
      projectId: 'proj-123',
      stageId: 'stage-1',
      title: 'Review moodboard',
      isCompleted: true,
      dueDate: null,
      order: 2,
      completedAt: new Date('2026-01-10T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
  ];

  const baseStage = dummyStages[0];
  const baseShoot = dummyShoots[0];
  const baseTimeline = dummyTimeline[0];
  const baseTask = dummyTasks[0];

  const dummyProjectDetailData: ProjectDetailData = {
    project: {
      id: 'proj-123',
      clientId: 'client-123',
      leadId: 'lead-123',
      stageId: 'stage-1',
      title: 'Schmidt & Weber Wedding',
      projectTypeKey: 'wedding',
      primaryShootStartsAt: new Date('2027-06-12T13:00:00Z'),
      primaryShootTimezone: 'Europe/Berlin',
      priceMinor: 320000,
      currency: 'EUR',
      notes: 'Special request for golden hour couple portraits by the lake.',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    },
    stages: dummyStages,
    currentStage: dummyStages[0],
    shoots: dummyShoots,
    locations: dummyLocations,
    timelineItems: dummyTimeline,
    participants: dummyParticipants,
    tasks: dummyTasks,
    client: {
      id: 'client-123',
      displayName: 'Hannah Weber',
      email: 'hannah@example.com',
      phone: '+49 30 11223344',
    },
    clientContacts: [
      {
        id: 'contact-1',
        displayName: 'Hannah Weber',
        email: 'hannah@example.com',
        phone: '+49 30 11223344',
        isPrimary: true,
      },
    ],
  };

  // --------------------------------------------------------------------------
  // ProjectDetailView Tests
  // --------------------------------------------------------------------------
  describe('ProjectDetailView', () => {
    it('renders project detail view with header, stepper, tabs, and all sections', () => {
      const html = renderToStaticMarkup(
        <ProjectDetailView initialData={dummyProjectDetailData} locale="en" />,
      );

      expect(html).toContain('data-testid="project-detail-view"');
      expect(html).toContain('Schmidt &amp; Weber Wedding');
      expect(html).toContain('data-testid="stage-stepper"');
      expect(html).toContain('data-testid="tab-all"');
      expect(html).toContain('data-testid="shoots-section"');
      expect(html).toContain('data-testid="locations-section"');
      expect(html).toContain('data-testid="timeline-section"');
      expect(html).toContain('data-testid="participants-section"');
      expect(html).toContain('data-testid="stage-tasks-section"');
    });

    it('renders project detail view without price and with unscheduled shoots', () => {
      const noPriceData: ProjectDetailData = {
        ...dummyProjectDetailData,
        project: {
          ...dummyProjectDetailData.project,
          priceMinor: null,
          notes: null,
        },
      };

      const html = renderToStaticMarkup(
        <ProjectDetailView initialData={noPriceData} locale="en" />,
      );

      expect(html).toContain('data-testid="project-title"');
    });

    it('handles tab switches and stage stepper navigation', () => {
      const tree = ProjectDetailView({ initialData: dummyProjectDetailData, locale: 'en' });

      // Click each tab
      for (const tabKey of ['all', 'shoots', 'locations', 'timeline', 'participants', 'tasks']) {
        const tab = findNodeByTestId(tree, `tab-${tabKey}`);
        void tab?.onClick?.();
      }

      // Click stage step in stepper (current stage -> early return)
      const stepInquiry = findNodeByTestId(tree, 'stage-step-inquiry');
      void stepInquiry?.onClick?.();

      // Click stage step in stepper (target stage with incomplete tasks -> triggers warning)
      const stepBooked = findNodeByTestId(tree, 'stage-step-booked');
      void stepBooked?.onClick?.();

      // Click Edit and Delete project buttons
      const editBtn = findNodeByTestId(tree, 'edit-project-btn');
      void editBtn?.onClick?.();

      const deleteBtn = findNodeByTestId(tree, 'delete-project-btn');
      void deleteBtn?.onClick?.();
    });

    it('handles stage transition warning dialog confirmation and cancellation', async () => {
      // With pendingTargetStageId set to 'stage-2'
      mockStateQueue = [
        dummyProjectDetailData.project, // 1: project
        dummyShoots, // 2: shoots
        dummyLocations, // 3: locations
        dummyTimeline, // 4: timelineItems
        dummyParticipants, // 5: participants
        dummyTasks, // 6: tasks
        dummyStages[0], // 7: currentStage
        'all', // 8: activeTab
        'stage-2', // 9: pendingTargetStageId
        false, // 10: isTransitioning
        null, // 11: transitionError
        false, // 12: isEditOpen
        'Title', // 13: editTitle
        'wedding', // 14: editType
        '2500', // 15: editPrice
        'Notes', // 16: editNotes
        false, // 17: isSavingProject
        null, // 18: editError
        false, // 19: isDeleteOpen
        false, // 20: isDeleting
      ];

      const tree = ProjectDetailView({ initialData: dummyProjectDetailData, locale: 'en' });
      const warningDialog = findNode(tree, (el) => el.type === TaskWarningDialog);
      expect(warningDialog).toBeDefined();

      const onConfirm = warningDialog?.props.onConfirm as (() => Promise<void>) | undefined;
      await onConfirm?.();

      const onCancel = warningDialog?.props.onCancel as (() => void) | undefined;
      onCancel?.();

      const onOpenChange = warningDialog?.props.onOpenChange;
      onOpenChange?.(false);

      // Also directly test TaskWarningDialog rendering and button interactions
      const warningHtml = renderToStaticMarkup(
        <TaskWarningDialog
          open={true}
          onOpenChange={vi.fn()}
          currentStageName="Inquiry"
          targetStageName="Booked"
          incompleteTasks={[{ id: 't-1', title: 'Task 1' }]}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
          isConfirming={false}
        />,
      );
      expect(warningHtml).toContain('data-testid="task-warning-dialog"');
      expect(warningHtml).toContain('data-testid="task-warning-confirm-btn"');
      expect(warningHtml).toContain('data-testid="task-warning-cancel-btn"');

      // Test TaskWarningDialog with isConfirming = true
      const confirmingHtml = renderToStaticMarkup(
        <TaskWarningDialog
          open={true}
          onOpenChange={vi.fn()}
          currentStageName="Inquiry"
          targetStageName="Booked"
          incompleteTasks={[]}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
          isConfirming={true}
        />,
      );
      expect(confirmingHtml).toContain('data-testid="task-warning-dialog"');

      // Test TaskWarningDialog onOpenChange
      const onCancelMock = vi.fn();
      const onOpenChangeMock = vi.fn();
      const dialogTree = TaskWarningDialog({
        open: true,
        onOpenChange: onOpenChangeMock,
        currentStageName: 'Inquiry',
        targetStageName: 'Booked',
        incompleteTasks: [{ id: 't-1', title: 'Task 1' }],
        onConfirm: vi.fn(),
        onCancel: onCancelMock,
      });
      const dialogNode = findNode(dialogTree, (el) => typeof el.props.onOpenChange === 'function');
      const onDialogNodeOpenChange = dialogNode?.props.onOpenChange;
      onDialogNodeOpenChange?.(false);
      expect(onCancelMock).toHaveBeenCalled();
      onDialogNodeOpenChange?.(true);
      expect(onOpenChangeMock).toHaveBeenCalledWith(true);
    });

    it('handles stage transition direct execution when tasks are completed or error occurs', async () => {
      const allCompletedTasks = dummyTasks.map((t) => ({ ...t, isCompleted: true }));
      const completedData = { ...dummyProjectDetailData, tasks: allCompletedTasks };

      // Transition success
      const tree = ProjectDetailView({ initialData: completedData, locale: 'en' });
      const stepBooked = findNodeByTestId(tree, 'stage-step-booked');
      await stepBooked?.onClick?.();

      // Transition failure
      vi.mocked(projectActions.transitionProjectStageAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Pipeline transition forbidden',
      });
      await stepBooked?.onClick?.();

      // Transition throws
      vi.mocked(projectActions.transitionProjectStageAction).mockRejectedValueOnce(
        new Error('Network error'),
      );
      await stepBooked?.onClick?.();
    });

    it('handles edit and delete project dialog submissions and inputs', async () => {
      // Test when edit modal is open (isEditOpen = true)
      mockStateQueue = [
        dummyProjectDetailData.project, // 1: project
        dummyShoots, // 2: shoots
        dummyLocations, // 3: locations
        dummyTimeline, // 4: timelineItems
        dummyParticipants, // 5: participants
        dummyTasks, // 6: tasks
        dummyStages[0], // 7: currentStage
        'all', // 8: activeTab
        null, // 9: pendingTargetStageId
        false, // 10: isTransitioning
        null, // 11: transitionError
        true, // 12: isEditOpen
        'Updated Title', // 13: editTitle
        'wedding', // 14: editType
        '2500', // 15: editPrice
        'New notes', // 16: editNotes
        false, // 17: isSavingProject
        null, // 18: editError
        false, // 19: isDeleteOpen
        false, // 20: isDeleting
      ];

      const tree = ProjectDetailView({ initialData: dummyProjectDetailData, locale: 'en' });

      // Change input fields
      const inputs = findAllNodes(
        tree,
        (el) => typeof el.type === 'string' && ['input', 'select', 'textarea'].includes(el.type),
      );
      for (const input of inputs) {
        const onChange = input.props.onChange;
        onChange?.({ target: { value: 'edited-value' } });
      }

      // Submit valid edit
      const editForm = findForm(tree);
      const onSubmit = editForm?.onSubmit;
      await onSubmit?.({ preventDefault: vi.fn() });

      // Submit edit failure
      vi.mocked(projectActions.updateProjectAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Update failed',
      });
      await onSubmit?.({ preventDefault: vi.fn() });

      // Submit edit catch
      vi.mocked(projectActions.updateProjectAction).mockRejectedValueOnce(
        new Error('Network crash'),
      );
      await onSubmit?.({ preventDefault: vi.fn() });

      // Submit edit with empty title (validation error)
      mockStateQueue = [
        dummyProjectDetailData.project,
        dummyShoots,
        dummyLocations,
        dummyTimeline,
        dummyParticipants,
        dummyTasks,
        dummyStages[0],
        'all',
        null,
        false,
        null,
        true,
        '', // empty title
        'wedding',
        '', // empty price
        '',
        false,
        null,
        false,
        false,
      ];
      const emptyTree = ProjectDetailView({ initialData: dummyProjectDetailData, locale: 'en' });
      const emptyForm = findForm(emptyTree);
      await emptyForm?.onSubmit?.({ preventDefault: vi.fn() });

      // Render to static markup with isEditOpen = true, isSavingProject = true, editError set
      mockStateQueue = [
        dummyProjectDetailData.project,
        dummyShoots,
        dummyLocations,
        dummyTimeline,
        dummyParticipants,
        dummyTasks,
        dummyStages[0],
        'all',
        null,
        false,
        null,
        true, // isEditOpen
        'Updated Title',
        'wedding',
        '2500',
        'Notes',
        true, // isSavingProject (spinner)
        'Save failed error', // editError (alert)
        false,
        false,
      ];
      const editMarkup = renderToStaticMarkup(
        <ProjectDetailView initialData={dummyProjectDetailData} locale="en" />,
      );
      expect(editMarkup).toContain('data-testid="edit-project-dialog"');

      // Test when delete modal is open (isDeleteOpen = true)
      mockStateQueue = [
        dummyProjectDetailData.project,
        dummyShoots,
        dummyLocations,
        dummyTimeline,
        dummyParticipants,
        dummyTasks,
        dummyStages[0],
        'all',
        null,
        false,
        null,
        false,
        'Title',
        'wedding',
        '2500',
        'Notes',
        false,
        null,
        true, // isDeleteOpen
        false, // isDeleting
      ];

      const deleteTree = ProjectDetailView({ initialData: dummyProjectDetailData, locale: 'en' });
      const confirmDeleteBtn = findNodeByTestId(deleteTree, 'delete-project-confirm-btn');
      await confirmDeleteBtn?.onClick?.();

      // Delete catch branch
      vi.mocked(projectActions.deleteProjectAction).mockRejectedValueOnce(
        new Error('Failed to delete'),
      );
      await confirmDeleteBtn?.onClick?.();

      // Render delete dialog with isDeleting = true
      mockStateQueue = [
        dummyProjectDetailData.project,
        dummyShoots,
        dummyLocations,
        dummyTimeline,
        dummyParticipants,
        dummyTasks,
        dummyStages[0],
        'all',
        null,
        false,
        null,
        false,
        'Title',
        'wedding',
        '2500',
        'Notes',
        false,
        null,
        true, // isDeleteOpen
        true, // isDeleting (spinner)
      ];
      const deleteMarkup = renderToStaticMarkup(
        <ProjectDetailView initialData={dummyProjectDetailData} locale="en" />,
      );
      expect(deleteMarkup).toContain('data-testid="delete-project-dialog"');
    });
  });

  // --------------------------------------------------------------------------
  // ShootsSection Tests
  // --------------------------------------------------------------------------
  describe('ShootsSection', () => {
    it('renders shoots list and formats durations accurately', () => {
      const variedShoots: Shoot[] = [
        {
          ...baseShoot,
          id: 's-short',
          startsAt: new Date('2027-06-12T10:00:00Z'),
          endsAt: new Date('2027-06-12T10:30:00Z'), // 30m (hours === 0)
        },
        {
          ...baseShoot,
          id: 's-hours',
          startsAt: new Date('2027-06-12T10:00:00Z'),
          endsAt: new Date('2027-06-12T12:00:00Z'), // 2h (minutes === 0)
        },
        {
          ...baseShoot,
          id: 's-both',
          startsAt: new Date('2027-06-12T10:00:00Z'),
          endsAt: new Date('2027-06-12T12:45:00Z'), // 2h 45m
        },
        {
          ...baseShoot,
          id: 's-negative',
          startsAt: new Date('2027-06-12T12:00:00Z'),
          endsAt: new Date('2027-06-12T10:00:00Z'), // negative -> null
        },
        {
          ...baseShoot,
          id: 's-no-ends',
          startsAt: new Date('2027-06-12T10:00:00Z'),
          endsAt: null, // null endsAt
          notes: null,
        },
      ];

      const html = renderToStaticMarkup(
        <ShootsSection
          projectId="proj-123"
          shoots={variedShoots}
          locale="en"
          onShootsChange={vi.fn()}
        />,
      );

      expect(html).toContain('data-testid="shoots-section"');
      expect(html).toContain('data-testid="shoots-list"');
      expect(html).toContain('30m');
      expect(html).toContain('2h');
      expect(html).toContain('2h 45m');
    });

    it('renders empty shoots state and handles opening modals', () => {
      const html = renderToStaticMarkup(
        <ShootsSection projectId="proj-123" shoots={[]} locale="en" onShootsChange={vi.fn()} />,
      );
      expect(html).toContain('data-testid="shoots-empty"');

      // Click card buttons
      const tree = ShootsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locale: 'en',
      });

      const addBtn = findNodeByTestId(tree, 'add-shoot-btn');
      void addBtn?.onClick?.();

      const editBtn = findNodeByTestId(tree, 'edit-shoot-btn-shoot-1');
      void editBtn?.onClick?.();

      const deleteBtn = findNodeByTestId(tree, 'delete-shoot-btn-shoot-1');
      void deleteBtn?.onClick?.();
    });

    it('handles add shoot modal input changes, cancel, validation, and submission', async () => {
      const onShootsChange = vi.fn();

      // Render with isAddOpen = true
      mockStateQueue = [
        dummyShoots, // shoots
        true, // isAddOpen
        'Reception Party', // addTitle
        '2027-06-12T18:00', // addStartsAt
        '2027-06-12T23:00', // addEndsAt
        'Europe/Berlin', // addTimezone
        'DJ setup lights', // addNotes
        false, // isAdding
        null, // addError
        null, // editingShoot
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        null, // deletingShoot
        false,
        null,
      ];

      const tree = ShootsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locale: 'en',
        onShootsChange,
      });

      // Fire onChange for inputs
      const inputs = findAllNodes(
        tree,
        (el) => typeof el.type === 'string' && ['input', 'select', 'textarea'].includes(el.type),
      );
      for (const input of inputs) {
        const onChange = input.props.onChange;
        onChange?.({ target: { value: 'test-value' } });
      }

      // Click cancel
      const cancelBtn = findNodeByTestId(tree, 'add-shoot-cancel-btn');
      void cancelBtn?.onClick?.();

      // Submit success
      const addForm = findForm(tree);
      const onSubmit = addForm?.onSubmit;
      await onSubmit?.({ preventDefault: vi.fn() });
      expect(onShootsChange).toHaveBeenCalled();

      // Submit failure
      vi.mocked(projectActions.createShootAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Shoot creation rejected',
      });
      await onSubmit?.({ preventDefault: vi.fn() });

      // Submit catch
      vi.mocked(projectActions.createShootAction).mockRejectedValueOnce(
        new Error('Shoot creation crashed'),
      );
      await onSubmit?.({ preventDefault: vi.fn() });

      // Render markup with isAddOpen = true, isAdding = true, addError set
      mockStateQueue = [
        dummyShoots,
        true,
        'Reception Party',
        '2027-06-12T18:00',
        '2027-06-12T23:00',
        'Europe/Berlin',
        'DJ setup lights',
        true, // isAdding (spinner)
        'Add error occurred', // addError (alert)
        null,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const addHtml = renderToStaticMarkup(
        <ShootsSection projectId="proj-123" shoots={dummyShoots} locale="en" />,
      );
      expect(addHtml).toContain('data-testid="add-shoot-dialog"');
      expect(addHtml).toContain('data-testid="add-shoot-error"');
    });

    it('handles edit and delete shoot modal interactions and submissions', async () => {
      const onShootsChange = vi.fn();

      // Render with editingShoot
      mockStateQueue = [
        dummyShoots,
        false,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        baseShoot, // editingShoot
        'Updated Ceremony',
        '2027-06-12T13:00',
        '2027-06-12T17:00',
        'Europe/Berlin',
        'Updated Notes',
        false,
        null,
        null,
        false,
        null,
      ];

      const editTree = ShootsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locale: 'en',
        onShootsChange,
      });

      // Inputs onChange
      const editInputs = findAllNodes(
        editTree,
        (el) => typeof el.type === 'string' && ['input', 'select', 'textarea'].includes(el.type),
      );
      for (const input of editInputs) {
        const onChange = input.props.onChange;
        onChange?.({ target: { value: 'updated-val' } });
      }

      // Cancel edit
      const cancelEdit = findNodeByTestId(editTree, 'edit-shoot-cancel-btn');
      void cancelEdit?.onClick?.();

      // Submit edit success
      const editForm = findFormBySubmitTestId(editTree, 'edit-shoot-submit-btn');
      const onSubmitEdit = editForm?.onSubmit as ((e: unknown) => Promise<void>) | undefined;
      await onSubmitEdit?.({ preventDefault: vi.fn() });

      // Submit edit failure
      vi.mocked(projectActions.updateShootAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Failed to update shoot',
      });
      await onSubmitEdit?.({ preventDefault: vi.fn() });

      // Submit edit catch
      vi.mocked(projectActions.updateShootAction).mockRejectedValueOnce(
        new Error('Network error on edit'),
      );
      await onSubmitEdit?.({ preventDefault: vi.fn() });

      const editDialogs = findAllNodes(
        editTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of editDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      // Render markup with editingShoot, isEditing = true, editError set
      mockStateQueue = [
        dummyShoots,
        false,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        baseShoot,
        'Updated Ceremony',
        '2027-06-12T13:00',
        '2027-06-12T17:00',
        'Europe/Berlin',
        'Updated Notes',
        true, // isEditing (spinner)
        'Edit error occurred', // editError (alert)
        null,
        false,
        null,
      ];
      const editHtml = renderToStaticMarkup(
        <ShootsSection projectId="proj-123" shoots={dummyShoots} locale="en" />,
      );
      expect(editHtml).toContain('data-testid="edit-shoot-dialog"');
      expect(editHtml).toContain('data-testid="edit-shoot-error"');

      // Render with deletingShoot
      mockStateQueue = [
        dummyShoots,
        false,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        baseShoot, // deletingShoot
        false,
        null,
      ];

      const deleteTree = ShootsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locale: 'en',
        onShootsChange,
      });

      // Cancel delete
      const cancelDelete = findNodeByTestId(deleteTree, 'delete-shoot-cancel-btn');
      void cancelDelete?.onClick?.();

      // Confirm delete success
      const confirmDelete = findNodeByTestId(deleteTree, 'delete-shoot-confirm-btn');
      await confirmDelete?.onClick?.();

      // Confirm delete failure
      vi.mocked(projectActions.deleteShootAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Delete rejected',
      });
      await confirmDelete?.onClick?.();

      // Confirm delete catch
      vi.mocked(projectActions.deleteShootAction).mockRejectedValueOnce(
        new Error('Delete crashed'),
      );
      await confirmDelete?.onClick?.();

      const deleteDialogs = findAllNodes(
        deleteTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of deleteDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      // Render markup with deletingShoot, isDeleting = true, deleteError set
      mockStateQueue = [
        dummyShoots,
        false,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        dummyShoots[0],
        true, // isDeleting (spinner)
        'Delete error occurred', // deleteError (alert)
      ];
      const deleteHtml = renderToStaticMarkup(
        <ShootsSection projectId="proj-123" shoots={dummyShoots} locale="en" />,
      );
      expect(deleteHtml).toContain('data-testid="delete-shoot-dialog"');
      expect(deleteHtml).toContain('data-testid="delete-shoot-error"');
    });
  });

  // --------------------------------------------------------------------------
  // LocationsSection Tests
  // --------------------------------------------------------------------------
  describe('LocationsSection', () => {
    it('renders locations list and empty state', () => {
      const html = renderToStaticMarkup(
        <LocationsSection
          projectId="proj-123"
          shoots={dummyShoots}
          locations={dummyLocations}
          locale="en"
          onLocationsChange={vi.fn()}
        />,
      );

      expect(html).toContain('data-testid="locations-section"');
      expect(html).toContain('data-testid="locations-list"');
      expect(html).toContain('Charlottenburg Palace');

      const emptyHtml = renderToStaticMarkup(
        <LocationsSection
          projectId="proj-123"
          shoots={dummyShoots}
          locations={[]}
          locale="en"
          onLocationsChange={vi.fn()}
        />,
      );
      expect(emptyHtml).toContain('data-testid="locations-empty"');
    });

    it('handles open add, edit, and delete location buttons', () => {
      const tree = LocationsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        locale: 'en',
      });

      const addBtn = findNodeByTestId(tree, 'add-location-btn');
      void addBtn?.onClick?.();

      const editBtn = findNodeByTestId(tree, 'edit-location-btn-loc-1');
      void editBtn?.onClick?.();

      const deleteBtn = findNodeByTestId(tree, 'delete-location-btn-loc-1');
      void deleteBtn?.onClick?.();
    });

    it('handles add location form validation, input changes, and submissions', async () => {
      const onLocationsChange = vi.fn();

      // Add modal open
      mockStateQueue = [
        dummyLocations, // locations
        true, // isAddOpen
        'shoot-1', // addShootId
        'Charlottenburg Palace', // addName
        'Address 1', // addAddress1
        'Suite 4', // addAddress2
        '10115', // addPostalCode
        'Berlin', // addCity
        'DE', // addCountryCode
        'Notes', // addNotes
        false, // isAdding
        null, // addError
        null, // editingLocation
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        null, // deletingLocation
        false,
        null,
      ];

      const tree = LocationsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        locale: 'en',
        onLocationsChange,
      });

      // Inputs onChange
      const inputs = findAllNodes(
        tree,
        (el) => typeof el.type === 'string' && ['input', 'select', 'textarea'].includes(el.type),
      );
      for (const input of inputs) {
        const onChange = input.props.onChange;
        onChange?.({ target: { value: 'Berlin' } });
      }

      // Cancel button
      const cancelBtn = findNodeByTestId(tree, 'add-location-cancel-btn');
      void cancelBtn?.onClick?.();

      // Submit success
      const addForm = findForm(tree);
      const onSubmit = addForm?.onSubmit;
      await onSubmit?.({ preventDefault: vi.fn() });
      expect(onLocationsChange).toHaveBeenCalled();

      // Submit failure
      vi.mocked(projectActions.createShootLocationAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Creation rejected',
      });
      await onSubmit?.({ preventDefault: vi.fn() });

      // Submit catch
      vi.mocked(projectActions.createShootLocationAction).mockRejectedValueOnce(
        new Error('Network error on add location'),
      );
      await onSubmit?.({ preventDefault: vi.fn() });

      // Submit validation error (missing name or shoot)
      mockStateQueue = [
        dummyLocations,
        true,
        '', // missing shootId
        '', // missing name
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const emptyTree = LocationsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        locale: 'en',
      });
      const emptyForm = findForm(emptyTree);
      await emptyForm?.onSubmit?.({ preventDefault: vi.fn() });

      // Render to static markup with isAddOpen = true, isAdding = true, addError set
      mockStateQueue = [
        dummyLocations,
        true,
        'shoot-1',
        'Palace',
        'Address',
        '',
        '10115',
        'Berlin',
        'DE',
        'Notes',
        true, // isAdding (spinner)
        'Add location error', // addError (alert)
        null,
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const addMarkup = renderToStaticMarkup(
        <LocationsSection
          projectId="proj-123"
          shoots={dummyShoots}
          locations={dummyLocations}
          locale="en"
        />,
      );
      expect(addMarkup).toContain('data-testid="add-location-dialog"');
      expect(addMarkup).toContain('data-testid="add-location-error"');
    });

    it('handles edit and delete location submissions and error branches', async () => {
      // Edit modal open
      mockStateQueue = [
        dummyLocations,
        false,
        '',
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        dummyLocations[0], // editingLocation
        'Updated Palace',
        'Spandauer Damm',
        '',
        '14059',
        'Berlin',
        'DE',
        'Updated Notes',
        false,
        null,
        null,
        false,
        null,
      ];

      const editTree = LocationsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        locale: 'en',
      });

      // Edit inputs onChange
      const editInputs = findAllNodes(
        editTree,
        (el) => typeof el.type === 'string' && ['input', 'select', 'textarea'].includes(el.type),
      );
      for (const input of editInputs) {
        const onChange = input.props.onChange;
        onChange?.({ target: { value: 'Updated' } });
      }

      // Edit cancel
      const cancelEdit = findNodeByTestId(editTree, 'edit-location-cancel-btn');
      void cancelEdit?.onClick?.();

      // Submit edit success
      const editForm = findFormBySubmitTestId(editTree, 'edit-location-submit-btn');
      const onSubmitEdit = editForm?.onSubmit as ((e: unknown) => Promise<void>) | undefined;
      await onSubmitEdit?.({ preventDefault: vi.fn() });

      // Submit edit failure
      vi.mocked(projectActions.updateShootLocationAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Update failed',
      });
      await onSubmitEdit?.({ preventDefault: vi.fn() });

      // Submit edit catch
      vi.mocked(projectActions.updateShootLocationAction).mockRejectedValueOnce(
        new Error('Edit location crash'),
      );
      // Validation error: empty edit name
      mockStateQueue = [
        dummyLocations,
        false,
        '',
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        dummyLocations[0],
        '', // empty name
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const emptyNameTree = LocationsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        locale: 'en',
      });
      const emptyNameForm = findFormBySubmitTestId(emptyNameTree, 'edit-location-submit-btn');
      await emptyNameForm?.onSubmit?.({ preventDefault: vi.fn() });

      const editLocDialogs = findAllNodes(
        editTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of editLocDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      // Render to static markup with editingLocation, isEditing = true, editError set
      mockStateQueue = [
        dummyLocations,
        false,
        '',
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        dummyLocations[0],
        'Updated Palace',
        'Spandauer Damm',
        '',
        '14059',
        'Berlin',
        'DE',
        'Updated Notes',
        true, // isEditing (spinner)
        'Edit error occurred', // editError (alert)
        null,
        false,
        null,
      ];
      const editMarkup = renderToStaticMarkup(
        <LocationsSection
          projectId="proj-123"
          shoots={dummyShoots}
          locations={dummyLocations}
          locale="en"
        />,
      );
      expect(editMarkup).toContain('data-testid="edit-location-dialog"');
      expect(editMarkup).toContain('data-testid="edit-location-error"');

      // Delete modal open
      mockStateQueue = [
        dummyLocations,
        false,
        '',
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        dummyLocations[0], // deletingLocation
        false,
        null,
      ];

      const deleteTree = LocationsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        locale: 'en',
      });

      // Delete cancel
      const cancelDelete = findNodeByTestId(deleteTree, 'delete-location-cancel-btn');
      void cancelDelete?.onClick?.();

      // Delete confirm success
      const confirmDelete = findNodeByTestId(deleteTree, 'delete-location-confirm-btn');
      await confirmDelete?.onClick?.();

      // Delete confirm failure
      vi.mocked(projectActions.deleteShootLocationAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Delete rejected',
      });
      await confirmDelete?.onClick?.();

      // Delete confirm catch
      vi.mocked(projectActions.deleteShootLocationAction).mockRejectedValueOnce(
        new Error('Delete crash'),
      );
      await confirmDelete?.onClick?.();

      const deleteLocDialogs = findAllNodes(
        deleteTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of deleteLocDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      // Render to static markup with deletingLocation, isDeleting = true, deleteError set
      mockStateQueue = [
        dummyLocations,
        false,
        '',
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        dummyLocations[0],
        true, // isDeleting (spinner)
        'Delete error occurred', // deleteError (alert)
      ];
      const deleteMarkup = renderToStaticMarkup(
        <LocationsSection
          projectId="proj-123"
          shoots={dummyShoots}
          locations={dummyLocations}
          locale="en"
        />,
      );
      expect(deleteMarkup).toContain('data-testid="delete-location-dialog"');
      expect(deleteMarkup).toContain('data-testid="delete-location-error"');
    });
  });

  // --------------------------------------------------------------------------
  // TimelineScheduleSection Tests
  // --------------------------------------------------------------------------
  describe('TimelineScheduleSection', () => {
    it('renders timeline items and empty state', () => {
      const html = renderToStaticMarkup(
        <TimelineScheduleSection
          projectId="proj-123"
          shoots={dummyShoots}
          locations={dummyLocations}
          timelineItems={dummyTimeline}
          locale="en"
          onTimelineItemsChange={vi.fn()}
        />,
      );

      expect(html).toContain('data-testid="timeline-section"');
      expect(html).toContain('data-testid="timeline-list"');
      expect(html).toContain('14:00 First Look');

      const emptyHtml = renderToStaticMarkup(
        <TimelineScheduleSection
          projectId="proj-123"
          shoots={dummyShoots}
          locations={dummyLocations}
          timelineItems={[]}
          locale="en"
          onTimelineItemsChange={vi.fn()}
        />,
      );
      expect(emptyHtml).toContain('data-testid="timeline-empty"');
    });

    it('handles timeline buttons and add item modal interactions', async () => {
      const onTimelineItemsChange = vi.fn();

      const tree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });

      const addBtn = findNodeByTestId(tree, 'add-timeline-item-btn');
      void addBtn?.onClick?.();

      const editBtn = findNodeByTestId(tree, 'edit-timeline-item-btn-time-1');
      void editBtn?.onClick?.();

      const deleteBtn = findNodeByTestId(tree, 'delete-timeline-item-btn-time-1');
      void deleteBtn?.onClick?.();

      // Render with isAddOpen = true
      mockStateQueue = [
        dummyTimeline, // items
        true, // isAddOpen
        'shoot-1', // addShootId
        'loc-1', // addLocationId
        'First Dance', // addTitle
        '2027-06-12T20:00', // addStartsAt
        '2027-06-12T20:30', // addEndsAt
        'Song: Perfect by Ed Sheeran', // addDescription
        false, // isAdding
        null, // addError
        null, // editingItem
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        null, // deletingItem
        false,
        null,
      ];

      const addTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
        onTimelineItemsChange,
      });

      // Inputs onChange
      const inputs = findAllNodes(
        addTree,
        (el) => typeof el.type === 'string' && ['input', 'select', 'textarea'].includes(el.type),
      );
      for (const input of inputs) {
        const onChange = input.props.onChange;
        onChange?.({ target: { value: 'Dance' } });
      }

      // Cancel button
      const cancelBtn = findNodeByTestId(addTree, 'add-timeline-cancel-btn');
      void cancelBtn?.onClick?.();

      // Submit success
      const addForm = findForm(addTree);
      const onSubmit = addForm?.onSubmit;
      await onSubmit?.({ preventDefault: vi.fn() });
      expect(onTimelineItemsChange).toHaveBeenCalled();

      // Submit failure
      vi.mocked(projectActions.createShootTimelineItemAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Timeline creation rejected',
      });
      await onSubmit?.({ preventDefault: vi.fn() });

      // Submit catch
      vi.mocked(projectActions.createShootTimelineItemAction).mockRejectedValueOnce(
        new Error('Timeline crash'),
      );
      // Validation error: missing shootId
      mockStateQueue = [
        dummyTimeline,
        true,
        '', // missing shootId
        '',
        'Title',
        '2027-06-12T10:00',
        '',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const noShootTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });
      const noShootForm = findForm(noShootTree);
      await noShootForm?.onSubmit?.({ preventDefault: vi.fn() });

      // Validation error: empty title
      mockStateQueue = [
        dummyTimeline,
        true,
        'shoot-1',
        '',
        '', // empty title
        '2027-06-12T10:00',
        '',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const noTitleTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });
      const noTitleForm = findForm(noTitleTree);
      await noTitleForm?.onSubmit?.({ preventDefault: vi.fn() });

      // Validation error: missing startsAt
      mockStateQueue = [
        dummyTimeline,
        true,
        'shoot-1',
        '',
        'Valid Title',
        '', // missing startsAt
        '',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const noStartTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });
      const noStartForm = findForm(noStartTree);
      await noStartForm?.onSubmit?.({ preventDefault: vi.fn() });

      // Render markup with isAddOpen = true, isAdding = true, addError set
      mockStateQueue = [
        dummyTimeline,
        true,
        'shoot-1',
        'loc-1',
        'First Dance',
        '2027-06-12T20:00',
        '2027-06-12T20:30',
        'Description',
        true, // isAdding (spinner)
        'Add timeline error', // addError (alert)
        null,
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const addMarkup = renderToStaticMarkup(
        <TimelineScheduleSection
          projectId="proj-123"
          shoots={dummyShoots}
          locations={dummyLocations}
          timelineItems={dummyTimeline}
          locale="en"
        />,
      );
      expect(addMarkup).toContain('data-testid="add-timeline-dialog"');
      expect(addMarkup).toContain('data-testid="add-timeline-error"');
    });

    it('handles edit and delete timeline item submissions and error branches', async () => {
      // Edit open
      mockStateQueue = [
        dummyTimeline,
        false,
        '',
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        dummyTimeline[0], // editingItem
        'loc-1',
        'Updated First Look',
        '2027-06-12T14:15',
        '2027-06-12T14:45',
        'Updated notes',
        false,
        null,
        null,
        false,
        null,
      ];

      const editTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });

      // Inputs onChange
      const editInputs = findAllNodes(
        editTree,
        (el) => typeof el.type === 'string' && ['input', 'select', 'textarea'].includes(el.type),
      );
      for (const input of editInputs) {
        const onChange = input.props.onChange;
        onChange?.({ target: { value: 'Edited' } });
      }

      // Cancel
      const cancelEdit = findNodeByTestId(editTree, 'edit-timeline-cancel-btn');
      void cancelEdit?.onClick?.();

      // Submit edit success
      const editForm = findFormBySubmitTestId(editTree, 'edit-timeline-submit-btn');
      const onSubmitEdit = editForm?.onSubmit as ((e: unknown) => Promise<void>) | undefined;
      await onSubmitEdit?.({ preventDefault: vi.fn() });

      // Submit edit failure
      vi.mocked(projectActions.updateShootTimelineItemAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Timeline update failed',
      });
      await onSubmitEdit?.({ preventDefault: vi.fn() });

      // Submit edit catch
      vi.mocked(projectActions.updateShootTimelineItemAction).mockRejectedValueOnce(
        new Error('Edit timeline crash'),
      );
      // Validation error: empty edit title
      mockStateQueue = [
        dummyTimeline,
        false,
        '',
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        dummyTimeline[0],
        'loc-1',
        '', // empty title
        '2027-06-12T14:15',
        '2027-06-12T14:45',
        'Notes',
        false,
        null,
        null,
        false,
        null,
      ];
      const emptyTitleTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });
      const emptyTitleForm = findFormBySubmitTestId(emptyTitleTree, 'edit-timeline-submit-btn');
      await emptyTitleForm?.onSubmit?.({ preventDefault: vi.fn() });

      const editTimelineDialogs = findAllNodes(
        editTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of editTimelineDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      // Render markup with editingItem, isEditing = true, editError set
      mockStateQueue = [
        dummyTimeline,
        false,
        '',
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        dummyTimeline[0],
        'loc-1',
        'Updated',
        '2027-06-12T14:15',
        '2027-06-12T14:45',
        'Notes',
        true, // isEditing (spinner)
        'Edit error occurred', // editError (alert)
        null,
        false,
        null,
      ];
      const editMarkup = renderToStaticMarkup(
        <TimelineScheduleSection
          projectId="proj-123"
          shoots={dummyShoots}
          locations={dummyLocations}
          timelineItems={dummyTimeline}
          locale="en"
        />,
      );
      expect(editMarkup).toContain('data-testid="edit-timeline-dialog"');
      expect(editMarkup).toContain('data-testid="edit-timeline-error"');

      // Delete open
      mockStateQueue = [
        dummyTimeline,
        false,
        '',
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        dummyTimeline[0], // deletingItem
        false,
        null,
      ];

      const deleteTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });

      // Cancel
      const cancelDelete = findNodeByTestId(deleteTree, 'delete-timeline-cancel-btn');
      void cancelDelete?.onClick?.();

      // Confirm success
      const confirmDelete = findNodeByTestId(deleteTree, 'delete-timeline-confirm-btn');
      await confirmDelete?.onClick?.();

      // Confirm failure
      vi.mocked(projectActions.deleteShootTimelineItemAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Delete rejected',
      });
      await confirmDelete?.onClick?.();

      // Confirm catch
      vi.mocked(projectActions.deleteShootTimelineItemAction).mockRejectedValueOnce(
        new Error('Delete crash'),
      );
      await confirmDelete?.onClick?.();

      const deleteTimelineDialogs = findAllNodes(
        deleteTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of deleteTimelineDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      // Render markup with deletingItem, isDeleting = true, deleteError set
      mockStateQueue = [
        dummyTimeline,
        false,
        '',
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        dummyTimeline[0],
        true, // isDeleting (spinner)
        'Delete error occurred', // deleteError (alert)
      ];
      const deleteMarkup = renderToStaticMarkup(
        <TimelineScheduleSection
          projectId="proj-123"
          shoots={dummyShoots}
          locations={dummyLocations}
          timelineItems={dummyTimeline}
          locale="en"
        />,
      );
      expect(deleteMarkup).toContain('data-testid="delete-timeline-dialog"');
      expect(deleteMarkup).toContain('data-testid="delete-timeline-error"');
    });
  });

  // --------------------------------------------------------------------------
  // ParticipantsSection Tests
  // --------------------------------------------------------------------------
  describe('ParticipantsSection', () => {
    it('renders participants list and empty state', () => {
      const html = renderToStaticMarkup(
        <ParticipantsSection
          projectId="proj-123"
          participants={dummyParticipants}
          clientContacts={dummyProjectDetailData.clientContacts}
          onParticipantsChange={vi.fn()}
          locale="en"
        />,
      );

      expect(html).toContain('data-testid="participants-section"');
      expect(html).toContain('data-testid="participants-list"');
      expect(html).toContain('Maria Schmidt');
      expect(html).toContain('Hannah Weber');

      const emptyHtml = renderToStaticMarkup(
        <ParticipantsSection
          projectId="proj-123"
          participants={[]}
          clientContacts={[]}
          onParticipantsChange={vi.fn()}
          locale="en"
        />,
      );
      expect(emptyHtml).toContain('data-testid="participants-empty"');
    });

    it('handles open add participant and delete participant buttons', () => {
      const tree = ParticipantsSection({
        projectId: 'proj-123',
        participants: dummyParticipants,
        clientContacts: dummyProjectDetailData.clientContacts,
        locale: 'en',
      });

      const addBtn = findNodeByTestId(tree, 'add-participant-btn');
      void addBtn?.onClick?.();

      const deleteBtn = findNodeByTestId(tree, 'delete-participant-btn-part-1');
      void deleteBtn?.onClick?.();
    });

    it('handles source type switcher, client contact select, and add submissions', async () => {
      const onParticipantsChange = vi.fn();

      // Add open with vendor source
      mockStateQueue = [
        dummyParticipants, // participants
        true, // isAddOpen
        'vendor', // sourceType
        '', // contactId
        'Lukas Bauer', // name
        'Caterer', // role
        'lukas@catering.example', // email
        '+49 170 1234567', // phone
        false, // isPrimary
        'Food tasting done', // notes
        false, // isAdding
        null, // addError
        null, // deletingParticipant
        false,
        null,
      ];

      const tree = ParticipantsSection({
        projectId: 'proj-123',
        participants: dummyParticipants,
        clientContacts: dummyProjectDetailData.clientContacts,
        onParticipantsChange,
        locale: 'en',
      });

      // Switch to client source type
      const clientTypeBtn = findNodeByTestId(tree, 'add-participant-source-client');
      void clientTypeBtn?.onClick?.();

      // Switch to vendor source type
      const vendorTypeBtn = findNodeByTestId(tree, 'add-participant-source-vendor');
      void vendorTypeBtn?.onClick?.();

      // Select contact
      const contactSelect = findNodeByTestId(tree, 'add-participant-contact-select');
      contactSelect?.onChange?.({
        target: { value: 'contact-1' },
      });

      // Inputs onChange
      const inputs = findAllNodes(
        tree,
        (el) => typeof el.type === 'string' && ['input', 'select', 'textarea'].includes(el.type),
      );
      for (const input of inputs) {
        const onChange = input.props.onChange;
        onChange?.({ target: { value: 'Test' } });
      }

      // Cancel button
      const cancelBtn = findNodeByTestId(tree, 'add-participant-cancel-btn');
      void cancelBtn?.onClick?.();

      // Submit success
      const addForm = findForm(tree);
      const onSubmit = addForm?.onSubmit;
      await onSubmit?.({ preventDefault: vi.fn() });
      expect(onParticipantsChange).toHaveBeenCalled();

      // Submit failure
      vi.mocked(projectActions.createProjectParticipantAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Participant creation failed',
      });
      await onSubmit?.({ preventDefault: vi.fn() });

      // Submit catch
      vi.mocked(projectActions.createProjectParticipantAction).mockRejectedValueOnce(
        new Error('Network error on add participant'),
      );
      await onSubmit?.({ preventDefault: vi.fn() });

      // Validation test: empty role
      mockStateQueue = [
        dummyParticipants,
        true,
        'vendor',
        '',
        'Name',
        '', // empty role
        '',
        '',
        false,
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const emptyRoleTree = ParticipantsSection({
        projectId: 'proj-123',
        participants: dummyParticipants,
        clientContacts: dummyProjectDetailData.clientContacts,
        locale: 'en',
      });
      const emptyRoleForm = findForm(emptyRoleTree);
      await emptyRoleForm?.onSubmit?.({ preventDefault: vi.fn() });

      // Validation test: client source with missing contact
      mockStateQueue = [
        dummyParticipants,
        true,
        'client',
        '', // missing contactId
        '',
        'Role',
        '',
        '',
        false,
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const noContactTree = ParticipantsSection({
        projectId: 'proj-123',
        participants: dummyParticipants,
        clientContacts: dummyProjectDetailData.clientContacts,
        locale: 'en',
      });
      const noContactForm = findForm(noContactTree);
      await noContactForm?.onSubmit?.({ preventDefault: vi.fn() });

      // Validation test: vendor source with empty name
      mockStateQueue = [
        dummyParticipants,
        true,
        'vendor',
        '',
        '', // empty name
        'Role',
        '',
        '',
        false,
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const noNameTree = ParticipantsSection({
        projectId: 'proj-123',
        participants: dummyParticipants,
        clientContacts: dummyProjectDetailData.clientContacts,
        locale: 'en',
      });
      const noNameForm = findForm(noNameTree);
      await noNameForm?.onSubmit?.({ preventDefault: vi.fn() });

      // Render markup with isAddOpen = true, isAdding = true, addError set
      mockStateQueue = [
        dummyParticipants,
        true,
        'client',
        'contact-1',
        'Hannah Weber',
        'Client',
        'hannah@example.com',
        '+49 30 11223344',
        true,
        'Primary contact notes',
        true, // isAdding (spinner)
        'Add participant error', // addError (alert)
        null,
        false,
        null,
      ];
      const addMarkup = renderToStaticMarkup(
        <ParticipantsSection
          projectId="proj-123"
          participants={dummyParticipants}
          clientContacts={dummyProjectDetailData.clientContacts}
          locale="en"
        />,
      );
      expect(addMarkup).toContain('data-testid="add-participant-dialog"');
      expect(addMarkup).toContain('data-testid="add-participant-error"');
    });

    it('handles delete participant submission and error branches', async () => {
      // Delete modal open
      mockStateQueue = [
        dummyParticipants,
        false,
        'vendor',
        '',
        '',
        '',
        '',
        '',
        false,
        '',
        false,
        null,
        dummyParticipants[0], // deletingParticipant
        false,
        null,
      ];

      const deleteTree = ParticipantsSection({
        projectId: 'proj-123',
        participants: dummyParticipants,
        clientContacts: dummyProjectDetailData.clientContacts,
        locale: 'en',
      });

      // Cancel delete
      const cancelDelete = findNodeByTestId(deleteTree, 'delete-participant-cancel-btn');
      void cancelDelete?.onClick?.();

      // Confirm delete success
      const confirmDelete = findNodeByTestId(deleteTree, 'delete-participant-confirm-btn');
      await confirmDelete?.onClick?.();

      // Confirm delete failure
      vi.mocked(projectActions.deleteProjectParticipantAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Delete failed',
      });
      await confirmDelete?.onClick?.();

      // Confirm delete catch
      vi.mocked(projectActions.deleteProjectParticipantAction).mockRejectedValueOnce(
        new Error('Delete participant crash'),
      );
      await confirmDelete?.onClick?.();

      // Render markup with deletingParticipant, isDeleting = true, deleteError set
      mockStateQueue = [
        dummyParticipants,
        false,
        'vendor',
        '',
        '',
        '',
        '',
        '',
        false,
        '',
        false,
        null,
        dummyParticipants[0],
        true, // isDeleting (spinner)
        'Delete participant error', // deleteError (alert)
      ];
      const deleteMarkup = renderToStaticMarkup(
        <ParticipantsSection
          projectId="proj-123"
          participants={dummyParticipants}
          clientContacts={dummyProjectDetailData.clientContacts}
          locale="en"
        />,
      );
      expect(deleteMarkup).toContain('data-testid="delete-participant-dialog"');
      expect(deleteMarkup).toContain('data-testid="delete-participant-error"');
    });
  });

  // --------------------------------------------------------------------------
  // StageTasksSection Tests
  // --------------------------------------------------------------------------
  describe('StageTasksSection', () => {
    it('renders stage tasks with completion counters and line-through for completed tasks', () => {
      const html = renderToStaticMarkup(
        <StageTasksSection
          projectId="proj-123"
          currentStage={baseStage}
          tasks={dummyTasks}
          locale="en"
          onTasksChange={vi.fn()}
        />,
      );

      expect(html).toContain('data-testid="stage-tasks-section"');
      expect(html).toContain('data-testid="stage-tasks-list"');
      expect(html).toContain('Send consultation questionnaire');
      expect(html).toContain('Review moodboard');
      expect(html).toContain('data-testid="task-checkbox-task-1"');
      expect(html).toContain('data-testid="task-checkbox-task-2"');
      expect(html).toContain('line-through');
    });

    it('renders empty tasks state when task list is empty', () => {
      const html = renderToStaticMarkup(
        <StageTasksSection
          projectId="proj-123"
          currentStage={baseStage}
          tasks={[]}
          locale="en"
          onTasksChange={vi.fn()}
        />,
      );

      expect(html).toContain('data-testid="stage-tasks-empty"');
    });

    it('handles add, toggle, and delete stage task interactions', async () => {
      const onTasksChange = vi.fn();

      // Toggle task success
      const tree = StageTasksSection({
        projectId: 'proj-123',
        currentStage: baseStage,
        tasks: dummyTasks,
        locale: 'en',
        onTasksChange,
      });

      const taskCheckbox = findNodeByTestId(tree, 'task-checkbox-task-1');
      await taskCheckbox?.onClick?.();
      expect(onTasksChange).toHaveBeenCalled();

      // Toggle task failure (triggers rollback)
      vi.mocked(projectActions.toggleProjectTaskAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Toggle rejected',
      });
      await taskCheckbox?.onClick?.();

      // Toggle task catch (triggers rollback)
      vi.mocked(projectActions.toggleProjectTaskAction).mockRejectedValueOnce(
        new Error('Toggle crashed'),
      );
      await taskCheckbox?.onClick?.();

      // Open add task dialog
      const addBtn = findNodeByTestId(tree, 'add-stage-task-btn');
      void addBtn?.onClick?.();

      // Open delete task dialog
      const deleteBtn = findNodeByTestId(tree, 'delete-task-btn-task-1');
      void deleteBtn?.onClick?.();

      // Add task open
      mockStateQueue = [
        dummyTasks, // 1: tasks
        true, // 2: isAddOpen
        'Contract signed', // 3: title
        '2027-01-20', // 4: dueDate
        false, // 5: isAdding
        null, // 6: addError
        new Set<string>(), // 7: togglingTaskIds
        null, // 8: deletingTask
        false, // 9: isDeleting
        null, // 10: deleteError
      ];

      const addTree = StageTasksSection({
        projectId: 'proj-123',
        currentStage: baseStage,
        tasks: dummyTasks,
        locale: 'en',
        onTasksChange,
      });

      // Inputs onChange
      const inputs = findAllNodes(
        addTree,
        (el) => typeof el.type === 'string' && ['input', 'select', 'textarea'].includes(el.type),
      );
      for (const input of inputs) {
        const onChange = input.props.onChange;
        onChange?.({ target: { value: 'Task value' } });
      }

      // Cancel button
      const cancelBtn = findNodeByTestId(addTree, 'add-task-cancel-btn');
      void cancelBtn?.onClick?.();

      // Submit success
      const addForm = findForm(addTree);
      const onSubmit = addForm?.onSubmit;
      await onSubmit?.({ preventDefault: vi.fn() });

      // Submit failure
      vi.mocked(projectActions.createProjectTaskAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Task creation failed',
      });
      await onSubmit?.({ preventDefault: vi.fn() });

      // Submit catch
      vi.mocked(projectActions.createProjectTaskAction).mockRejectedValueOnce(
        new Error('Task creation crash'),
      );
      await onSubmit?.({ preventDefault: vi.fn() });

      // Validation error: empty title
      mockStateQueue = [
        dummyTasks,
        true,
        '', // empty title
        '',
        false,
        null,
        new Set<string>(),
        null,
        false,
        null,
      ];
      const emptyTitleTree = StageTasksSection({
        projectId: 'proj-123',
        currentStage: baseStage,
        tasks: dummyTasks,
        locale: 'en',
      });
      const emptyTitleForm = findForm(emptyTitleTree);
      await emptyTitleForm?.onSubmit?.({ preventDefault: vi.fn() });

      const addTaskDialogs = findAllNodes(
        addTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of addTaskDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      // Render markup with isAddOpen = true, isAdding = true, addError set
      mockStateQueue = [
        dummyTasks,
        true,
        'Contract signed',
        '2027-01-20',
        true, // isAdding (spinner)
        'Add task error', // addError (alert)
        new Set<string>(),
        null,
        false,
        null,
      ];
      const addMarkup = renderToStaticMarkup(
        <StageTasksSection
          projectId="proj-123"
          currentStage={baseStage}
          tasks={dummyTasks}
          locale="en"
        />,
      );
      expect(addMarkup).toContain('data-testid="add-task-dialog"');
      expect(addMarkup).toContain('data-testid="add-task-error"');

      // Delete task open
      mockStateQueue = [
        dummyTasks, // 1: tasks
        false, // 2: isAddOpen
        '', // 3: title
        '', // 4: dueDate
        false, // 5: isAdding
        null, // 6: addError
        new Set<string>(), // 7: togglingTaskIds
        baseTask, // 8: deletingTask
        false, // 9: isDeleting
        null, // 10: deleteError
      ];

      const deleteTree = StageTasksSection({
        projectId: 'proj-123',
        currentStage: baseStage,
        tasks: dummyTasks,
        locale: 'en',
        onTasksChange,
      });

      // Cancel delete
      const cancelDelete = findNodeByTestId(deleteTree, 'delete-task-cancel-btn');
      void cancelDelete?.onClick?.();

      // Confirm delete success
      const confirmBtn = findNodeByTestId(deleteTree, 'delete-task-confirm-btn');
      await confirmBtn?.onClick?.();

      // Confirm delete failure
      vi.mocked(projectActions.deleteProjectTaskAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Delete failed',
      });
      await confirmBtn?.onClick?.();

      // Confirm delete catch
      vi.mocked(projectActions.deleteProjectTaskAction).mockRejectedValueOnce(
        new Error('Delete task crash'),
      );
      await confirmBtn?.onClick?.();

      const deleteTaskDialogs = findAllNodes(
        deleteTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of deleteTaskDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      // Render markup with deletingTask, isDeleting = true, deleteError set
      mockStateQueue = [
        dummyTasks,
        false,
        '',
        '',
        false,
        null,
        new Set<string>(),
        baseTask,
        true, // isDeleting (spinner)
        'Delete task error', // deleteError (alert)
      ];
      const deleteMarkup = renderToStaticMarkup(
        <StageTasksSection
          projectId="proj-123"
          currentStage={baseStage}
          tasks={dummyTasks}
          locale="en"
        />,
      );
      expect(deleteMarkup).toContain('data-testid="delete-task-dialog"');
      expect(deleteMarkup).toContain('data-testid="delete-task-error"');
    });
  });

  describe('Comprehensive Edge Cases and Branch Coverage', () => {
    it('exercises ProjectDetailView cancel buttons, onOpenChange, and edge branches', async () => {
      // 1. isEditOpen = true: test cancel button and onOpenChange
      mockStateQueue = [
        dummyProjectDetailData.project,
        dummyShoots,
        dummyLocations,
        dummyTimeline,
        dummyParticipants,
        dummyTasks,
        dummyStages[0],
        'all',
        null,
        false,
        null,
        true, // isEditOpen
        'Title',
        'wedding',
        '', // empty price -> priceMinor = null
        '', // empty notes -> notes = null
        false,
        null,
        false,
        false,
      ];
      const editTree = ProjectDetailView({ initialData: dummyProjectDetailData, locale: 'en' });
      const editCancel = findNodeByTestId(editTree, 'edit-project-cancel-btn');
      void editCancel?.onClick?.();

      const editDialogs = findAllNodes(
        editTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of editDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      // Submit with empty price and notes
      const editForm = findForm(editTree);
      await editForm?.onSubmit?.({ preventDefault: vi.fn() });

      // Submit with res.error empty fallback
      vi.mocked(projectActions.updateProjectAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: '',
      });
      await editForm?.onSubmit?.({ preventDefault: vi.fn() });

      // 2. isDeleteOpen = true: test cancel button, onOpenChange, and delete failure
      mockStateQueue = [
        dummyProjectDetailData.project,
        dummyShoots,
        dummyLocations,
        dummyTimeline,
        dummyParticipants,
        dummyTasks,
        baseStage,
        'all',
        null,
        false,
        null,
        false,
        'Title',
        'wedding',
        '2500',
        'Notes',
        false,
        null,
        true, // isDeleteOpen
        false, // isDeleting
      ];
      const deleteTree = ProjectDetailView({ initialData: dummyProjectDetailData, locale: 'en' });
      const deleteCancel = findNodeByTestId(deleteTree, 'delete-project-cancel-btn');
      void deleteCancel?.onClick?.();

      const deleteDialogs = findAllNodes(
        deleteTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of deleteDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      // Delete action returns success: false
      vi.mocked(projectActions.deleteProjectAction).mockResolvedValueOnce({
        success: false,
        code: 'ACTION_FAILED',
        error: 'Forbidden delete',
      });
      const confirmDeleteBtn = findNodeByTestId(deleteTree, 'delete-project-confirm-btn');
      await confirmDeleteBtn?.onClick?.();

      // 3. Stepper click when isTransitioning = true (early return)
      mockStateQueue = [
        dummyProjectDetailData.project,
        dummyShoots,
        dummyLocations,
        dummyTimeline,
        dummyParticipants,
        dummyTasks,
        baseStage,
        'all',
        null,
        true, // isTransitioning
        null,
        false,
        'Title',
        'wedding',
        '2500',
        'Notes',
        false,
        null,
        false,
        false,
      ];
      const transitioningTree = ProjectDetailView({
        initialData: dummyProjectDetailData,
        locale: 'en',
      });
      const bookedStep = findNodeByTestId(transitioningTree, 'stage-step-booked');
      void bookedStep?.onClick?.();
    });

    it('exercises ShootsSection cancel buttons, onOpenChange, and validation/early-return branches', async () => {
      // 1. isAddOpen = true: cancel button, onOpenChange, isAdding early return, empty addStartsAt, empty optional fields
      mockStateQueue = [
        dummyShoots,
        true, // isAddOpen
        '', // empty title -> defaults to 'Shoot'
        '2027-06-12T10:00',
        '', // empty endsAt -> null
        '', // empty timezone -> defaults to Europe/Berlin
        '', // empty notes -> null
        false,
        null,
        null,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const addTree = ShootsSection({ projectId: 'proj-123', shoots: dummyShoots, locale: 'en' });
      const addCancel = findNodeByTestId(addTree, 'add-shoot-cancel-btn');
      void addCancel?.onClick?.();

      const addDialogs = findAllNodes(addTree, (el) => typeof el.props.onOpenChange === 'function');
      for (const d of addDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      const addForm = findFormBySubmitTestId(addTree, 'add-shoot-submit-btn');
      await addForm?.onSubmit?.({ preventDefault: vi.fn() });

      // isAdding = true early return
      mockStateQueue = [
        dummyShoots,
        true,
        'Title',
        '2027-06-12T10:00',
        '2027-06-12T18:00',
        'Europe/Berlin',
        'Notes',
        true, // isAdding = true
        null,
        null,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const addingTree = ShootsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locale: 'en',
      });
      const addingForm = findFormBySubmitTestId(addingTree, 'add-shoot-submit-btn');
      await addingForm?.onSubmit?.({ preventDefault: vi.fn() });

      // empty addStartsAt validation error
      mockStateQueue = [
        dummyShoots,
        true,
        'Title',
        '', // empty startsAt
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const noStartTree = ShootsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locale: 'en',
      });
      const noStartForm = findFormBySubmitTestId(noStartTree, 'add-shoot-submit-btn');
      await noStartForm?.onSubmit?.({ preventDefault: vi.fn() });

      // 2. editingShoot: cancel button, onOpenChange, isEditing early return, empty optional fields
      mockStateQueue = [
        dummyShoots,
        false,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        dummyShoots[0], // editingShoot
        '', // empty editTitle -> defaults to 'Shoot'
        '', // empty editStartsAt -> undefined
        '', // empty editEndsAt -> null
        '', // empty editTimezone -> defaults to Europe/Berlin
        '', // empty editNotes -> null
        false,
        null,
        null,
        false,
        null,
      ];
      const editTree = ShootsSection({ projectId: 'proj-123', shoots: dummyShoots, locale: 'en' });
      const editCancel = findNodeByTestId(editTree, 'edit-shoot-cancel-btn');
      void editCancel?.onClick?.();

      const editDialogs = findAllNodes(
        editTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of editDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      const editForm = findFormBySubmitTestId(editTree, 'edit-shoot-submit-btn');
      await editForm?.onSubmit?.({ preventDefault: vi.fn() });

      // isEditing = true early return
      mockStateQueue = [
        dummyShoots,
        false,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        dummyShoots[0],
        'Title',
        '2027-06-12T10:00',
        '',
        'Europe/Berlin',
        '',
        true, // isEditing = true
        null,
        null,
        false,
        null,
      ];
      const editingTree = ShootsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locale: 'en',
      });
      const editingForm = findFormBySubmitTestId(editingTree, 'edit-shoot-submit-btn');
      await editingForm?.onSubmit?.({ preventDefault: vi.fn() });

      // 3. deletingShoot: cancel button, onOpenChange, isDeleting early return
      mockStateQueue = [
        dummyShoots,
        false,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        dummyShoots[0], // deletingShoot
        false,
        null,
      ];
      const deleteTree = ShootsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locale: 'en',
      });
      const deleteCancel = findNodeByTestId(deleteTree, 'delete-shoot-cancel-btn');
      void deleteCancel?.onClick?.();

      const deleteDialogs = findAllNodes(
        deleteTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of deleteDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      // isDeleting = true early return
      mockStateQueue = [
        dummyShoots,
        false,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        dummyShoots[0],
        true, // isDeleting = true
        null,
      ];
      const deletingTree = ShootsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locale: 'en',
      });
      const deleteBtn = findNodeByTestId(deletingTree, 'delete-shoot-confirm-btn');
      await deleteBtn?.onClick?.();
    });

    it('exercises LocationsSection cancel buttons, onOpenChange, empty shoots array, and validation branches', async () => {
      // 1. handleOpenAdd when shoots = []
      const emptyShootsTree = LocationsSection({
        projectId: 'proj-123',
        shoots: [],
        locations: dummyLocations,
        locale: 'en',
      });
      const addBtn = findNodeByTestId(emptyShootsTree, 'add-location-btn');
      void addBtn?.onClick?.();

      // 2. isAddOpen = true: cancel button, onOpenChange, isAdding early return, missing shootId, missing name, empty address fields
      mockStateQueue = [
        dummyLocations,
        true, // isAddOpen
        'shoot-1',
        'Palace',
        '', // addressLine1
        '', // addressLine2
        '', // postalCode
        '', // city
        '', // countryCode
        '', // notes
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const addTree = LocationsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        locale: 'en',
      });
      const addCancel = findNodeByTestId(addTree, 'add-location-cancel-btn');
      void addCancel?.onClick?.();

      const addDialogs = findAllNodes(addTree, (el) => typeof el.props.onOpenChange === 'function');
      for (const d of addDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      const addForm = findFormBySubmitTestId(addTree, 'add-location-submit-btn');
      await addForm?.onSubmit?.({ preventDefault: vi.fn() });

      // isAdding = true early return
      mockStateQueue = [
        dummyLocations,
        true,
        'shoot-1',
        'Palace',
        '',
        '',
        '',
        '',
        'DE',
        '',
        true, // isAdding = true
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const addingTree = LocationsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        locale: 'en',
      });
      const addingForm = findFormBySubmitTestId(addingTree, 'add-location-submit-btn');
      await addingForm?.onSubmit?.({ preventDefault: vi.fn() });

      // missing addShootId
      mockStateQueue = [
        dummyLocations,
        true,
        '', // empty shootId
        'Palace',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const noShootTree = LocationsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        locale: 'en',
      });
      const noShootForm = findFormBySubmitTestId(noShootTree, 'add-location-submit-btn');
      await noShootForm?.onSubmit?.({ preventDefault: vi.fn() });

      // missing addName
      mockStateQueue = [
        dummyLocations,
        true,
        'shoot-1',
        '', // empty name
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const noNameTree = LocationsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        locale: 'en',
      });
      const noNameForm = findFormBySubmitTestId(noNameTree, 'add-location-submit-btn');
      await noNameForm?.onSubmit?.({ preventDefault: vi.fn() });

      // 3. editingLocation: cancel button, onOpenChange, isEditing early return, empty name validation, empty optional fields
      mockStateQueue = [
        dummyLocations,
        false,
        'shoot-1',
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        dummyLocations[0], // editingLocation
        'Updated Palace',
        '', // address1
        '', // address2
        '', // postalCode
        '', // city
        '', // countryCode
        '', // notes
        false,
        null,
        null,
        false,
        null,
      ];
      const editTree = LocationsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        locale: 'en',
      });
      const editCancel = findNodeByTestId(editTree, 'edit-location-cancel-btn');
      void editCancel?.onClick?.();

      const editDialogs = findAllNodes(
        editTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of editDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      const editForm = findFormBySubmitTestId(editTree, 'edit-location-submit-btn');
      await editForm?.onSubmit?.({ preventDefault: vi.fn() });

      // isEditing = true early return
      mockStateQueue = [
        dummyLocations,
        false,
        'shoot-1',
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        dummyLocations[0],
        'Name',
        '',
        '',
        '',
        '',
        'DE',
        '',
        true, // isEditing = true
        null,
        null,
        false,
        null,
      ];
      const editingTree = LocationsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        locale: 'en',
      });
      const editingForm = findFormBySubmitTestId(editingTree, 'edit-location-submit-btn');
      await editingForm?.onSubmit?.({ preventDefault: vi.fn() });

      // editName empty validation error
      mockStateQueue = [
        dummyLocations,
        false,
        'shoot-1',
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        dummyLocations[0],
        '', // empty editName
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const emptyNameEditTree = LocationsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        locale: 'en',
      });
      const emptyNameEditForm = findFormBySubmitTestId(
        emptyNameEditTree,
        'edit-location-submit-btn',
      );
      await emptyNameEditForm?.onSubmit?.({ preventDefault: vi.fn() });

      // 4. deletingLocation: cancel button, onOpenChange, isDeleting early return
      mockStateQueue = [
        dummyLocations,
        false,
        'shoot-1',
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        dummyLocations[0], // deletingLocation
        false,
        null,
      ];
      const deleteTree = LocationsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        locale: 'en',
      });
      const deleteCancel = findNodeByTestId(deleteTree, 'delete-location-cancel-btn');
      void deleteCancel?.onClick?.();

      const deleteDialogs = findAllNodes(
        deleteTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of deleteDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      // isDeleting = true early return
      mockStateQueue = [
        dummyLocations,
        false,
        'shoot-1',
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        'DE',
        '',
        false,
        null,
        dummyLocations[0],
        true, // isDeleting = true
        null,
      ];
      const deletingTree = LocationsSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        locale: 'en',
      });
      const deleteBtn = findNodeByTestId(deletingTree, 'delete-location-confirm-btn');
      await deleteBtn?.onClick?.();
    });

    it('exercises TimelineScheduleSection cancel buttons, onOpenChange, empty shoots, equal timestamp sorting, and validation branches', async () => {
      // 1. handleOpenAdd when shoots = []
      const emptyShootsTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: [],
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });
      const addBtn = findNodeByTestId(emptyShootsTree, 'add-timeline-btn');
      void addBtn?.onClick?.();

      // 2. isAddOpen = true: cancel button, onOpenChange, isAdding early return, missing shootId, missing title, missing startsAt, empty optional fields
      mockStateQueue = [
        dummyTimeline,
        true, // isAddOpen
        'shoot-1',
        '', // locationId empty
        'First Look',
        '2027-06-12T14:00',
        '', // endsAt empty
        '', // description empty
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const addTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });
      const addCancel = findNodeByTestId(addTree, 'add-timeline-cancel-btn');
      void addCancel?.onClick?.();

      const addDialogs = findAllNodes(addTree, (el) => typeof el.props.onOpenChange === 'function');
      for (const d of addDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      // Submit success with equal startsAt sorting check
      const addForm = findFormBySubmitTestId(addTree, 'add-timeline-submit-btn');
      await addForm?.onSubmit?.({ preventDefault: vi.fn() });

      // isAdding = true early return
      mockStateQueue = [
        dummyTimeline,
        true,
        'shoot-1',
        '',
        'Title',
        '2027-06-12T14:00',
        '',
        '',
        true, // isAdding = true
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const addingTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });
      const addingForm = findFormBySubmitTestId(addingTree, 'add-timeline-submit-btn');
      await addingForm?.onSubmit?.({ preventDefault: vi.fn() });

      // missing addShootId
      mockStateQueue = [
        dummyTimeline,
        true,
        '', // empty shootId
        '',
        'Title',
        '2027-06-12T14:00',
        '',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const noShootTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });
      const noShootForm = findFormBySubmitTestId(noShootTree, 'add-timeline-submit-btn');
      await noShootForm?.onSubmit?.({ preventDefault: vi.fn() });

      // missing addTitle
      mockStateQueue = [
        dummyTimeline,
        true,
        'shoot-1',
        '',
        '', // empty title
        '2027-06-12T14:00',
        '',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const noTitleTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });
      const noTitleForm = findFormBySubmitTestId(noTitleTree, 'add-timeline-submit-btn');
      await noTitleForm?.onSubmit?.({ preventDefault: vi.fn() });

      // missing addStartsAt
      mockStateQueue = [
        dummyTimeline,
        true,
        'shoot-1',
        '',
        'Title',
        '', // empty startsAt
        '',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const noStartTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });
      const noStartForm = findFormBySubmitTestId(noStartTree, 'add-timeline-submit-btn');
      await noStartForm?.onSubmit?.({ preventDefault: vi.fn() });

      // 3. editingItem: cancel button, onOpenChange, isEditing early return, missing title, missing startsAt, empty optional fields
      mockStateQueue = [
        dummyTimeline,
        false,
        'shoot-1',
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        dummyTimeline[0], // editingItem
        '', // locationId empty
        'Updated Item',
        '2027-06-12T14:00',
        '', // endsAt empty
        '', // description empty
        false,
        null,
        null,
        false,
        null,
      ];
      const editTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });
      const editCancel = findNodeByTestId(editTree, 'edit-timeline-cancel-btn');
      void editCancel?.onClick?.();

      const editDialogs = findAllNodes(
        editTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of editDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      const editForm = findFormBySubmitTestId(editTree, 'edit-timeline-submit-btn');
      await editForm?.onSubmit?.({ preventDefault: vi.fn() });

      // isEditing = true early return
      mockStateQueue = [
        dummyTimeline,
        false,
        'shoot-1',
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        dummyTimeline[0],
        '',
        'Title',
        '2027-06-12T14:00',
        '',
        '',
        true, // isEditing = true
        null,
        null,
        false,
        null,
      ];
      const editingTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });
      const editingForm = findFormBySubmitTestId(editingTree, 'edit-timeline-submit-btn');
      await editingForm?.onSubmit?.({ preventDefault: vi.fn() });

      // editTitle empty validation error
      mockStateQueue = [
        dummyTimeline,
        false,
        'shoot-1',
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        dummyTimeline[0],
        '',
        '', // empty title
        '2027-06-12T14:00',
        '',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const noTitleEditTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });
      const noTitleEditForm = findFormBySubmitTestId(noTitleEditTree, 'edit-timeline-submit-btn');
      await noTitleEditForm?.onSubmit?.({ preventDefault: vi.fn() });

      // editStartsAt empty validation error
      mockStateQueue = [
        dummyTimeline,
        false,
        'shoot-1',
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        dummyTimeline[0],
        '',
        'Title',
        '', // empty startsAt
        '',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const noStartEditTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });
      const noStartEditForm = findFormBySubmitTestId(noStartEditTree, 'edit-timeline-submit-btn');
      await noStartEditForm?.onSubmit?.({ preventDefault: vi.fn() });

      // 4. deletingItem: cancel button, onOpenChange, isDeleting early return
      mockStateQueue = [
        dummyTimeline,
        false,
        'shoot-1',
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        dummyTimeline[0], // deletingItem
        false,
        null,
      ];
      const deleteTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });
      const deleteCancel = findNodeByTestId(deleteTree, 'delete-timeline-cancel-btn');
      void deleteCancel?.onClick?.();

      const deleteDialogs = findAllNodes(
        deleteTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of deleteDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      // isDeleting = true early return
      mockStateQueue = [
        dummyTimeline,
        false,
        'shoot-1',
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        null,
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        dummyTimeline[0],
        true, // isDeleting = true
        null,
      ];
      const deletingTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: dummyTimeline,
        locale: 'en',
      });
      const deleteBtn = findNodeByTestId(deletingTree, 'delete-timeline-confirm-btn');
      await deleteBtn?.onClick?.();
    });

    it('exercises ParticipantsSection cancel buttons, onOpenChange, empty client contacts, and validation branches', async () => {
      // 1. handleOpenAdd when clientContacts = []
      const emptyContactsTree = ParticipantsSection({
        projectId: 'proj-123',
        participants: dummyParticipants,
        clientContacts: [],
        locale: 'en',
      });
      const addBtn = findNodeByTestId(emptyContactsTree, 'add-participant-btn');
      void addBtn?.onClick?.();

      // 2. isAddOpen = true: cancel button, onOpenChange, isAdding early return, missing role, missing client contactId, missing vendor name, empty optional fields
      mockStateQueue = [
        dummyParticipants,
        true, // isAddOpen
        'vendor', // sourceType
        '', // contactId
        'Vendor Name',
        'Florist', // role
        '', // email
        '', // phone
        false, // isPrimary
        '', // notes
        false,
        null,
        null,
        false,
        null,
      ];
      const addTree = ParticipantsSection({
        projectId: 'proj-123',
        participants: dummyParticipants,
        clientContacts: dummyProjectDetailData.clientContacts,
        locale: 'en',
      });
      const addCancel = findNodeByTestId(addTree, 'add-participant-cancel-btn');
      void addCancel?.onClick?.();

      const addDialogs = findAllNodes(addTree, (el) => typeof el.props.onOpenChange === 'function');
      for (const d of addDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      // Submit success
      const addForm = findForm(addTree);
      await addForm?.onSubmit?.({ preventDefault: vi.fn() });

      // isAdding = true early return
      mockStateQueue = [
        dummyParticipants,
        true,
        'vendor',
        '',
        'Name',
        'Role',
        '',
        '',
        false,
        '',
        true, // isAdding = true
        null,
        null,
        false,
        null,
      ];
      const addingTree = ParticipantsSection({
        projectId: 'proj-123',
        participants: dummyParticipants,
        clientContacts: dummyProjectDetailData.clientContacts,
        locale: 'en',
      });
      const addingForm = findForm(addingTree);
      await addingForm?.onSubmit?.({ preventDefault: vi.fn() });

      // missing role
      mockStateQueue = [
        dummyParticipants,
        true,
        'vendor',
        '',
        'Name',
        '', // empty role
        '',
        '',
        false,
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const noRoleTree = ParticipantsSection({
        projectId: 'proj-123',
        participants: dummyParticipants,
        clientContacts: dummyProjectDetailData.clientContacts,
        locale: 'en',
      });
      const noRoleForm = findForm(noRoleTree);
      await noRoleForm?.onSubmit?.({ preventDefault: vi.fn() });

      // sourceType client with missing contactId
      mockStateQueue = [
        dummyParticipants,
        true,
        'client',
        '', // empty contactId
        '',
        'Bride',
        '',
        '',
        false,
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const noContactTree = ParticipantsSection({
        projectId: 'proj-123',
        participants: dummyParticipants,
        clientContacts: dummyProjectDetailData.clientContacts,
        locale: 'en',
      });
      const noContactForm = findForm(noContactTree);
      await noContactForm?.onSubmit?.({ preventDefault: vi.fn() });

      // sourceType vendor with missing name
      mockStateQueue = [
        dummyParticipants,
        true,
        'vendor',
        '',
        '', // empty name
        'Caterer',
        '',
        '',
        false,
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const noNameTree = ParticipantsSection({
        projectId: 'proj-123',
        participants: dummyParticipants,
        clientContacts: dummyProjectDetailData.clientContacts,
        locale: 'en',
      });
      const noNameForm = findForm(noNameTree);
      await noNameForm?.onSubmit?.({ preventDefault: vi.fn() });

      // 3. deletingParticipant: cancel button, onOpenChange, isDeleting early return
      mockStateQueue = [
        dummyParticipants,
        false,
        'vendor',
        '',
        '',
        '',
        '',
        '',
        false,
        '',
        false,
        null,
        dummyParticipants[0], // deletingParticipant
        false,
        null,
      ];
      const deleteTree = ParticipantsSection({
        projectId: 'proj-123',
        participants: dummyParticipants,
        clientContacts: dummyProjectDetailData.clientContacts,
        locale: 'en',
      });
      const deleteCancel = findNodeByTestId(deleteTree, 'delete-participant-cancel-btn');
      void deleteCancel?.onClick?.();

      const deleteDialogs = findAllNodes(
        deleteTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of deleteDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      // isDeleting = true early return
      mockStateQueue = [
        dummyParticipants,
        false,
        'vendor',
        '',
        '',
        '',
        '',
        '',
        false,
        '',
        false,
        null,
        dummyParticipants[0],
        true, // isDeleting = true
        null,
      ];
      const deletingTree = ParticipantsSection({
        projectId: 'proj-123',
        participants: dummyParticipants,
        clientContacts: dummyProjectDetailData.clientContacts,
        locale: 'en',
      });
      const deleteBtn = findNodeByTestId(deletingTree, 'delete-participant-confirm-btn');
      await deleteBtn?.onClick?.();
    });

    it('exercises StageTasksSection cancel buttons, onOpenChange, and validation/guard branches', async () => {
      // 1. handleOpenAdd via add-task-btn
      const baseTree = StageTasksSection({
        projectId: 'proj-123',
        currentStage: baseStage,
        tasks: dummyTasks,
        locale: 'en',
      });
      const addBtn = findNodeByTestId(baseTree, 'add-task-btn');
      void addBtn?.onClick?.();

      // 2. isAddOpen = true: cancel button, onOpenChange, isAdding early return, missing dueDate
      mockStateQueue = [
        dummyTasks,
        true, // isAddOpen
        'Task without due date',
        '', // empty dueDate
        false,
        null,
        new Set<string>(),
        null,
        false,
        null,
      ];
      const addTree = StageTasksSection({
        projectId: 'proj-123',
        currentStage: baseStage,
        tasks: dummyTasks,
        locale: 'en',
      });
      const addCancel = findNodeByTestId(addTree, 'add-task-cancel-btn');
      void addCancel?.onClick?.();

      const addDialogs = findAllNodes(addTree, (el) => typeof el.props.onOpenChange === 'function');
      for (const d of addDialogs) {
        d.props.onOpenChange?.(false);
        d.props.onOpenChange?.(true);
      }

      const addForm = findForm(addTree);
      await addForm?.onSubmit?.({ preventDefault: vi.fn() });

      // isAdding = true early return
      mockStateQueue = [
        dummyTasks,
        true,
        'Title',
        '',
        true, // isAdding = true
        null,
        new Set<string>(),
        null,
        false,
        null,
      ];
      const addingTree = StageTasksSection({
        projectId: 'proj-123',
        currentStage: baseStage,
        tasks: dummyTasks,
        locale: 'en',
      });
      const addingForm = findForm(addingTree);
      await addingForm?.onSubmit?.({ preventDefault: vi.fn() });

      // 3. deletingTask: cancel button, onOpenChange, isDeleting early return
      mockStateQueue = [
        dummyTasks,
        false,
        '',
        '',
        false,
        null,
        new Set<string>(),
        baseTask, // deletingTask
        false,
        null,
      ];
      const deleteTree = StageTasksSection({
        projectId: 'proj-123',
        currentStage: baseStage,
        tasks: dummyTasks,
        locale: 'en',
      });
      const deleteCancel = findNodeByTestId(deleteTree, 'delete-task-cancel-btn');
      void deleteCancel?.onClick?.();

      const deleteDialogs = findAllNodes(
        deleteTree,
        (el) => typeof el.props.onOpenChange === 'function',
      );
      for (const d of deleteDialogs) {
        const dialogProps = d.props as { onOpenChange?: (open: boolean) => void };
        dialogProps.onOpenChange?.(false);
        dialogProps.onOpenChange?.(true);
      }

      // isDeleting = true early return
      mockStateQueue = [
        dummyTasks,
        false,
        '',
        '',
        false,
        null,
        new Set<string>(),
        baseTask,
        true, // isDeleting = true
        null,
      ];
      const deletingTree = StageTasksSection({
        projectId: 'proj-123',
        currentStage: baseStage,
        tasks: dummyTasks,
        locale: 'en',
      });
      const deleteBtn = findNodeByTestId(deletingTree, 'delete-task-confirm-btn');
      await deleteBtn?.onClick?.();

      // 4. toggleTask when already toggling (early return)
      mockStateQueue = [
        dummyTasks,
        false,
        '',
        '',
        false,
        null,
        new Set<string>([baseTask.id]), // togglingTaskIds contains task-1
        null,
        false,
        null,
      ];
      const togglingTree = StageTasksSection({
        projectId: 'proj-123',
        currentStage: baseStage,
        tasks: dummyTasks,
        locale: 'en',
      });
      const checkbox = findNodeByTestId(togglingTree, `task-checkbox-${baseTask.id}`);
      await checkbox?.onClick?.();
    });

    it('renders all tab panels in ProjectDetailView and exercises multi-item update sorting', async () => {
      // 1. Tab panels rendering
      for (const tabKey of ['shoots', 'locations', 'timeline', 'participants', 'tasks'] as const) {
        mockStateQueue = [
          dummyProjectDetailData.project,
          dummyShoots,
          dummyLocations,
          dummyTimeline,
          dummyParticipants,
          dummyTasks,
          baseStage,
          tabKey, // activeTab
          null,
          false,
          null,
          false,
          'Title',
          'wedding',
          '2500',
          'Notes',
          false,
          null,
          false,
          false,
        ];
        const tabTree = ProjectDetailView({ initialData: dummyProjectDetailData, locale: 'en' });
        expect(tabTree).toBeDefined();
      }

      // 2. Shoots multi-item sorting on update
      const twoShoots: Shoot[] = [
        baseShoot,
        {
          ...baseShoot,
          id: 'shoot-2',
          startsAt: new Date('2027-06-13T10:00:00Z'),
          endsAt: new Date('2027-06-13T18:00:00Z'),
        },
      ];
      mockStateQueue = [
        twoShoots,
        false,
        '',
        '',
        '',
        'Europe/Berlin',
        '',
        false,
        null,
        twoShoots[0], // editingShoot
        'Updated Shoot Title',
        '2027-06-14T10:00',
        '2027-06-14T18:00',
        'Europe/Berlin',
        'Notes',
        false,
        null,
        null,
        false,
        null,
      ];
      const twoShootsTree = ShootsSection({
        projectId: 'proj-123',
        shoots: twoShoots,
        locale: 'en',
      });
      const editTwoForm = findFormBySubmitTestId(twoShootsTree, 'edit-shoot-submit-btn');
      await editTwoForm?.onSubmit?.({ preventDefault: vi.fn() });

      // 3. Timeline multi-item sorting on update
      const twoItems: ProjectDetailTimelineItem[] = [
        baseTimeline,
        {
          ...baseTimeline,
          id: 'time-2',
          startsAt: baseTimeline.startsAt,
          order: 2,
        },
      ];
      mockStateQueue = [
        twoItems,
        false,
        'shoot-1',
        '',
        '',
        '',
        '',
        '',
        false,
        null,
        twoItems[0], // editingItem
        '',
        'Updated Item',
        '2027-06-12T14:00',
        '',
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const twoItemsTree = TimelineScheduleSection({
        projectId: 'proj-123',
        shoots: dummyShoots,
        locations: dummyLocations,
        timelineItems: twoItems,
        locale: 'en',
      });
      const editTwoItemForm = findFormBySubmitTestId(twoItemsTree, 'edit-timeline-submit-btn');
      await editTwoItemForm?.onSubmit?.({ preventDefault: vi.fn() });

      // 4. Contact selection in ParticipantsSection
      mockStateQueue = [
        dummyParticipants,
        true, // isAddOpen
        'client', // sourceType
        'contact-1', // contactId
        'Hannah Weber',
        'Client',
        'hannah@example.com',
        '+49 30 11223344',
        false,
        '',
        false,
        null,
        null,
        false,
        null,
      ];
      const partSelectTree = ParticipantsSection({
        projectId: 'proj-123',
        participants: dummyParticipants,
        clientContacts: dummyProjectDetailData.clientContacts,
        locale: 'en',
      });
      const contactSelect = findNodeByTestId(partSelectTree, 'add-participant-contact-select');
      const onContactChange = contactSelect?.onChange;
      onContactChange?.({ target: { value: 'contact-1' } });
    });
  });
});
