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

export interface PostPrismaClient {
  create(data: PostWriteData): Promise<PostRecord>;
  findById(id: string): Promise<PostRecord | null>;
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
