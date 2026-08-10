import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import { asJsonObject, type JsonValue } from '../common/json/json-value';
import {
  parseCommentCreate,
  type CommentListQuery,
  type CommentView,
} from './comment.contract';
import { PrismaService } from '../database/prisma/prisma.service';
import {
  createCommentPrismaClient,
  type CommentPrismaClient,
  type CommentRecord,
} from './comment-prisma.client';
import {
  createPostPrismaClient,
  type PostPrismaClient,
  type PostRecord,
} from '../posts/post-prisma.client';
import { canViewPost, readPostVisibility } from '../posts/visibility.policy';

export interface CommentCreateResult {
  readonly comment: CommentView;
  readonly postCounts: Readonly<{
    totalComments: number;
    totalLikes: number;
    totalShares: number;
    engagementRate: number;
  }>;
}

@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

  private get comments(): CommentPrismaClient {
    return createCommentPrismaClient(this.prisma.db);
  }

  private get posts(): PostPrismaClient {
    return createPostPrismaClient(this.prisma.db);
  }

  async create(
    principal: AuthenticatedPrincipal,
    postId: string,
    body: unknown,
  ): Promise<CommentCreateResult> {
    const input = parseCommentCreate(body);
    const post = await this.requireVisiblePost(principal, postId);
    const comment = await this.comments.create({
      text: input.text,
      userId: principal.userId,
      postId,
    });

    // Legacy loaded every comment row to size this counter; a count query
    // gives the same number without reading the whole thread.
    const totalComments = await this.comments.countForPost(postId);
    const engagement = asJsonObject(post.engagement);
    const totalLikes = countOf(post.likes);
    const totalShares = numberOf(engagement.totalShares);
    await this.posts.update(postId, {
      engagement: Object.freeze({
        ...engagement,
        totalComments,
        totalLikes,
        totalShares,
      }),
    });

    return Object.freeze({
      comment: projectComment(comment, principal.userId),
      postCounts: Object.freeze({
        totalComments,
        totalLikes,
        totalShares,
        engagementRate: numberOf(engagement.engagementRate),
      }),
    });
  }

  async reply(
    principal: AuthenticatedPrincipal,
    commentId: string,
    body: unknown,
  ): Promise<CommentView> {
    const input = parseCommentCreate(body);
    const parent = await this.comments.findById(commentId);
    if (parent === null) throw notFound();
    // A reply is a comment on the parent's post, so the same visibility gate
    // applies; Express checked neither the post nor its privacy here.
    await this.requireVisiblePost(principal, parent.postId);
    const reply = await this.comments.create({
      text: input.text,
      userId: principal.userId,
      postId: parent.postId,
      parentId: parent.id,
    });
    return projectComment(reply, principal.userId);
  }

  /**
   * Legacy only ever adds a like here; there is no unlike route, and a repeat
   * call returns the unchanged comment with `isLiked: true`. That behavior is
   * preserved.
   */
  async like(
    principal: AuthenticatedPrincipal,
    commentId: string,
  ): Promise<CommentView> {
    const existing = await this.comments.findById(commentId);
    if (existing === null) throw notFound();
    await this.requireVisiblePost(principal, existing.postId);

    return this.comments.runSerializable(async (transaction) => {
      const comment = await transaction.findById(commentId);
      if (comment === null) throw notFound();
      const likes = likeIds(comment.likes);
      if (likes.includes(principal.userId)) {
        return projectComment(comment, principal.userId);
      }
      const next = [...likes, principal.userId];
      const updated = await transaction.setLikes(commentId, next);
      await transaction.setCommentLike(principal.userId, commentId);
      return projectComment(updated, principal.userId);
    });
  }

  async listForPost(
    principal: AuthenticatedPrincipal,
    postId: string,
    query: CommentListQuery,
  ): Promise<readonly CommentView[]> {
    await this.requireVisiblePost(principal, postId);
    const blocked = await this.blockedAuthors(principal);
    const records = await this.comments.findTopLevel(
      postId,
      (query.page - 1) * query.limit,
      query.limit,
    );
    return Object.freeze(
      records
        .filter((record) => !blocked.has(record.userId))
        .map((record) => projectComment(record, principal.userId, blocked)),
    );
  }

  async listReplies(
    principal: AuthenticatedPrincipal,
    commentId: string,
    query: CommentListQuery,
  ): Promise<readonly CommentView[]> {
    const parent = await this.comments.findById(commentId);
    if (parent === null) throw notFound();
    await this.requireVisiblePost(principal, parent.postId);
    const blocked = await this.blockedAuthors(principal);
    const records = await this.comments.findReplies(
      commentId,
      (query.page - 1) * query.limit,
      query.limit,
    );
    return Object.freeze(
      records
        .filter((record) => !blocked.has(record.userId))
        .map((record) => projectComment(record, principal.userId, blocked)),
    );
  }

  /**
   * Express guarded comments with a blocking middleware but never checked that
   * the parent post was visible, so a private post's thread was readable and
   * writable by anyone holding the post id.
   */
  private async requireVisiblePost(
    principal: AuthenticatedPrincipal,
    postId: string,
  ): Promise<PostRecord> {
    const post = await this.posts.findById(postId);
    if (post === null) throw notFound();
    const viewer = await this.posts.readViewer(principal.userId);
    if (viewer.blockedUserIds.includes(post.userId)) throw notFound();
    const isOwner = post.userId === principal.userId;
    if (!isOwner) {
      const authorView = await this.posts.readViewer(post.userId);
      if (authorView.blockedUserIds.includes(principal.userId))
        throw notFound();
    }
    const visible = canViewPost(readPostVisibility(post.privacy), {
      viewerId: principal.userId,
      isOwner,
      isFollower: viewer.following.includes(post.userId),
      isBlocked: false,
    });
    if (!visible) throw notFound();
    return post;
  }

  private async blockedAuthors(
    principal: AuthenticatedPrincipal,
  ): Promise<ReadonlySet<string>> {
    const viewer = await this.posts.readViewer(principal.userId);
    return new Set(viewer.blockedUserIds);
  }
}

const projectComment = (
  record: CommentRecord,
  viewerId: string,
  blocked: ReadonlySet<string> = new Set(),
): CommentView => {
  const likes = likeIds(record.likes);
  return Object.freeze({
    id: record.id,
    text: record.text,
    postId: record.postId,
    userId: record.userId,
    user: record.author,
    parentId: record.parentId,
    likes: record.likes,
    likesCount: likes.length,
    isLiked: likes.includes(viewerId),
    repliesCount: record.replies.length,
    replies: Object.freeze(
      record.replies
        .filter((reply) => !blocked.has(reply.userId))
        .map((reply) => projectComment(reply, viewerId, blocked)),
    ),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
};

const likeIds = (likes: JsonValue): readonly string[] =>
  Array.isArray(likes)
    ? likes.filter((entry): entry is string => typeof entry === 'string')
    : [];

const countOf = (value: JsonValue): number => likeIds(value).length;

const numberOf = (value: JsonValue | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

function notFound(): DomainError {
  return new DomainError('NOT_FOUND', 'Post not found.');
}
