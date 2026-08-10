import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import { asJsonObject, type JsonValue } from '../common/json/json-value';
import { PrismaService } from '../database/prisma/prisma.service';
import {
  parsePostCreate,
  parsePostPrivacy,
  parsePostUpdate,
  type PostListQuery,
  type PostPage,
  type PostPrivacy,
  type PostSearchQuery,
  type PostView,
} from './post.contract';
import {
  createPostPrismaClient,
  type PostFilter,
  type PostPrismaClient,
  type PostRecord,
  type PostViewerRecord,
  type PostWriteData,
} from './post-prisma.client';
import { projectPost, withVideoEffect } from './post.projection';
import { canViewPost, readPostVisibility } from './visibility.policy';

/** Legacy served these unpaged reads at a fixed depth of 50. */
const FIXED_READ_LIMIT = 50;

export interface VideoQuery {
  readonly effect?: string | undefined;
}

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

  /**
   * The single visible read. Legacy checked blocking here but never privacy, so
   * any authenticated caller who knew an id could read an `only_me`,
   * `followers`, or `select_users` post.
   */
  async byId(
    principal: AuthenticatedPrincipal,
    postId: string,
  ): Promise<PostView> {
    const record = await this.posts.findById(postId);
    if (record === null) throw notFound();
    const viewer = await this.posts.readViewer(principal.userId);
    if (!(await this.isVisible(record, principal.userId, viewer))) {
      // Absence and denial are reported identically so an id cannot be probed.
      throw notFound();
    }
    const views = await this.posts.incrementViews(postId);
    return projectPost({ ...record, views }, principal.userId);
  }

  async feed(principal: AuthenticatedPrincipal): Promise<readonly PostView[]> {
    return this.visibleList(principal, { kind: 'all' }, FIXED_READ_LIMIT, 0);
  }

  async search(
    principal: AuthenticatedPrincipal,
    query: PostSearchQuery,
  ): Promise<readonly PostView[]> {
    return this.visibleList(
      principal,
      { kind: 'search', q: query.q },
      query.limit,
      (query.page - 1) * query.limit,
    );
  }

  async reposts(
    principal: AuthenticatedPrincipal,
    postId: string,
  ): Promise<readonly PostView[]> {
    return this.visibleList(
      principal,
      { kind: 'reposts', originalPostId: postId },
      FIXED_READ_LIMIT,
      0,
    );
  }

  /**
   * Declared before `:postId` so it is reachable; in Express this route was
   * shadowed and every request resolved to the single-post handler.
   */
  async mixed(principal: AuthenticatedPrincipal): Promise<readonly PostView[]> {
    return this.visibleList(
      principal,
      { kind: 'types', types: ['image', 'video'] },
      FIXED_READ_LIMIT,
      0,
    );
  }

  /** Also shadowed in Express; see {@link mixed}. */
  async videos(
    principal: AuthenticatedPrincipal,
    query: VideoQuery,
  ): Promise<readonly PostView[]> {
    const posts = await this.visibleList(
      principal,
      { kind: 'types', types: ['video'] },
      FIXED_READ_LIMIT,
      0,
    );
    return Object.freeze(
      posts.map((post) => withVideoEffect(post, query.effect)),
    );
  }

  async byUser(
    principal: AuthenticatedPrincipal,
    userId: string,
    query: PostListQuery,
  ): Promise<PostPage> {
    return this.visiblePage(principal, { kind: 'author', userId }, query);
  }

  async liked(
    principal: AuthenticatedPrincipal,
    query: PostListQuery,
  ): Promise<PostPage> {
    return this.visiblePage(
      principal,
      { kind: 'liked', userId: principal.userId },
      query,
    );
  }

  async bookmarks(
    principal: AuthenticatedPrincipal,
    query: PostListQuery,
  ): Promise<PostPage> {
    const skip = (query.page - 1) * query.limit;
    const [records, total] = await Promise.all([
      this.posts.findBookmarked(principal.userId, skip, query.limit),
      this.posts.countBookmarked(principal.userId),
    ]);
    const viewer = await this.posts.readViewer(principal.userId);
    const visible = await this.filterVisible(records, principal.userId, viewer);
    return page(visible, principal.userId, total, query);
  }

  private async visibleList(
    principal: AuthenticatedPrincipal,
    filter: PostFilter,
    take: number,
    skip: number,
  ): Promise<readonly PostView[]> {
    const [records, viewer] = await Promise.all([
      this.posts.findMany({ filter, skip, take }),
      this.posts.readViewer(principal.userId),
    ]);
    const visible = await this.filterVisible(records, principal.userId, viewer);
    return Object.freeze(
      visible.map((record) => projectPost(record, principal.userId)),
    );
  }

  private async visiblePage(
    principal: AuthenticatedPrincipal,
    filter: PostFilter,
    query: PostListQuery,
  ): Promise<PostPage> {
    const skip = (query.page - 1) * query.limit;
    const [records, total, viewer] = await Promise.all([
      this.posts.findMany({ filter, skip, take: query.limit }),
      this.posts.count(filter),
      this.posts.readViewer(principal.userId),
    ]);
    const visible = await this.filterVisible(records, principal.userId, viewer);
    return page(visible, principal.userId, total, query);
  }

  private async filterVisible(
    records: readonly PostRecord[],
    viewerId: string,
    viewer: PostViewerRecord,
  ): Promise<readonly PostRecord[]> {
    const decisions = await Promise.all(
      records.map((record) => this.isVisible(record, viewerId, viewer)),
    );
    return records.filter((_, index) => decisions[index] === true);
  }

  private async isVisible(
    record: PostRecord,
    viewerId: string,
    viewer: PostViewerRecord,
  ): Promise<boolean> {
    if (viewer.notInterestedPostIds.includes(record.id)) return false;
    const isOwner = record.userId === viewerId;
    if (viewer.blockedUserIds.includes(record.userId)) return false;
    if (!isOwner) {
      // Blocking is mutual: a post is hidden in both directions.
      const authorView = await this.posts.readViewer(record.userId);
      if (authorView.blockedUserIds.includes(viewerId)) return false;
    }
    return canViewPost(readPostVisibility(record.privacy), {
      viewerId,
      isOwner,
      isFollower: viewer.following.includes(record.userId),
      isBlocked: false,
    });
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

const page = (
  records: readonly PostRecord[],
  viewerId: string,
  total: number,
  query: PostListQuery,
): PostPage =>
  Object.freeze({
    posts: Object.freeze(
      records.map((record) => projectPost(record, viewerId)),
    ),
    pagination: Object.freeze({
      total,
      page: query.page,
      pages: Math.ceil(total / query.limit),
      limit: query.limit,
    }),
  });

function notFound(): DomainError {
  return new DomainError('NOT_FOUND', 'Post not found.');
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
