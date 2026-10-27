import 'server-only';
import { eq } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { studioSettings, type StudioSettings } from '@/server/db/schema';
import { validateUpdateStudioSettings, type UpdateStudioSettingsInput } from './schema';
import { generateUuidV7 } from '@/lib/id';

export const DEFAULT_STUDIO_SETTINGS: Omit<StudioSettings, 'id' | 'created_at' | 'updated_at'> = {
  studio_name: 'Photo Studio',
  default_locale: 'en',
  timezone: 'UTC',
  currency: 'EUR',
  mfa_required: false,
  mfa_postponed_until: null,
  forms_pow_hmac_key: null,
  tax_number: null,
  vat_id: null,
  is_kleinunternehmer: false,
  kleinunternehmer_notice: null,
  default_tax_rate_basis_points: 1900,
  prices_include_tax: true,
};

// Generic database interface compatible with both PostgresJsDatabase and PgliteDatabase
// or any Drizzle query executor for maximum testability.
export interface QueryClient {
  select: DbClient['select'];
  insert: DbClient['insert'];
  update: DbClient['update'];
}

/**
 * Retrieves the singleton studio settings record.
 * If no record exists, initializes and returns the default studio settings.
 */
export async function getStudioSettings(client: QueryClient = defaultDb): Promise<StudioSettings> {
  const existing = await client.select().from(studioSettings).limit(1);
  const [first] = existing;
  if (first) {
    return first;
  }

  const now = new Date();
  const [created] = await client
    .insert(studioSettings)
    .values({
      id: generateUuidV7(),
      studio_name: DEFAULT_STUDIO_SETTINGS.studio_name,
      default_locale: DEFAULT_STUDIO_SETTINGS.default_locale,
      timezone: DEFAULT_STUDIO_SETTINGS.timezone,
      currency: DEFAULT_STUDIO_SETTINGS.currency,
      mfa_required: DEFAULT_STUDIO_SETTINGS.mfa_required,
      mfa_postponed_until: DEFAULT_STUDIO_SETTINGS.mfa_postponed_until,
      created_at: now,
      updated_at: now,
    })
    .returning();

  if (!created) {
    throw new Error('Failed to create default studio settings');
  }

  return created;
}

/**
 * Updates the studio settings record with validated input.
 * Strict Zod validation runs first; if validation fails, a typed SettingsValidationError
 * is thrown and NO database write occurs.
 */
export async function updateStudioSettings(
  input: UpdateStudioSettingsInput,
  client: QueryClient = defaultDb,
): Promise<StudioSettings> {
  // 1. Strict validation - throws SettingsValidationError on failure
  const validated = validateUpdateStudioSettings(input);

  // 2. Ensure existing record is present
  const current = await getStudioSettings(client);

  // 3. Update the record
  const now = new Date();
  const updatePayload: Record<string, unknown> = {
    studio_name: validated.studio_name,
    default_locale: validated.default_locale,
    timezone: validated.timezone,
    currency: validated.currency,
    updated_at: now,
  };

  if (validated.mfa_required !== undefined) {
    updatePayload.mfa_required = validated.mfa_required;
  }
  if (validated.mfa_postponed_until !== undefined) {
    updatePayload.mfa_postponed_until = validated.mfa_postponed_until;
  }

  const [updated] = await client
    .update(studioSettings)
    .set(updatePayload)
    .where(eq(studioSettings.id, current.id))
    .returning();

  if (!updated) {
    throw new Error('Failed to update studio settings');
  }

  return updated;
}
