import 'server-only';
import { eq, inArray, asc } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import {
  projects,
  shoots,
  shootLocations,
  shootTimelineItems,
  projectParticipants,
  projectTasks,
  pipelineStages,
} from '@/server/db/schema/projects';
import type { ExportProvider, ExportSubject } from '@/server/privacy/export/types';
import { escapeHtml } from '@/server/privacy/export/html';

/**
 * Localized table headers for DSAR HTML rendering per AC-8.
 */
export const PROJECT_EXPORT_HEADERS = {
  en: {
    project: 'Project',
    stage: 'Stage',
    shootDate: 'Shoot Date',
    locations: 'Locations',
    timeline: 'Timeline',
    tasks: 'Tasks',
    participants: 'Participants',
    role: 'Role',
  },
  de: {
    project: 'Projekt',
    stage: 'Phase',
    shootDate: 'Shooting-Datum',
    locations: 'Orte',
    timeline: 'Zeitplan',
    tasks: 'Aufgaben',
    participants: 'Teilnehmer',
    role: 'Rolle',
  },
} as const;

/**
 * Renders an accessible, localized HTML table for projects DSAR export.
 */
export function formatHtmlTable(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][],
  label = 'Projects',
): string {
  const thead = headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('');
  const tbody = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell ?? '-')}</td>`).join('')}</tr>`)
    .join('');

  return `<div class="table-wrapper" tabindex="0" role="region" aria-label="${escapeHtml(label)}">
  <table class="data-table">
    <thead>
      <tr>${thead}</tr>
    </thead>
    <tbody>
      ${tbody}
    </tbody>
  </table>
</div>`;
}

/**
 * DSAR Export provider for Epic E3 (projects, shoots, locations, timeline, tasks, participants).
 * Covers GDPR Art. 15 / Art. 20 data portability and access requests.
 */
export const projectsExportProvider: ExportProvider = {
  id: 'projects',
  category: 'projects',
  coveredTables: [
    'projects',
    'shoots',
    'shoot_locations',
    'shoot_timeline_items',
    'project_participants',
    'project_tasks',
  ] as const,
  subjectKinds: ['client', 'contact'] as const,

  collect: async (subject: ExportSubject, tx: DbClient): Promise<unknown[]> => {
    if (subject.kind === 'lead') {
      return [];
    }

    if (subject.kind === 'contact') {
      // Contact-level DSAR export (AC-6):
      // Fetches all projects where contactId is referenced in project_participants.
      const participantRows = await tx
        .select({
          participantId: projectParticipants.id,
          role: projectParticipants.role,
          isPrimary: projectParticipants.isPrimary,
          notes: projectParticipants.notes,
          createdAt: projectParticipants.createdAt,
          projectId: projects.id,
          projectTitle: projects.title,
          projectTypeKey: projects.projectTypeKey,
          stageName: pipelineStages.name,
        })
        .from(projectParticipants)
        .innerJoin(projects, eq(projectParticipants.projectId, projects.id))
        .leftJoin(pipelineStages, eq(projects.stageId, pipelineStages.id))
        .where(eq(projectParticipants.contactId, subject.contactId))
        .orderBy(asc(projectParticipants.createdAt));

      return participantRows.map((p) => ({
        project: p.projectTitle,
        project_title: p.projectTitle,
        role: p.role,
        is_primary: p.isPrimary,
        stage: p.stageName ?? 'Unknown',
        notes: p.notes ?? null,
        created_at: p.createdAt.toISOString(),
      }));
    }

    // Client-level DSAR export (AC-1, AC-8):
    // Fetches all projects for clientId including stages, shoots, locations, timeline items, tasks, and participants.
    const clientProjects = await tx
      .select({
        project: projects,
        stage: pipelineStages,
      })
      .from(projects)
      .leftJoin(pipelineStages, eq(projects.stageId, pipelineStages.id))
      .where(eq(projects.clientId, subject.clientId))
      .orderBy(asc(projects.createdAt));

    if (clientProjects.length === 0) {
      return [];
    }

    const projectIds = clientProjects.map((cp) => cp.project.id);

    // Fetch all shoots for these projects
    const allShoots = await tx
      .select()
      .from(shoots)
      .where(inArray(shoots.projectId, projectIds))
      .orderBy(asc(shoots.startsAt));

    const shootIds = allShoots.map((s) => s.id);

    // Fetch locations and timeline items if shoots exist
    const allLocations =
      shootIds.length > 0
        ? await tx
            .select()
            .from(shootLocations)
            .where(inArray(shootLocations.shootId, shootIds))
            .orderBy(asc(shootLocations.order))
        : [];

    const allTimelineItems =
      shootIds.length > 0
        ? await tx
            .select()
            .from(shootTimelineItems)
            .where(inArray(shootTimelineItems.shootId, shootIds))
            .orderBy(asc(shootTimelineItems.startsAt), asc(shootTimelineItems.order))
        : [];

    // Fetch tasks and participants
    const allTasks = await tx
      .select()
      .from(projectTasks)
      .where(inArray(projectTasks.projectId, projectIds))
      .orderBy(asc(projectTasks.order), asc(projectTasks.createdAt));

    const allParticipants = await tx
      .select()
      .from(projectParticipants)
      .where(inArray(projectParticipants.projectId, projectIds))
      .orderBy(asc(projectParticipants.isPrimary), asc(projectParticipants.createdAt));

    // Assemble structured output for each project
    return clientProjects.map(({ project, stage }) => {
      const projShoots = allShoots.filter((s) => s.projectId === project.id);
      const projShootIds = new Set(projShoots.map((s) => s.id));
      const projLocations = allLocations.filter((l) => projShootIds.has(l.shootId));
      const projTimelineItems = allTimelineItems.filter((t) => projShootIds.has(t.shootId));
      const projTasks = allTasks.filter((t) => t.projectId === project.id);
      const projParticipants = allParticipants.filter((p) => p.projectId === project.id);

      // Primary shoot date fallback
      const shootDate = project.primaryShootStartsAt
        ? project.primaryShootStartsAt.toISOString()
        : projShoots[0]?.startsAt
          ? projShoots[0].startsAt.toISOString()
          : null;

      // Summary strings for table columns (AC-1, AC-8)
      const locationsSummary =
        projLocations.length > 0
          ? projLocations
              .map((l) => [l.name, l.addressLine1, l.city].filter(Boolean).join(', '))
              .join('; ')
          : '-';

      const timelineSummary =
        projTimelineItems.length > 0
          ? projTimelineItems
              .map((ti) => `${ti.title} (${ti.startsAt.toISOString().slice(11, 16)})`)
              .join('; ')
          : '-';

      const tasksSummary =
        projTasks.length > 0
          ? projTasks.map((t) => `${t.title} [${t.isCompleted ? '✓' : ' '}]`).join('; ')
          : '-';

      const participantsSummary =
        projParticipants.length > 0
          ? projParticipants.map((p) => `${p.name ?? 'Contact'}: ${p.role}`).join('; ')
          : '-';

      return {
        // High-level human-readable columns matching AC-8 table headers
        project: project.title,
        stage: stage?.name ?? 'Unknown',
        shoot_date: shootDate ?? '-',
        locations: locationsSummary,
        timeline: timelineSummary,
        tasks: tasksSummary,
        participants: participantsSummary,

        // Complete machine-readable data for Art. 20 portability
        id: project.id,
        project_type: project.projectTypeKey,
        currency: project.currency,
        price_minor: project.priceMinor,
        notes: project.notes,
        created_at: project.createdAt.toISOString(),
        last_activity_at: project.lastActivityAt.toISOString(),

        shoots: projShoots.map((s) => ({
          id: s.id,
          title: s.title,
          starts_at: s.startsAt.toISOString(),
          ends_at: s.endsAt?.toISOString() ?? null,
          timezone: s.timezone,
          notes: s.notes,
          locations: projLocations
            .filter((l) => l.shootId === s.id)
            .map((l) => ({
              id: l.id,
              name: l.name,
              address_line1: l.addressLine1,
              address_line2: l.addressLine2,
              postal_code: l.postalCode,
              city: l.city,
              country_code: l.countryCode,
              notes: l.notes,
            })),
          timeline_items: projTimelineItems
            .filter((ti) => ti.shootId === s.id)
            .map((ti) => ({
              id: ti.id,
              title: ti.title,
              starts_at: ti.startsAt.toISOString(),
              ends_at: ti.endsAt?.toISOString() ?? null,
              description: ti.description,
            })),
        })),

        project_tasks: projTasks.map((t) => ({
          id: t.id,
          title: t.title,
          is_completed: t.isCompleted,
          completed_at: t.completedAt?.toISOString() ?? null,
          due_date: t.dueDate?.toISOString() ?? null,
        })),

        project_participants: projParticipants.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          phone: p.phone,
          role: p.role,
          is_primary: p.isPrimary,
          notes: p.notes,
        })),
      };
    });
  },
};
