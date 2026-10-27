import { eq, and, inArray, asc, desc } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';
import {
  packages,
  packageIncludedItems,
  type Package,
  type PackageIncludedItem,
} from '@/server/db/schema/packages';
import {
  createPackageSchema,
  updatePackageSchema,
  packageIncludedItemInputSchema,
  type CreatePackageInput,
  type UpdatePackageInput,
  type PackageIncludedItemInput,
} from './schema';
import { resolveRepoAuth, type RepoAuthInput } from '@/server/auth/repo-auth';
import { audit } from '@/server/audit';

export interface PackageWithIncludedItems extends Package {
  includedItems: PackageIncludedItem[];
}

export interface ListPackagesOptions {
  isActive?: boolean;
  projectTypeKey?: string | null;
}

/**
 * Retrieves packages with child included deliverables.
 * Strictly requires authenticated studio owner.
 */
export async function listPackages(
  options: ListPackagesOptions = {},
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<PackageWithIncludedItems[]> {
  const { client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const conditions = [];
  if (options.isActive !== undefined) {
    conditions.push(eq(packages.isActive, options.isActive));
  }
  if (options.projectTypeKey !== undefined) {
    if (options.projectTypeKey === null) {
      conditions.push(eq(packages.projectTypeKey, ''));
    } else {
      conditions.push(eq(packages.projectTypeKey, options.projectTypeKey));
    }
  }

  const query = client
    .select()
    .from(packages)
    .orderBy(asc(packages.position), desc(packages.createdAt));

  const rows = conditions.length > 0 ? await query.where(and(...conditions)) : await query;

  if (rows.length === 0) {
    return [];
  }

  const packageIds = rows.map((r) => r.id);
  const items = await client
    .select()
    .from(packageIncludedItems)
    .where(inArray(packageIncludedItems.packageId, packageIds))
    .orderBy(asc(packageIncludedItems.position), asc(packageIncludedItems.createdAt));

  const itemsByPackageId = new Map<string, PackageIncludedItem[]>();
  for (const item of items) {
    const list = itemsByPackageId.get(item.packageId) ?? [];
    list.push(item);
    itemsByPackageId.set(item.packageId, list);
  }

  return rows.map((pkg) => ({
    ...pkg,
    includedItems: itemsByPackageId.get(pkg.id) ?? [],
  }));
}

/**
 * Retrieves a single package by its ID with child deliverables.
 */
export async function getPackageById(
  id: string,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<PackageWithIncludedItems | null> {
  const { client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const [pkg] = await client.select().from(packages).where(eq(packages.id, id)).limit(1);
  if (!pkg) {
    return null;
  }

  const items = await client
    .select()
    .from(packageIncludedItems)
    .where(eq(packageIncludedItems.packageId, id))
    .orderBy(asc(packageIncludedItems.position), asc(packageIncludedItems.createdAt));

  return {
    ...pkg,
    includedItems: items,
  };
}

/**
 * Retrieves a single package by unique slug with child deliverables.
 */
export async function getPackageBySlug(
  slug: string,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<PackageWithIncludedItems | null> {
  const { client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const [pkg] = await client.select().from(packages).where(eq(packages.slug, slug)).limit(1);
  if (!pkg) {
    return null;
  }

  const items = await client
    .select()
    .from(packageIncludedItems)
    .where(eq(packageIncludedItems.packageId, pkg.id))
    .orderBy(asc(packageIncludedItems.position), asc(packageIncludedItems.createdAt));

  return {
    ...pkg,
    includedItems: items,
  };
}

/**
 * Creates a photography package and bundled included items in a single transaction.
 * Emits package.created audit event.
 */
export async function createPackage(
  rawInput: CreatePackageInput,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<PackageWithIncludedItems> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = createPackageSchema.parse(rawInput);

  const now = new Date();
  const packageId = generateUuidV7();

  // Execute in transaction
  const executeInTransaction = async (tx: DbClient): Promise<PackageWithIncludedItems> => {
    const [insertedPkg] = await tx
      .insert(packages)
      .values({
        id: packageId,
        name: validated.name,
        slug: validated.slug,
        description: validated.description,
        projectTypeKey: validated.projectTypeKey,
        basePriceMinor: validated.basePriceMinor,
        currency: validated.currency,
        taxRateBasisPoints: validated.taxRateBasisPoints,
        position: validated.position,
        isActive: validated.isActive,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!insertedPkg) {
      throw new Error('Failed to insert package record');
    }

    let insertedItems: PackageIncludedItem[] = [];
    if (validated.includedItems.length > 0) {
      insertedItems = await tx
        .insert(packageIncludedItems)
        .values(
          validated.includedItems.map((item, index) => ({
            id: generateUuidV7(),
            packageId: insertedPkg.id,
            title: item.title,
            description: item.description ?? null,
            quantity: item.quantity,
            position: item.position ?? index,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .returning();
    }

    await audit(
      {
        actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
        actorId: auth.user.id,
        action: 'package.created',
        targetType: 'package',
        targetId: insertedPkg.id,
        outcome: 'success',
        metadata: {
          package_id: insertedPkg.id,
          slug: insertedPkg.slug,
          name: insertedPkg.name,
          base_price_minor: insertedPkg.basePriceMinor,
          currency: insertedPkg.currency,
          tax_rate_basis_points: insertedPkg.taxRateBasisPoints,
          is_active: insertedPkg.isActive,
          item_count: insertedItems.length,
        },
      },
      tx,
    );

    return {
      ...insertedPkg,
      includedItems: insertedItems,
    };
  };

  return client.transaction(executeInTransaction);
}

/**
 * Updates an existing package and optionally replaces its deliverables.
 * Emits package.updated audit event.
 */
export async function updatePackage(
  id: string,
  rawInput: UpdatePackageInput,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<PackageWithIncludedItems> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);
  const validated = updatePackageSchema.parse(rawInput);

  const existing = await getPackageById(id, { auth, client });
  if (!existing) {
    throw new Error(`Package not found: ${id}`);
  }

  const executeInTransaction = async (tx: DbClient): Promise<PackageWithIncludedItems> => {
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
    if (validated.projectTypeKey !== undefined) {
      updatePayload.projectTypeKey = validated.projectTypeKey;
      changedFields.push('projectTypeKey');
    }
    if (validated.basePriceMinor !== undefined) {
      updatePayload.basePriceMinor = validated.basePriceMinor;
      changedFields.push('basePriceMinor');
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

    const [updatedPkg] = await tx
      .update(packages)
      .set(updatePayload)
      .where(eq(packages.id, id))
      .returning();

    if (!updatedPkg) {
      throw new Error(`Failed to update package: ${id}`);
    }

    let items = existing.includedItems;
    if (validated.includedItems !== undefined) {
      // Replace deliverables
      await tx.delete(packageIncludedItems).where(eq(packageIncludedItems.packageId, id));

      if (validated.includedItems.length > 0) {
        items = await tx
          .insert(packageIncludedItems)
          .values(
            validated.includedItems.map((item, index) => ({
              id: item.id ?? generateUuidV7(),
              packageId: id,
              title: item.title,
              description: item.description ?? null,
              quantity: item.quantity,
              position: item.position ?? index,
              createdAt: now,
              updatedAt: now,
            })),
          )
          .returning();
      } else {
        items = [];
      }
      changedFields.push('includedItems');
    }

    await audit(
      {
        actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
        actorId: auth.user.id,
        action: 'package.updated',
        targetType: 'package',
        targetId: updatedPkg.id,
        outcome: 'success',
        metadata: {
          package_id: updatedPkg.id,
          slug: updatedPkg.slug,
          name: updatedPkg.name,
          base_price_minor: updatedPkg.basePriceMinor,
          currency: updatedPkg.currency,
          tax_rate_basis_points: updatedPkg.taxRateBasisPoints,
          is_active: updatedPkg.isActive,
          item_count: items.length,
          changed_fields: changedFields,
        },
      },
      tx,
    );

    return {
      ...updatedPkg,
      includedItems: items,
    };
  };

  return client.transaction(executeInTransaction);
}

/**
 * Soft deletes (deactivates) a package by setting is_active = false.
 * Emits package.deleted audit event.
 */
export async function deletePackage(
  id: string,
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<Package> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const existing = await getPackageById(id, { auth, client });
  if (!existing) {
    throw new Error(`Package not found: ${id}`);
  }

  const [updated] = await client
    .update(packages)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(eq(packages.id, id))
    .returning();

  if (!updated) {
    throw new Error(`Failed to delete package: ${id}`);
  }

  await audit(
    {
      actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
      actorId: auth.user.id,
      action: 'package.deleted',
      targetType: 'package',
      targetId: updated.id,
      outcome: 'success',
      metadata: {
        package_id: updated.id,
        slug: updated.slug,
      },
    },
    client,
  );

  return updated;
}

/**
 * Atomically replaces all included items for a package.
 */
export async function setPackageIncludedItems(
  packageId: string,
  rawItems: PackageIncludedItemInput[],
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<PackageIncludedItem[]> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const parsedItems = rawItems.map((item) => packageIncludedItemInputSchema.parse(item));
  const pkg = await getPackageById(packageId, { auth, client });
  if (!pkg) {
    throw new Error(`Package not found: ${packageId}`);
  }

  const executeInTransaction = async (tx: DbClient): Promise<PackageIncludedItem[]> => {
    const now = new Date();
    await tx.delete(packageIncludedItems).where(eq(packageIncludedItems.packageId, packageId));

    let inserted: PackageIncludedItem[] = [];
    if (parsedItems.length > 0) {
      inserted = await tx
        .insert(packageIncludedItems)
        .values(
          parsedItems.map((item, index) => ({
            id: item.id ?? generateUuidV7(),
            packageId,
            title: item.title,
            description: item.description ?? null,
            quantity: item.quantity,
            position: item.position ?? index,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .returning();
    }

    await audit(
      {
        actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
        actorId: auth.user.id,
        action: 'package.updated',
        targetType: 'package',
        targetId: packageId,
        outcome: 'success',
        metadata: {
          package_id: packageId,
          slug: pkg.slug,
          item_count: inserted.length,
          changed_fields: ['includedItems'],
        },
      },
      tx,
    );

    return inserted;
  };

  return client.transaction(executeInTransaction);
}

/**
 * Reorders included deliverables for a package by updating their position field.
 */
export async function reorderPackageIncludedItems(
  packageId: string,
  orderedItemIds: string[],
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<PackageIncludedItem[]> {
  const { auth, client } = await resolveRepoAuth(authOrOptions, explicitClient);

  const pkg = await getPackageById(packageId, { auth, client });
  if (!pkg) {
    throw new Error(`Package not found: ${packageId}`);
  }

  const executeInTransaction = async (tx: DbClient): Promise<PackageIncludedItem[]> => {
    const now = new Date();
    for (let position = 0; position < orderedItemIds.length; position++) {
      const itemId = orderedItemIds[position];
      if (itemId) {
        await tx
          .update(packageIncludedItems)
          .set({ position, updatedAt: now })
          .where(
            and(eq(packageIncludedItems.id, itemId), eq(packageIncludedItems.packageId, packageId)),
          );
      }
    }

    const updated = await tx
      .select()
      .from(packageIncludedItems)
      .where(eq(packageIncludedItems.packageId, packageId))
      .orderBy(asc(packageIncludedItems.position));

    await audit(
      {
        actorType: auth.authType === 'apiKey' ? 'token' : 'owner',
        actorId: auth.user.id,
        action: 'package.updated',
        targetType: 'package',
        targetId: packageId,
        outcome: 'success',
        metadata: {
          package_id: packageId,
          slug: pkg.slug,
          item_count: updated.length,
          changed_fields: ['includedItems.reorder'],
        },
      },
      tx,
    );

    return updated;
  };

  return client.transaction(executeInTransaction);
}
