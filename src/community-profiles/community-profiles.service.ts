import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import { isJsonObject, type JsonValue } from '../common/json/json-value';
import {
  createCommunityPrismaClient,
  type CommunityPrismaClient,
  type CommunityRecord,
} from '../communities/community-prisma.client';
import { PrismaService } from '../database/prisma/prisma.service';
import { MediaPort, type ImageMimeType } from '../providers/media/media.port';
import {
  parseCommunityPhotoQuery,
  parseCommunityPostCreate,
  parseCommunityPostQuery,
  parseCommunityProfileUpdate,
  parseCommunitySettingsUpdate,
  type CommunityPostPage,
  type CommunityPostView,
} from './community-profile.contract';
import {
  createCommunityFollowerPrismaClient,
  type CommunityFollowerPrismaClient,
} from './community-follower-prisma.client';
import {
  createCommunityPostPrismaClient,
  type CommunityPostPrismaClient,
  type CommunityPostRecord,
} from './community-post-prisma.client';

const VIDEO_PATTERN = /\.(mp4|mov)$/u;

const IMAGE_MIME_TYPES: readonly ImageMimeType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

const imageMimeType = (value: string): ImageMimeType | null =>
  IMAGE_MIME_TYPES.find((allowed) => allowed === value) ?? null;

@Injectable()
export class CommunityProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaPort,
  ) {}

  private get communities(): CommunityPrismaClient {
    return createCommunityPrismaClient(this.prisma.db);
  }

  private get followers(): CommunityFollowerPrismaClient {
    return createCommunityFollowerPrismaClient(this.prisma.db);
  }

  private get posts(): CommunityPostPrismaClient {
    return createCommunityPostPrismaClient(this.prisma.db);
  }

  /**
   * Owner or moderator.
   *
   * Legacy loaded the caller's membership through `include: { memberships }`,
   * a relation that exists on neither schema, so Prisma rejected the query and
   * both this route and the photo upload answered 500 on every call. The real
   * relation is `community_members`, reached here through the shared boundary.
   */
  async updateProfile(
    principal: AuthenticatedPrincipal,
    communityId: string,
    body: unknown,
  ): Promise<{ readonly success: true; readonly data: JsonValue }> {
    const input = parseCommunityProfileUpdate(body);
    const record = await this.requireManager(principal, communityId);

    if (input.name !== undefined || input.description !== undefined) {
      await this.posts.updateColumns(communityId, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
      });
    }

    if (input.website === undefined && input.location === undefined) {
      const current = await this.communities.findById(communityId);
      return Object.freeze({
        success: true as const,
        data: current === null ? record.profile : current.profile,
      });
    }

    const profile = {
      ...(isJsonObject(record.profile) ? record.profile : {}),
      ...(input.website === undefined ? {} : { website: input.website }),
      ...(input.location === undefined ? {} : { location: input.location }),
    };
    await this.posts.updateProfile(communityId, profile);
    return Object.freeze({ success: true as const, data: profile });
  }

  async uploadPhoto(
    principal: AuthenticatedPrincipal,
    communityId: string,
    query: unknown,
    file: unknown,
  ): Promise<{
    readonly success: true;
    readonly data: JsonValue;
    readonly message: string;
  }> {
    const { type } = parseCommunityPhotoQuery(query);
    const record = await this.requireManager(principal, communityId);

    const upload = readUpload(file);
    if (upload === null) {
      throw new DomainError('VALIDATION_FAILED', 'Please upload a file');
    }

    const mimeType = imageMimeType(upload.mimetype);
    if (mimeType === null) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'Only JPEG, PNG and WebP images are accepted.',
      );
    }

    const stored = await this.media.uploadProfileImage({
      ownerId: communityId,
      // The shared port already models exactly these two slots.
      purpose: type === 'cover' ? 'cover' : 'profile',
      bytes: upload.buffer,
      mimeType,
    });

    const profile = {
      ...(isJsonObject(record.profile) ? record.profile : {}),
      [type === 'cover' ? 'coverPhoto' : 'avatar']: stored.url,
    };
    await this.posts.updateProfile(communityId, profile);

    return Object.freeze({
      success: true as const,
      data: profile,
      message: `Community ${type} updated successfully`,
    });
  }

  /** Owner only, which is stricter than the profile route and was already so. */
  async updateSettings(
    principal: AuthenticatedPrincipal,
    communityId: string,
    body: unknown,
  ): Promise<{ readonly success: true; readonly data: JsonValue }> {
    const input = parseCommunitySettingsUpdate(body);
    const record = await this.communities.findById(communityId);
    if (record === null) throw notFound();
    if (record.ownerId !== principal.userId) {
      throw new DomainError(
        'AUTHORIZATION_DENIED',
        'Only the community owner can update settings',
      );
    }

    const settings = {
      ...(isJsonObject(record.settings) ? record.settings : {}),
      ...input.settings,
    };
    await this.posts.updateSettings(communityId, settings);
    return Object.freeze({ success: true as const, data: settings });
  }

  async follow(
    principal: AuthenticatedPrincipal,
    communityId: string,
  ): Promise<{ readonly success: true; readonly message: string }> {
    const record = await this.communities.findById(communityId);
    if (record === null) throw notFound();

    const membership = await this.communities.findMembership(
      communityId,
      principal.userId,
    );
    if (membership !== null) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'You are already a member of this community.',
      );
    }

    return this.followers.runSerializable(async (transaction) => {
      const followed = await transaction.follow(communityId, principal.userId);
      if (!followed) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'You are already following this community',
        );
      }
      return Object.freeze({
        success: true as const,
        message: 'Successfully followed the community',
      });
    });
  }

  /** Idempotent, as legacy was: unfollowing what you do not follow succeeds. */
  async unfollow(
    principal: AuthenticatedPrincipal,
    communityId: string,
  ): Promise<{ readonly success: true; readonly message: string }> {
    return this.followers.runSerializable(async (transaction) => {
      await transaction.unfollow(communityId, principal.userId);
      return Object.freeze({
        success: true as const,
        message: 'Successfully unfollowed the community',
      });
    });
  }

  async createPost(
    principal: AuthenticatedPrincipal,
    communityId: string,
    body: unknown,
  ): Promise<{
    readonly success: true;
    readonly data: CommunityPostView;
    readonly message: string;
  }> {
    const input = parseCommunityPostCreate(body);
    const record = await this.communities.findById(communityId);
    if (record === null) throw notFound();

    const [membership, isFollowing] = await Promise.all([
      this.communities.findMembership(communityId, principal.userId),
      this.followers.isFollowing(communityId, principal.userId),
    ]);

    const settings = isJsonObject(record.settings) ? record.settings : {};
    const postSettings = isJsonObject(settings.postSettings)
      ? settings.postSettings
      : {};

    const membersOnly = postSettings.requireMembershipToPost === true;
    if (membership === null && (!isFollowing || membersOnly)) {
      throw new DomainError(
        'AUTHORIZATION_DENIED',
        'You need to be a member to post in this community',
      );
    }
    if (settings.canPost === false) {
      throw new DomainError(
        'AUTHORIZATION_DENIED',
        'This community has disabled posting',
      );
    }

    const status = postSettings.requireApproval === true ? 'pending' : 'active';
    const post = await this.posts.create({
      text: input.content,
      userId: principal.userId,
      communityId,
      media: input.media,
      type: mediaType(input.media),
      status,
    });

    return Object.freeze({
      success: true as const,
      data: projectPost(post),
      message:
        status === 'pending'
          ? 'Post submitted for approval'
          : 'Post created successfully',
    });
  }

  async listPosts(
    principal: AuthenticatedPrincipal,
    communityId: string,
    query: unknown,
  ): Promise<CommunityPostPage> {
    const { page, limit } = parseCommunityPostQuery(query);
    const record = await this.communities.findById(communityId);
    if (record === null) throw notFound();

    if (record.isPrivate) {
      const [membership, isFollowing] = await Promise.all([
        this.communities.findMembership(communityId, principal.userId),
        this.followers.isFollowing(communityId, principal.userId),
      ]);
      if (membership === null && !isFollowing) {
        throw new DomainError(
          'AUTHORIZATION_DENIED',
          'This is a private community.',
        );
      }
    }

    const seesAllPending =
      record.ownerId === principal.userId ||
      (await this.posts.isModerator(communityId, principal.userId));

    const visibility = {
      communityId,
      viewerId: principal.userId,
      seesAllPending,
    };
    const skip = (page - 1) * limit;
    const [posts, total] = await Promise.all([
      this.posts.findMany(visibility, skip, limit),
      this.posts.count(visibility),
    ]);

    return Object.freeze({
      posts: Object.freeze(posts.map(projectPost)),
      pagination: Object.freeze({
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      }),
    });
  }

  private async requireManager(
    principal: AuthenticatedPrincipal,
    communityId: string,
  ): Promise<CommunityRecord> {
    const record = await this.communities.findById(communityId);
    if (record === null) throw notFound();

    const membership = await this.communities.findMembership(
      communityId,
      principal.userId,
    );
    const authorized =
      record.ownerId === principal.userId ||
      membership?.role === 'owner' ||
      membership?.role === 'moderator';
    if (!authorized) {
      throw new DomainError(
        'AUTHORIZATION_DENIED',
        'Not authorized to update this community profile',
      );
    }
    return record;
  }
}

interface UploadedFile {
  readonly buffer: Buffer;
  readonly mimetype: string;
}

/** Multer hands the handler an untyped object; only two fields are read. */
function readUpload(file: unknown): UploadedFile | null {
  if (typeof file !== 'object' || file === null) return null;
  const buffer: unknown = Reflect.get(file, 'buffer');
  const mimetype: unknown = Reflect.get(file, 'mimetype');
  if (!Buffer.isBuffer(buffer) || typeof mimetype !== 'string') return null;
  return Object.freeze({ buffer, mimetype });
}

/** Legacy inferred the type from the first media entry's extension. */
const mediaType = (media: readonly string[]): string => {
  const first = media[0];
  if (first === undefined) return 'text';
  return VIDEO_PATTERN.test(first) ? 'video' : 'image';
};

const projectPost = (record: CommunityPostRecord): CommunityPostView =>
  Object.freeze({
    id: record.id,
    text: record.text,
    userId: record.userId,
    communityId: record.communityId,
    media: record.media,
    type: record.type,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    user: record.user,
    community: record.community,
  });

function notFound(): DomainError {
  return new DomainError('NOT_FOUND', 'Community not found');
}
