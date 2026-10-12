import { eq, and, desc, asc } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import {
  inquiryForms,
  inquiryFormNoticeVersions,
  type InquiryForm,
  type NewInquiryForm,
  type InquiryFormNoticeVersion,
  type NewInquiryFormNoticeVersion,
} from '@/server/db/schema/inquiry-forms';

/**
 * Inserts a new inquiry form record.
 */
export async function insertForm(
  data: NewInquiryForm,
  client: DbClient = defaultDb,
): Promise<InquiryForm> {
  const [record] = await client.insert(inquiryForms).values(data).returning();
  if (!record) {
    throw new Error('Failed to insert inquiry form record');
  }
  return record;
}

/**
 * Updates an inquiry form by ID.
 */
export async function updateFormRecord(
  id: string,
  data: Partial<NewInquiryForm>,
  client: DbClient = defaultDb,
): Promise<InquiryForm | null> {
  const [record] = await client
    .update(inquiryForms)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(inquiryForms.id, id))
    .returning();
  return record ?? null;
}

/**
 * Retrieves a form by ID.
 */
export async function getFormById(
  id: string,
  client: DbClient = defaultDb,
): Promise<InquiryForm | null> {
  const [record] = await client.select().from(inquiryForms).where(eq(inquiryForms.id, id)).limit(1);
  return record ?? null;
}

/**
 * Retrieves a form by slug regardless of status.
 */
export async function getFormBySlug(
  slug: string,
  client: DbClient = defaultDb,
): Promise<InquiryForm | null> {
  const [record] = await client
    .select()
    .from(inquiryForms)
    .where(eq(inquiryForms.slug, slug))
    .limit(1);
  return record ?? null;
}

/**
 * Retrieves a published form by slug (AC-8).
 * Returns null for draft, archived, or non-existent forms.
 */
export async function getPublishedFormRecordBySlug(
  slug: string,
  client: DbClient = defaultDb,
): Promise<InquiryForm | null> {
  const [record] = await client
    .select()
    .from(inquiryForms)
    .where(and(eq(inquiryForms.slug, slug), eq(inquiryForms.status, 'published')))
    .limit(1);
  return record ?? null;
}

/**
 * Lists all inquiry forms.
 */
export async function listFormsRecords(client: DbClient = defaultDb): Promise<InquiryForm[]> {
  return client.select().from(inquiryForms).orderBy(desc(inquiryForms.createdAt));
}

/**
 * Inserts an immutable notice version record.
 */
export async function insertNoticeVersionRecord(
  data: NewInquiryFormNoticeVersion,
  client: DbClient = defaultDb,
): Promise<InquiryFormNoticeVersion> {
  const [record] = await client.insert(inquiryFormNoticeVersions).values(data).returning();
  if (!record) {
    throw new Error('Failed to insert inquiry form notice version record');
  }
  return record;
}

/**
 * Retrieves a notice version by ID.
 */
export async function getNoticeVersionById(
  id: string,
  client: DbClient = defaultDb,
): Promise<InquiryFormNoticeVersion | null> {
  const [record] = await client
    .select()
    .from(inquiryFormNoticeVersions)
    .where(eq(inquiryFormNoticeVersions.id, id))
    .limit(1);
  return record ?? null;
}

/**
 * Retrieves the latest notice version for a given form by version number descending.
 */
export async function getLatestNoticeVersionForForm(
  formId: string,
  client: DbClient = defaultDb,
): Promise<InquiryFormNoticeVersion | null> {
  const [record] = await client
    .select()
    .from(inquiryFormNoticeVersions)
    .where(eq(inquiryFormNoticeVersions.formId, formId))
    .orderBy(desc(inquiryFormNoticeVersions.version))
    .limit(1);
  return record ?? null;
}

/**
 * Retrieves all notice versions for a form, ordered by version ascending.
 */
export async function getNoticeVersionsForForm(
  formId: string,
  client: DbClient = defaultDb,
): Promise<InquiryFormNoticeVersion[]> {
  return client
    .select()
    .from(inquiryFormNoticeVersions)
    .where(eq(inquiryFormNoticeVersions.formId, formId))
    .orderBy(asc(inquiryFormNoticeVersions.version));
}
