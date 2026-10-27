import { eq, and, asc, desc } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';
import {
  catalogueItems,
  type CatalogueItem,
  type CatalogueCategory,
} from '@/server/db/schema/packages';
import {
  createCatalogueItemSchema,
  updateCatalogueItemSchema,
  type CreateCatalogueItemInput,
  type UpdateCatalogueItemInput,
} from './schema';
import { resolveRepoAuth, type RepoAuthInput } from '@/server/auth/repo-auth';
import { audit } from '@/server/audit';

export interface ListCatalogueItemsOptions {
  isActive?: boolean;
  category?: CatalogueCategory;
}

/**
 * Retrieves catalogue items with optional filtering.
 * Strictly requires authenticated studio owner.
 */
export async function listCatalogueItems(
  options: ListCatalogueItemsOptions = {},
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<CatalogueItem[]> {
  const { client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const conditions = [];
  if (options.isActive !== undefined) {
    conditions.push(eq(catalogueItems.isActive, options.isActive));
  }
  if (options.category !== undefined) {
    conditions.push(eq(catalogueItems.category, options.category));
  }

  const query = client
    .select()
    .from(catalogueItems)
    .orderBy(asc(catalogueItems.position), desc(catalogueItems.createdAt));

  return conditions.length > 0 ? await query.where(and(...conditions)) : await query;
}

/**
 * Retrieves a single catalogue item by its unique ID.
 */
export async function getCatalogueItemById(
  id: string,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<CatalogueItem | null> {
  const { client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const [row] = await client
    .select()
    .from(catalogueItems)
    .where(eq(catalogueItems.id, id))
    .limit(1);

  return row ?? null;
}

/**
 * Retrieves a single catalogue item by its unique slug.
 */
export async function getCatalogueItemBySlug(
  slug: string,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<CatalogueItem | null> {
  const { client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const [row] = await client
    .select()
    .from(catalogueItems)
    .where(eq(catalogueItems.slug, slug))
    .limit(1);

  return row ?? null;
}

/**
 * Inserts a new catalogue item and emits catalogue_item.created audit event.
 */
export async function createCatalogueItem(
  rawInput: CreateCatalogueItemInput,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<CatalogueItem> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = createCatalogueItemSchema.parse(rawInput);

  const now = new Date();
  const itemId = generateUuidV7();

  const [inserted] = await client
    .insert(catalogueItems)
    .values({
      id: itemId,
      name: validated.name,
      slug: validated.slug,
      description: validated.description,
      category: validated.category,
      unitPriceMinor: validated.unitPriceMinor,
      currency: validated.currency,
      taxRateBasisPoints: validated.taxRateBasisPoints,
      position: validated.position,
      isActive: validated.isActive,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!inserted) {
    throw new Error('Failed to insert catalogue item');
  }

  await audit(
    {
      actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
      actorId: auth.user.id,
      action: 'catalogue_item.created',
      targetType: 'catalogue_item',
      targetId: inserted.id,
      outcome: 'success',
      metadata: {
        catalogue_item_id: inserted.id,
        slug: inserted.slug,
        name: inserted.name,
        category: inserted.category,
        unit_price_minor: inserted.unitPriceMinor,
        currency: inserted.currency,
        tax_rate_basis_points: inserted.taxRateBasisPoints,
        is_active: inserted.isActive,
      },
    },
    client,
  );

  return inserted;
}

/**
 * Updates an existing catalogue item and emits catalogue_item.updated audit event.
 */
export async function updateCatalogueItem(
  id: string,
  rawInput: UpdateCatalogueItemInput,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<CatalogueItem> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = updateCatalogueItemSchema.parse(rawInput);

  const existing = await getCatalogueItemById(id, { auth, client });
  if (!existing) {
    throw new Error(`Catalogue item not found: ${id}`);
  }

  const now = new Date();
  const updatePayload: Record<string, unknown> = {
    updatedAt: now,
  };

  const changedFields: string[] = [];

  if (validated.name !== undefined) {
    updatePayload.name = validated.name;
    changedFields.push('name');
  }
  if (validated.slug !== undefined) {
    updatePayload.slug = validated.slug;
    changedFields.push('slug');
  }
  if (validated.description !== undefined) {
    updatePayload.description = validated.description;
    changedFields.push('description');
  }
  if (validated.category !== undefined) {
    updatePayload.category = validated.category;
    changedFields.push('category');
  }
  if (validated.unitPriceMinor !== undefined) {
    updatePayload.unitPriceMinor = validated.unitPriceMinor;
    changedFields.push('unitPriceMinor');
  }
  if (validated.currency !== undefined) {
    updatePayload.currency = validated.currency;
    changedFields.push('currency');
  }
  if (validated.taxRateBasisPoints !== undefined) {
    updatePayload.taxRateBasisPoints = validated.taxRateBasisPoints;
    changedFields.push('taxRateBasisPoints');
  }
  if (validated.position !== undefined) {
    updatePayload.position = validated.position;
    changedFields.push('position');
  }
  if (validated.isActive !== undefined) {
    updatePayload.isActive = validated.isActive;
    changedFields.push('isActive');
  }

  const [updated] = await client
    .update(catalogueItems)
    .set(updatePayload)
    .where(eq(catalogueItems.id, id))
    .returning();

  if (!updated) {
    throw new Error(`Failed to update catalogue item: ${id}`);
  }

  await audit(
    {
      actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
      actorId: auth.user.id,
      action: 'catalogue_item.updated',
      targetType: 'catalogue_item',
      targetId: updated.id,
      outcome: 'success',
      metadata: {
        catalogue_item_id: updated.id,
        slug: updated.slug,
        name: updated.name,
        category: updated.category,
        unit_price_minor: updated.unitPriceMinor,
        currency: updated.currency,
        tax_rate_basis_points: updated.taxRateBasisPoints,
        is_active: updated.isActive,
        changed_fields: changedFields,
      },
    },
    client,
  );

  return updated;
}

/**
 * Soft deletes (deactivates) a catalogue item by setting is_active = false.
 * Emits catalogue_item.deleted audit event.
 */
export async function deleteCatalogueItem(
  id: string,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<CatalogueItem> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const existing = await getCatalogueItemById(id, { auth, client });
  if (!existing) {
    throw new Error(`Catalogue item not found: ${id}`);
  }

  const [updated] = await client
    .update(catalogueItems)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(eq(catalogueItems.id, id))
    .returning();

  if (!updated) {
    throw new Error(`Failed to delete catalogue item: ${id}`);
  }

  await audit(
    {
      actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
      actorId: auth.user.id,
      action: 'catalogue_item.deleted',
      targetType: 'catalogue_item',
      targetId: updated.id,
      outcome: 'success',
      metadata: {
        catalogue_item_id: updated.id,
        slug: updated.slug,
      },
    },
    client,
  );

  return updated;
}
