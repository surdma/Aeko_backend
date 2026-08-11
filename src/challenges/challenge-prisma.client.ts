import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { DomainError } from '../common/errors/domain.error';
import { toJsonValue, type JsonValue } from '../common/json/json-value';
import type { PostAuthorView } from '../posts/post.contract';

export type WritableJson = Exclude<JsonValue, null>;

export interface ChallengeRecord {
  readonly id: string;
  readonly creatorId: string;
  readonly creator: PostAuthorView | null;
  readonly videoUrl: string;
  readonly participants: JsonValue;
  readonly votes: JsonValue;
  readonly status: string;
  readonly winner: string | null;
  readonly endReason: string | null;
  readonly endedAt: Date | null;
  readonly createdAt: Date;
}

export interface ChallengeWriteData {
  readonly creatorId?: string;
  readonly videoUrl?: string;
  readonly participants?: WritableJson;
  readonly votes?: WritableJson;
  readonly status?: string;
  readonly winner?: string | null;
  readonly endReason?: string;
  readonly endedAt?: Date;
}

export interface ChallengeTransactionClient {
  findById(id: string): Promise<ChallengeRecord | null>;
  update(id: string, data: ChallengeWriteData): Promise<ChallengeRecord>;
}

export const SERIALIZABLE_ATTEMPTS = 3;

export interface ChallengePrismaClient {
  create(data: ChallengeWriteData): Promise<ChallengeRecord>;
  findById(id: string): Promise<ChallengeRecord | null>;
  findMany(
    status: string | null,
    skip: number,
    take: number,
  ): Promise<readonly ChallengeRecord[]>;
  count(status: string | null): Promise<number>;
  update(id: string, data: ChallengeWriteData): Promise<ChallengeRecord>;
  findParticipants(ids: readonly string[]): Promise<readonly PostAuthorView[]>;
  runSerializable<T>(
    operation: (transaction: ChallengeTransactionClient) => Promise<T>,
  ): Promise<T>;
}

const creatorSelect = {
  id: true,
  name: true,
  username: true,
  profilePicture: true,
  blueTick: true,
  goldenTick: true,
} satisfies Prisma.UserSelect;

/**
 * The author relation is `user`. Legacy included `creator`, which does not
 * exist on the model, so every call to the listing raised a Prisma validation
 * error and returned 500.
 */
const challengeInclude = {
  user: { select: creatorSelect },
} satisfies Prisma.ChallengeInclude;

type ChallengeRow = Prisma.ChallengeGetPayload<{
  include: typeof challengeInclude;
}>;

const WRITE_CONFLICT_CODE = 'P2034';

const isWriteConflict = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  Reflect.get(error, 'code') === WRITE_CONFLICT_CODE;

const toAuthor = (
  user: Prisma.UserGetPayload<{ select: typeof creatorSelect }> | null,
): PostAuthorView | null =>
  user === null
    ? null
    : Object.freeze({
        id: user.id,
        name: user.name,
        username: user.username,
        profilePicture: user.profilePicture,
        blueTick: user.blueTick,
        goldenTick: user.goldenTick,
      });

const toRecord = (row: ChallengeRow): ChallengeRecord =>
  Object.freeze({
    id: row.id,
    creatorId: row.creatorId,
    creator: toAuthor(row.user),
    videoUrl: row.videoUrl,
    participants: toJsonValue(row.participants),
    votes: toJsonValue(row.votes),
    status: row.status,
    winner: row.winner,
    endReason: row.endReason,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
  });

const jsonInput = (value: WritableJson): Prisma.InputJsonValue => value;

const asWrite = (
  data: ChallengeWriteData,
): Prisma.ChallengeUncheckedUpdateInput => ({
  ...(data.creatorId === undefined ? {} : { creatorId: data.creatorId }),
  ...(data.videoUrl === undefined ? {} : { videoUrl: data.videoUrl }),
  ...(data.status === undefined ? {} : { status: data.status }),
  ...(data.winner === undefined ? {} : { winner: data.winner }),
  ...(data.endReason === undefined ? {} : { endReason: data.endReason }),
  ...(data.endedAt === undefined ? {} : { endedAt: data.endedAt }),
  ...(data.participants === undefined
    ? {}
    : { participants: jsonInput(data.participants) }),
  ...(data.votes === undefined ? {} : { votes: jsonInput(data.votes) }),
});

const transactionOps = (
  transaction: Prisma.TransactionClient,
): ChallengeTransactionClient => ({
  async findById(id) {
    const row = await transaction.challenge.findUnique({
      where: { id },
      include: challengeInclude,
    });
    return row === null ? null : toRecord(row);
  },
  async update(id, data) {
    const row = await transaction.challenge.update({
      where: { id },
      data: asWrite(data),
      include: challengeInclude,
    });
    return toRecord(row);
  },
});

export const createChallengePrismaClient = (
  db: PrismaClient,
): ChallengePrismaClient => ({
  async create(data) {
    const row = await db.challenge.create({
      data: asWrite(data) as Prisma.ChallengeUncheckedCreateInput,
      include: challengeInclude,
    });
    return toRecord(row);
  },

  async findById(id) {
    const row = await db.challenge.findUnique({
      where: { id },
      include: challengeInclude,
    });
    return row === null ? null : toRecord(row);
  },

  async findMany(status, skip, take) {
    const rows = await db.challenge.findMany({
      where: status === null ? {} : { status },
      include: challengeInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    return Object.freeze(rows.map(toRecord));
  },

  async count(status) {
    return db.challenge.count({ where: status === null ? {} : { status } });
  },

  async update(id, data) {
    const row = await db.challenge.update({
      where: { id },
      data: asWrite(data),
      include: challengeInclude,
    });
    return toRecord(row);
  },

  async findParticipants(ids) {
    if (ids.length === 0) return Object.freeze([]);
    const rows = await db.user.findMany({
      where: { id: { in: [...ids] } },
      select: creatorSelect,
    });
    return Object.freeze(
      rows.flatMap((row) => {
        const author = toAuthor(row);
        return author === null ? [] : [author];
      }),
    );
  },

  async runSerializable<T>(
    operation: (transaction: ChallengeTransactionClient) => Promise<T>,
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
      'That challenge is being updated. Please try again.',
    );
  },
});
