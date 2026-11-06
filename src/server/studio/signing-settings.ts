import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { studioSettings, type StudioSettings } from '@/server/db/schema/studio-settings';
import { getStudioSettings as getBaseStudioSettings } from '@/server/settings/repo';
import { audit } from '@/server/audit';
import { resolveRepoAuth, type RepoAuthInput } from '@/server/auth/repo-auth';
import {
  updateStudioSigningProfileSchema,
  type UpdateStudioSigningProfileInput,
} from '@/server/contracts/schema';

export { updateStudioSigningProfileSchema, type UpdateStudioSigningProfileInput };

/**
 * Retrieves studio settings containing signing profile and address details.
 * Strictly requires authenticated studio owner (AC-7).
 */
export async function getStudioSigningProfile(
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<StudioSettings> {
  const { client } = await resolveRepoAuth(authOrOptions, explicitClient);
  return getBaseStudioSettings(client);
}

/**
 * Updates studio contract signing profile and physical address details (AC-6).
 * Emits audit event studio_settings.contract_updated.
 * Strictly requires authenticated studio owner (AC-7).
 */
export async function updateStudioSigningProfile(
  rawInput: unknown,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<StudioSettings> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = updateStudioSigningProfileSchema.parse(rawInput);

  const current = await getBaseStudioSettings(client);
  const now = new Date();

  const updatePayload: Record<string, unknown> = {
    updated_at: now,
  };

  const changedFields: string[] = [];

  if (validated.contractSignatoryName !== undefined) {
    updatePayload.contract_signatory_name = validated.contractSignatoryName;
    changedFields.push('contract_signatory_name');
  }
  if (validated.contractSignatoryTitle !== undefined) {
    updatePayload.contract_signatory_title = validated.contractSignatoryTitle;
    changedFields.push('contract_signatory_title');
  }
  if (validated.contractCountersignatureMode !== undefined) {
    updatePayload.contract_countersignature_mode = validated.contractCountersignatureMode;
    changedFields.push('contract_countersignature_mode');
  }
  if (validated.studioAddressLine1 !== undefined) {
    updatePayload.studio_address_line1 = validated.studioAddressLine1;
    changedFields.push('studio_address_line1');
  }
  if (validated.studioAddressLine2 !== undefined) {
    updatePayload.studio_address_line2 = validated.studioAddressLine2;
    changedFields.push('studio_address_line2');
  }
  if (validated.studioPostalCode !== undefined) {
    updatePayload.studio_postal_code = validated.studioPostalCode;
    changedFields.push('studio_postal_code');
  }
  if (validated.studioCity !== undefined) {
    updatePayload.studio_city = validated.studioCity;
    changedFields.push('studio_city');
  }
  if (validated.studioCountryCode !== undefined) {
    updatePayload.studio_country_code = validated.studioCountryCode;
    changedFields.push('studio_country_code');
  }
  if (validated.studioPhone !== undefined) {
    updatePayload.studio_phone = validated.studioPhone;
    changedFields.push('studio_phone');
  }
  if (validated.studioEmail !== undefined) {
    updatePayload.studio_email = validated.studioEmail;
    changedFields.push('studio_email');
  }

  const [updated] = await client
    .update(studioSettings)
    .set(updatePayload)
    .where(eq(studioSettings.id, current.id))
    .returning();

  if (!updated) {
    throw new Error('Failed to update studio signing profile');
  }

  // Record audit log
  await audit(
    {
      actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
      actorId: auth.user.id,
      action: 'studio_settings.contract_updated',
      targetType: 'studio_settings',
      targetId: updated.id,
      outcome: 'success',
      metadata: {
        changed_fields: changedFields,
        contract_signatory_name: updated.contract_signatory_name ?? undefined,
        contract_signatory_title: updated.contract_signatory_title ?? undefined,
        contract_countersignature_mode: updated.contract_countersignature_mode,
        studio_city: updated.studio_city ?? undefined,
        studio_country_code: updated.studio_country_code,
        studio_address_line1: updated.studio_address_line1 ?? undefined,
        studio_address_line2: updated.studio_address_line2 ?? undefined,
        studio_postal_code: updated.studio_postal_code ?? undefined,
        studio_phone: updated.studio_phone ?? undefined,
        studio_email: updated.studio_email ?? undefined,
      },
    },
    client,
  );

  return updated;
}
