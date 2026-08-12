import { z } from 'zod';

import { botCommandSchema } from '../bot/bot.contract.js';
import { callSignalSchema } from '../video-calls/video-call.contract.js';
import { sendMessageSchema } from './chat.contract.js';

const idSchema = z.string().uuid();
const emptySchema = z.object({}).strict();
const chatSchema = z.object({ chatId: idSchema }).strict();
const receiverChatSchema = z.object({ chatId: idSchema, receiverId: idSchema.optional() }).strict();
const messageSchema = z.object({ messageId: idSchema }).strict();
const messageEmojiSchema = z.object({ messageId: idSchema, emoji: z.string().trim().min(1).max(32) }).strict();

export const INBOUND_EVENT_NAMES = [
  'add_reaction', 'call-answer', 'call-offer', 'chat_with_bot', 'connection', 'create_group_chat', 'delete_message', 'disconnect', 'edit_message', 'enable_bot_in_chat', 'get_chat_history', 'ice-candidate', 'join_chat', 'mark_message_read', 'remove_reaction', 'reply_to_message', 'search_messages', 'send_emoji', 'send_message', 'send_voice_message', 'share_location', 'start_voice_recording', 'stop_voice_recording', 'typing_start', 'typing_stop', 'upload_file',
] as const;
export type InboundEventName = (typeof INBOUND_EVENT_NAMES)[number];

export const inboundEventSchemas: Readonly<Record<InboundEventName, z.ZodType>> = {
  add_reaction: messageEmojiSchema,
  'call-answer': callSignalSchema,
  'call-offer': callSignalSchema,
  chat_with_bot: botCommandSchema,
  connection: emptySchema,
  create_group_chat: z.object({ participants: z.array(idSchema).min(1).max(100), groupName: z.string().trim().min(1).max(200).optional() }).strict(),
  delete_message: messageSchema,
  disconnect: emptySchema,
  edit_message: z.object({ messageId: idSchema, content: z.string().trim().min(1).max(65_536) }).strict(),
  enable_bot_in_chat: z.object({ chatId: idSchema, enabled: z.boolean() }).strict(),
  get_chat_history: z.object({ chatId: idSchema, page: z.number().int().min(1).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
  'ice-candidate': callSignalSchema,
  join_chat: chatSchema,
  mark_message_read: messageSchema,
  remove_reaction: messageEmojiSchema,
  reply_to_message: z.object({ messageId: idSchema, replyToId: idSchema, content: z.string().trim().min(1).max(65_536) }).strict(),
  search_messages: z.object({ chatId: idSchema, q: z.string().trim().min(1).max(256), limit: z.number().int().min(1).max(100).optional() }).strict(),
  send_emoji: z.object({ chatId: idSchema, receiverId: idSchema.optional(), emoji: z.string().trim().min(1).max(32), skinTone: z.string().trim().max(16).optional() }).strict(),
  send_message: sendMessageSchema,
  send_voice_message: z.object({ chatId: idSchema, receiverId: idSchema, voiceData: z.string().min(1).max(140_000_000), duration: z.number().positive().max(86_400), waveform: z.array(z.number().finite()).max(20_000).optional() }).strict(),
  share_location: z.object({ chatId: idSchema, receiverId: idSchema.optional(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict(),
  start_voice_recording: chatSchema,
  stop_voice_recording: chatSchema,
  typing_start: receiverChatSchema,
  typing_stop: receiverChatSchema,
  upload_file: z.object({ chatId: idSchema, receiverId: idSchema, fileId: idSchema }).strict(),
};

export const OUTBOUND_EVENT_NAMES = [
  'bot_auto_reply', 'bot_error', 'bot_response', 'bot_sent_reply', 'call-answer', 'call-offer', 'emoji_error', 'ice-candidate', 'joined_chat', 'message_error', 'message_read', 'message_sent', 'new_message', 'new_voice_message', 'reaction_added', 'reaction_error', 'reaction_removed', 'recording_started', 'recording_stopped', 'unread_count', 'user_recording_voice', 'user_status_update', 'user_typing', 'voice_message_error', 'voice_message_sent',
] as const;
export type OutboundEventName = (typeof OUTBOUND_EVENT_NAMES)[number];
export type OutboundEventView = (payload: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;
const toPublicPayload: OutboundEventView = (payload) => Object.freeze({ ...payload });
export const outboundEventViews: Readonly<Record<OutboundEventName, OutboundEventView>> =
  Object.freeze(Object.fromEntries(OUTBOUND_EVENT_NAMES.map((name) => [name, toPublicPayload])) as Record<OutboundEventName, OutboundEventView>);

export interface ChatEventMap {
  readonly inbound: typeof inboundEventSchemas;
  readonly outbound: typeof outboundEventViews;
}
