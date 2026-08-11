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
import { SpacesController } from '../../src/spaces/spaces.controller';
import { SpacesService } from '../../src/spaces/spaces.service';

interface Row {
  id: string;
  title: string;
  hostId: string;
  participants: unknown;
  highlights: unknown;
  isLive: boolean;
  createdAt: Date;
}

const host = {
  id: 'host',
  name: 'Ada',
  username: 'ada',
  profilePicture: null,
  blueTick: false,
  goldenTick: false,
};

const makeRow = (overrides: Partial<Row>): Row => ({
  id: 'space-1',
  title: 'Morning room',
  hostId: 'host',
  participants: [],
  highlights: [],
  isLive: true,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  ...overrides,
});

const owner: AuthenticatedPrincipal = {
  userId: 'host',
  email: 'host@example.com',
  username: 'ada',
  isAdmin: false,
  banned: false,
  twoFactorEnabled: false,
  twoFactorSatisfied: false,
  sessionId: 'session-host',
};

const stranger: AuthenticatedPrincipal = { ...owner, userId: 'stranger' };
// An administrator is still not the host: spaces are host-only by design.
const admin: AuthenticatedPrincipal = { ...stranger, isAdmin: true };

interface Harness {
  readonly service: SpacesService;
  readonly rows: Map<string, Row>;
  readonly transactionOptions: unknown[];
  updates: number;
}

const createHarness = (rows: readonly Row[]): Harness => {
  const store = new Map(rows.map((row) => [row.id, row]));
  const harness: Harness = {
    service: undefined as unknown as SpacesService,
    rows: store,
    transactionOptions: [],
    updates: 0,
  };

  let queue: Promise<unknown> = Promise.resolve();
  const withHost = (row: Row): unknown => ({ ...row, user: host });

  const delegate = {
    create: ({ data }: { data: Record<string, unknown> }): Promise<unknown> => {
      const row = makeRow({
        id: `space-${store.size + 1}`,
        title: typeof data.title === 'string' ? data.title : '',
        hostId: typeof data.hostId === 'string' ? data.hostId : '',
        participants: data.participants ?? [],
        isLive: data.isLive === true,
      });
      store.set(row.id, row);
      return Promise.resolve(withHost(row));
    },
    findUnique: ({ where }: { where: { id: string } }): Promise<unknown> => {
      const row = store.get(where.id);
      return Promise.resolve(row === undefined ? null : withHost(row));
    },
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown> => {
      harness.updates += 1;
      const row = store.get(where.id);
      if (row === undefined) return Promise.reject(new Error('missing'));
      const next: Row = {
        ...row,
        highlights: data.highlights ?? row.highlights,
        isLive: typeof data.isLive === 'boolean' ? data.isLive : row.isLive,
      };
      store.set(next.id, next);
      return Promise.resolve(withHost(next));
    },
  };

  const db = {
    space: delegate,
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
    service: new SpacesService(
      new PrismaService(
        db as unknown as ConstructorParameters<typeof PrismaService>[0],
      ),
    ),
  });
};

const highlights = (row: Row | undefined): readonly unknown[] =>
  Array.isArray(row?.highlights) ? row.highlights : [];

describe('spaces', () => {
  it('creates a live space hosted by the caller', async () => {
    const harness = createHarness([]);
    const result = await harness.service.create(owner, {
      title: 'Morning room',
    });

    expect(result.success).toBe(true);
    expect(result.space.hostId).toBe('host');
    expect(result.space.isLive).toBe(true);
  });

  it('lets only the host end, and stays idempotent', async () => {
    const harness = createHarness([makeRow({})]);

    await expect(
      harness.service.end(stranger, 'space-1'),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });

    await expect(harness.service.end(owner, 'space-1')).resolves.toMatchObject({
      success: true,
      space: expect.objectContaining({ isLive: false }) as unknown,
    });
    const afterFirst = harness.updates;

    // Ending an already-ended space succeeds without a second write.
    await expect(harness.service.end(owner, 'space-1')).resolves.toMatchObject({
      success: true,
    });
    expect(harness.updates).toBe(afterFirst);
  });

  it('lets only the host add a highlight', async () => {
    const harness = createHarness([makeRow({})]);

    // Legacy performed no authorization here at all.
    await expect(
      harness.service.addHighlight(stranger, 'space-1', {
        videoUrl: 'https://cdn.example.com/h.mp4',
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    // Being an administrator does not make you the host.
    await expect(
      harness.service.addHighlight(admin, 'space-1', {
        videoUrl: 'https://cdn.example.com/h.mp4',
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    expect(highlights(harness.rows.get('space-1'))).toHaveLength(0);
  });

  it('appends a highlight transactionally, keeping the existing ones', async () => {
    const harness = createHarness([
      makeRow({
        highlights: [{ videoUrl: 'https://cdn.example.com/old.mp4' }],
      }),
    ]);

    const result = await harness.service.addHighlight(owner, 'space-1', {
      videoUrl: 'https://cdn.example.com/new.mp4',
    });

    expect(result.success).toBe(true);
    const stored = highlights(harness.rows.get('space-1'));
    expect(stored).toHaveLength(2);
    expect(stored[1]).toMatchObject({
      videoUrl: 'https://cdn.example.com/new.mp4',
    });
    expect(harness.transactionOptions).toContainEqual({
      isolationLevel: 'Serializable',
    });
  });

  it('does not lose concurrent highlights', async () => {
    const harness = createHarness([makeRow({})]);
    await Promise.all([
      harness.service.addHighlight(owner, 'space-1', {
        videoUrl: 'https://cdn.example.com/1.mp4',
      }),
      harness.service.addHighlight(owner, 'space-1', {
        videoUrl: 'https://cdn.example.com/2.mp4',
      }),
    ]);

    expect(highlights(harness.rows.get('space-1'))).toHaveLength(2);
  });

  it('reports a missing space rather than acting on nothing', async () => {
    const harness = createHarness([]);
    await expect(harness.service.end(owner, 'ghost')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      harness.service.addHighlight(owner, 'ghost', {
        videoUrl: 'https://cdn.example.com/h.mp4',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('space routes', () => {
  const reflector = new Reflector();
  const handlerOf = (method: string) => {
    const handler: unknown = Reflect.get(SpacesController.prototype, method);
    if (typeof handler !== 'function') {
      throw new Error(`SpacesController.${method} is missing`);
    }
    return handler;
  };

  it('registers the exact three legacy routes behind a session', () => {
    expect(reflector.get<unknown>(PATH_METADATA, SpacesController)).toBe(
      'api/spaces',
    );
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, SpacesController),
    ).toEqual([SessionGuard]);

    const routes = [
      ['create', 'create', RequestMethod.POST],
      ['end', ':spaceId/end', RequestMethod.PATCH],
      ['addHighlight', ':spaceId/highlight', RequestMethod.PUT],
    ] as const;

    for (const [name, path, method] of routes) {
      expect(reflector.get<unknown>(PATH_METADATA, handlerOf(name))).toBe(path);
      expect(reflector.get<unknown>(METHOD_METADATA, handlerOf(name))).toBe(
        method,
      );
    }
  });
});
