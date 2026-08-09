import type { UserModel } from '../../prisma/generated/models/User';
import {
  projectUser,
  type UserProjectionSource,
  type UserSummary,
} from '../users/user.contract';

export interface UserProfile extends UserSummary {
  readonly email: string;
  readonly emailVerified: boolean;
  readonly subscriptionStatus: string;
  readonly subscriptionExpiry: string | null;
  readonly walletAddress: string | null;
  readonly twoFactorEnabled: boolean;
  readonly updatedAt: string;
  readonly lastLoginAt: string | null;
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
  >;

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
});
