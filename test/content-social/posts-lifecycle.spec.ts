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
import { PostsController } from '../../src/posts/posts.controller';
import { PostsService } from '../../src/posts/posts.service';

const NOW = new Date('2026-08-10T12:00:00.000Z');

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
  id: 'owner',
  name: 'Ada',
  username: 'ada',
  profilePicture: null,
  blueTick: true,
  goldenTick: false,
};

const makeRow = (overrides: Partial<Row>): Row => ({
  id: 'post-1',
  text: 'Original',
  type: 'text',
  userId: 'owner',
  views: 3,
  privacy: { level: 'public', selectedUsers: [] },
  likes: ['fan'],
  media: '',
  status: 'active',
  isAnchored: false,
  nftTokenId: null,
  contentUri: null,
  originalPostId: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  users_posts_userIdTouser: author,
  _count: { comments: 2 },
  ...overrides,
});

const owner: AuthenticatedPrincipal = {
  userId: 'owner',
  email: 'owner@example.com',
  username: 'ada',
  isAdmin: false,
  banned: false,
  twoFactorEnabled: false,
  twoFactorSatisfied: false,
  sessionId: 'session-owner',
};

const intruder: AuthenticatedPrincipal = {
  ...owner,
  userId: 'intruder',
  username: 'intruder',
};

const readObject = (input: unknown, key: string): unknown =>
  typeof input === 'object' && input !== null
    ? Reflect.get(input, key)
    : undefined;

const asText = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

const readWhereId = (input: unknown): string => {
  const id = readObject(readObject(input, 'where'), 'id');
  return typeof id === 'string' ? id : '';
};

interface Harness {
  readonly service: PostsService;
  readonly rows: Map<string, Row>;
  lastCreateData: unknown;
  lastUpdateData: unknown;
  deleted: string[];
}

const createHarness = (rows: readonly Row[]): Harness => {
  const store = new Map(rows.map((row) => [row.id, row]));
  const harness: Harness = {
    service: undefined as unknown as PostsService,
    rows: store,
    lastCreateData: null,
    lastUpdateData: null,
    deleted: [],
  };

  const postDelegate = {
    create: (input: unknown): Promise<Row> => {
      harness.lastCreateData = readObject(input, 'data');
      const data = readObject(input, 'data');
      const created = makeRow({
        id: 'post-created',
        text:
          typeof readObject(data, 'text') === 'string'
            ? String(readObject(data, 'text'))
            : '',
        type: asText(readObject(data, 'type'), 'text'),
        userId: asText(readObject(data, 'userId'), ''),
        privacy: readObject(data, 'privacy'),
        media: readObject(data, 'media'),
        likes: [],
        views: 0,
        _count: { comments: 0 },
      });
      store.set(created.id, created);
      return Promise.resolve(created);
    },
    findUnique: (input: unknown): Promise<Row | null> =>
      Promise.resolve(store.get(readWhereId(input)) ?? null),
    findMany: (): Promise<readonly Row[]> => Promise.resolve([]),
    count: (): Promise<number> => Promise.resolve(0),
    update: (input: unknown): Promise<Row> => {
      const existing = store.get(readWhereId(input));
      if (!existing) return Promise.reject(new Error('missing row'));
      const data = readObject(input, 'data');
      harness.lastUpdateData = data;
      const next: Row = {
        ...existing,
        text:
          typeof readObject(data, 'text') === 'string'
            ? String(readObject(data, 'text'))
            : existing.text,
        privacy: readObject(data, 'privacy') ?? existing.privacy,
      };
      store.set(next.id, next);
      return Promise.resolve(next);
    },
    delete: (input: unknown): Promise<Row> => {
      const existing = store.get(readWhereId(input));
      if (!existing) return Promise.reject(new Error('missing row'));
      harness.deleted.push(existing.id);
      store.delete(existing.id);
      return Promise.resolve(existing);
    },
  };

  const client = {
    $connect: (): Promise<void> => Promise.resolve(),
    $disconnect: (): Promise<void> => Promise.resolve(),
    $queryRaw: (): Promise<unknown> => Promise.resolve(1),
    post: postDelegate,
    user: {
      findUnique: (): Promise<unknown> =>
        Promise.resolve({
          following: [],
          blockedUsers: [],
          notInterested: { posts: [] },
        }),
    },
  };

  return Object.assign(harness, {
    service: new PostsService(new PrismaService(client)),
  });
};

describe('post lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a text post owned by the caller', async () => {
    const harness = createHarness([]);
    const created = await harness.service.create(
      owner,
      { type: 'text', text: 'Hello' },
      [],
    );

    expect(readObject(harness.lastCreateData, 'userId')).toBe('owner');
    expect(created.userId).toBe('owner');
    expect(created.privacy).toEqual({ level: 'public', selectedUsers: [] });
    expect(created.likesCount).toBe(0);
    expect(created.commentsCount).toBe(0);
    expect(created).not.toHaveProperty('users_posts_userIdTouser');
  });

  it('ignores a caller-supplied author and rejects unknown fields', async () => {
    const harness = createHarness([]);
    await expect(
      harness.service.create(
        owner,
        { type: 'text', text: 'Hi', userId: 'victim' },
        [],
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('requires media for image and video posts', async () => {
    const harness = createHarness([]);
    await expect(
      harness.service.create(owner, { type: 'image' }, []),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const created = await harness.service.create(owner, { type: 'image' }, [
      'https://cdn.example.com/a.png',
    ]);
    expect(created.mediaUrl).toBe('https://cdn.example.com/a.png');
    expect(created.mediaUrls).toEqual(['https://cdn.example.com/a.png']);
    expect(created.type).toBe('image');
  });

  it('stores one media path as a string and many as an array', async () => {
    const harness = createHarness([]);
    const many = await harness.service.create(owner, { type: 'image' }, [
      'https://cdn.example.com/a.png',
      'https://cdn.example.com/b.png',
    ]);
    expect(readObject(harness.lastCreateData, 'media')).toEqual([
      'https://cdn.example.com/a.png',
      'https://cdn.example.com/b.png',
    ]);
    expect(many.mediaUrls).toHaveLength(2);
  });

  it('updates only the owner text', async () => {
    const harness = createHarness([makeRow({})]);
    const updated = await harness.service.update(owner, 'post-1', {
      text: 'Revised',
    });

    expect(updated.text).toBe('Revised');
    expect(readObject(harness.lastUpdateData, 'userId')).toBeUndefined();
    await expect(
      harness.service.update(intruder, 'post-1', { text: 'Hijacked' }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(
      harness.service.update(owner, 'missing', { text: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('records privacy history when the level changes', async () => {
    const harness = createHarness([makeRow({})]);
    const updated = await harness.service.setPrivacy(owner, 'post-1', {
      privacy: 'select_users',
      selectedUsers: ['friend'],
    });

    expect(updated.privacy).toEqual({
      level: 'select_users',
      selectedUsers: ['friend'],
    });
    const written = readObject(harness.lastUpdateData, 'privacy');
    expect(readObject(written, 'level')).toBe('select_users');
    expect(readObject(written, 'updatedAt')).toBe(NOW.toISOString());
    const history = readObject(written, 'updateHistory');
    expect(Array.isArray(history)).toBe(true);
    expect(readObject((history as unknown[])[0], 'previousLevel')).toBe(
      'public',
    );
    expect(readObject((history as unknown[])[0], 'updatedBy')).toBe('owner');

    await expect(
      harness.service.setPrivacy(intruder, 'post-1', { privacy: 'only_me' }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });

  it('deletes only the owner post', async () => {
    const harness = createHarness([makeRow({})]);
    await expect(
      harness.service.remove(intruder, 'post-1'),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    expect(harness.deleted).toEqual([]);

    await expect(harness.service.remove(owner, 'post-1')).resolves.toEqual({
      deleted: true,
    });
    expect(harness.deleted).toEqual(['post-1']);
  });
});

describe('post lifecycle routes', () => {
  const reflector = new Reflector();
  const handlerOf = (method: string) => {
    const handler: unknown = Reflect.get(PostsController.prototype, method);
    if (typeof handler !== 'function') {
      throw new Error(`PostsController.${method} is missing`);
    }
    return handler;
  };

  it('registers the exact legacy lifecycle routes', () => {
    expect(reflector.get<unknown>(PATH_METADATA, PostsController)).toBe(
      'api/posts',
    );
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, PostsController),
    ).toEqual([SessionGuard]);

    expect(reflector.get<unknown>(PATH_METADATA, handlerOf('create'))).toBe(
      'create',
    );
    expect(reflector.get<unknown>(METHOD_METADATA, handlerOf('create'))).toBe(
      RequestMethod.POST,
    );
    expect(reflector.get<unknown>(PATH_METADATA, handlerOf('update'))).toBe(
      ':postId',
    );
    expect(reflector.get<unknown>(METHOD_METADATA, handlerOf('update'))).toBe(
      RequestMethod.PUT,
    );
    expect(reflector.get<unknown>(PATH_METADATA, handlerOf('setPrivacy'))).toBe(
      ':postId/privacy',
    );
    expect(reflector.get<unknown>(PATH_METADATA, handlerOf('remove'))).toBe(
      ':id',
    );
    expect(reflector.get<unknown>(METHOD_METADATA, handlerOf('remove'))).toBe(
      RequestMethod.DELETE,
    );
  });
});
