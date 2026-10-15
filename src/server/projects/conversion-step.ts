import { eq, and } from 'drizzle-orm';
import { generateUuidV7 } from '@/lib/id';
import type { DbClient } from '@/server/db/client';
import type { Lead } from '@/server/db/schema/leads';
import { inquiryForms } from '@/server/db/schema/inquiry-forms';
import { clients, clientContacts } from '@/server/db/schema/clients';
import {
  projects,
  shoots,
  shootLocations,
  projectParticipants,
  projectTasks,
} from '@/server/db/schema/projects';
import { getInitialPipelineStage, getStageTaskTemplates } from './stages';
import { registerLeadConversionStep } from '@/server/leads/conversion-steps';
import { recordTimelineEvent } from '@/server/timeline/service';
import { audit } from '@/server/audit';
import { logger } from '@/server/log';

export const PROJECT_LEAD_CONVERSION_STEP_ID = 'create-project-on-lead-conversion';

/**
 * Handles automatic project creation when an inquiry lead matures and is converted to a client.
 * Executed atomically within the lead conversion transaction (ADR-0015 §8, ADR-0016 §3, TASK-0034).
 */
export async function createProjectOnLeadConversion(
  lead: Lead,
  clientId: string,
  tx: DbClient,
): Promise<{ projectId: string; projectTitle: string }> {
  const now = new Date();

  // 1. Resolve event type label from inquiry form or key
  let eventTypeLabel: string | undefined;
  if (lead.eventTypeKey && lead.eventTypeKey.trim().length > 0) {
    if (lead.formId) {
      const [formRow] = await tx
        .select({ eventTypes: inquiryForms.eventTypes })
        .from(inquiryForms)
        .where(eq(inquiryForms.id, lead.formId))
        .limit(1);

      if (formRow?.eventTypes && Array.isArray(formRow.eventTypes)) {
        const matched = formRow.eventTypes.find((et) => et.key === lead.eventTypeKey);
        if (matched) {
          eventTypeLabel = lead.locale === 'de' ? matched.label_de : matched.label_en;
        }
      }
    }
    eventTypeLabel ??= lead.eventTypeKey.charAt(0).toUpperCase() + lead.eventTypeKey.slice(1);
  }

  // 2. Derive project title: "${lead.givenName} ${lead.familyName} - ${eventTypeLabel}" (fallback: "${client.displayName} - Project")
  const leadFullName = [lead.givenName, lead.familyName].filter(Boolean).join(' ').trim();
  let clientDisplayName = 'Client';
  const [clientRow] = await tx
    .select({ displayName: clients.displayName })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (clientRow?.displayName) {
    clientDisplayName = clientRow.displayName;
  }

  let projectTitle: string;
  if (leadFullName && eventTypeLabel) {
    projectTitle = `${leadFullName} - ${eventTypeLabel}`;
  } else if (leadFullName) {
    projectTitle = `${leadFullName} - Project`;
  } else if (eventTypeLabel) {
    projectTitle = `${clientDisplayName} - ${eventTypeLabel}`;
  } else {
    projectTitle = `${clientDisplayName} - Project`;
  }

  if (projectTitle.length > 200) {
    projectTitle = projectTitle.slice(0, 200);
  }

  // 3. Map lead.eventTypeKey to project_type_key (fallback: 'general')
  const projectTypeKey =
    lead.eventTypeKey && lead.eventTypeKey.trim().length > 0
      ? lead.eventTypeKey.trim().toLowerCase().slice(0, 40)
      : 'general';

  // 4. Query initial stage (position = 1, key 'inquiry')
  const initialStage = await getInitialPipelineStage(tx);
  if (!initialStage) {
    throw new Error('Initial pipeline stage not found.');
  }

  // 5. Create projects record
  const projectId = generateUuidV7();
  await tx.insert(projects).values({
    id: projectId,
    clientId,
    stageId: initialStage.id,
    title: projectTitle,
    projectTypeKey,
    leadId: lead.id,
    currency: 'EUR',
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  });

  // 6. If lead.eventDate is present, parse into UTC timestamptz and create primary shoot
  let shootStartsAt: Date | null = null;
  if (lead.eventDate && lead.eventDate.trim().length > 0) {
    const trimmed = lead.eventDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const d = new Date(`${trimmed}T00:00:00.000Z`);
      if (!isNaN(d.getTime())) shootStartsAt = d;
    } else {
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) shootStartsAt = d;
    }
  }

  if (shootStartsAt) {
    const shootId = generateUuidV7();
    await tx.insert(shoots).values({
      id: shootId,
      projectId,
      title: 'Main Shoot',
      startsAt: shootStartsAt,
      timezone: 'Europe/Berlin',
      createdAt: now,
      updatedAt: now,
    });

    await tx
      .update(projects)
      .set({
        primaryShootStartsAt: shootStartsAt,
        primaryShootTimezone: 'Europe/Berlin',
        updatedAt: now,
      })
      .where(eq(projects.id, projectId));

    // If lead.eventLocation is present, create shoot_locations record linked to the shoot
    if (lead.eventLocation && lead.eventLocation.trim().length > 0) {
      await tx.insert(shootLocations).values({
        id: generateUuidV7(),
        shootId,
        name: lead.eventLocation.trim().slice(0, 200),
        order: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // 7. Resolve client primary contact and add as primary participant
  const [primaryContact] = await tx
    .select()
    .from(clientContacts)
    .where(and(eq(clientContacts.clientId, clientId), eq(clientContacts.isPrimary, true)))
    .limit(1);

  if (primaryContact) {
    const contactFullName = [primaryContact.givenName, primaryContact.familyName]
      .filter(Boolean)
      .join(' ')
      .trim();

    await tx.insert(projectParticipants).values({
      id: generateUuidV7(),
      projectId,
      contactId: primaryContact.id,
      name: (contactFullName || clientDisplayName).slice(0, 200),
      email: primaryContact.email ?? null,
      phone: primaryContact.phone ?? null,
      role: 'Client',
      isPrimary: true,
      createdAt: now,
      updatedAt: now,
    });
  } else if (leadFullName) {
    await tx.insert(projectParticipants).values({
      id: generateUuidV7(),
      projectId,
      contactId: null,
      name: leadFullName.slice(0, 200),
      email: lead.email ?? null,
      phone: lead.phone ?? null,
      role: 'Client',
      isPrimary: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 8. Copy default stage tasks from stage_task_templates for initial stage
  const templates = await getStageTaskTemplates(initialStage.id, tx);
  for (const template of templates) {
    await tx.insert(projectTasks).values({
      id: generateUuidV7(),
      projectId,
      stageId: initialStage.id,
      title: template.title,
      isCompleted: false,
      order: template.order,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 9. Emit project.created timeline event on client relationship timeline
  await recordTimelineEvent(tx, {
    clientId,
    type: 'project.created',
    occurredAt: now,
    actorType: 'owner',
    actorId: 'system',
    subjectType: 'project',
    subjectId: projectId,
    data: {
      project_id: projectId,
      project_type: projectTypeKey,
    },
  });

  // 10. Emit project.created audit log event
  await audit(
    {
      action: 'project.created',
      actorType: 'owner',
      actorId: 'system',
      targetType: 'project',
      targetId: projectId,
      outcome: 'success',
      metadata: {
        project_id: projectId,
        client_id: clientId,
        project_type: projectTypeKey,
        stage_id: initialStage.id,
        lead_id: lead.id,
      },
    },
    tx,
  );

  logger.info(
    {
      projectId,
      clientId,
      leadId: lead.id,
      projectTypeKey,
      stageId: initialStage.id,
    },
    'Project atomically created from lead conversion',
  );

  return { projectId, projectTitle };
}

/**
 * Registers the project creation step with the lead conversion lifecycle.
 */
export function registerProjectLeadConversionStep(): void {
  registerLeadConversionStep({
    id: PROJECT_LEAD_CONVERSION_STEP_ID,
    run: (lead: Lead, clientId: string, tx: DbClient) =>
      createProjectOnLeadConversion(lead, clientId, tx),
  });
}

// Automatically register at module load
registerProjectLeadConversionStep();
