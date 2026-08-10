import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { SessionGuard } from '../../src/auth/guards/session/session.guard';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { ExploreController } from '../../src/explore/explore.controller';
import { ExploreService } from '../../src/explore/explore.service';

const viewer: AuthenticatedPrincipal = {
  userId: 'viewer',
  email: 'viewer@example.com',
  username: 'viewer',
  isAdmin: false,
  banned: false,
  twoFactorEnabled: false,
  twoFactorSatisfied: false,
  sessionId: 'session-viewer',
};

const author = {
  id: 'author',
  name: 'Ada',
  username: 'ada',
  profilePicture: null,
  blueTick: true,
  goldenTick: false,
};

const postRow = (id: string, views: number): unknown => ({
  id,
  text: 'A post',
  type: 'text',
  userId: 'author',
  views,
  privacy: { level: 'public', selectedUsers: [] },
  likes: [],
  media: '',
  engagement: {},
  ad: null,
  status: 'active',
  isAnchored: false,
  nftTokenId: null,
  contentUri: null,
  originalPostId: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  users_posts_userIdTouser: author,
  _count: { comments: 0 },
});

interface Harness {
  readonly service: ExploreService;
  postWheres: unknown[];
  suggestedWhere: unknown;
  communityWhere: unknown;
  streamWhere: unknown;
  viewerRow: unknown;
}

const createHarness = (): Harness => {
  const harness: Harness = {
    service: undefined as unknown as ExploreService,
    postWheres: [],
    suggestedWhere: null,
    communityWhere: null,
    streamWhere: null,
    viewerRow: {
      following: ['followed'],
      interests: ['music'],
      blockedUsers: ['blocked'],
      notInterested: { posts: ['muted-post'], users: ['muted-user'] },
      communityMemberships: [{ id: 'community-mine' }],
    },
  };

  const db = {
    user: {
      findUnique: (): Promise<unknown> => Promise.resolve(harness.viewerRow),
      findMany: ({
        where,
      }: {
        where: unknown;
      }): Promise<readonly unknown[]> => {
        harness.suggestedWhere = where;
        return Promise.resolve([
          {
            id: 'popular',
            username: 'popular',
            name: 'Popular',
            profilePicture: null,
            bio: null,
            blueTick: true,
            goldenTick: false,
            followers: ['a', 'b', 'c'],
          },
          {
            id: 'quiet',
            username: 'quiet',
            name: 'Quiet',
            profilePicture: null,
            bio: null,
            blueTick: true,
            goldenTick: false,
            followers: ['a'],
          },
        ]);
      },
    },
    post: {
      findMany: ({
        where,
      }: {
        where: unknown;
      }): Promise<readonly unknown[]> => {
        harness.postWheres.push(where);
        return Promise.resolve([postRow('post-1', 100)]);
      },
      count: (): Promise<number> => Promise.resolve(42),
    },
    community: {
      findMany: ({
        where,
      }: {
        where: unknown;
      }): Promise<readonly unknown[]> => {
        harness.communityWhere = where;
        return Promise.resolve([
          {
            id: 'community-1',
            name: 'Builders',
            description: null,
            memberCount: 10,
            settings: { isPrivate: false },
            createdAt: new Date('2026-08-01T00:00:00.000Z'),
            users: author,
          },
        ]);
      },
    },
    liveStream: {
      findMany: ({
        where,
      }: {
        where: unknown;
      }): Promise<readonly unknown[]> => {
        harness.streamWhere = where;
        return Promise.resolve([
          {
            id: 'stream-1',
            title: 'Live now',
            status: 'live',
            currentViewers: 12,
            hostId: 'author',
            startedAt: new Date('2026-08-10T00:00:00.000Z'),
            user: author,
          },
        ]);
      },
    },
  };

  return Object.assign(harness, {
    service: new ExploreService(
      new PrismaService(
        db as unknown as ConstructorParameters<typeof PrismaService>[0],
      ),
    ),
  });
};

const readWhere = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null
    ? Reflect.get(value, key)
    : undefined;

const notIn = (value: unknown, key: string): readonly string[] => {
  const field = readWhere(value, key);
  const list = readWhere(field, 'notIn');
  return Array.isArray(list)
    ? list.filter((entry): entry is string => typeof entry === 'string')
    : [];
};

describe('explore', () => {
  it('returns all six legacy sections and the pagination envelope', async () => {
    const harness = createHarness();
    const result = await harness.service.feed(viewer, { page: 1, limit: 20 });

    expect(result.success).toBe(true);
    expect(Object.keys(result.data).sort()).toEqual([
      'communities',
      'forYou',
      'liveStreams',
      'suggestedUsers',
      'trending',
      'viral',
    ]);
    expect(result.pagination).toEqual({
      currentPage: 1,
      totalPages: 3,
      totalPosts: 42,
      hasMore: true,
    });
  });

  it('excludes self, blocked, and not-interested users from every post section', async () => {
    const harness = createHarness();
    await harness.service.feed(viewer, { page: 1, limit: 20 });

    for (const where of harness.postWheres) {
      const excluded = notIn(where, 'userId');
      expect(excluded).toContain('viewer');
      expect(excluded).toContain('blocked');
      expect(excluded).toContain('muted-user');
    }
  });

  it('keeps followed authors in trending but not in discovery sections', async () => {
    const harness = createHarness();
    await harness.service.feed(viewer, { page: 1, limit: 20 });

    // Trending is the first post query; the for-you discovery query excludes
    // people the viewer already follows.
    const trendingExcluded = notIn(harness.postWheres[0], 'userId');
    expect(trendingExcluded).not.toContain('followed');
    expect(notIn(harness.suggestedWhere, 'id')).toContain('followed');
  });

  it('hides posts the viewer marked not interested', async () => {
    const harness = createHarness();
    await harness.service.feed(viewer, { page: 1, limit: 20 });

    expect(notIn(harness.postWheres[0], 'id')).toContain('muted-post');
  });

  it('ranks suggested users by follower count and never marks them followed', async () => {
    const harness = createHarness();
    const result = await harness.service.feed(viewer, { page: 1, limit: 20 });

    expect(result.data.suggestedUsers.map((user) => user.id)).toEqual([
      'popular',
      'quiet',
    ]);
    expect(result.data.suggestedUsers[0]?.followersCount).toBe(3);
    expect(
      result.data.suggestedUsers.every((user) => user.isFollowing === false),
    ).toBe(true);
  });

  it('excludes communities the viewer already belongs to', async () => {
    const harness = createHarness();
    await harness.service.feed(viewer, { page: 1, limit: 20 });

    expect(notIn(harness.communityWhere, 'id')).toContain('community-mine');
  });

  it('maps the live stream viewer count to the legacy field name', async () => {
    const harness = createHarness();
    const result = await harness.service.feed(viewer, { page: 1, limit: 20 });

    expect(result.data.liveStreams[0]?.viewerCount).toBe(12);
    expect(result.data.liveStreams[0]).not.toHaveProperty('currentViewers');
    expect(notIn(harness.streamWhere, 'hostId')).toContain('blocked');
  });

  it('omits the for-you section when the viewer has no interests', async () => {
    const harness = createHarness();
    harness.viewerRow = {
      following: [],
      interests: [],
      blockedUsers: [],
      notInterested: {},
      communityMemberships: [],
    };

    const result = await harness.service.feed(viewer, { page: 1, limit: 20 });
    expect(result.data.forYou).toEqual([]);
  });

  it('reports a missing viewer rather than an empty feed', async () => {
    const harness = createHarness();
    harness.viewerRow = null;

    await expect(
      harness.service.feed(viewer, { page: 1, limit: 20 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('explore route', () => {
  const reflector = new Reflector();

  it('registers the exact legacy route behind a session', () => {
    expect(reflector.get<unknown>(PATH_METADATA, ExploreController)).toBe(
      'api/explore',
    );
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, ExploreController),
    ).toEqual([SessionGuard]);

    const handler: unknown = Reflect.get(ExploreController.prototype, 'feed');
    expect(typeof handler).toBe('function');
    if (typeof handler !== 'function') throw new Error('feed is missing');
    expect(reflector.get<unknown>(PATH_METADATA, handler)).toBe('/');
    expect(reflector.get<unknown>(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
  });
});
