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
import { ChallengesController } from '../../src/challenges/challenges.controller';
import { ChallengesService } from '../../src/challenges/challenges.service';

interface Row {
  id: string;
  creatorId: string;
  videoUrl: string;
  participants: unknown;
  votes: unknown;
  status: string;
  winner: string | null;
  endReason: string | null;
  endedAt: Date | null;
  createdAt: Date;
}

const creator = {
  id: 'creator',
  name: 'Ada',
  username: 'ada',
  profilePicture: null,
  blueTick: false,
  goldenTick: false,
};

const makeRow = (overrides: Partial<Row>): Row => ({
  id: 'challenge-1',
  creatorId: 'creator',
  videoUrl: 'https://cdn.example.com/a.mp4',
  participants: [],
  votes: [],
  status: 'active',
  winner: null,
  endReason: null,
  endedAt: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  ...overrides,
});

const owner: AuthenticatedPrincipal = {
  userId: 'creator',
  email: 'creator@example.com',
  username: 'ada',
  isAdmin: false,
  banned: false,
  twoFactorEnabled: false,
  twoFactorSatisfied: false,
  sessionId: 'session-creator',
};

const voter: AuthenticatedPrincipal = { ...owner, userId: 'voter' };
const admin: AuthenticatedPrincipal = { ...voter, isAdmin: true };

interface Harness {
  readonly service: ChallengesService;
  readonly rows: Map<string, Row>;
  readonly transactionOptions: unknown[];
  userQueries: number;
  lastInclude: unknown;
}

const createHarness = (rows: readonly Row[]): Harness => {
  const store = new Map(rows.map((row) => [row.id, row]));
  const harness: Harness = {
    service: undefined as unknown as ChallengesService,
    rows: store,
    transactionOptions: [],
    userQueries: 0,
    lastInclude: null,
  };

  let queue: Promise<unknown> = Promise.resolve();
  const withCreator = (row: Row): unknown => ({ ...row, user: creator });

  const delegate = {
    create: ({ data }: { data: Record<string, unknown> }): Promise<unknown> => {
      const row = makeRow({
        id: `challenge-${store.size + 1}`,
        creatorId: typeof data.creatorId === 'string' ? data.creatorId : '',
        videoUrl: typeof data.videoUrl === 'string' ? data.videoUrl : '',
        participants: data.participants ?? [],
        votes: data.votes ?? [],
      });
      store.set(row.id, row);
      return Promise.resolve(withCreator(row));
    },
    findUnique: ({ where }: { where: { id: string } }): Promise<unknown> => {
      const row = store.get(where.id);
      return Promise.resolve(row === undefined ? null : withCreator(row));
    },
    findMany: (args: { include: unknown }): Promise<readonly unknown[]> => {
      harness.lastInclude = args.include;
      return Promise.resolve([...store.values()].map(withCreator));
    },
    count: (): Promise<number> => Promise.resolve(store.size),
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown> => {
      const row = store.get(where.id);
      if (row === undefined) return Promise.reject(new Error('missing'));
      const next: Row = {
        ...row,
        participants: data.participants ?? row.participants,
        votes: data.votes ?? row.votes,
        status: typeof data.status === 'string' ? data.status : row.status,
        winner: typeof data.winner === 'string' ? data.winner : row.winner,
        endReason:
          typeof data.endReason === 'string' ? data.endReason : row.endReason,
        endedAt: data.endedAt instanceof Date ? data.endedAt : row.endedAt,
      };
      store.set(next.id, next);
      return Promise.resolve(withCreator(next));
    },
  };

  const db = {
    challenge: delegate,
    user: {
      findMany: ({
        where,
      }: {
        where: { id: { in: string[] } };
      }): Promise<readonly unknown[]> => {
        harness.userQueries += 1;
        return Promise.resolve(
          where.id.in
            .filter((id) => id !== 'ghost')
            .map((id) => ({ ...creator, id, username: id })),
        );
      },
    },
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
    service: new ChallengesService(
      new PrismaService(
        db as unknown as ConstructorParameters<typeof PrismaService>[0],
      ),
    ),
  });
};

const voters = (row: Row | undefined): readonly string[] =>
  Array.isArray(row?.votes)
    ? row.votes.filter((v): v is string => typeof v === 'string')
    : [];

describe('challenges', () => {
  it('creates a challenge owned by the caller', async () => {
    const harness = createHarness([]);
    const result = await harness.service.create(owner, {
      videoUrl: 'https://cdn.example.com/a.mp4',
    });

    expect(result.success).toBe(true);
    expect(result.challenge.creatorId).toBe('creator');
    expect(result.challenge.status).toBe('active');
    expect(result.challenge.votesCount).toBe(0);
  });

  it('records a duet against the authenticated user', async () => {
    const harness = createHarness([makeRow({})]);
    await expect(
      harness.service.duet(voter, 'challenge-1', {
        videoUrl: 'https://cdn.example.com/b.mp4',
      }),
    ).resolves.toEqual({ success: true, message: 'Duet added' });

    const stored = harness.rows.get('challenge-1');
    expect(stored?.participants).toEqual([
      { user: 'voter', videoUrl: 'https://cdn.example.com/b.mp4' },
    ]);
    expect(harness.transactionOptions).toContainEqual({
      isolationLevel: 'Serializable',
    });
  });

  it('votes as the session, never as a caller-supplied user', async () => {
    const harness = createHarness([makeRow({})]);
    // Legacy honoured req.body.userId, so this call would have voted as the
    // victim. The field is ignored and the session decides.
    await harness.service.vote(voter, 'challenge-1', { userId: 'victim' });

    expect(voters(harness.rows.get('challenge-1'))).toEqual(['voter']);
  });

  it('counts one vote per voter however many times they call', async () => {
    const harness = createHarness([makeRow({})]);
    await harness.service.vote(voter, 'challenge-1', {});
    await harness.service.vote(voter, 'challenge-1', {});
    await harness.service.vote(owner, 'challenge-1', {});

    expect(voters(harness.rows.get('challenge-1'))).toEqual([
      'voter',
      'creator',
    ]);
  });

  it('does not lose concurrent votes', async () => {
    const harness = createHarness([makeRow({})]);
    await Promise.all([
      harness.service.vote(voter, 'challenge-1', {}),
      harness.service.vote(owner, 'challenge-1', {}),
    ]);

    expect(voters(harness.rows.get('challenge-1'))).toHaveLength(2);
  });

  it('lets only the creator or an administrator end', async () => {
    const harness = createHarness([
      makeRow({}),
      makeRow({ id: 'challenge-2' }),
    ]);

    await expect(
      harness.service.end(voter, 'challenge-1', { winner: 'voter' }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });

    const ended = await harness.service.end(owner, 'challenge-1', {});
    expect(ended.challenge.status).toBe('ended');
    expect(ended.challenge.endReason).toBe('Ended by creator');
    expect(ended.message).toBe('Challenge ended successfully');

    await expect(
      harness.service.end(admin, 'challenge-2', {}),
    ).resolves.toMatchObject({ success: true });
  });

  it('reports a missing challenge on every write path', async () => {
    const harness = createHarness([]);
    for (const call of [
      harness.service.duet(owner, 'ghost', {
        videoUrl: 'https://cdn.example.com/b.mp4',
      }),
      harness.service.vote(owner, 'ghost', {}),
      harness.service.end(owner, 'ghost', {}),
    ]) {
      await expect(call).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('lists through the real author relation, which legacy got wrong', async () => {
    const harness = createHarness([
      makeRow({
        id: 'c1',
        participants: [
          { user: 'p1', videoUrl: 'https://cdn.example.com/1.mp4' },
          { user: 'ghost', videoUrl: null },
        ],
        votes: ['v1'],
      }),
    ]);

    const page = await harness.service.list({
      status: null,
      page: 1,
      limit: 10,
    });

    // Legacy included a `creator` relation that does not exist on Challenge,
    // so every call raised a validation error and returned 500.
    expect(harness.lastInclude).toEqual({
      user: { select: expect.anything() as unknown },
    });
    expect(page.challenges[0]?.creator?.id).toBe('creator');
    expect(page.challenges[0]?.votesCount).toBe(1);
    expect(harness.userQueries).toBe(1);

    const participants = page.challenges[0]?.participants ?? [];
    expect(participants[0]?.user).toMatchObject({ id: 'p1' });
    // A participant whose user is gone falls back to the raw id, as before.
    expect(participants[1]?.user).toBe('ghost');
    expect(page.pagination).toEqual({
      current: 1,
      pages: 1,
      total: 1,
      limit: 10,
    });
  });
});

describe('challenge routes', () => {
  const reflector = new Reflector();
  const handlerOf = (method: string) => {
    const handler: unknown = Reflect.get(
      ChallengesController.prototype,
      method,
    );
    if (typeof handler !== 'function') {
      throw new Error(`ChallengesController.${method} is missing`);
    }
    return handler;
  };

  it('registers the exact five legacy routes', () => {
    expect(reflector.get<unknown>(PATH_METADATA, ChallengesController)).toBe(
      'api/challenges',
    );

    const routes = [
      ['create', 'create', RequestMethod.POST],
      ['duet', ':challengeId/duet', RequestMethod.PUT],
      ['vote', ':challengeId/vote', RequestMethod.PUT],
      ['end', ':challengeId/end', RequestMethod.PUT],
      ['list', '/', RequestMethod.GET],
    ] as const;

    for (const [name, path, method] of routes) {
      expect(reflector.get<unknown>(PATH_METADATA, handlerOf(name))).toBe(path);
      expect(reflector.get<unknown>(METHOD_METADATA, handlerOf(name))).toBe(
        method,
      );
    }
  });

  it('guards every write but leaves the listing public', () => {
    for (const name of ['create', 'duet', 'vote', 'end']) {
      expect(
        reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf(name)),
      ).toEqual([SessionGuard]);
    }
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf('list')),
    ).toBeUndefined();
  });
});
