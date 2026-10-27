import {
  pgTable,
  uuid,
  varchar,
  char,
  boolean,
  integer,
  bigint,
  text,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';
import { generateUuidV7 } from '@/lib/id';

export const CATALOGUE_CATEGORIES = ['service', 'product', 'travel', 'licensing'] as const;
export type CatalogueCategory = (typeof CATALOGUE_CATEGORIES)[number];

/**
 * Packages table (TASK-0056 / ADR-0018 §1.2).
 * Represents structured photography service packages offered by the studio.
 */
export const packages = pgTable(
  'packages',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    name: varchar('name', { length: 150 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    description: text('description'),
    projectTypeKey: varchar('project_type_key', { length: 40 }),
    basePriceMinor: bigint('base_price_minor', { mode: 'number' }).notNull().default(0),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    taxRateBasisPoints: integer('tax_rate_basis_points').notNull().default(1900),
    position: integer('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('packages_is_active_idx').on(table.isActive),
    index('packages_position_idx').on(table.position),
    index('packages_project_type_key_idx').on(table.projectTypeKey),
  ],
);

export type Package = typeof packages.$inferSelect;
export type NewPackage = typeof packages.$inferInsert;

/**
 * Package included items table (TASK-0056 / ADR-0018 §1.3).
 * Defines deliverables and features bundled into a base package.
 */
export const packageIncludedItems = pgTable(
  'package_included_items',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    packageId: uuid('package_id')
      .notNull()
      .references(() => packages.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    quantity: integer('quantity').notNull().default(1),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('package_included_items_package_id_idx').on(table.packageId),
    index('package_included_items_position_idx').on(table.packageId, table.position),
  ],
);

export type PackageIncludedItem = typeof packageIncludedItems.$inferSelect;
export type NewPackageIncludedItem = typeof packageIncludedItems.$inferInsert;

/**
 * Catalogue items table (TASK-0056 / ADR-0018 §1.4).
 * Standalone products, add-on services, and equipment rentals available across proposals.
 */
export const catalogueItems = pgTable(
  'catalogue_items',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    name: varchar('name', { length: 150 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    description: text('description'),
    category: varchar('category', { length: 32 })
      .notNull()
      .default('service')
      .$type<CatalogueCategory>(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'number' }).notNull().default(0),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    taxRateBasisPoints: integer('tax_rate_basis_points').notNull().default(1900),
    position: integer('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'catalogue_items_category_check',
      sql`category IN ('service', 'product', 'travel', 'licensing')`,
    ),
    index('catalogue_items_is_active_idx').on(table.isActive),
    index('catalogue_items_category_idx').on(table.category),
    index('catalogue_items_position_idx').on(table.position),
  ],
);

export type CatalogueItem = typeof catalogueItems.$inferSelect;
export type NewCatalogueItem = typeof catalogueItems.$inferInsert;

// --- Drizzle Relations ---

export const packagesRelations = relations(packages, ({ many }) => ({
  includedItems: many(packageIncludedItems),
}));

export const packageIncludedItemsRelations = relations(packageIncludedItems, ({ one }) => ({
  package: one(packages, {
    fields: [packageIncludedItems.packageId],
    references: [packages.id],
  }),
}));
