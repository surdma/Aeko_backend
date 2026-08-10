import type { Prisma, PrismaClient } from '../generated/prisma/client';
import {
  asJsonObject,
  toJsonValue,
  type JsonValue,
} from '../common/json/json-value';
import type { PostAuthorView } from '../posts/post.contract';
import type { PostRecord } from '../posts/post-prisma.client';

export interface SuggestedUserRecord {
  readonly id: string;
  readonly username: string;
  readonly name: string | null;
  readonly profilePicture: string | null;
  readonly bio: string | null;
  readonly blueTick: boolean;
  readonly goldenTick: boolean;
  readonly followersCount: number;
}

export interface CommunityRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly memberCount: number;
  readonly settings: JsonValue;
  readonly owner: PostAuthorView | null;
  readonly createdAt: Date;
}

export interface LiveStreamRecord {
  readonly id: string;
  readonly title: string | null;
  readonly status: string;
  readonly viewerCount: number;
  readonly hostId: string;
  readonly host: PostAuthorView | null;
  readonly startedAt: Date | null;
}

export interface ExploreViewer {
  readonly followingIds: readonly string[];
  readonly blockedUserIds: readonly string[];
  readonly notInterestedPostIds: readonly string[];
  readonly notInterestedUserIds: readonly string[];
  readonly communityIds: readonly string[];
  readonly interests: readonly string[];
}

export interface ExplorePostQuery {
  readonly excludedUserIds: readonly string[];
  readonly excludedPostIds: readonly string[];
  readonly createdAfter: Date | null;
  readonly minimumViews: number | null;
  readonly orderBy: 'views' | 'createdAt';
  readonly skip: number;
  readonly take: number;
}

export interface ExplorePrismaClient {
  readViewer(userId: string): Promise<ExploreViewer | null>;
  findPosts(query: ExplorePostQuery): Promise<readonly PostRecord[]>;
  countPublicPosts(excludedUserIds: readonly string[]): Promise<number>;
  findSuggestedUsers(
    excludedUserIds: readonly string[],
    take: number,
  ): Promise<readonly SuggestedUserRecord[]>;
  findActiveCommunities(
    excludedIds: readonly string[],
    take: number,
  ): Promise<readonly CommunityRecord[]>;
  findLiveStreams(
    excludedHostIds: readonly string[],
    take: number,
  ): Promise<readonly LiveStreamRecord[]>;
}

const AUTHOR_RELATION = 'users_posts_userIdTouser';

const authorSelect = {
  id: true,
  name: true,
  username: true,
  profilePicture: true,
  blueTick: true,
  goldenTick: true,
} satisfies Prisma.UserSelect;

const postInclude = {
  [AUTHOR_RELATION]: { select: authorSelect },
  _count: { select: { comments: true } },
} satisfies Prisma.PostInclude;

type PostRow = Prisma.PostGetPayload<{ include: typeof postInclude }>;

const toAuthor = (
  user: Prisma.UserGetPayload<{ select: typeof authorSelect }> | null,
): PostAuthorView | null =>
  user === null
    ? null
    : Object.freeze({
        id: user.id,
        name: user.name,
        username: user.username,
        profilePicture: user.profilePicture,
        blueTick: user.blueTick,
        goldenTick: user.goldenTick,
      });

const toPostRecord = (row: PostRow): PostRecord =>
  Object.freeze({
    id: row.id,
    text: row.text,
    type: row.type,
    userId: row.userId,
    views: row.views,
    privacy: toJsonValue(row.privacy),
    likes: toJsonValue(row.likes),
    media: toJsonValue(row.media),
    engagement: toJsonValue(row.engagement),
    ad: toJsonValue(row.ad),
    status: row.status,
    isAnchored: row.isAnchored,
    nftTokenId: row.nftTokenId,
    contentUri: row.contentUri,
    originalPostId: row.originalPostId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    author: toAuthor(row[AUTHOR_RELATION]),
    commentsCount: row._count.comments,
  });

const stringList = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

/** Blocked entries have several historical shapes; all are read. */
const blockedIds = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry === 'string') return [entry];
    if (typeof entry !== 'object' || entry === null) return [];
    for (const key of ['user', 'userId', 'id']) {
      const candidate: unknown = Reflect.get(entry, key);
      if (typeof candidate === 'string') return [candidate];
    }
    return [];
  });
};

/** Only public posts are ever discoverable through explore. */
const publicPrivacy = {
  privacy: { path: ['level'], equals: 'public' },
} satisfies Prisma.PostWhereInput;

export const createExplorePrismaClient = (
  db: PrismaClient,
): ExplorePrismaClient => ({
  async readViewer(userId) {
    const row = await db.user.findUnique({
      where: { id: userId },
      select: {
        following: true,
        interests: true,
        blockedUsers: true,
        notInterested: true,
        communityMemberships: { select: { id: true } },
      },
    });
    if (row === null) return null;
    const muted = asJsonObject(toJsonValue(row.notInterested));
    return Object.freeze({
      followingIds: stringList(row.following),
      blockedUserIds: blockedIds(row.blockedUsers),
      notInterestedPostIds: stringList(muted.posts),
      notInterestedUserIds: stringList(muted.users),
      communityIds: row.communityMemberships.map((entry) => entry.id),
      interests: stringList(row.interests),
    });
  },

  async findPosts(query) {
    const rows = await db.post.findMany({
      where: {
        ...publicPrivacy,
        userId: { notIn: [...query.excludedUserIds] },
        ...(query.excludedPostIds.length > 0
          ? { id: { notIn: [...query.excludedPostIds] } }
          : {}),
        ...(query.createdAfter === null
          ? {}
          : { createdAt: { gte: query.createdAfter } }),
        ...(query.minimumViews === null
          ? {}
          : { views: { gte: query.minimumViews } }),
      },
      include: postInclude,
      orderBy:
        query.orderBy === 'views' ? { views: 'desc' } : { createdAt: 'desc' },
      skip: query.skip,
      take: query.take,
    });
    return Object.freeze(rows.map(toPostRecord));
  },

  async countPublicPosts(excludedUserIds) {
    return db.post.count({
      where: { ...publicPrivacy, userId: { notIn: [...excludedUserIds] } },
    });
  },

  async findSuggestedUsers(excludedUserIds, take) {
    const rows = await db.user.findMany({
      where: {
        id: { notIn: [...excludedUserIds] },
        OR: [{ blueTick: true }, { goldenTick: true }],
      },
      take,
      select: {
        id: true,
        username: true,
        name: true,
        profilePicture: true,
        bio: true,
        blueTick: true,
        goldenTick: true,
        followers: true,
      },
    });
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          id: row.id,
          username: row.username,
          name: row.name,
          profilePicture: row.profilePicture,
          bio: row.bio,
          blueTick: row.blueTick,
          goldenTick: row.goldenTick,
          followersCount: stringList(row.followers).length,
        }),
      ),
    );
  },

  async findActiveCommunities(excludedIds, take) {
    const rows = await db.community.findMany({
      where: {
        settings: { path: ['isPrivate'], equals: false },
        isActive: true,
        ...(excludedIds.length > 0 ? { id: { notIn: [...excludedIds] } } : {}),
      },
      orderBy: [{ memberCount: 'desc' }, { createdAt: 'desc' }],
      take,
      include: { users: { select: authorSelect } },
    });
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          id: row.id,
          name: row.name,
          description: row.description,
          memberCount: row.memberCount,
          settings: toJsonValue(row.settings),
          owner: toAuthor(row.users),
          createdAt: row.createdAt,
        }),
      ),
    );
  },

  async findLiveStreams(excludedHostIds, take) {
    const rows = await db.liveStream.findMany({
      where: {
        status: 'live',
        ...(excludedHostIds.length > 0
          ? { hostId: { notIn: [...excludedHostIds] } }
          : {}),
      },
      orderBy: [{ currentViewers: 'desc' }, { startedAt: 'desc' }],
      take,
      include: { user: { select: authorSelect } },
    });
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          id: row.id,
          title: row.title,
          status: row.status,
          // Legacy exposed this as `viewerCount`.
          viewerCount: row.currentViewers,
          hostId: row.hostId,
          host: toAuthor(row.user),
          startedAt: row.startedAt,
        }),
      ),
    );
  },
});
