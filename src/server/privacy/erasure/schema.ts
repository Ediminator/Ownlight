import { z } from 'zod';

export const erasureSubjectSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('client'),
      clientId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('contact'),
      clientId: z.string().uuid(),
      contactId: z.string().uuid(),
    })
    .strict(),
]);

export type ErasureSubjectInput = z.infer<typeof erasureSubjectSchema>;

export const planErasureInputSchema = z
  .object({
    subject: erasureSubjectSchema,
  })
  .strict();

export type PlanErasureInput = z.infer<typeof planErasureInputSchema>;

export const executeErasureInputSchema = z
  .object({
    subject: erasureSubjectSchema,
    confirmation: z.string().min(1).max(200),
  })
  .strict();

export type ExecuteErasureInput = z.infer<typeof executeErasureInputSchema>;
