import type { Prisma, PrismaClient } from '../../prisma/generated/client';
import { DomainError } from '../common/errors/domain.error';
import {
  asJsonObject,
  toJsonValue,
  type JsonValue,
} from '../common/json/json-value';
import type { PostAuthorView } from './post.contract';

export interface PostRecord {
  readonly id: string;
  readonly text: string | null;
  readonly type: string;
  readonly userId: string;
  readonly views: number;
  readonly privacy: JsonValue;
  readonly likes: JsonValue;
  readonly media: JsonValue;
  readonly engagement: JsonValue;
  readonly ad: JsonValue;
  readonly status: string;
  readonly isAnchored: boolean;
  readonly nftTokenId: string | null;
  readonly contentUri: string | null;
  readonly originalPostId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly author: PostAuthorView | null;
  readonly commentsCount: number;
}

export interface PostWriteData {
  readonly [key: string]:
    JsonValue | Date | readonly string[] | number | undefined;
}

export interface SharedStatusRecord {
  readonly id: string;
  readonly userId: string;
  readonly content: string;
  readonly sharedPostId: string | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface PostViewerRecord {
  readonly following: readonly string[];
  readonly blockedUserIds: readonly string[];
  readonly notInterestedPostIds: readonly string[];
}

export type PostFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'search'; readonly q: string }
  | { readonly kind: 'author'; readonly userId: string }
  | { readonly kind: 'types'; readonly types: readonly string[] }
  | { readonly kind: 'reposts'; readonly originalPostId: string }
  | { readonly kind: 'liked'; readonly userId: string };

export interface PostPageQuery {
  readonly filter: PostFilter;
  readonly skip: number;
  readonly take: number;
}

export interface PostTransactionClient {
  findById(id: string): Promise<PostRecord | null>;
  update(id: string, data: PostWriteData): Promise<PostRecord>;
  countBookmarks(postId: string): Promise<number>;
  findBookmark(userId: string, postId: string): Promise<string | null>;
  createBookmark(userId: string, postId: string): Promise<void>;
  deleteBookmark(id: string): Promise<void>;
  /**
   * Relational half of the dual-write for `posts.likes`, run inside the same
   * transaction as the JSON update. The JSON column is still authoritative for
   * reads while the legacy Express service writes it.
   */
  setPostLike(userId: string, postId: string, liked: boolean): Promise<void>;
}

export const SERIALIZABLE_ATTEMPTS = 3;

export interface PostPrismaClient {
  create(data: PostWriteData): Promise<PostRecord>;
  /**
   * Like and bookmark toggles read-modify-write JSON columns, so they run at
   * `Serializable` isolation with bounded P2034 retry; Express wrote them back
   * whole with no transaction and lost concurrent updates.
   */
  runSerializable<T>(
    operation: (transaction: PostTransactionClient) => Promise<T>,
  ): Promise<T>;
  createSharedStatus(data: PostWriteData): Promise<SharedStatusRecord>;
  readNotInterested(userId: string): Promise<readonly string[]>;
  writeNotInterested(userId: string, postIds: readonly string[]): Promise<void>;
  findById(id: string): Promise<PostRecord | null>;
  findMany(query: PostPageQuery): Promise<readonly PostRecord[]>;
  count(filter: PostFilter): Promise<number>;
  findBookmarked(
    userId: string,
    skip: number,
    take: number,
  ): Promise<readonly PostRecord[]>;
  countBookmarked(userId: string): Promise<number>;
  incrementViews(id: string): Promise<number>;
  update(id: string, data: PostWriteData): Promise<PostRecord>;
  delete(id: string): Promise<void>;
  readViewer(id: string): Promise<PostViewerRecord>;
}

const WRITE_CONFLICT_CODE = 'P2034';

const isWriteConflict = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  Reflect.get(error, 'code') === WRITE_CONFLICT_CODE;

/** The legacy relation name for the post author. */
const AUTHOR_RELATION = 'users_posts_userIdTouser';

const postInclude = {
  [AUTHOR_RELATION]: {
    select: {
      id: true,
      name: true,
      username: true,
      profilePicture: true,
      blueTick: true,
      goldenTick: true,
    },
  },
  _count: { select: { comments: true } },
} satisfies Prisma.PostInclude;

type PostRow = Prisma.PostGetPayload<{ include: typeof postInclude }>;

const whereOf = (filter: PostFilter): Prisma.PostWhereInput => {
  switch (filter.kind) {
    case 'all':
      return {};
    case 'search':
      return { text: { contains: filter.q, mode: 'insensitive' } };
    case 'author':
      return { userId: filter.userId };
    case 'types':
      return { type: { in: [...filter.types] } };
    case 'reposts':
      return { originalPostId: filter.originalPostId };
    case 'liked':
      return { likes: { array_contains: filter.userId } };
  }
};

/**
 * `PostWriteData` is assembled from validated request contracts rather than
 * from Prisma input types, so its shape is checked at the contract layer.
 * Prisma still validates column names and types against the schema.
 */
const writeInput = (data: PostWriteData): Prisma.PostUncheckedUpdateInput => ({
  ...data,
});

const toPostRecord = (row: PostRow): PostRecord =>
  Object.freeze({
    id: row.id,
    text: row.text,
    type: row.type,
    userId: row.userId,
    views: row.views,
    privacy: toJsonValue(row.privacy),
    likes: toJsonValue(row.likes),
    media: toJsonValue(row.media),
    engagement: toJsonValue(row.engagement),
    ad: toJsonValue(row.ad),
    status: row.status,
    isAnchored: row.isAnchored,
    nftTokenId: row.nftTokenId,
    contentUri: row.contentUri,
    originalPostId: row.originalPostId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    author: readAuthor(row[AUTHOR_RELATION]),
    commentsCount: row._count.comments,
  });

/**
 * `Post.users_posts_userIdTouser` is a required relation, so a missing author
 * only happens when the caller omitted the include. Preserved as `null` rather
 * than a throw, matching the previous boundary.
 */
const readAuthor = (
  user: PostRow[typeof AUTHOR_RELATION] | null,
): PostAuthorView | null =>
  user === null || user === undefined
    ? null
    : Object.freeze({
        id: user.id,
        name: user.name,
        username: user.username,
        profilePicture: user.profilePicture,
        blueTick: user.blueTick,
        goldenTick: user.goldenTick,
      });

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

/**
 * Blocked entries have accumulated several shapes over time; every historical
 * form is read so an old row cannot silently stop blocking.
 */
const blockedIds = (value: Prisma.JsonValue): string[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): string[] => {
    if (typeof entry === 'string') return [entry];
    if (typeof entry !== 'object' || entry === null) return [];
    for (const key of ['user', 'userId', 'id']) {
      const candidate: unknown = Reflect.get(entry, key);
      if (typeof candidate === 'string') return [candidate];
    }
    return [];
  });
};

const transactionOps = (
  transaction: Prisma.TransactionClient,
): PostTransactionClient => ({
  async findById(id) {
    const row = await transaction.post.findUnique({
      where: { id },
      include: postInclude,
    });
    return row === null ? null : toPostRecord(row);
  },
  async update(id, data) {
    return toPostRecord(
      await transaction.post.update({
        where: { id },
        data: writeInput(data),
        include: postInclude,
      }),
    );
  },
  async countBookmarks(postId) {
    return transaction.bookmark.count({ where: { postId } });
  },
  async findBookmark(userId, postId) {
    const row = await transaction.bookmark.findUnique({
      where: { userId_postId: { userId, postId } },
      select: { id: true },
    });
    return row === null ? null : row.id;
  },
  async createBookmark(userId, postId) {
    await transaction.bookmark.create({ data: { userId, postId } });
  },
  async deleteBookmark(id) {
    await transaction.bookmark.delete({ where: { id } });
  },
  async setPostLike(userId, postId, liked) {
    if (liked) {
      await transaction.postLike.upsert({
        where: { userId_postId: { userId, postId } },
        create: { userId, postId },
        update: {},
      });
      return;
    }
    await transaction.postLike.deleteMany({ where: { userId, postId } });
  },
});

export const createPostPrismaClient = (db: PrismaClient): PostPrismaClient => ({
  async create(data) {
    const row = await db.post.create({
      data: { ...data } as Prisma.PostUncheckedCreateInput,
      include: postInclude,
    });
    return toPostRecord(row);
  },

  async runSerializable<T>(
    operation: (transaction: PostTransactionClient) => Promise<T>,
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
      'That post is being updated. Please try again.',
    );
  },

  async createSharedStatus(data) {
    const row = await db.status.create({
      data: { ...data } as Prisma.StatusUncheckedCreateInput,
      select: {
        id: true,
        userId: true,
        content: true,
        sharedPostId: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return Object.freeze({ ...row });
  },

  async readNotInterested(userId) {
    const row = await db.user.findUnique({
      where: { id: userId },
      select: { notInterested: true },
    });
    if (row === null) return Object.freeze([]);
    return Object.freeze(
      stringList(asJsonObject(toJsonValue(row.notInterested)).posts),
    );
  },

  async writeNotInterested(userId, postIds) {
    // The JSON column is replaced wholesale, so the relational set is synced
    // to match rather than diffed. Both writes share one transaction so the
    // two representations cannot diverge partway through.
    await db.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: userId },
        data: { notInterested: { posts: [...postIds] } },
      });
      await transaction.notInterested.deleteMany({
        where: { userId, postId: { notIn: [...postIds] } },
      });
      if (postIds.length > 0) {
        await transaction.notInterested.createMany({
          data: postIds.map((postId) => ({ userId, postId })),
          skipDuplicates: true,
        });
      }
    });
  },

  async findById(id) {
    const row = await db.post.findUnique({
      where: { id },
      include: postInclude,
    });
    return row === null ? null : toPostRecord(row);
  },

  async findMany({ filter, skip, take }) {
    const rows = await db.post.findMany({
      where: whereOf(filter),
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: postInclude,
    });
    return rows.map(toPostRecord);
  },

  async count(filter) {
    return db.post.count({ where: whereOf(filter) });
  },

  async findBookmarked(userId, skip, take) {
    const rows = await db.bookmark.findMany({
      where: { userId },
      orderBy: { savedAt: 'desc' },
      skip,
      take,
      include: { post: { include: postInclude } },
    });
    // A bookmark can outlive its post; those rows are skipped, as before.
    return rows.flatMap((entry) =>
      entry.post === null || entry.post === undefined
        ? []
        : [toPostRecord(entry.post)],
    );
  },

  async countBookmarked(userId) {
    return db.bookmark.count({ where: { userId } });
  },

  async incrementViews(id) {
    const row = await db.post.update({
      where: { id },
      data: { views: { increment: 1 } },
      select: { views: true },
    });
    return row.views;
  },

  async update(id, data) {
    return toPostRecord(
      await db.post.update({
        where: { id },
        data: writeInput(data),
        include: postInclude,
      }),
    );
  },

  async delete(id) {
    await db.post.delete({ where: { id } });
  },

  async readViewer(id) {
    const row = await db.user.findUnique({
      where: { id },
      select: { following: true, blockedUsers: true, notInterested: true },
    });
    if (row === null) {
      return Object.freeze({
        following: Object.freeze([]),
        blockedUserIds: Object.freeze([]),
        notInterestedPostIds: Object.freeze([]),
      });
    }
    return Object.freeze({
      following: Object.freeze(stringList(row.following)),
      blockedUserIds: Object.freeze(blockedIds(row.blockedUsers)),
      notInterestedPostIds: Object.freeze(
        stringList(asJsonObject(toJsonValue(row.notInterested)).posts),
      ),
    });
  },
});
