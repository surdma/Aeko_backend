import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { SessionGuard } from '../../src/auth/guards/session/session.guard';
import { CommentsController } from '../../src/comments/comments.controller';
import { CommentsService } from '../../src/comments/comments.service';
import { PrismaService } from '../../src/database/prisma/prisma.service';

interface CommentRow {
  id: string;
  text: string;
  userId: string;
  postId: string;
  parentId: string | null;
  likes: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface PostRow {
  id: string;
  userId: string;
  privacy: unknown;
  engagement: unknown;
}

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
  email: 'ada@example.com',
  profilePicture: null,
  blueTick: false,
  goldenTick: false,
};

const asText = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const makeComment = (overrides: Partial<CommentRow>): CommentRow => ({
  id: 'comment-1',
  text: 'Nice post',
  userId: 'author',
  postId: 'post-public',
  parentId: null,
  likes: [],
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  ...overrides,
});

interface Harness {
  readonly service: CommentsService;
  readonly comments: Map<string, CommentRow>;
  readonly commentLikes: Set<string>;
  readonly transactionOptions: unknown[];
  blockedByAuthor: string[];
}

/**
 * The fakes filter nothing: every visibility and blocking decision under test
 * must be made by the service.
 */
const createHarness = (
  comments: readonly CommentRow[],
  posts: readonly PostRow[],
): Harness => {
  const commentStore = new Map(comments.map((row) => [row.id, row]));
  const postStore = new Map(posts.map((row) => [row.id, row]));
  const commentLikes = new Set<string>();
  const harness: Harness = {
    service: undefined as unknown as CommentsService,
    comments: commentStore,
    commentLikes,
    transactionOptions: [],
    blockedByAuthor: [],
  };

  const withAuthor = (row: CommentRow): unknown => ({
    ...row,
    user: author,
    replies: [...commentStore.values()]
      .filter((entry) => entry.parentId === row.id)
      .map((entry) => ({ ...entry, user: author })),
    _count: {
      replies: [...commentStore.values()].filter(
        (entry) => entry.parentId === row.id,
      ).length,
    },
  });

  let queue: Promise<unknown> = Promise.resolve();

  const commentDelegate = {
    create: ({ data }: { data: Record<string, unknown> }): Promise<unknown> => {
      const row = makeComment({
        id: `comment-${commentStore.size + 1}`,
        text: asText(data.text),
        userId: asText(data.userId),
        postId: asText(data.postId),
        parentId: typeof data.parentId === 'string' ? data.parentId : null,
      });
      commentStore.set(row.id, row);
      return Promise.resolve(withAuthor(row));
    },
    findUnique: ({ where }: { where: { id: string } }): Promise<unknown> => {
      const row = commentStore.get(where.id);
      return Promise.resolve(row === undefined ? null : withAuthor(row));
    },
    findMany: ({
      where,
      take,
    }: {
      where: { postId?: string; parentId?: string | null };
      take?: number;
    }): Promise<readonly unknown[]> => {
      const rows = [...commentStore.values()].filter((row) => {
        if (where.postId !== undefined && row.postId !== where.postId) {
          return false;
        }
        if (where.parentId === null && row.parentId !== null) return false;
        if (
          typeof where.parentId === 'string' &&
          row.parentId !== where.parentId
        ) {
          return false;
        }
        return true;
      });
      return Promise.resolve(
        rows.slice(0, take ?? rows.length).map(withAuthor),
      );
    },
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown> => {
      const row = commentStore.get(where.id);
      if (row === undefined) return Promise.reject(new Error('missing'));
      const next = { ...row, likes: data.likes ?? row.likes };
      commentStore.set(next.id, next);
      return Promise.resolve(withAuthor(next));
    },
    count: (): Promise<number> => Promise.resolve(commentStore.size),
  };

  const commentLikeDelegate = {
    upsert: ({
      where,
    }: {
      where: { userId_commentId: { userId: string; commentId: string } };
    }): Promise<unknown> => {
      commentLikes.add(
        `${where.userId_commentId.userId}:${where.userId_commentId.commentId}`,
      );
      return Promise.resolve({});
    },
    deleteMany: (): Promise<unknown> => Promise.resolve({}),
  };

  const toPostRow = (row: PostRow): unknown => ({
    id: row.id,
    text: '',
    type: 'text',
    userId: row.userId,
    views: 0,
    privacy: row.privacy,
    likes: [],
    media: '',
    engagement: row.engagement,
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

  const postDelegate = {
    findUnique: ({ where }: { where: { id: string } }): Promise<unknown> => {
      const row = postStore.get(where.id);
      return Promise.resolve(row === undefined ? null : toPostRow(row));
    },
    update: ({ where }: { where: { id: string } }): Promise<unknown> => {
      const row = postStore.get(where.id);
      if (row === undefined) return Promise.reject(new Error('missing post'));
      return Promise.resolve(toPostRow(row));
    },
  };

  const userDelegate = {
    findUnique: ({ where }: { where: { id: string } }): Promise<unknown> =>
      Promise.resolve(
        where.id === 'viewer'
          ? { following: [], blockedUsers: [], notInterested: { posts: [] } }
          : {
              following: [],
              blockedUsers: harness.blockedByAuthor,
              notInterested: { posts: [] },
            },
      ),
  };

  const db = {
    comment: commentDelegate,
    commentLike: commentLikeDelegate,
    post: postDelegate,
    user: userDelegate,
    $transaction: (operation: unknown, options: unknown): Promise<unknown> => {
      const run = queue.then(() => {
        harness.transactionOptions.push(options);
        if (typeof operation !== 'function')
          throw new Error('expected callback');
        return Reflect.apply(operation, undefined, [db]) as unknown;
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };

  return Object.assign(harness, {
    service: new CommentsService(
      new PrismaService(
        db as unknown as ConstructorParameters<typeof PrismaService>[0],
      ),
    ),
  });
};

const publicPost: PostRow = {
  id: 'post-public',
  userId: 'author',
  privacy: { level: 'public', selectedUsers: [] },
  engagement: {},
};

const privatePost: PostRow = {
  id: 'post-private',
  userId: 'author',
  privacy: { level: 'only_me', selectedUsers: [] },
  engagement: {},
};

describe('comments', () => {
  it('creates a top-level comment on a visible post', async () => {
    const harness = createHarness([], [publicPost]);
    const result = await harness.service.create(viewer, 'post-public', {
      text: 'Great read',
    });

    expect(result.comment.text).toBe('Great read');
    expect(result.comment.userId).toBe('viewer');
    expect(result.comment.parentId).toBeNull();
    expect(result.postCounts.totalComments).toBeGreaterThan(0);
  });

  it('refuses to comment on a post the viewer cannot see', async () => {
    const harness = createHarness([], [publicPost, privatePost]);

    await expect(
      harness.service.create(viewer, 'post-private', { text: 'Sneak' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      harness.service.create(viewer, 'missing', { text: 'Nope' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses to comment when the post author blocks the viewer', async () => {
    const harness = createHarness([], [publicPost]);
    harness.blockedByAuthor = ['viewer'];

    await expect(
      harness.service.create(viewer, 'post-public', { text: 'Hi' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('replies to an existing comment and inherits its post', async () => {
    const harness = createHarness([makeComment({})], [publicPost]);
    const reply = await harness.service.reply(viewer, 'comment-1', {
      text: 'Agreed',
    });

    expect(reply.parentId).toBe('comment-1');
    expect(reply.postId).toBe('post-public');
    await expect(
      harness.service.reply(viewer, 'missing', { text: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('likes a comment idempotently and dual-writes the relational row', async () => {
    const harness = createHarness([makeComment({})], [publicPost]);

    const first = await harness.service.like(viewer, 'comment-1');
    expect(first.likesCount).toBe(1);
    expect(first.isLiked).toBe(true);
    expect(harness.transactionOptions).toContainEqual({
      isolationLevel: 'Serializable',
    });
    expect(harness.commentLikes.has('viewer:comment-1')).toBe(true);

    // Legacy never unlikes: a repeat call is a no-op that still reports liked.
    const second = await harness.service.like(viewer, 'comment-1');
    expect(second.likesCount).toBe(1);
    expect(second.isLiked).toBe(true);
  });

  it('does not lose concurrent likes from different users', async () => {
    const harness = createHarness([makeComment({})], [publicPost]);
    await Promise.all([
      harness.service.like(viewer, 'comment-1'),
      harness.service.like({ ...viewer, userId: 'second' }, 'comment-1'),
    ]);

    const stored = harness.comments.get('comment-1');
    expect(Array.isArray(stored?.likes) ? stored.likes : []).toHaveLength(2);
  });

  it('lists top-level comments with replies and viewer like state', async () => {
    const harness = createHarness(
      [
        makeComment({ id: 'comment-1', likes: ['viewer'] }),
        makeComment({ id: 'comment-2', parentId: 'comment-1' }),
      ],
      [publicPost],
    );

    const listed = await harness.service.listForPost(viewer, 'post-public', {
      page: 1,
      limit: 20,
    });

    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe('comment-1');
    expect(listed[0]?.isLiked).toBe(true);
    expect(listed[0]?.likesCount).toBe(1);
    expect(listed[0]?.replies.map((reply) => reply.id)).toEqual(['comment-2']);
    expect(listed[0]).not.toHaveProperty('_count');
  });

  it('refuses to list comments on a post the viewer cannot see', async () => {
    const harness = createHarness(
      [makeComment({ postId: 'post-private' })],
      [publicPost, privatePost],
    );

    await expect(
      harness.service.listForPost(viewer, 'post-private', {
        page: 1,
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lists replies oldest first and bounds the page', async () => {
    const harness = createHarness(
      [
        makeComment({ id: 'comment-1' }),
        makeComment({
          id: 'comment-2',
          parentId: 'comment-1',
          createdAt: new Date('2026-08-02T00:00:00.000Z'),
        }),
        makeComment({
          id: 'comment-3',
          parentId: 'comment-1',
          createdAt: new Date('2026-08-03T00:00:00.000Z'),
        }),
      ],
      [publicPost],
    );

    const replies = await harness.service.listReplies(viewer, 'comment-1', {
      page: 1,
      limit: 1,
    });
    expect(replies).toHaveLength(1);
  });
});

describe('comment routes', () => {
  const reflector = new Reflector();
  const handlerOf = (method: string) => {
    const handler: unknown = Reflect.get(CommentsController.prototype, method);
    if (typeof handler !== 'function') {
      throw new Error(`CommentsController.${method} is missing`);
    }
    return handler;
  };

  it('registers the exact legacy comment routes', () => {
    expect(reflector.get<unknown>(PATH_METADATA, CommentsController)).toBe(
      'api/comments',
    );
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, CommentsController),
    ).toEqual([SessionGuard]);

    const routes = [
      ['create', ':postId', RequestMethod.POST],
      ['reply', 'reply/:commentId', RequestMethod.POST],
      ['like', 'like/:commentId', RequestMethod.POST],
      ['listReplies', 'replies/:commentId', RequestMethod.GET],
      ['listForPost', ':postId', RequestMethod.GET],
    ] as const;

    for (const [name, path, method] of routes) {
      expect(reflector.get<unknown>(PATH_METADATA, handlerOf(name))).toBe(path);
      expect(reflector.get<unknown>(METHOD_METADATA, handlerOf(name))).toBe(
        method,
      );
    }
  });

  it('declares the literal reply paths before the parametric ones', () => {
    const order = Object.getOwnPropertyNames(CommentsController.prototype)
      .filter((name) => name !== 'constructor')
      .flatMap((name) => {
        const handler: unknown = Reflect.get(
          CommentsController.prototype,
          name,
        );
        if (typeof handler !== 'function') return [];
        const path = reflector.get<unknown>(PATH_METADATA, handler);
        const method = reflector.get<unknown>(METHOD_METADATA, handler);
        return method === RequestMethod.GET && typeof path === 'string'
          ? [path]
          : [];
      });

    expect(order.indexOf('replies/:commentId')).toBeLessThan(
      order.indexOf(':postId'),
    );
  });
});
