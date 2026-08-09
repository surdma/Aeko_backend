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

const campaign = {
  objective: 'awareness',
  schedule: {
    startDate: '2026-08-01T00:00:00.000Z',
    endDate: '2026-08-19T12:00:00.000Z',
    timezone: 'UTC',
    dayParting: { enabled: false, hours: [] },
  },
};

const baseAnalytics = {
  impressions: 0,
  clicks: 0,
  ctr: 0,
  conversions: 0,
  conversionRate: 0,
  reach: 0,
  frequency: 0,
  engagements: { likes: 0, shares: 0, comments: 0, saves: 0 },
  demographics: { age: [], gender: [], location: [] },
  performance: { bestPerformingTime: null, topLocations: [], topDevices: [] },
};

const makeRow = (overrides: Partial<Row>): Row => ({
  id: 'ad-running',
  title: 'Campaign',
  description: 'A campaign',
  mediaType: 'image',
  mediaUrl: null,
  mediaUrls: [],
  targetAudience: { age: null, location: [], followersRange: null },
  budget: { total: 1000, daily: 100, spent: 0, currency: 'NGN' },
  pricing: { model: 'cpm', bidAmount: 20, maxBid: null },
  campaign,
  advertiserId: 'owner',
  Status: 'running',
  callToAction: { type: 'learn_more', url: null },
  analytics: { ...baseAnalytics },
  review: null,
  placement: { feed: true },
  frequency: { cap: 3, currentCap: 0 },
  createdAt: new Date('2026-08-02T00:00:00.000Z'),
  updatedAt: new Date('2026-08-03T00:00:00.000Z'),
  user: null,
  ...overrides,
});

const principal: AuthenticatedPrincipal = {
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

const numberAt = (input: unknown, ...path: readonly string[]): number => {
  const value = path.reduce<unknown>(
    (current, key) => readObject(current, key),
    input,
  );
  return typeof value === 'number' ? value : Number.NaN;
};

class WriteConflict extends Error {
  readonly code = 'P2034';

  constructor() {
    super('Transaction failed due to a write conflict or a deadlock.');
  }
}

interface Harness {
  readonly service: AdsService;
  readonly rows: Map<string, Row>;
  readonly transactionOptions: unknown[];
  attempts: number;
  conflictsRemaining: number;
}

const createHarness = (rows: readonly Row[]): Harness => {
  const store = new Map(rows.map((row) => [row.id, row]));
  const harness: Harness = {
    service: undefined as unknown as AdsService,
    rows: store,
    transactionOptions: [],
    attempts: 0,
    conflictsRemaining: 0,
  };

  const delegate = {
    create: (): Promise<Row> => Promise.reject(new Error('unused')),
    findUnique: (input: unknown): Promise<Row | null> =>
      Promise.resolve(store.get(readWhereId(input)) ?? null),
    findMany: (): Promise<readonly Row[]> => Promise.resolve([]),
    count: (): Promise<number> => Promise.resolve(0),
    update: (input: unknown): Promise<Row> => {
      const existing = store.get(readWhereId(input));
      if (!existing) return Promise.reject(new Error('missing row'));
      const data = readObject(input, 'data');
      const next: Row = {
        ...existing,
        analytics: readObject(data, 'analytics') ?? existing.analytics,
        budget: readObject(data, 'budget') ?? existing.budget,
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

  // Serializable isolation is modelled by running transactions one at a time:
  // a concurrent caller therefore observes the previous commit, which is what
  // makes the lost-update assertion meaningful.
  let queue: Promise<unknown> = Promise.resolve();

  const client = {
    $connect: (): Promise<void> => Promise.resolve(),
    $disconnect: (): Promise<void> => Promise.resolve(),
    $queryRaw: (): Promise<unknown> => Promise.resolve(1),
    $transaction: (operation: unknown, options: unknown): Promise<unknown> => {
      const run = queue.then(() => {
        harness.transactionOptions.push(options);
        harness.attempts += 1;
        if (harness.conflictsRemaining > 0) {
          harness.conflictsRemaining -= 1;
          throw new WriteConflict();
        }
        if (typeof operation !== 'function') {
          throw new Error('expected a callback');
        }
        return Reflect.apply(operation, undefined, [client]) as unknown;
      });
      queue = run.catch(() => undefined);
      return run;
    },
    ad: delegate,
    user: { findUnique: (): Promise<null> => Promise.resolve(null) },
  };

  return Object.assign(harness, {
    service: new AdsService(new PrismaService(client)),
  });
};

describe('ad tracking', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('tracks impressions in a serializable transaction', async () => {
    const harness = createHarness([makeRow({})]);
    const result = await harness.service.trackImpression(principal, {
      adId: 'ad-running',
      metadata: { age: 30 },
    });

    expect(result).toEqual({ impressions: 1, ctr: 0, reach: 1 });
    expect(harness.transactionOptions).toContainEqual({
      isolationLevel: 'Serializable',
    });

    const stored = harness.rows.get('ad-running');
    expect(numberAt(stored?.analytics, 'impressions')).toBe(1);
    expect(numberAt(stored?.analytics, 'reach')).toBe(1);
    expect(numberAt(stored?.analytics, 'frequency')).toBe(1);
    const buckets = readObject(
      readObject(stored?.analytics, 'demographics'),
      'age',
    );
    expect(buckets).toEqual([{ range: '25-34', count: 1 }]);
  });

  it('does not lose concurrent impression counts', async () => {
    const harness = createHarness([makeRow({})]);
    const results = await Promise.all([
      harness.service.trackImpression(principal, { adId: 'ad-running' }),
      harness.service.trackImpression(principal, { adId: 'ad-running' }),
    ]);

    expect(results.map((entry) => entry.impressions).sort()).toEqual([1, 2]);
    expect(
      numberAt(harness.rows.get('ad-running')?.analytics, 'impressions'),
    ).toBe(2);
  });

  it('retries a write conflict at most three times', async () => {
    const harness = createHarness([makeRow({})]);
    harness.conflictsRemaining = 2;

    await expect(
      harness.service.trackImpression(principal, { adId: 'ad-running' }),
    ).resolves.toMatchObject({ impressions: 1 });
    expect(harness.attempts).toBe(3);
  });

  it('surfaces a friendly conflict once retries are exhausted', async () => {
    const harness = createHarness([makeRow({})]);
    harness.conflictsRemaining = 5;

    await expect(
      harness.service.trackImpression(principal, { adId: 'ad-running' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(harness.attempts).toBe(3);
  });

  it('charges CPM only on each thousandth impression', async () => {
    const harness = createHarness([
      makeRow({
        analytics: { ...baseAnalytics, impressions: 999, reach: 999 },
      }),
    ]);
    await harness.service.trackImpression(principal, { adId: 'ad-running' });
    expect(numberAt(harness.rows.get('ad-running')?.budget, 'spent')).toBe(20);

    await harness.service.trackImpression(principal, { adId: 'ad-running' });
    expect(numberAt(harness.rows.get('ad-running')?.budget, 'spent')).toBe(20);
  });

  it('charges CPC on every click and reports numeric ctr', async () => {
    const harness = createHarness([
      makeRow({
        pricing: { model: 'cpc', bidAmount: 5, maxBid: null },
        analytics: { ...baseAnalytics, impressions: 200 },
      }),
    ]);
    const result = await harness.service.trackClick(principal, {
      adId: 'ad-running',
    });

    expect(result).toEqual({
      clicks: 1,
      ctr: 0.5,
      budgetSpent: 5,
      remainingBudget: 995,
    });
  });

  it('charges CPA on every conversion and reports numeric rate', async () => {
    const harness = createHarness([
      makeRow({
        pricing: { model: 'cpa', bidAmount: 15, maxBid: null },
        analytics: { ...baseAnalytics, clicks: 4 },
      }),
    ]);
    const result = await harness.service.trackConversion(principal, {
      adId: 'ad-running',
      conversionValue: 10,
      conversionType: 'signup',
    });

    expect(result).toEqual({
      conversions: 1,
      conversionRate: 25,
      budgetSpent: 15,
    });
  });

  it('completes an ad through the canonical column when the budget runs out', async () => {
    const harness = createHarness([
      makeRow({
        pricing: { model: 'cpc', bidAmount: 1000, maxBid: null },
        analytics: { ...baseAnalytics, impressions: 10 },
      }),
    ]);
    await harness.service.trackClick(principal, { adId: 'ad-running' });

    const stored = harness.rows.get('ad-running');
    expect(stored?.Status).toBe('completed');
    expect(stored).not.toHaveProperty('status');
  });

  it('rejects tracking for missing and non-running ads', async () => {
    const harness = createHarness([
      makeRow({ id: 'ad-paused', Status: 'paused' }),
    ]);

    await expect(
      harness.service.trackImpression(principal, { adId: 'ad-paused' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      harness.service.trackClick(principal, { adId: 'missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      harness.service.trackConversion(principal, { adId: 'ad-paused' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('treats malformed stored analytics as empty counters', async () => {
    const harness = createHarness([makeRow({ analytics: 'corrupted' })]);
    await expect(
      harness.service.trackImpression(principal, { adId: 'ad-running' }),
    ).resolves.toEqual({ impressions: 1, ctr: 0, reach: 1 });
  });

  it('keeps the legacy track-view alias on the impression path', async () => {
    const harness = createHarness([makeRow({})]);
    await expect(
      harness.service.trackView(principal, { adId: 'ad-running' }),
    ).resolves.toEqual({ impressions: 1, ctr: 0, reach: 1 });
  });
});

describe('tracking routes', () => {
  const reflector = new Reflector();
  const route = (
    method: string,
  ): { readonly path: unknown; readonly method: unknown } => {
    const handler: unknown = Reflect.get(AdsController.prototype, method);
    if (typeof handler !== 'function') {
      throw new Error(`AdsController.${method} is missing`);
    }
    return {
      path: reflector.get<unknown>(PATH_METADATA, handler),
      method: reflector.get<unknown>(METHOD_METADATA, handler),
    };
  };

  const guardsOf = (method: string): readonly unknown[] | undefined => {
    const handler: unknown = Reflect.get(AdsController.prototype, method);
    if (typeof handler !== 'function') {
      throw new Error(`AdsController.${method} is missing`);
    }
    return reflector.get<readonly unknown[]>(GUARDS_METADATA, handler);
  };

  it('registers the exact legacy tracking routes', () => {
    expect(route('trackImpression')).toEqual({
      path: 'track/impression',
      method: RequestMethod.POST,
    });
    expect(route('trackClick')).toEqual({
      path: 'track/click',
      method: RequestMethod.POST,
    });
    expect(route('trackConversion')).toEqual({
      path: 'track/conversion',
      method: RequestMethod.POST,
    });
    expect(route('trackView')).toEqual({
      path: 'track-view',
      method: RequestMethod.POST,
    });
  });

  it('keeps tracking behind the session guard only', () => {
    expect(reflector.get<unknown>(GUARDS_METADATA, AdsController)).toEqual([
      SessionGuard,
    ]);
    expect(guardsOf('trackImpression')).toBeUndefined();
  });
});
