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
import { DebatesController } from '../../src/debates/debates.controller';
import { DebatesService } from '../../src/debates/debates.service';
import {
  DebateScoringPort,
  type DebateScore,
  type DebateScoreRequest,
} from '../../src/providers/debate-scoring/debate-scoring.port';
import { UnavailableDebateScoringAdapter } from '../../src/providers/debate-scoring/unavailable-debate-scoring.adapter';

interface Row {
  id: string;
  topic: string;
  creatorId: string;
  participants: unknown;
  scores: unknown;
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
  id: 'debate-1',
  topic: 'Is AI creative?',
  creatorId: 'creator',
  participants: ['p1', 'p2'],
  scores: {},
  votes: {},
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

const stranger: AuthenticatedPrincipal = { ...owner, userId: 'stranger' };
const admin: AuthenticatedPrincipal = { ...stranger, isAdmin: true };

class StubScorer extends DebateScoringPort {
  calls: DebateScoreRequest[] = [];
  value = 7;

  score(request: DebateScoreRequest): Promise<DebateScore> {
    this.calls.push(request);
    return Promise.resolve({ value: this.value, rationale: null });
  }
}

interface Harness {
  readonly service: DebatesService;
  readonly rows: Map<string, Row>;
  readonly scorer: StubScorer;
  readonly transactionOptions: unknown[];
  userQueries: number;
  lastFindManyArgs: unknown;
}

const createHarness = (rows: readonly Row[]): Harness => {
  const store = new Map(rows.map((row) => [row.id, row]));
  const scorer = new StubScorer();
  const harness: Harness = {
    service: undefined as unknown as DebatesService,
    rows: store,
    scorer,
    transactionOptions: [],
    userQueries: 0,
    lastFindManyArgs: null,
  };

  let queue: Promise<unknown> = Promise.resolve();
  const withCreator = (row: Row): unknown => ({ ...row, user: creator });

  const debateDelegate = {
    create: ({ data }: { data: Record<string, unknown> }): Promise<unknown> => {
      const row = makeRow({
        id: `debate-${store.size + 1}`,
        topic: typeof data.topic === 'string' ? data.topic : '',
        creatorId: typeof data.creatorId === 'string' ? data.creatorId : '',
        participants: data.participants,
        scores: data.scores ?? {},
        votes: data.votes ?? {},
      });
      store.set(row.id, row);
      return Promise.resolve(withCreator(row));
    },
    findUnique: ({ where }: { where: { id: string } }): Promise<unknown> => {
      const row = store.get(where.id);
      return Promise.resolve(row === undefined ? null : withCreator(row));
    },
    findMany: (args: { where: unknown }): Promise<readonly unknown[]> => {
      harness.lastFindManyArgs = args;
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
        scores: data.scores ?? row.scores,
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
    debate: debateDelegate,
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
            .map((id) => ({ id, username: id, profilePicture: null })),
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
    service: new DebatesService(
      new PrismaService(
        db as unknown as ConstructorParameters<typeof PrismaService>[0],
      ),
      scorer,
    ),
  });
};

const read = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null
    ? Reflect.get(value, key)
    : undefined;

describe('debates', () => {
  it('starts a debate owned by the caller', async () => {
    const harness = createHarness([]);
    const result = await harness.service.start(owner, {
      topic: 'Is AI creative?',
      participants: ['p1'],
    });

    expect(result.success).toBe(true);
    expect(result.debate.creatorId).toBe('creator');
    expect(result.debate.status).toBe('active');
    expect(result.debate.participants.map((p) => p.id)).toEqual(['p1']);
  });

  it('lets only the creator or an administrator score', async () => {
    const harness = createHarness([makeRow({})]);

    await expect(
      harness.service.score(stranger, 'debate-1', {
        participantId: 'p1',
        message: 'strong point',
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    expect(harness.scorer.calls).toHaveLength(0);

    await expect(
      harness.service.score(owner, 'debate-1', {
        participantId: 'p1',
        message: 'strong point',
      }),
    ).resolves.toEqual({ success: true, score: 7 });
    await expect(
      harness.service.score(admin, 'debate-1', {
        participantId: 'p2',
        message: 'rebuttal',
      }),
    ).resolves.toMatchObject({ success: true });
  });

  it('writes the score inside a serializable transaction', async () => {
    const harness = createHarness([makeRow({ scores: { p2: 3 } })]);
    await harness.service.score(owner, 'debate-1', {
      participantId: 'p1',
      message: 'point',
    });

    expect(harness.transactionOptions).toContainEqual({
      isolationLevel: 'Serializable',
    });
    const scores = harness.rows.get('debate-1')?.scores;
    expect(read(scores, 'p1')).toBe(7);
    // An unrelated participant's score is preserved.
    expect(read(scores, 'p2')).toBe(3);
  });

  it('does not lose concurrent votes', async () => {
    const harness = createHarness([makeRow({})]);
    await Promise.all([
      harness.service.vote(owner, 'debate-1', { participantId: 'p1' }),
      harness.service.vote(stranger, 'debate-1', { participantId: 'p1' }),
    ]);

    expect(read(harness.rows.get('debate-1')?.votes, 'p1')).toBe(2);
    expect(harness.transactionOptions).toContainEqual({
      isolationLevel: 'Serializable',
    });
  });

  it('still counts a repeat vote, which needs the pending DebateVote table', async () => {
    // Documented gap: `debates.votes` is a counts map with no voter identity,
    // so ballot stuffing cannot be closed without a schema change. Asserted so
    // the limitation is visible rather than assumed fixed.
    const harness = createHarness([makeRow({})]);
    await harness.service.vote(owner, 'debate-1', { participantId: 'p1' });
    await harness.service.vote(owner, 'debate-1', { participantId: 'p1' });

    expect(read(harness.rows.get('debate-1')?.votes, 'p1')).toBe(2);
  });

  it('ignores a caller-supplied voter identity', async () => {
    const harness = createHarness([makeRow({})]);
    await expect(
      harness.service.vote(owner, 'debate-1', {
        participantId: 'p1',
        userId: 'victim',
      }),
    ).resolves.toEqual({ success: true, message: 'Vote added' });
    expect(read(harness.rows.get('debate-1')?.votes, 'victim')).toBeUndefined();
  });

  it('lets only the creator or an administrator end, with the legacy default', async () => {
    const harness = createHarness([makeRow({}), makeRow({ id: 'debate-2' })]);

    await expect(
      harness.service.end(stranger, 'debate-1', { winner: 'p1' }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });

    const ended = await harness.service.end(owner, 'debate-1', {
      winner: 'p1',
    });
    expect(ended.debate.status).toBe('ended');
    expect(ended.debate.winner).toBe('p1');
    expect(ended.debate.endReason).toBe('Ended by creator');
    expect(ended.message).toBe('Debate ended successfully');

    await expect(
      harness.service.end(admin, 'debate-2', { reason: 'Cancelled' }),
    ).resolves.toMatchObject({ success: true });
  });

  it('reports a missing debate on every write path', async () => {
    const harness = createHarness([]);
    for (const call of [
      harness.service.score(owner, 'ghost', {
        participantId: 'p1',
        message: 'x',
      }),
      harness.service.vote(owner, 'ghost', { participantId: 'p1' }),
      harness.service.end(owner, 'ghost', {}),
    ]) {
      await expect(call).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('resolves participants for the whole page in one query', async () => {
    const harness = createHarness([
      makeRow({ id: 'd1', participants: ['p1', 'p2'] }),
      makeRow({ id: 'd2', participants: ['p2', 'ghost'] }),
    ]);

    const page = await harness.service.list({
      status: null,
      page: 1,
      limit: 10,
    });

    expect(page.debates).toHaveLength(2);
    // Legacy issued one user query per debate row.
    expect(harness.userQueries).toBe(1);
    // A stored id with no live user is dropped, as the legacy join did.
    expect(page.debates[1]?.participants.map((p) => p.id)).toEqual(['p2']);
    expect(page.pagination).toEqual({
      current: 1,
      pages: 1,
      total: 2,
      limit: 10,
    });
  });
});

describe('deferred debate scoring', () => {
  it('reports unavailable rather than inventing a score', async () => {
    const adapter = new UnavailableDebateScoringAdapter();
    await expect(
      adapter.score({ debateId: 'd1', participantId: 'p1', message: 'x' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});

describe('debate routes', () => {
  const reflector = new Reflector();
  const handlerOf = (method: string) => {
    const handler: unknown = Reflect.get(DebatesController.prototype, method);
    if (typeof handler !== 'function') {
      throw new Error(`DebatesController.${method} is missing`);
    }
    return handler;
  };

  it('registers the exact five legacy routes', () => {
    expect(reflector.get<unknown>(PATH_METADATA, DebatesController)).toBe(
      'api/debates',
    );

    const routes = [
      ['start', 'start', RequestMethod.POST],
      ['score', ':debateId/score', RequestMethod.PUT],
      ['vote', ':debateId/vote', RequestMethod.PUT],
      ['end', ':debateId/end', RequestMethod.PUT],
      ['list', '/', RequestMethod.GET],
    ] as const;

    for (const [name, path, method] of routes) {
      expect(reflector.get<unknown>(PATH_METADATA, handlerOf(name))).toBe(path);
      expect(reflector.get<unknown>(METHOD_METADATA, handlerOf(name))).toBe(
        method,
      );
    }
  });

  it('guards every write but leaves the listing public, as Express did', () => {
    for (const name of ['start', 'score', 'vote', 'end']) {
      expect(
        reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf(name)),
      ).toEqual([SessionGuard]);
    }
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf('list')),
    ).toBeUndefined();
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, DebatesController),
    ).toBeUndefined();
  });
});
