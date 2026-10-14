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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';
import { generateUuidV7 } from '@/lib/id';
import { clients, clientContacts } from './clients';
import { leads } from './leads';

export const PIPELINE_STAGE_CATEGORIES = [
  'inquiry',
  'booked',
  'in_progress',
  'review',
  'completed',
  'archived',
] as const;
export type PipelineStageCategory = (typeof PIPELINE_STAGE_CATEGORIES)[number];

/**
 * Pipeline stages table (TASK-0033 / ADR-0016 §1.1).
 * Defines sequential stages of the studio photography pipeline.
 */
export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    key: varchar('key', { length: 32 }).notNull().unique(),
    name: varchar('name', { length: 100 }).notNull(),
    position: integer('position').notNull().unique(),
    category: varchar('category', { length: 20 }).notNull().$type<PipelineStageCategory>(),
    color: varchar('color', { length: 32 }).notNull().default('neutral'),
    isSystem: boolean('is_system').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  () => [
    check(
      'pipeline_stages_category_check',
      sql`category IN ('inquiry', 'booked', 'in_progress', 'review', 'completed', 'archived')`,
    ),
  ],
);

export type PipelineStage = typeof pipelineStages.$inferSelect;
export type NewPipelineStage = typeof pipelineStages.$inferInsert;

/**
 * Projects table (TASK-0033 / ADR-0016 §1.2).
 * Core project entity representing a client photography commission.
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    stageId: uuid('stage_id')
      .notNull()
      .references((): AnyPgColumn => pipelineStages.id, { onDelete: 'restrict' }),
    title: varchar('title', { length: 200 }).notNull(),
    projectTypeKey: varchar('project_type_key', { length: 40 }).notNull().default('general'),
    leadId: uuid('lead_id').references((): AnyPgColumn => leads.id, { onDelete: 'set null' }),
    primaryShootStartsAt: timestamp('primary_shoot_starts_at', {
      withTimezone: true,
      mode: 'date',
    }),
    primaryShootTimezone: varchar('primary_shoot_timezone', { length: 64 }),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    priceMinor: bigint('price_minor', { mode: 'number' }),
    notes: text('notes'),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('projects_client_id_idx').on(table.clientId),
    index('projects_stage_id_idx').on(table.stageId),
    index('projects_primary_shoot_starts_at_idx').on(table.primaryShootStartsAt),
    index('projects_last_activity_at_idx').on(table.lastActivityAt),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

/**
 * Shoots table (TASK-0033 / ADR-0016 §1.3).
 * Represents photography sessions associated with a project.
 */
export const shoots = pgTable(
  'shoots',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull().default('Shoot'),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Europe/Berlin'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('shoots_project_id_idx').on(table.projectId),
    index('shoots_starts_at_idx').on(table.startsAt),
  ],
);

export type Shoot = typeof shoots.$inferSelect;
export type NewShoot = typeof shoots.$inferInsert;

/**
 * Shoot locations table (TASK-0033 / ADR-0016 §1.4).
 * Physical locations where shoots take place.
 */
export const shootLocations = pgTable(
  'shoot_locations',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    shootId: uuid('shoot_id')
      .notNull()
      .references(() => shoots.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    addressLine1: varchar('address_line1', { length: 200 }),
    addressLine2: varchar('address_line2', { length: 200 }),
    postalCode: varchar('postal_code', { length: 20 }),
    city: varchar('city', { length: 100 }),
    countryCode: char('country_code', { length: 2 }),
    notes: text('notes'),
    order: integer('order').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('shoot_locations_shoot_id_idx').on(table.shootId)],
);

export type ShootLocation = typeof shootLocations.$inferSelect;
export type NewShootLocation = typeof shootLocations.$inferInsert;

/**
 * Shoot timeline items table (TASK-0033 / ADR-0016 §1.5).
 * Day-of run-of-show schedule items for a shoot.
 */
export const shootTimelineItems = pgTable(
  'shoot_timeline_items',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    shootId: uuid('shoot_id')
      .notNull()
      .references(() => shoots.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').references((): AnyPgColumn => shootLocations.id, {
      onDelete: 'set null',
    }),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    order: integer('order').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('shoot_timeline_items_shoot_id_idx').on(table.shootId),
    index('shoot_timeline_items_starts_at_idx').on(table.startsAt),
  ],
);

export type ShootTimelineItem = typeof shootTimelineItems.$inferSelect;
export type NewShootTimelineItem = typeof shootTimelineItems.$inferInsert;

/**
 * Project participants table (TASK-0033 / ADR-0016 §1.6).
 * People and external collaborators associated with a project commission.
 */
export const projectParticipants = pgTable(
  'project_participants',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => clientContacts.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    role: varchar('role', { length: 100 }).notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'project_participants_contact_or_name_check',
      sql`(contact_id IS NOT NULL) OR (name IS NOT NULL AND length(trim(name)) > 0)`,
    ),
    index('project_participants_project_id_idx').on(table.projectId),
    index('project_participants_contact_id_idx').on(table.contactId),
  ],
);

export type ProjectParticipant = typeof projectParticipants.$inferSelect;
export type NewProjectParticipant = typeof projectParticipants.$inferInsert;

/**
 * Stage task templates table (TASK-0033 / ADR-0016 §1.7).
 * Default checklist tasks configured per pipeline stage.
 */
export const stageTaskTemplates = pgTable(
  'stage_task_templates',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    stageId: uuid('stage_id')
      .notNull()
      .references((): AnyPgColumn => pipelineStages.id, { onDelete: 'cascade' }),
    projectTypeKey: varchar('project_type_key', { length: 40 }),
    title: varchar('title', { length: 255 }).notNull(),
    order: integer('order').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('stage_task_templates_stage_id_idx').on(table.stageId)],
);

export type StageTaskTemplate = typeof stageTaskTemplates.$inferSelect;
export type NewStageTaskTemplate = typeof stageTaskTemplates.$inferInsert;

/**
 * Project tasks table (TASK-0033 / ADR-0016 §1.7).
 * Project-specific task checklist instances.
 */
export const projectTasks = pgTable(
  'project_tasks',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    stageId: uuid('stage_id').references((): AnyPgColumn => pipelineStages.id, {
      onDelete: 'set null',
    }),
    title: varchar('title', { length: 255 }).notNull(),
    isCompleted: boolean('is_completed').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    dueDate: timestamp('due_date', { withTimezone: true, mode: 'date' }),
    order: integer('order').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('project_tasks_project_id_idx').on(table.projectId),
    index('project_tasks_stage_id_idx').on(table.stageId),
  ],
);

export type ProjectTask = typeof projectTasks.$inferSelect;
export type NewProjectTask = typeof projectTasks.$inferInsert;

// --- Drizzle Relations ---

export const pipelineStagesRelations = relations(pipelineStages, ({ many }) => ({
  projects: many(projects),
  stageTaskTemplates: many(stageTaskTemplates),
  projectTasks: many(projectTasks),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  client: one(clients, {
    fields: [projects.clientId],
    references: [clients.id],
  }),
  stage: one(pipelineStages, {
    fields: [projects.stageId],
    references: [pipelineStages.id],
  }),
  lead: one(leads, {
    fields: [projects.leadId],
    references: [leads.id],
  }),
  shoots: many(shoots),
  participants: many(projectParticipants),
  tasks: many(projectTasks),
}));

export const shootsRelations = relations(shoots, ({ one, many }) => ({
  project: one(projects, {
    fields: [shoots.projectId],
    references: [projects.id],
  }),
  locations: many(shootLocations),
  timelineItems: many(shootTimelineItems),
}));

export const shootLocationsRelations = relations(shootLocations, ({ one, many }) => ({
  shoot: one(shoots, {
    fields: [shootLocations.shootId],
    references: [shoots.id],
  }),
  timelineItems: many(shootTimelineItems),
}));

export const shootTimelineItemsRelations = relations(shootTimelineItems, ({ one }) => ({
  shoot: one(shoots, {
    fields: [shootTimelineItems.shootId],
    references: [shoots.id],
  }),
  location: one(shootLocations, {
    fields: [shootTimelineItems.locationId],
    references: [shootLocations.id],
  }),
}));

export const projectParticipantsRelations = relations(projectParticipants, ({ one }) => ({
  project: one(projects, {
    fields: [projectParticipants.projectId],
    references: [projects.id],
  }),
  contact: one(clientContacts, {
    fields: [projectParticipants.contactId],
    references: [clientContacts.id],
  }),
}));

export const stageTaskTemplatesRelations = relations(stageTaskTemplates, ({ one }) => ({
  stage: one(pipelineStages, {
    fields: [stageTaskTemplates.stageId],
    references: [pipelineStages.id],
  }),
}));

export const projectTasksRelations = relations(projectTasks, ({ one }) => ({
  project: one(projects, {
    fields: [projectTasks.projectId],
    references: [projects.id],
  }),
  stage: one(pipelineStages, {
    fields: [projectTasks.stageId],
    references: [pipelineStages.id],
  }),
}));
