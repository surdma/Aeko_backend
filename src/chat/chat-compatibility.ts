import { messagePublicViewSchema, type ChatPublicView } from './chat.contract.js';

/** Legacy Prisma records carry extra relation/model fields. Parse required values, then project only the public view. */
const legacyMessageRecordSchema = messagePublicViewSchema.passthrough();
const parseRecord = (record: unknown): ChatPublicView => {
  const message = legacyMessageRecordSchema.parse(record);
  return {
    id: message.id,
    chatId: message.chatId,
    senderId: message.senderId,
    receiverId: message.receiverId,
    content: message.content,
    messageType: message.messageType,
    status: message.status,
    createdAt: message.createdAt,
    sender: message.sender,
  };
};

export const toLegacyMessageSent = (record: unknown) => {
  const message = parseRecord(record);
  return { messageId: message.id, status: message.status, timestamp: message.createdAt } as const;
};

export const toLegacyNewMessage = (record: unknown) => {
  const message = parseRecord(record);
  return {
    message,
    chatId: message.chatId,
    sender: message.sender,
  } as const;
};
