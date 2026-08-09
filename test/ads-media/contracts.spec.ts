import {
  parseAdCreate,
  parseAdListQuery,
  parseAdTargetedQuery,
  parseAdUpdate,
  parseAnalyticsQuery,
  parseReviewDecision,
  parseTrackEvent,
} from '../../src/ads/ad.contract';
import {
  parseImageEffect,
  parseVideoEffect,
} from '../../src/providers/media-processing/media-processing.contract';

const now = new Date('2026-08-09T12:00:00.000Z');

const validCreate = {
  title: 'Campaign',
  description: 'A useful campaign',
  mediaType: 'image',
  mediaUrl: 'https://cdn.example.com/ad.png',
  mediaUrls: ['https://cdn.example.com/ad-2.png'],
  targetAudience: {
    age: { min: 18, max: 65 },
    location: ['Lagos'],
    followersRange: { min: 0, max: 10000 },
  },
  budget: { total: 1000, daily: 100, currency: 'NGN' },
  pricing: { model: 'cpm', bidAmount: 25, maxBid: 50 },
  campaign: {
    objective: 'awareness',
    schedule: {
      startDate: '2026-08-10T12:00:00.000Z',
      endDate: '2026-08-20T12:00:00.000Z',
      timezone: 'Africa/Lagos',
      dayParting: { enabled: true, hours: [8, 12, 17] },
    },
  },
  callToAction: { type: 'learn_more', url: 'https://example.com/offer' },
  placement: { feed: true },
};

describe('ad contracts', () => {
  it('normalizes bounded list and targeted queries without undefined values', () => {
    expect(parseAdListQuery({ page: '0', limit: '500' })).toEqual({
      page: 1,
      limit: 100,
      status: null,
    });
    expect(parseAdTargetedQuery({ limit: '0' })).toEqual({ limit: 1 });
  });

  it('accepts a complete campaign and supplies stable defaults', () => {
    expect(parseAdCreate(validCreate, now)).toEqual({
      ...validCreate,
      budget: { total: 1000, daily: 100, spent: 0, currency: 'NGN' },
      frequency: { cap: 3, currentCap: 0 },
    });
  });

  it('rejects incomplete, past, reversed, insecure, and non-finite campaigns', () => {
    expect(() => parseAdCreate({ title: 'x' }, now)).toThrow('campaign');
    expect(() =>
      parseAdCreate(
        {
          ...validCreate,
          campaign: {
            ...validCreate.campaign,
            schedule: {
              ...validCreate.campaign.schedule,
              startDate: '2026-08-08T12:00:00.000Z',
            },
          },
        },
        now,
      ),
    ).toThrow('campaign');
    expect(() =>
      parseAdCreate(
        { ...validCreate, mediaUrl: 'http://example.com/ad.png' },
        now,
      ),
    ).toThrow('mediaUrl');
    expect(() =>
      parseAdCreate(
        { ...validCreate, budget: { total: Number.POSITIVE_INFINITY } },
        now,
      ),
    ).toThrow('budget');
  });

  it('strictly allowlists updates and excludes ownership, analytics, and review state', () => {
    expect(parseAdUpdate({ title: ' Revised ', status: 'paused' })).toEqual({
      title: 'Revised',
      status: 'paused',
    });
    for (const field of ['advertiserId', 'analytics', 'review', 'createdAt']) {
      expect(() => parseAdUpdate({ [field]: 'injected' })).toThrow(field);
    }
    expect(() => parseAdUpdate({})).toThrow('update');
  });

  it('parses strict event, review, and analytics inputs', () => {
    expect(parseTrackEvent({ adId: ' a1 ', metadata: {} })).toEqual({
      adId: 'a1',
      metadata: {},
      conversionValue: 0,
      conversionType: null,
    });
    expect(() =>
      parseTrackEvent({ adId: 'a1', metadata: { secret: { nested: true } } }),
    ).toThrow('metadata');
    expect(
      parseReviewDecision({ status: 'rejected', reason: ' Policy ' }),
    ).toEqual({
      status: 'rejected',
      reason: 'Policy',
    });
    expect(() => parseReviewDecision({ status: 'running' })).toThrow('status');
    expect(
      parseAnalyticsQuery({ from: '2026-08-01', to: '2026-08-09' }),
    ).toEqual({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-09T00:00:00.000Z',
    });
  });
});

describe('media-processing contracts', () => {
  it('accepts only the legacy image and video effects', () => {
    expect(parseImageEffect({ filter: 'greyscale' })).toEqual({
      effect: 'greyscale',
    });
    expect(parseVideoEffect({ effect: 'grayscale' })).toEqual({
      effect: 'grayscale',
    });
    expect(() => parseImageEffect({ filter: 'shell-command' })).toThrow(
      'effect',
    );
    expect(() => parseVideoEffect({ effect: 'shell-command' })).toThrow(
      'effect',
    );
  });
});
