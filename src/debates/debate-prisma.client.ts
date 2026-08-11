import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { DomainError } from '../common/errors/domain.error';
import { toJsonValue, type JsonValue } from '../common/json/json-value';
import type { PostAuthorView } from '../posts/post.contract';
import type { DebateParticipantView } from './debate.contract';

export interface DebateRecord {
  readonly id: string;
  readonly topic: string;
  readonly creatorId: string;
  readonly creator: PostAuthorView | null;
  readonly participants: JsonValue;
  readonly scores: JsonValue;
  readonly votes: JsonValue;
  readonly status: string;
  readonly winner: string | null;
  readonly endReason: string | null;
  readonly endedAt: Date | null;
  readonly createdAt: Date;
}

/** JSON accepted on a write; these columns are never set to null. */
export type WritableJson = Exclude<JsonValue, null>;

export interface DebateWriteData {
  readonly topic?: string;
  readonly participants?: WritableJson;
  readonly creatorId?: string;
  readonly scores?: WritableJson;
  readonly votes?: WritableJson;
  readonly status?: string;
  readonly winner?: string | null;
  readonly endReason?: string;
  readonly endedAt?: Date;
}

export interface DebateTransactionClient {
  findById(id: string): Promise<DebateRecord | null>;
  update(id: string, data: DebateWriteData): Promise<DebateRecord>;
}

export const SERIALIZABLE_ATTEMPTS = 3;

export interface DebatePrismaClient {
  create(data: DebateWriteData): Promise<DebateRecord>;
  findById(id: string): Promise<DebateRecord | null>;
  findMany(
    status: string | null,
    skip: number,
    take: number,
  ): Promise<readonly DebateRecord[]>;
  count(status: string | null): Promise<number>;
  update(id: string, data: DebateWriteData): Promise<DebateRecord>;
  /**
   * Resolves participant ids in one query. Legacy issued one user lookup per
   * debate row.
   */
  findParticipants(
    ids: readonly string[],
  ): Promise<readonly DebateParticipantView[]>;
  runSerializable<T>(
    operation: (transaction: DebateTransactionClient) => Promise<T>,
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

const debateInclude = {
  user: { select: creatorSelect },
} satisfies Prisma.DebateInclude;

type DebateRow = Prisma.DebateGetPayload<{ include: typeof debateInclude }>;

const WRITE_CONFLICT_CODE = 'P2034';

const isWriteConflict = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  Reflect.get(error, 'code') === WRITE_CONFLICT_CODE;

const toRecord = (row: DebateRow): DebateRecord =>
  Object.freeze({
    id: row.id,
    topic: row.topic,
    creatorId: row.creatorId,
    creator:
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
    scores: toJsonValue(row.scores),
    votes: toJsonValue(row.votes),
    status: row.status,
    winner: row.winner,
    endReason: row.endReason,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
  });

/**
 * The generated client is imported for types only. Importing it as a value —
 * for `Prisma.JsonNull`, say — pulls a module that uses `import.meta` into the
 * CommonJS test transform and fails at load. These columns are never written
 * null, so the write type excludes it and no runtime import is needed.
 */
const jsonInput = (value: WritableJson): Prisma.InputJsonValue => value;

const asWrite = (data: DebateWriteData): Prisma.DebateUncheckedUpdateInput => ({
  ...(data.topic === undefined ? {} : { topic: data.topic }),
  ...(data.creatorId === undefined ? {} : { creatorId: data.creatorId }),
  ...(data.status === undefined ? {} : { status: data.status }),
  ...(data.winner === undefined ? {} : { winner: data.winner }),
  ...(data.endReason === undefined ? {} : { endReason: data.endReason }),
  ...(data.endedAt === undefined ? {} : { endedAt: data.endedAt }),
  ...(data.participants === undefined
    ? {}
    : { participants: jsonInput(data.participants) }),
  ...(data.scores === undefined ? {} : { scores: jsonInput(data.scores) }),
  ...(data.votes === undefined ? {} : { votes: jsonInput(data.votes) }),
});

const transactionOps = (
  transaction: Prisma.TransactionClient,
): DebateTransactionClient => ({
  async findById(id) {
    const row = await transaction.debate.findUnique({
      where: { id },
      include: debateInclude,
    });
    return row === null ? null : toRecord(row);
  },
  async update(id, data) {
    const row = await transaction.debate.update({
      where: { id },
      data: asWrite(data),
      include: debateInclude,
    });
    return toRecord(row);
  },
});

export const createDebatePrismaClient = (
  db: PrismaClient,
): DebatePrismaClient => ({
  async create(data) {
    const row = await db.debate.create({
      data: asWrite(data) as Prisma.DebateUncheckedCreateInput,
      include: debateInclude,
    });
    return toRecord(row);
  },

  async findById(id) {
    const row = await db.debate.findUnique({
      where: { id },
      include: debateInclude,
    });
    return row === null ? null : toRecord(row);
  },

  async findMany(status, skip, take) {
    const rows = await db.debate.findMany({
      where: status === null ? {} : { status },
      include: debateInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    return Object.freeze(rows.map(toRecord));
  },

  async count(status) {
    return db.debate.count({ where: status === null ? {} : { status } });
  },

  async update(id, data) {
    const row = await db.debate.update({
      where: { id },
      data: asWrite(data),
      include: debateInclude,
    });
    return toRecord(row);
  },

  async findParticipants(ids) {
    if (ids.length === 0) return Object.freeze([]);
    const rows = await db.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, username: true, profilePicture: true },
    });
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          id: row.id,
          username: row.username,
          profilePicture: row.profilePicture,
        }),
      ),
    );
  },

  async runSerializable<T>(
    operation: (transaction: DebateTransactionClient) => Promise<T>,
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
      'That debate is being updated. Please try again.',
    );
  },
});
