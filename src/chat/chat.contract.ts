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
    messageType: z
      .enum([
        'text',
        'emoji',
        'voice',
        'image',
        'video',
        'file',
        'sticker',
        'ai_response',
      ])
      .default('text'),
    metadata: z.record(z.string().min(1).max(128), z.unknown()).default({}),
    clientId: z.string().trim().min(1).max(256).optional(),
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
  readonly messageType: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly clientId?: string;
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
export const reactionSchema = z
  .object({ emoji: z.string().trim().min(1).max(32) })
  .strict();
export const messageQuerySchema = paginationSchema
  .extend({ before: idSchema.optional() })
  .strict();
export const searchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(256),
    chatId: idSchema.optional(),
    messageType: z.string().trim().min(1).max(64).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_SEARCH_PAGE_SIZE).default(20),
  })
  .strict();
export const uploadVoiceSchema = z
  .object({
    receiverId: idSchema,
    chatId: idSchema,
    duration: z.coerce.number().positive().max(86_400),
    waveform: z.string().max(100_000).optional(),
  })
  .strict();
export const uploadFileSchema = z
  .object({
    receiverId: idSchema,
    chatId: idSchema,
    caption: z.string().max(65_536).optional(),
  })
  .strict();
export const assistSchema = z
  .object({
    input: z.string().max(65_536).optional(),
    type: z.enum(['improve', 'suggest_reply']).default('improve'),
    chatId: idSchema.optional(),
    tone: z
      .enum(['friendly', 'professional', 'sarcastic', 'creative'])
      .default('professional'),
  })
  .strict();

export const parseSendMessage = (input: unknown): ChatCommand => {
  const command = sendMessageSchema.parse(input);
  const base: ChatCommand = {
    chatId: command.chatId,
    content: command.content,
    clientMessageId: command.clientMessageId,
    messageType: command.messageType,
    metadata: command.metadata,
  };
  return {
    ...base,
    ...(command.receiverId === undefined
      ? {}
      : { receiverId: command.receiverId }),
    ...(command.replyToId === undefined
      ? {}
      : { replyToId: command.replyToId }),
    ...(command.attachments.length === 0
      ? {}
      : { attachments: command.attachments }),
    ...(command.clientId === undefined ? {} : { clientId: command.clientId }),
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
const request = (
  body: z.ZodType,
  query: z.ZodType = z.object({}).strict(),
  params: z.ZodType = z.object({}).strict(),
) => z.object({ body, query, params }).strict();
const noInput = z.object({}).strict();
const chatParam = z.object({ chatId: idSchema }).strict();
const messageParam = z.object({ messageId: idSchema }).strict();
const userAndChatParam = z
  .object({ chatId: idSchema, userId: idSchema })
  .strict();
const inviteParam = z
  .object({ inviteCode: z.string().trim().min(1).max(256) })
  .strict();
const paginationQuery = paginationSchema;
const serializer =
  <T extends z.ZodType>(schema: T) =>
  (value: unknown): z.output<T> =>
    schema.parse(value);
const statusSuccessSchema = z
  .object({ success: z.literal(true), message: z.string().max(500).optional() })
  .strict();
export const publicUserSchema = z.object({
  id: idSchema,
  username: z.string().max(100).optional(),
  profilePicture: z.string().url().nullable().optional(),
});
export const publicReactionSchema = z.object({
  userId: idSchema,
  emoji: z.string().max(32),
  username: z.string().max(100).optional(),
});
export const publicMessageSchema = z.object({
  id: idSchema,
  chatId: idSchema.nullable().optional(),
  senderId: idSchema,
  receiverId: idSchema.nullable().optional(),
  content: z.string().nullable().optional(),
  message: z.string().optional(),
  messageType: z.string().max(64).optional(),
  status: z.string().max(64).optional(),
  createdAt: z.union([z.string().datetime(), z.date()]),
  updatedAt: z.union([z.string().datetime(), z.date()]).optional(),
  sender: publicUserSchema.optional(),
  reactions: z.array(publicReactionSchema).optional(),
});
export const publicChatSchema = z.object({
  id: idSchema,
  isGroup: z.boolean(),
  groupName: z.string().nullable().optional(),
  groupIcon: z.string().nullable().optional(),
  createdAt: z.union([z.string().datetime(), z.date()]),
  updatedAt: z.union([z.string().datetime(), z.date()]),
  members: z.array(publicUserSchema).optional(),
  lastMessage: publicMessageSchema.nullable().optional(),
});
export const publicBotSettingsSchema = z.object({
  id: idSchema,
  userId: idSchema,
  botEnabled: z.boolean(),
  botPersonality: z.string(),
  aiProvider: z.string(),
  model: z.string(),
  maxTokens: z.number().int(),
  contextLength: z.number().int(),
  temperature: z.number(),
});
export const publicConversationSchema = z.object({
  id: idSchema,
  userMessage: z.string(),
  botResponse: z.string(),
  personality: z.string(),
  sentiment: z.string(),
  aiProvider: z.string(),
  tokens: z.number().int(),
  confidence: z.number(),
  responseTime: z.number(),
  createdAt: z.union([z.string().datetime(), z.date()]),
});
const messageSuccessSchema = z
  .object({
    success: z.literal(true),
    message: publicMessageSchema,
    messageId: idSchema.optional(),
  })
  .strict();

export interface RestContract {
  readonly request: z.ZodType;
  readonly serializeSuccess: (value: unknown) => unknown;
}

/** Exact public request boundaries and successful-response projections for every legacy REST handler. */
export const restContracts: Readonly<Record<RestCapabilityId, RestContract>> = {
  'rest:DELETE:/api/enhanced-chat/conversations/:chatId:routes/enhancedChatRoutes.js:1192':
    {
      request: request(noInput, noInput, chatParam),
      serializeSuccess: serializer(
        z
          .object({
            success: z.literal(true),
            message: z.literal('Chat deleted successfully'),
            chatId: idSchema,
          })
          .strict(),
      ),
    },
  'rest:DELETE:/api/enhanced-chat/emoji-reactions/:messageId:routes/enhancedChatRoutes.js:634':
    {
      request: request(noInput, reactionSchema, messageParam),
      serializeSuccess: serializer(
        z
          .object({
            success: z.literal(true),
            message: z.literal('Reaction removed successfully'),
            reactions: z.array(publicReactionSchema),
          })
          .strict(),
      ),
    },
  'rest:DELETE:/api/enhanced-chat/groups/:chatId/leave:routes/enhancedChatRoutes.js:1580':
    {
      request: request(noInput, noInput, chatParam),
      serializeSuccess: serializer(statusSuccessSchema),
    },
  'rest:DELETE:/api/enhanced-chat/groups/:chatId/members/:userId:routes/enhancedChatRoutes.js:1520':
    {
      request: request(noInput, noInput, userAndChatParam),
      serializeSuccess: serializer(statusSuccessSchema),
    },
  'rest:DELETE:/api/enhanced-chat/messages/:messageId:routes/enhancedChatRoutes.js:1138':
    {
      request: request(noInput, noInput, messageParam),
      serializeSuccess: serializer(
        z
          .object({
            success: z.literal(true),
            message: z.literal('Message deleted successfully'),
            messageId: idSchema,
          })
          .strict(),
      ),
    },
  'rest:GET:/api/enhanced-bot/analytics:routes/enhancedBotRoutes.js:334': {
    request: request(noInput),
    serializeSuccess: serializer(
      z
        .object({
          userAnalytics: z.object({
            totalConversations: z.number().int().nonnegative().optional(),
            totalTokens: z.number().int().nonnegative().optional(),
            averageResponseTime: z.number().nonnegative().optional(),
          }),
          recentActivity: z.object({
            conversationsLast30Days: z.number().int().nonnegative(),
          }),
        })
        .strict(),
    ),
  },
  'rest:GET:/api/enhanced-bot/conversation-history:routes/enhancedBotRoutes.js:292':
    {
      request: request(noInput, paginationQuery),
      serializeSuccess: serializer(
        z
          .object({
            conversations: z.array(publicConversationSchema),
            pagination: z
              .object({
                currentPage: z.number().int(),
                totalPages: z.number().int(),
                totalConversations: z.number().int(),
                hasNext: z.boolean(),
                hasPrev: z.boolean(),
              })
              .strict(),
          })
          .strict(),
      ),
    },
  'rest:GET:/api/enhanced-bot/personalities:routes/enhancedBotRoutes.js:220': {
    request: request(noInput),
    serializeSuccess: serializer(
      z
        .object({
          personalities: z.record(
            z.string(),
            z.object({ name: z.string(), description: z.string().optional() }),
          ),
        })
        .strict(),
    ),
  },
  'rest:GET:/api/enhanced-bot/settings:routes/enhancedBotRoutes.js:126': {
    request: request(noInput),
    serializeSuccess: serializer(publicBotSettingsSchema),
  },
  'rest:GET:/api/enhanced-chat/conversations:routes/enhancedChatRoutes.js:88': {
    request: request(noInput, paginationQuery),
    serializeSuccess: serializer(
      z
        .object({
          success: z.literal(true),
          conversations: z.array(publicChatSchema),
          pagination: z
            .object({
              page: z.number().int(),
              limit: z.number().int(),
              total: z.number().int(),
            })
            .strict(),
        })
        .strict(),
    ),
  },
  'rest:GET:/api/enhanced-chat/emoji-list:routes/enhancedChatRoutes.js:1099': {
    request: request(noInput),
    serializeSuccess: serializer(
      z
        .object({
          success: z.literal(true),
          categories: z.record(z.string(), z.array(z.string())),
        })
        .strict(),
    ),
  },
  'rest:GET:/api/enhanced-chat/groups/:chatId/invite:routes/enhancedChatRoutes.js:1378':
    {
      request: request(noInput, noInput, chatParam),
      serializeSuccess: serializer(
        z
          .object({
            success: z.literal(true),
            inviteCode: z.string(),
            inviteLink: z.string().url(),
          })
          .strict(),
      ),
    },
  'rest:GET:/api/enhanced-chat/messages/:chatId:routes/enhancedChatRoutes.js:215':
    {
      request: request(noInput, messageQuerySchema, chatParam),
      serializeSuccess: serializer(
        z
          .object({
            success: z.literal(true),
            messages: z.array(publicMessageSchema),
            pagination: z
              .object({
                page: z.number().int(),
                limit: z.number().int(),
                hasMore: z.boolean(),
              })
              .strict(),
          })
          .strict(),
      ),
    },
  'rest:GET:/api/enhanced-chat/search:routes/enhancedChatRoutes.js:1040': {
    request: request(noInput, searchQuerySchema),
    serializeSuccess: serializer(
      z
        .object({
          success: z.literal(true),
          results: z.array(publicMessageSchema),
          count: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  },
  'rest:GET:/api/enhanced-chat/uploads/:folder/:filename:routes/enhancedChatRoutes.js:1639':
    {
      request: request(
        noInput,
        noInput,
        z
          .object({
            folder: z.string().trim().min(1).max(128),
            filename: z.string().trim().min(1).max(255),
          })
          .strict(),
      ),
      serializeSuccess: serializer(
        z.object({
          url: z.string(),
          contentType: z.string().max(255).optional(),
        }),
      ),
    },
  'rest:GET:/api/enhanced-chat/users:routes/enhancedChatRoutes.js:1249': {
    request: request(
      noInput,
      paginationQuery
        .extend({ q: z.string().trim().max(256).optional() })
        .strict(),
    ),
    serializeSuccess: serializer(
      z
        .object({ success: z.literal(true), users: z.array(publicUserSchema) })
        .strict(),
    ),
  },
  'rest:POST:/api/chat/chat:routes/chat.js:179': {
    request: request(z.object({ message: nonEmptyTextSchema }).strict()),
    serializeSuccess: serializer(z.object({ botReply: z.string() }).strict()),
  },
  'rest:POST:/api/chat/send-message:routes/chat.js:44': {
    request: request(
      z.object({ recipientId: idSchema, message: nonEmptyTextSchema }).strict(),
    ),
    serializeSuccess: serializer(
      z.object({ success: z.literal(true) }).strict(),
    ),
  },
  'rest:POST:/api/enhanced-bot/chat:routes/enhancedBotRoutes.js:62': {
    request: request(
      z
        .object({
          message: nonEmptyTextSchema,
          instruction: z.string().max(4_000).optional(),
          personalityOverride: z.string().max(64).optional(),
        })
        .strict(),
    ),
    serializeSuccess: serializer(
      z.object({
        response: z.string(),
        conversationId: idSchema.optional(),
        responseTime: z.number(),
        timestamp: z.string().datetime(),
      }),
    ),
  },
  'rest:POST:/api/enhanced-bot/generate-image:routes/enhancedBotRoutes.js:417':
    {
      request: request(z.object({ prompt: nonEmptyTextSchema }).strict()),
      serializeSuccess: serializer(
        z.object({
          url: z.string().url().optional(),
          revisedPrompt: z.string().optional(),
        }),
      ),
    },
  'rest:POST:/api/enhanced-bot/rate-response:routes/enhancedBotRoutes.js:503': {
    request: request(
      z
        .object({
          conversationId: idSchema,
          rating: z.number().int().min(1).max(5),
          feedback: z.string().max(4_000).optional(),
        })
        .strict(),
    ),
    serializeSuccess: serializer(
      z
        .object({
          message: z.literal('Response rated successfully'),
          conversation: publicConversationSchema,
        })
        .strict(),
    ),
  },
  'rest:POST:/api/enhanced-bot/summarize-conversation:routes/enhancedBotRoutes.js:460':
    {
      request: request(
        z
          .object({ days: z.number().int().min(1).max(365).default(7) })
          .strict(),
      ),
      serializeSuccess: serializer(
        z.object({ summary: z.string(), days: z.number().int() }).strict(),
      ),
    },
  'rest:POST:/api/enhanced-chat/assist:routes/enhancedChatRoutes.js:813': {
    request: request(assistSchema),
    serializeSuccess: serializer(
      z
        .object({
          success: z.literal(true),
          result: z.string(),
          type: z.string(),
          provider: z.string(),
        })
        .strict(),
    ),
  },
  'rest:POST:/api/enhanced-chat/bot-chat:routes/enhancedChatRoutes.js:699': {
    request: request(
      z
        .object({
          message: nonEmptyTextSchema,
          chatId: idSchema.optional(),
          personality: z.string().max(64).optional(),
          instruction: z.string().max(4_000).optional(),
        })
        .strict(),
    ),
    serializeSuccess: serializer(
      z
        .object({
          success: z.literal(true),
          response: z.string(),
          botInfo: z
            .object({
              personality: z.string(),
              provider: z.string(),
              confidence: z.number(),
              responseTime: z.number(),
            })
            .strict(),
          message: publicMessageSchema.nullable(),
        })
        .strict(),
    ),
  },
  'rest:POST:/api/enhanced-chat/create-chat:routes/enhancedChatRoutes.js:872': {
    request: request(createChatSchema),
    serializeSuccess: serializer(
      z
        .object({
          success: z.literal(true),
          chat: publicChatSchema,
          message: z.string(),
        })
        .strict(),
    ),
  },
  'rest:POST:/api/enhanced-chat/emoji-reactions/:messageId:routes/enhancedChatRoutes.js:565':
    {
      request: request(reactionSchema, noInput, messageParam),
      serializeSuccess: serializer(
        z
          .object({
            success: z.literal(true),
            message: z.literal('Reaction added successfully'),
            reactions: z.array(publicReactionSchema),
          })
          .strict(),
      ),
    },
  'rest:POST:/api/enhanced-chat/groups/:chatId/icon:routes/enhancedChatRoutes.js:1315':
    {
      request: request(z.object({}).strict(), noInput, chatParam),
      serializeSuccess: serializer(
        z
          .object({
            success: z.literal(true),
            groupIcon: z.string(),
            message: z.literal('Group icon updated successfully'),
          })
          .strict(),
      ),
    },
  'rest:POST:/api/enhanced-chat/groups/join/:inviteCode:routes/enhancedChatRoutes.js:1443':
    {
      request: request(noInput, noInput, inviteParam),
      serializeSuccess: serializer(
        z
          .object({
            success: z.literal(true),
            chatId: idSchema,
            message: z.string(),
          })
          .strict(),
      ),
    },
  'rest:POST:/api/enhanced-chat/mark-read/:chatId:routes/enhancedChatRoutes.js:971':
    {
      request: request(noInput, noInput, chatParam),
      serializeSuccess: serializer(statusSuccessSchema),
    },
  'rest:POST:/api/enhanced-chat/send-message:routes/enhancedChatRoutes.js:319':
    {
      request: request(sendMessageSchema),
      serializeSuccess: serializer(messageSuccessSchema),
    },
  'rest:POST:/api/enhanced-chat/upload-file:routes/enhancedChatRoutes.js:470': {
    request: request(uploadFileSchema),
    serializeSuccess: serializer(
      z
        .object({
          success: z.literal(true),
          message: publicMessageSchema,
          fileUrl: z.string(),
        })
        .strict(),
    ),
  },
  'rest:POST:/api/enhanced-chat/upload-voice:routes/enhancedChatRoutes.js:401':
    {
      request: request(uploadVoiceSchema),
      serializeSuccess: serializer(
        z
          .object({
            success: z.literal(true),
            message: publicMessageSchema,
            voiceUrl: z.string(),
          })
          .strict(),
      ),
    },
  'rest:PUT:/api/bot/bot-settings:routes/bot.js:59': {
    request: request(
      z
        .object({
          botEnabled: z.boolean(),
          botPersonality: z.enum(['friendly', 'professional', 'sarcastic']),
        })
        .strict(),
    ),
    serializeSuccess: serializer(
      z
        .object({
          message: z.literal('Smart Bot settings updated successfully'),
          botSettings: publicBotSettingsSchema,
        })
        .strict(),
    ),
  },
  'rest:PUT:/api/enhanced-bot/settings:routes/enhancedBotRoutes.js:167': {
    request: request(
      z
        .object({
          botEnabled: z.boolean().optional(),
          botPersonality: z.string().max(64).optional(),
          aiProvider: z.string().max(64).optional(),
          model: z.string().max(200).optional(),
          maxTokens: z.number().int().min(1).max(32_000).optional(),
          contextLength: z.number().int().min(1).max(100).optional(),
          temperature: z.number().min(0).max(2).optional(),
          features: z.record(z.string(), z.unknown()).optional(),
          customInstructions: z.string().max(4_000).optional(),
          responseStyle: z.record(z.string(), z.unknown()).optional(),
          restrictions: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
    ),
    serializeSuccess: serializer(
      z
        .object({
          message: z.literal('Settings updated successfully'),
          settings: publicBotSettingsSchema,
        })
        .strict(),
    ),
  },
};

export const restRequestSchemas: Readonly<Record<RestCapabilityId, z.ZodType>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(restContracts).map(([id, contract]) => [
        id,
        contract.request,
      ]),
    ) as Record<RestCapabilityId, z.ZodType>,
  );
