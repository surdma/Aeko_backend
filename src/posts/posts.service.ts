import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import { asJsonObject, type JsonValue } from '../common/json/json-value';
import { PrismaService } from '../database/prisma/prisma.service';
import {
  parsePostCreate,
  parsePostPrivacy,
  parsePostUpdate,
  type PostPrivacy,
  type PostView,
} from './post.contract';
import {
  createPostPrismaClient,
  type PostPrismaClient,
  type PostRecord,
  type PostWriteData,
} from './post-prisma.client';
import { projectPost } from './post.projection';

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  private get posts(): PostPrismaClient {
    return createPostPrismaClient(this.prisma.adapterClient);
  }

  async create(
    principal: AuthenticatedPrincipal,
    body: unknown,
    mediaPaths: readonly string[],
  ): Promise<PostView> {
    const input = parsePostCreate(body);
    if (
      (input.type === 'image' || input.type === 'video') &&
      mediaPaths.length === 0
    ) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'A media file is required for an image or video post.',
        { media: ['Attach a file to publish this post.'] },
      );
    }
    const now = new Date();
    // One path is stored as a string and several as an array, matching the
    // shapes existing clients already read.
    const media: JsonValue =
      mediaPaths.length > 1
        ? Object.freeze([...mediaPaths])
        : (mediaPaths[0] ?? '');

    const data: PostWriteData = {
      userId: principal.userId,
      type: input.type,
      text: input.text,
      media,
      privacy: privacyRecord(input.privacy, null, principal.userId, now),
    };
    const created = await this.posts.create(data);
    return projectPost(created, principal.userId);
  }

  async update(
    principal: AuthenticatedPrincipal,
    postId: string,
    body: unknown,
  ): Promise<PostView> {
    const input = parsePostUpdate(body);
    await this.requireOwned(principal, postId);
    const updated = await this.posts.update(postId, { text: input.text });
    return projectPost(updated, principal.userId);
  }

  async setPrivacy(
    principal: AuthenticatedPrincipal,
    postId: string,
    body: unknown,
  ): Promise<PostView> {
    const privacy = parsePostPrivacy(body);
    const record = await this.requireOwned(principal, postId);
    const now = new Date();
    const updated = await this.posts.update(postId, {
      privacy: privacyRecord(
        privacy,
        asJsonObject(record.privacy),
        principal.userId,
        now,
      ),
    });
    return projectPost(updated, principal.userId);
  }

  async remove(
    principal: AuthenticatedPrincipal,
    postId: string,
  ): Promise<{ readonly deleted: true }> {
    await this.requireOwned(principal, postId);
    await this.posts.delete(postId);
    return Object.freeze({ deleted: true as const });
  }

  private async requireOwned(
    principal: AuthenticatedPrincipal,
    postId: string,
  ): Promise<PostRecord> {
    const record = await this.posts.findById(postId);
    if (record === null) {
      throw new DomainError('NOT_FOUND', 'Post not found.');
    }
    if (record.userId !== principal.userId) {
      throw new DomainError(
        'AUTHORIZATION_DENIED',
        'You do not have access to this post.',
      );
    }
    return record;
  }
}

/**
 * The stored privacy column keeps an append-only audit trail of level changes,
 * exactly as Express wrote it.
 */
const privacyRecord = (
  privacy: PostPrivacy,
  current: Readonly<Record<string, JsonValue>> | null,
  actorId: string,
  now: Date,
): JsonValue => {
  const previousLevel =
    current !== null && typeof current.level === 'string'
      ? current.level
      : null;
  const previousHistory = current === null ? null : current.updateHistory;
  const history: readonly JsonValue[] = Array.isArray(previousHistory)
    ? previousHistory
    : [];
  return Object.freeze({
    level: privacy.level,
    selectedUsers: Object.freeze([...privacy.selectedUsers]),
    updatedAt: now.toISOString(),
    updateHistory: Object.freeze([
      ...history,
      Object.freeze({
        previousLevel,
        newLevel: privacy.level,
        updatedAt: now.toISOString(),
        updatedBy: actorId,
      }),
    ]),
  });
};
