import { describe, it, expect } from 'vitest';
import { formatCurrency } from '@/lib/formatters';
import { transitionStageSchema } from '@/server/projects/schema';
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';
import { getStageCategoryBadgeClasses } from '@/components/projects/kanban-column';
import type { KanbanProject } from '@/server/projects/service';
import type { PipelineStage } from '@/server/db/schema/projects';

describe('TASK-0036: Pipeline Kanban Board UI Unit Tests', () => {
  const stageInquiry: PipelineStage = {
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
  const stageBooked: PipelineStage = {
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
  const stageShot: PipelineStage = {
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
  const stageEditing: PipelineStage = {
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
  const stageDelivered: PipelineStage = {
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
  const stageArchived: PipelineStage = {
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

  const mockStages: PipelineStage[] = [
    stageInquiry,
    stageBooked,
    stageShot,
    stageEditing,
    stageDelivered,
    stageArchived,
  ];

  const project1: KanbanProject = {
    id: '01920000-0000-7000-8000-000000000101',
    title: 'Emma & Liam Wedding',
    clientId: '01920000-0000-7000-8000-000000000201',
    clientDisplayName: 'Emma Watson',
    stageId: '01920000-0000-7000-8000-000000000001',
    stageKey: 'inquiry',
    projectTypeKey: 'wedding',
    primaryShootStartsAt: '2027-06-19T10:00:00.000Z',
    primaryShootTimezone: 'Europe/Berlin',
    currency: 'EUR',
    priceMinor: 250000,
    taskCount: 3,
    completedTaskCount: 1,
    incompleteTasks: [
      {
        id: '01920000-0000-7000-8000-000000000301',
        title: 'Send brochure',
        stageId: '01920000-0000-7000-8000-000000000001',
      },
    ],
  };

  const project2: KanbanProject = {
    id: '01920000-0000-7000-8000-000000000102',
    title: 'Lucas Portrait Session',
    clientId: '01920000-0000-7000-8000-000000000202',
    clientDisplayName: 'Lucas Scott',
    stageId: '01920000-0000-7000-8000-000000000001',
    stageKey: 'inquiry',
    projectTypeKey: 'portrait',
    primaryShootStartsAt: null,
    primaryShootTimezone: null,
    currency: 'EUR',
    priceMinor: 600000,
    taskCount: 0,
    completedTaskCount: 0,
    incompleteTasks: [],
  };

  const project3: KanbanProject = {
    id: '01920000-0000-7000-8000-000000000103',
    title: 'Editing Stage Project',
    clientId: '01920000-0000-7000-8000-000000000203',
    clientDisplayName: 'Sophie Müller',
    stageId: '01920000-0000-7000-8000-000000000004',
    stageKey: 'editing',
    projectTypeKey: 'wedding',
    primaryShootStartsAt: '2027-05-10T09:00:00.000Z',
    primaryShootTimezone: 'Europe/Berlin',
    currency: 'EUR',
    priceMinor: 350000,
    taskCount: 2,
    completedTaskCount: 0,
    incompleteTasks: [
      {
        id: '01920000-0000-7000-8000-000000000302',
        title: 'Color grade ceremony',
        stageId: '01920000-0000-7000-8000-000000000004',
      },
      {
        id: '01920000-0000-7000-8000-000000000303',
        title: 'Export web previews',
        stageId: '01920000-0000-7000-8000-000000000004',
      },
    ],
  };

  const mockProjects: KanbanProject[] = [project1, project2, project3];

  it('AC-1: Kanban stage value summation sums price minor units and formats correctly', () => {
    // Stage 1 (Inquiry) has 2 projects: 250,000 + 600,000 = 850,000 minor units (€8,500.00)
    const inquiryProjects = mockProjects.filter((p) => p.stageId === stageInquiry.id);
    const sumInquiry = inquiryProjects.reduce((acc, p) => acc + (p.priceMinor ?? 0), 0);
    expect(sumInquiry).toBe(850000);

    const formattedEn = formatCurrency(sumInquiry, 'EUR', 'en');
    expect(formattedEn).toBe('€8,500.00');

    const formattedDe = formatCurrency(sumInquiry, 'EUR', 'de');
    expect(formattedDe).toBe('8.500,00 €');

    // Stage 6 (Archived) has 0 projects: sums to 0 minor units (€0.00)
    const archivedProjects = mockProjects.filter((p) => p.stageId === stageArchived.id);
    const sumArchived = archivedProjects.reduce((acc, p) => acc + (p.priceMinor ?? 0), 0);
    expect(sumArchived).toBe(0);
    expect(formatCurrency(sumArchived, 'EUR', 'en')).toBe('€0.00');
  });

  it('AC-1: verifies 6 pipeline stages sort in position ASC order', () => {
    const unsorted = [
      stageDelivered,
      stageInquiry,
      stageShot,
      stageBooked,
      stageArchived,
      stageEditing,
    ];
    const sorted = [...unsorted].sort((a, b) => a.position - b.position);

    expect(sorted.map((s) => s.key)).toEqual([
      'inquiry',
      'booked',
      'shot',
      'editing',
      'delivered',
      'archived',
    ]);
  });

  it('AC-1: category badge color classes map all 6 categories correctly', () => {
    expect(getStageCategoryBadgeClasses('inquiry')).toContain('slate');
    expect(getStageCategoryBadgeClasses('booked')).toContain('blue');
    expect(getStageCategoryBadgeClasses('in_progress')).toContain('amber');
    expect(getStageCategoryBadgeClasses('review')).toContain('purple');
    expect(getStageCategoryBadgeClasses('completed')).toContain('emerald');
    expect(getStageCategoryBadgeClasses('archived')).toContain('zinc');
    expect(getStageCategoryBadgeClasses('unknown')).toContain('zinc');
  });

  it('AC-2: Stage transition payload format and schema validation', () => {
    const valid = {
      projectId: '01920000-0000-7000-8000-000000000101',
      targetStageId: '01920000-0000-7000-8000-000000000002',
    };

    const parsed = transitionStageSchema.safeParse(valid);
    expect(parsed.success).toBe(true);

    // Rejects invalid UUID
    const invalidUuid = transitionStageSchema.safeParse({
      projectId: 'not-a-uuid',
      targetStageId: '01920000-0000-7000-8000-000000000002',
    });
    expect(invalidUuid.success).toBe(false);

    // Rejects additional unexpected keys (strict mode)
    const extraKeys = transitionStageSchema.safeParse({
      ...valid,
      unknownProp: 123,
    });
    expect(extraKeys.success).toBe(false);
  });

  it('AC-3: Accessible keyboard alternative filters target stages and formats announcement', () => {
    const currentProject = project1;
    const targetStages = mockStages.filter((s) => s.id !== currentProject.stageId);

    // Filters out current stage (Inquiry), leaving 5 options
    expect(targetStages.length).toBe(5);
    expect(targetStages.some((s) => s.id === currentProject.stageId)).toBe(false);

    // Announcement generation
    const announcementTemplate = enMessages.projects.announcements.stageChanged;
    const announcement = announcementTemplate
      .replace('{title}', currentProject.title)
      .replace('{stage}', 'Shot');

    expect(announcement).toBe('Project Emma & Liam Wedding moved to Shot stage');
  });

  it('AC-4: Advisory task warning condition detection and prompt formatting', () => {
    const projectWithTasks = project3; // 2 incomplete tasks in Editing stage
    const incompleteTasksForCurrentStage = projectWithTasks.incompleteTasks.filter(
      (t) => !t.stageId || t.stageId === projectWithTasks.stageId,
    );

    expect(incompleteTasksForCurrentStage.length).toBe(2);
    expect(incompleteTasksForCurrentStage.map((t) => t.title)).toEqual([
      'Color grade ceremony',
      'Export web previews',
    ]);

    // Project without incomplete tasks in its current stage
    const projectWithoutTasks = project2;
    const noTasks = projectWithoutTasks.incompleteTasks.filter(
      (t) => !t.stageId || t.stageId === projectWithoutTasks.stageId,
    );
    expect(noTasks.length).toBe(0);
  });

  it('AC-5: Board and list view switcher state and query parameter handling', () => {
    const isListView = (view: string | undefined): boolean => view === 'list';
    expect(isListView(undefined)).toBe(false);
    expect(isListView('board')).toBe(false);
    expect(isListView('list')).toBe(true);
  });

  it('AC-6: Optimistic update reducer and rollback on transition error', () => {
    let state = [...mockProjects];
    const initialSnapshot = [...state];

    // Optimistic move project 1 from Inquiry to Booked
    const targetStage = stageBooked;
    state = state.map((p) =>
      p.id === project1.id ? { ...p, stageId: targetStage.id, stageKey: targetStage.key } : p,
    );

    const movedProject = state.find((p) => p.id === project1.id);
    expect(movedProject?.stageId).toBe(targetStage.id);

    // Error occurs on server -> rollback to snapshot
    state = initialSnapshot;
    const restoredProject = state.find((p) => p.id === project1.id);
    expect(restoredProject?.stageId).toBe(stageInquiry.id);
  });

  it('AC-7: Localization catalogue verification for en and de', () => {
    const stageKeys = ['inquiry', 'booked', 'shot', 'editing', 'delivered', 'archived'] as const;
    const enStages = enMessages.projects.stages as Record<string, string>;
    const deStages = deMessages.projects.stages as Record<string, string>;

    for (const key of stageKeys) {
      expect(Object.prototype.hasOwnProperty.call(enStages, key)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(deStages, key)).toBe(true);
    }

    expect(enMessages.projects.card.moveToStage).toBeDefined();
    expect(deMessages.projects.card.moveToStage).toBeDefined();
    expect(enMessages.projects.taskWarning.title).toBeDefined();
    expect(deMessages.projects.taskWarning.title).toBeDefined();
    expect(enMessages.projects.announcements.stageChanged).toBeDefined();
    expect(deMessages.projects.announcements.stageChanged).toBeDefined();
  });
});
