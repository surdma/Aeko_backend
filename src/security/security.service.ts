import { Injectable, Optional } from '@nestjs/common';

import { DomainError } from '../common/errors/domain.error';
import type { PageMeta, PageQuery } from '../common/pagination/page-query';
import type { PrismaClient } from '../../prisma/generated/client';
import { PrismaService } from '../database/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../auth/auth.types';
import type { RequestAuditContext } from '../common/http/request-audit/request-audit.decorator';
import {
  projectUser,
  type UserPage,
  type UserView,
} from '../users/user.contract';
import {
  parsePrivacySettings,
  parsePrivacyUpdate,
  type FollowRequestAction,
  type FollowRequestItem,
  type FollowRequestPage,
  type FollowRequestQuery,
  type FollowRequestStatus,
  type PrivacySettings,
} from './security.contract';
import {
  createSocialPrismaClient,
  type SocialPrismaClient,
  type SocialTransaction,
  type SocialUserRecord,
} from './security-prisma.client';
import { SecurityEventService } from './security-event.service';
import {
  createSecurityVerificationClient,
  type SecurityVerificationClient,
  type VerificationCandidate,
  type VerificationRules,
} from './security-verification.client';

export interface BlockResult {
  readonly state: 'blocked' | 'unblocked';
}
export interface BlockStatus {
  readonly isBlocked: boolean;
  readonly isBlockedBy: boolean;
  readonly canInteract: boolean;
}
export interface FollowState {
  readonly state: 'following' | 'requested';
}
export interface FollowResolution {
  readonly status: 'approved' | 'rejected';
}

interface BlockEntry {
  readonly user: string;
  readonly blockedAt: string;
  readonly reason: string | null;
}
interface FollowRequestEntry {
  readonly user: string;
  readonly requestedAt: string;
  readonly status: FollowRequestStatus;
}

@Injectable()
export class SecurityService {
  private readonly db: PrismaClient;

  constructor(
    prisma: PrismaService,
    @Optional() private readonly audit?: SecurityEventService,
  ) {
    this.db = prisma.db;
  }

  private get social(): SocialPrismaClient {
    return createSocialPrismaClient(this.db);
  }

  async verifyUser(
    principal: AuthenticatedPrincipal,
    targetId: string,
    audit: RequestAuditContext = unknownAuditContext,
  ): Promise<{ readonly verified: true }> {
    const verification: SecurityVerificationClient =
      createSecurityVerificationClient(this.db);
    if (!principal.isAdmin) {
      await this.recordVerification(
        principal.userId,
        targetId,
        false,
        'administrator_required',
        audit,
      );
      authorization('Administrator access is required.');
    }
    if (!principal.twoFactorSatisfied) {
      await this.recordVerification(
        principal.userId,
        targetId,
        false,
        'two_factor_required',
        audit,
      );
      throw new DomainError(
        'TWO_FACTOR_REQUIRED',
        'Two-factor authentication is required.',
      );
    }
    const [candidate, storedRules] = await Promise.all([
      verification.findCandidate(targetId),
      verification.findRules(),
    ]);
    if (!candidate) {
      await this.recordVerification(
        principal.userId,
        targetId,
        false,
        'user_not_found',
        audit,
      );
      notFound();
    }
    const rules = storedRules ?? defaultVerificationRules;
    const failures = verificationFailures(candidate, rules);
    if (failures.length > 0) {
      await this.recordVerification(
        principal.userId,
        targetId,
        false,
        'criteria_not_met',
        audit,
      );
      throw new DomainError(
        'VALIDATION_FAILED',
        'User does not meet verification criteria.',
        {
          criteria: failures,
        },
      );
    }
    await verification.markVerified(targetId);
    await this.recordVerification(
      principal.userId,
      targetId,
      true,
      'verified',
      audit,
    );
    return Object.freeze({ verified: true });
  }

  private async recordVerification(
    actorId: string,
    targetId: string,
    success: boolean,
    outcome: string,
    audit: RequestAuditContext,
  ): Promise<void> {
    if (!this.audit) return;
    await this.audit.record({
      userId: actorId,
      eventType: 'verification',
      targetUserId: targetId,
      success,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
      metadata: Object.freeze({ outcome }),
      errorMessage: null,
    });
  }

  async block(
    actorId: string,
    targetId: string,
    reason: string | null,
  ): Promise<BlockResult> {
    if (actorId === targetId) validation('You cannot block yourself.');
    await this.serializable(async (tx) => {
      const actor = await requireUser(tx, actorId);
      const target = await requireUser(tx, targetId);
      const blocks = parseBlocks(actor.blockedUsers);
      const nextBlocks = hasBlock(blocks, targetId)
        ? blocks
        : [
            ...blocks,
            Object.freeze({
              user: targetId,
              blockedAt: new Date().toISOString(),
              reason,
            }),
          ];
      const actorFollowing = without(parseIds(actor.following), targetId);
      const actorFollowers = without(parseIds(actor.followers), targetId);
      const targetFollowing = without(parseIds(target.following), actorId);
      const targetFollowers = without(parseIds(target.followers), actorId);
      await tx.updateUser(actorId, {
        blockedUsers: serializeBlocks(nextBlocks),
        following: actorFollowing,
        followers: actorFollowers,
        followRequests: serializeRequests(
          withoutRequest(parseRequests(actor.followRequests), targetId),
        ),
      });
      await tx.updateUser(targetId, {
        following: targetFollowing,
        followers: targetFollowers,
        followRequests: serializeRequests(
          withoutRequest(parseRequests(target.followRequests), actorId),
        ),
      });
    });
    return Object.freeze({ state: 'blocked' });
  }

  async unblock(actorId: string, targetId: string): Promise<BlockResult> {
    await this.serializable(async (tx) => {
      const actor = await requireUser(tx, actorId);
      await tx.updateUser(actorId, {
        blockedUsers: serializeBlocks(
          parseBlocks(actor.blockedUsers).filter(
            (entry) => entry.user !== targetId,
          ),
        ),
      });
    });
    return Object.freeze({ state: 'unblocked' });
  }

  async blockStatus(actorId: string, targetId: string): Promise<BlockStatus> {
    const [actor, target] = await Promise.all([
      this.social.findUser(actorId),
      this.social.findUser(targetId),
    ]);
    if (!actor || !target) notFound();
    const isBlocked = hasBlock(parseBlocks(actor.blockedUsers), targetId);
    const isBlockedBy = hasBlock(parseBlocks(target.blockedUsers), actorId);
    return Object.freeze({
      isBlocked,
      isBlockedBy,
      canInteract: !isBlocked && !isBlockedBy,
    });
  }

  async blocked(actorId: string, query: PageQuery): Promise<UserPage> {
    const actor = await this.social.findUser(actorId);
    if (!actor) notFound();
    const blocks = parseBlocks(actor.blockedUsers);
    const start = (query.page - 1) * query.limit;
    const pageBlocks = blocks.slice(start, start + query.limit);
    const users = await this.social.findUsers(
      pageBlocks.map((entry) => entry.user),
      '',
    );
    return page(users.map(toUserView), query, blocks.length);
  }

  async privacy(actorId: string): Promise<PrivacySettings> {
    const actor = await this.social.findUser(actorId);
    if (!actor) notFound();
    return parseStoredPrivacy(actor.privacy);
  }

  async updatePrivacy(
    actorId: string,
    input: unknown,
  ): Promise<PrivacySettings> {
    const update = parsePrivacyUpdate(input);
    const actor = await this.social.findUser(actorId);
    if (!actor) notFound();
    const privacy = parsePrivacySettings({
      ...parseStoredPrivacy(actor.privacy),
      ...update,
    });
    await this.social.updateUser(actorId, { privacy: { ...privacy } });
    return privacy;
  }

  follow(actorId: string, targetId: string): Promise<FollowState> {
    return this.requestFollow(actorId, targetId);
  }

  async requestFollow(actorId: string, targetId: string): Promise<FollowState> {
    if (actorId === targetId) validation('You cannot follow yourself.');
    const result = await this.serializable(async (tx) => {
      const actor = await requireUser(tx, actorId);
      const target = await requireUser(tx, targetId);
      concealBlock(actor, target);
      const targetFollowers = parseIds(target.followers);
      const actorFollowing = parseIds(actor.following);
      if (
        targetFollowers.includes(actorId) &&
        actorFollowing.includes(targetId)
      )
        return 'following';
      const privacy = parseStoredPrivacy(target.privacy);
      if (!privacy.isPrivate) {
        await tx.updateUser(actorId, {
          following: unique(actorFollowing, targetId),
        });
        await tx.updateUser(targetId, {
          followers: unique(targetFollowers, actorId),
          followRequests: serializeRequests(
            withoutRequest(parseRequests(target.followRequests), actorId),
          ),
        });
        return 'following';
      }
      if (!privacy.allowFollowRequests)
        authorization('This user is not accepting follow requests.');
      const requests = parseRequests(target.followRequests);
      const existing = requests.find(
        (request) => request.user === actorId && request.status === 'pending',
      );
      if (!existing) {
        const retained = requests.filter((request) => request.user !== actorId);
        await tx.updateUser(targetId, {
          followRequests: serializeRequests([
            ...retained,
            {
              user: actorId,
              requestedAt: new Date().toISOString(),
              status: 'pending',
            },
          ]),
        });
      }
      return 'requested';
    });
    if (result !== 'following' && result !== 'requested') internal();
    const state: 'following' | 'requested' = result;
    return Object.freeze({ state });
  }

  async resolveFollowRequest(
    recipientId: string,
    requesterId: string,
    action: FollowRequestAction,
  ): Promise<FollowResolution> {
    const result = await this.serializable(async (tx) => {
      const recipient = await requireUser(tx, recipientId);
      const requester = await requireUser(tx, requesterId);
      concealBlock(recipient, requester);
      const requests = parseRequests(recipient.followRequests);
      const pending = requests.find(
        (request) =>
          request.user === requesterId && request.status === 'pending',
      );
      const previous = requests.find(
        (request) =>
          request.user === requesterId && request.status !== 'pending',
      );
      if (!pending) {
        if (previous?.status === 'approved' && action === 'approve')
          return 'approved';
        if (previous?.status === 'rejected' && action === 'reject')
          return 'rejected';
        authorization(
          'Only the request recipient can resolve this follow request.',
        );
      }
      const status: FollowRequestStatus =
        action === 'approve' ? 'approved' : 'rejected';
      const resolved = requests.map((request) =>
        request === pending ? { ...request, status } : request,
      );
      const recipientData: Record<string, unknown> = {
        followRequests: serializeRequests(resolved),
      };
      if (action === 'approve')
        recipientData.followers = unique(
          parseIds(recipient.followers),
          requesterId,
        );
      await tx.updateUser(recipientId, recipientData);
      if (action === 'approve')
        await tx.updateUser(requesterId, {
          following: unique(parseIds(requester.following), recipientId),
        });
      return status;
    });
    if (result !== 'approved' && result !== 'rejected') internal();
    const status: 'approved' | 'rejected' = result;
    return Object.freeze({ status });
  }

  async followRequests(
    actorId: string,
    query: FollowRequestQuery,
  ): Promise<FollowRequestPage> {
    const actor = await this.social.findUser(actorId);
    if (!actor) notFound();
    const requests = parseRequests(actor.followRequests)
      .filter(
        (request) => query.status === 'all' || request.status === query.status,
      )
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
    const requesters = await this.social.findUsers(
      requests.map((request) => request.user),
      '',
    );
    const byId = new Map(requesters.map((user) => [user.id, user]));
    const visible = requests.filter((request) => {
      const requester = byId.get(request.user);
      return requester !== undefined && !mutuallyBlocked(actor, requester);
    });
    const start = (query.page - 1) * query.limit;
    const selected = visible.slice(start, start + query.limit);
    const items: FollowRequestItem[] = selected.flatMap((request) => {
      const user = byId.get(request.user);
      return user
        ? [
            {
              user: projectUser(user),
              requestedAt: request.requestedAt,
              status: request.status,
            },
          ]
        : [];
    });
    return Object.freeze({
      requests: Object.freeze(items),
      page: pageMeta(query, visible.length),
    });
  }

  async graph(
    actorId: string,
    kind: 'followers' | 'following',
    query: PageQuery,
    search = '',
  ): Promise<UserPage> {
    const actor = await this.social.findUser(actorId);
    if (!actor) notFound();
    const ids = parseIds(
      kind === 'followers' ? actor.followers : actor.following,
    );
    const candidates = await this.social.findUsers(ids, search);
    const visible: UserView[] = [];
    for (const candidate of candidates) {
      if (mutuallyBlocked(actor, candidate)) continue;
      const privacy = parseStoredPrivacy(candidate.privacy);
      if (
        privacy.isPrivate &&
        candidate.id !== actorId &&
        !parseIds(candidate.followers).includes(actorId)
      )
        continue;
      visible.push(toUserView(candidate));
    }
    const start = (query.page - 1) * query.limit;
    return page(
      visible.slice(start, start + query.limit),
      query,
      visible.length,
    );
  }

  async unfollow(
    actorId: string,
    targetId: string,
  ): Promise<{ readonly state: 'not-following' }> {
    if (actorId === targetId) validation('You cannot unfollow yourself.');
    await this.serializable(async (tx) => {
      const actor = await requireUser(tx, actorId);
      const target = await requireUser(tx, targetId);
      concealBlock(actor, target);
      await tx.updateUser(actorId, {
        following: without(parseIds(actor.following), targetId),
      });
      await tx.updateUser(targetId, {
        followers: without(parseIds(target.followers), actorId),
      });
    });
    return Object.freeze({ state: 'not-following' });
  }

  private async serializable(
    operation: (transaction: SocialTransaction) => Promise<unknown>,
  ): Promise<unknown> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.social.transaction(operation);
      } catch (error: unknown) {
        if (readCode(error) !== 'P2034') throw sanitizeProviderError(error);
        if (attempt === 3)
          throw new DomainError(
            'DATABASE_UNAVAILABLE',
            'The request could not be completed. Please try again.',
          );
      }
    }
    return internal();
  }
}

const defaultVerificationRules: VerificationRules = Object.freeze({
  minFollowers: 1000,
  minPosts: 10,
  requiresProfilePic: true,
  requiresCoverPic: true,
  requiresBio: true,
});

const unknownAuditContext: RequestAuditContext = Object.freeze({
  ipAddress: 'unknown',
  userAgent: 'unknown',
});

const verificationFailures = (
  candidate: VerificationCandidate,
  rules: VerificationRules,
): readonly string[] => {
  const followers = parseIds(candidate.followers).length;
  const failures: string[] = [];
  if (followers < rules.minFollowers) failures.push('followers');
  if (candidate.postsCount < rules.minPosts) failures.push('posts');
  if (rules.requiresProfilePic && !candidate.profilePicture)
    failures.push('profilePicture');
  if (rules.requiresCoverPic && !candidate.coverPicture)
    failures.push('coverPicture');
  if (rules.requiresBio && !candidate.bio) failures.push('bio');
  return Object.freeze(failures);
};

const parseIds = (value: unknown): readonly string[] => {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    invalidStored();
  return Object.freeze([...new Set(value)]);
};
const parseBlocks = (value: unknown): readonly BlockEntry[] => {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) invalidStored();
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) invalidStored();
    const direct: unknown =
      Reflect.get(item, 'user') ?? Reflect.get(item, 'userId');
    const nested: unknown =
      typeof direct === 'object' && direct !== null
        ? Reflect.get(direct, 'id')
        : direct;
    if (typeof nested !== 'string') invalidStored();
    const at: unknown = Reflect.get(item, 'blockedAt');
    const reason: unknown = Reflect.get(item, 'reason');
    if (at !== undefined && typeof at !== 'string' && !(at instanceof Date))
      invalidStored();
    if (reason !== undefined && reason !== null && typeof reason !== 'string')
      invalidStored();
    return Object.freeze({
      user: nested,
      blockedAt:
        at instanceof Date
          ? at.toISOString()
          : typeof at === 'string'
            ? at
            : new Date(0).toISOString(),
      reason: typeof reason === 'string' ? reason : null,
    });
  });
};
const parseRequests = (value: unknown): readonly FollowRequestEntry[] => {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) invalidStored();
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) invalidStored();
    const user: unknown = Reflect.get(item, 'user');
    const requestedAt: unknown = Reflect.get(item, 'requestedAt');
    const status: unknown = Reflect.get(item, 'status');
    if (
      typeof user !== 'string' ||
      typeof requestedAt !== 'string' ||
      !Number.isFinite(Date.parse(requestedAt))
    )
      invalidStored();
    if (status !== 'pending' && status !== 'approved' && status !== 'rejected')
      invalidStored();
    return Object.freeze({ user, requestedAt, status });
  });
};
const parseStoredPrivacy = (value: unknown): PrivacySettings => {
  try {
    return parsePrivacySettings(value);
  } catch {
    invalidStored();
  }
};
const serializeBlocks = (items: readonly BlockEntry[]): readonly object[] =>
  items.map((item) =>
    Object.freeze({
      user: item.user,
      blockedAt: item.blockedAt,
      reason: item.reason ?? '',
    }),
  );
const serializeRequests = (
  items: readonly FollowRequestEntry[],
): readonly object[] => items.map((item) => Object.freeze({ ...item }));
const withoutRequest = (
  items: readonly FollowRequestEntry[],
  user: string,
): readonly FollowRequestEntry[] =>
  items.filter((item) => item.user !== user || item.status !== 'pending');
const unique = (items: readonly string[], value: string): readonly string[] =>
  Object.freeze(items.includes(value) ? [...items] : [...items, value]);
const without = (items: readonly string[], value: string): readonly string[] =>
  Object.freeze(items.filter((item) => item !== value));
const hasBlock = (blocks: readonly BlockEntry[], id: string): boolean =>
  blocks.some((entry) => entry.user === id);
const mutuallyBlocked = (
  left: SocialUserRecord,
  right: SocialUserRecord,
): boolean =>
  hasBlock(parseBlocks(left.blockedUsers), right.id) ||
  hasBlock(parseBlocks(right.blockedUsers), left.id);
const concealBlock = (
  left: SocialUserRecord,
  right: SocialUserRecord,
): void => {
  if (mutuallyBlocked(left, right)) notFound();
};
const requireUser = async (
  tx: SocialTransaction,
  id: string,
): Promise<SocialUserRecord> => {
  const user = await tx.findUser(id);
  if (!user) notFound();
  return user;
};
const toUserView = (user: SocialUserRecord): UserView =>
  Object.freeze({
    ...projectUser(user),
    isPrivate: parseStoredPrivacy(user.privacy).isPrivate,
    followersCount: parseIds(user.followers).length,
    followingCount: parseIds(user.following).length,
  });
const pageMeta = (query: PageQuery, total: number): PageMeta =>
  Object.freeze({
    page: query.page,
    limit: query.limit,
    total,
    pages: total === 0 ? 0 : Math.ceil(total / query.limit),
  });
const page = (
  items: readonly UserView[],
  query: PageQuery,
  total: number,
): UserPage =>
  Object.freeze({ items: Object.freeze(items), page: pageMeta(query, total) });
const readCode = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null) return null;
  const code: unknown = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : null;
};
const sanitizeProviderError = (error: unknown): DomainError =>
  error instanceof DomainError
    ? error
    : new DomainError(
        'DATABASE_UNAVAILABLE',
        'The request could not be completed. Please try again.',
      );
function validation(message: string): never {
  throw new DomainError('VALIDATION_FAILED', message);
}
function authorization(message: string): never {
  throw new DomainError('AUTHORIZATION_DENIED', message);
}
function notFound(): never {
  throw new DomainError('NOT_FOUND', 'User not found.');
}
function invalidStored(): never {
  throw new DomainError(
    'INTERNAL_ERROR',
    'Stored social data could not be processed.',
  );
}
function internal(): never {
  throw new DomainError(
    'INTERNAL_ERROR',
    'The request could not be completed.',
  );
}
