import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { DomainError } from '../common/errors/domain.error';
import type { SendMessageCommand } from './chat.contract';

export interface PersistedChatMessage {
  readonly id: string;
  readonly chatId: string;
  readonly clientMessageId: string | null;
  readonly sequence: bigint;
  readonly createdAt: Date;
}

export interface ChatStore {
  appendMessage(command: SendMessageCommand): Promise<PersistedChatMessage>;
}

const SERIALIZABLE_ATTEMPTS = 3;
const WRITE_CONFLICT_CODE = 'P2034';
const UNIQUE_CONSTRAINT_CODE = 'P2002';

const isWriteConflict = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  Reflect.get(error, 'code') === WRITE_CONFLICT_CODE;

const isIdempotencyConflict = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  Reflect.get(error, 'code') === UNIQUE_CONSTRAINT_CODE;

type ChatTransaction = Pick<
  Prisma.TransactionClient,
  'chat' | 'enhancedMessage' | 'chatOutboxEvent'
>;

type ChatDatabase = Pick<PrismaClient, '$transaction' | 'enhancedMessage'>;

const toPersisted = (row: {
  id: string;
  chatId: string;
  clientMessageId: string | null;
  sequence: bigint | null;
  createdAt: Date;
}): PersistedChatMessage => {
  if (row.sequence === null) {
    throw new DomainError(
      'DATABASE_UNAVAILABLE',
      'The chat service returned a message without an ordering sequence.',
    );
  }
  return Object.freeze({
    id: row.id,
    chatId: row.chatId,
    clientMessageId: row.clientMessageId,
    sequence: row.sequence,
    createdAt: row.createdAt,
  });
};

const eventPayload = (
  message: PersistedChatMessage,
): Prisma.InputJsonValue => ({
  messageId: message.id,
  chatId: message.chatId,
  sequence: message.sequence.toString(),
});

type MessageReader = Pick<ChatTransaction, 'enhancedMessage'>;

const existingMessage = async (
  database: MessageReader,
  command: SendMessageCommand,
): Promise<PersistedChatMessage | null> => {
  if (command.clientMessageId === undefined) return null;
  const row = await database.enhancedMessage.findUnique({
    where: {
      chatId_clientMessageId: {
        chatId: command.chatId,
        clientMessageId: command.clientMessageId,
      },
    },
  });
  return row === null ? null : toPersisted(row);
};

const appendInTransaction = async (
  transaction: ChatTransaction,
  command: SendMessageCommand,
): Promise<PersistedChatMessage> => {
  const prior = await existingMessage(transaction, command);
  if (prior !== null) return prior;

  const counter = await transaction.chat.update({
    where: { id: command.chatId },
    data: { nextMessageSequence: { increment: 1 } },
    select: { nextMessageSequence: true },
  });
  const row = await transaction.enhancedMessage.create({
    data: {
      chatId: command.chatId,
      senderId: command.principalId,
      receiverId: command.receiverId ?? null,
      clientMessageId: command.clientMessageId ?? null,
      sequence: counter.nextMessageSequence,
      content: command.content,
      attachments: [...command.attachments],
      messageType: command.messageType,
      metadata: command.metadata as Prisma.InputJsonValue,
      replyToId: command.replyToId ?? null,
      emojis: [],
    },
  });
  const message = toPersisted(row);
  await transaction.chatOutboxEvent.create({
    data: {
      chatId: command.chatId,
      aggregateId: message.id,
      eventType: 'chat.message.created',
      payload: eventPayload(message),
    },
  });
  return message;
};

export const createChatPrismaClient = (db: ChatDatabase): ChatStore => ({
  async appendMessage(command) {
    for (let attempt = 0; attempt < SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await db.$transaction(
          async (transaction) => appendInTransaction(transaction, command),
          { isolationLevel: 'Serializable' },
        );
      } catch (error: unknown) {
        // A concurrent transaction may have passed its initial read before the
        // unique `(chatId, clientMessageId)` constraint committed. This is not
        // a transaction retry: return the winning durable message instead.
        if (
          isIdempotencyConflict(error) &&
          command.clientMessageId !== undefined
        ) {
          const existing = await existingMessage(db, command);
          if (existing !== null) return existing;
        }
        if (!isWriteConflict(error)) throw error;
      }
    }
    throw new DomainError(
      'CONFLICT',
      'This chat is busy. Please retry sending your message.',
    );
  },
});
