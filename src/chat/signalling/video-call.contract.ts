import { z } from 'zod';

export const callSignalSchema = z
  .object({
    chatId: z.string().min(1).max(128),
    targetUserId: z.string().min(1).max(128),
    offer: z.string().min(1).max(65_536).optional(),
    answer: z.string().min(1).max(65_536).optional(),
    candidate: z.string().min(1).max(16_384).optional(),
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
