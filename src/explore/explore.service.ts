import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import { parseWithScope, queryInteger } from '../common/validation/parse';
import { PrismaService } from '../database/prisma/prisma.service';
import type { PostView } from '../posts/post.contract';
import { projectPost } from '../posts/post.projection';
import {
  createExplorePrismaClient,
  type CommunityRecord,
  type ExplorePrismaClient,
  type ExploreViewer,
  type LiveStreamRecord,
  type SuggestedUserRecord,
} from './explore-prisma.client';

const DAY = 24 * 60 * 60 * 1000;

/** The legacy section sizes, preserved exactly. */
const TRENDING_WINDOW_DAYS = 30;
const FOR_YOU_WINDOW_DAYS = 3;
const SUGGESTED_CANDIDATES = 20;
const SUGGESTED_LIMIT = 10;
const COMMUNITY_LIMIT = 8;
const LIVE_STREAM_LIMIT = 5;
const VIRAL_LIMIT = 5;
const VIRAL_MINIMUM_VIEWS = 50_000;
const FOR_YOU_LIMIT = 10;

export interface ExploreQuery {
  readonly page: number;
  readonly limit: number;
}

export interface ExploreFeed {
  readonly trending: readonly PostView[];
  readonly suggestedUsers: readonly SuggestedUserView[];
  readonly communities: readonly CommunityView[];
  readonly liveStreams: readonly LiveStreamView[];
  readonly viral: readonly PostView[];
  readonly forYou: readonly PostView[];
}

export interface SuggestedUserView extends SuggestedUserRecord {
  /** Legacy always reported false here; suggestions exclude people you follow. */
  readonly isFollowing: false;
}

export interface CommunityView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly memberCount: number;
  readonly owner: CommunityRecord['owner'];
  readonly createdAt: string;
}

export interface LiveStreamView {
  readonly id: string;
  readonly title: string | null;
  readonly status: string;
  readonly viewerCount: number;
  readonly hostId: string;
  readonly host: LiveStreamRecord['host'];
  readonly startedAt: string | null;
}

export interface ExploreResult {
  readonly success: true;
  readonly data: ExploreFeed;
  readonly pagination: Readonly<{
    currentPage: number;
    totalPages: number;
    totalPosts: number;
    hasMore: boolean;
  }>;
}

const exploreQuerySchema = z
  .object({
    page: queryInteger(1, 1_000_000).default(1),
    limit: queryInteger(20, 50).default(20),
  })
  .strip();

export const parseExploreQuery = (input: unknown): ExploreQuery =>
  Object.freeze(parseWithScope(exploreQuerySchema, input, 'explore query'));

@Injectable()
export class ExploreService {
  constructor(private readonly prisma: PrismaService) {}

  private get explore(): ExplorePrismaClient {
    return createExplorePrismaClient(this.prisma.db);
  }

  async feed(
    principal: AuthenticatedPrincipal,
    query: ExploreQuery,
  ): Promise<ExploreResult> {
    const viewer = await this.explore.readViewer(principal.userId);
    if (viewer === null) {
      throw new DomainError('NOT_FOUND', 'User not found.');
    }

    const skip = (query.page - 1) * query.limit;
    const now = Date.now();

    // Trending and viral stay visible even from people you already follow;
    // discovery sections deliberately exclude them.
    const baseExcluded = excluded(principal.userId, viewer);
    const discoveryExcluded = [
      ...new Set([...viewer.followingIds, ...baseExcluded]),
    ];

    const [
      trending,
      viral,
      forYou,
      totalPosts,
      suggested,
      communities,
      streams,
    ] = await Promise.all([
      this.explore.findPosts({
        excludedUserIds: baseExcluded,
        excludedPostIds: viewer.notInterestedPostIds,
        createdAfter: new Date(now - TRENDING_WINDOW_DAYS * DAY),
        minimumViews: null,
        orderBy: 'views',
        skip,
        take: query.limit,
      }),
      this.explore.findPosts({
        excludedUserIds: baseExcluded,
        excludedPostIds: viewer.notInterestedPostIds,
        createdAfter: null,
        minimumViews: VIRAL_MINIMUM_VIEWS,
        orderBy: 'views',
        skip: 0,
        take: VIRAL_LIMIT,
      }),
      // Legacy only produced this section for a user with interests.
      viewer.interests.length === 0
        ? Promise.resolve([])
        : this.explore.findPosts({
            excludedUserIds: discoveryExcluded,
            excludedPostIds: viewer.notInterestedPostIds,
            createdAfter: new Date(now - FOR_YOU_WINDOW_DAYS * DAY),
            minimumViews: null,
            orderBy: 'createdAt',
            skip: 0,
            take: FOR_YOU_LIMIT,
          }),
      this.explore.countPublicPosts(baseExcluded),
      this.explore.findSuggestedUsers(discoveryExcluded, SUGGESTED_CANDIDATES),
      this.explore.findActiveCommunities(viewer.communityIds, COMMUNITY_LIMIT),
      this.explore.findLiveStreams(
        [...viewer.blockedUserIds, principal.userId],
        LIVE_STREAM_LIMIT,
      ),
    ]);

    return Object.freeze({
      success: true as const,
      data: Object.freeze({
        trending: Object.freeze(
          trending.map((record) => projectPost(record, principal.userId)),
        ),
        suggestedUsers: Object.freeze(
          // Legacy over-fetched candidates and ranked by follower count in
          // memory because the count lives in a JSON column.
          [...suggested]
            .sort((left, right) => right.followersCount - left.followersCount)
            .slice(0, SUGGESTED_LIMIT)
            .map((user) =>
              Object.freeze({ ...user, isFollowing: false as const }),
            ),
        ),
        communities: Object.freeze(communities.map(projectCommunity)),
        liveStreams: Object.freeze(streams.map(projectLiveStream)),
        viral: Object.freeze(
          viral.map((record) => projectPost(record, principal.userId)),
        ),
        forYou: Object.freeze(
          forYou.map((record) => projectPost(record, principal.userId)),
        ),
      }),
      pagination: Object.freeze({
        currentPage: query.page,
        totalPages: Math.ceil(totalPosts / query.limit),
        totalPosts,
        hasMore: skip + trending.length < totalPosts,
      }),
    });
  }
}

/** Self, blocked people, and anyone explicitly marked not-interested. */
const excluded = (
  viewerId: string,
  viewer: ExploreViewer,
): readonly string[] => [
  ...new Set([
    viewerId,
    ...viewer.blockedUserIds,
    ...viewer.notInterestedUserIds,
  ]),
];

const projectCommunity = (record: CommunityRecord): CommunityView =>
  Object.freeze({
    id: record.id,
    name: record.name,
    description: record.description,
    memberCount: record.memberCount,
    owner: record.owner,
    createdAt: record.createdAt.toISOString(),
  });

const projectLiveStream = (record: LiveStreamRecord): LiveStreamView =>
  Object.freeze({
    id: record.id,
    title: record.title,
    status: record.status,
    viewerCount: record.viewerCount,
    hostId: record.hostId,
    host: record.host,
    startedAt: record.startedAt?.toISOString() ?? null,
  });
