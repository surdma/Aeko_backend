import { Injectable, Optional } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import type { PageQuery } from '../common/pagination/page-query';
import type { RequestAuditContext } from '../common/http/request-audit/request-audit.decorator';
import type { UserPage } from '../users/user.contract';
import type { UserSearch } from '../users/user.contract';
import {
  SecurityService,
  type FollowState,
} from '../security/security.service';
import { PrismaService } from '../database/prisma/prisma.service';
import {
  projectUserProfile,
  parseProfileUpdate,
  type ProfileActivity,
  type ProfileActivityPage,
  type ProfileEligibility,
  type ProfileUpdate,
  type UserProfile,
} from './profile.contract';
import {
  createProfilePrismaClient,
  type ProfilePrismaClient,
  type ProfileRecord,
  type VerificationSettingsRecord,
} from './profile-prisma.client';

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly social?: SecurityService,
  ) {}

  private get profiles(): ProfilePrismaClient {
    return createProfilePrismaClient(this.prisma.adapterClient);
  }

  followers(userId: string, query: PageQuery): Promise<UserPage> {
    return this.requireSocial().graph(userId, 'followers', query);
  }

  following(userId: string, query: PageQuery): Promise<UserPage> {
    return this.requireSocial().graph(userId, 'following', query);
  }

  searchFollowers(
    userId: string,
    query: PageQuery & UserSearch,
  ): Promise<UserPage> {
    return this.requireSocial().graph(userId, 'followers', query, query.search);
  }

  follow(userId: string, targetId: string): Promise<FollowState> {
    return this.requireSocial().follow(userId, targetId);
  }

  unfollow(
    userId: string,
    targetId: string,
  ): Promise<{ readonly state: 'not-following' }> {
    return this.requireSocial().unfollow(userId, targetId);
  }

  verifyUser(
    principal: AuthenticatedPrincipal,
    targetId: string,
    audit?: RequestAuditContext,
  ): Promise<{ readonly verified: true }> {
    return this.requireSocial().verifyUser(principal, targetId, audit);
  }

  async getProfile(userId: string): Promise<UserProfile> {
    return this.project(await this.requireProfile(userId));
  }

  async updateProfile(userId: string, input: unknown): Promise<UserProfile> {
    const update: ProfileUpdate = parseProfileUpdate(input);
    try {
      return this.project(await this.profiles.updateProfile(userId, update));
    } catch (error: unknown) {
      const code = readProviderCode(error);
      if (code === 'P2002') {
        throw new DomainError('CONFLICT', 'That username is already in use.', {
          username: ['Choose a different username.'],
        });
      }
      if (code === 'P2025') {
        throw new DomainError('NOT_FOUND', 'User not found.');
      }
      throw error;
    }
  }

  async getActivity(
    userId: string,
    query: PageQuery,
  ): Promise<ProfileActivityPage> {
    const [posts, comments, securityEvents] = await Promise.all([
      this.profiles.findPosts(userId, query.limit),
      this.profiles.findComments(userId, query.limit),
      this.profiles.findSecurityEvents(userId, query.limit),
    ]);
    const activities: ProfileActivity[] = [
      ...posts.map((post): ProfileActivity => ({
        type: 'POST_CREATED',
        id: post.id,
        title: 'Created a post',
        details: post.text ?? (post.hasMedia ? 'Media post' : 'Post'),
        timestamp: post.createdAt.toISOString(),
        metadata: Object.freeze({ postType: post.type }),
      })),
      ...comments.map((comment): ProfileActivity => ({
        type: 'COMMENT_CREATED',
        id: comment.id,
        title: 'Commented on a post',
        details: comment.text,
        timestamp: comment.createdAt.toISOString(),
        metadata: Object.freeze({ postId: comment.postId }),
      })),
      ...securityEvents.map((event): ProfileActivity => ({
        type: 'SECURITY_EVENT',
        id: event.id,
        title: event.eventType,
        details: `IP: ${event.ipAddress}`,
        timestamp: event.timestamp.toISOString(),
        metadata: Object.freeze({}),
      })),
    ].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    const skip = (query.page - 1) * query.limit;
    return Object.freeze({
      activities: Object.freeze(activities.slice(skip, skip + query.limit)),
      pagination: Object.freeze({
        ...query,
        hasMore: activities.length > skip + query.limit,
      }),
    });
  }

  async getEligibility(userId: string): Promise<ProfileEligibility> {
    const [storedSettings, user] = await Promise.all([
      this.profiles.findVerificationSettings(),
      this.requireProfile(userId),
    ]);
    const settings = storedSettings ?? defaultVerificationSettings;
    const followerCount = user.followersCount;
    const criteria = Object.freeze({
      followers: Object.freeze({
        met: followerCount >= settings.minFollowers,
        current: followerCount,
        required: settings.minFollowers,
      }),
      posts: Object.freeze({
        met: user.postsCount >= settings.minPosts,
        current: user.postsCount,
        required: settings.minPosts,
      }),
      profilePicture: Object.freeze({
        met: !settings.requiresProfilePic || Boolean(user.profilePicture),
        required: settings.requiresProfilePic,
      }),
      coverPicture: Object.freeze({
        met: !settings.requiresCoverPic || Boolean(user.coverPicture),
        required: settings.requiresCoverPic,
      }),
      bio: Object.freeze({
        met: !settings.requiresBio || Boolean(user.bio),
        required: settings.requiresBio,
      }),
    });
    return Object.freeze({
      eligible: Object.values(criteria).every((criterion) => criterion.met),
      criteria,
    });
  }

  private async requireProfile(userId: string): Promise<ProfileRecord> {
    const user = await this.profiles.findProfile(userId);
    if (!user) throw new DomainError('NOT_FOUND', 'User not found.');
    return user;
  }

  private project(user: ProfileRecord): UserProfile {
    return projectUserProfile(user);
  }

  private requireSocial(): SecurityService {
    if (!this.social) {
      throw new DomainError(
        'INTERNAL_ERROR',
        'The social data service is unavailable.',
      );
    }
    return this.social;
  }
}

const defaultVerificationSettings: VerificationSettingsRecord = Object.freeze({
  minFollowers: 1000,
  minPosts: 10,
  requiresProfilePic: true,
  requiresCoverPic: true,
  requiresBio: true,
  autoApprove: true,
});

const readProviderCode = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null) return null;
  const code: unknown = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : null;
};
