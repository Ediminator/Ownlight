import { z } from 'zod';

export const addNoteInputSchema = z
  .object({
    clientId: z.string().uuid(),
    body: z
      .string()
      .min(1)
      .max(5000)
      .refine((val) => val.trim().length > 0, {
        message: 'bodyRequired',
      }),
  })
  .strict();

export type AddNoteInput = z.infer<typeof addNoteInputSchema>;

export const updateNoteInputSchema = z
  .object({
    clientId: z.string().uuid(),
    noteId: z.string().uuid(),
    body: z
      .string()
      .min(1)
      .max(5000)
      .refine((val) => val.trim().length > 0, {
        message: 'bodyRequired',
      }),
  })
  .strict();

export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;

export const deleteNoteInputSchema = z
  .object({
    clientId: z.string().uuid(),
    noteId: z.string().uuid(),
  })
  .strict();

export type DeleteNoteInput = z.infer<typeof deleteNoteInputSchema>;

export const listTimelineInputSchema = z
  .object({
    clientId: z.string().uuid(),
    cursor: z.string().optional(),
  })
  .strict();

export type ListTimelineInput = z.infer<typeof listTimelineInputSchema>;
