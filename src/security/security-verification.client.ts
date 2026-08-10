import type { PrismaTransaction } from '../database/prisma/prisma.service';

export interface VerificationCandidate {
  readonly id: string;
  readonly followers: unknown;
  readonly postsCount: number;
  readonly profilePicture: string | null;
  readonly coverPicture: string | null;
  readonly bio: string | null;
}

export interface VerificationRules {
  readonly minFollowers: number;
  readonly minPosts: number;
  readonly requiresProfilePic: boolean;
  readonly requiresCoverPic: boolean;
  readonly requiresBio: boolean;
}

export interface SecurityVerificationClient {
  findCandidate(id: string): Promise<VerificationCandidate | null>;
  findRules(): Promise<VerificationRules | null>;
  markVerified(id: string): Promise<void>;
}

export const createSecurityVerificationClient = (
  db: PrismaTransaction,
): SecurityVerificationClient => ({
  async findCandidate(id) {
    const row = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        followers: true,
        profilePicture: true,
        coverPicture: true,
        bio: true,
        _count: { select: { posts_posts_userIdTousers: true } },
      },
    });
    if (row === null) return null;
    return Object.freeze({
      id: row.id,
      followers: row.followers,
      postsCount: row._count.posts_posts_userIdTousers,
      profilePicture: row.profilePicture,
      coverPicture: row.coverPicture,
      bio: row.bio,
    });
  },

  async findRules() {
    const row = await db.verificationSettings.findFirst({
      select: {
        minFollowers: true,
        minPosts: true,
        requiresProfilePic: true,
        requiresCoverPic: true,
        requiresBio: true,
      },
    });
    return row === null ? null : Object.freeze({ ...row });
  },

  async markVerified(id) {
    await db.user.update({
      where: { id },
      data: { blueTick: true },
      select: { id: true },
    });
  },
});
