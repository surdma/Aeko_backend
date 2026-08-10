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

export interface PostPrismaClient {
  create(data: PostWriteData): Promise<PostRecord>;
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

export const createPostPrismaClient = (client: object): PostPrismaClient => {
  const postDelegate = readObject(client, 'post');
  const userDelegate = readObject(client, 'user');
  requireMethod(postDelegate, 'create');
  requireMethod(postDelegate, 'findUnique');
  requireMethod(postDelegate, 'update');
  requireMethod(postDelegate, 'delete');
  requireMethod(userDelegate, 'findUnique');

  return {
    async create(data) {
      const value = await invoke(postDelegate, 'create', [
        { data: { ...data }, include: postInclude },
      ]);
      return parsePostRecord(value);
    },
    async findById(id) {
      const value = await invoke(postDelegate, 'findUnique', [
        { where: { id }, include: postInclude },
      ]);
      return value === null || value === undefined
        ? null
        : parsePostRecord(value);
    },
    async findMany({ filter, skip, take }) {
      const value = await invoke(postDelegate, 'findMany', [
        {
          where: whereOf(filter),
          orderBy: { createdAt: 'desc' },
          skip,
          take,
          include: postInclude,
        },
      ]);
      if (!Array.isArray(value)) invalidResult('findMany');
      return value.map(parsePostRecord);
    },
    async count(filter) {
      const value = await invoke(postDelegate, 'count', [
        { where: whereOf(filter) },
      ]);
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        invalidResult('count');
      }
      return value;
    },
    async findBookmarked(userId, skip, take) {
      const bookmarkDelegate = readObject(client, 'bookmark');
      requireMethod(bookmarkDelegate, 'findMany');
      const value = await invoke(bookmarkDelegate, 'findMany', [
        {
          where: { userId },
          orderBy: { savedAt: 'desc' },
          skip,
          take,
          include: { post: { include: postInclude } },
        },
      ]);
      if (!Array.isArray(value)) invalidResult('findMany');
      return value.flatMap((entry: unknown) => {
        const post: unknown =
          typeof entry === 'object' && entry !== null
            ? Reflect.get(entry, 'post')
            : null;
        // A bookmark can outlive its post; those rows are skipped, as before.
        return post === null || post === undefined
          ? []
          : [parsePostRecord(post)];
      });
    },
    async countBookmarked(userId) {
      const bookmarkDelegate = readObject(client, 'bookmark');
      requireMethod(bookmarkDelegate, 'count');
      const value = await invoke(bookmarkDelegate, 'count', [
        { where: { userId } },
      ]);
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        invalidResult('count');
      }
      return value;
    },
    async incrementViews(id) {
      const value = await invoke(postDelegate, 'update', [
        {
          where: { id },
          data: { views: { increment: 1 } },
          select: { views: true },
        },
      ]);
      const record = requireObject(value, 'view result');
      return readNumber(record, 'views');
    },
    async update(id, data) {
      const value = await invoke(postDelegate, 'update', [
        { where: { id }, data: { ...data }, include: postInclude },
      ]);
      return parsePostRecord(value);
    },
    async delete(id) {
      await invoke(postDelegate, 'delete', [{ where: { id } }]);
    },
    async readViewer(id) {
      const value = await invoke(userDelegate, 'findUnique', [
        {
          where: { id },
          select: {
            following: true,
            blockedUsers: true,
            notInterested: true,
          },
        },
      ]);
      if (value === null || value === undefined) {
        return Object.freeze({
          following: Object.freeze([]),
          blockedUserIds: Object.freeze([]),
          notInterestedPostIds: Object.freeze([]),
        });
      }
      const record = requireObject(value, 'viewer result');
      const notInterested = toJsonValue(Reflect.get(record, 'notInterested'));
      return Object.freeze({
        following: Object.freeze(stringList(Reflect.get(record, 'following'))),
        blockedUserIds: Object.freeze(
          blockedIds(Reflect.get(record, 'blockedUsers')),
        ),
        notInterestedPostIds: Object.freeze(
          stringList(asJsonObject(notInterested).posts),
        ),
      });
    },
  };
};

const whereOf = (filter: PostFilter): Readonly<Record<string, unknown>> => {
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
} as const;

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

/**
 * Blocked entries have accumulated several shapes over time; every historical
 * form is read so an old row cannot silently stop blocking.
 */
const blockedIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry === 'string') return [entry];
    if (typeof entry !== 'object' || entry === null) return [];
    for (const key of ['user', 'userId', 'id']) {
      const candidate: unknown = Reflect.get(entry, key);
      if (typeof candidate === 'string') return [candidate];
    }
    return [];
  });
};

const parsePostRecord = (value: unknown): PostRecord => {
  const record = requireObject(value, 'post result');
  const counts: unknown = Reflect.get(record, '_count');
  return Object.freeze({
    id: readString(record, 'id'),
    text: readNullableString(record, 'text'),
    type: readString(record, 'type'),
    userId: readString(record, 'userId'),
    views: readNumber(record, 'views'),
    privacy: toJsonValue(Reflect.get(record, 'privacy')),
    likes: toJsonValue(Reflect.get(record, 'likes')),
    media: toJsonValue(Reflect.get(record, 'media')),
    status: readNullableString(record, 'status') ?? 'active',
    isAnchored: Reflect.get(record, 'isAnchored') === true,
    nftTokenId: readNullableString(record, 'nftTokenId'),
    contentUri: readNullableString(record, 'contentUri'),
    originalPostId: readNullableString(record, 'originalPostId'),
    createdAt: readDate(record, 'createdAt'),
    updatedAt: readDate(record, 'updatedAt'),
    author: readAuthor(Reflect.get(record, AUTHOR_RELATION)),
    commentsCount:
      typeof counts === 'object' && counts !== null
        ? readNumber(counts, 'comments')
        : 0,
  });
};

const readAuthor = (value: unknown): PostAuthorView | null => {
  if (typeof value !== 'object' || value === null) return null;
  return Object.freeze({
    id: readNullableString(value, 'id'),
    name: readNullableString(value, 'name'),
    username: readNullableString(value, 'username'),
    profilePicture: readNullableString(value, 'profilePicture'),
    blueTick: Reflect.get(value, 'blueTick') === true,
    goldenTick: Reflect.get(value, 'goldenTick') === true,
  });
};

const invoke = async (
  target: object,
  method: string,
  args: readonly unknown[],
): Promise<unknown> => {
  const candidate: unknown = Reflect.get(target, method);
  if (typeof candidate !== 'function') missingBoundary(method);
  return Promise.resolve(Reflect.apply(candidate, target, args));
};

const requireMethod = (target: object, method: string): void => {
  if (typeof Reflect.get(target, method) !== 'function') {
    missingBoundary(method);
  }
};

const readObject = (target: object, key: string): object =>
  requireObject(Reflect.get(target, key), key);

const requireObject = (value: unknown, key: string): object => {
  if (typeof value !== 'object' || value === null) missingBoundary(key);
  return value;
};

const readString = (value: object, key: string): string => {
  const property: unknown = Reflect.get(value, key);
  if (typeof property !== 'string') invalidResult(key);
  return property;
};

const readNullableString = (value: object, key: string): string | null => {
  const property: unknown = Reflect.get(value, key);
  if (property === null || property === undefined) return null;
  if (typeof property !== 'string') invalidResult(key);
  return property;
};

const readNumber = (value: object, key: string): number => {
  const property: unknown = Reflect.get(value, key);
  if (typeof property !== 'number' || !Number.isFinite(property)) return 0;
  return property;
};

const readDate = (value: object, key: string): Date => {
  const property: unknown = Reflect.get(value, key);
  if (!(property instanceof Date) || Number.isNaN(property.getTime())) {
    invalidResult(key);
  }
  return property;
};

function missingBoundary(name: string): never {
  throw new DomainError(
    'DATABASE_UNAVAILABLE',
    'The content service is temporarily unavailable.',
    { boundary: [name] },
  );
}

function invalidResult(name: string): never {
  throw new DomainError(
    'DATABASE_UNAVAILABLE',
    'The content service returned an unexpected record.',
    { field: [name] },
  );
}
