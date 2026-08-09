import { DomainError } from '../common/errors/domain.error';
import type { ProfileUpdate } from './profile.contract';

export interface ProfileRecord {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly image: string | null;
  readonly avatar: string | null;
  readonly profilePicture: string | null;
  readonly coverPicture: string | null;
  readonly bio: string | null;
  readonly location: string | null;
  readonly blueTick: boolean;
  readonly goldenTick: boolean;
  readonly subscriptionStatus: string;
  readonly subscriptionExpiry: Date | null;
  readonly walletAddress: string | null;
  readonly twoFactorEnabled: boolean | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lastLoginAt: Date | null;
  readonly followersCount: number;
  readonly postsCount: number;
  readonly bookmarksCount: number;
}

export interface PostActivityRecord {
  readonly id: string;
  readonly type: string;
  readonly createdAt: Date;
  readonly text: string | null;
  readonly hasMedia: boolean;
}

export interface CommentActivityRecord {
  readonly id: string;
  readonly text: string;
  readonly createdAt: Date;
  readonly postId: string;
}

export interface SecurityActivityRecord {
  readonly id: string;
  readonly eventType: string;
  readonly timestamp: Date;
  readonly ipAddress: string;
}

export interface VerificationSettingsRecord {
  readonly minFollowers: number;
  readonly minPosts: number;
  readonly requiresProfilePic: boolean;
  readonly requiresCoverPic: boolean;
  readonly requiresBio: boolean;
  readonly autoApprove: boolean;
}

export interface ProfilePrismaClient {
  findProfile(id: string): Promise<ProfileRecord | null>;
  updateProfile(id: string, update: ProfileUpdate): Promise<ProfileRecord>;
  findPosts(id: string, take: number): Promise<readonly PostActivityRecord[]>;
  findComments(
    id: string,
    take: number,
  ): Promise<readonly CommentActivityRecord[]>;
  findSecurityEvents(
    id: string,
    take: number,
  ): Promise<readonly SecurityActivityRecord[]>;
  findVerificationSettings(): Promise<VerificationSettingsRecord | null>;
}

export const createProfilePrismaClient = (
  client: object,
): ProfilePrismaClient => {
  const user = requireDelegate(client, 'user', ['findUnique', 'update']);
  const post = requireDelegate(client, 'post', ['findMany']);
  const comment = requireDelegate(client, 'comment', ['findMany']);
  const securityEvent = requireDelegate(client, 'securityEvent', ['findMany']);
  const verificationSettings = requireDelegate(client, 'verificationSettings', [
    'findFirst',
  ]);

  return {
    async findProfile(id) {
      const value = await invoke(user, 'findUnique', [profileQuery(id)]);
      return value === null ? null : parseProfile(value);
    },
    async updateProfile(id, update) {
      return parseProfile(
        await invoke(user, 'update', [
          { ...profileQuery(id), data: Object.freeze({ ...update }) },
        ]),
      );
    },
    async findPosts(id, take) {
      const value = await invoke(post, 'findMany', [
        {
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            id: true,
            type: true,
            createdAt: true,
            text: true,
            media: true,
          },
        },
      ]);
      return parseArray(value, parsePost);
    },
    async findComments(id, take) {
      const value = await invoke(comment, 'findMany', [
        {
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
          take,
          select: { id: true, text: true, createdAt: true, postId: true },
        },
      ]);
      return parseArray(value, parseComment);
    },
    async findSecurityEvents(id, take) {
      const value = await invoke(securityEvent, 'findMany', [
        {
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            id: true,
            eventType: true,
            timestamp: true,
            ipAddress: true,
          },
        },
      ]);
      return parseArray(value, parseSecurityEvent);
    },
    async findVerificationSettings() {
      const value = await invoke(verificationSettings, 'findFirst', [
        { select: verificationSettingsSelection },
      ]);
      return value === null ? null : parseVerificationSettings(value);
    },
  };
};

const profileSelection = {
  id: true,
  username: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  avatar: true,
  profilePicture: true,
  coverPicture: true,
  bio: true,
  location: true,
  blueTick: true,
  goldenTick: true,
  subscriptionStatus: true,
  subscriptionExpiry: true,
  walletAddress: true,
  twoFactorEnabled: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
  followers: true,
  _count: { select: { posts_posts_userIdTousers: true, bookmarks: true } },
} as const;

const profileQuery = (id: string) => ({
  where: { id },
  select: profileSelection,
});

const verificationSettingsSelection = {
  minFollowers: true,
  minPosts: true,
  requiresProfilePic: true,
  requiresCoverPic: true,
  requiresBio: true,
  autoApprove: true,
} as const;

const parseProfile = (value: unknown): ProfileRecord => {
  const record = requireObject(value);
  const counts = requireObject(Reflect.get(record, '_count'));
  return {
    id: readString(record, 'id'),
    username: readString(record, 'username'),
    name: readString(record, 'name'),
    email: readString(record, 'email'),
    emailVerified: readBoolean(record, 'emailVerified'),
    image: readNullableString(record, 'image'),
    avatar: readNullableString(record, 'avatar'),
    profilePicture: readNullableString(record, 'profilePicture'),
    coverPicture: readNullableString(record, 'coverPicture'),
    bio: readNullableString(record, 'bio'),
    location: readNullableString(record, 'location'),
    blueTick: readBoolean(record, 'blueTick'),
    goldenTick: readBoolean(record, 'goldenTick'),
    subscriptionStatus: readString(record, 'subscriptionStatus'),
    subscriptionExpiry: readNullableDate(record, 'subscriptionExpiry'),
    walletAddress: readNullableString(record, 'walletAddress'),
    twoFactorEnabled: readNullableBoolean(record, 'twoFactorEnabled'),
    createdAt: readDate(record, 'createdAt'),
    updatedAt: readDate(record, 'updatedAt'),
    lastLoginAt: readNullableDate(record, 'lastLoginAt'),
    followersCount: readFollowerCount(Reflect.get(record, 'followers')),
    postsCount: readCount(counts, 'posts_posts_userIdTousers'),
    bookmarksCount: readCount(counts, 'bookmarks'),
  };
};

const parsePost = (value: unknown): PostActivityRecord => {
  const record = requireObject(value);
  const media: unknown = Reflect.get(record, 'media');
  return {
    id: readString(record, 'id'),
    type: readString(record, 'type'),
    createdAt: readDate(record, 'createdAt'),
    text: readNullableString(record, 'text'),
    hasMedia: media !== null && media !== undefined,
  };
};

const parseComment = (value: unknown): CommentActivityRecord => {
  const record = requireObject(value);
  return {
    id: readString(record, 'id'),
    text: readString(record, 'text'),
    createdAt: readDate(record, 'createdAt'),
    postId: readString(record, 'postId'),
  };
};

const parseSecurityEvent = (value: unknown): SecurityActivityRecord => {
  const record = requireObject(value);
  return {
    id: readString(record, 'id'),
    eventType: readString(record, 'eventType'),
    timestamp: readDate(record, 'timestamp'),
    ipAddress: readString(record, 'ipAddress'),
  };
};

const parseVerificationSettings = (
  value: unknown,
): VerificationSettingsRecord => {
  const record = requireObject(value);
  return {
    minFollowers: readCount(record, 'minFollowers'),
    minPosts: readCount(record, 'minPosts'),
    requiresProfilePic: readBoolean(record, 'requiresProfilePic'),
    requiresCoverPic: readBoolean(record, 'requiresCoverPic'),
    requiresBio: readBoolean(record, 'requiresBio'),
    autoApprove: readBoolean(record, 'autoApprove'),
  };
};

const parseArray = <T>(
  value: unknown,
  parser: (item: unknown) => T,
): readonly T[] => {
  if (!Array.isArray(value)) invalidResult();
  return value.map(parser);
};

const invoke = async (
  target: object,
  method: string,
  args: readonly unknown[],
): Promise<unknown> => {
  const candidate: unknown = Reflect.get(target, method);
  if (typeof candidate !== 'function') unavailable();
  return Promise.resolve(Reflect.apply(candidate, target, args));
};

const requireDelegate = (
  client: object,
  key: string,
  methods: readonly string[],
): object => {
  const delegate = requireObject(Reflect.get(client, key), unavailable);
  for (const method of methods) {
    if (typeof Reflect.get(delegate, method) !== 'function') unavailable();
  }
  return delegate;
};

const requireObject = (
  value: unknown,
  fail: () => never = invalidResult,
): object => {
  if (typeof value !== 'object' || value === null) fail();
  return value;
};

const readString = (record: object, key: string): string => {
  const value: unknown = Reflect.get(record, key);
  if (typeof value !== 'string') invalidResult();
  return value;
};
const readNullableString = (record: object, key: string): string | null => {
  const value: unknown = Reflect.get(record, key);
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') invalidResult();
  return value;
};
const readBoolean = (record: object, key: string): boolean => {
  const value: unknown = Reflect.get(record, key);
  if (typeof value !== 'boolean') invalidResult();
  return value;
};
const readNullableBoolean = (record: object, key: string): boolean | null => {
  const value: unknown = Reflect.get(record, key);
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean') invalidResult();
  return value;
};
const readDate = (record: object, key: string): Date => {
  const value: unknown = Reflect.get(record, key);
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    invalidResult();
  return value;
};
const readNullableDate = (record: object, key: string): Date | null => {
  const value: unknown = Reflect.get(record, key);
  if (value === null || value === undefined) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    invalidResult();
  return value;
};
const readCount = (record: object, key: string): number => {
  const value: unknown = Reflect.get(record, key);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    invalidResult();
  return value;
};

const readFollowerCount = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  if (!Array.isArray(value)) invalidResult();
  if (!value.every((item) => typeof item === 'string')) invalidResult();
  return value.length;
};

function unavailable(): never {
  throw new DomainError(
    'INTERNAL_ERROR',
    'The profile data service is unavailable.',
  );
}

function invalidResult(): never {
  throw new DomainError(
    'INTERNAL_ERROR',
    'Stored profile data could not be processed.',
  );
}
