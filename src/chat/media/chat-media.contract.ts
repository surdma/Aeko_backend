import { z } from 'zod';

export const MAX_CHAT_MEDIA_BYTES = 100 * 1024 * 1024;
export const chatMediaMetadataSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(255),
    size: z.number().int().positive().max(MAX_CHAT_MEDIA_BYTES),
    caption: z.string().max(65_536).optional(),
  })
  .strict();
export type ChatMediaMetadata = z.infer<typeof chatMediaMetadataSchema>;
export const voiceMessageSchema = z
  .object({
    url: z.string().url().max(2_048),
    duration: z.number().positive().max(86_400),
    waveform: z.array(z.number().finite()).max(20_000),
  })
  .strict();
export type VoiceMessage = z.infer<typeof voiceMessageSchema>;
