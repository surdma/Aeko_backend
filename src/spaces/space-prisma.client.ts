import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { DomainError } from '../common/errors/domain.error';
import { toJsonValue, type JsonValue } from '../common/json/json-value';
import type { PostAuthorView } from '../posts/post.contract';

export type WritableJson = Exclude<JsonValue, null>;

export interface SpaceRecord {
  readonly id: string;
  readonly title: string;
  readonly hostId: string;
  readonly host: PostAuthorView | null;
  readonly participants: JsonValue;
  readonly highlights: JsonValue;
  readonly isLive: boolean;
  readonly createdAt: Date;
}

export interface SpaceWriteData {
  readonly title?: string;
  readonly hostId?: string;
  readonly participants?: WritableJson;
  readonly highlights?: WritableJson;
  readonly isLive?: boolean;
}

export interface SpaceTransactionClient {
  findById(id: string): Promise<SpaceRecord | null>;
  update(id: string, data: SpaceWriteData): Promise<SpaceRecord>;
}

export const SERIALIZABLE_ATTEMPTS = 3;

export interface SpacePrismaClient {
  create(data: SpaceWriteData): Promise<SpaceRecord>;
  findById(id: string): Promise<SpaceRecord | null>;
  update(id: string, data: SpaceWriteData): Promise<SpaceRecord>;
  runSerializable<T>(
    operation: (transaction: SpaceTransactionClient) => Promise<T>,
  ): Promise<T>;
}

const hostSelect = {
  id: true,
  name: true,
  username: true,
  profilePicture: true,
  blueTick: true,
  goldenTick: true,
} satisfies Prisma.UserSelect;

const spaceInclude = {
  user: { select: hostSelect },
} satisfies Prisma.SpaceInclude;

type SpaceRow = Prisma.SpaceGetPayload<{ include: typeof spaceInclude }>;

const WRITE_CONFLICT_CODE = 'P2034';

const isWriteConflict = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  Reflect.get(error, 'code') === WRITE_CONFLICT_CODE;

const toRecord = (row: SpaceRow): SpaceRecord =>
  Object.freeze({
    id: row.id,
    title: row.title,
    hostId: row.hostId,
    host:
      row.user === null
        ? null
        : Object.freeze({
            id: row.user.id,
            name: row.user.name,
            username: row.user.username,
            profilePicture: row.user.profilePicture,
            blueTick: row.user.blueTick,
            goldenTick: row.user.goldenTick,
          }),
    participants: toJsonValue(row.participants),
    highlights: toJsonValue(row.highlights),
    isLive: row.isLive,
    createdAt: row.createdAt,
  });

const jsonInput = (value: WritableJson): Prisma.InputJsonValue => value;

const asWrite = (data: SpaceWriteData): Prisma.SpaceUncheckedUpdateInput => ({
  ...(data.title === undefined ? {} : { title: data.title }),
  ...(data.hostId === undefined ? {} : { hostId: data.hostId }),
  ...(data.isLive === undefined ? {} : { isLive: data.isLive }),
  ...(data.participants === undefined
    ? {}
    : { participants: jsonInput(data.participants) }),
  ...(data.highlights === undefined
    ? {}
    : { highlights: jsonInput(data.highlights) }),
});

const transactionOps = (
  transaction: Prisma.TransactionClient,
): SpaceTransactionClient => ({
  async findById(id) {
    const row = await transaction.space.findUnique({
      where: { id },
      include: spaceInclude,
    });
    return row === null ? null : toRecord(row);
  },
  async update(id, data) {
    const row = await transaction.space.update({
      where: { id },
      data: asWrite(data),
      include: spaceInclude,
    });
    return toRecord(row);
  },
});

export const createSpacePrismaClient = (
  db: PrismaClient,
): SpacePrismaClient => ({
  async create(data) {
    const row = await db.space.create({
      data: asWrite(data) as Prisma.SpaceUncheckedCreateInput,
      include: spaceInclude,
    });
    return toRecord(row);
  },

  async findById(id) {
    const row = await db.space.findUnique({
      where: { id },
      include: spaceInclude,
    });
    return row === null ? null : toRecord(row);
  },

  async update(id, data) {
    const row = await db.space.update({
      where: { id },
      data: asWrite(data),
      include: spaceInclude,
    });
    return toRecord(row);
  },

  async runSerializable<T>(
    operation: (transaction: SpaceTransactionClient) => Promise<T>,
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
      'That space is being updated. Please try again.',
    );
  },
});
