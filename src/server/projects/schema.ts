import { z } from 'zod';

/**
 * Validates that a string is a recognized IANA timezone identifier.
 */
export function isValidIanaTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .trim()
  .min(1, 'Timezone cannot be empty')
  .max(64, 'Timezone identifier cannot exceed 64 characters')
  .refine(isValidIanaTimezone, { message: 'Invalid IANA timezone string' });

// --- Project Schemas ---

export const createProjectSchema = z
  .object({
    clientId: z.string().uuid('Invalid client ID format'),
    title: z
      .string()
      .trim()
      .min(1, 'Project title is required')
      .max(200, 'Project title cannot exceed 200 characters'),
    projectTypeKey: z
      .string()
      .trim()
      .min(1, 'Project type key is required')
      .max(40, 'Project type key cannot exceed 40 characters')
      .default('general')
      .optional(),
    stageId: z.string().uuid('Invalid stage ID format').optional(),
    priceMinor: z
      .number()
      .int('Price must be an integer')
      .min(0, 'Price cannot be negative')
      .nullable()
      .optional(),
    currency: z
      .string()
      .trim()
      .length(3, 'Currency must be a 3-letter ISO code')
      .default('EUR')
      .optional(),
    notes: z.string().trim().max(5000, 'Notes cannot exceed 5000 characters').nullable().optional(),
    shootStartsAt: z.coerce.date().optional(),
    shootTimezone: timezoneSchema.default('Europe/Berlin').optional(),
    shootLocation: z
      .string()
      .trim()
      .max(200, 'Shoot location cannot exceed 200 characters')
      .optional(),
  })
  .strict();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    projectId: z.string().uuid('Invalid project ID format'),
    title: z
      .string()
      .trim()
      .min(1, 'Project title cannot be empty')
      .max(200, 'Project title cannot exceed 200 characters')
      .optional(),
    projectTypeKey: z
      .string()
      .trim()
      .min(1, 'Project type key cannot be empty')
      .max(40, 'Project type key cannot exceed 40 characters')
      .optional(),
    stageId: z.string().uuid('Invalid stage ID format').optional(),
    priceMinor: z
      .number()
      .int('Price must be an integer')
      .min(0, 'Price cannot be negative')
      .nullable()
      .optional(),
    currency: z.string().trim().length(3, 'Currency must be a 3-letter ISO code').optional(),
    notes: z.string().trim().max(5000, 'Notes cannot exceed 5000 characters').nullable().optional(),
  })
  .strict();

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const transitionStageSchema = z
  .object({
    projectId: z.string().uuid('Invalid project ID format'),
    targetStageId: z.string().uuid('Invalid target stage ID format'),
  })
  .strict();

export type TransitionStageInput = z.infer<typeof transitionStageSchema>;

export const deleteProjectSchema = z
  .object({
    projectId: z.string().uuid('Invalid project ID format'),
  })
  .strict();

export type DeleteProjectInput = z.infer<typeof deleteProjectSchema>;

// --- Shoot Schemas ---

export const createShootSchema = z
  .object({
    projectId: z.string().uuid('Invalid project ID format'),
    title: z
      .string()
      .trim()
      .min(1, 'Shoot title cannot be empty')
      .max(200, 'Shoot title cannot exceed 200 characters')
      .default('Shoot')
      .optional(),
    startsAt: z.coerce.date({ invalid_type_error: 'Invalid startsAt date format' }),
    endsAt: z.coerce
      .date({ invalid_type_error: 'Invalid endsAt date format' })
      .nullable()
      .optional(),
    timezone: timezoneSchema.default('Europe/Berlin').optional(),
    notes: z.string().trim().max(5000, 'Notes cannot exceed 5000 characters').nullable().optional(),
    location: z.string().trim().max(200, 'Location cannot exceed 200 characters').optional(),
  })
  .strict();

export type CreateShootInput = z.infer<typeof createShootSchema>;

export const updateShootSchema = z
  .object({
    shootId: z.string().uuid('Invalid shoot ID format'),
    title: z
      .string()
      .trim()
      .min(1, 'Shoot title cannot be empty')
      .max(200, 'Shoot title cannot exceed 200 characters')
      .optional(),
    startsAt: z.coerce.date({ invalid_type_error: 'Invalid startsAt date format' }).optional(),
    endsAt: z.coerce
      .date({ invalid_type_error: 'Invalid endsAt date format' })
      .nullable()
      .optional(),
    timezone: timezoneSchema.optional(),
    notes: z.string().trim().max(5000, 'Notes cannot exceed 5000 characters').nullable().optional(),
  })
  .strict();

export type UpdateShootInput = z.infer<typeof updateShootSchema>;

export const deleteShootSchema = z
  .object({
    shootId: z.string().uuid('Invalid shoot ID format'),
  })
  .strict();

export type DeleteShootInput = z.infer<typeof deleteShootSchema>;

// --- Shoot Location Schemas ---

export const createShootLocationSchema = z
  .object({
    shootId: z.string().uuid('Invalid shoot ID format'),
    name: z
      .string()
      .trim()
      .min(1, 'Location name is required')
      .max(200, 'Location name cannot exceed 200 characters'),
    addressLine1: z
      .string()
      .trim()
      .max(200, 'Address line 1 cannot exceed 200 characters')
      .nullable()
      .optional(),
    addressLine2: z
      .string()
      .trim()
      .max(200, 'Address line 2 cannot exceed 200 characters')
      .nullable()
      .optional(),
    postalCode: z
      .string()
      .trim()
      .max(20, 'Postal code cannot exceed 20 characters')
      .nullable()
      .optional(),
    city: z.string().trim().max(100, 'City cannot exceed 100 characters').nullable().optional(),
    countryCode: z
      .string()
      .trim()
      .length(2, 'Country code must be 2 characters (ISO 3166-1 alpha-2)')
      .nullable()
      .optional(),
    notes: z.string().trim().max(5000, 'Notes cannot exceed 5000 characters').nullable().optional(),
    order: z.number().int().min(1, 'Order must be positive').default(1).optional(),
  })
  .strict();

export type CreateShootLocationInput = z.infer<typeof createShootLocationSchema>;

export const updateShootLocationSchema = z
  .object({
    locationId: z.string().uuid('Invalid location ID format'),
    name: z
      .string()
      .trim()
      .min(1, 'Location name cannot be empty')
      .max(200, 'Location name cannot exceed 200 characters')
      .optional(),
    addressLine1: z
      .string()
      .trim()
      .max(200, 'Address line 1 cannot exceed 200 characters')
      .nullable()
      .optional(),
    addressLine2: z
      .string()
      .trim()
      .max(200, 'Address line 2 cannot exceed 200 characters')
      .nullable()
      .optional(),
    postalCode: z
      .string()
      .trim()
      .max(20, 'Postal code cannot exceed 20 characters')
      .nullable()
      .optional(),
    city: z.string().trim().max(100, 'City cannot exceed 100 characters').nullable().optional(),
    countryCode: z
      .string()
      .trim()
      .length(2, 'Country code must be 2 characters (ISO 3166-1 alpha-2)')
      .nullable()
      .optional(),
    notes: z.string().trim().max(5000, 'Notes cannot exceed 5000 characters').nullable().optional(),
    order: z.number().int().min(1, 'Order must be positive').optional(),
  })
  .strict();

export type UpdateShootLocationInput = z.infer<typeof updateShootLocationSchema>;

export const deleteShootLocationSchema = z
  .object({
    locationId: z.string().uuid('Invalid location ID format'),
  })
  .strict();

export type DeleteShootLocationInput = z.infer<typeof deleteShootLocationSchema>;

// --- Shoot Timeline Item Schemas ---

export const createShootTimelineItemSchema = z
  .object({
    shootId: z.string().uuid('Invalid shoot ID format'),
    locationId: z.string().uuid('Invalid location ID format').nullable().optional(),
    startsAt: z.coerce.date({ invalid_type_error: 'Invalid startsAt date format' }),
    endsAt: z.coerce
      .date({ invalid_type_error: 'Invalid endsAt date format' })
      .nullable()
      .optional(),
    title: z
      .string()
      .trim()
      .min(1, 'Timeline item title is required')
      .max(200, 'Timeline item title cannot exceed 200 characters'),
    description: z
      .string()
      .trim()
      .max(5000, 'Description cannot exceed 5000 characters')
      .nullable()
      .optional(),
    order: z.number().int().min(1, 'Order must be positive').default(1).optional(),
  })
  .strict();

export type CreateShootTimelineItemInput = z.infer<typeof createShootTimelineItemSchema>;

export const updateShootTimelineItemSchema = z
  .object({
    itemId: z.string().uuid('Invalid item ID format'),
    locationId: z.string().uuid('Invalid location ID format').nullable().optional(),
    startsAt: z.coerce.date({ invalid_type_error: 'Invalid startsAt date format' }).optional(),
    endsAt: z.coerce
      .date({ invalid_type_error: 'Invalid endsAt date format' })
      .nullable()
      .optional(),
    title: z
      .string()
      .trim()
      .min(1, 'Timeline item title cannot be empty')
      .max(200, 'Timeline item title cannot exceed 200 characters')
      .optional(),
    description: z
      .string()
      .trim()
      .max(5000, 'Description cannot exceed 5000 characters')
      .nullable()
      .optional(),
    order: z.number().int().min(1, 'Order must be positive').optional(),
  })
  .strict();

export type UpdateShootTimelineItemInput = z.infer<typeof updateShootTimelineItemSchema>;

export const deleteShootTimelineItemSchema = z
  .object({
    itemId: z.string().uuid('Invalid item ID format'),
  })
  .strict();

export type DeleteShootTimelineItemInput = z.infer<typeof deleteShootTimelineItemSchema>;

// --- Project Participant Schemas ---

export const createProjectParticipantSchema = z
  .object({
    projectId: z.string().uuid('Invalid project ID format'),
    contactId: z.string().uuid('Invalid contact ID format').nullable().optional(),
    name: z
      .string()
      .trim()
      .min(1, 'Participant name cannot be empty')
      .max(200, 'Participant name cannot exceed 200 characters')
      .nullable()
      .optional(),
    email: z
      .string()
      .trim()
      .email('Invalid email address')
      .max(255, 'Email cannot exceed 255 characters')
      .nullable()
      .optional(),
    phone: z.string().trim().max(50, 'Phone cannot exceed 50 characters').nullable().optional(),
    role: z
      .string()
      .trim()
      .min(1, 'Participant role is required')
      .max(100, 'Participant role cannot exceed 100 characters'),
    isPrimary: z.boolean().default(false).optional(),
    notes: z.string().trim().max(5000, 'Notes cannot exceed 5000 characters').nullable().optional(),
  })
  .strict()
  .refine((data) => Boolean(data.contactId) || Boolean(data.name && data.name.trim().length > 0), {
    message: 'Participant requires either contactId or a valid name',
    path: ['name'],
  });

export type CreateProjectParticipantInput = z.infer<typeof createProjectParticipantSchema>;

export const deleteProjectParticipantSchema = z
  .object({
    participantId: z.string().uuid('Invalid participant ID format'),
  })
  .strict();

export type DeleteProjectParticipantInput = z.infer<typeof deleteProjectParticipantSchema>;

// --- Project Task Schemas ---

export const createProjectTaskSchema = z
  .object({
    projectId: z.string().uuid('Invalid project ID format'),
    stageId: z.string().uuid('Invalid stage ID format').nullable().optional(),
    title: z
      .string()
      .trim()
      .min(1, 'Task title is required')
      .max(255, 'Task title cannot exceed 255 characters'),
    dueDate: z.coerce.date({ invalid_type_error: 'Invalid dueDate format' }).nullable().optional(),
    order: z.number().int().min(1, 'Order must be positive').default(1).optional(),
  })
  .strict();

export type CreateProjectTaskInput = z.infer<typeof createProjectTaskSchema>;

export const toggleProjectTaskSchema = z
  .object({
    taskId: z.string().uuid('Invalid task ID format'),
  })
  .strict();

export type ToggleProjectTaskInput = z.infer<typeof toggleProjectTaskSchema>;

export const deleteProjectTaskSchema = z
  .object({
    taskId: z.string().uuid('Invalid task ID format'),
  })
  .strict();

export type DeleteProjectTaskInput = z.infer<typeof deleteProjectTaskSchema>;
