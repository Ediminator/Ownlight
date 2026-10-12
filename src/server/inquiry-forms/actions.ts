'use server';

import 'server-only';
import { headers } from 'next/headers';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import {
  requireOwnerSession,
  extractBearerToken,
  ForbiddenError,
  type AuthContext,
} from '@/server/auth/guards';
import {
  createInquiryFormActionInputSchema,
  updateInquiryFormActionInputSchema,
  createNoticeVersionActionInputSchema,
  publishInquiryFormActionInputSchema,
  unpublishInquiryFormActionInputSchema,
  archiveInquiryFormActionInputSchema,
} from './schema';
import {
  createForm,
  updateForm,
  createNoticeVersion,
  publishForm,
  unpublishForm,
  archiveForm,
  type InquiryFormServiceResult,
} from './service';
import type { InquiryForm, InquiryFormNoticeVersion } from '@/server/db/schema/inquiry-forms';

export type InquiryFormActionResult<T> = InquiryFormServiceResult<T>;

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

/**
 * Creates a new inquiry form in draft status.
 * Requires active owner web session; API keys rejected (AC-1, AC-6).
 */
export async function createInquiryFormAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<InquiryFormActionResult<InquiryForm>> {
  if (await checkBearerRejection()) {
    return {
      success: false,
      code: 'FORBIDDEN',
      error: 'FORBIDDEN',
    };
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

  const parsed = createInquiryFormActionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => i.message).join(', ');
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: errorMsg || 'VALIDATION_FAILED',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  return await createForm(
    {
      name: parsed.data.name,
      default_locale: parsed.data.default_locale,
    },
    auth.user.id,
    client,
  );
}

/**
 * Updates an inquiry form's configuration.
 * Strictly rejects unexpected keys (e.g. status) without modifying data (AC-2, AC-3, AC-6, AC-7).
 */
export async function updateInquiryFormAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<InquiryFormActionResult<InquiryForm>> {
  if (await checkBearerRejection()) {
    return {
      success: false,
      code: 'FORBIDDEN',
      error: 'FORBIDDEN',
    };
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

  const parsed = updateInquiryFormActionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => i.message).join(', ');
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: errorMsg || 'VALIDATION_FAILED',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  const { id, ...updates } = parsed.data;
  return await updateForm(id, updates, auth.user.id, client);
}

/**
 * Creates a new notice version for an inquiry form.
 * Appends immutable version N+1 (AC-4, AC-6).
 */
export async function createNoticeVersionAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<InquiryFormActionResult<InquiryFormNoticeVersion>> {
  if (await checkBearerRejection()) {
    return {
      success: false,
      code: 'FORBIDDEN',
      error: 'FORBIDDEN',
    };
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

  const parsed = createNoticeVersionActionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => i.message).join(', ');
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: errorMsg || 'VALIDATION_FAILED',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  return await createNoticeVersion(
    parsed.data.formId,
    {
      acknowledgement_text_en: parsed.data.acknowledgement_text_en,
      acknowledgement_text_de: parsed.data.acknowledgement_text_de,
      privacy_policy_url: parsed.data.privacy_policy_url,
    },
    auth.user.id,
    client,
  );
}

/**
 * Publishes an inquiry form.
 * Returns PUBLISH_PRECONDITION_FAILED if preconditions fail (AC-5, AC-6).
 */
export async function publishInquiryFormAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<InquiryFormActionResult<InquiryForm>> {
  if (await checkBearerRejection()) {
    return {
      success: false,
      code: 'FORBIDDEN',
      error: 'FORBIDDEN',
    };
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

  const parsed = publishInquiryFormActionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => i.message).join(', ');
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: errorMsg || 'VALIDATION_FAILED',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  return await publishForm(parsed.data.id, auth.user.id, client);
}

/**
 * Unpublishes an inquiry form (sets status to draft) (AC-6).
 */
export async function unpublishInquiryFormAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<InquiryFormActionResult<InquiryForm>> {
  if (await checkBearerRejection()) {
    return {
      success: false,
      code: 'FORBIDDEN',
      error: 'FORBIDDEN',
    };
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

  const parsed = unpublishInquiryFormActionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => i.message).join(', ');
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: errorMsg || 'VALIDATION_FAILED',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  return await unpublishForm(parsed.data.id, auth.user.id, client);
}

/**
 * Archives an inquiry form (AC-6).
 */
export async function archiveInquiryFormAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<InquiryFormActionResult<InquiryForm>> {
  if (await checkBearerRejection()) {
    return {
      success: false,
      code: 'FORBIDDEN',
      error: 'FORBIDDEN',
    };
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

  const parsed = archiveInquiryFormActionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => i.message).join(', ');
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: errorMsg || 'VALIDATION_FAILED',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }

  return await archiveForm(parsed.data.id, auth.user.id, client);
}
