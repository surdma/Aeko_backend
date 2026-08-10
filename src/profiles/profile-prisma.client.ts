import type { Prisma } from '../generated/prisma/client';
import { DomainError } from '../common/errors/domain.error';
import type { PrismaTransaction } from '../database/prisma/prisma.service';
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
  readonly age: number | null;
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
  age: true,
  followers: true,
  _count: { select: { posts_posts_userIdTousers: true, bookmarks: true } },
} satisfies Prisma.UserSelect;

type ProfileRow = Prisma.UserGetPayload<{ select: typeof profileSelection }>;

const toProfile = (row: ProfileRow): ProfileRecord => ({
  id: row.id,
  username: row.username,
  name: row.name,
  email: row.email,
  emailVerified: row.emailVerified,
  image: row.image,
  avatar: row.avatar,
  profilePicture: row.profilePicture,
  coverPicture: row.coverPicture,
  bio: row.bio,
  location: row.location,
  blueTick: row.blueTick,
  goldenTick: row.goldenTick,
  subscriptionStatus: row.subscriptionStatus,
  subscriptionExpiry: row.subscriptionExpiry,
  walletAddress: row.walletAddress,
  twoFactorEnabled: row.twoFactorEnabled,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  lastLoginAt: row.lastLoginAt,
  age: row.age,
  followersCount: readFollowerCount(row.followers),
  postsCount: row._count.posts_posts_userIdTousers,
  bookmarksCount: row._count.bookmarks,
});

/**
 * `User.followers` is an untyped JSON column, so its contents still need a
 * runtime check — Prisma can only promise `JsonValue` here. Normalizing this
 * column into a `Follow` table removes the check entirely.
 */
const readFollowerCount = (value: Prisma.JsonValue): number => {
  if (value === null || value === undefined) return 0;
  if (!Array.isArray(value)) invalidResult();
  if (!value.every((item) => typeof item === 'string')) invalidResult();
  return value.length;
};

export const createProfilePrismaClient = (
  db: PrismaTransaction,
): ProfilePrismaClient => ({
  async findProfile(id) {
    const row = await db.user.findUnique({
      where: { id },
      select: profileSelection,
    });
    return row === null ? null : toProfile(row);
  },

  async updateProfile(id, update) {
    return toProfile(
      await db.user.update({
        where: { id },
        data: { ...update },
        select: profileSelection,
      }),
    );
  },

  async findPosts(id, take) {
    const rows = await db.post.findMany({
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
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      createdAt: row.createdAt,
      text: row.text,
      hasMedia: row.media !== null,
    }));
  },

  async findComments(id, take) {
    return db.comment.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, text: true, createdAt: true, postId: true },
    });
  },

  async findSecurityEvents(id, take) {
    return db.securityEvent.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, eventType: true, timestamp: true, ipAddress: true },
    });
  },

  async findVerificationSettings() {
    return db.verificationSettings.findFirst({
      select: {
        minFollowers: true,
        minPosts: true,
        requiresProfilePic: true,
        requiresCoverPic: true,
        requiresBio: true,
        autoApprove: true,
      },
    });
  },
});

function invalidResult(): never {
  throw new DomainError(
    'INTERNAL_ERROR',
    'Stored profile data could not be processed.',
  );
}
