import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { studioSettings, type StudioSettings } from '@/server/db/schema/studio-settings';
import { getStudioSettings as getBaseStudioSettings } from '@/server/settings/repo';
import { audit } from '@/server/audit';
import { resolveRepoAuth, type RepoAuthInput } from '@/server/auth/repo-auth';
import {
  updateStudioTaxSettingsSchema,
  type UpdateStudioTaxSettingsInput,
  DEFAULT_KLEINUNTERNEHMER_NOTICES,
  getEffectiveKleinunternehmerNotice,
} from './tax-settings-schema';

export {
  updateStudioTaxSettingsSchema,
  type UpdateStudioTaxSettingsInput,
  DEFAULT_KLEINUNTERNEHMER_NOTICES,
  getEffectiveKleinunternehmerNotice,
};

/**
 * Retrieves studio settings containing tax configuration.
 * Strictly requires authenticated studio owner.
 */
export async function getStudioTaxSettings(
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<StudioSettings> {
  const { client } = await resolveRepoAuth(authOrOptions, explicitClient);
  return getBaseStudioSettings(client);
}

/**
 * Updates studio tax settings and records audit log event studio_settings.tax_updated.
 * Strictly requires authenticated studio owner.
 */
export async function updateStudioTaxSettings(
  rawInput: unknown,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<StudioSettings> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = updateStudioTaxSettingsSchema.parse(rawInput);

  const current = await getBaseStudioSettings(client);
  const now = new Date();

  const updatePayload: Record<string, unknown> = {
    updated_at: now,
  };

  const changedFields: string[] = [];

  if (validated.taxNumber !== undefined) {
    updatePayload.tax_number = validated.taxNumber;
    changedFields.push('tax_number');
  }
  if (validated.vatId !== undefined) {
    updatePayload.vat_id = validated.vatId;
    changedFields.push('vat_id');
  }
  if (validated.isKleinunternehmer !== undefined) {
    updatePayload.is_kleinunternehmer = validated.isKleinunternehmer;
    changedFields.push('is_kleinunternehmer');
  }
  if (validated.kleinunternehmerNotice !== undefined) {
    updatePayload.kleinunternehmer_notice = validated.kleinunternehmerNotice;
    changedFields.push('kleinunternehmer_notice');
  }
  if (validated.defaultTaxRateBasisPoints !== undefined) {
    updatePayload.default_tax_rate_basis_points = validated.defaultTaxRateBasisPoints;
    changedFields.push('default_tax_rate_basis_points');
  }
  if (validated.pricesIncludeTax !== undefined) {
    updatePayload.prices_include_tax = validated.pricesIncludeTax;
    changedFields.push('prices_include_tax');
  }

  const [updated] = await client
    .update(studioSettings)
    .set(updatePayload)
    .where(eq(studioSettings.id, current.id))
    .returning();

  if (!updated) {
    throw new Error('Failed to update studio tax settings');
  }

  // Record audit log
  await audit(
    {
      actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
      actorId: auth.user.id,
      action: 'studio_settings.tax_updated',
      targetType: 'studio_settings',
      targetId: updated.id,
      outcome: 'success',
      metadata: {
        changed_fields: changedFields,
        is_kleinunternehmer: updated.is_kleinunternehmer,
        prices_include_tax: updated.prices_include_tax,
        default_tax_rate_basis_points: updated.default_tax_rate_basis_points,
        tax_number: updated.tax_number ?? undefined,
        vat_id: updated.vat_id ?? undefined,
      },
    },
    client,
  );

  return updated;
}
