import { db as defaultDb, type DbClient } from '@/server/db/client';
import { audit, type ActorType } from '@/server/audit';
import { logger } from '@/server/log';
import {
  type InquiryForm,
  type InquiryFormNoticeVersion,
  type InquiryFormFieldConfig,
  type InquiryFormEventType,
  type InquiryFormLocale,
} from '@/server/db/schema/inquiry-forms';
import {
  insertForm,
  updateFormRecord,
  getFormById,
  getPublishedFormRecordBySlug,
  listFormsRecords,
  insertNoticeVersionRecord,
  getNoticeVersionById,
  getLatestNoticeVersionForForm,
  getNoticeVersionsForForm,
} from './repo';
import {
  DEFAULT_FORM_FIELDS,
  DEFAULT_ACKNOWLEDGEMENT_TEXT_EN,
  DEFAULT_ACKNOWLEDGEMENT_TEXT_DE,
  validateFormFields,
  validateEventTypes,
  noticeVersionInputSchema,
  successRedirectUrlSchema,
} from './schema';
import { generateFormSlug } from './slug';

export interface ServiceResultSuccess<T> {
  success: true;
  data: T;
  code?: never;
  error?: never;
  fields?: never;
}

export interface ServiceResultFailure {
  success: false;
  code:
    | 'VALIDATION_FAILED'
    | 'NOT_FOUND'
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'PUBLISH_PRECONDITION_FAILED';
  error: string;
  fields?: string[];
}

export type InquiryFormServiceResult<T> = ServiceResultSuccess<T> | ServiceResultFailure;

export type ActorInput = { actorType?: ActorType; actorId: string } | string;

export function resolveActor(actor: ActorInput): { actorType: ActorType; actorId: string } {
  if (typeof actor === 'string') {
    return { actorType: 'owner', actorId: actor };
  }
  return {
    actorType: actor.actorType ?? 'owner',
    actorId: actor.actorId,
  };
}

export interface CreateFormInput {
  name: string;
  default_locale?: string;
  fields?: InquiryFormFieldConfig[];
  event_types?: InquiryFormEventType[];
  auto_reply_enabled?: boolean;
  accept_unverified?: boolean;
  privacy_policy_url?: string;
  success_redirect_url?: string | null;
}

export interface UpdateFormInput {
  name?: string;
  default_locale?: string;
  fields?: InquiryFormFieldConfig[];
  event_types?: InquiryFormEventType[];
  auto_reply_enabled?: boolean;
  accept_unverified?: boolean;
  success_redirect_url?: string | null;
}

export interface CreateNoticeVersionInput {
  acknowledgement_text_en?: string;
  acknowledgement_text_de?: string;
  privacy_policy_url: string;
}

/**
 * Creates an inquiry form in draft status with version 1 of privacy notice (AC-1).
 */
export async function createForm(
  input: CreateFormInput,
  actor: ActorInput,
  client: DbClient = defaultDb,
): Promise<InquiryFormServiceResult<InquiryForm>> {
  const resolvedActor = resolveActor(actor);

  // 1. Validate name
  const name = input.name.trim();
  if (!name || name.length > 100) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: 'Form name is required and must be at most 100 characters',
      fields: ['name'],
    };
  }

  // 2. Validate locale
  const defaultLocale = input.default_locale ?? 'en';
  if (defaultLocale !== 'en' && defaultLocale !== 'de') {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: 'Default locale must be "en" or "de"',
      fields: ['default_locale'],
    };
  }
  const validLocale: InquiryFormLocale = defaultLocale === 'de' ? 'de' : 'en';

  // 3. Validate fields
  let fields: InquiryFormFieldConfig[] = DEFAULT_FORM_FIELDS;
  if (input.fields !== undefined) {
    const fieldsRes = validateFormFields(input.fields);
    if (!fieldsRes.success) {
      return {
        success: false,
        code: 'VALIDATION_FAILED',
        error: fieldsRes.error,
        fields: [fieldsRes.field],
      };
    }
    fields = fieldsRes.data;
  }

  const isEventTypeEnabled = fields.some((f) => f.key === 'event_type' && f.enabled);

  // 4. Validate event types
  let eventTypes: InquiryFormEventType[] = [];
  if (input.event_types !== undefined) {
    const eventRes = validateEventTypes(input.event_types, isEventTypeEnabled);
    if (!eventRes.success) {
      return {
        success: false,
        code: 'VALIDATION_FAILED',
        error: eventRes.error,
        fields: [eventRes.field ?? 'event_types'],
      };
    }
    eventTypes = eventRes.data;
  } else if (isEventTypeEnabled) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: 'When event_type field is enabled, at least one event type is required',
      fields: ['event_types'],
    };
  }

  // 5. Validate success_redirect_url if provided
  let successRedirectUrl: string | null = null;
  if (input.success_redirect_url) {
    const urlRes = successRedirectUrlSchema.safeParse(input.success_redirect_url);
    if (!urlRes.success) {
      return {
        success: false,
        code: 'VALIDATION_FAILED',
        error: urlRes.error.issues[0]?.message ?? 'Invalid success redirect URL',
        fields: ['success_redirect_url'],
      };
    }
    successRedirectUrl = urlRes.data ?? null;
  }

  // 6. Generate unguessable 10-char base32 slug (AC-9)
  const slug = generateFormSlug();

  // 7. Auto-reply & accept-unverified defaults
  const autoReplyEnabled = input.auto_reply_enabled ?? true;
  const acceptUnverified = input.accept_unverified ?? false;

  // 8. Privacy policy URL for version 1
  let initialPolicyUrl = '';
  if (input.privacy_policy_url?.startsWith('https://')) {
    initialPolicyUrl = input.privacy_policy_url;
  }

  // 9. Execute transactional creation
  return await client.transaction(async (tx) => {
    // Insert form without currentNoticeVersionId first
    const form = await insertForm(
      {
        slug,
        name,
        status: 'draft',
        defaultLocale: validLocale,
        fields,
        eventTypes,
        autoReplyEnabled,
        acceptUnverified,
        successRedirectUrl,
      },
      tx,
    );

    // Insert version 1 of notice
    const noticeVersion = await insertNoticeVersionRecord(
      {
        formId: form.id,
        version: 1,
        acknowledgementTextEn: DEFAULT_ACKNOWLEDGEMENT_TEXT_EN,
        acknowledgementTextDe: DEFAULT_ACKNOWLEDGEMENT_TEXT_DE,
        privacyPolicyUrl: initialPolicyUrl,
        createdByActorId: resolvedActor.actorId,
      },
      tx,
    );

    // Link notice version to form
    const updatedForm = await updateFormRecord(
      form.id,
      { currentNoticeVersionId: noticeVersion.id },
      tx,
    );

    if (!updatedForm) {
      throw new Error(`Failed to update inquiry form current notice version for ID "${form.id}"`);
    }

    // Record audit event
    await audit(
      {
        actorType: resolvedActor.actorType,
        actorId: resolvedActor.actorId,
        action: 'inquiry_form.created',
        targetType: 'inquiry_form',
        targetId: form.id,
        outcome: 'success',
        metadata: {
          form_id: form.id,
          changed_fields: [
            'name',
            'slug',
            'status',
            'default_locale',
            'fields',
            'event_types',
            'auto_reply_enabled',
            'accept_unverified',
          ],
        },
      },
      tx,
    );

    logger.info({ formId: form.id, slug: form.slug }, 'Inquiry form created in draft');

    return {
      success: true,
      data: updatedForm,
    };
  });
}

/**
 * Updates an inquiry form's configuration fields (AC-2, AC-3).
 */
export async function updateForm(
  id: string,
  input: UpdateFormInput,
  actor: ActorInput,
  client: DbClient = defaultDb,
): Promise<InquiryFormServiceResult<InquiryForm>> {
  const resolvedActor = resolveActor(actor);

  const existing = await getFormById(id, client);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Inquiry form not found',
    };
  }

  const updates: Partial<InquiryForm> = {};
  const changedFields: string[] = [];

  // Name
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed || trimmed.length > 100) {
      return {
        success: false,
        code: 'VALIDATION_FAILED',
        error: 'Form name must be between 1 and 100 characters',
        fields: ['name'],
      };
    }
    if (trimmed !== existing.name) {
      updates.name = trimmed;
      changedFields.push('name');
    }
  }

  // Default locale
  if (input.default_locale !== undefined) {
    if (input.default_locale !== 'en' && input.default_locale !== 'de') {
      return {
        success: false,
        code: 'VALIDATION_FAILED',
        error: 'Default locale must be "en" or "de"',
        fields: ['default_locale'],
      };
    }
    if (input.default_locale !== existing.defaultLocale) {
      updates.defaultLocale = input.default_locale;
      changedFields.push('default_locale');
    }
  }

  // Fields validation (AC-2)
  let effectiveFields = existing.fields;
  if (input.fields !== undefined) {
    const fieldsRes = validateFormFields(input.fields);
    if (!fieldsRes.success) {
      return {
        success: false,
        code: 'VALIDATION_FAILED',
        error: fieldsRes.error,
        fields: [fieldsRes.field],
      };
    }
    effectiveFields = fieldsRes.data;
    updates.fields = effectiveFields;
    changedFields.push('fields');
  }

  const isEventTypeEnabled = effectiveFields.some((f) => f.key === 'event_type' && f.enabled);

  // Event types validation (AC-3)
  if (input.event_types !== undefined) {
    const eventRes = validateEventTypes(input.event_types, isEventTypeEnabled);
    if (!eventRes.success) {
      return {
        success: false,
        code: 'VALIDATION_FAILED',
        error: eventRes.error,
        fields: [eventRes.field ?? 'event_types'],
      };
    }
    updates.eventTypes = eventRes.data;
    changedFields.push('event_types');
  } else if (input.fields !== undefined && isEventTypeEnabled) {
    // If fields were updated enabling event_type, verify existing event_types has at least one
    if (existing.eventTypes.length === 0) {
      return {
        success: false,
        code: 'VALIDATION_FAILED',
        error: 'When event_type field is enabled, at least one event type is required',
        fields: ['event_types'],
      };
    }
  }

  // Auto-reply enabled
  if (
    input.auto_reply_enabled !== undefined &&
    input.auto_reply_enabled !== existing.autoReplyEnabled
  ) {
    updates.autoReplyEnabled = input.auto_reply_enabled;
    changedFields.push('auto_reply_enabled');
  }

  // Accept unverified
  if (
    input.accept_unverified !== undefined &&
    input.accept_unverified !== existing.acceptUnverified
  ) {
    updates.acceptUnverified = input.accept_unverified;
    changedFields.push('accept_unverified');
  }

  // Success redirect URL
  if (input.success_redirect_url !== undefined) {
    if (input.success_redirect_url === null || input.success_redirect_url === '') {
      if (existing.successRedirectUrl !== null) {
        updates.successRedirectUrl = null;
        changedFields.push('success_redirect_url');
      }
    } else {
      const urlRes = successRedirectUrlSchema.safeParse(input.success_redirect_url);
      if (!urlRes.success) {
        return {
          success: false,
          code: 'VALIDATION_FAILED',
          error: urlRes.error.issues[0]?.message ?? 'Invalid success redirect URL',
          fields: ['success_redirect_url'],
        };
      }
      if (urlRes.data !== existing.successRedirectUrl) {
        updates.successRedirectUrl = urlRes.data ?? null;
        changedFields.push('success_redirect_url');
      }
    }
  }

  if (changedFields.length === 0) {
    return { success: true, data: existing };
  }

  return await client.transaction(async (tx) => {
    const updated = await updateFormRecord(id, updates, tx);
    if (!updated) {
      throw new Error(`Failed to update inquiry form ID "${id}"`);
    }

    await audit(
      {
        actorType: resolvedActor.actorType,
        actorId: resolvedActor.actorId,
        action: 'inquiry_form.updated',
        targetType: 'inquiry_form',
        targetId: id,
        outcome: 'success',
        metadata: {
          form_id: id,
          changed_fields: changedFields,
        },
      },
      tx,
    );

    logger.info({ formId: id, changedFields }, 'Inquiry form updated');

    return {
      success: true,
      data: updated,
    };
  });
}

/**
 * Appends a new immutable notice version and updates current_notice_version_id (AC-4, AC-6).
 */
export async function createNoticeVersion(
  formId: string,
  input: CreateNoticeVersionInput,
  actor: ActorInput,
  client: DbClient = defaultDb,
): Promise<InquiryFormServiceResult<InquiryFormNoticeVersion>> {
  const resolvedActor = resolveActor(actor);

  const form = await getFormById(formId, client);
  if (!form) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Inquiry form not found',
    };
  }

  const parsed = noticeVersionInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') ?? 'notice';
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: issue?.message ?? 'Invalid notice version input',
      fields: [path],
    };
  }

  return await client.transaction(async (tx) => {
    const latest = await getLatestNoticeVersionForForm(formId, tx);
    const nextVersion = (latest?.version ?? 0) + 1;

    const noticeVersion = await insertNoticeVersionRecord(
      {
        formId,
        version: nextVersion,
        acknowledgementTextEn: parsed.data.acknowledgement_text_en,
        acknowledgementTextDe: parsed.data.acknowledgement_text_de,
        privacyPolicyUrl: parsed.data.privacy_policy_url,
        createdByActorId: resolvedActor.actorId,
      },
      tx,
    );

    await updateFormRecord(formId, { currentNoticeVersionId: noticeVersion.id }, tx);

    await audit(
      {
        actorType: resolvedActor.actorType,
        actorId: resolvedActor.actorId,
        action: 'inquiry_form.notice_versioned',
        targetType: 'inquiry_form',
        targetId: formId,
        outcome: 'success',
        metadata: {
          form_id: formId,
          version: nextVersion,
        },
      },
      tx,
    );

    logger.info({ formId, version: nextVersion }, 'Inquiry form notice version created');

    return {
      success: true,
      data: noticeVersion,
    };
  });
}

/**
 * Publishes an inquiry form if preconditions are met (AC-7).
 */
export async function publishForm(
  id: string,
  actor: ActorInput,
  client: DbClient = defaultDb,
): Promise<InquiryFormServiceResult<InquiryForm>> {
  const resolvedActor = resolveActor(actor);

  const form = await getFormById(id, client);
  if (!form) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Inquiry form not found',
    };
  }

  if (!form.currentNoticeVersionId) {
    return {
      success: false,
      code: 'PUBLISH_PRECONDITION_FAILED',
      error: 'Form has no associated notice version',
    };
  }

  const currentNotice = await getNoticeVersionById(form.currentNoticeVersionId, client);
  if (!currentNotice) {
    return {
      success: false,
      code: 'PUBLISH_PRECONDITION_FAILED',
      error: 'Current notice version could not be found',
    };
  }

  // Precondition checks: notice in both languages and valid https privacy policy url
  if (currentNotice.acknowledgementTextEn.trim().length === 0) {
    return {
      success: false,
      code: 'PUBLISH_PRECONDITION_FAILED',
      error: 'Current notice lacks English acknowledgement text',
    };
  }

  if (currentNotice.acknowledgementTextDe.trim().length === 0) {
    return {
      success: false,
      code: 'PUBLISH_PRECONDITION_FAILED',
      error: 'Current notice lacks German acknowledgement text',
    };
  }

  if (!currentNotice.privacyPolicyUrl.trim().startsWith('https://')) {
    return {
      success: false,
      code: 'PUBLISH_PRECONDITION_FAILED',
      error: 'Current notice lacks a valid HTTPS privacy policy URL',
    };
  }

  return await client.transaction(async (tx) => {
    const updated = await updateFormRecord(id, { status: 'published' }, tx);
    if (!updated) {
      throw new Error(`Failed to publish inquiry form ID "${id}"`);
    }

    await audit(
      {
        actorType: resolvedActor.actorType,
        actorId: resolvedActor.actorId,
        action: 'inquiry_form.published',
        targetType: 'inquiry_form',
        targetId: id,
        outcome: 'success',
        metadata: {
          form_id: id,
          changed_fields: ['status'],
        },
      },
      tx,
    );

    logger.info({ formId: id }, 'Inquiry form published');

    return {
      success: true,
      data: updated,
    };
  });
}

/**
 * Unpublishes an inquiry form (sets status back to draft).
 */
export async function unpublishForm(
  id: string,
  actor: ActorInput,
  client: DbClient = defaultDb,
): Promise<InquiryFormServiceResult<InquiryForm>> {
  const resolvedActor = resolveActor(actor);

  const form = await getFormById(id, client);
  if (!form) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Inquiry form not found',
    };
  }

  return await client.transaction(async (tx) => {
    const updated = await updateFormRecord(id, { status: 'draft' }, tx);
    if (!updated) {
      throw new Error(`Failed to unpublish inquiry form ID "${id}"`);
    }

    await audit(
      {
        actorType: resolvedActor.actorType,
        actorId: resolvedActor.actorId,
        action: 'inquiry_form.unpublished',
        targetType: 'inquiry_form',
        targetId: id,
        outcome: 'success',
        metadata: {
          form_id: id,
          changed_fields: ['status'],
        },
      },
      tx,
    );

    logger.info({ formId: id }, 'Inquiry form unpublished');

    return {
      success: true,
      data: updated,
    };
  });
}

/**
 * Archives an inquiry form.
 */
export async function archiveForm(
  id: string,
  actor: ActorInput,
  client: DbClient = defaultDb,
): Promise<InquiryFormServiceResult<InquiryForm>> {
  const resolvedActor = resolveActor(actor);

  const form = await getFormById(id, client);
  if (!form) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Inquiry form not found',
    };
  }

  return await client.transaction(async (tx) => {
    const updated = await updateFormRecord(id, { status: 'archived' }, tx);
    if (!updated) {
      throw new Error(`Failed to archive inquiry form ID "${id}"`);
    }

    await audit(
      {
        actorType: resolvedActor.actorType,
        actorId: resolvedActor.actorId,
        action: 'inquiry_form.archived',
        targetType: 'inquiry_form',
        targetId: id,
        outcome: 'success',
        metadata: {
          form_id: id,
          changed_fields: ['status'],
        },
      },
      tx,
    );

    logger.info({ formId: id }, 'Inquiry form archived');

    return {
      success: true,
      data: updated,
    };
  });
}

/**
 * Retrieves a published form by slug (AC-8).
 * Returns null for unknown slugs, draft forms, and archived forms alike.
 */
export async function getPublishedFormBySlug(
  slug: string,
  client: DbClient = defaultDb,
): Promise<InquiryForm | null> {
  return getPublishedFormRecordBySlug(slug, client);
}

/**
 * Lists all inquiry forms.
 */
export async function listForms(client: DbClient = defaultDb): Promise<InquiryForm[]> {
  return listFormsRecords(client);
}

/**
 * Retrieves a form by ID.
 */
export async function getForm(
  id: string,
  client: DbClient = defaultDb,
): Promise<InquiryForm | null> {
  return getFormById(id, client);
}

/**
 * Retrieves all notice versions for a form.
 */
export async function getNoticeVersions(
  formId: string,
  client: DbClient = defaultDb,
): Promise<InquiryFormNoticeVersion[]> {
  return getNoticeVersionsForForm(formId, client);
}
