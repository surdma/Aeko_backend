import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import { asJsonObject, type JsonValue } from '../common/json/json-value';
import { PrismaService } from '../database/prisma/prisma.service';
import {
  parsePostCreate,
  parsePostPrivacy,
  parsePostUpdate,
  parsePromotion,
  parseShareToStatus,
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
  type PostTransactionClient,
  type PostViewerRecord,
  type PostWriteData,
} from './post-prisma.client';
import { projectPost, withVideoEffect } from './post.projection';
import { canViewPost, readPostVisibility } from './visibility.policy';

/** Legacy served these unpaged reads at a fixed depth of 50. */
const FIXED_READ_LIMIT = 50;

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export interface LikeResult {
  readonly message: string;
  readonly liked: boolean;
  readonly totalLikes: number;
  readonly post: PostView;
}

export interface BookmarkResult {
  readonly message: string;
  readonly bookmarked: boolean;
  readonly totalBookmarks: number;
}

export interface SharedStatusView {
  readonly id: string;
  readonly userId: string;
  readonly content: string;
  readonly sharedPostId: string | null;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface VideoQuery {
  readonly effect?: string | undefined;
}

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  private get posts(): PostPrismaClient {
    return createPostPrismaClient(this.prisma.db);
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

  like(principal: AuthenticatedPrincipal, postId: string): Promise<LikeResult> {
    return this.interact(principal, postId, async (transaction, record) => {
      const likes = likeIds(record.likes);
      const isLiked = likes.includes(principal.userId);
      const next = isLiked
        ? likes.filter((id) => id !== principal.userId)
        : [...likes, principal.userId];
      const updated = await transaction.update(postId, {
        likes: Object.freeze(next),
        engagement: Object.freeze({
          ...asJsonObject(record.engagement),
          totalLikes: next.length,
        }),
      });
      await transaction.setPostLike(principal.userId, postId, !isLiked);
      return Object.freeze({
        message: isLiked
          ? 'Post unliked successfully'
          : 'Post liked successfully',
        liked: !isLiked,
        totalLikes: next.length,
        post: projectPost(updated, principal.userId),
      });
    });
  }

  bookmark(
    principal: AuthenticatedPrincipal,
    postId: string,
  ): Promise<BookmarkResult> {
    return this.interact(principal, postId, async (transaction, record) => {
      const existing = await transaction.findBookmark(principal.userId, postId);
      if (existing === null) {
        await transaction.createBookmark(principal.userId, postId);
      } else {
        await transaction.deleteBookmark(existing);
      }
      const totalBookmarks = await transaction.countBookmarks(postId);
      await transaction.update(postId, {
        engagement: Object.freeze({
          ...asJsonObject(record.engagement),
          totalBookmarks,
        }),
      });
      return Object.freeze({
        message:
          existing === null
            ? 'Post bookmarked successfully'
            : 'Bookmark removed successfully',
        bookmarked: existing === null,
        totalBookmarks,
      });
    });
  }

  view(
    principal: AuthenticatedPrincipal,
    postId: string,
  ): Promise<{ readonly success: true; readonly views: number }> {
    return this.interact(principal, postId, async (transaction) => {
      const updated = await transaction.update(postId, {
        views: { increment: 1 },
      });
      return Object.freeze({ success: true as const, views: updated.views });
    });
  }

  async notInterested(
    principal: AuthenticatedPrincipal,
    postId: string,
  ): Promise<{ readonly success: true; readonly message: string }> {
    const current = await this.posts.readNotInterested(principal.userId);
    if (!current.includes(postId)) {
      await this.posts.writeNotInterested(principal.userId, [
        ...current,
        postId,
      ]);
    }
    return Object.freeze({
      success: true as const,
      message: 'Post marked as not interested',
    });
  }

  async repost(
    principal: AuthenticatedPrincipal,
    postId: string,
  ): Promise<PostView> {
    const record = await this.requireVisible(principal, postId);
    const created = await this.posts.create({
      userId: principal.userId,
      originalPostId: record.id,
      type: record.type,
      text: record.text ?? '',
      media: record.media,
    });
    return projectPost(created, principal.userId);
  }

  /**
   * Legacy shared any post to a status with an explicit "allow sharing"
   * comment and no access check, copying a private post's content into a
   * status document. Visibility is now required.
   */
  async shareToStatus(
    principal: AuthenticatedPrincipal,
    postId: string,
    body: unknown,
  ): Promise<SharedStatusView> {
    const share = parseShareToStatus(body);
    const record = await this.requireVisible(principal, postId);
    const now = new Date();
    const status = await this.posts.createSharedStatus({
      userId: principal.userId,
      type: 'shared_post',
      content: share.additionalContent,
      sharedPostId: record.id,
      expiresAt: new Date(now.getTime() + DAY_IN_MILLISECONDS),
      originalContent: Object.freeze({
        creator: record.author === null ? null : { ...record.author },
        post: Object.freeze({
          id: record.id,
          text: record.text,
          type: record.type,
          media: record.media,
        }),
      }),
    });
    return Object.freeze({
      id: status.id,
      userId: status.userId,
      content: status.content,
      sharedPostId: status.sharedPostId,
      expiresAt: status.expiresAt.toISOString(),
      createdAt: status.createdAt.toISOString(),
    });
  }

  async promote(
    principal: AuthenticatedPrincipal,
    postId: string,
    body: unknown,
  ): Promise<PostView> {
    const promotion = parsePromotion(body);
    const record = await this.requireOwned(principal, postId);
    const current = asJsonObject(record.ad);
    const updated = await this.posts.update(postId, {
      ad: Object.freeze({
        ...current,
        isPromoted: true,
        ...(promotion.budget === null ? {} : { budget: promotion.budget }),
        ...(promotion.target === null ? {} : { target: promotion.target }),
        ...(promotion.startDate === null
          ? {}
          : { startDate: promotion.startDate }),
        ...(promotion.endDate === null ? {} : { endDate: promotion.endDate }),
      }),
    });
    return projectPost(updated, principal.userId);
  }

  /**
   * Every write interaction resolves visibility first, then runs inside one
   * serializable transaction that re-reads the row it is about to change.
   */
  private async interact<T>(
    principal: AuthenticatedPrincipal,
    postId: string,
    operation: (
      transaction: PostTransactionClient,
      record: PostRecord,
    ) => Promise<T>,
  ): Promise<T> {
    await this.requireVisible(principal, postId);
    return this.posts.runSerializable(async (transaction) => {
      const record = await transaction.findById(postId);
      if (record === null) throw notFound();
      return operation(transaction, record);
    });
  }

  private async requireVisible(
    principal: AuthenticatedPrincipal,
    postId: string,
  ): Promise<PostRecord> {
    const record = await this.posts.findById(postId);
    if (record === null) throw notFound();
    const viewer = await this.posts.readViewer(principal.userId);
    if (!(await this.isVisible(record, principal.userId, viewer))) {
      throw notFound();
    }
    return record;
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

const likeIds = (likes: JsonValue): readonly string[] =>
  Array.isArray(likes)
    ? likes.filter((entry): entry is string => typeof entry === 'string')
    : [];

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
