import { z } from 'zod';

export const MAX_CHAT_PAGE_SIZE = 100;
export const MAX_SEARCH_PAGE_SIZE = 100;

const idSchema = z.string().uuid();
const nonEmptyTextSchema = z.string().trim().min(1).max(65_536);
const paginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_CHAT_PAGE_SIZE).default(20),
  })
  .strict();

export const sendMessageSchema = z
  .object({
    chatId: idSchema,
    receiverId: idSchema.optional(),
    content: nonEmptyTextSchema,
    clientMessageId: idSchema.optional(),
    replyToId: idSchema.optional(),
    attachments: z.array(idSchema).max(10).default([]),
  })
  .strict();

export interface SendMessageCommand extends z.infer<typeof sendMessageSchema> {
  readonly principalId: string;
}

/** The untrusted public input, deliberately excluding the authenticated principal. */
export interface ChatCommand {
  readonly chatId: string;
  readonly receiverId?: string;
  readonly content: string;
  readonly clientMessageId: string | undefined;
  readonly replyToId?: string;
  readonly attachments?: readonly string[];
}

export interface ChatAck {
  readonly success: true;
  readonly messageId: string;
  readonly clientMessageId?: string;
  readonly timestamp: string;
}

export interface WsPublicError {
  readonly code:
    | 'AUTHENTICATION_REQUIRED'
    | 'FORBIDDEN'
    | 'INVALID_PAYLOAD'
    | 'NOT_FOUND'
    | 'RATE_LIMITED'
    | 'UNAVAILABLE';
  readonly message: string;
}

export interface ChatPublicView {
  readonly id: string;
  readonly chatId: string;
  readonly senderId: string;
  readonly receiverId: string | null;
  readonly content: string | null;
  readonly messageType: string;
  readonly status: string;
  readonly createdAt: string;
  readonly sender: {
    readonly id: string;
    readonly name: string;
    readonly username: string;
    readonly profilePicture: string | null;
    readonly avatar: string | null;
    readonly blueTick: boolean;
    readonly goldenTick: boolean;
  };
}

export const messagePublicViewSchema = z
  .object({
    id: idSchema,
    chatId: idSchema,
    senderId: idSchema,
    receiverId: idSchema.nullable(),
    content: z.string().nullable(),
    messageType: z.string().min(1).max(64),
    status: z.string().min(1).max(64),
    createdAt: z.string().datetime(),
    sender: z
      .object({
        id: idSchema,
        name: z.string().max(200),
        username: z.string().max(200),
        profilePicture: z.string().url().max(2_048).nullable(),
        avatar: z.string().url().max(2_048).nullable(),
        blueTick: z.boolean(),
        goldenTick: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const createChatSchema = z
  .object({
    participants: z.array(idSchema).min(1).max(100),
    isGroup: z.boolean().default(false),
    groupName: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export const reactionSchema = z.object({ emoji: z.string().trim().min(1).max(32) }).strict();
export const messageQuerySchema = paginationSchema.extend({ before: idSchema.optional() }).strict();
export const searchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(256),
    chatId: idSchema.optional(),
    messageType: z.string().trim().min(1).max(64).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_SEARCH_PAGE_SIZE).default(20),
  })
  .strict();
export const uploadVoiceSchema = z
  .object({ receiverId: idSchema, chatId: idSchema, duration: z.coerce.number().positive().max(86_400), waveform: z.string().max(100_000).optional() })
  .strict();
export const uploadFileSchema = z.object({ receiverId: idSchema, chatId: idSchema, caption: z.string().max(65_536).optional() }).strict();
export const assistSchema = z
  .object({ input: z.string().max(65_536).optional(), type: z.enum(['improve', 'suggest_reply']).default('improve'), chatId: idSchema.optional(), tone: z.enum(['friendly', 'professional', 'sarcastic', 'creative']).default('professional') })
  .strict();

export const parseSendMessage = (input: unknown): ChatCommand => {
  const command = sendMessageSchema.parse(input);
  const base: ChatCommand = {
    chatId: command.chatId,
    content: command.content,
    clientMessageId: command.clientMessageId,
  };
  return {
    ...base,
    ...(command.receiverId === undefined ? {} : { receiverId: command.receiverId }),
    ...(command.replyToId === undefined ? {} : { replyToId: command.replyToId }),
    ...(command.attachments.length === 0 ? {} : { attachments: command.attachments }),
  };
};

export const REST_CAPABILITY_IDS = [
  'rest:DELETE:/api/enhanced-chat/conversations/:chatId:routes/enhancedChatRoutes.js:1192',
  'rest:DELETE:/api/enhanced-chat/emoji-reactions/:messageId:routes/enhancedChatRoutes.js:634',
  'rest:DELETE:/api/enhanced-chat/groups/:chatId/leave:routes/enhancedChatRoutes.js:1580',
  'rest:DELETE:/api/enhanced-chat/groups/:chatId/members/:userId:routes/enhancedChatRoutes.js:1520',
  'rest:DELETE:/api/enhanced-chat/messages/:messageId:routes/enhancedChatRoutes.js:1138',
  'rest:GET:/api/enhanced-bot/analytics:routes/enhancedBotRoutes.js:334',
  'rest:GET:/api/enhanced-bot/conversation-history:routes/enhancedBotRoutes.js:292',
  'rest:GET:/api/enhanced-bot/personalities:routes/enhancedBotRoutes.js:220',
  'rest:GET:/api/enhanced-bot/settings:routes/enhancedBotRoutes.js:126',
  'rest:GET:/api/enhanced-chat/conversations:routes/enhancedChatRoutes.js:88',
  'rest:GET:/api/enhanced-chat/emoji-list:routes/enhancedChatRoutes.js:1099',
  'rest:GET:/api/enhanced-chat/groups/:chatId/invite:routes/enhancedChatRoutes.js:1378',
  'rest:GET:/api/enhanced-chat/messages/:chatId:routes/enhancedChatRoutes.js:215',
  'rest:GET:/api/enhanced-chat/search:routes/enhancedChatRoutes.js:1040',
  'rest:GET:/api/enhanced-chat/uploads/:folder/:filename:routes/enhancedChatRoutes.js:1639',
  'rest:GET:/api/enhanced-chat/users:routes/enhancedChatRoutes.js:1249',
  'rest:POST:/api/chat/chat:routes/chat.js:179',
  'rest:POST:/api/chat/send-message:routes/chat.js:44',
  'rest:POST:/api/enhanced-bot/chat:routes/enhancedBotRoutes.js:62',
  'rest:POST:/api/enhanced-bot/generate-image:routes/enhancedBotRoutes.js:417',
  'rest:POST:/api/enhanced-bot/rate-response:routes/enhancedBotRoutes.js:503',
  'rest:POST:/api/enhanced-bot/summarize-conversation:routes/enhancedBotRoutes.js:460',
  'rest:POST:/api/enhanced-chat/assist:routes/enhancedChatRoutes.js:813',
  'rest:POST:/api/enhanced-chat/bot-chat:routes/enhancedChatRoutes.js:699',
  'rest:POST:/api/enhanced-chat/create-chat:routes/enhancedChatRoutes.js:872',
  'rest:POST:/api/enhanced-chat/emoji-reactions/:messageId:routes/enhancedChatRoutes.js:565',
  'rest:POST:/api/enhanced-chat/groups/:chatId/icon:routes/enhancedChatRoutes.js:1315',
  'rest:POST:/api/enhanced-chat/groups/join/:inviteCode:routes/enhancedChatRoutes.js:1443',
  'rest:POST:/api/enhanced-chat/mark-read/:chatId:routes/enhancedChatRoutes.js:971',
  'rest:POST:/api/enhanced-chat/send-message:routes/enhancedChatRoutes.js:319',
  'rest:POST:/api/enhanced-chat/upload-file:routes/enhancedChatRoutes.js:470',
  'rest:POST:/api/enhanced-chat/upload-voice:routes/enhancedChatRoutes.js:401',
  'rest:PUT:/api/bot/bot-settings:routes/bot.js:59',
  'rest:PUT:/api/enhanced-bot/settings:routes/enhancedBotRoutes.js:167',
] as const;

type RestCapabilityId = (typeof REST_CAPABILITY_IDS)[number];
const emptyRequestSchema = z.object({}).strict();
export const restRequestSchemas: Readonly<Record<RestCapabilityId, z.ZodType>> =
  Object.freeze(Object.fromEntries(REST_CAPABILITY_IDS.map((id) => [id, emptyRequestSchema])) as Record<RestCapabilityId, z.ZodType>);
