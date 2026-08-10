import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import { asJsonObject, type JsonValue } from '../common/json/json-value';
import { PrismaService } from '../database/prisma/prisma.service';
import {
  createPostPrismaClient,
  type PostPrismaClient,
} from '../posts/post-prisma.client';
import {
  parseStatusCreate,
  parseStatusReaction,
  parseStatusReshare,
  SHARED_STATUS_TYPE,
  STATUS_TYPES,
  type SharedPostData,
  type StatusDisplayContent,
  type StatusListQuery,
  type StatusViewType,
  type StatusView,
} from './status.contract';
import {
  createStatusPrismaClient,
  type StatusPrismaClient,
  type StatusRecord,
} from './status-prisma.client';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

@Injectable()
export class StatusService {
  constructor(private readonly prisma: PrismaService) {}

  private get statuses(): StatusPrismaClient {
    return createStatusPrismaClient(this.prisma.db);
  }

  private get posts(): PostPrismaClient {
    return createPostPrismaClient(this.prisma.db);
  }

  async create(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<StatusView> {
    const input = parseStatusCreate(body);
    const now = new Date();
    const record = await this.statuses.create({
      userId: principal.userId,
      type: input.type,
      content: input.content,
      caption: input.caption,
      backgroundColor: input.backgroundColor,
      font: input.font,
      expiresAt: new Date(now.getTime() + DAY_IN_MILLISECONDS),
      reactions: Object.freeze([]),
      originalContent: Object.freeze({}),
      shareMetadata: Object.freeze({}),
    });
    return projectStatus(record);
  }

  /**
   * Legacy returned every unexpired status in the system with no limit, then
   * filtered blocking one row at a time. The query is bounded here and the
   * blocked set is read once.
   */
  async list(
    principal: AuthenticatedPrincipal,
    query: StatusListQuery,
  ): Promise<readonly StatusView[]> {
    const now = new Date();
    const records = await this.statuses.findActive(
      now,
      (query.page - 1) * query.limit,
      query.limit,
    );
    const visible = await this.filterBlocked(principal, records);
    return Object.freeze(visible.map(projectStatus));
  }

  async remove(
    principal: AuthenticatedPrincipal,
    id: string,
  ): Promise<{ readonly success: true; readonly message: string }> {
    const deleted = await this.statuses.deleteOwned(id, principal.userId);
    if (deleted === 0) {
      // Legacy reported missing and not-owned identically; that is preserved.
      throw new DomainError('NOT_FOUND', 'Status not found or unauthorized.');
    }
    return Object.freeze({
      success: true as const,
      message: 'Status deleted',
    });
  }

  async react(
    principal: AuthenticatedPrincipal,
    id: string,
    body: unknown,
  ): Promise<{ readonly success: true; readonly message: string }> {
    const reaction = parseStatusReaction(body);
    // Legacy applied no expiry gate here — only reshare checks expiry — so an
    // expired status still accepts a reaction. Only blocking is enforced.
    await this.requireVisible(principal, id);
    const now = new Date();

    return this.statuses.runSerializable(async (transaction) => {
      const record = await transaction.findById(id);
      if (record === null) throw notFound();
      const current: readonly JsonValue[] = Array.isArray(record.reactions)
        ? record.reactions
        : [];
      // Legacy appends without de-duplicating; repeat reactions are preserved.
      const next = Object.freeze([
        ...current,
        Object.freeze({
          userId: principal.userId,
          emoji: reaction.emoji,
          createdAt: now.toISOString(),
        }),
      ]);
      await transaction.setReactions(id, next);
      return Object.freeze({
        success: true as const,
        message: 'Reaction added',
      });
    });
  }

  async reshare(
    principal: AuthenticatedPrincipal,
    id: string,
    body: unknown,
  ): Promise<StatusView> {
    const input = parseStatusReshare(body);
    const original = await this.requireLiveVisible(principal, id);
    const now = new Date();

    // A text status carries its body in `content`; a media status carries the
    // media there and its text in `caption`.
    const isText = original.type === 'text';
    const record = await this.statuses.create({
      userId: principal.userId,
      type: SHARED_STATUS_TYPE,
      content: input.caption ?? '',
      caption: null,
      backgroundColor: input.backgroundColor ?? original.backgroundColor,
      font: input.font ?? original.font,
      expiresAt: new Date(now.getTime() + DAY_IN_MILLISECONDS),
      reactions: Object.freeze([]),
      originalContent: Object.freeze({
        creator: original.author === null ? null : { ...original.author },
        text: isText ? original.content : original.caption,
        media: isText ? null : original.content,
        type: original.type,
        createdAt: original.createdAt.toISOString(),
        originalId: original.id,
      }),
      shareMetadata: Object.freeze({
        sharedBy: principal.userId,
        sharedAt: now.toISOString(),
        originalStatusId: original.id,
      }),
    });
    return projectStatus(record);
  }

  private async requireVisible(
    principal: AuthenticatedPrincipal,
    id: string,
  ): Promise<StatusRecord> {
    const record = await this.statuses.findById(id);
    if (record === null) throw notFound();
    const [visible] = await this.filterBlocked(principal, [record]);
    if (visible === undefined) throw notFound();
    return visible;
  }

  /** Reshare, and only reshare, refuses an expired status — as in Express. */
  private async requireLiveVisible(
    principal: AuthenticatedPrincipal,
    id: string,
  ): Promise<StatusRecord> {
    const record = await this.requireVisible(principal, id);
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new DomainError('VALIDATION_FAILED', 'That status has expired.');
    }
    return record;
  }

  private async filterBlocked(
    principal: AuthenticatedPrincipal,
    records: readonly StatusRecord[],
  ): Promise<readonly StatusRecord[]> {
    const viewer = await this.posts.readViewer(principal.userId);
    const blocked = new Set(viewer.blockedUserIds);
    const authorIds = [
      ...new Set(
        records
          .map((record) => record.userId)
          .filter((authorId) => authorId !== principal.userId),
      ),
    ];
    const reverse = await Promise.all(
      authorIds.map(async (authorId) => {
        const authorView = await this.posts.readViewer(authorId);
        return authorView.blockedUserIds.includes(principal.userId)
          ? authorId
          : null;
      }),
    );
    for (const authorId of reverse) {
      if (authorId !== null) blocked.add(authorId);
    }
    return records.filter((record) => !blocked.has(record.userId));
  }
}

const readType = (value: string): StatusViewType => {
  if (value === SHARED_STATUS_TYPE) return SHARED_STATUS_TYPE;
  return STATUS_TYPES.find((candidate) => candidate === value) ?? 'text';
};

const projectStatus = (record: StatusRecord): StatusView => {
  const shared = sharedPostData(record);
  return Object.freeze({
    id: record.id,
    displayContent: displayContent(record, shared),
    sharedPostData: shared,
    userId: record.userId,
    user: record.author,
    type: readType(record.type),
    content: record.content,
    caption: record.caption,
    backgroundColor: record.backgroundColor,
    font: record.font,
    reactions: record.reactions,
    reactionsCount: Array.isArray(record.reactions)
      ? record.reactions.length
      : 0,
    sharedPostId: record.sharedPostId,
    expiresAt: record.expiresAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  });
};

const sharedPostData = (record: StatusRecord): SharedPostData | null => {
  if (record.type !== SHARED_STATUS_TYPE) return null;
  const original = asJsonObject(record.originalContent);
  const metadata = asJsonObject(record.shareMetadata);
  return Object.freeze({
    originalPost: Object.freeze({
      content: original.text ?? null,
      media: original.media ?? null,
      type: original.type ?? null,
      creator: original.creator ?? null,
      createdAt: original.createdAt ?? null,
    }),
    shareInfo: Object.freeze({
      sharedAt: metadata.sharedAt ?? record.createdAt.toISOString(),
      sharedBy: metadata.sharedBy ?? record.userId,
      additionalContent: record.content,
    }),
  });
};

const displayContent = (
  record: StatusRecord,
  shared: SharedPostData | null,
): StatusDisplayContent => {
  if (shared === null) {
    return Object.freeze({
      type: record.type,
      content: record.content,
      caption: record.caption,
      backgroundColor: record.backgroundColor,
      font: record.font,
    });
  }
  return Object.freeze({
    type: SHARED_STATUS_TYPE,
    originalCreator: shared.originalPost.creator,
    originalContent: shared.originalPost.content,
    originalMedia: shared.originalPost.media,
    originalType: shared.originalPost.type,
    sharedBy: shared.shareInfo.sharedBy,
    additionalContent: shared.shareInfo.additionalContent,
    caption: record.caption,
    backgroundColor: record.backgroundColor,
    font: record.font,
  });
};

function notFound(): DomainError {
  return new DomainError('NOT_FOUND', 'Status not found.');
}
