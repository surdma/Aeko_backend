import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { RoleGuard } from '../../src/auth/guards/role/role.guard';
import { SessionGuard } from '../../src/auth/guards/session/session.guard';
import { TwoFactorGuard } from '../../src/auth/guards/two-factor/two-factor.guard';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { AdsController } from '../../src/ads/ads.controller';
import { AdsService } from '../../src/ads/ads.service';

const NOW = new Date('2026-08-09T12:00:00.000Z');

interface Row {
  readonly id: string;
  title: string;
  description: string;
  mediaType: string;
  mediaUrl: string | null;
  mediaUrls: readonly string[];
  targetAudience: unknown;
  budget: unknown;
  pricing: unknown;
  campaign: unknown;
  advertiserId: string;
  Status: string;
  callToAction: unknown;
  analytics: unknown;
  review: unknown;
  placement: unknown;
  frequency: unknown;
  createdAt: Date;
  updatedAt: Date;
  user: unknown;
}

const makeRow = (overrides: Partial<Row>): Row => ({
  id: 'ad-pending',
  title: 'Campaign',
  description: 'A campaign',
  mediaType: 'image',
  mediaUrl: null,
  mediaUrls: [],
  targetAudience: { age: null, location: [], followersRange: null },
  budget: { total: 1000, daily: 100, spent: 0, currency: 'NGN' },
  pricing: { model: 'cpm', bidAmount: 20, maxBid: null },
  campaign: {
    objective: 'awareness',
    schedule: {
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-08-19T12:00:00.000Z',
      timezone: 'UTC',
      dayParting: { enabled: false, hours: [] },
    },
  },
  advertiserId: 'owner',
  Status: 'pending',
  callToAction: { type: 'learn_more', url: null },
  analytics: { impressions: 0, clicks: 0, ctr: 0, conversions: 0 },
  review: null,
  placement: { feed: true },
  frequency: { cap: 3, currentCap: 0 },
  createdAt: new Date('2026-08-02T00:00:00.000Z'),
  updatedAt: new Date('2026-08-03T00:00:00.000Z'),
  user: { username: 'ada', profilePicture: null, blueTick: true },
  ...overrides,
});

const adminPrincipal: AuthenticatedPrincipal = {
  userId: 'admin',
  email: 'admin@example.com',
  username: 'admin',
  isAdmin: true,
  banned: false,
  twoFactorEnabled: true,
  twoFactorSatisfied: true,
  sessionId: 'session-admin',
};

const memberPrincipal: AuthenticatedPrincipal = {
  ...adminPrincipal,
  userId: 'member',
  username: 'member',
  isAdmin: false,
  sessionId: 'session-member',
};

const adminWithoutTwoFactor: AuthenticatedPrincipal = {
  ...adminPrincipal,
  twoFactorSatisfied: false,
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
  readonly service: AdsService;
  readonly rows: Map<string, Row>;
  lastFindManyArgs: unknown;
  lastUpdateData: unknown;
}

const createHarness = (rows: readonly Row[]): Harness => {
  const store = new Map(rows.map((row) => [row.id, row]));
  const harness: Harness = {
    service: undefined as unknown as AdsService,
    rows: store,
    lastFindManyArgs: null,
    lastUpdateData: null,
  };

  const delegate = {
    create: (): Promise<Row> => Promise.reject(new Error('unused')),
    findUnique: (input: unknown): Promise<Row | null> =>
      Promise.resolve(store.get(readWhereId(input)) ?? null),
    findMany: (input: unknown): Promise<readonly Row[]> => {
      harness.lastFindManyArgs = input;
      const status = readObject(readObject(input, 'where'), 'Status');
      return Promise.resolve(
        [...store.values()].filter(
          (row) => typeof status !== 'string' || row.Status === status,
        ),
      );
    },
    count: (): Promise<number> => Promise.resolve(store.size),
    update: (input: unknown): Promise<Row> => {
      const existing = store.get(readWhereId(input));
      if (!existing) return Promise.reject(new Error('missing row'));
      const data = readObject(input, 'data');
      harness.lastUpdateData = data;
      const next: Row = {
        ...existing,
        review: readObject(data, 'review') ?? existing.review,
        Status:
          typeof readObject(data, 'Status') === 'string'
            ? String(readObject(data, 'Status'))
            : existing.Status,
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
    $transaction: (operation: unknown): Promise<unknown> => {
      if (typeof operation !== 'function') {
        return Promise.reject(new Error('expected a callback'));
      }
      return Promise.resolve(
        Reflect.apply(operation, undefined, [client]) as unknown,
      );
    },
    ad: delegate,
    user: { findUnique: (): Promise<null> => Promise.resolve(null) },
  };

  return Object.assign(harness, {
    service: new AdsService(new PrismaService(client)),
  });
};

describe('administrator review', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lists pending ads by default without internal column names', async () => {
    const harness = createHarness([
      makeRow({}),
      makeRow({ id: 'ad-running', Status: 'running' }),
    ]);
    const page = await harness.service.listForReview(adminPrincipal, {
      page: 1,
      limit: 20,
      status: null,
    });

    expect(
      readObject(readObject(harness.lastFindManyArgs, 'where'), 'Status'),
    ).toBe('pending');
    expect(page.ads).toHaveLength(1);
    expect(page.ads[0]).not.toHaveProperty('Status');
    expect(page.ads[0]?.status).toBe('pending');
    expect(page.pagination.current).toBe(1);
  });

  it('honours an explicit review status filter', async () => {
    const harness = createHarness([
      makeRow({}),
      makeRow({ id: 'ad-rejected', Status: 'rejected' }),
    ]);
    const page = await harness.service.listForReview(adminPrincipal, {
      page: 1,
      limit: 20,
      status: 'rejected',
    });

    expect(page.ads.map((ad) => ad.id)).toEqual(['ad-rejected']);
  });

  it('denies non-administrators and unconfirmed administrators', async () => {
    const harness = createHarness([makeRow({})]);

    await expect(
      harness.service.listForReview(memberPrincipal, {
        page: 1,
        limit: 20,
        status: null,
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(
      harness.service.review(memberPrincipal, 'ad-pending', {
        status: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(
      harness.service.review(adminWithoutTwoFactor, 'ad-pending', {
        status: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
  });

  it('approves an ad straight into running and records the reviewer', async () => {
    const harness = createHarness([makeRow({})]);
    const reviewed = await harness.service.review(
      adminPrincipal,
      'ad-pending',
      {
        status: 'approved',
        feedback: 'Looks good',
      },
    );

    expect(reviewed.status).toBe('running');
    expect(readObject(harness.lastUpdateData, 'Status')).toBe('running');
    const review = readObject(harness.lastUpdateData, 'review');
    expect(review).toEqual({
      reviewedBy: 'admin',
      reviewedAt: NOW.toISOString(),
      rejectionReason: null,
      feedback: 'Looks good',
    });
  });

  it('requires a reason to reject and accepts the legacy field name', async () => {
    const harness = createHarness([makeRow({}), makeRow({ id: 'ad-second' })]);

    await expect(
      harness.service.review(adminPrincipal, 'ad-pending', {
        status: 'rejected',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const reviewed = await harness.service.review(adminPrincipal, 'ad-second', {
      status: 'rejected',
      rejectionReason: ' Violates policy ',
    });

    expect(reviewed.status).toBe('rejected');
    expect(readObject(harness.lastUpdateData, 'Status')).toBe('rejected');
    expect(
      readObject(
        readObject(harness.lastUpdateData, 'review'),
        'rejectionReason',
      ),
    ).toBe('Violates policy');
  });

  it('rejects unsupported decisions and missing ads', async () => {
    const harness = createHarness([makeRow({})]);

    await expect(
      harness.service.review(adminPrincipal, 'ad-pending', {
        status: 'running',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      harness.service.review(adminPrincipal, 'missing', {
        status: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('administrator review routes', () => {
  const reflector = new Reflector();
  const handlerOf = (method: string) => {
    const handler: unknown = Reflect.get(AdsController.prototype, method);
    if (typeof handler !== 'function') {
      throw new Error(`AdsController.${method} is missing`);
    }
    return handler;
  };

  it('registers the exact legacy administrator routes', () => {
    expect(
      reflector.get<unknown>(PATH_METADATA, handlerOf('listForReview')),
    ).toBe('admin/review');
    expect(
      reflector.get<unknown>(METHOD_METADATA, handlerOf('listForReview')),
    ).toBe(RequestMethod.GET);
    expect(reflector.get<unknown>(PATH_METADATA, handlerOf('review'))).toBe(
      'admin/review/:adId',
    );
    expect(reflector.get<unknown>(METHOD_METADATA, handlerOf('review'))).toBe(
      RequestMethod.POST,
    );
  });

  it('guards listing with the role guard and mutation with two factor', () => {
    expect(
      reflector.get<readonly unknown[]>(
        GUARDS_METADATA,
        handlerOf('listForReview'),
      ),
    ).toEqual([SessionGuard, RoleGuard]);
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf('review')),
    ).toEqual([SessionGuard, RoleGuard, TwoFactorGuard]);
  });
});
