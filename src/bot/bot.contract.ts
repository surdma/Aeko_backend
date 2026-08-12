import { z } from 'zod';

const botPersonalitySchema = z.enum([
  'friendly',
  'professional',
  'sarcastic',
  'creative',
  'analytical',
  'mentor',
  'companion',
]);

export const botCommandSchema = z
  .object({
    message: z.string().trim().min(1).max(65_536),
    chatId: z.string().uuid().optional(),
    personality: botPersonalitySchema.optional(),
    instruction: z.string().trim().max(4_000).optional(),
  })
  .strict();
export type BotCommand = z.infer<typeof botCommandSchema>;

export const botSettingsSchema = z
  .object({
    botEnabled: z.boolean(),
    botPersonality: botPersonalitySchema,
    aiProvider: z.enum(['openai', 'claude', 'cohere', 'local']).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    maxTokens: z.number().int().min(1).max(32_000).optional(),
    contextLength: z.number().int().min(1).max(100).optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict();
export const rateBotResponseSchema = z
  .object({
    conversationId: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    feedback: z.string().trim().max(4_000).optional(),
  })
  .strict();
export const imagePromptSchema = z.object({ prompt: z.string().trim().min(1).max(4_000) }).strict();
