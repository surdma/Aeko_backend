import { z } from 'zod';

export const callSignalSchema = z
  .object({
    target: z.string().min(1).max(256),
    offer: z.string().min(1).max(1_000_000).optional(),
    answer: z.string().min(1).max(1_000_000).optional(),
    candidate: z.string().min(1).max(1_000_000).optional(),
  })
  .strict()
  .refine(
    (signal) =>
      signal.offer !== undefined ||
      signal.answer !== undefined ||
      signal.candidate !== undefined,
    { message: 'A call offer, answer, or ICE candidate is required' },
  );
export type CallSignal = z.infer<typeof callSignalSchema>;
