import {
  MIN_DESCRIPTION,
  parseCommunityCreate,
  parseCommunityListQuery,
  parseCommunityUpdate,
  parseMyCommunitiesQuery,
} from '../../src/communities/community.contract';
import {
  parseCommunityPaymentInitialize,
  parseCommunityPaymentVerifyQuery,
  parseTransactionQuery,
  parseWithdrawalRequest,
} from '../../src/community-payments/community-payment.contract';
import {
  parseCommunityPhotoQuery,
  parseCommunityPostCreate,
  parseCommunityPostQuery,
  parseCommunityProfileUpdate,
  parseCommunitySettingsUpdate,
} from '../../src/community-profiles/community-profile.contract';

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('community contracts', () => {
  it('applies the legacy creation defaults', () => {
    expect(
      parseCommunityCreate({
        name: 'Builders',
        description: 'A place for people who build things.',
      }),
    ).toEqual({
      name: 'Builders',
      description: 'A place for people who build things.',
      isPrivate: false,
      tags: [],
    });
  });

  it('holds the ten-character description floor legacy enforced', () => {
    expect(() =>
      parseCommunityCreate({ name: 'X', description: 'too short' }),
    ).toThrow(/community/iu);
    expect(
      parseCommunityCreate({
        name: 'X',
        description: 'a'.repeat(MIN_DESCRIPTION),
      }).description,
    ).toHaveLength(MIN_DESCRIPTION);
  });

  it('never lets a request set its own member count or owner', () => {
    const parsed = parseCommunityCreate({
      name: 'X',
      description: 'A long enough description.',
      memberCount: 9_999,
      ownerId: 'someone-else',
      isActive: false,
    });
    expect(Object.keys(parsed).sort()).toEqual([
      'description',
      'isPrivate',
      'name',
      'tags',
    ]);
  });

  it('keeps a partial update partial', () => {
    expect(parseCommunityUpdate({ isPrivate: true })).toEqual({
      isPrivate: true,
    });
    expect(parseCommunityUpdate({})).toEqual({});
  });

  it('drops an absent search term rather than defaulting it to empty', () => {
    // Legacy defaulted search to '' and still ran three contains predicates.
    expect(parseCommunityListQuery({})).toEqual({
      page: 1,
      limit: 10,
      search: null,
    });
    expect(parseCommunityListQuery({ search: 'build' }).search).toBe('build');
    expect(parseMyCommunitiesQuery({}).limit).toBe(20);
    expect(parseCommunityListQuery({ limit: '9999' }).limit).toBe(100);
  });
});

describe('community payment contracts', () => {
  it('accepts a uuid community id, which legacy rejected outright', () => {
    // Legacy validated with isMongoId(); community ids are uuids, so every
    // real id failed and all three payment routes answered 400.
    expect(
      parseCommunityPaymentInitialize({
        communityId: UUID,
        paymentMethod: 'paystack',
      }),
    ).toEqual({ communityId: UUID, paymentMethod: 'paystack' });
  });

  it('accepts but ignores a caller-supplied amount', () => {
    const parsed = parseCommunityPaymentInitialize({
      communityId: UUID,
      paymentMethod: 'stripe',
      amount: 0.01,
    });
    // The price always comes from the community's own settings.
    expect(Object.keys(parsed).sort()).toEqual([
      'communityId',
      'paymentMethod',
    ]);
  });

  it('rejects an unsupported payment method', () => {
    expect(() =>
      parseCommunityPaymentInitialize({
        communityId: UUID,
        paymentMethod: 'cash',
      }),
    ).toThrow(/payment/iu);
  });

  it('requires both verification parameters', () => {
    expect(
      parseCommunityPaymentVerifyQuery({
        reference: 'COMM-1',
        paymentMethod: 'paystack',
      }),
    ).toEqual({ reference: 'COMM-1', paymentMethod: 'paystack' });
    expect(() =>
      parseCommunityPaymentVerifyQuery({ reference: 'COMM-1' }),
    ).toThrow(/verification/iu);
  });

  it('holds the legacy bank withdrawal rules', () => {
    const details = {
      accountNumber: '0123456789',
      bankCode: '058',
      accountName: 'Ada Lovelace',
    };
    expect(
      parseWithdrawalRequest({
        communityId: UUID,
        amount: 100,
        method: 'bank',
        details,
      }),
    ).toEqual({ communityId: UUID, amount: 100, method: 'bank', details });

    for (const broken of [
      { ...details, accountNumber: '123' },
      { ...details, accountNumber: '01234567ab' },
      { ...details, bankCode: '12' },
      { ...details, accountName: 'A' },
    ]) {
      expect(() =>
        parseWithdrawalRequest({
          communityId: UUID,
          amount: 100,
          method: 'bank',
          details: broken,
        }),
      ).toThrow(/withdrawal/iu);
    }
  });

  it('bounds the withdrawal amount exactly as legacy did', () => {
    for (const amount of [0, 0.009, -5, 1_000_000.01]) {
      expect(() =>
        parseWithdrawalRequest({
          communityId: UUID,
          amount,
          method: 'bank',
          details: {
            accountNumber: '0123456789',
            bankCode: '058',
            accountName: 'Ada',
          },
        }),
      ).toThrow(/withdrawal/iu);
    }
  });

  it('parses the transaction filters and rejects a bad status or date', () => {
    expect(parseTransactionQuery({})).toEqual({
      page: 1,
      limit: 10,
      status: null,
      startDate: null,
      endDate: null,
    });
    const parsed = parseTransactionQuery({
      status: 'completed',
      startDate: '2026-01-01',
    });
    expect(parsed.status).toBe('completed');
    expect(parsed.startDate).toBeInstanceOf(Date);

    expect(() => parseTransactionQuery({ status: 'settled' })).toThrow(
      /transaction query/iu,
    );
    expect(() => parseTransactionQuery({ startDate: 'yesterday' })).toThrow(
      /transaction query/iu,
    );
    expect(parseTransactionQuery({ limit: '5000' }).limit).toBe(100);
  });
});

describe('community profile contracts', () => {
  it('keeps a partial profile update partial', () => {
    expect(parseCommunityProfileUpdate({ location: 'Lagos' })).toEqual({
      location: 'Lagos',
    });
    expect(parseCommunityProfileUpdate({})).toEqual({});
  });

  it('reads the photo kind from the query, defaulting to the avatar', () => {
    // Legacy read req.query.type and accepted only 'avatar' or 'cover'.
    expect(parseCommunityPhotoQuery({})).toEqual({ type: 'avatar' });
    expect(parseCommunityPhotoQuery({ type: 'cover' })).toEqual({
      type: 'cover',
    });
    expect(() => parseCommunityPhotoQuery({ type: 'banner' })).toThrow(
      /photo/iu,
    );
  });

  it('requires a settings object', () => {
    expect(
      parseCommunitySettingsUpdate({ settings: { requireApproval: true } }),
    ).toEqual({ settings: { requireApproval: true } });
    expect(() => parseCommunitySettingsUpdate({})).toThrow(/settings/iu);
  });

  it('requires post content and defaults the media', () => {
    expect(parseCommunityPostCreate({ content: 'Hello' })).toEqual({
      content: 'Hello',
      media: [],
    });
    expect(() => parseCommunityPostCreate({ content: '   ' })).toThrow(
      /post/iu,
    );
    expect(parseCommunityPostQuery({}).limit).toBe(10);
  });
});
