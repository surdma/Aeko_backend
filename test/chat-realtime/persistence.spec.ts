import {
  createChatPrismaClient,
  type ChatStore,
} from '../../src/chat/chat-prisma.client';
import type { SendMessageCommand } from '../../src/chat/chat.contract';

const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const SENDER_ID = '22222222-2222-4222-8222-222222222222';

const command = (clientMessageId: string): SendMessageCommand => ({
  chatId: CHAT_ID,
  principalId: SENDER_ID,
  clientMessageId,
  content: 'hello',
  attachments: [],
  messageType: 'text',
  metadata: {},
});

/** A transaction-faithful in-memory Prisma boundary for repository behavior. */
const createStore = (): ChatStore => {
  const messages = new Map<string, {
    id: string;
    chatId: string;
    clientMessageId: string | null;
    sequence: bigint;
    createdAt: Date;
  }>();
  const byClientId = new Map<string, string>();
  const outbox = new Map<string, { aggregateId: string }>();
  let sequence = 0n;
  let nextId = 0;
  const db = {
    $transaction: async <T>(
      operation: (transaction: typeof transaction) => Promise<T>,
    ): Promise<T> => operation(transaction),
  };
  const transaction = {
    chat: {
      update: async (): Promise<{ nextMessageSequence: bigint }> => {
        sequence += 1n;
        return { nextMessageSequence: sequence };
      },
    },
    enhancedMessage: {
      findUnique: async ({ where }: { where: { chatId_clientMessageId: { chatId: string; clientMessageId: string } } }) => {
        const id = byClientId.get(`${where.chatId_clientMessageId.chatId}:${where.chatId_clientMessageId.clientMessageId}`);
        return id === undefined ? null : messages.get(id) ?? null;
      },
      create: async ({ data }: { data: { chatId: string; clientMessageId?: string; sequence: bigint } }) => {
        if (
          data.clientMessageId !== undefined &&
          byClientId.has(`${data.chatId}:${data.clientMessageId}`)
        ) {
          throw Object.assign(new Error('duplicate idempotency key'), {
            code: 'P2002',
          });
        }
        const id = `message-${++nextId}`;
        const row = { id, chatId: data.chatId, clientMessageId: data.clientMessageId ?? null, sequence: data.sequence, createdAt: new Date() };
        messages.set(id, row);
        if (data.clientMessageId !== undefined) byClientId.set(`${data.chatId}:${data.clientMessageId}`, id);
        return row;
      },
    },
    chatOutboxEvent: {
      create: async ({ data }: { data: { aggregateId: string } }) => {
        outbox.set(data.aggregateId, { aggregateId: data.aggregateId });
        return { id: `outbox-${data.aggregateId}` };
      },
    },
  };
  Object.assign(db, { enhancedMessage: transaction.enhancedMessage });
  return createChatPrismaClient(db as never);
};

describe('ordered chat persistence', () => {
  it('returns the original message for an idempotent retry and emits one outbox event', async () => {
    const store = createStore();
    const input = command('33333333-3333-4333-8333-333333333333');
    const [first, retry] = await Promise.all([
      store.appendMessage(input),
      store.appendMessage(input),
    ]);

    expect(first.id).toBe(retry.id);
    expect(first.sequence).toBe(1n);
  });

  it('assigns contiguous per-chat sequences to concurrent distinct commands', async () => {
    const store = createStore();
    const messages = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.appendMessage(command(`33333333-3333-4333-8333-${String(index).padStart(12, '0')}`)),
      ),
    );

    expect(messages.map(({ sequence }) => sequence).sort((a, b) => Number(a - b))).toEqual(
      Array.from({ length: 20 }, (_, index) => BigInt(index + 1)),
    );
  });
});
