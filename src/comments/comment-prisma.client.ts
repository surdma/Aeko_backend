import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { DomainError } from '../common/errors/domain.error';
import { toJsonValue, type JsonValue } from '../common/json/json-value';
import type { PostAuthorView } from '../posts/post.contract';

export interface CommentRecord {
  readonly id: string;
  readonly text: string;
  readonly userId: string;
  readonly postId: string;
  readonly parentId: string | null;
  readonly likes: JsonValue;
  readonly author: PostAuthorView | null;
  readonly replies: readonly CommentRecord[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CommentWriteData {
  readonly text: string;
  readonly userId: string;
  readonly postId: string;
  readonly parentId?: string;
}

export interface CommentTransactionClient {
  findById(id: string): Promise<CommentRecord | null>;
  setLikes(id: string, likes: readonly string[]): Promise<CommentRecord>;
  /**
   * Relational half of the dual-write for `comments.likes`, run inside the same
   * transaction as the JSON update. The JSON column stays authoritative for
   * reads while the legacy Express service still writes it (Plan C step 3).
   */
  setCommentLike(userId: string, commentId: string): Promise<void>;
}

export const SERIALIZABLE_ATTEMPTS = 3;

export interface CommentPrismaClient {
  create(data: CommentWriteData): Promise<CommentRecord>;
  findById(id: string): Promise<CommentRecord | null>;
  findTopLevel(
    postId: string,
    skip: number,
    take: number,
  ): Promise<readonly CommentRecord[]>;
  findReplies(
    parentId: string,
    skip: number,
    take: number,
  ): Promise<readonly CommentRecord[]>;
  countForPost(postId: string): Promise<number>;
  runSerializable<T>(
    operation: (transaction: CommentTransactionClient) => Promise<T>,
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

const commentInclude = {
  user: { select: authorSelect },
  replies: {
    include: { user: { select: authorSelect } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.CommentInclude;

type CommentRow = Prisma.CommentGetPayload<{ include: typeof commentInclude }>;
type ReplyRow = CommentRow['replies'][number];

const WRITE_CONFLICT_CODE = 'P2034';

const isWriteConflict = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  Reflect.get(error, 'code') === WRITE_CONFLICT_CODE;

const toAuthor = (
  user: Prisma.UserGetPayload<{ select: typeof authorSelect }> | null,
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

const toReplyRecord = (row: ReplyRow): CommentRecord =>
  Object.freeze({
    id: row.id,
    text: row.text,
    userId: row.userId,
    postId: row.postId,
    parentId: row.parentId,
    likes: toJsonValue(row.likes),
    author: toAuthor(row.user),
    replies: Object.freeze([]),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

const toCommentRecord = (row: CommentRow): CommentRecord =>
  Object.freeze({
    id: row.id,
    text: row.text,
    userId: row.userId,
    postId: row.postId,
    parentId: row.parentId,
    likes: toJsonValue(row.likes),
    author: toAuthor(row.user),
    replies: Object.freeze((row.replies ?? []).map(toReplyRecord)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

const transactionOps = (
  transaction: Prisma.TransactionClient,
): CommentTransactionClient => ({
  async findById(id) {
    const row = await transaction.comment.findUnique({
      where: { id },
      include: commentInclude,
    });
    return row === null ? null : toCommentRecord(row);
  },
  async setLikes(id, likes) {
    const row = await transaction.comment.update({
      where: { id },
      data: { likes: [...likes] },
      include: commentInclude,
    });
    return toCommentRecord(row);
  },
  async setCommentLike(userId, commentId) {
    await transaction.commentLike.upsert({
      where: { userId_commentId: { userId, commentId } },
      create: { userId, commentId },
      update: {},
    });
  },
});

export const createCommentPrismaClient = (
  db: PrismaClient,
): CommentPrismaClient => ({
  async create(data) {
    const row = await db.comment.create({
      data: { ...data, likes: [] },
      include: commentInclude,
    });
    return toCommentRecord(row);
  },

  async findById(id) {
    const row = await db.comment.findUnique({
      where: { id },
      include: commentInclude,
    });
    return row === null ? null : toCommentRecord(row);
  },

  async findTopLevel(postId, skip, take) {
    const rows = await db.comment.findMany({
      where: { postId, parentId: null },
      include: commentInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    return Object.freeze(rows.map(toCommentRecord));
  },

  async findReplies(parentId, skip, take) {
    const rows = await db.comment.findMany({
      where: { parentId },
      include: commentInclude,
      orderBy: { createdAt: 'asc' },
      skip,
      take,
    });
    return Object.freeze(rows.map(toCommentRecord));
  },

  async countForPost(postId) {
    return db.comment.count({ where: { postId } });
  },

  async runSerializable<T>(
    operation: (transaction: CommentTransactionClient) => Promise<T>,
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
      'That comment is being updated. Please try again.',
    );
  },
});
