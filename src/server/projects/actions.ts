'use server';

import 'server-only';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import {
  requireOwnerWebSession,
  extractBearerToken,
  ForbiddenError,
  type AuthContext,
} from '@/server/auth/guards';
import * as service from './service';
import {
  createProjectSchema,
  updateProjectSchema,
  transitionStageSchema,
  deleteProjectSchema,
  createShootSchema,
  updateShootSchema,
  deleteShootSchema,
  createShootLocationSchema,
  updateShootLocationSchema,
  deleteShootLocationSchema,
  createShootTimelineItemSchema,
  updateShootTimelineItemSchema,
  deleteShootTimelineItemSchema,
  createProjectParticipantSchema,
  deleteProjectParticipantSchema,
  createProjectTaskSchema,
  toggleProjectTaskSchema,
  deleteProjectTaskSchema,
} from './schema';

async function checkBearerRejection(): Promise<boolean> {
  try {
    const reqHeaders = await headers();
    if (extractBearerToken(reqHeaders)) {
      return true;
    }
  } catch {
    // headers() might throw outside Next.js request context
  }
  return false;
}

function safeRevalidate(path = '/projects'): void {
  try {
    revalidatePath(path);
  } catch {
    // Ignore in non-Next runtime or testing environments
  }
}

function formatValidationIssues(error: {
  issues: { message: string; path: (string | number)[] }[];
}): {
  error: string;
  fields: string[];
} {
  return {
    error: error.issues.map((i) => i.message).join(', ') || 'VALIDATION_FAILED',
    fields: error.issues.map((i) => i.path.join('.')),
  };
}

// --- Project Server Actions ---

export async function createProjectAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ projectId: string }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = createProjectSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.createProject(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
    safeRevalidate('/clients');
  }
  return result;
}

export async function updateProjectAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ project: unknown }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = updateProjectSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.updateProject(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
  }
  return result;
}

export async function deleteProjectAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ projectId: string }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = deleteProjectSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.deleteProject(parsed.data.projectId, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
  }
  return result;
}

export async function transitionProjectStageAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<
  service.ServiceResult<{
    projectId: string;
    stageId: string;
    stageKey: string;
    advisoryIncompleteTasks: {
      count: number;
      tasks: { id: string; title: string }[];
    };
  }>
> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = transitionStageSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.transitionProjectStage(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
    safeRevalidate('/clients');
  }
  return result;
}

// --- Shoot Server Actions ---

export async function createShootAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ shootId: string; shoot: unknown }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = createShootSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.createShoot(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
  }
  return result;
}

export async function updateShootAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ shoot: unknown }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = updateShootSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.updateShoot(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
  }
  return result;
}

export async function deleteShootAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ shootId: string }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = deleteShootSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.deleteShoot(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
  }
  return result;
}

// --- Shoot Location Server Actions ---

export async function createShootLocationAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ locationId: string; location: unknown }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = createShootLocationSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.createShootLocation(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
  }
  return result;
}

export async function updateShootLocationAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ location: unknown }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = updateShootLocationSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.updateShootLocation(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
  }
  return result;
}

export async function deleteShootLocationAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ locationId: string }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = deleteShootLocationSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.deleteShootLocation(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
  }
  return result;
}

// --- Shoot Timeline Item Server Actions ---

export async function createShootTimelineItemAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ itemId: string; item: unknown }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = createShootTimelineItemSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.createShootTimelineItem(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
  }
  return result;
}

export async function updateShootTimelineItemAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ item: unknown }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = updateShootTimelineItemSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.updateShootTimelineItem(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
  }
  return result;
}

export async function deleteShootTimelineItemAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ itemId: string }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = deleteShootTimelineItemSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.deleteShootTimelineItem(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
  }
  return result;
}

// --- Project Participant Server Actions ---

export async function createProjectParticipantAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ participantId: string; participant: unknown }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = createProjectParticipantSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.createProjectParticipant(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
  }
  return result;
}

export async function deleteProjectParticipantAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ participantId: string }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = deleteProjectParticipantSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.deleteProjectParticipant(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
  }
  return result;
}

// --- Project Task Server Actions ---

export async function createProjectTaskAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ taskId: string; task: unknown }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = createProjectTaskSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.createProjectTask(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
  }
  return result;
}

export async function toggleProjectTaskAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ task: unknown }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = toggleProjectTaskSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.toggleProjectTask(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
  }
  return result;
}

export async function deleteProjectTaskAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<service.ServiceResult<{ taskId: string }>> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  const parsed = deleteProjectTaskSchema.safeParse(rawInput);
  if (!parsed.success) {
    const formatted = formatValidationIssues(parsed.error);
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: formatted.error,
      fields: formatted.fields,
    };
  }

  const result = await service.deleteProjectTask(parsed.data, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/projects');
  }
  return result;
}
