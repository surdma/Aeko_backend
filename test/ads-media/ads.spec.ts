import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { SessionGuard } from '../../src/auth/guards/session/session.guard';
import { TwoFactorGuard } from '../../src/auth/guards/two-factor/two-factor.guard';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { AdsController } from '../../src/ads/ads.controller';
import { AdsService } from '../../src/ads/ads.service';

const NOW = new Date('2026-08-09T12:00:00.000Z');

interface FixtureAd {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly mediaType: string;
  readonly mediaUrl: string | null;
  readonly mediaUrls: readonly string[];
  readonly targetAudience: unknown;
  readonly budget: unknown;
  readonly pricing: unknown;
  readonly campaign: unknown;
  readonly advertiserId: string;
  readonly Status: string;
  readonly callToAction: unknown;
  readonly analytics: unknown;
  readonly review: unknown;
  readonly placement: unknown;
  readonly frequency: unknown;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly user: unknown;
}

const advertiser = {
  username: 'ada',
  profilePicture: null,
  blueTick: true,
};

const baseAd: FixtureAd = {
  id: 'ad-owned',
  title: 'Owned campaign',
  description: 'An owned campaign',
  mediaType: 'image',
  mediaUrl: 'https://cdn.example.com/ad.png',
  mediaUrls: [],
  targetAudience: { age: null, location: [], followersRange: null },
  budget: { total: 1000, daily: 100, spent: 250, currency: 'NGN' },
  pricing: { model: 'cpm', bidAmount: 10, maxBid: null },
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
  Status: 'paused',
  callToAction: { type: 'learn_more', url: null },
  analytics: {
    impressions: 1000,
    clicks: 50,
    ctr: '5.00',
    conversions: 10,
    conversionRate: 1,
    reach: 500,
    frequency: 2,
    engagements: { likes: 10, shares: 5, comments: 5, saves: 0 },
    demographics: { age: [], gender: [], location: [] },
    performance: { bestPerformingTime: null, topLocations: [], topDevices: [] },
  },
  review: null,
  placement: { feed: true },
  frequency: { cap: 3, currentCap: 0 },
  createdAt: new Date('2026-08-02T00:00:00.000Z'),
  updatedAt: new Date('2026-08-03T00:00:00.000Z'),
  user: advertiser,
};

const runningOwned: FixtureAd = {
  ...baseAd,
  id: 'ad-running',
  Status: 'running',
};

const highBid: FixtureAd = {
  ...baseAd,
  id: 'ad-high-bid',
  advertiserId: 'other',
  Status: 'running',
  pricing: { model: 'cpm', bidAmount: 90, maxBid: null },
  targetAudience: { age: null, location: ['Lagos'], followersRange: null },
};

const lowBid: FixtureAd = {
  ...baseAd,
  id: 'ad-low-bid',
  advertiserId: 'other',
  Status: 'running',
  pricing: { model: 'cpm', bidAmount: 5, maxBid: null },
};

const exhausted: FixtureAd = {
  ...baseAd,
  id: 'ad-exhausted',
  advertiserId: 'other',
  Status: 'running',
  budget: { total: 100, daily: 10, spent: 100, currency: 'NGN' },
};

const expired: FixtureAd = {
  ...baseAd,
  id: 'ad-expired',
  advertiserId: 'other',
  Status: 'running',
  campaign: {
    objective: 'awareness',
    schedule: {
      startDate: '2026-07-01T00:00:00.000Z',
      endDate: '2026-07-20T00:00:00.000Z',
      timezone: 'UTC',
      dayParting: { enabled: false, hours: [] },
    },
  },
};

const mismatchedLocation: FixtureAd = {
  ...baseAd,
  id: 'ad-elsewhere',
  advertiserId: 'other',
  Status: 'running',
  pricing: { model: 'cpm', bidAmount: 95, maxBid: null },
  targetAudience: { age: null, location: ['Nairobi'], followersRange: null },
};

const ads = new Map<string, FixtureAd>(
  [
    baseAd,
    runningOwned,
    highBid,
    lowBid,
    exhausted,
    expired,
    mismatchedLocation,
  ].map((ad) => [ad.id, ad]),
);

const viewer = {
  id: 'viewer',
  age: 30,
  location: 'Lagos',
  followers: ['a', 'b'],
};

const ownerPrincipal: AuthenticatedPrincipal = {
  userId: 'owner',
  email: 'owner@example.com',
  username: 'owner',
  isAdmin: false,
  banned: false,
  twoFactorEnabled: true,
  twoFactorSatisfied: true,
  sessionId: 'session-owner',
};

const otherPrincipal: AuthenticatedPrincipal = {
  ...ownerPrincipal,
  userId: 'intruder',
  username: 'intruder',
  sessionId: 'session-intruder',
};

const ownerWithoutTwoFactor: AuthenticatedPrincipal = {
  ...ownerPrincipal,
  twoFactorSatisfied: false,
};

const viewerPrincipal: AuthenticatedPrincipal = {
  ...ownerPrincipal,
  userId: 'viewer',
  username: 'viewer',
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

let lastCreateData: unknown = null;
let lastUpdateData: unknown = null;
let lastFindManyArgs: unknown = null;
let deletedIds: string[] = [];

const adDelegate = {
  create: (input: unknown): Promise<FixtureAd> => {
    lastCreateData = readObject(input, 'data');
    return Promise.resolve({
      ...baseAd,
      id: 'ad-created',
      Status: 'pending',
    });
  },
  findUnique: (input: unknown): Promise<FixtureAd | null> =>
    Promise.resolve(ads.get(readWhereId(input)) ?? null),
  findMany: (input: unknown): Promise<readonly FixtureAd[]> => {
    lastFindManyArgs = input;
    const where = readObject(input, 'where');
    const status = readObject(where, 'Status');
    const advertiserId = readObject(where, 'advertiserId');
    const matches = [...ads.values()].filter((ad) => {
      if (typeof advertiserId === 'string' && ad.advertiserId !== advertiserId)
        return false;
      if (typeof status === 'string' && ad.Status !== status) return false;
      return true;
    });
    return Promise.resolve(
      [...matches].sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      ),
    );
  },
  count: (): Promise<number> => Promise.resolve(2),
  update: (input: unknown): Promise<FixtureAd> => {
    lastUpdateData = readObject(input, 'data');
    const existing = ads.get(readWhereId(input));
    if (!existing) return Promise.reject(new Error('fixture ad missing'));
    return Promise.resolve({ ...existing, title: 'Revised' });
  },
  delete: (input: unknown): Promise<FixtureAd> => {
    const existing = ads.get(readWhereId(input));
    if (!existing) return Promise.reject(new Error('fixture ad missing'));
    deletedIds.push(existing.id);
    return Promise.resolve(existing);
  },
};

const userDelegate = {
  findUnique: (input: unknown): Promise<typeof viewer | null> =>
    Promise.resolve(readWhereId(input) === viewer.id ? viewer : null),
};

const fakeClient = {
  $connect: (): Promise<void> => Promise.resolve(),
  $disconnect: (): Promise<void> => Promise.resolve(),
  $queryRaw: (): Promise<unknown> => Promise.resolve(1),
  ad: adDelegate,
  user: userDelegate,
};

const createService = (): AdsService =>
  new AdsService(new PrismaService(fakeClient));

describe('ads lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    lastCreateData = null;
    lastUpdateData = null;
    lastFindManyArgs = null;
    deletedIds = [];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates ads as pending against the canonical Status column', async () => {
    const service = createService();
    const created = await service.create(ownerPrincipal, {
      title: 'Campaign',
      description: 'A useful campaign',
      mediaType: 'image',
      mediaUrl: 'https://cdn.example.com/ad.png',
      budget: { total: 1000, daily: 100, currency: 'NGN' },
      pricing: { model: 'cpm', bidAmount: 25, maxBid: 50 },
      campaign: {
        objective: 'awareness',
        schedule: {
          startDate: '2026-08-10T12:00:00.000Z',
          endDate: '2026-08-20T12:00:00.000Z',
        },
      },
    });

    expect(readObject(lastCreateData, 'Status')).toBe('pending');
    expect(readObject(lastCreateData, 'status')).toBeUndefined();
    expect(readObject(lastCreateData, 'advertiserId')).toBe('owner');
    expect(
      readObject(readObject(lastCreateData, 'analytics'), 'impressions'),
    ).toBe(0);
    expect(created.status).toBe('pending');
    expect(created).not.toHaveProperty('Status');
  });

  it('lists owned ads newest first with legacy virtuals and no internal column', async () => {
    const service = createService();
    const page = await service.listOwned(ownerPrincipal, {
      page: 1,
      limit: 10,
      status: 'paused',
    });

    expect(readObject(readObject(lastFindManyArgs, 'where'), 'Status')).toBe(
      'paused',
    );
    expect(
      readObject(readObject(lastFindManyArgs, 'orderBy'), 'createdAt'),
    ).toBe('desc');
    const [first] = page.ads;
    expect(first).toBeDefined();
    expect(first).not.toHaveProperty('Status');
    expect(first).not.toHaveProperty('user');
    expect(first?.status).toBe('paused');
    expect(first?.advertiser).toEqual(advertiser);
    expect(first?.remainingBudget).toBe(750);
    expect(first?.daysRemaining).toBe(10);
    expect(page.pagination).toEqual({ current: 1, pages: 1, total: 2 });
  });

  it('returns only eligible targeted ads ordered by bid', async () => {
    const service = createService();
    const targeted = await service.targeted(viewerPrincipal, { limit: 5 });

    expect(targeted.ads.map((ad) => ad.id)).toEqual([
      'ad-high-bid',
      'ad-running',
      'ad-low-bid',
    ]);
    expect(targeted.count).toBe(3);
    expect(targeted.ads[0]).not.toHaveProperty('Status');
  });

  it('honours the targeted limit', async () => {
    const service = createService();
    const targeted = await service.targeted(viewerPrincipal, { limit: 1 });
    expect(targeted.ads.map((ad) => ad.id)).toEqual(['ad-high-bid']);
  });

  it('reports owner analytics and denies non-owners', async () => {
    const service = createService();
    const analytics = await service.analytics(ownerPrincipal, 'ad-owned');

    expect(analytics.overview).toEqual({
      impressions: 1000,
      clicks: 50,
      ctr: 5,
      conversions: 10,
      conversionRate: 1,
      reach: 500,
      frequency: 2,
      // (ctr 5 * 0.4 + conversionRate 1 * 0.4 + engagement 0.02 * 0.2) * 100
      performanceScore: 240,
    });
    expect(analytics.budget).toEqual({
      total: 1000,
      spent: 250,
      remaining: 750,
      currency: 'NGN',
    });
    expect(analytics.campaign.status).toBe('paused');
    expect(analytics.campaign.daysRemaining).toBe(10);

    await expect(
      service.analytics(otherPrincipal, 'ad-owned'),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(
      service.analytics(ownerPrincipal, 'missing'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('applies only allowlisted updates through the Status boundary', async () => {
    const service = createService();
    const updated = await service.updateOwned(ownerPrincipal, 'ad-owned', {
      title: 'Revised',
      status: 'running',
    });

    expect(readObject(lastUpdateData, 'Status')).toBe('running');
    expect(readObject(lastUpdateData, 'status')).toBeUndefined();
    expect(readObject(lastUpdateData, 'advertiserId')).toBeUndefined();
    expect(updated.title).toBe('Revised');

    await expect(
      service.updateOwned(otherPrincipal, 'ad-owned', { title: 'Hijacked' }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(
      service.updateOwned(ownerPrincipal, 'ad-owned', {
        advertiserId: 'intruder',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      service.updateOwned(ownerPrincipal, 'ad-running', { title: 'Blocked' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      service.updateOwned(ownerPrincipal, 'ad-running', { status: 'paused' }),
    ).resolves.toBeDefined();
  });

  it('deletes only paused ads owned by a two-factor satisfied owner', async () => {
    const service = createService();

    await expect(
      service.deleteOwned(otherPrincipal, 'ad-owned'),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(
      service.deleteOwned(ownerWithoutTwoFactor, 'ad-owned'),
    ).rejects.toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
    await expect(
      service.deleteOwned(ownerPrincipal, 'ad-running'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(deletedIds).toEqual([]);

    await expect(
      service.deleteOwned(ownerPrincipal, 'ad-owned'),
    ).resolves.toEqual({ deleted: true });
    expect(deletedIds).toEqual(['ad-owned']);
  });

  it('summarises the owner dashboard on the canonical status', async () => {
    const service = createService();
    const dashboard = await service.dashboard(ownerPrincipal, { days: 30 });

    expect(dashboard.summary.totalAds).toBe(2);
    expect(dashboard.summary.activeAds).toBe(1);
    expect(dashboard.summary.totalSpent).toBe(500);
    expect(dashboard.summary.totalImpressions).toBe(2000);
    expect(dashboard.summary.averageCTR).toBe(5);
    expect(dashboard.byStatus).toEqual({ paused: 1, running: 1 });
    expect(dashboard.byStatus).not.toHaveProperty('undefined');
    expect(dashboard.spending).toEqual({
      totalBudget: 2000,
      totalSpent: 500,
      remainingBudget: 1500,
    });
    expect(dashboard.topPerformingAds.map((ad) => ad.id)).toEqual([
      'ad-owned',
      'ad-running',
    ]);
  });
});

describe('ads controller routing', () => {
  const route = (
    method: string,
  ): {
    readonly path: unknown;
    readonly method: unknown;
    readonly guards: readonly unknown[] | undefined;
  } => {
    const handler: unknown = Reflect.get(AdsController.prototype, method);
    if (typeof handler !== 'function') {
      throw new Error(`AdsController.${method} is missing`);
    }
    const reflector = new Reflector();
    return {
      path: reflector.get<unknown>(PATH_METADATA, handler),
      method: reflector.get<unknown>(METHOD_METADATA, handler),
      guards: reflector.get<readonly unknown[]>(GUARDS_METADATA, handler),
    };
  };

  it('registers the exact legacy lifecycle routes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdsController)).toBe('api/ads');
    expect(Reflect.getMetadata(GUARDS_METADATA, AdsController)).toEqual([
      SessionGuard,
    ]);

    expect(route('create')).toMatchObject({
      path: '/',
      method: RequestMethod.POST,
    });
    expect(route('listOwned')).toMatchObject({
      path: '/',
      method: RequestMethod.GET,
    });
    expect(route('targeted')).toMatchObject({
      path: 'targeted',
      method: RequestMethod.GET,
    });
    expect(route('dashboard')).toMatchObject({
      path: 'dashboard',
      method: RequestMethod.GET,
    });
    expect(route('analytics')).toMatchObject({
      path: ':adId/analytics',
      method: RequestMethod.GET,
    });
    expect(route('updateOwned')).toMatchObject({
      path: ':adId',
      method: RequestMethod.PUT,
    });
    expect(route('deleteOwned')).toMatchObject({
      path: ':adId',
      method: RequestMethod.DELETE,
    });
  });

  it('requires two-factor confirmation only for deletion', () => {
    expect(route('deleteOwned').guards).toEqual([SessionGuard, TwoFactorGuard]);
    expect(route('updateOwned').guards).toBeUndefined();
  });
});
