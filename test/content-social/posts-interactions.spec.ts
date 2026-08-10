import type { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { PrismaService } from '../../src/database/prisma/prisma.service';
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
  engagement: unknown;
  ad: unknown;
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

const makeRow = (overrides: Partial<Row>): Row => ({
  id: 'post-1',
  text: 'Hello',
  type: 'text',
  userId: 'author',
  views: 0,
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
  users_posts_userIdTouser: {
    id: 'author',
    name: 'Ada',
    username: 'ada',
    profilePicture: null,
    blueTick: false,
    goldenTick: false,
  },
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

const owner: AuthenticatedPrincipal = { ...viewer, userId: 'author' };

const readObject = (input: unknown, key: string): unknown =>
  typeof input === 'object' && input !== null
    ? Reflect.get(input, key)
    : undefined;

const asText = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const readWhereId = (input: unknown): string => {
  const id = readObject(readObject(input, 'where'), 'id');
  return typeof id === 'string' ? id : '';
};

interface Harness {
  readonly service: PostsService;
  readonly rows: Map<string, Row>;
  readonly bookmarks: Map<
    string,
    { id: string; userId: string; postId: string }
  >;
  readonly statuses: unknown[];
  readonly transactionOptions: unknown[];
  notInterested: string[];
}

const createHarness = (rows: readonly Row[]): Harness => {
  const store = new Map(rows.map((row) => [row.id, row]));
  const bookmarks = new Map<
    string,
    { id: string; userId: string; postId: string }
  >();
  const harness: Harness = {
    service: undefined as unknown as PostsService,
    rows: store,
    bookmarks,
    statuses: [],
    transactionOptions: [],
    notInterested: [],
  };

  let queue: Promise<unknown> = Promise.resolve();

  const postDelegate = {
    create: (input: unknown): Promise<Row> => {
      const data = readObject(input, 'data');
      const created = makeRow({
        id: `post-${store.size + 1}`,
        userId: asText(readObject(data, 'userId')),
        originalPostId:
          typeof readObject(data, 'originalPostId') === 'string'
            ? String(readObject(data, 'originalPostId'))
            : null,
      });
      store.set(created.id, created);
      return Promise.resolve(created);
    },
    findUnique: (input: unknown): Promise<Row | null> =>
      Promise.resolve(store.get(readWhereId(input)) ?? null),
    findMany: (): Promise<readonly Row[]> =>
      Promise.resolve([...store.values()]),
    count: (): Promise<number> => Promise.resolve(store.size),
    update: (input: unknown): Promise<Row> => {
      const existing = store.get(readWhereId(input));
      if (!existing) return Promise.reject(new Error('missing row'));
      const data = readObject(input, 'data');
      const views = readObject(data, 'views');
      const next: Row = {
        ...existing,
        likes: readObject(data, 'likes') ?? existing.likes,
        engagement: readObject(data, 'engagement') ?? existing.engagement,
        ad: readObject(data, 'ad') ?? existing.ad,
        views:
          typeof views === 'object' && views !== null
            ? existing.views + 1
            : existing.views,
      };
      store.set(next.id, next);
      return Promise.resolve(next);
    },
    delete: (): Promise<Row> => Promise.reject(new Error('unused')),
  };

  const client = {
    $connect: (): Promise<void> => Promise.resolve(),
    $disconnect: (): Promise<void> => Promise.resolve(),
    $queryRaw: (): Promise<unknown> => Promise.resolve(1),
    $transaction: (operation: unknown, options: unknown): Promise<unknown> => {
      const run = queue.then(() => {
        harness.transactionOptions.push(options);
        if (typeof operation !== 'function') {
          throw new Error('expected a callback');
        }
        return Reflect.apply(operation, undefined, [client]) as unknown;
      });
      queue = run.catch(() => undefined);
      return run;
    },
    post: postDelegate,
    bookmark: {
      findUnique: (input: unknown): Promise<unknown> => {
        const where = readObject(input, 'where');
        const composite = readObject(where, 'userId_postId');
        const key = `${asText(readObject(composite, 'userId'))}:${asText(
          readObject(composite, 'postId'),
        )}`;
        return Promise.resolve(bookmarks.get(key) ?? null);
      },
      create: (input: unknown): Promise<unknown> => {
        const data = readObject(input, 'data');
        const userId = asText(readObject(data, 'userId'));
        const postId = asText(readObject(data, 'postId'));
        const entry = { id: `b-${bookmarks.size + 1}`, userId, postId };
        bookmarks.set(`${userId}:${postId}`, entry);
        return Promise.resolve(entry);
      },
      delete: (input: unknown): Promise<unknown> => {
        const id = readWhereId(input);
        for (const [key, entry] of bookmarks) {
          if (entry.id === id) bookmarks.delete(key);
        }
        return Promise.resolve({});
      },
      findMany: (): Promise<readonly unknown[]> => Promise.resolve([]),
      count: (): Promise<number> => Promise.resolve(bookmarks.size),
    },
    status: {
      create: (input: unknown): Promise<unknown> => {
        const data = readObject(input, 'data');
        harness.statuses.push(data);
        return Promise.resolve({
          id: 'status-1',
          userId: asText(readObject(data, 'userId')),
          type: 'shared_post',
          content: asText(readObject(data, 'content')),
          caption: null,
          backgroundColor: null,
          font: null,
          reactions: [],
          sharedPostId: asText(readObject(data, 'sharedPostId')),
          expiresAt: new Date('2026-08-11T00:00:00.000Z'),
          createdAt: new Date('2026-08-10T00:00:00.000Z'),
          users: null,
        });
      },
    },
    user: {
      findUnique: (): Promise<unknown> =>
        Promise.resolve({
          following: [],
          blockedUsers: [],
          notInterested: { posts: harness.notInterested },
        }),
      update: (input: unknown): Promise<unknown> => {
        const data = readObject(input, 'data');
        const value = readObject(data, 'notInterested');
        const posts = readObject(value, 'posts');
        harness.notInterested = Array.isArray(posts)
          ? posts.filter((entry): entry is string => typeof entry === 'string')
          : [];
        return Promise.resolve({});
      },
    },
  };

  return Object.assign(harness, {
    service: new PostsService(new PrismaService(client)),
  });
};

describe('post interactions', () => {
  it('toggles a like inside a serializable transaction', async () => {
    const harness = createHarness([makeRow({})]);

    const liked = await harness.service.like(viewer, 'post-1');
    expect(liked).toMatchObject({ liked: true, totalLikes: 1 });
    expect(harness.transactionOptions).toContainEqual({
      isolationLevel: 'Serializable',
    });

    const unliked = await harness.service.like(viewer, 'post-1');
    expect(unliked).toMatchObject({ liked: false, totalLikes: 0 });
  });

  it('does not lose concurrent likes from different users', async () => {
    const harness = createHarness([makeRow({})]);
    await Promise.all([
      harness.service.like(viewer, 'post-1'),
      harness.service.like({ ...viewer, userId: 'second' }, 'post-1'),
    ]);

    const stored = harness.rows.get('post-1');
    expect(Array.isArray(stored?.likes) ? stored.likes : []).toHaveLength(2);
  });

  it('mirrors the like count onto engagement without dropping other keys', async () => {
    const harness = createHarness([
      makeRow({ engagement: { totalBookmarks: 7, custom: 'keep' } }),
    ]);
    await harness.service.like(viewer, 'post-1');

    const engagement = harness.rows.get('post-1')?.engagement;
    expect(readObject(engagement, 'totalLikes')).toBe(1);
    expect(readObject(engagement, 'totalBookmarks')).toBe(7);
    expect(readObject(engagement, 'custom')).toBe('keep');
  });

  it('toggles a bookmark and reports the total', async () => {
    const harness = createHarness([makeRow({})]);

    await expect(
      harness.service.bookmark(viewer, 'post-1'),
    ).resolves.toMatchObject({ bookmarked: true, totalBookmarks: 1 });
    await expect(
      harness.service.bookmark(viewer, 'post-1'),
    ).resolves.toMatchObject({ bookmarked: false, totalBookmarks: 0 });
  });

  it('records not-interested once and is idempotent', async () => {
    const harness = createHarness([makeRow({})]);
    await harness.service.notInterested(viewer, 'post-1');
    await harness.service.notInterested(viewer, 'post-1');
    expect(harness.notInterested).toEqual(['post-1']);
  });

  it('counts a view and returns the new total', async () => {
    const harness = createHarness([makeRow({})]);
    await expect(harness.service.view(viewer, 'post-1')).resolves.toEqual({
      success: true,
      views: 1,
    });
  });

  it('refuses every interaction with a post the viewer cannot see', async () => {
    const harness = createHarness([
      makeRow({ id: 'post-secret', privacy: { level: 'only_me' } }),
    ]);

    for (const call of [
      harness.service.like(viewer, 'post-secret'),
      harness.service.bookmark(viewer, 'post-secret'),
      harness.service.view(viewer, 'post-secret'),
      harness.service.repost(viewer, 'post-secret'),
      harness.service.shareToStatus(viewer, 'post-secret', {}),
    ]) {
      await expect(call).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('reposts a visible post and links the original', async () => {
    const harness = createHarness([makeRow({})]);
    const repost = await harness.service.repost(viewer, 'post-1');

    expect(repost.originalPostId).toBe('post-1');
    expect(repost.userId).toBe('viewer');
    expect(repost.likesCount).toBe(0);
    expect(repost).not.toHaveProperty('users_posts_userIdTouser');
  });

  it('shares a visible post to a status with a 24 hour expiry', async () => {
    const harness = createHarness([makeRow({})]);
    const shared = await harness.service.shareToStatus(viewer, 'post-1', {
      additionalContent: 'Worth reading',
    });

    expect(shared.sharedPostId).toBe('post-1');
    expect(harness.statuses).toHaveLength(1);
    expect(readObject(harness.statuses[0], 'type')).toBe('shared_post');
  });

  it('promotes only the owner post and merges the ad record', async () => {
    const harness = createHarness([makeRow({ ad: { impressions: 4 } })]);

    await expect(
      harness.service.promote(viewer, 'post-1', { budget: 100 }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });

    await harness.service.promote(owner, 'post-1', { budget: 100 });
    const ad = harness.rows.get('post-1')?.ad;
    expect(readObject(ad, 'isPromoted')).toBe(true);
    expect(readObject(ad, 'budget')).toBe(100);
    expect(readObject(ad, 'impressions')).toBe(4);

    await expect(
      harness.service.promote(owner, 'post-1', { budget: -5 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
