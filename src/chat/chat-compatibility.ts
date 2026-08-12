import { messagePublicViewSchema, type ChatPublicView } from './chat.contract.js';

const parseRecord = (record: unknown): ChatPublicView => messagePublicViewSchema.parse(record);

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
