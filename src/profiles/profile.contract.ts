import type { UserModel } from '../../prisma/generated/models/User';
import {
  projectUser,
  type UserProjectionSource,
  type UserSummary,
} from '../users/user.contract';
import { z } from 'zod';
import { DomainError } from '../common/errors/domain.error';
import type { PageQuery } from '../common/pagination/page-query';

export interface UserProfile extends UserSummary {
  readonly email: string;
  readonly emailVerified: boolean;
  readonly subscriptionStatus: string;
  readonly subscriptionExpiry: string | null;
  readonly walletAddress: string | null;
  readonly twoFactorEnabled: boolean;
  readonly updatedAt: string;
  readonly lastLoginAt: string | null;
  readonly postsCount: number;
  readonly bookmarksCount: number;
}

export type UserProfileSource = UserProjectionSource &
  Pick<
    UserModel,
    | 'email'
    | 'emailVerified'
    | 'subscriptionStatus'
    | 'subscriptionExpiry'
    | 'walletAddress'
    | 'twoFactorEnabled'
    | 'updatedAt'
    | 'lastLoginAt'
  > & {
    readonly postsCount: number;
    readonly bookmarksCount: number;
  };

export const projectUserProfile = (user: UserProfileSource): UserProfile => ({
  ...projectUser(user),
  email: user.email,
  emailVerified: user.emailVerified,
  subscriptionStatus: user.subscriptionStatus,
  subscriptionExpiry: user.subscriptionExpiry?.toISOString() ?? null,
  walletAddress: user.walletAddress ?? null,
  twoFactorEnabled: user.twoFactorEnabled ?? false,
  updatedAt: user.updatedAt.toISOString(),
  lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  postsCount: user.postsCount,
  bookmarksCount: user.bookmarksCount,
});

export interface ProfileUpdate {
  readonly username?: string;
  readonly bio?: string | null;
  readonly location?: string | null;
}

const profileUpdateSchema = z
  .object({
    username: z.string().trim().min(1).max(100).optional(),
    bio: z.string().trim().max(1000).nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one profile field is required.',
  });

export const parseProfileUpdate = (input: unknown): ProfileUpdate => {
  if (
    typeof input === 'object' &&
    input !== null &&
    Object.prototype.hasOwnProperty.call(input, 'email')
  ) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'Email must be changed through native Better Auth at /api/auth/change-email.',
      { email: ['Use /api/auth/change-email.'] },
    );
  }
  const result = profileUpdateSchema.safeParse(input);
  if (!result.success) {
    const fields = result.error.issues.map((issue) =>
      issue.path.length > 0 ? issue.path.join('.') : 'profile',
    );
    throw new DomainError(
      'VALIDATION_FAILED',
      `Invalid profile update: ${fields.join(', ')}`,
      { profile: result.error.issues.map((issue) => issue.message) },
    );
  }
  return Object.freeze({
    ...(result.data.username !== undefined
      ? { username: result.data.username }
      : {}),
    ...(result.data.bio !== undefined ? { bio: result.data.bio } : {}),
    ...(result.data.location !== undefined
      ? { location: result.data.location }
      : {}),
  });
};

export type ProfileActivityType =
  'POST_CREATED' | 'COMMENT_CREATED' | 'SECURITY_EVENT';

export interface ProfileActivity {
  readonly type: ProfileActivityType;
  readonly id: string;
  readonly title: string;
  readonly details: string;
  readonly timestamp: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface ProfileActivityPage {
  readonly activities: readonly ProfileActivity[];
  readonly pagination: PageQuery & { readonly hasMore: boolean };
}

export interface EligibilityCriterion {
  readonly met: boolean;
  readonly required: boolean | number;
  readonly current?: number;
}

export interface ProfileEligibility {
  readonly eligible: boolean;
  readonly criteria: Readonly<{
    followers: EligibilityCriterion;
    posts: EligibilityCriterion;
    profilePicture: EligibilityCriterion;
    coverPicture: EligibilityCriterion;
    bio: EligibilityCriterion;
  }>;
}
