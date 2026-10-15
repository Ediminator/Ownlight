import { eq } from 'drizzle-orm';
import { generateUuidV7 } from '@/lib/id';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { clients } from '@/server/db/schema/clients';
import {
  type Project,
  type PipelineStage,
  type Shoot,
  type ShootLocation,
  type ShootTimelineItem,
  type ProjectParticipant,
  type ProjectTask,
} from '@/server/db/schema/projects';
import {
  getInitialPipelineStage,
  getPipelineStageById,
  getPipelineStages,
  getStageTaskTemplates,
} from './stages';
import * as repo from './repo';
import {
  type CreateProjectInput,
  type UpdateProjectInput,
  type TransitionStageInput,
  type CreateShootInput,
  type UpdateShootInput,
  type DeleteShootInput,
  type CreateShootLocationInput,
  type UpdateShootLocationInput,
  type DeleteShootLocationInput,
  type CreateShootTimelineItemInput,
  type UpdateShootTimelineItemInput,
  type DeleteShootTimelineItemInput,
  type CreateProjectParticipantInput,
  type DeleteProjectParticipantInput,
  type CreateProjectTaskInput,
  type ToggleProjectTaskInput,
  type DeleteProjectTaskInput,
} from './schema';
import { recordTimelineEvent } from '@/server/timeline/service';
import { audit } from '@/server/audit';
import { logger } from '@/server/log';

export type ServiceResult<T> =
  { success: true; data: T } | { success: false; code: string; error: string; fields?: string[] };

// --- Project Operations ---

export async function createProject(
  input: CreateProjectInput,
  actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ projectId: string; project: Project }>> {
  // 1. Verify client exists
  const [client] = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, input.clientId))
    .limit(1);

  if (!client) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Client not found',
      fields: ['clientId'],
    };
  }

  // 2. Resolve pipeline stage
  let stageId = input.stageId;
  if (!stageId) {
    const initialStage = await getInitialPipelineStage(tx);
    if (!initialStage) {
      return {
        success: false,
        code: 'STAGE_NOT_FOUND',
        error: 'Initial pipeline stage not found',
      };
    }
    stageId = initialStage.id;
  } else {
    const stage = await getPipelineStageById(stageId, tx);
    if (!stage) {
      return {
        success: false,
        code: 'NOT_FOUND',
        error: 'Pipeline stage not found',
        fields: ['stageId'],
      };
    }
  }

  const now = new Date();
  const projectId = generateUuidV7();

  // 3. Create project record
  const project = await repo.insertProject(
    {
      id: projectId,
      clientId: input.clientId,
      stageId,
      title: input.title,
      projectTypeKey: input.projectTypeKey ?? 'general',
      currency: input.currency ?? 'EUR',
      priceMinor: input.priceMinor ?? null,
      notes: input.notes ?? null,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    },
    tx,
  );

  // 4. Instantiate default checklist tasks from stage_task_templates
  const templates = await getStageTaskTemplates(stageId, tx);
  for (const template of templates) {
    await repo.insertProjectTask(
      {
        id: generateUuidV7(),
        projectId: project.id,
        stageId,
        title: template.title,
        isCompleted: false,
        order: template.order,
        createdAt: now,
        updatedAt: now,
      },
      tx,
    );
  }

  // 5. If optional shoot date provided, create primary shoot
  if (input.shootStartsAt) {
    const shootId = generateUuidV7();
    const tz = input.shootTimezone ?? 'Europe/Berlin';
    await repo.insertShoot(
      {
        id: shootId,
        projectId: project.id,
        title: 'Main Shoot',
        startsAt: input.shootStartsAt,
        timezone: tz,
        createdAt: now,
        updatedAt: now,
      },
      tx,
    );

    await repo.updateProjectRecord(
      project.id,
      {
        primaryShootStartsAt: input.shootStartsAt,
        primaryShootTimezone: tz,
      },
      tx,
    );

    if (input.shootLocation && input.shootLocation.trim().length > 0) {
      await repo.insertShootLocation(
        {
          id: generateUuidV7(),
          shootId,
          name: input.shootLocation.trim(),
          order: 1,
          createdAt: now,
          updatedAt: now,
        },
        tx,
      );
    }
  }

  // 6. Emit project.created timeline event on client timeline
  await recordTimelineEvent(tx, {
    clientId: project.clientId,
    type: 'project.created',
    occurredAt: now,
    actorType: 'owner',
    actorId,
    subjectType: 'project',
    subjectId: project.id,
    data: {
      project_id: project.id,
      project_type: project.projectTypeKey,
    },
  });

  // 7. Emit project.created audit log event
  await audit(
    {
      action: 'project.created',
      actorType: 'owner',
      actorId,
      targetType: 'project',
      targetId: project.id,
      outcome: 'success',
      metadata: {
        project_id: project.id,
        client_id: project.clientId,
        project_type: project.projectTypeKey,
        stage_id: project.stageId,
        lead_id: project.leadId ?? null,
      },
    },
    tx,
  );

  logger.info(
    { projectId: project.id, clientId: project.clientId },
    'Project created successfully',
  );

  return {
    success: true,
    data: {
      projectId: project.id,
      project,
    },
  };
}

export async function updateProject(
  input: UpdateProjectInput,
  actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ project: Project }>> {
  const existing = await repo.findProjectById(input.projectId, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Project not found',
      fields: ['projectId'],
    };
  }

  if (input.stageId) {
    const stage = await getPipelineStageById(input.stageId, tx);
    if (!stage) {
      return {
        success: false,
        code: 'NOT_FOUND',
        error: 'Pipeline stage not found',
        fields: ['stageId'],
      };
    }
  }

  const now = new Date();
  const changedFields: string[] = [];
  const updateData: Partial<typeof existing> = {
    lastActivityAt: now,
    updatedAt: now,
  };

  if (input.title !== undefined) {
    updateData.title = input.title;
    changedFields.push('title');
  }
  if (input.projectTypeKey !== undefined) {
    updateData.projectTypeKey = input.projectTypeKey;
    changedFields.push('projectTypeKey');
  }
  if (input.stageId !== undefined) {
    updateData.stageId = input.stageId;
    changedFields.push('stageId');
  }
  if (input.priceMinor !== undefined) {
    updateData.priceMinor = input.priceMinor;
    changedFields.push('priceMinor');
  }
  if (input.currency !== undefined) {
    updateData.currency = input.currency;
    changedFields.push('currency');
  }
  if (input.notes !== undefined) {
    updateData.notes = input.notes;
    changedFields.push('notes');
  }

  const updated = await repo.updateProjectRecord(input.projectId, updateData, tx);
  if (!updated) {
    return {
      success: false,
      code: 'UPDATE_FAILED',
      error: 'Failed to update project',
    };
  }

  // Update client lastActivityAt
  await tx
    .update(clients)
    .set({ lastActivityAt: now, updatedAt: now })
    .where(eq(clients.id, updated.clientId));

  // Audit event: project.updated
  await audit(
    {
      action: 'project.updated',
      actorType: 'owner',
      actorId,
      targetType: 'project',
      targetId: updated.id,
      outcome: 'success',
      metadata: {
        project_id: updated.id,
        changed_fields: changedFields,
      },
    },
    tx,
  );

  return {
    success: true,
    data: { project: updated },
  };
}

export async function deleteProject(
  projectId: string,
  actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ projectId: string }>> {
  const existing = await repo.findProjectById(projectId, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Project not found',
      fields: ['projectId'],
    };
  }

  const deleted = await repo.deleteProjectRecord(projectId, tx);
  if (!deleted) {
    return {
      success: false,
      code: 'DELETE_FAILED',
      error: 'Failed to delete project',
    };
  }

  // Audit event: project.deleted
  await audit(
    {
      action: 'project.deleted',
      actorType: 'owner',
      actorId,
      targetType: 'project',
      targetId: projectId,
      outcome: 'success',
      metadata: {
        project_id: projectId,
        client_id: existing.clientId,
      },
    },
    tx,
  );

  return {
    success: true,
    data: { projectId },
  };
}

export async function transitionProjectStage(
  input: TransitionStageInput,
  actorId: string,
  dbClient: DbClient = defaultDb,
): Promise<
  ServiceResult<{
    projectId: string;
    stageId: string;
    stageKey: string;
    advisoryIncompleteTasks: {
      count: number;
      tasks: { id: string; title: string }[];
    };
  }>
> {
  return await dbClient.transaction(async (tx) => {
    // 1. Fetch project
    const project = await repo.findProjectById(input.projectId, tx);
    if (!project) {
      return {
        success: false,
        code: 'NOT_FOUND',
        error: 'Project not found',
        fields: ['projectId'],
      };
    }

    // 2. Fetch target stage
    const toStage = await getPipelineStageById(input.targetStageId, tx);
    if (!toStage) {
      return {
        success: false,
        code: 'NOT_FOUND',
        error: 'Target stage not found',
        fields: ['targetStageId'],
      };
    }

    // 3. Fetch current stage
    const fromStage = await getPipelineStageById(project.stageId, tx);

    // 4. Inspect incomplete tasks for current stage
    const incompleteTasks = await repo.findIncompleteTasksByStage(project.id, project.stageId, tx);

    const now = new Date();

    // 5. Update project stage and activity timestamp
    await repo.updateProjectRecord(
      project.id,
      {
        stageId: toStage.id,
        lastActivityAt: now,
        updatedAt: now,
      },
      tx,
    );

    // 6. Update parent client activity timestamp
    await tx
      .update(clients)
      .set({
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(clients.id, project.clientId));

    // 7. Emit timeline event: project.stage_changed
    await recordTimelineEvent(tx, {
      clientId: project.clientId,
      type: 'project.stage_changed',
      occurredAt: now,
      actorType: 'owner',
      actorId,
      subjectType: 'project',
      subjectId: project.id,
      data: {
        project_id: project.id,
        from_stage: fromStage?.key ?? 'unknown',
        to_stage: toStage.key,
      },
    });

    // 8. Emit audit log event: project.stage_changed
    await audit(
      {
        action: 'project.stage_changed',
        actorType: 'owner',
        actorId,
        targetType: 'project',
        targetId: project.id,
        outcome: 'success',
        metadata: {
          project_id: project.id,
          from_stage_id: fromStage?.id ?? project.stageId,
          to_stage_id: toStage.id,
          from_stage: fromStage?.key ?? 'unknown',
          to_stage: toStage.key,
        },
      },
      tx,
    );

    return {
      success: true,
      data: {
        projectId: project.id,
        stageId: toStage.id,
        stageKey: toStage.key,
        advisoryIncompleteTasks: {
          count: incompleteTasks.length,
          tasks: incompleteTasks.map((t) => ({ id: t.id, title: t.title })),
        },
      },
    };
  });
}

// --- Shoot Operations ---

export async function createShoot(
  input: CreateShootInput,
  actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ shootId: string; shoot: Shoot }>> {
  const project = await repo.findProjectById(input.projectId, tx);
  if (!project) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Project not found',
      fields: ['projectId'],
    };
  }

  const now = new Date();
  const shootId = generateUuidV7();
  const shoot = await repo.insertShoot(
    {
      id: shootId,
      projectId: input.projectId,
      title: input.title ?? 'Shoot',
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      timezone: input.timezone ?? 'Europe/Berlin',
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    },
    tx,
  );

  if (input.location && input.location.trim().length > 0) {
    await repo.insertShootLocation(
      {
        id: generateUuidV7(),
        shootId: shoot.id,
        name: input.location.trim(),
        order: 1,
        createdAt: now,
        updatedAt: now,
      },
      tx,
    );
  }

  // Recalculate denormalized primary shoot starts_at
  await repo.recalculatePrimaryShoot(project.id, tx);
  await repo.updateProjectRecord(project.id, { lastActivityAt: now }, tx);

  // Emit shoot.scheduled timeline event
  await recordTimelineEvent(tx, {
    clientId: project.clientId,
    type: 'shoot.scheduled',
    occurredAt: now,
    actorType: 'owner',
    actorId,
    subjectType: 'shoot',
    subjectId: shoot.id,
    data: {
      project_id: project.id,
      shoot_id: shoot.id,
      starts_at: shoot.startsAt.toISOString(),
    },
  });

  // Emit shoot.created audit event
  await audit(
    {
      action: 'shoot.created',
      actorType: 'owner',
      actorId,
      targetType: 'shoot',
      targetId: shoot.id,
      outcome: 'success',
      metadata: {
        shoot_id: shoot.id,
        project_id: project.id,
        starts_at: shoot.startsAt.toISOString(),
      },
    },
    tx,
  );

  return {
    success: true,
    data: {
      shootId: shoot.id,
      shoot,
    },
  };
}

export async function updateShoot(
  input: UpdateShootInput,
  actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ shoot: Shoot }>> {
  const existing = await repo.findShootById(input.shootId, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Shoot not found',
      fields: ['shootId'],
    };
  }

  const now = new Date();
  const changedFields: string[] = [];
  const updateData: Partial<typeof existing> = {
    updatedAt: now,
  };

  if (input.title !== undefined) {
    updateData.title = input.title;
    changedFields.push('title');
  }
  if (input.startsAt !== undefined) {
    updateData.startsAt = input.startsAt;
    changedFields.push('startsAt');
  }
  if (input.endsAt !== undefined) {
    updateData.endsAt = input.endsAt;
    changedFields.push('endsAt');
  }
  if (input.timezone !== undefined) {
    updateData.timezone = input.timezone;
    changedFields.push('timezone');
  }
  if (input.notes !== undefined) {
    updateData.notes = input.notes;
    changedFields.push('notes');
  }

  const updated = await repo.updateShootRecord(input.shootId, updateData, tx);
  if (!updated) {
    return {
      success: false,
      code: 'UPDATE_FAILED',
      error: 'Failed to update shoot',
    };
  }

  if (input.startsAt !== undefined || input.timezone !== undefined) {
    await repo.recalculatePrimaryShoot(existing.projectId, tx);
  }

  await repo.updateProjectRecord(existing.projectId, { lastActivityAt: now }, tx);

  // Emit shoot.updated audit event
  await audit(
    {
      action: 'shoot.updated',
      actorType: 'owner',
      actorId,
      targetType: 'shoot',
      targetId: updated.id,
      outcome: 'success',
      metadata: {
        shoot_id: updated.id,
        project_id: updated.projectId,
        changed_fields: changedFields,
      },
    },
    tx,
  );

  return {
    success: true,
    data: { shoot: updated },
  };
}

export async function deleteShoot(
  input: DeleteShootInput,
  actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ shootId: string }>> {
  const existing = await repo.findShootById(input.shootId, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Shoot not found',
      fields: ['shootId'],
    };
  }

  const deleted = await repo.deleteShootRecord(input.shootId, tx);
  if (!deleted) {
    return {
      success: false,
      code: 'DELETE_FAILED',
      error: 'Failed to delete shoot',
    };
  }

  await repo.recalculatePrimaryShoot(existing.projectId, tx);
  await repo.updateProjectRecord(existing.projectId, { lastActivityAt: new Date() }, tx);

  // Emit shoot.deleted audit event
  await audit(
    {
      action: 'shoot.deleted',
      actorType: 'owner',
      actorId,
      targetType: 'shoot',
      targetId: input.shootId,
      outcome: 'success',
      metadata: {
        shoot_id: input.shootId,
        project_id: existing.projectId,
      },
    },
    tx,
  );

  return {
    success: true,
    data: { shootId: input.shootId },
  };
}

// --- Shoot Locations Operations ---

export async function createShootLocation(
  input: CreateShootLocationInput,
  _actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ locationId: string; location: ShootLocation }>> {
  const shoot = await repo.findShootById(input.shootId, tx);
  if (!shoot) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Shoot not found',
      fields: ['shootId'],
    };
  }

  const now = new Date();
  const location = await repo.insertShootLocation(
    {
      id: generateUuidV7(),
      shootId: input.shootId,
      name: input.name,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      postalCode: input.postalCode ?? null,
      city: input.city ?? null,
      countryCode: input.countryCode ?? null,
      notes: input.notes ?? null,
      order: input.order ?? 1,
      createdAt: now,
      updatedAt: now,
    },
    tx,
  );

  return {
    success: true,
    data: {
      locationId: location.id,
      location,
    },
  };
}

export async function updateShootLocation(
  input: UpdateShootLocationInput,
  _actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ location: ShootLocation }>> {
  const existing = await repo.findShootLocationById(input.locationId, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Shoot location not found',
      fields: ['locationId'],
    };
  }

  const updateData: Partial<typeof existing> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.addressLine1 !== undefined) updateData.addressLine1 = input.addressLine1;
  if (input.addressLine2 !== undefined) updateData.addressLine2 = input.addressLine2;
  if (input.postalCode !== undefined) updateData.postalCode = input.postalCode;
  if (input.city !== undefined) updateData.city = input.city;
  if (input.countryCode !== undefined) updateData.countryCode = input.countryCode;
  if (input.notes !== undefined) updateData.notes = input.notes;
  if (input.order !== undefined) updateData.order = input.order;

  const updated = await repo.updateShootLocationRecord(input.locationId, updateData, tx);
  if (!updated) {
    return {
      success: false,
      code: 'UPDATE_FAILED',
      error: 'Failed to update shoot location',
    };
  }

  return {
    success: true,
    data: { location: updated },
  };
}

export async function deleteShootLocation(
  input: DeleteShootLocationInput,
  _actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ locationId: string }>> {
  const existing = await repo.findShootLocationById(input.locationId, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Shoot location not found',
      fields: ['locationId'],
    };
  }

  await repo.deleteShootLocationRecord(input.locationId, tx);

  return {
    success: true,
    data: { locationId: input.locationId },
  };
}

// --- Shoot Timeline Item Operations ---

export async function createShootTimelineItem(
  input: CreateShootTimelineItemInput,
  _actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ itemId: string; item: ShootTimelineItem }>> {
  const shoot = await repo.findShootById(input.shootId, tx);
  if (!shoot) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Shoot not found',
      fields: ['shootId'],
    };
  }

  if (input.locationId) {
    const location = await repo.findShootLocationById(input.locationId, tx);
    if (!location) {
      return {
        success: false,
        code: 'NOT_FOUND',
        error: 'Shoot location not found',
        fields: ['locationId'],
      };
    }
  }

  const now = new Date();
  const item = await repo.insertShootTimelineItem(
    {
      id: generateUuidV7(),
      shootId: input.shootId,
      locationId: input.locationId ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      title: input.title,
      description: input.description ?? null,
      order: input.order ?? 1,
      createdAt: now,
      updatedAt: now,
    },
    tx,
  );

  return {
    success: true,
    data: {
      itemId: item.id,
      item,
    },
  };
}

export async function updateShootTimelineItem(
  input: UpdateShootTimelineItemInput,
  _actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ item: ShootTimelineItem }>> {
  const existing = await repo.findShootTimelineItemById(input.itemId, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Shoot timeline item not found',
      fields: ['itemId'],
    };
  }

  if (input.locationId) {
    const location = await repo.findShootLocationById(input.locationId, tx);
    if (!location) {
      return {
        success: false,
        code: 'NOT_FOUND',
        error: 'Shoot location not found',
        fields: ['locationId'],
      };
    }
  }

  const updateData: Partial<typeof existing> = {};
  if (input.locationId !== undefined) updateData.locationId = input.locationId;
  if (input.startsAt !== undefined) updateData.startsAt = input.startsAt;
  if (input.endsAt !== undefined) updateData.endsAt = input.endsAt;
  if (input.title !== undefined) updateData.title = input.title;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.order !== undefined) updateData.order = input.order;

  const updated = await repo.updateShootTimelineItemRecord(input.itemId, updateData, tx);
  if (!updated) {
    return {
      success: false,
      code: 'UPDATE_FAILED',
      error: 'Failed to update shoot timeline item',
    };
  }

  return {
    success: true,
    data: { item: updated },
  };
}

export async function deleteShootTimelineItem(
  input: DeleteShootTimelineItemInput,
  _actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ itemId: string }>> {
  const existing = await repo.findShootTimelineItemById(input.itemId, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Shoot timeline item not found',
      fields: ['itemId'],
    };
  }

  await repo.deleteShootTimelineItemRecord(input.itemId, tx);

  return {
    success: true,
    data: { itemId: input.itemId },
  };
}

// --- Project Participants Operations ---

export async function createProjectParticipant(
  input: CreateProjectParticipantInput,
  _actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ participantId: string; participant: ProjectParticipant }>> {
  const project = await repo.findProjectById(input.projectId, tx);
  if (!project) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Project not found',
      fields: ['projectId'],
    };
  }

  const now = new Date();
  const participant = await repo.insertProjectParticipant(
    {
      id: generateUuidV7(),
      projectId: input.projectId,
      contactId: input.contactId ?? null,
      name: input.name ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      role: input.role,
      isPrimary: input.isPrimary ?? false,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    },
    tx,
  );

  return {
    success: true,
    data: {
      participantId: participant.id,
      participant,
    },
  };
}

export async function deleteProjectParticipant(
  input: DeleteProjectParticipantInput,
  _actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ participantId: string }>> {
  const existing = await repo.findProjectParticipantById(input.participantId, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Project participant not found',
      fields: ['participantId'],
    };
  }

  await repo.deleteProjectParticipantRecord(input.participantId, tx);

  return {
    success: true,
    data: { participantId: input.participantId },
  };
}

// --- Project Tasks Operations ---

export async function createProjectTask(
  input: CreateProjectTaskInput,
  _actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ taskId: string; task: ProjectTask }>> {
  const project = await repo.findProjectById(input.projectId, tx);
  if (!project) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Project not found',
      fields: ['projectId'],
    };
  }

  if (input.stageId) {
    const stage = await getPipelineStageById(input.stageId, tx);
    if (!stage) {
      return {
        success: false,
        code: 'NOT_FOUND',
        error: 'Pipeline stage not found',
        fields: ['stageId'],
      };
    }
  }

  const now = new Date();
  const task = await repo.insertProjectTask(
    {
      id: generateUuidV7(),
      projectId: input.projectId,
      stageId: input.stageId ?? null,
      title: input.title,
      isCompleted: false,
      dueDate: input.dueDate ?? null,
      order: input.order ?? 1,
      createdAt: now,
      updatedAt: now,
    },
    tx,
  );

  return {
    success: true,
    data: {
      taskId: task.id,
      task,
    },
  };
}

export async function toggleProjectTask(
  input: ToggleProjectTaskInput,
  _actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ task: ProjectTask }>> {
  const existing = await repo.findProjectTaskById(input.taskId, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Project task not found',
      fields: ['taskId'],
    };
  }

  const now = new Date();
  const newCompleted = !existing.isCompleted;
  const completedAt = newCompleted ? now : null;

  const updated = await repo.updateProjectTaskRecord(
    input.taskId,
    {
      isCompleted: newCompleted,
      completedAt,
      updatedAt: now,
    },
    tx,
  );

  if (!updated) {
    return {
      success: false,
      code: 'UPDATE_FAILED',
      error: 'Failed to toggle project task',
    };
  }

  return {
    success: true,
    data: { task: updated },
  };
}

export async function deleteProjectTask(
  input: DeleteProjectTaskInput,
  _actorId: string,
  tx: DbClient = defaultDb,
): Promise<ServiceResult<{ taskId: string }>> {
  const existing = await repo.findProjectTaskById(input.taskId, tx);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Project task not found',
      fields: ['taskId'],
    };
  }

  await repo.deleteProjectTaskRecord(input.taskId, tx);

  return {
    success: true,
    data: { taskId: input.taskId },
  };
}

// --- Kanban Board Operations (TASK-0036) ---

export interface KanbanProject {
  id: string;
  title: string;
  clientId: string;
  clientDisplayName: string;
  stageId: string;
  stageKey: string;
  projectTypeKey: string;
  primaryShootStartsAt: string | null;
  primaryShootTimezone: string | null;
  primaryShootLocationName: string | null;
  currency: string;
  priceMinor: number | null;
  taskCount: number;
  completedTaskCount: number;
  incompleteTasks: {
    id: string;
    title: string;
    stageId: string | null;
  }[];
  lastActivityAt: string;
}

export interface KanbanBoardData {
  stages: PipelineStage[];
  projects: KanbanProject[];
}

export async function getKanbanBoardData(tx: DbClient = defaultDb): Promise<KanbanBoardData> {
  const [stages, projectRows, allTasks, locationRows] = await Promise.all([
    getPipelineStages(tx),
    repo.findKanbanProjects(tx),
    repo.findAllProjectTasks(tx),
    repo.findAllPrimaryShootLocations(tx),
  ]);

  const stageMap = new Map<string, PipelineStage>(stages.map((s) => [s.id, s]));

  const locationMap = new Map<string, string>();
  for (const loc of locationRows) {
    if (!locationMap.has(loc.projectId)) {
      locationMap.set(loc.projectId, loc.locationName);
    }
  }

  const tasksByProject = new Map<string, typeof allTasks>();
  for (const t of allTasks) {
    let list = tasksByProject.get(t.projectId);
    if (!list) {
      list = [];
      tasksByProject.set(t.projectId, list);
    }
    list.push(t);
  }

  const kanbanProjects: KanbanProject[] = projectRows.map((p) => {
    const pTasks = tasksByProject.get(p.id) ?? [];
    const taskCount = pTasks.length;
    const completedTaskCount = pTasks.filter((t) => t.isCompleted).length;
    const incompleteTasks = pTasks
      .filter((t) => !t.isCompleted)
      .map((t) => ({
        id: t.id,
        title: t.title,
        stageId: t.stageId,
      }));

    const stage = stageMap.get(p.stageId);

    return {
      id: p.id,
      title: p.title,
      clientId: p.clientId,
      clientDisplayName: p.clientDisplayName,
      stageId: p.stageId,
      stageKey: stage?.key ?? 'inquiry',
      projectTypeKey: p.projectTypeKey,
      primaryShootStartsAt: p.primaryShootStartsAt ? p.primaryShootStartsAt.toISOString() : null,
      primaryShootTimezone: p.primaryShootTimezone,
      primaryShootLocationName: locationMap.get(p.id) ?? null,
      currency: p.currency,
      priceMinor: p.priceMinor,
      taskCount,
      completedTaskCount,
      incompleteTasks,
      lastActivityAt: p.lastActivityAt.toISOString(),
    };
  });

  return {
    stages,
    projects: kanbanProjects,
  };
}
