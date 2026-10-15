'use server';

import 'server-only';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import {
  requireOwnerSession,
  requireOwnerWebSession,
  extractBearerToken,
  ForbiddenError,
  type AuthContext,
} from '@/server/auth/guards';
import { assertFreshReauthentication } from '@/server/auth/reauth';
import { generateExport } from '@/server/privacy/export/service';
import { changeLeadStatus, deleteLeads, deleteAllSpamLeads } from './service';
import { getLeadCounts, getLeadById } from './repo';
import { convertLeadToClient } from './convert';
import { findDuplicateEmails, type DuplicateEmailMatch } from '@/server/clients/repo';
import {
  changeLeadStatusActionInputSchema,
  deleteLeadsActionInputSchema,
  exportLeadDsarActionInputSchema,
  convertLeadToClientActionInputSchema,
  getLeadDuplicatesActionInputSchema,
  type LeadCounts,
} from './schema';
import type { Lead, LeadStatus } from '@/server/db/schema/leads';

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

function safeRevalidate(path = '/leads'): void {
  try {
    revalidatePath(path);
  } catch {
    // Ignore in non-Next runtime or testing environments
  }
}

/**
 * Changes lead status according to ADR-0015 §6 transition table.
 * Requires active owner web session; API keys rejected with UNAUTHORIZED (AC-3, AC-10).
 */
export async function changeLeadStatusAction(
  rawInput: unknown,
  secondArgOrClient?: LeadStatus | DbClient,
  thirdArgClient?: DbClient,
): Promise<
  | ({ success: true; data: Lead } & Lead)
  | { success: false; code: string; error: string; fields?: string[] }
> {
  let client: DbClient = defaultDb;
  let parsedInput: { leadId: string; targetStatus: LeadStatus } | null = null;

  if (typeof rawInput === 'string' && typeof secondArgOrClient === 'string') {
    parsedInput = { leadId: rawInput, targetStatus: secondArgOrClient };
    if (thirdArgClient) client = thirdArgClient;
  } else {
    if (
      secondArgOrClient &&
      typeof secondArgOrClient === 'object' &&
      !('targetStatus' in secondArgOrClient)
    ) {
      client = secondArgOrClient;
    }
    const candidate =
      rawInput && typeof rawInput === 'object' && 'toStatus' in rawInput
        ? {
            leadId: (rawInput as Record<string, unknown>).leadId,
            targetStatus: (rawInput as Record<string, unknown>).toStatus,
          }
        : rawInput;

    const parsed = changeLeadStatusActionInputSchema.safeParse(candidate);
    if (!parsed.success) {
      return {
        success: false,
        code: 'VALIDATION_FAILED',
        error: parsed.error.issues.map((i) => i.message).join(', ') || 'VALIDATION_FAILED',
        fields: parsed.error.issues.map((i) => i.path.join('.')),
      };
    }
    parsedInput = parsed.data;
  }

  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  const result = await changeLeadStatus(
    parsedInput.leadId,
    parsedInput.targetStatus,
    auth.user.id,
    client,
  );
  if (result.success) {
    safeRevalidate('/leads');
  }

  return result;
}

/**
 * Hard-deletes non-converted leads or all spam leads (routine inbox hygiene, AC-4, AC-5, AC-6).
 * Requires active owner web session; API keys rejected with UNAUTHORIZED (AC-10).
 */
export async function deleteLeadsAction(
  rawInput: unknown,
  clientOrActor?: DbClient,
): Promise<
  | { success: true; count: number; data: { count: number } }
  | { success: false; code: string; error: string; fields?: string[] }
> {
  const client: DbClient = clientOrActor ?? defaultDb;

  let leadIds: string[] = [];
  let deleteAllSpam = false;

  if (Array.isArray(rawInput)) {
    leadIds = rawInput as string[];
  } else if (typeof rawInput === 'string') {
    leadIds = [rawInput];
  } else if (rawInput && typeof rawInput === 'object') {
    const obj = rawInput as Record<string, unknown>;
    if (obj.deleteAllSpam === true) {
      deleteAllSpam = true;
    } else if (Array.isArray(obj.leadIds)) {
      leadIds = obj.leadIds as string[];
    } else if (typeof obj.leadId === 'string') {
      leadIds = [obj.leadId];
    }
  }

  const parsed = deleteLeadsActionInputSchema.safeParse({ leadIds, deleteAllSpam });
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues.map((i) => i.message).join(', ') || 'VALIDATION_FAILED',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  if (deleteAllSpam) {
    const result = await deleteAllSpamLeads(auth.user.id, client);
    safeRevalidate('/leads');
    return result;
  }

  const result = await deleteLeads(leadIds, auth.user.id, client);
  if (result.success) {
    safeRevalidate('/leads');
  }

  return result;
}

/**
 * Generates and returns a DSAR personal data export bundle for a lead subject (AC-8).
 * Requires active owner web session with fresh step-up re-authentication (<= 5 minutes).
 */
export async function exportLeadDsarAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<
  | {
      success: true;
      data: {
        content: string;
        filename: string;
        contentType: string;
        downloadUrl: string;
        exportData: unknown;
      };
      content: string;
      filename: string;
      contentType: string;
      downloadUrl: string;
    }
  | { success: false; code: string; error: string; fields?: string[] }
> {
  let candidate = rawInput;
  if (typeof rawInput === 'string') {
    candidate = { leadId: rawInput };
  }

  const parsed = exportLeadDsarActionInputSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues.map((i) => i.message).join(', ') || 'VALIDATION_FAILED',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  // Enforce fresh step-up re-authentication (<= 5 minutes freshness, AC-8)
  try {
    await assertFreshReauthentication(auth.user.id, client, auth.session?.token);
  } catch {
    return {
      success: false,
      code: 'REAUTH_REQUIRED',
      error: 'REAUTH_REQUIRED',
    };
  }

  const result = await generateExport({
    leadId: parsed.data.leadId,
    format: parsed.data.format,
    locale: 'en',
    actorId: auth.user.id,
    client,
  });

  if (!result) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Lead not found',
    };
  }

  const downloadUrl = `data:${result.contentType};utf8,${encodeURIComponent(result.content)}`;

  return {
    success: true,
    data: {
      content: result.content,
      filename: result.filename,
      contentType: result.contentType,
      downloadUrl,
      exportData: result.exportData,
    },
    content: result.content,
    filename: result.filename,
    contentType: result.contentType,
    downloadUrl,
  };
}

/**
 * Returns lead counts grouped by status for inbox tab badges and unread nav indicator.
 */
export async function getLeadCountsAction(client: DbClient = defaultDb): Promise<
  | {
      success: true;
      data: LeadCounts;
    }
  | { success: false; code: string; error: string }
> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  try {
    await requireOwnerSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  const counts: LeadCounts = await getLeadCounts(client);
  return { success: true, data: counts };
}

/**
 * Converts a lead into a client record (ADR-0015 §8, TASK-0032).
 * Requires active owner web session; rejects unauthenticated (UNAUTHENTICATED) and API keys (UNAUTHORIZED) (AC-8).
 */
export async function convertLeadToClientAction(
  leadIdOrInput: unknown,
  maybeInputOrClient?: unknown,
  maybeClient?: DbClient,
): Promise<
  | {
      success: true;
      clientId: string;
      projectId?: string;
      projectTitle?: string;
      data: { clientId: string; projectId?: string; projectTitle?: string };
    }
  | { success: false; code: string; error: string; fields?: string[] }
> {
  let client: DbClient = defaultDb;
  let rawInput: unknown;

  if (
    typeof leadIdOrInput === 'string' &&
    maybeInputOrClient &&
    typeof maybeInputOrClient === 'object' &&
    !('transaction' in maybeInputOrClient)
  ) {
    rawInput = { leadId: leadIdOrInput, ...(maybeInputOrClient as Record<string, unknown>) };
    if (maybeClient) client = maybeClient;
  } else if (typeof leadIdOrInput === 'object' && leadIdOrInput !== null) {
    rawInput = leadIdOrInput;
    if (
      maybeInputOrClient &&
      typeof maybeInputOrClient === 'object' &&
      'transaction' in maybeInputOrClient
    ) {
      client = maybeInputOrClient as DbClient;
    }
  } else {
    rawInput = { leadId: leadIdOrInput };
  }

  // 1. Deny Bearer / API keys with UNAUTHORIZED (AC-8)
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  // 2. Enforce active owner web session; unauthenticated gets UNAUTHENTICATED (AC-8)
  let auth: AuthContext;
  try {
    auth = await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  // 3. Validation
  const parsed = convertLeadToClientActionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues.map((i) => i.message).join(', ') || 'VALIDATION_FAILED',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  // 4. Domain service execution
  const result = await convertLeadToClient(
    parsed.data.leadId,
    {
      mode: parsed.data.mode,
      existingClientId: parsed.data.existingClientId,
    },
    auth.user.id,
    client,
  );

  if (result.success) {
    safeRevalidate('/leads');
    safeRevalidate('/clients');
    safeRevalidate('/projects');
    return {
      success: true,
      clientId: result.clientId,
      projectId: result.data.projectId,
      projectTitle: result.data.projectTitle,
      data: result.data,
    };
  }

  return result;
}

/**
 * Checks for duplicate clients by normalized email for lead conversion triage (AC-2).
 * Requires active owner web session; denies unauthenticated and API keys.
 */
export async function getLeadDuplicatesAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<
  | {
      success: true;
      duplicates: DuplicateEmailMatch[];
      data: { duplicates: DuplicateEmailMatch[] };
    }
  | { success: false; code: string; error: string; fields?: string[] }
> {
  if (await checkBearerRejection()) {
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  try {
    await requireOwnerWebSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
  }

  const parsed = getLeadDuplicatesActionInputSchema.safeParse(
    typeof rawInput === 'string' ? { leadId: rawInput } : rawInput,
  );
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues.map((i) => i.message).join(', ') || 'VALIDATION_FAILED',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  const lead = await getLeadById(parsed.data.leadId, client);
  if (!lead?.emailNormalized) {
    return { success: true, duplicates: [], data: { duplicates: [] } };
  }

  const duplicates = await findDuplicateEmails(lead.emailNormalized, null, client);
  return { success: true, duplicates, data: { duplicates } };
}
