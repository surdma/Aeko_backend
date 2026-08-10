import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { PostsController } from '../../src/posts/posts.controller';
import { PostsService } from '../../src/posts/posts.service';

interface Row {
  readonly id: string;
  text: string | null;
  type: string;
  userId: string;
  views: number;
  privacy: unknown;
  likes: unknown;
  media: unknown;
  status: string;
  isAnchored: boolean;
  nftTokenId: string | null;
  contentUri: string | null;
  originalPostId: string | null;
  createdAt: Date;
  updatedAt: Date;
  users_posts_userIdTouser: unknown;
  _count: { comments: number };
}

const author = {
  id: 'author',
  name: 'Ada',
  username: 'ada',
  profilePicture: null,
  blueTick: false,
  goldenTick: false,
};

const makeRow = (overrides: Partial<Row>): Row => ({
  id: 'post-public',
  text: 'Public post',
  type: 'text',
  userId: 'author',
  views: 0,
  privacy: { level: 'public', selectedUsers: [] },
  likes: [],
  media: '',
  status: 'active',
  isAnchored: false,
  nftTokenId: null,
  contentUri: null,
  originalPostId: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  users_posts_userIdTouser: author,
  _count: { comments: 0 },
  ...overrides,
});

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

const readObject = (input: unknown, key: string): unknown =>
  typeof input === 'object' && input !== null
    ? Reflect.get(input, key)
    : undefined;

const readWhereId = (input: unknown): string => {
  const id = readObject(readObject(input, 'where'), 'id');
  return typeof id === 'string' ? id : '';
};

interface Harness {
  readonly service: PostsService;
  readonly rows: Map<string, Row>;
  viewIncrements: string[];
  blockedByAuthor: string[];
}

/**
 * The fake applies no where-clause filtering: every visibility decision under
 * test must therefore be made by the service, not by the query.
 */
const createHarness = (rows: readonly Row[]): Harness => {
  const store = new Map(rows.map((row) => [row.id, row]));
  const harness: Harness = {
    service: undefined as unknown as PostsService,
    rows: store,
    viewIncrements: [],
    blockedByAuthor: [],
  };

  const postDelegate = {
    create: (): Promise<Row> => Promise.reject(new Error('unused')),
    findUnique: (input: unknown): Promise<Row | null> =>
      Promise.resolve(store.get(readWhereId(input)) ?? null),
    findMany: (): Promise<readonly Row[]> =>
      Promise.resolve(
        [...store.values()].sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
        ),
      ),
    count: (): Promise<number> => Promise.resolve(store.size),
    update: (input: unknown): Promise<Row> => {
      const existing = store.get(readWhereId(input));
      if (!existing) return Promise.reject(new Error('missing row'));
      harness.viewIncrements.push(existing.id);
      const next = { ...existing, views: existing.views + 1 };
      store.set(next.id, next);
      return Promise.resolve(next);
    },
    delete: (): Promise<Row> => Promise.reject(new Error('unused')),
  };

  const client = {
    $connect: (): Promise<void> => Promise.resolve(),
    $disconnect: (): Promise<void> => Promise.resolve(),
    $queryRaw: (): Promise<unknown> => Promise.resolve(1),
    post: postDelegate,
    bookmark: {
      findMany: (): Promise<readonly unknown[]> =>
        Promise.resolve([{ post: makeRow({ id: 'post-bookmarked' }) }]),
      count: (): Promise<number> => Promise.resolve(1),
    },
    user: {
      findUnique: (input: unknown): Promise<unknown> => {
        const id = readWhereId(input);
        if (id === 'viewer') {
          return Promise.resolve({
            following: ['followed'],
            blockedUsers: ['blocked-author'],
            notInterested: { posts: ['post-muted'] },
          });
        }
        return Promise.resolve({
          following: [],
          blockedUsers: harness.blockedByAuthor,
          notInterested: { posts: [] },
        });
      },
    },
  };

  return Object.assign(harness, {
    service: new PostsService(new PrismaService(client)),
  });
};

describe('post reads', () => {
  it('hides a private post from a non-follower who knows its id', async () => {
    const harness = createHarness([
      makeRow({ id: 'post-private', privacy: { level: 'only_me' } }),
    ]);

    await expect(
      harness.service.byId(viewer, 'post-private'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(harness.viewIncrements).toEqual([]);
  });

  it('hides a followers-only post until the viewer follows the author', async () => {
    const harness = createHarness([
      makeRow({
        id: 'post-followers',
        userId: 'followed',
        privacy: { level: 'followers' },
      }),
      makeRow({
        id: 'post-strangers',
        userId: 'stranger',
        privacy: { level: 'followers' },
      }),
    ]);

    await expect(
      harness.service.byId(viewer, 'post-followers'),
    ).resolves.toMatchObject({ id: 'post-followers' });
    await expect(
      harness.service.byId(viewer, 'post-strangers'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('hides a post whose author the viewer blocked, and the reverse', async () => {
    const harness = createHarness([
      makeRow({ id: 'post-blocked', userId: 'blocked-author' }),
      makeRow({ id: 'post-blocker', userId: 'hostile' }),
    ]);
    harness.blockedByAuthor = ['viewer'];

    await expect(
      harness.service.byId(viewer, 'post-blocked'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      harness.service.byId(viewer, 'post-blocker'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('increments views exactly once for a visible post', async () => {
    const harness = createHarness([makeRow({})]);
    const post = await harness.service.byId(viewer, 'post-public');

    expect(harness.viewIncrements).toEqual(['post-public']);
    expect(post.views).toBe(1);
  });

  it('filters the feed by visibility and not-interested', async () => {
    const harness = createHarness([
      makeRow({ id: 'post-public' }),
      makeRow({ id: 'post-muted' }),
      makeRow({ id: 'post-blocked', userId: 'blocked-author' }),
      makeRow({ id: 'post-secret', privacy: { level: 'only_me' } }),
    ]);

    const feed = await harness.service.feed(viewer);
    expect(feed.map((post) => post.id)).toEqual(['post-public']);
  });

  it('applies visibility to search, reposts, mixed, and videos', async () => {
    const harness = createHarness([
      makeRow({ id: 'post-public', type: 'video', media: 'https://c/v.mp4' }),
      makeRow({ id: 'post-secret', privacy: { level: 'only_me' } }),
    ]);

    expect(
      (
        await harness.service.search(viewer, { q: 'post', page: 1, limit: 20 })
      ).map((post) => post.id),
    ).toEqual(['post-public']);
    expect(
      (await harness.service.reposts(viewer, 'origin')).map((post) => post.id),
    ).toEqual(['post-public']);
    expect(
      (await harness.service.mixed(viewer)).map((post) => post.id),
    ).toEqual(['post-public']);
    expect(
      (await harness.service.videos(viewer, {})).map((post) => post.id),
    ).toEqual(['post-public']);
  });

  it('applies a cloudinary effect to videos only when requested', async () => {
    const harness = createHarness([
      makeRow({
        id: 'post-public',
        type: 'video',
        media: 'https://res.cloudinary.com/demo/video/upload/v1/clip.mp4',
      }),
    ]);

    const plain = await harness.service.videos(viewer, {});
    expect(plain[0]?.mediaUrl).toBe(
      'https://res.cloudinary.com/demo/video/upload/v1/clip.mp4',
    );
    const grey = await harness.service.videos(viewer, { effect: 'grayscale' });
    expect(grey[0]?.mediaUrl).toBe(
      'https://res.cloudinary.com/demo/video/upload/e_grayscale/v1/clip.mp4',
    );
  });

  it('returns the legacy pagination envelope for paged lists', async () => {
    const harness = createHarness([makeRow({})]);
    const page = await harness.service.byUser(viewer, 'author', {
      page: 1,
      limit: 20,
    });

    expect(page.pagination).toEqual({
      total: 1,
      page: 1,
      pages: 1,
      limit: 20,
    });
    expect(page.posts.map((post) => post.id)).toEqual(['post-public']);

    const bookmarks = await harness.service.bookmarks(viewer, {
      page: 1,
      limit: 20,
    });
    expect(bookmarks.posts.map((post) => post.id)).toEqual(['post-bookmarked']);

    const liked = await harness.service.liked(viewer, { page: 1, limit: 20 });
    expect(liked.pagination.limit).toBe(20);
  });
});

describe('post read routes', () => {
  const reflector = new Reflector();
  const routes = Object.getOwnPropertyNames(PostsController.prototype)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const handler: unknown = Reflect.get(PostsController.prototype, name);
      if (typeof handler !== 'function') return [];
      return [
        {
          name,
          path: reflector.get<unknown>(PATH_METADATA, handler),
          method: reflector.get<unknown>(METHOD_METADATA, handler),
        },
      ];
    });

  it('registers every literal read path before the parametric one', () => {
    const order = routes
      .filter((route) => route.method === RequestMethod.GET)
      .map((route) => route.path);

    for (const literal of [
      'feed',
      'search',
      'mixed',
      'videos',
      'user/bookmarks',
      'user/liked',
      'user/:userId',
    ]) {
      expect(order.indexOf(literal)).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(literal)).toBeLessThan(order.indexOf(':postId'));
    }
  });

  it('registers the reposts path', () => {
    expect(routes.find((route) => route.name === 'reposts')?.path).toBe(
      ':postId/reposts',
    );
  });
});
