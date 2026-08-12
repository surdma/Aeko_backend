import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { DomainError } from '../common/errors/domain.error';
import { toJsonValue, type JsonValue } from '../common/json/json-value';

export type WritableJson = Exclude<JsonValue, null>;

export interface TransactionRecord {
  readonly id: string;
  readonly userId: string;
  readonly communityId: string | null;
  readonly amount: number;
  readonly currency: string;
  readonly paymentMethod: string;
  readonly paymentReference: string;
  readonly status: string;
  readonly metadata: JsonValue;
  readonly verifiedAt: Date | null;
  readonly createdAt: Date;
}

export interface CommunitySnapshot {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string | null;
  readonly members: JsonValue;
  readonly settings: JsonValue;
}

export interface TransactionFilter {
  readonly communityId: string;
  readonly status: string | null;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
}

export interface WithdrawalTransactionClient {
  findCommunity(id: string): Promise<CommunitySnapshot | null>;
  saveSettings(id: string, settings: WritableJson): Promise<void>;
}

export const SERIALIZABLE_ATTEMPTS = 3;

export interface CommunityTransactionPrismaClient {
  findCommunity(id: string): Promise<CommunitySnapshot | null>;
  findUserEmail(userId: string): Promise<string | null>;
  findByReference(reference: string): Promise<TransactionRecord | null>;
  create(data: {
    readonly userId: string;
    readonly communityId: string;
    readonly amount: number;
    readonly currency: string;
    readonly paymentMethod: string;
    readonly paymentReference: string;
  }): Promise<TransactionRecord>;
  attachProviderReference(id: string, reference: string): Promise<void>;
  fail(id: string, reason: string): Promise<void>;
  list(
    filter: TransactionFilter,
    skip: number,
    take: number,
  ): Promise<readonly TransactionRecord[]>;
  count(filter: TransactionFilter): Promise<number>;
  /** Totals across the whole filtered set, not just the page. */
  summarise(
    filter: TransactionFilter,
  ): Promise<{ readonly totalAmount: number; readonly completedCount: number }>;
  runSerializable<T>(
    operation: (transaction: WithdrawalTransactionClient) => Promise<T>,
  ): Promise<T>;
}

const WRITE_CONFLICT_CODE = 'P2034';

const isWriteConflict = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  Reflect.get(error, 'code') === WRITE_CONFLICT_CODE;

type TransactionRow = Prisma.TransactionGetPayload<object>;

const toRecord = (row: TransactionRow): TransactionRecord =>
  Object.freeze({
    id: row.id,
    userId: row.userId,
    communityId: row.communityId,
    amount: row.amount,
    currency: row.currency,
    paymentMethod: row.paymentMethod,
    paymentReference: row.paymentReference,
    status: row.status,
    metadata: toJsonValue(row.metadata),
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
  });

const communitySelect = {
  id: true,
  name: true,
  ownerId: true,
  members: true,
  settings: true,
} satisfies Prisma.CommunitySelect;

type CommunityRow = Prisma.CommunityGetPayload<{
  select: typeof communitySelect;
}>;

const toSnapshot = (row: CommunityRow): CommunitySnapshot =>
  Object.freeze({
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    members: toJsonValue(row.members),
    settings: toJsonValue(row.settings),
  });

const jsonInput = (value: WritableJson): Prisma.InputJsonValue => value;

const filterWhere = (
  filter: TransactionFilter,
): Prisma.TransactionWhereInput => {
  const createdAt: Prisma.DateTimeFilter = {};
  if (filter.startDate !== null) createdAt.gte = filter.startDate;
  if (filter.endDate !== null) createdAt.lte = filter.endDate;
  return {
    communityId: filter.communityId,
    ...(filter.status === null ? {} : { status: filter.status }),
    ...(filter.startDate === null && filter.endDate === null
      ? {}
      : { createdAt }),
  };
};

export const createCommunityTransactionPrismaClient = (
  db: PrismaClient,
): CommunityTransactionPrismaClient => ({
  async findCommunity(id) {
    const row = await db.community.findUnique({
      where: { id },
      select: communitySelect,
    });
    return row === null ? null : toSnapshot(row);
  },

  async findUserEmail(userId) {
    const row = await db.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return row === null ? null : row.email;
  },

  async findByReference(reference) {
    const row = await db.transaction.findFirst({
      where: { paymentReference: reference },
    });
    return row === null ? null : toRecord(row);
  },

  async create(data) {
    const row = await db.transaction.create({
      data: {
        userId: data.userId,
        communityId: data.communityId,
        amount: data.amount,
        currency: data.currency,
        paymentMethod: data.paymentMethod,
        paymentReference: data.paymentReference,
        status: 'pending',
      },
    });
    return toRecord(row);
  },

  async attachProviderReference(id, reference) {
    await db.transaction.update({
      where: { id },
      data: { metadata: { providerReference: reference } },
    });
  },

  async fail(id, reason) {
    await db.transaction.update({
      where: { id },
      data: { status: 'failed', failureReason: reason },
    });
  },

  async list(filter, skip, take) {
    const rows = await db.transaction.findMany({
      where: filterWhere(filter),
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    return Object.freeze(rows.map(toRecord));
  },

  async count(filter) {
    return db.transaction.count({ where: filterWhere(filter) });
  },

  async summarise(filter) {
    const completed = { ...filterWhere(filter), status: 'completed' };
    const [aggregate, completedCount] = await Promise.all([
      db.transaction.aggregate({ where: completed, _sum: { amount: true } }),
      db.transaction.count({ where: completed }),
    ]);
    return Object.freeze({
      totalAmount: aggregate._sum.amount ?? 0,
      completedCount,
    });
  },

  async runSerializable<T>(
    operation: (transaction: WithdrawalTransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await db.$transaction(
          async (transaction) =>
            operation({
              async findCommunity(id) {
                const row = await transaction.community.findUnique({
                  where: { id },
                  select: communitySelect,
                });
                return row === null ? null : toSnapshot(row);
              },
              async saveSettings(id, settings) {
                await transaction.community.update({
                  where: { id },
                  data: { settings: jsonInput(settings) },
                });
              },
            }),
          { isolationLevel: 'Serializable' },
        );
      } catch (error: unknown) {
        if (!isWriteConflict(error)) throw error;
      }
    }
    throw new DomainError(
      'CONFLICT',
      'That community is being updated. Please try again.',
    );
  },
});
