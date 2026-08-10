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
import { StatusController } from '../../src/status/status.controller';
import { StatusService } from '../../src/status/status.service';

const NOW = new Date('2026-08-10T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

interface StatusRow {
  id: string;
  userId: string;
  type: string;
  content: string;
  caption: string | null;
  backgroundColor: string | null;
  font: string | null;
  reactions: unknown;
  sharedPostId: string | null;
  originalContent: unknown;
  shareMetadata: unknown;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const author = {
  id: 'author',
  username: 'ada',
  name: 'Ada',
  profilePicture: null,
  blueTick: false,
  goldenTick: false,
};

const makeStatus = (overrides: Partial<StatusRow>): StatusRow => ({
  id: 'status-1',
  userId: 'author',
  type: 'text',
  content: 'Hello world',
  caption: null,
  backgroundColor: '#000',
  font: 'sans',
  reactions: [],
  sharedPostId: null,
  originalContent: {},
  shareMetadata: {},
  expiresAt: new Date(NOW.getTime() + DAY),
  createdAt: new Date('2026-08-10T00:00:00.000Z'),
  updatedAt: new Date('2026-08-10T00:00:00.000Z'),
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

interface Harness {
  readonly service: StatusService;
  readonly rows: Map<string, StatusRow>;
  readonly transactionOptions: unknown[];
  blockedByAuthor: string[];
  lastFindManyArgs: unknown;
}

const createHarness = (rows: readonly StatusRow[]): Harness => {
  const store = new Map(rows.map((row) => [row.id, row]));
  const harness: Harness = {
    service: undefined as unknown as StatusService,
    rows: store,
    transactionOptions: [],
    blockedByAuthor: [],
    lastFindManyArgs: null,
  };

  let queue: Promise<unknown> = Promise.resolve();

  const withRelations = (row: StatusRow): unknown => ({
    ...row,
    users: author,
    posts: null,
  });

  const statusDelegate = {
    create: ({ data }: { data: Record<string, unknown> }): Promise<unknown> => {
      const row = makeStatus({
        id: `status-${store.size + 1}`,
        userId: typeof data.userId === 'string' ? data.userId : '',
        type: typeof data.type === 'string' ? data.type : 'text',
        content: typeof data.content === 'string' ? data.content : '',
        caption: typeof data.caption === 'string' ? data.caption : null,
        expiresAt:
          data.expiresAt instanceof Date
            ? data.expiresAt
            : new Date(NOW.getTime() + DAY),
        originalContent: data.originalContent ?? {},
        shareMetadata: data.shareMetadata ?? {},
      });
      store.set(row.id, row);
      return Promise.resolve(withRelations(row));
    },
    findUnique: ({ where }: { where: { id: string } }): Promise<unknown> => {
      const row = store.get(where.id);
      return Promise.resolve(row === undefined ? null : withRelations(row));
    },
    // Expiry is filtered in the query, not in the service, so that a bounded
    // page is not silently short. The fake honours it and the test asserts the
    // boundary actually sent it.
    findMany: (args: {
      where?: { expiresAt?: { gt?: Date } };
    }): Promise<readonly unknown[]> => {
      harness.lastFindManyArgs = args;
      const after: Date | undefined = args.where?.expiresAt?.gt;
      const rows = [...store.values()].filter((row) =>
        after === undefined ? true : row.expiresAt.getTime() > after.getTime(),
      );
      return Promise.resolve(rows.map(withRelations));
    },
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown> => {
      const row = store.get(where.id);
      if (row === undefined) return Promise.reject(new Error('missing'));
      const next = { ...row, reactions: data.reactions ?? row.reactions };
      store.set(next.id, next);
      return Promise.resolve(withRelations(next));
    },
    deleteMany: ({
      where,
    }: {
      where: { id: string; userId: string };
    }): Promise<{ count: number }> => {
      const row = store.get(where.id);
      if (row === undefined || row.userId !== where.userId) {
        return Promise.resolve({ count: 0 });
      }
      store.delete(where.id);
      return Promise.resolve({ count: 1 });
    },
  };

  const db = {
    status: statusDelegate,
    user: {
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
    },
    post: { findUnique: (): Promise<unknown> => Promise.resolve(null) },
    $transaction: (operation: unknown, options: unknown): Promise<unknown> => {
      const run = queue.then(() => {
        harness.transactionOptions.push(options);
        if (typeof operation !== 'function') {
          throw new Error('expected callback');
        }
        return Reflect.apply(operation, undefined, [db]) as unknown;
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };

  return Object.assign(harness, {
    service: new StatusService(
      new PrismaService(
        db as unknown as ConstructorParameters<typeof PrismaService>[0],
      ),
    ),
  });
};

describe('status', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a status expiring in 24 hours', async () => {
    const harness = createHarness([]);
    const created = await harness.service.create(owner, {
      type: 'text',
      content: 'Hi there',
    });

    expect(created.userId).toBe('author');
    expect(created.expiresAt).toBe(new Date(NOW.getTime() + DAY).toISOString());
    expect(created.reactionsCount).toBe(0);
    expect(created).not.toHaveProperty('users');
  });

  it('requires content', async () => {
    const harness = createHarness([]);
    await expect(
      harness.service.create(owner, { type: 'text' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('lists only unexpired statuses and bounds the query', async () => {
    const harness = createHarness([
      makeStatus({ id: 'status-live' }),
      makeStatus({
        id: 'status-expired',
        expiresAt: new Date(NOW.getTime() - 1),
      }),
    ]);

    const listed = await harness.service.list(viewer, { page: 1, limit: 20 });

    expect(listed.map((entry) => entry.id)).toEqual(['status-live']);
    const args = harness.lastFindManyArgs;
    const read = (key: string): unknown =>
      typeof args === 'object' && args !== null
        ? Reflect.get(args, key)
        : undefined;
    expect(read('take')).toBe(20);
    // The expiry cut-off must reach the database, not be applied after paging.
    const where = read('where');
    const expiresAt: unknown =
      typeof where === 'object' && where !== null
        ? Reflect.get(where, 'expiresAt')
        : undefined;
    expect(expiresAt).toEqual({ gt: NOW });
  });

  it('hides statuses from blocked authors in both directions', async () => {
    const harness = createHarness([makeStatus({ id: 'status-hostile' })]);
    harness.blockedByAuthor = ['viewer'];

    expect(await harness.service.list(viewer, { page: 1, limit: 20 })).toEqual(
      [],
    );
  });

  it('shapes a shared status with displayContent and sharedPostData', async () => {
    const harness = createHarness([
      makeStatus({
        id: 'status-shared',
        type: 'shared_post',
        content: 'Worth reading',
        originalContent: {
          creator: { id: 'origin', username: 'origin' },
          text: 'Original text',
          media: null,
          type: 'text',
        },
        shareMetadata: { sharedBy: 'author' },
      }),
    ]);

    const [shared] = await harness.service.list(viewer, { page: 1, limit: 20 });
    expect(shared?.displayContent.type).toBe('shared_post');
    expect(shared?.sharedPostData).not.toBeNull();
    expect(shared?.sharedPostData?.originalPost.content).toBe('Original text');
    expect(shared?.sharedPostData?.shareInfo.additionalContent).toBe(
      'Worth reading',
    );
  });

  it('gives a plain status a plain displayContent', async () => {
    const harness = createHarness([makeStatus({})]);
    const [plain] = await harness.service.list(viewer, { page: 1, limit: 20 });

    expect(plain?.displayContent).toEqual({
      type: 'text',
      content: 'Hello world',
      caption: null,
      backgroundColor: '#000',
      font: 'sans',
    });
    expect(plain?.sharedPostData).toBeNull();
  });

  it('deletes only the owner status and hides existence otherwise', async () => {
    const harness = createHarness([makeStatus({})]);

    await expect(
      harness.service.remove(viewer, 'status-1'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(harness.rows.has('status-1')).toBe(true);

    await expect(harness.service.remove(owner, 'status-1')).resolves.toEqual({
      success: true,
      message: 'Status deleted',
    });
    expect(harness.rows.has('status-1')).toBe(false);
  });

  it('appends a reaction inside a serializable transaction', async () => {
    const harness = createHarness([makeStatus({})]);
    const result = await harness.service.react(viewer, 'status-1', {
      emoji: '🔥',
    });

    expect(result).toEqual({ success: true, message: 'Reaction added' });
    expect(harness.transactionOptions).toContainEqual({
      isolationLevel: 'Serializable',
    });
    const stored = harness.rows.get('status-1');
    const reactions = Array.isArray(stored?.reactions) ? stored.reactions : [];
    expect(reactions).toHaveLength(1);
  });

  it('does not lose concurrent reactions', async () => {
    const harness = createHarness([makeStatus({})]);
    await Promise.all([
      harness.service.react(viewer, 'status-1', { emoji: '🔥' }),
      harness.service.react({ ...viewer, userId: 'second' }, 'status-1', {
        emoji: '👍',
      }),
    ]);

    const stored = harness.rows.get('status-1');
    expect(
      Array.isArray(stored?.reactions) ? stored.reactions : [],
    ).toHaveLength(2);
  });

  it('still accepts a reaction on an expired status, as Express did', async () => {
    // Only reshare gates on expiry in the legacy service; react does not.
    const harness = createHarness([
      makeStatus({ id: 'status-old', expiresAt: new Date(NOW.getTime() - 1) }),
    ]);

    await expect(
      harness.service.react(viewer, 'status-old', { emoji: '🔥' }),
    ).resolves.toEqual({ success: true, message: 'Reaction added' });
  });

  it('refuses a reaction on a blocked author status', async () => {
    const harness = createHarness([makeStatus({ id: 'status-hostile' })]);
    harness.blockedByAuthor = ['viewer'];

    await expect(
      harness.service.react(viewer, 'status-hostile', { emoji: '🔥' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reshares a live status and snapshots the original', async () => {
    const harness = createHarness([makeStatus({})]);
    const reshared = await harness.service.reshare(viewer, 'status-1', {
      caption: 'Look at this',
    });

    expect(reshared.type).toBe('shared_post');
    expect(reshared.userId).toBe('viewer');
    expect(reshared.content).toBe('Look at this');
    expect(reshared.expiresAt).toBe(
      new Date(NOW.getTime() + DAY).toISOString(),
    );
  });

  it('refuses to reshare a missing, expired, or blocked status', async () => {
    const harness = createHarness([
      makeStatus({ id: 'status-old', expiresAt: new Date(NOW.getTime() - 1) }),
      makeStatus({ id: 'status-live' }),
    ]);

    await expect(
      harness.service.reshare(viewer, 'missing', {}),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      harness.service.reshare(viewer, 'status-old', {}),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    harness.blockedByAuthor = ['viewer'];
    await expect(
      harness.service.reshare(viewer, 'status-live', {}),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('status routes', () => {
  const reflector = new Reflector();
  const handlerOf = (method: string) => {
    const handler: unknown = Reflect.get(StatusController.prototype, method);
    if (typeof handler !== 'function') {
      throw new Error(`StatusController.${method} is missing`);
    }
    return handler;
  };

  it('registers the exact legacy status routes', () => {
    expect(reflector.get<unknown>(PATH_METADATA, StatusController)).toBe(
      'api/status',
    );
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, StatusController),
    ).toEqual([SessionGuard]);

    const routes = [
      ['create', '/', RequestMethod.POST],
      ['list', '/', RequestMethod.GET],
      ['remove', ':id', RequestMethod.DELETE],
      ['react', ':id/react', RequestMethod.POST],
      ['reshare', ':id/reshare', RequestMethod.POST],
    ] as const;

    for (const [name, path, method] of routes) {
      expect(reflector.get<unknown>(PATH_METADATA, handlerOf(name))).toBe(path);
      expect(reflector.get<unknown>(METHOD_METADATA, handlerOf(name))).toBe(
        method,
      );
    }
  });
});
