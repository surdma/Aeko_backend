import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import { isJsonObject, type JsonValue } from '../common/json/json-value';
import { PrismaService } from '../database/prisma/prisma.service';
import {
  parseCommunityCreate,
  parseCommunityListQuery,
  parseCommunityUpdate,
  parseMyCommunitiesQuery,
  type CommunityDetailView,
  type CommunityPage,
  type CommunityView,
} from './community.contract';
import {
  createCommunityPrismaClient,
  type CommunityPrismaClient,
  type CommunityRecord,
  type MemberSummary,
} from './community-prisma.client';

/** Legacy showed at most five members in the detail preview. */
const MEMBER_PREVIEW = 5;

export interface JoinResult {
  readonly success: true;
  readonly message: string;
  readonly requiresApproval?: true;
  readonly data?: Readonly<{ status: string }>;
}

export interface PaidCommunityInfo {
  readonly price: JsonValue;
  readonly currency: JsonValue;
  readonly subscriptionType: JsonValue;
  readonly availableMethods: JsonValue;
}

@Injectable()
export class CommunitiesService {
  constructor(private readonly prisma: PrismaService) {}

  private get communities(): CommunityPrismaClient {
    return createCommunityPrismaClient(this.prisma.db);
  }

  /** Legacy restricted creation to golden-tick users; preserved. */
  async create(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<{ readonly success: true; readonly data: CommunityView }> {
    const input = parseCommunityCreate(body);
    const client = this.communities;

    const goldenTick = await client.hasGoldenTick(principal.userId);
    // Legacy read `user.goldenTick` off a possibly-missing row and answered 500.
    if (goldenTick === null) {
      throw new DomainError('NOT_FOUND', 'User not found.');
    }
    if (!goldenTick) {
      throw new DomainError(
        'AUTHORIZATION_DENIED',
        'Only users with golden tick can create communities',
      );
    }

    const existing = await client.findByName(input.name);
    if (existing !== null) {
      throw new DomainError(
        'CONFLICT',
        'A community with this name already exists',
      );
    }

    const record = await client.createWithOwner(principal.userId, {
      name: input.name,
      description: input.description,
      isPrivate: input.isPrivate,
      tags: input.tags,
    });
    return Object.freeze({ success: true as const, data: project(record) });
  }

  async list(query: unknown): Promise<CommunityPage> {
    const { page, limit, search } = parseCommunityListQuery(query);
    const client = this.communities;
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      client.list(search, skip, limit),
      client.count(search),
    ]);
    return page_(records, total, page, limit);
  }

  async listMine(
    principal: AuthenticatedPrincipal,
    query: unknown,
  ): Promise<CommunityPage> {
    const { page, limit, search } = parseMyCommunitiesQuery(query);
    const client = this.communities;
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      client.listMine(principal.userId, search, skip, limit),
      client.countMine(principal.userId, search),
    ]);
    return page_(records, total, page, limit);
  }

  async get(
    principal: AuthenticatedPrincipal,
    communityId: string,
  ): Promise<{ readonly success: true; readonly data: CommunityDetailView }> {
    const client = this.communities;
    const record = await client.findById(communityId);
    if (record === null) throw notFound();

    const membership = await client.findMembership(
      communityId,
      principal.userId,
    );
    if (record.isPrivate && membership === null) {
      throw new DomainError(
        'AUTHORIZATION_DENIED',
        'This is a private community. You need to be a member to view it.',
      );
    }

    const [members, moderators] = await Promise.all([
      client.findMembersPreview(communityId, MEMBER_PREVIEW),
      client.findModerators(communityId),
    ]);

    return Object.freeze({
      success: true as const,
      data: Object.freeze({
        ...project(record),
        members: Object.freeze(members.map(summary)),
        moderators: Object.freeze(moderators.map(summary)),
      }),
    });
  }

  /**
   * Joining is idempotent on the unique membership constraint, so a client
   * that retries cannot create a second row or a second count increment.
   */
  async join(
    principal: AuthenticatedPrincipal,
    communityId: string,
  ): Promise<JoinResult> {
    return this.communities.runSerializable(async (transaction) => {
      const record = await transaction.findById(communityId);
      if (record === null) throw notFound();

      const existing = await transaction.findMembership(
        communityId,
        principal.userId,
      );
      if (existing !== null) {
        return existingMembership(existing.status);
      }

      const settings = paymentSettings(record.settings);
      if (settings.isPaidCommunity === true) {
        throw paymentRequired(settings);
      }

      const requireApproval = readBoolean(
        isJsonObject(record.settings) ? record.settings.requireApproval : null,
      );
      const status = record.isPrivate || requireApproval ? 'pending' : 'active';

      const added = await transaction.addMember(
        communityId,
        principal.userId,
        'member',
        status,
      );
      if (!added) {
        const now = await transaction.findMembership(
          communityId,
          principal.userId,
        );
        return existingMembership(now === null ? 'active' : now.status);
      }

      if (status === 'active') {
        await transaction.adjustMemberCount(communityId, 1);
        const chatId = await transaction.findChatId(communityId);
        if (chatId !== null) {
          await transaction.addChatMember(chatId, principal.userId);
        }
      }

      if (status === 'pending') {
        return Object.freeze({
          success: true as const,
          message: 'Join request sent. Waiting for approval.',
          requiresApproval: true as const,
        });
      }
      return Object.freeze({
        success: true as const,
        message: 'Successfully joined the community',
        data: Object.freeze({ status }),
      });
    });
  }

  async leave(
    principal: AuthenticatedPrincipal,
    communityId: string,
  ): Promise<{ readonly success: true; readonly message: string }> {
    return this.communities.runSerializable(async (transaction) => {
      const record = await transaction.findById(communityId);
      if (record === null) throw notFound();

      if (record.ownerId === principal.userId) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'Community owner cannot leave. Transfer ownership or delete the community.',
        );
      }

      const membership = await transaction.findMembership(
        communityId,
        principal.userId,
      );
      if (membership === null) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'You are not a member of this community',
        );
      }

      const removed = await transaction.removeMember(
        communityId,
        principal.userId,
      );
      if (removed && membership.status === 'active') {
        await transaction.adjustMemberCount(communityId, -1);
        const chatId = await transaction.findChatId(communityId);
        if (chatId !== null) {
          await transaction.removeChatMember(chatId, principal.userId);
        }
      }

      return Object.freeze({
        success: true as const,
        message: 'Successfully left the community',
      });
    });
  }

  /** Owner or moderator, exactly as legacy had it. */
  async update(
    principal: AuthenticatedPrincipal,
    communityId: string,
    body: unknown,
  ): Promise<{ readonly success: true; readonly data: CommunityView }> {
    const input = parseCommunityUpdate(body);

    return this.communities.runSerializable(async (transaction) => {
      const record = await transaction.findById(communityId);
      if (record === null) throw notFound();

      const membership = await transaction.findMembership(
        communityId,
        principal.userId,
      );
      const isOwner = record.ownerId === principal.userId;
      const isModerator = membership?.role === 'moderator';
      if (!isOwner && !isModerator) {
        throw new DomainError(
          'AUTHORIZATION_DENIED',
          'Not authorized to update this community',
        );
      }

      // The merge reads and writes inside one transaction; legacy read the
      // current settings outside the update that overwrote them.
      const settings =
        input.settings === undefined
          ? undefined
          : {
              ...(isJsonObject(record.settings) ? record.settings : {}),
              ...input.settings,
            };

      const updated = await transaction.update(communityId, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(input.isPrivate === undefined
          ? {}
          : { isPrivate: input.isPrivate }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
        ...(settings === undefined ? {} : { settings }),
      });
      return Object.freeze({ success: true as const, data: project(updated) });
    });
  }

  /** Owner only. Soft delete, as legacy had it. */
  async remove(
    principal: AuthenticatedPrincipal,
    communityId: string,
  ): Promise<{ readonly success: true; readonly message: string }> {
    return this.communities.runSerializable(async (transaction) => {
      const record = await transaction.findById(communityId);
      if (record === null) throw notFound();
      if (record.ownerId !== principal.userId) {
        throw new DomainError(
          'AUTHORIZATION_DENIED',
          'Not authorized to delete this community',
        );
      }

      await transaction.update(communityId, { isActive: false });
      await transaction.clearMembers(communityId);
      // Legacy cleared every member row but left memberCount untouched, so a
      // reactivated community reported members that no longer existed.
      await transaction.setMemberCount(communityId, 0);

      const chatId = await transaction.findChatId(communityId);
      if (chatId !== null) await transaction.clearChatMembers(chatId);

      return Object.freeze({
        success: true as const,
        message: 'Community deleted successfully',
      });
    });
  }
}

const existingMembership = (status: string): JoinResult => {
  if (status === 'banned') {
    throw new DomainError(
      'AUTHORIZATION_DENIED',
      'You are banned from this community',
    );
  }
  if (status === 'pending') {
    return Object.freeze({
      success: true as const,
      message: 'Join request already sent. Waiting for approval.',
      requiresApproval: true as const,
    });
  }
  throw new DomainError(
    'VALIDATION_FAILED',
    'You are already a member of this community',
  );
};

const paymentRequired = (
  settings: Readonly<Record<string, JsonValue>>,
): DomainError =>
  new DomainError(
    'PAYMENT_REQUIRED',
    'This is a paid community. Please complete payment first.',
    {
      requiresPayment: true,
      paymentInfo: {
        price: settings.price ?? null,
        currency: settings.currency ?? null,
        subscriptionType: settings.subscriptionType ?? null,
        availableMethods: settings.paymentMethods ?? null,
      },
    },
  );

const paymentSettings = (
  settings: JsonValue,
): Readonly<Record<string, JsonValue>> => {
  if (!isJsonObject(settings)) return {};
  const payment = settings.payment;
  return isJsonObject(payment) ? payment : {};
};

const readBoolean = (value: JsonValue | null | undefined): boolean =>
  value === true;

const summary = (member: MemberSummary): MemberSummary =>
  Object.freeze({
    name: member.name,
    username: member.username,
    profilePicture: member.profilePicture,
  });

const project = (record: CommunityRecord): CommunityView =>
  Object.freeze({
    id: record.id,
    // Legacy answered with a Mongo-era `_id` alias alongside `id`.
    _id: record.id,
    name: record.name,
    description: record.description,
    ownerId: record.ownerId,
    owner: record.owner,
    isPrivate: record.isPrivate,
    isActive: record.isActive,
    memberCount: record.memberCount,
    tags: record.tags,
    profile: record.profile,
    settings: record.settings,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });

const page_ = (
  records: readonly CommunityRecord[],
  total: number,
  page: number,
  limit: number,
): CommunityPage =>
  Object.freeze({
    communities: Object.freeze(records.map(project)),
    pagination: Object.freeze({
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    }),
  });

function notFound(): DomainError {
  return new DomainError('NOT_FOUND', 'Community not found');
}
