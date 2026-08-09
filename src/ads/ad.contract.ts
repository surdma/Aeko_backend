import { z } from 'zod';

import { DomainError } from '../common/errors/domain.error';

export const AD_STATUSES = [
  'draft',
  'pending',
  'approved',
  'rejected',
  'running',
  'paused',
  'completed',
  'expired',
] as const;

export type AdStatus = (typeof AD_STATUSES)[number];
export type AdPricingModel = 'cpm' | 'cpc' | 'cpa';

export interface AdRange {
  readonly min: number;
  readonly max: number;
}

export interface AdTargeting {
  readonly age: AdRange | null;
  readonly location: readonly string[];
  readonly followersRange: AdRange | null;
}

export interface AdBudget {
  readonly total: number;
  readonly daily: number | null;
  readonly spent: number;
  readonly currency: string;
}

export interface AdPricing {
  readonly model: AdPricingModel;
  readonly bidAmount: number;
  readonly maxBid: number | null;
}

export interface AdSchedule {
  readonly startDate: string;
  readonly endDate: string;
  readonly timezone: string;
  readonly dayParting: Readonly<{
    enabled: boolean;
    hours: readonly number[];
  }>;
}

export interface AdCampaign {
  readonly objective: string;
  readonly schedule: AdSchedule;
}

export interface AdCallToAction {
  readonly type: string;
  readonly url: string | null;
}

export interface AdCreate {
  readonly title: string;
  readonly description: string;
  readonly mediaType: string;
  readonly mediaUrl: string | null;
  readonly mediaUrls: readonly string[];
  readonly targetAudience: AdTargeting;
  readonly budget: AdBudget;
  readonly pricing: AdPricing;
  readonly campaign: AdCampaign;
  readonly callToAction: AdCallToAction;
  readonly placement: Readonly<Record<string, boolean>>;
  readonly frequency: Readonly<{ cap: number; currentCap: number }>;
}

export interface AdUpdate {
  readonly title?: string;
  readonly description?: string;
  readonly mediaType?: string;
  readonly mediaUrl?: string | null;
  readonly mediaUrls?: readonly string[];
  readonly targetAudience?: AdTargeting;
  readonly budget?: AdBudget;
  readonly pricing?: AdPricing;
  readonly campaign?: AdCampaign;
  readonly callToAction?: AdCallToAction;
  readonly placement?: Readonly<Record<string, boolean>>;
  readonly frequency?: Readonly<{ cap: number; currentCap: number }>;
  readonly status?: AdStatus;
}

export interface AdListQuery {
  readonly page: number;
  readonly limit: number;
  readonly status: AdStatus | null;
}

export interface AdTargetedQuery {
  readonly limit: number;
}

export interface AnalyticsQuery {
  readonly from: string | null;
  readonly to: string | null;
}

export interface TrackEvent {
  readonly adId: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
  readonly conversionValue: number;
  readonly conversionType: string | null;
}

export interface ReviewDecision {
  readonly status: 'approved' | 'rejected';
  readonly reason: string | null;
}

export interface AdAnalytics {
  readonly impressions: number;
  readonly clicks: number;
  readonly ctr: number;
  readonly conversions: number;
  readonly conversionRate: number;
  readonly reach: number;
  readonly frequency: number;
}

export interface AdView {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly mediaType: string;
  readonly mediaUrl: string | null;
  readonly mediaUrls: readonly string[];
  readonly status: AdStatus;
  readonly advertiserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdPage {
  readonly ads: readonly AdView[];
  readonly pagination: Readonly<{
    current: number;
    pages: number;
    total: number;
  }>;
}

const finitePositive = z.number().finite().positive();
const httpsUrl = z.string().trim().url().startsWith('https://').max(2048);
const nullableHttpsUrl = httpsUrl.nullable();
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);

const rangeSchema = z
  .object({
    min: z.number().finite().nonnegative(),
    max: z.number().finite().nonnegative(),
  })
  .strict()
  .refine((value) => value.max >= value.min, {
    message: 'max must be at least min',
  });

const targetingSchema = z
  .object({
    age: rangeSchema.nullable().default(null),
    location: z.array(boundedText(200)).max(100).default([]),
    followersRange: rangeSchema.nullable().default(null),
  })
  .strict();

const budgetInputSchema = z
  .object({
    total: finitePositive,
    daily: finitePositive.nullable().default(null),
    currency: z.string().trim().min(3).max(8).default('USD'),
  })
  .strict();

const budgetUpdateSchema = budgetInputSchema.extend({
  spent: z.number().finite().nonnegative().default(0),
});

const pricingSchema = z
  .object({
    model: z.enum(['cpm', 'cpc', 'cpa']).default('cpm'),
    bidAmount: finitePositive,
    maxBid: finitePositive.nullable().default(null),
  })
  .strict()
  .refine((value) => value.maxBid === null || value.maxBid >= value.bidAmount, {
    message: 'maxBid must be at least bidAmount',
    path: ['maxBid'],
  });

const dayPartingSchema = z
  .object({
    enabled: z.boolean().default(false),
    hours: z.array(z.number().int().min(0).max(23)).max(24).default([]),
  })
  .strict()
  .default({ enabled: false, hours: [] });

const scheduleSchema = z
  .object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    timezone: boundedText(100).default('UTC'),
    dayParting: dayPartingSchema,
  })
  .strict();

const campaignSchema = z
  .object({ objective: boundedText(200), schedule: scheduleSchema })
  .strict();

const callToActionSchema = z
  .object({
    type: boundedText(100).default('learn_more'),
    url: nullableHttpsUrl.default(null),
  })
  .strict();

const placementSchema = z.record(
  z.string().trim().min(1).max(100),
  z.boolean(),
);
const frequencySchema = z
  .object({
    cap: z.number().int().min(1).max(100).default(3),
    currentCap: z.number().int().nonnegative().default(0),
  })
  .strict();

const adCreateSchema = z
  .object({
    title: boundedText(200),
    description: boundedText(5000),
    mediaType: boundedText(50),
    mediaUrl: nullableHttpsUrl.default(null),
    mediaUrls: z.array(httpsUrl).max(20).default([]),
    targetAudience: targetingSchema.default({
      age: null,
      location: [],
      followersRange: null,
    }),
    budget: budgetInputSchema,
    pricing: pricingSchema,
    campaign: campaignSchema,
    callToAction: callToActionSchema.default({
      type: 'learn_more',
      url: null,
    }),
    placement: placementSchema.default({ feed: true }),
  })
  .strict();

const adUpdateSchema = z
  .object({
    title: boundedText(200).optional(),
    description: boundedText(5000).optional(),
    mediaType: boundedText(50).optional(),
    mediaUrl: nullableHttpsUrl.optional(),
    mediaUrls: z.array(httpsUrl).max(20).optional(),
    targetAudience: targetingSchema.optional(),
    budget: budgetUpdateSchema.optional(),
    pricing: pricingSchema.optional(),
    campaign: campaignSchema.optional(),
    callToAction: callToActionSchema.optional(),
    placement: placementSchema.optional(),
    frequency: frequencySchema.optional(),
    status: z.enum(AD_STATUSES).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'update is required',
  });

const queryInteger = (fallback: number, maximum: number) =>
  z.coerce
    .number()
    .int()
    .catch(fallback)
    .transform((value) => Math.min(maximum, Math.max(1, value)));

const listQuerySchema = z
  .object({
    page: queryInteger(1, 1_000_000).default(1),
    limit: queryInteger(10, 100).default(10),
    status: z.enum(AD_STATUSES).nullable().default(null),
  })
  .strip();

const targetedQuerySchema = z
  .object({ limit: queryInteger(5, 50).default(5) })
  .strip();

const metadataSchema = z.record(
  z.string().trim().min(1).max(100),
  z.union([z.string().max(500), z.number().finite(), z.boolean()]),
);

const trackEventSchema = z
  .object({
    adId: boundedText(100),
    metadata: metadataSchema.default({}),
    conversionValue: z.number().finite().nonnegative().default(0),
    conversionType: boundedText(100).nullable().default(null),
  })
  .strict();

const reviewDecisionSchema = z
  .object({
    status: z.enum(['approved', 'rejected']),
    reason: boundedText(1000).nullable().default(null),
  })
  .strict();

const analyticsQuerySchema = z
  .object({
    from: z.coerce.date().nullable().default(null),
    to: z.coerce.date().nullable().default(null),
  })
  .strip()
  .refine(
    (value) =>
      value.from === null || value.to === null || value.to >= value.from,
    {
      message: 'to must not precede from',
      path: ['to'],
    },
  );

const issueFields = (issue: z.core.$ZodIssue): readonly string[] => {
  if (issue.code === 'unrecognized_keys') {
    return issue.keys;
  }
  return [issue.path.length > 0 ? issue.path.join('.') : ''];
};

const validationFailure = (scope: string, error: z.ZodError): never => {
  const fields = error.issues.flatMap((issue) =>
    issueFields(issue).map((field) => (field === '' ? scope : field)),
  );
  throw new DomainError(
    'VALIDATION_FAILED',
    `Invalid ${scope}: ${fields.join(', ')}`,
    {
      [scope]: error.issues.map((issue) => issue.message),
    },
  );
};

const parseWithScope = <T>(
  schema: z.ZodType<T>,
  input: unknown,
  scope: string,
): T => {
  const result = schema.safeParse(input);
  return result.success ? result.data : validationFailure(scope, result.error);
};

const normalizeTargeting = (
  value: z.output<typeof targetingSchema>,
): AdTargeting =>
  Object.freeze({
    age: value.age,
    location: Object.freeze([...value.location]),
    followersRange: value.followersRange,
  });

const normalizeBudget = (
  value:
    z.output<typeof budgetInputSchema> | z.output<typeof budgetUpdateSchema>,
): AdBudget =>
  Object.freeze({
    total: value.total,
    daily: value.daily,
    spent: 'spent' in value ? value.spent : 0,
    currency: value.currency,
  });

const normalizePricing = (value: z.output<typeof pricingSchema>): AdPricing =>
  Object.freeze({ ...value });

const normalizeCampaign = (
  value: z.output<typeof campaignSchema>,
): AdCampaign =>
  Object.freeze({
    objective: value.objective,
    schedule: Object.freeze({
      startDate: value.schedule.startDate.toISOString(),
      endDate: value.schedule.endDate.toISOString(),
      timezone: value.schedule.timezone,
      dayParting: Object.freeze({
        enabled: value.schedule.dayParting.enabled,
        hours: Object.freeze([...value.schedule.dayParting.hours]),
      }),
    }),
  });

const ensureSchedule = (
  campaign: AdCampaign,
  now: Date,
  scope: string,
): void => {
  const startDate = new Date(campaign.schedule.startDate);
  const endDate = new Date(campaign.schedule.endDate);
  if (startDate < now || endDate <= startDate) {
    throw new DomainError(
      'VALIDATION_FAILED',
      `Invalid ${scope}: campaign.schedule`,
      {
        [scope]: [
          'Start date cannot be in the past and end date must be after start date.',
        ],
      },
    );
  }
};

export const parseAdCreate = (input: unknown, now: Date): AdCreate => {
  const value = parseWithScope(adCreateSchema, input, 'campaign');
  const campaign = normalizeCampaign(value.campaign);
  ensureSchedule(campaign, now, 'campaign');
  return Object.freeze({
    title: value.title,
    description: value.description,
    mediaType: value.mediaType,
    mediaUrl: value.mediaUrl,
    mediaUrls: Object.freeze([...value.mediaUrls]),
    targetAudience: normalizeTargeting(value.targetAudience),
    budget: normalizeBudget(value.budget),
    pricing: normalizePricing(value.pricing),
    campaign,
    callToAction: Object.freeze({ ...value.callToAction }),
    placement: Object.freeze({ ...value.placement }),
    frequency: Object.freeze({ cap: 3, currentCap: 0 }),
  });
};

export const parseAdUpdate = (input: unknown): AdUpdate => {
  const value = parseWithScope(adUpdateSchema, input, 'ad update');
  return Object.freeze({
    ...(value.title !== undefined ? { title: value.title } : {}),
    ...(value.description !== undefined
      ? { description: value.description }
      : {}),
    ...(value.mediaType !== undefined ? { mediaType: value.mediaType } : {}),
    ...(value.mediaUrl !== undefined ? { mediaUrl: value.mediaUrl } : {}),
    ...(value.mediaUrls !== undefined
      ? { mediaUrls: Object.freeze([...value.mediaUrls]) }
      : {}),
    ...(value.targetAudience !== undefined
      ? { targetAudience: normalizeTargeting(value.targetAudience) }
      : {}),
    ...(value.budget !== undefined
      ? { budget: normalizeBudget(value.budget) }
      : {}),
    ...(value.pricing !== undefined
      ? { pricing: normalizePricing(value.pricing) }
      : {}),
    ...(value.campaign !== undefined
      ? { campaign: normalizeCampaign(value.campaign) }
      : {}),
    ...(value.callToAction !== undefined
      ? { callToAction: Object.freeze({ ...value.callToAction }) }
      : {}),
    ...(value.placement !== undefined
      ? { placement: Object.freeze({ ...value.placement }) }
      : {}),
    ...(value.frequency !== undefined
      ? { frequency: Object.freeze({ ...value.frequency }) }
      : {}),
    ...(value.status !== undefined ? { status: value.status } : {}),
  });
};

export const parseAdListQuery = (input: unknown): AdListQuery =>
  Object.freeze(parseWithScope(listQuerySchema, input, 'ad list query'));

export const parseAdTargetedQuery = (input: unknown): AdTargetedQuery =>
  Object.freeze(
    parseWithScope(targetedQuerySchema, input, 'targeted ad query'),
  );

export const parseTrackEvent = (input: unknown): TrackEvent => {
  const value = parseWithScope(trackEventSchema, input, 'track event');
  return Object.freeze({
    ...value,
    metadata: Object.freeze({ ...value.metadata }),
  });
};

export const parseReviewDecision = (input: unknown): ReviewDecision =>
  Object.freeze(parseWithScope(reviewDecisionSchema, input, 'review decision'));

export const parseAnalyticsQuery = (input: unknown): AnalyticsQuery => {
  const value = parseWithScope(analyticsQuerySchema, input, 'analytics query');
  return Object.freeze({
    from: value.from?.toISOString() ?? null,
    to: value.to?.toISOString() ?? null,
  });
};
