import { z } from 'zod';

export const setupOwnerInputSchema = z.object({
  setupToken: z.string().max(512).optional().default(''),
  name: z.string().max(255),
  email: z.string().max(255),
  password: z.string(),
});

export type SetupOwnerActionInput = z.input<typeof setupOwnerInputSchema>;
