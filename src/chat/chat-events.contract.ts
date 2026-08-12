import { z } from 'zod';

import { botCommandSchema } from './bot/bot.contract';
import { callSignalSchema } from './signalling/video-call.contract';
import {
  publicMessageSchema,
  publicUserSchema,
  sendMessageSchema,
} from './chat.contract';

const idSchema = z.string().uuid();
const emptySchema = z.object({}).strict();
const chatSchema = z.object({ chatId: idSchema }).strict();
const receiverChatSchema = z
  .object({ chatId: idSchema, receiverId: idSchema.optional() })
  .strict();
const messageSchema = z.object({ messageId: idSchema }).strict();
const messageEmojiSchema = z
  .object({ messageId: idSchema, emoji: z.string().trim().min(1).max(32) })
  .strict();

export const INBOUND_EVENT_NAMES = [
  'add_reaction',
  'call-answer',
  'call-offer',
  'chat_with_bot',
  'connection',
  'create_group_chat',
  'delete_message',
  'disconnect',
  'edit_message',
  'enable_bot_in_chat',
  'get_chat_history',
  'ice-candidate',
  'join_chat',
  'mark_message_read',
  'remove_reaction',
  'reply_to_message',
  'search_messages',
  'send_emoji',
  'send_message',
  'send_voice_message',
  'share_location',
  'start_voice_recording',
  'stop_voice_recording',
  'typing_start',
  'typing_stop',
  'upload_file',
] as const;
export type InboundEventName = (typeof INBOUND_EVENT_NAMES)[number];

export const inboundEventSchemas: Readonly<
  Record<InboundEventName, z.ZodType>
> = {
  add_reaction: messageEmojiSchema,
  'call-answer': callSignalSchema,
  'call-offer': callSignalSchema,
  chat_with_bot: botCommandSchema,
  connection: emptySchema,
  create_group_chat: z
    .object({
      participants: z.array(idSchema).min(1).max(100),
      groupName: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
  delete_message: messageSchema,
  disconnect: emptySchema,
  edit_message: z
    .object({
      messageId: idSchema,
      content: z.string().trim().min(1).max(65_536),
    })
    .strict(),
  enable_bot_in_chat: z
    .object({ chatId: idSchema, enabled: z.boolean() })
    .strict(),
  get_chat_history: z
    .object({
      chatId: idSchema,
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  'ice-candidate': callSignalSchema,
  join_chat: chatSchema,
  mark_message_read: messageSchema,
  remove_reaction: messageEmojiSchema,
  reply_to_message: z
    .object({
      messageId: idSchema,
      replyToId: idSchema,
      content: z.string().trim().min(1).max(65_536),
    })
    .strict(),
  search_messages: z
    .object({
      chatId: idSchema,
      q: z.string().trim().min(1).max(256),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  send_emoji: z
    .object({
      chatId: idSchema,
      receiverId: idSchema.optional(),
      emoji: z.string().trim().min(1).max(32),
      skinTone: z.string().trim().max(16).optional(),
    })
    .strict(),
  send_message: sendMessageSchema,
  send_voice_message: z
    .object({
      chatId: idSchema,
      receiverId: idSchema,
      voiceData: z.string().min(1).max(140_000_000),
      duration: z.number().positive().max(86_400),
      waveform: z.array(z.number().finite()).max(20_000).optional(),
    })
    .strict(),
  share_location: z
    .object({
      chatId: idSchema,
      receiverId: idSchema.optional(),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .strict(),
  start_voice_recording: chatSchema,
  stop_voice_recording: chatSchema,
  typing_start: receiverChatSchema,
  typing_stop: receiverChatSchema,
  upload_file: z
    .object({ chatId: idSchema, receiverId: idSchema, fileId: idSchema })
    .strict(),
};

export const OUTBOUND_EVENT_NAMES = [
  'bot_auto_reply',
  'bot_error',
  'bot_response',
  'bot_sent_reply',
  'call-answer',
  'call-offer',
  'emoji_error',
  'ice-candidate',
  'joined_chat',
  'message_error',
  'message_read',
  'message_sent',
  'new_message',
  'new_voice_message',
  'reaction_added',
  'reaction_error',
  'reaction_removed',
  'recording_started',
  'recording_stopped',
  'unread_count',
  'user_recording_voice',
  'user_status_update',
  'user_typing',
  'voice_message_error',
  'voice_message_sent',
] as const;
export type OutboundEventName = (typeof OUTBOUND_EVENT_NAMES)[number];
export type OutboundEventView = (
  payload: Readonly<Record<string, unknown>>,
) => Readonly<Record<string, unknown>>;
const publicError =
  (
    code: 'INVALID_PAYLOAD' | 'NOT_FOUND' | 'UNAVAILABLE',
    message: string,
  ): OutboundEventView =>
  () => ({ code, message });
const object = (
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => value;
const requiredString = (
  payload: Readonly<Record<string, unknown>>,
  key: string,
): string => {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
};
const messageAckView: OutboundEventView = (payload) => ({
  messageId: requiredString(payload, 'messageId'),
  status: requiredString(payload, 'status'),
  timestamp: requiredString(payload, 'timestamp'),
});
const reactionView: OutboundEventView = (payload) => ({
  messageId: requiredString(payload, 'messageId'),
  userId: requiredString(payload, 'userId'),
  ...(typeof payload.username === 'string'
    ? { username: payload.username }
    : {}),
  ...(typeof payload.emoji === 'string' ? { emoji: payload.emoji } : {}),
  ...(typeof payload.timestamp === 'string' || payload.timestamp instanceof Date
    ? { timestamp: payload.timestamp }
    : {}),
});
const typingView: OutboundEventView = (payload) => ({
  userId: requiredString(payload, 'userId'),
  username: requiredString(payload, 'username'),
  chatId: requiredString(payload, 'chatId'),
  typing: payload.typing === true,
});
const signalView =
  (field: 'offer' | 'answer' | 'candidate'): OutboundEventView =>
  (payload) => ({
    from: requiredString(payload, 'from'),
    [field]: requiredString(payload, field),
  });
const messageDeliveryView: OutboundEventView = (payload) => ({
  message: publicMessageSchema.parse(payload.message),
  chatId: requiredString(payload, 'chatId'),
  ...(payload.sender === undefined
    ? {}
    : { sender: publicUserSchema.parse(payload.sender) }),
});
const botInfoSchema = z.object({
  personality: z.string(),
  provider: z.string(),
  confidence: z.number(),
  responseTime: z.number(),
});

/** Named, field-projected views. Error handlers never expose thrown/provider values. */
export const outboundEventViews: Readonly<
  Record<OutboundEventName, OutboundEventView>
> = {
  bot_auto_reply: (payload) =>
    object({
      message: publicMessageSchema.parse(payload.message),
      chatId: requiredString(payload, 'chatId'),
      botInfo: botInfoSchema.parse(payload.botInfo),
    }),
  bot_error: publicError('UNAVAILABLE', 'Bot response is unavailable'),
  bot_response: (payload) =>
    object({
      message: publicMessageSchema.parse(payload.message),
      chatId: requiredString(payload, 'chatId'),
      botInfo: botInfoSchema.parse(payload.botInfo),
    }),
  bot_sent_reply: (payload) =>
    object({
      message: publicMessageSchema.parse(payload.message),
      chatId: requiredString(payload, 'chatId'),
      toUser: requiredString(payload, 'toUser'),
    }),
  'call-answer': signalView('answer'),
  'call-offer': signalView('offer'),
  emoji_error: publicError('INVALID_PAYLOAD', 'Emoji could not be sent'),
  'ice-candidate': signalView('candidate'),
  joined_chat: (payload) =>
    object({
      chatId: requiredString(payload, 'chatId'),
      message: requiredString(payload, 'message'),
      onlineUsers: Array.isArray(payload.onlineUsers)
        ? payload.onlineUsers
        : [],
    }),
  message_error: publicError('UNAVAILABLE', 'Message could not be sent'),
  message_read: (payload) =>
    object({
      messageId: requiredString(payload, 'messageId'),
      readBy: requiredString(payload, 'readBy'),
      readAt: payload.readAt,
    }),
  message_sent: messageAckView,
  new_message: messageDeliveryView,
  new_voice_message: messageDeliveryView,
  reaction_added: reactionView,
  reaction_error: publicError('NOT_FOUND', 'Reaction could not be updated'),
  reaction_removed: reactionView,
  recording_started: (payload) =>
    object({ chatId: requiredString(payload, 'chatId') }),
  recording_stopped: (payload) =>
    object({ chatId: requiredString(payload, 'chatId') }),
  unread_count: (payload) =>
    object({ count: typeof payload.count === 'number' ? payload.count : 0 }),
  user_recording_voice: (payload) =>
    object({
      userId: requiredString(payload, 'userId'),
      username: requiredString(payload, 'username'),
      recording: payload.recording === true,
    }),
  user_status_update: (payload) =>
    object({
      userId: requiredString(payload, 'userId'),
      status: requiredString(payload, 'status'),
      timestamp: payload.timestamp,
    }),
  user_typing: typingView,
  voice_message_error: publicError(
    'UNAVAILABLE',
    'Voice message could not be sent',
  ),
  voice_message_sent: (payload) =>
    object({
      messageId: requiredString(payload, 'messageId'),
      status: requiredString(payload, 'status'),
    }),
};

export const SOCKET_CAPABILITY_IDS = [
  'socket:/:inbound:add_reaction:sockets/enhancedChatSocket.js:133',
  'socket:/:inbound:call-answer:sockets/videoCallSocket.js:6',
  'socket:/:inbound:call-offer:sockets/videoCallSocket.js:3',
  'socket:/:inbound:chat_with_bot:sockets/enhancedChatSocket.js:129',
  'socket:/:inbound:connection:sockets/enhancedChatSocket.js:48',
  'socket:/:inbound:connection:sockets/videoCallSocket.js:2',
  'socket:/:inbound:create_group_chat:sockets/enhancedChatSocket.js:149',
  'socket:/:inbound:delete_message:sockets/enhancedChatSocket.js:137',
  'socket:/:inbound:disconnect:sockets/enhancedChatSocket.js:112',
  'socket:/:inbound:edit_message:sockets/enhancedChatSocket.js:136',
  'socket:/:inbound:enable_bot_in_chat:sockets/enhancedChatSocket.js:130',
  'socket:/:inbound:get_chat_history:sockets/enhancedChatSocket.js:150',
  'socket:/:inbound:ice-candidate:sockets/videoCallSocket.js:9',
  'socket:/:inbound:join_chat:sockets/enhancedChatSocket.js:119',
  'socket:/:inbound:mark_message_read:sockets/enhancedChatSocket.js:135',
  'socket:/:inbound:remove_reaction:sockets/enhancedChatSocket.js:134',
  'socket:/:inbound:reply_to_message:sockets/enhancedChatSocket.js:138',
  'socket:/:inbound:search_messages:sockets/enhancedChatSocket.js:151',
  'socket:/:inbound:send_emoji:sockets/enhancedChatSocket.js:121',
  'socket:/:inbound:send_message:sockets/enhancedChatSocket.js:120',
  'socket:/:inbound:send_voice_message:sockets/enhancedChatSocket.js:124',
  'socket:/:inbound:share_location:sockets/enhancedChatSocket.js:146',
  'socket:/:inbound:start_voice_recording:sockets/enhancedChatSocket.js:125',
  'socket:/:inbound:stop_voice_recording:sockets/enhancedChatSocket.js:126',
  'socket:/:inbound:typing_start:sockets/enhancedChatSocket.js:141',
  'socket:/:inbound:typing_stop:sockets/enhancedChatSocket.js:142',
  'socket:/:inbound:upload_file:sockets/enhancedChatSocket.js:145',
  'socket:/:outbound:bot_auto_reply:sockets/enhancedChatSocket.js:477',
  'socket:/:outbound:bot_error:sockets/enhancedChatSocket.js:384',
  'socket:/:outbound:bot_error:sockets/enhancedChatSocket.js:430',
  'socket:/:outbound:bot_response:sockets/enhancedChatSocket.js:417',
  'socket:/:outbound:bot_sent_reply:sockets/enhancedChatSocket.js:489',
  'socket:/:outbound:call-answer:sockets/videoCallSocket.js:7',
  'socket:/:outbound:call-offer:sockets/videoCallSocket.js:4',
  'socket:/:outbound:emoji_error:sockets/enhancedChatSocket.js:265',
  'socket:/:outbound:ice-candidate:sockets/videoCallSocket.js:10',
  'socket:/:outbound:joined_chat:sockets/enhancedChatSocket.js:639',
  'socket:/:outbound:message_error:sockets/enhancedChatSocket.js:246',
  'socket:/:outbound:message_read:sockets/enhancedChatSocket.js:673',
  'socket:/:outbound:message_sent:sockets/enhancedChatSocket.js:215',
  'socket:/:outbound:new_message:sockets/enhancedChatSocket.js:200',
  'socket:/:outbound:new_voice_message:sockets/enhancedChatSocket.js:316',
  'socket:/:outbound:reaction_added:sockets/enhancedChatSocket.js:535',
  'socket:/:outbound:reaction_error:sockets/enhancedChatSocket.js:512',
  'socket:/:outbound:reaction_error:sockets/enhancedChatSocket.js:545',
  'socket:/:outbound:reaction_error:sockets/enhancedChatSocket.js:558',
  'socket:/:outbound:reaction_error:sockets/enhancedChatSocket.js:583',
  'socket:/:outbound:reaction_removed:sockets/enhancedChatSocket.js:575',
  'socket:/:outbound:recording_started:sockets/enhancedChatSocket.js:355',
  'socket:/:outbound:recording_stopped:sockets/enhancedChatSocket.js:368',
  'socket:/:outbound:unread_count:sockets/enhancedChatSocket.js:694',
  'socket:/:outbound:user_recording_voice:sockets/enhancedChatSocket.js:349',
  'socket:/:outbound:user_recording_voice:sockets/enhancedChatSocket.js:362',
  'socket:/:outbound:user_status_update:sockets/enhancedChatSocket.js:715',
  'socket:/:outbound:user_typing:sockets/enhancedChatSocket.js:601',
  'socket:/:outbound:user_typing:sockets/enhancedChatSocket.js:625',
  'socket:/:outbound:voice_message_error:sockets/enhancedChatSocket.js:341',
  'socket:/:outbound:voice_message_sent:sockets/enhancedChatSocket.js:331',
] as const;
type SocketCapabilityId = (typeof SOCKET_CAPABILITY_IDS)[number];
const socketName = (id: string): string => id.split(':')[3] ?? '';
export interface SocketCapabilityContract {
  readonly direction: 'inbound' | 'outbound';
  readonly name: string;
  readonly contract: z.ZodType | OutboundEventView;
  readonly provenance: string;
}
export const socketCapabilityContracts: Readonly<
  Record<SocketCapabilityId, SocketCapabilityContract>
> = Object.freeze(
  Object.fromEntries(
    SOCKET_CAPABILITY_IDS.map((id) => {
      const direction = id.includes(':inbound:')
        ? ('inbound' as const)
        : ('outbound' as const);
      const name = socketName(id);
      return [
        id,
        {
          direction,
          name,
          contract:
            direction === 'inbound'
              ? inboundEventSchemas[name as InboundEventName]
              : outboundEventViews[name as OutboundEventName],
          provenance: id.slice(id.indexOf('sockets/')),
        },
      ];
    }),
  ) as Record<SocketCapabilityId, SocketCapabilityContract>,
);

export interface ChatEventMap {
  readonly inbound: typeof inboundEventSchemas;
  readonly outbound: typeof outboundEventViews;
}
