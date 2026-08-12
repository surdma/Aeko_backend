import type { Prisma, PrismaClient } from '../generated/prisma/client';

export interface OutboxRecord {
  readonly id: string;
  readonly chatId: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Prisma.JsonValue;
  readonly attempts: number;
  readonly availableAt: Date;
  readonly claimedAt: Date | null;
  readonly createdAt: Date;
}

export interface ChatOutboxStore {
  claimBatch(limit: number): Promise<readonly OutboxRecord[]>;
}

const toOutboxRecord = (row: {
  id: string;
  chatId: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.JsonValue;
  attempts: number;
  availableAt: Date;
  claimedAt: Date | null;
  createdAt: Date;
}): OutboxRecord =>
  Object.freeze({
    id: row.id,
    chatId: row.chatId,
    aggregateId: row.aggregateId,
    eventType: row.eventType,
    payload: row.payload,
    attempts: row.attempts,
    availableAt: row.availableAt,
    claimedAt: row.claimedAt,
    createdAt: row.createdAt,
  });

/** Claims only uncompleted, unclaimed ready events. `updateMany` makes the
 * compare-and-set explicit; a later worker must not steal an active claim. */
export const createChatOutboxPrismaClient = (
  db: Pick<PrismaClient, 'chatOutboxEvent'>,
  now: () => Date = () => new Date(),
): ChatOutboxStore => ({
  async claimBatch(limit) {
    if (!Number.isSafeInteger(limit) || limit < 1) return [];
    const availableAt = now();
    const candidates = await db.chatOutboxEvent.findMany({
      where: { completedAt: null, claimedAt: null, availableAt: { lte: availableAt } },
      orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: { id: true },
    });
    const claimed = await Promise.all(
      candidates.map(async ({ id }) => {
        const result = await db.chatOutboxEvent.updateMany({
          where: { id, completedAt: null, claimedAt: null },
          data: { claimedAt: availableAt, attempts: { increment: 1 } },
        });
        if (result.count !== 1) return null;
        return db.chatOutboxEvent.findUnique({ where: { id } });
      }),
    );
    return claimed
      .filter((record): record is NonNullable<typeof record> => record !== null)
      .map(toOutboxRecord);
  },
});
