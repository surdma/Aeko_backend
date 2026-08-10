import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { DomainError } from '../common/errors/domain.error';
import { toJsonValue, type JsonValue } from '../common/json/json-value';
import type { PostAuthorView } from '../posts/post.contract';

export interface StatusRecord {
  readonly id: string;
  readonly userId: string;
  readonly type: string;
  readonly content: string;
  readonly caption: string | null;
  readonly backgroundColor: string | null;
  readonly font: string | null;
  readonly reactions: JsonValue;
  readonly sharedPostId: string | null;
  readonly originalContent: JsonValue;
  readonly shareMetadata: JsonValue;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly author: PostAuthorView | null;
}

export interface StatusWriteData {
  readonly userId: string;
  readonly type: string;
  readonly content: string;
  readonly caption: string | null;
  readonly backgroundColor: string | null;
  readonly font: string | null;
  readonly expiresAt: Date;
  readonly reactions: JsonValue;
  readonly originalContent: JsonValue;
  readonly shareMetadata: JsonValue;
}

export interface StatusTransactionClient {
  findById(id: string): Promise<StatusRecord | null>;
  setReactions(id: string, reactions: JsonValue): Promise<void>;
}

export const SERIALIZABLE_ATTEMPTS = 3;

export interface StatusPrismaClient {
  create(data: StatusWriteData): Promise<StatusRecord>;
  findById(id: string): Promise<StatusRecord | null>;
  findActive(
    now: Date,
    skip: number,
    take: number,
  ): Promise<readonly StatusRecord[]>;
  deleteOwned(id: string, userId: string): Promise<number>;
  runSerializable<T>(
    operation: (transaction: StatusTransactionClient) => Promise<T>,
  ): Promise<T>;
}

const authorSelect = {
  id: true,
  name: true,
  username: true,
  profilePicture: true,
  blueTick: true,
  goldenTick: true,
} satisfies Prisma.UserSelect;

/** The legacy relation name for the status author. */
const statusInclude = {
  users: { select: authorSelect },
} satisfies Prisma.StatusInclude;

type StatusRow = Prisma.StatusGetPayload<{ include: typeof statusInclude }>;

const WRITE_CONFLICT_CODE = 'P2034';

const isWriteConflict = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  Reflect.get(error, 'code') === WRITE_CONFLICT_CODE;

const toStatusRecord = (row: StatusRow): StatusRecord =>
  Object.freeze({
    id: row.id,
    userId: row.userId,
    type: row.type,
    content: row.content,
    caption: row.caption,
    backgroundColor: row.backgroundColor,
    font: row.font,
    reactions: toJsonValue(row.reactions),
    sharedPostId: row.sharedPostId,
    originalContent: toJsonValue(row.originalContent),
    shareMetadata: toJsonValue(row.shareMetadata),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    author:
      row.users === null
        ? null
        : Object.freeze({
            id: row.users.id,
            name: row.users.name,
            username: row.users.username,
            profilePicture: row.users.profilePicture,
            blueTick: row.users.blueTick,
            goldenTick: row.users.goldenTick,
          }),
  });

const transactionOps = (
  transaction: Prisma.TransactionClient,
): StatusTransactionClient => ({
  async findById(id) {
    const row = await transaction.status.findUnique({
      where: { id },
      include: statusInclude,
    });
    return row === null ? null : toStatusRecord(row);
  },
  async setReactions(id, reactions) {
    await transaction.status.update({
      where: { id },
      data: { reactions: reactions as Prisma.InputJsonValue },
    });
  },
});

export const createStatusPrismaClient = (
  db: PrismaClient,
): StatusPrismaClient => ({
  async create(data) {
    const row = await db.status.create({
      data: {
        ...data,
        reactions: data.reactions as Prisma.InputJsonValue,
        originalContent: data.originalContent as Prisma.InputJsonValue,
        shareMetadata: data.shareMetadata as Prisma.InputJsonValue,
      },
      include: statusInclude,
    });
    return toStatusRecord(row);
  },

  async findById(id) {
    const row = await db.status.findUnique({
      where: { id },
      include: statusInclude,
    });
    return row === null ? null : toStatusRecord(row);
  },

  async findActive(now, skip, take) {
    const rows = await db.status.findMany({
      where: { expiresAt: { gt: now } },
      include: statusInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    return Object.freeze(rows.map(toStatusRecord));
  },

  /** Scoped by owner in the same statement, so a miss cannot leak existence. */
  async deleteOwned(id, userId) {
    const result = await db.status.deleteMany({ where: { id, userId } });
    return result.count;
  },

  async runSerializable<T>(
    operation: (transaction: StatusTransactionClient) => Promise<T>,
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
      'That status is being updated. Please try again.',
    );
  },
});
