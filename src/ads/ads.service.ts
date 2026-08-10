import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import { PrismaService } from '../database/prisma/prisma.service';
import {
  parseAdCreate,
  parseAdUpdate,
  parseReviewDecision,
  parseTrackEvent,
  type AdAnalyticsView,
  type AdDashboard,
  type AdDashboardEntry,
  type AdListQuery,
  type AdPage,
  type AdStatus,
  type AdTargetedQuery,
  type AdView,
  type DashboardQuery,
  type ReviewListQuery,
  type JsonValue,
  type TargetedAds,
} from './ad.contract';
import {
  createAdPrismaClient,
  toJsonValue,
  type AdPrismaClient,
  type AdRecord,
  type AdTransactionClient,
  type AdViewerRecord,
  type AdWriteData,
} from './ad-prisma.client';

const DAY_IN_MILLISECONDS = 1000 * 60 * 60 * 24;

export interface ImpressionResult {
  readonly impressions: number;
  readonly ctr: number;
  readonly reach: number;
}

export interface ClickResult {
  readonly clicks: number;
  readonly ctr: number;
  readonly budgetSpent: number;
  readonly remainingBudget: number;
}

export interface ConversionResult {
  readonly conversions: number;
  readonly conversionRate: number;
  readonly budgetSpent: number;
}

/** Statuses an owner may move a running ad into without pausing it first. */
const RUNNING_TRANSITIONS: readonly AdStatus[] = ['paused', 'running'];

@Injectable()
export class AdsService {
  constructor(private readonly prisma: PrismaService) {}

  private get ads(): AdPrismaClient {
    return createAdPrismaClient(this.prisma.db);
  }

  async create(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<AdView> {
    const now = new Date();
    const input = parseAdCreate(body, now);
    const data: AdWriteData = {
      title: input.title,
      description: input.description,
      mediaType: input.mediaType,
      mediaUrl: input.mediaUrl,
      mediaUrls: input.mediaUrls,
      targetAudience: toJsonValue(input.targetAudience),
      budget: toJsonValue(input.budget),
      pricing: toJsonValue(input.pricing),
      campaign: toJsonValue(input.campaign),
      callToAction: toJsonValue(input.callToAction),
      placement: toJsonValue(input.placement),
      frequency: toJsonValue(input.frequency),
      advertiserId: principal.userId,
      analytics: initialAnalytics(),
    };
    const created = await this.ads.create(data, 'pending');
    return projectAd(created, now);
  }

  async listOwned(
    principal: AuthenticatedPrincipal,
    query: AdListQuery,
  ): Promise<AdPage> {
    const now = new Date();
    const [records, total] = await Promise.all([
      this.ads.findOwned({
        advertiserId: principal.userId,
        status: query.status,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.ads.countOwned(principal.userId, query.status),
    ]);
    return Object.freeze({
      ads: Object.freeze(records.map((record) => projectAd(record, now))),
      pagination: Object.freeze({
        current: query.page,
        pages: Math.ceil(total / query.limit),
        total,
      }),
    });
  }

  async targeted(
    principal: AuthenticatedPrincipal,
    query: AdTargetedQuery,
  ): Promise<TargetedAds> {
    const now = new Date();
    const [viewer, running] = await Promise.all([
      this.ads.findViewer(principal.userId),
      this.ads.findRunning(),
    ]);
    const eligible = running
      .filter((record) => isEligible(record, viewer, now))
      .sort((left, right) => bidAmount(right) - bidAmount(left))
      .slice(0, query.limit);
    return Object.freeze({
      ads: Object.freeze(eligible.map((record) => projectAd(record, now))),
      count: eligible.length,
    });
  }

  trackImpression(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<ImpressionResult> {
    void principal;
    const event = parseTrackEvent(body);
    return this.ads.runSerializable(async (transaction) => {
      const record = await requireRunning(transaction, event.adId);
      const analytics = asObject(record.analytics);
      const impressions = numberOf(analytics.impressions) + 1;
      const reach = numberOf(analytics.reach) + 1;
      const clicks = numberOf(analytics.clicks);
      const ctr = ratio(clicks, impressions);
      const next: Record<string, JsonValue> = {
        ...analytics,
        impressions,
        reach,
        clicks,
        ctr,
        frequency: round(impressions / reach, 2),
        demographics: withAgeBucket(analytics.demographics, event.metadata),
      };
      // CPM is charged per thousand impressions, so only the thousandth
      // impression in a batch draws down the budget.
      const charge =
        pricingModel(record) === 'cpm' && impressions % 1000 === 0
          ? bidAmount(record)
          : 0;
      const budget = chargeBudget(record, charge);
      await transaction.update(
        event.adId,
        { analytics: next, budget },
        completionStatus(budget),
      );
      return Object.freeze({ impressions, ctr, reach });
    });
  }

  /** Legacy alias: `/api/ads/track-view` has always been an impression. */
  trackView(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<ImpressionResult> {
    return this.trackImpression(principal, body);
  }

  trackClick(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<ClickResult> {
    void principal;
    const event = parseTrackEvent(body);
    return this.ads.runSerializable(async (transaction) => {
      const record = await requireRunning(transaction, event.adId);
      const analytics = asObject(record.analytics);
      const clicks = numberOf(analytics.clicks) + 1;
      const impressions = numberOf(analytics.impressions);
      const ctr = ratio(clicks, impressions);
      const next: Record<string, JsonValue> = {
        ...analytics,
        clicks,
        impressions,
        ctr,
      };
      const charge = pricingModel(record) === 'cpc' ? bidAmount(record) : 0;
      const budget = chargeBudget(record, charge);
      await transaction.update(
        event.adId,
        { analytics: next, budget },
        completionStatus(budget),
      );
      const spent = numberOf(budget.spent);
      return Object.freeze({
        clicks,
        ctr,
        budgetSpent: spent,
        remainingBudget: numberOf(budget.total) - spent,
      });
    });
  }

  trackConversion(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<ConversionResult> {
    void principal;
    const event = parseTrackEvent(body);
    return this.ads.runSerializable(async (transaction) => {
      const record = await requireRunning(transaction, event.adId);
      const analytics = asObject(record.analytics);
      const conversions = numberOf(analytics.conversions) + 1;
      const clicks = numberOf(analytics.clicks);
      const conversionRate = ratio(conversions, clicks);
      const next: Record<string, JsonValue> = {
        ...analytics,
        conversions,
        clicks,
        conversionRate,
      };
      const charge = pricingModel(record) === 'cpa' ? bidAmount(record) : 0;
      const budget = chargeBudget(record, charge);
      await transaction.update(
        event.adId,
        { analytics: next, budget },
        completionStatus(budget),
      );
      return Object.freeze({
        conversions,
        conversionRate,
        budgetSpent: numberOf(budget.spent),
      });
    });
  }

  async analytics(
    principal: AuthenticatedPrincipal,
    adId: string,
  ): Promise<AdAnalyticsView> {
    const now = new Date();
    const record = await this.requireOwned(principal, adId);
    const analytics = asObject(record.analytics);
    const budget = asObject(record.budget);
    const total = numberOf(budget.total);
    const spent = numberOf(budget.spent);
    return Object.freeze({
      overview: Object.freeze({
        impressions: numberOf(analytics.impressions),
        clicks: numberOf(analytics.clicks),
        ctr: numberOf(analytics.ctr),
        conversions: numberOf(analytics.conversions),
        conversionRate: numberOf(analytics.conversionRate),
        reach: numberOf(analytics.reach),
        frequency: numberOf(analytics.frequency),
        performanceScore: performanceScore(record),
      }),
      budget: Object.freeze({
        total,
        spent,
        remaining: total - spent,
        currency: stringOf(budget.currency, 'USD'),
      }),
      engagement: analytics.engagements ?? null,
      demographics: analytics.demographics ?? null,
      performance: analytics.performance ?? null,
      campaign: Object.freeze({
        daysRemaining: daysRemaining(record, now),
        status: record.status,
        objective: stringOf(asObject(record.campaign).objective, ''),
      }),
    });
  }

  async updateOwned(
    principal: AuthenticatedPrincipal,
    adId: string,
    body: unknown,
  ): Promise<AdView> {
    const now = new Date();
    const update = parseAdUpdate(body);
    const record = await this.requireOwned(principal, adId);

    // Legacy rule: a running ad may only be paused or left running.
    if (
      record.status === 'running' &&
      (update.status === undefined ||
        !RUNNING_TRANSITIONS.includes(update.status))
    ) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'Cannot modify a running advertisement. Pause the advertisement first.',
      );
    }

    const { status, ...rest } = update;
    const data: AdWriteData = Object.fromEntries(
      Object.entries(rest).map(([key, value]) => [key, toJsonValue(value)]),
    );
    const updated = await this.ads.update(
      adId,
      { ...data, ...(update.mediaUrls ? { mediaUrls: update.mediaUrls } : {}) },
      status ?? null,
    );
    return projectAd(updated, now);
  }

  async deleteOwned(
    principal: AuthenticatedPrincipal,
    adId: string,
  ): Promise<{ readonly deleted: true }> {
    if (principal.twoFactorEnabled && !principal.twoFactorSatisfied) {
      throw new DomainError(
        'TWO_FACTOR_REQUIRED',
        'Confirm two-factor authentication to delete an advertisement.',
      );
    }
    const record = await this.requireOwned(principal, adId);

    // Legacy read this off `ad.status`, which never exists on the row, so a
    // running ad was always deletable. The canonical column is checked here.
    if (record.status === 'running') {
      throw new DomainError(
        'VALIDATION_FAILED',
        'Cannot delete a running advertisement. Pause it first.',
      );
    }
    await this.ads.delete(adId);
    return Object.freeze({ deleted: true as const });
  }

  async dashboard(
    principal: AuthenticatedPrincipal,
    query: DashboardQuery,
  ): Promise<AdDashboard> {
    const now = new Date();
    const from = new Date(now.getTime() - query.days * DAY_IN_MILLISECONDS);
    const records = await this.ads.findCreatedBetween(
      principal.userId,
      from,
      now,
    );

    const totals = records.reduce(
      (accumulator, record) => {
        const analytics = asObject(record.analytics);
        const budget = asObject(record.budget);
        return {
          spent: accumulator.spent + numberOf(budget.spent),
          budget: accumulator.budget + numberOf(budget.total),
          impressions:
            accumulator.impressions + numberOf(analytics.impressions),
          clicks: accumulator.clicks + numberOf(analytics.clicks),
          conversions:
            accumulator.conversions + numberOf(analytics.conversions),
          ctr: accumulator.ctr + numberOf(analytics.ctr),
        };
      },
      {
        spent: 0,
        budget: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        ctr: 0,
      },
    );

    // Legacy keyed this on `ad.status`, producing a single "undefined" bucket.
    const byStatus = records.reduce<Record<string, number>>(
      (accumulator, record) => ({
        ...accumulator,
        [record.status]: (accumulator[record.status] ?? 0) + 1,
      }),
      {},
    );

    return Object.freeze({
      summary: Object.freeze({
        totalAds: records.length,
        activeAds: records.filter((record) => record.status === 'running')
          .length,
        totalSpent: totals.spent,
        totalImpressions: totals.impressions,
        totalClicks: totals.clicks,
        totalConversions: totals.conversions,
        averageCTR:
          records.length > 0 ? round(totals.ctr / records.length, 2) : 0,
      }),
      byStatus: Object.freeze(byStatus),
      topPerformingAds: Object.freeze(topPerformers(records)),
      spending: Object.freeze({
        totalBudget: totals.budget,
        totalSpent: totals.spent,
        remainingBudget: totals.budget - totals.spent,
      }),
    });
  }

  async listForReview(
    principal: AuthenticatedPrincipal,
    query: ReviewListQuery,
  ): Promise<AdPage> {
    requireAdministrator(principal);
    const now = new Date();
    // Legacy defaulted the queue to pending; an explicit filter still wins.
    const status: AdStatus = query.status ?? 'pending';
    const [records, total] = await Promise.all([
      this.ads.findByStatus({
        status,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.ads.countByStatus(status),
    ]);
    return Object.freeze({
      ads: Object.freeze(records.map((record) => projectAd(record, now))),
      pagination: Object.freeze({
        current: query.page,
        pages: Math.ceil(total / query.limit),
        total,
      }),
    });
  }

  async review(
    principal: AuthenticatedPrincipal,
    adId: string,
    body: unknown,
  ): Promise<AdView> {
    requireAdministrator(principal);
    if (principal.twoFactorEnabled && !principal.twoFactorSatisfied) {
      throw new DomainError(
        'TWO_FACTOR_REQUIRED',
        'Confirm two-factor authentication to review an advertisement.',
      );
    }
    const decision = parseReviewDecision(body);
    const now = new Date();
    const record = await this.ads.findById(adId);
    if (record === null) {
      throw new DomainError('NOT_FOUND', 'Advertisement not found.');
    }
    const review: JsonValue = {
      reviewedBy: principal.userId,
      reviewedAt: now.toISOString(),
      rejectionReason: decision.status === 'rejected' ? decision.reason : null,
      feedback: decision.feedback,
    };
    const updated = await this.ads.update(
      adId,
      { review },
      decision.status === 'approved' ? 'running' : 'rejected',
    );
    return projectAd(updated, now);
  }

  private async requireOwned(
    principal: AuthenticatedPrincipal,
    adId: string,
  ): Promise<AdRecord> {
    const record = await this.ads.findById(adId);
    if (record === null) {
      throw new DomainError('NOT_FOUND', 'Advertisement not found.');
    }
    if (record.advertiserId !== principal.userId) {
      throw new DomainError(
        'AUTHORIZATION_DENIED',
        'You do not have access to this advertisement.',
      );
    }
    return record;
  }
}

function requireAdministrator(principal: AuthenticatedPrincipal): void {
  if (!principal.isAdmin) {
    throw new DomainError(
      'AUTHORIZATION_DENIED',
      'Administrator access is required.',
    );
  }
}

const requireRunning = async (
  transaction: AdTransactionClient,
  adId: string,
): Promise<AdRecord> => {
  const record = await transaction.findById(adId);
  if (record === null) {
    throw new DomainError('NOT_FOUND', 'Advertisement not found.');
  }
  if (record.status !== 'running') {
    throw new DomainError(
      'VALIDATION_FAILED',
      'That advertisement is not currently running.',
    );
  }
  return record;
};

const pricingModel = (record: AdRecord): string =>
  stringOf(asObject(record.pricing).model, 'cpm');

const chargeBudget = (
  record: AdRecord,
  charge: number,
): Readonly<Record<string, JsonValue>> => {
  const budget = asObject(record.budget);
  return Object.freeze({
    ...budget,
    total: numberOf(budget.total),
    spent: numberOf(budget.spent) + charge,
  });
};

/**
 * Legacy wrote the lowercase `status` field here, which Prisma does not know:
 * an exhausted budget raised an unknown-argument error instead of completing
 * the ad. Completion now goes through the canonical column.
 */
const completionStatus = (
  budget: Readonly<Record<string, JsonValue>>,
): AdStatus | null =>
  numberOf(budget.spent) >= numberOf(budget.total) ? 'completed' : null;

/** Legacy stored these as `toFixed(2)` strings; they are numbers here. */
const ratio = (numerator: number, denominator: number): number =>
  denominator > 0 ? round((numerator / denominator) * 100, 2) : 0;

const AGE_BUCKETS: readonly (readonly [number, string])[] = [
  [17, 'under-18'],
  [24, '18-24'],
  [34, '25-34'],
  [44, '35-44'],
  [54, '45-54'],
  [64, '55-64'],
];

const ageRange = (age: number): string =>
  AGE_BUCKETS.find(([ceiling]) => age <= ceiling)?.[1] ?? '65+';

const withAgeBucket = (
  demographics: JsonValue | undefined,
  metadata: Readonly<Record<string, string | number | boolean>>,
): JsonValue => {
  const current = asObject(demographics);
  const age = metadata.age;
  if (typeof age !== 'number' || !Number.isFinite(age)) {
    return Object.freeze({ ...current });
  }
  const range = ageRange(age);
  const buckets = Array.isArray(current.age) ? current.age : [];
  const existing = buckets.filter(isJsonObject);
  const matched = existing.some((bucket) => bucket.range === range);
  const next = matched
    ? existing.map((bucket) =>
        bucket.range === range
          ? { ...bucket, count: numberOf(bucket.count) + 1 }
          : bucket,
      )
    : [...existing, { range, count: 1 }];
  return Object.freeze({ ...current, age: Object.freeze(next) });
};

const topPerformers = (
  records: readonly AdRecord[],
): readonly AdDashboardEntry[] =>
  records
    .filter((record) => numberOf(asObject(record.analytics).impressions) > 0)
    .map((record) => ({
      id: record.id,
      title: record.title,
      performanceScore: performanceScore(record),
      ctr: numberOf(asObject(record.analytics).ctr),
      conversions: numberOf(asObject(record.analytics).conversions),
    }))
    .sort((left, right) => right.performanceScore - left.performanceScore)
    .slice(0, 5);

const projectAd = (record: AdRecord, now: Date): AdView => {
  const budget = asObject(record.budget);
  return Object.freeze({
    id: record.id,
    title: record.title,
    description: record.description,
    mediaType: record.mediaType,
    mediaUrl: record.mediaUrl,
    mediaUrls: record.mediaUrls,
    targetAudience: record.targetAudience,
    budget: record.budget,
    pricing: record.pricing,
    campaign: record.campaign,
    callToAction: record.callToAction,
    placement: record.placement,
    frequency: record.frequency,
    analytics: record.analytics,
    status: record.status,
    advertiserId: record.advertiserId,
    advertiser: record.advertiser,
    performanceScore: performanceScore(record),
    remainingBudget: numberOf(budget.total) - numberOf(budget.spent),
    daysRemaining: daysRemaining(record, now),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
};

const isEligible = (
  record: AdRecord,
  viewer: AdViewerRecord | null,
  now: Date,
): boolean => {
  const schedule = asObject(asObject(record.campaign).schedule);
  const start = dateOf(schedule.startDate);
  const end = dateOf(schedule.endDate);
  if (start === null || end === null) return false;
  if (now < start || now > end) return false;

  const budget = asObject(record.budget);
  if (numberOf(budget.spent) >= numberOf(budget.total)) return false;
  if (viewer === null) return true;

  const targeting = asObject(record.targetAudience);
  const age = asObject(targeting.age);
  if (
    viewer.age !== null &&
    targeting.age !== null &&
    targeting.age !== undefined
  ) {
    if (viewer.age < numberOf(age.min) || viewer.age > numberOf(age.max)) {
      return false;
    }
  }

  const locations = targeting.location;
  if (
    viewer.location !== null &&
    Array.isArray(locations) &&
    locations.length > 0
  ) {
    if (!locations.includes(viewer.location)) return false;
  }

  const followersRange = targeting.followersRange;
  if (followersRange !== null && followersRange !== undefined) {
    const range = asObject(followersRange);
    if (
      viewer.followerCount < numberOf(range.min) ||
      viewer.followerCount > numberOf(range.max)
    ) {
      return false;
    }
  }
  return true;
};

/**
 * Mirrors the legacy weighting: CTR 40%, conversion rate 40%, engagement 20%.
 */
const performanceScore = (record: AdRecord): number => {
  const analytics = asObject(record.analytics);
  const impressions = numberOf(analytics.impressions);
  if (impressions === 0) return 0;
  const engagements = asObject(analytics.engagements);
  const engagementRate =
    (numberOf(engagements.likes) +
      numberOf(engagements.shares) +
      numberOf(engagements.comments)) /
    impressions;
  return Math.round(
    (numberOf(analytics.ctr) * 0.4 +
      numberOf(analytics.conversionRate) * 0.4 +
      engagementRate * 0.2) *
      100,
  );
};

const daysRemaining = (record: AdRecord, now: Date): number => {
  const end = dateOf(asObject(asObject(record.campaign).schedule).endDate);
  if (end === null) return 0;
  return Math.ceil((end.getTime() - now.getTime()) / DAY_IN_MILLISECONDS);
};

const bidAmount = (record: AdRecord): number =>
  numberOf(asObject(record.pricing).bidAmount);

const isJsonObject = (
  value: JsonValue | undefined,
): value is Readonly<Record<string, JsonValue>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asObject = (
  value: JsonValue | undefined,
): Readonly<Record<string, JsonValue>> => (isJsonObject(value) ? value : {});

/** Legacy stored CTR and frequency as `toFixed` strings; both are accepted. */
const numberOf = (value: JsonValue | undefined): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const stringOf = (value: JsonValue | undefined, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

const dateOf = (value: JsonValue | undefined): Date | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const initialAnalytics = (): JsonValue =>
  Object.freeze({
    impressions: 0,
    clicks: 0,
    ctr: 0,
    conversions: 0,
    conversionRate: 0,
    reach: 0,
    frequency: 0,
    engagements: { likes: 0, shares: 0, comments: 0, saves: 0 },
    demographics: { age: [], gender: [], location: [] },
    performance: {
      bestPerformingTime: null,
      topLocations: [],
      topDevices: [],
    },
  });
