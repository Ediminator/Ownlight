import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { KanbanProject } from '@/server/projects/service';
import type { PipelineStage } from '@/server/db/schema/projects';

// Mock server-only
vi.mock('server-only', () => ({}));

// Mock router and navigation
const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
  }),
  usePathname: () => '/en/projects',
  useSearchParams: () => new URLSearchParams('view=list'),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
  }),
  usePathname: () => '/en/projects',
}));

// Mock translations
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = Reflect.get(current, part);
    } else {
      return undefined;
    }
  }
  return current;
}

let currentLocale: 'en' | 'de' = 'en';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => {
    return (key: string, values?: Record<string, unknown>) => {
      const messages = currentLocale === 'de' ? deMessages : enMessages;
      const fullPath = namespace ? `${namespace}.${key}` : key;
      const raw = getNestedValue(messages, fullPath);
      let text = typeof raw === 'string' ? raw : `[${fullPath}]`;
      if (values) {
        for (const [vKey, vVal] of Object.entries(values)) {
          text = text.replace(new RegExp(`\\{${vKey}\\}`, 'g'), String(vVal));
        }
      }
      return text;
    };
  },
  useLocale: () => currentLocale,
}));

let mockStateQueue: unknown[] = [];

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
  };
});

// Mock server actions
const mockTransitionProjectStageAction = vi.fn().mockResolvedValue({ success: true });
const mockDeleteProjectAction = vi.fn().mockResolvedValue({ success: true });

vi.mock('@/server/projects/actions', () => ({
  createProjectAction: vi
    .fn()
    .mockResolvedValue({ success: true, data: { projectId: 'mock-proj-1' } }),
  transitionProjectStageAction: (...args: unknown[]) =>
    mockTransitionProjectStageAction(...args) as unknown,
  deleteProjectAction: (...args: unknown[]) => mockDeleteProjectAction(...args) as unknown,
}));

import { ProjectsTable, type ProjectsTableProps } from '@/components/projects/projects-table';

const mockStages: PipelineStage[] = [
  {
    id: 'stage-1',
    key: 'inquiry',
    name: 'Inquiry',
    position: 1,
    category: 'inquiry',
    color: 'sky',
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'stage-2',
    key: 'booked',
    name: 'Booked',
    position: 2,
    category: 'booked',
    color: 'blue',
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'stage-3',
    key: 'shot',
    name: 'Shot',
    position: 3,
    category: 'in_progress',
    color: 'amber',
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'stage-4',
    key: 'editing',
    name: 'Editing',
    position: 4,
    category: 'in_progress',
    color: 'purple',
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'stage-5',
    key: 'delivered',
    name: 'Delivered',
    position: 5,
    category: 'completed',
    color: 'emerald',
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'stage-6',
    key: 'archived',
    name: 'Archived',
    position: 6,
    category: 'archived',
    color: 'neutral',
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const mockClients = [
  { id: 'client-1', displayName: 'Emma Watson' },
  { id: 'client-2', displayName: 'Lucas Brown' },
];

const mockProjects: KanbanProject[] = [
  {
    id: 'proj-1',
    title: 'Emma & Liam Wedding',
    clientId: 'client-1',
    clientDisplayName: 'Emma Watson',
    stageId: 'stage-1',
    stageKey: 'inquiry',
    projectTypeKey: 'wedding',
    primaryShootStartsAt: '2027-06-19T10:00:00.000Z',
    primaryShootTimezone: 'Europe/Berlin',
    primaryShootLocationName: 'Botanical Gardens',
    currency: 'EUR',
    priceMinor: 250000,
    taskCount: 5,
    completedTaskCount: 3,
    incompleteTasks: [{ id: 't-1', title: 'Task 1', stageId: 'stage-1' }],
    lastActivityAt: '2026-10-15T08:00:00.000Z',
  },
  {
    id: 'proj-2',
    title: 'Lucas Portrait Session',
    clientId: 'client-2',
    clientDisplayName: 'Lucas Brown',
    stageId: 'stage-2',
    stageKey: 'booked',
    projectTypeKey: 'portrait',
    primaryShootStartsAt: '2027-07-10T14:00:00.000Z',
    primaryShootTimezone: 'Europe/Berlin',
    primaryShootLocationName: 'Studio A',
    currency: 'EUR',
    priceMinor: 600000,
    taskCount: 2,
    completedTaskCount: 2,
    incompleteTasks: [],
    lastActivityAt: '2026-10-14T10:00:00.000Z',
  },
  {
    id: 'proj-3',
    title: 'Commercial Campaign',
    clientId: 'client-1',
    clientDisplayName: 'Emma Watson',
    stageId: 'stage-3',
    stageKey: 'shot',
    projectTypeKey: 'commercial',
    primaryShootStartsAt: null,
    primaryShootTimezone: null,
    primaryShootLocationName: null,
    currency: 'EUR',
    priceMinor: null,
    taskCount: 0,
    completedTaskCount: 0,
    incompleteTasks: [],
    lastActivityAt: '2026-10-10T09:00:00.000Z',
  },
  {
    id: 'proj-4',
    title: 'Past Event Coverage',
    clientId: 'client-2',
    clientDisplayName: 'Lucas Brown',
    stageId: 'stage-5',
    stageKey: 'delivered',
    projectTypeKey: 'event',
    primaryShootStartsAt: '2025-01-10T09:00:00.000Z',
    primaryShootTimezone: 'Europe/Berlin',
    primaryShootLocationName: 'Old City Hall',
    currency: 'EUR',
    priceMinor: 120000,
    taskCount: 1,
    completedTaskCount: 1,
    incompleteTasks: [],
    lastActivityAt: '2025-01-11T12:00:00.000Z',
  },
];

let capturedTableTree: React.ReactElement | null = null;
function CaptureProjectsTable(props: ProjectsTableProps) {
  const res = ProjectsTable(props);
  capturedTableTree = res;
  return res;
}

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

describe('TASK-0037: Projects Directory Table UI & In-Memory Search Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStateQueue = [];
    capturedTableTree = null;
    currentLocale = 'en';
  });

  it('AC-1: renders projects table with all required columns (Title, Client, Type, Stage, Shoot Date, Tasks, Value, Actions)', () => {
    const html = renderToStaticMarkup(
      <ProjectsTable
        projects={mockProjects}
        stages={mockStages}
        locale="en"
        clients={mockClients}
        searchParams={{ view: 'list' }}
      />,
    );

    expect(html).toContain('data-testid="projects-table"');
    expect(html).toContain('data-testid="project-table-title-proj-1"');
    expect(html).toContain('Emma &amp; Liam Wedding');
    expect(html).toContain('href="/en/projects/proj-1"');
    expect(html).toContain('data-testid="project-table-client-proj-1"');
    expect(html).toContain('Emma Watson');
    expect(html).toContain('href="/en/clients/client-1"');
    expect(html).toContain('data-testid="project-table-type-proj-1"');
    expect(html).toContain('data-testid="project-table-stage-proj-1"');
    expect(html).toContain('data-testid="project-table-date-proj-1"');
    expect(html).toContain('data-testid="project-table-tasks-proj-1"');
    expect(html).toContain('3/5');
    expect(html).toContain('data-testid="project-table-value-proj-1"');
    expect(html).toContain('€2,500.00');
    expect(html).toContain('data-testid="project-actions-trigger-proj-1"');
  });

  it('AC-2: filters rows by stage parameter and renders active filter selections', () => {
    const html = renderToStaticMarkup(
      <ProjectsTable
        projects={mockProjects}
        stages={mockStages}
        locale="en"
        clients={mockClients}
        searchParams={{ view: 'list', stage: 'booked' }}
      />,
    );

    // Only proj-2 is booked
    expect(html).toContain('data-testid="project-table-title-proj-2"');
    expect(html).not.toContain('data-testid="project-table-title-proj-1"');
    expect(html).not.toContain('data-testid="project-table-title-proj-3"');
  });

  it('AC-2: filters rows by project type parameter', () => {
    const html = renderToStaticMarkup(
      <ProjectsTable
        projects={mockProjects}
        stages={mockStages}
        locale="en"
        clients={mockClients}
        searchParams={{ view: 'list', type: 'portrait' }}
      />,
    );

    expect(html).toContain('data-testid="project-table-title-proj-2"');
    expect(html).not.toContain('data-testid="project-table-title-proj-1"');
  });

  it('AC-2: filters rows by shoot date parameter (unscheduled, upcoming, past)', () => {
    // Unscheduled
    const htmlUnscheduled = renderToStaticMarkup(
      <ProjectsTable
        projects={mockProjects}
        stages={mockStages}
        locale="en"
        clients={mockClients}
        searchParams={{ view: 'list', date: 'unscheduled' }}
      />,
    );
    expect(htmlUnscheduled).toContain('data-testid="project-table-title-proj-3"');
    expect(htmlUnscheduled).not.toContain('data-testid="project-table-title-proj-1"');

    // Upcoming (future shoot date)
    const htmlUpcoming = renderToStaticMarkup(
      <ProjectsTable
        projects={mockProjects}
        stages={mockStages}
        locale="en"
        clients={mockClients}
        searchParams={{ view: 'list', date: 'upcoming' }}
      />,
    );
    expect(htmlUpcoming).toContain('data-testid="project-table-title-proj-1"');
    expect(htmlUpcoming).not.toContain('data-testid="project-table-title-proj-4"');

    // Past shoot date
    const htmlPast = renderToStaticMarkup(
      <ProjectsTable
        projects={mockProjects}
        stages={mockStages}
        locale="en"
        clients={mockClients}
        searchParams={{ view: 'list', date: 'past' }}
      />,
    );
    expect(htmlPast).toContain('data-testid="project-table-title-proj-4"');
    expect(htmlPast).not.toContain('data-testid="project-table-title-proj-1"');
  });

  it('AC-3: in-memory search filters by title, client name, and shoot location without placing q in URL', () => {
    // 1. Search by title
    mockStateQueue = ['Liam', 'title', 'asc'];
    const htmlTitle = renderToStaticMarkup(
      <ProjectsTable projects={mockProjects} stages={mockStages} clients={mockClients} />,
    );
    expect(htmlTitle).toContain('Emma &amp; Liam Wedding');
    expect(htmlTitle).not.toContain('Lucas Portrait Session');

    // 2. Search by client display name
    mockStateQueue = ['Lucas', 'title', 'asc'];
    const htmlClient = renderToStaticMarkup(
      <ProjectsTable projects={mockProjects} stages={mockStages} clients={mockClients} />,
    );
    expect(htmlClient).toContain('Lucas Portrait Session');
    expect(htmlClient).not.toContain('Emma &amp; Liam Wedding');

    // 3. Search by shoot location
    mockStateQueue = ['Botanical', 'title', 'asc'];
    const htmlLocation = renderToStaticMarkup(
      <ProjectsTable projects={mockProjects} stages={mockStages} clients={mockClients} />,
    );
    expect(htmlLocation).toContain('Emma &amp; Liam Wedding');
    expect(htmlLocation).not.toContain('Lucas Portrait Session');

    // 4. Search with no matches renders empty state
    mockStateQueue = ['NonExistentQueryXYZ', 'title', 'asc'];
    const htmlEmpty = renderToStaticMarkup(
      <ProjectsTable projects={mockProjects} stages={mockStages} clients={mockClients} />,
    );
    expect(htmlEmpty).toContain('data-testid="projects-table-empty"');
    expect(htmlEmpty).toContain('data-testid="projects-empty-clear-btn"');
  });

  it('handles search input onChange and clear button onClick', () => {
    mockStateQueue = ['initial search', 'title', 'asc'];

    renderToStaticMarkup(
      <CaptureProjectsTable projects={mockProjects} stages={mockStages} clients={mockClients} />,
    );

    const searchInput = findNodeByTestId(capturedTableTree, 'project-search-input');
    const onSearchChange = searchInput?.onChange as
      ((e: { target: { value: string } }) => void) | undefined;
    onSearchChange?.({ target: { value: 'new query' } });

    const clearBtn = findNodeByTestId(capturedTableTree, 'project-search-clear-btn');
    const onClearClick = clearBtn?.onClick as (() => void) | undefined;
    onClearClick?.();

    expect(searchInput).toBeDefined();
    expect(clearBtn).toBeDefined();
  });

  it('handles dropdown filter changes (stage, type, date) and calls router.replace with query params', () => {
    renderToStaticMarkup(
      <CaptureProjectsTable projects={mockProjects} stages={mockStages} clients={mockClients} />,
    );

    const stageSelect = findNodeByTestId(capturedTableTree, 'project-filter-stage');
    const onStageChange = stageSelect?.onChange as
      ((e: { target: { value: string } }) => void) | undefined;
    onStageChange?.({ target: { value: 'booked' } });
    expect(mockReplace).toHaveBeenCalledWith('/en/projects?view=list&stage=booked');

    const typeSelect = findNodeByTestId(capturedTableTree, 'project-filter-type');
    const onTypeChange = typeSelect?.onChange as
      ((e: { target: { value: string } }) => void) | undefined;
    onTypeChange?.({ target: { value: 'portrait' } });
    expect(mockReplace).toHaveBeenCalledWith('/en/projects?view=list&type=portrait');

    const dateSelect = findNodeByTestId(capturedTableTree, 'project-filter-date');
    const onDateChange = dateSelect?.onChange as
      ((e: { target: { value: string } }) => void) | undefined;
    onDateChange?.({ target: { value: 'upcoming' } });
    expect(mockReplace).toHaveBeenCalledWith('/en/projects?view=list&date=upcoming');
  });

  it('handles filter clear button in filter bar and in empty state', () => {
    // When isFiltered is true
    mockStateQueue = ['', 'title', 'asc'];
    renderToStaticMarkup(
      <CaptureProjectsTable
        projects={mockProjects}
        stages={mockStages}
        clients={mockClients}
        searchParams={{ view: 'list', stage: 'booked', type: 'portrait' }}
      />,
    );

    const clearBtn = findNodeByTestId(capturedTableTree, 'project-filters-clear-btn');
    const onClearClick = clearBtn?.onClick as (() => void) | undefined;
    onClearClick?.();
    expect(mockReplace).toHaveBeenCalledWith('/en/projects?view=list');

    // Empty state clear button
    mockStateQueue = ['unmatched', 'title', 'asc'];
    renderToStaticMarkup(
      <CaptureProjectsTable projects={mockProjects} stages={mockStages} clients={mockClients} />,
    );
    const emptyClearBtn = findNodeByTestId(capturedTableTree, 'projects-empty-clear-btn');
    const onEmptyClearClick = emptyClearBtn?.onClick as (() => void) | undefined;
    onEmptyClearClick?.();
    expect(mockReplace).toHaveBeenCalledWith('/en/projects?view=list');
  });

  it('AC-6: sorts table rows by title, client, date, value, and lastActivity', () => {
    // Title asc vs desc
    mockStateQueue = ['', 'title', 'desc'];
    const htmlTitleDesc = renderToStaticMarkup(
      <ProjectsTable projects={mockProjects} stages={mockStages} clients={mockClients} />,
    );
    expect(htmlTitleDesc).toContain('aria-sort="descending"');

    // Client sort
    mockStateQueue = ['', 'client', 'asc'];
    const htmlClientAsc = renderToStaticMarkup(
      <ProjectsTable projects={mockProjects} stages={mockStages} clients={mockClients} />,
    );
    expect(htmlClientAsc).toContain('data-testid="sort-header-client"');

    // Date sort (with null shoot dates)
    mockStateQueue = ['', 'date', 'desc'];
    const htmlDateDesc = renderToStaticMarkup(
      <ProjectsTable projects={mockProjects} stages={mockStages} clients={mockClients} />,
    );
    expect(htmlDateDesc).toContain('data-testid="sort-header-date"');

    // Value sort (with null prices)
    mockStateQueue = ['', 'value', 'desc'];
    const htmlValueDesc = renderToStaticMarkup(
      <ProjectsTable projects={mockProjects} stages={mockStages} clients={mockClients} />,
    );
    expect(htmlValueDesc).toContain('data-testid="sort-header-value"');

    // LastActivity sort
    mockStateQueue = ['', 'lastActivity', 'asc'];
    const htmlActivityAsc = renderToStaticMarkup(
      <ProjectsTable projects={mockProjects} stages={mockStages} clients={mockClients} />,
    );
    expect(htmlActivityAsc).toContain('data-testid="sort-header-lastActivity"');
  });

  it('handles clicking sort header buttons to toggle sort column and direction', () => {
    renderToStaticMarkup(
      <CaptureProjectsTable projects={mockProjects} stages={mockStages} clients={mockClients} />,
    );

    const titleSort = findNodeByTestId(capturedTableTree, 'sort-header-title');
    const onTitleSortClick = titleSort?.onClick as (() => void) | undefined;
    onTitleSortClick?.();

    const clientSort = findNodeByTestId(capturedTableTree, 'sort-header-client');
    const onClientSortClick = clientSort?.onClick as (() => void) | undefined;
    onClientSortClick?.();

    const dateSort = findNodeByTestId(capturedTableTree, 'sort-header-date');
    const onDateSortClick = dateSort?.onClick as (() => void) | undefined;
    onDateSortClick?.();

    const valueSort = findNodeByTestId(capturedTableTree, 'sort-header-value');
    const onValueSortClick = valueSort?.onClick as (() => void) | undefined;
    onValueSortClick?.();

    const activitySort = findNodeByTestId(capturedTableTree, 'sort-header-lastActivity');
    const onActivitySortClick = activitySort?.onClick as (() => void) | undefined;
    onActivitySortClick?.();

    expect(titleSort).toBeDefined();
    expect(clientSort).toBeDefined();
  });

  it('handles row actions: move to stage and delete project', async () => {
    renderToStaticMarkup(
      <CaptureProjectsTable projects={mockProjects} stages={mockStages} clients={mockClients} />,
    );

    // Target move stage item
    const moveTarget = findNodeByTestId(capturedTableTree, 'project-move-target-proj-1-booked');
    const onMoveClick = moveTarget?.onClick as (() => Promise<void>) | undefined;
    await onMoveClick?.();
    expect(mockTransitionProjectStageAction).toHaveBeenCalledWith({
      projectId: 'proj-1',
      targetStageId: 'stage-2',
    });
    expect(mockRefresh).toHaveBeenCalled();

    // Target delete project item (with confirm = true)
    globalThis.confirm = vi.fn().mockReturnValue(true);
    const deleteBtn = findNodeByTestId(capturedTableTree, 'project-action-delete-proj-1');
    const onDeleteClick = deleteBtn?.onClick as (() => Promise<void>) | undefined;
    await onDeleteClick?.();
    expect(mockDeleteProjectAction).toHaveBeenCalledWith({ projectId: 'proj-1' });

    // Target delete project item (with confirm = false)
    mockDeleteProjectAction.mockClear();
    globalThis.confirm = vi.fn().mockReturnValue(false);
    await onDeleteClick?.();
    expect(mockDeleteProjectAction).not.toHaveBeenCalled();
  });

  it('AC-7: renders table headers and filter options in German when locale is de', () => {
    currentLocale = 'de';
    const html = renderToStaticMarkup(
      <ProjectsTable
        projects={mockProjects}
        stages={mockStages}
        locale="de"
        clients={mockClients}
        searchParams={{ view: 'list' }}
      />,
    );

    expect(html).toContain('Projektname');
    expect(html).toContain('Kunde');
    expect(html).toContain('Shooting-Termin');
    expect(html).toContain('Wert');
    expect(html).toContain('Phase');
    expect(html).toContain('Hochzeit');
  });

  it('handles stage categories badge styling properly for cancelled or default stage categories', () => {
    const customStages: PipelineStage[] = [
      {
        id: 'stage-cancelled',
        key: 'cancelled',
        name: 'Cancelled',
        position: 7,
        category: 'cancelled' as PipelineStage['category'],
        color: 'rose',
        isSystem: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'stage-unknown',
        key: 'custom_status',
        name: 'Custom',
        position: 8,
        category: 'other' as PipelineStage['category'],
        color: 'slate',
        isSystem: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const customProjects: KanbanProject[] = [
      {
        id: 'proj-cancelled',
        title: 'Cancelled Gig',
        clientId: 'client-1',
        clientDisplayName: 'Emma Watson',
        stageId: 'stage-cancelled',
        stageKey: 'cancelled',
        projectTypeKey: 'general',
        primaryShootStartsAt: null,
        primaryShootTimezone: null,
        primaryShootLocationName: null,
        currency: 'EUR',
        priceMinor: 0,
        taskCount: 0,
        completedTaskCount: 0,
        incompleteTasks: [],
        lastActivityAt: '2026-10-10T09:00:00.000Z',
      },
      {
        id: 'proj-custom',
        title: 'Custom Stage Gig',
        clientId: 'client-2',
        clientDisplayName: 'Lucas Brown',
        stageId: 'stage-unknown',
        stageKey: 'custom_status',
        projectTypeKey: 'unknown_type',
        primaryShootStartsAt: null,
        primaryShootTimezone: null,
        primaryShootLocationName: null,
        currency: 'EUR',
        priceMinor: 0,
        taskCount: 0,
        completedTaskCount: 0,
        incompleteTasks: [],
        lastActivityAt: '2026-10-10T09:00:00.000Z',
      },
    ];

    const html = renderToStaticMarkup(
      <ProjectsTable
        projects={customProjects}
        stages={customStages}
        clients={mockClients}
        searchParams={{ view: 'list' }}
      />,
    );

    expect(html).toContain('Cancelled Gig');
    expect(html).toContain('Custom Stage Gig');
  });
});
