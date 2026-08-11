import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { DomainError } from '../common/errors/domain.error';
import { toJsonValue, type JsonValue } from '../common/json/json-value';

export type WritableJson = Exclude<JsonValue, null>;

export interface CoinTransactionRecord {
  readonly id: string;
  readonly userId: string;
  readonly type: string;
  readonly amount: number;
  readonly balanceAfter: number;
  readonly description: string | null;
  readonly metadata: JsonValue;
  readonly createdAt: Date;
}

export interface CoinCreditData {
  readonly userId: string;
  readonly type: string;
  readonly amount: number;
  readonly balanceAfter: number;
  readonly description: string;
  readonly metadata: WritableJson;
}

export interface CoinTransactionClient {
  /**
   * Looks a credit up by the provider reference stored in `metadata.reference`.
   * This is the idempotency key; there is no unique index behind it, which is
   * why every caller runs inside a serializable transaction.
   */
  findByReference(reference: string): Promise<CoinTransactionRecord | null>;
  /** Adds to the stored balance rather than overwriting a value read earlier. */
  incrementBalance(userId: string, amount: number): Promise<number>;
  recordCredit(data: CoinCreditData): Promise<CoinTransactionRecord>;
}

export const SERIALIZABLE_ATTEMPTS = 3;

export interface CoinPrismaClient {
  findBalance(userId: string): Promise<number | null>;
  findHistory(
    userId: string,
    type: string | null,
    skip: number,
    take: number,
  ): Promise<readonly CoinTransactionRecord[]>;
  countHistory(userId: string, type: string | null): Promise<number>;
  findEmail(userId: string): Promise<string | null>;
  runSerializable<T>(
    operation: (transaction: CoinTransactionClient) => Promise<T>,
  ): Promise<T>;
}

const WRITE_CONFLICT_CODE = 'P2034';

const isWriteConflict = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  Reflect.get(error, 'code') === WRITE_CONFLICT_CODE;

type CoinTransactionRow = Prisma.CoinTransactionGetPayload<object>;

const toRecord = (row: CoinTransactionRow): CoinTransactionRecord =>
  Object.freeze({
    id: row.id,
    userId: row.userId,
    type: row.type,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    description: row.description,
    metadata: toJsonValue(row.metadata),
    createdAt: row.createdAt,
  });

const jsonInput = (value: WritableJson): Prisma.InputJsonValue => value;

const historyWhere = (
  userId: string,
  type: string | null,
): Prisma.CoinTransactionWhereInput =>
  type === null ? { userId } : { userId, type };

const transactionOps = (
  transaction: Prisma.TransactionClient,
): CoinTransactionClient => ({
  async findByReference(reference) {
    const row = await transaction.coinTransaction.findFirst({
      where: { metadata: { path: ['reference'], equals: reference } },
    });
    return row === null ? null : toRecord(row);
  },

  async incrementBalance(userId, amount) {
    const user = await transaction.user.update({
      where: { id: userId },
      data: { coinBalance: { increment: amount } },
      select: { coinBalance: true },
    });
    return user.coinBalance;
  },

  async recordCredit(data) {
    const row = await transaction.coinTransaction.create({
      data: {
        userId: data.userId,
        type: data.type,
        amount: data.amount,
        balanceAfter: data.balanceAfter,
        description: data.description,
        metadata: jsonInput(data.metadata),
      },
    });
    return toRecord(row);
  },
});

export const createCoinPrismaClient = (db: PrismaClient): CoinPrismaClient => ({
  async findBalance(userId) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { coinBalance: true },
    });
    return user === null ? null : user.coinBalance;
  },

  async findHistory(userId, type, skip, take) {
    const rows = await db.coinTransaction.findMany({
      where: historyWhere(userId, type),
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    return Object.freeze(rows.map(toRecord));
  },

  async countHistory(userId, type) {
    return db.coinTransaction.count({ where: historyWhere(userId, type) });
  },

  async findEmail(userId) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user === null ? null : user.email;
  },

  async runSerializable<T>(
    operation: (transaction: CoinTransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await db.$transaction(
          async (transaction) => operation(transactionOps(transaction)),
          { isolationLevel: 'Serializable' },
        );
      } catch (error: unknown) {
        if (!isWriteConflict(error)) throw error;
      }
    }
    throw new DomainError(
      'CONFLICT',
      'That payment is still being processed. Please try again.',
    );
  },
});
