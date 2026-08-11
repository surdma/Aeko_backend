import {
  COIN_PACKAGES,
  getCoinPackageById,
  parseCoinHistoryQuery,
  parseCoinPurchase,
  parsePaystackVerifyQuery,
  parseStripeVerifyRequest,
} from '../../src/coins/coin.contract';
import {
  parsePaymentInitiate,
  parsePaymentVerifyQuery,
} from '../../src/payments/payment.contract';
import {
  parseSubscriptionPlanCreate,
  parseSubscriptionPlanUpdate,
} from '../../src/subscription-plans/subscription-plan.contract';
import {
  parseAdminSubscriberQuery,
  parseSubscriptionInitialize,
  parseSubscriptionVerifyQuery,
} from '../../src/subscriptions/subscription.contract';

describe('coin catalogue', () => {
  it('carries the five legacy packages at their legacy prices', () => {
    expect(COIN_PACKAGES.map((entry) => entry.id)).toEqual([
      'coins_100',
      'coins_500',
      'coins_1200',
      'coins_2500',
      'coins_6500',
    ]);
    expect(getCoinPackageById('coins_1200')).toMatchObject({
      coins: 1200,
      priceUSD: 9.99,
      pricePaise: 999,
      bonus: 200,
    });
  });

  it('answers null for an unknown package rather than throwing', () => {
    expect(getCoinPackageById('coins_999999')).toBeNull();
  });

  it('is frozen, so no request can rewrite a price', () => {
    expect(Object.isFrozen(COIN_PACKAGES)).toBe(true);
    expect(Object.isFrozen(COIN_PACKAGES[0])).toBe(true);
  });
});

describe('coin contracts', () => {
  it('defaults the payment method to paystack, as legacy did', () => {
    expect(parseCoinPurchase({ packageId: 'coins_100' })).toEqual({
      packageId: 'coins_100',
      paymentMethod: 'paystack',
    });
  });

  it('rejects a payment method the service cannot honour', () => {
    expect(() =>
      parseCoinPurchase({ packageId: 'coins_100', paymentMethod: 'bitcoin' }),
    ).toThrow(/coin purchase/iu);
  });

  it('never lets a request name its own price', () => {
    const parsed = parseCoinPurchase({
      packageId: 'coins_100',
      priceUSD: 0.01,
      coins: 999_999,
    });
    expect(Object.keys(parsed).sort()).toEqual(['packageId', 'paymentMethod']);
  });

  it('keeps the legacy history defaults and caps the page size', () => {
    expect(parseCoinHistoryQuery({})).toEqual({
      page: 1,
      limit: 20,
      type: null,
    });
    expect(parseCoinHistoryQuery({ limit: '5000' }).limit).toBe(100);
    expect(parseCoinHistoryQuery({ page: '3', type: 'purchase' })).toEqual({
      page: 3,
      limit: 20,
      type: 'purchase',
    });
  });

  it('requires a reference and a session id to verify', () => {
    expect(parsePaystackVerifyQuery({ reference: 'COINS_1' })).toEqual({
      reference: 'COINS_1',
    });
    expect(() => parsePaystackVerifyQuery({})).toThrow(/verification/iu);
    expect(parseStripeVerifyRequest({ sessionId: 'cs_1' })).toEqual({
      sessionId: 'cs_1',
    });
    expect(() => parseStripeVerifyRequest({})).toThrow(/verification/iu);
  });
});

describe('subscription contracts', () => {
  it('requires a plan and a supported provider', () => {
    expect(
      parseSubscriptionInitialize({ planId: 'p1', paymentMethod: 'stripe' }),
    ).toEqual({ planId: 'p1', paymentMethod: 'stripe' });
    expect(() =>
      parseSubscriptionInitialize({ planId: 'p1', paymentMethod: 'cheque' }),
    ).toThrow(/subscription/iu);
    expect(() => parseSubscriptionInitialize({ planId: 'p1' })).toThrow(
      /subscription/iu,
    );
  });

  it('requires both verification parameters, as legacy did', () => {
    expect(
      parseSubscriptionVerifyQuery({
        reference: 'SUB-1',
        paymentMethod: 'paystack',
      }),
    ).toEqual({ reference: 'SUB-1', paymentMethod: 'paystack' });
    expect(() => parseSubscriptionVerifyQuery({ reference: 'SUB-1' })).toThrow(
      /verification/iu,
    );
  });

  it('keeps the admin listing defaults', () => {
    expect(parseAdminSubscriberQuery({})).toEqual({
      page: 1,
      limit: 10,
      status: null,
    });
    expect(parseAdminSubscriberQuery({ limit: '9999' }).limit).toBe(100);
    expect(parseAdminSubscriberQuery({ status: 'active' }).status).toBe(
      'active',
    );
  });
});

describe('subscription plan contracts', () => {
  it('applies the column defaults the legacy route relied on', () => {
    expect(
      parseSubscriptionPlanCreate({
        name: 'Gold',
        price: 9.99,
        features: ['a', 'b'],
      }),
    ).toEqual({
      name: 'Gold',
      price: 9.99,
      currency: 'USD',
      duration: 'monthly',
      features: ['a', 'b'],
      limits: undefined,
      targetAudience: null,
    });
  });

  it('rejects a negative price and an unknown duration', () => {
    expect(() =>
      parseSubscriptionPlanCreate({ name: 'X', price: -1, features: [] }),
    ).toThrow(/subscription plan/iu);
    expect(() =>
      parseSubscriptionPlanCreate({
        name: 'X',
        price: 1,
        duration: 'weekly',
        features: [],
      }),
    ).toThrow(/subscription plan/iu);
  });

  it('keeps a partial update partial, touching nothing else', () => {
    expect(parseSubscriptionPlanUpdate({ price: 19.99 })).toEqual({
      price: 19.99,
    });
    expect(parseSubscriptionPlanUpdate({})).toEqual({});
  });

  it('refuses the mass assignment legacy allowed', () => {
    // Legacy passed req.body straight into prisma.update.
    for (const body of [
      { id: 'other-plan' },
      { createdAt: '2020-01-01T00:00:00.000Z' },
      { users: { set: [] } },
      { transactions: { deleteMany: {} } },
    ]) {
      expect(() => parseSubscriptionPlanUpdate(body)).toThrow(
        /subscription plan/iu,
      );
    }
  });
});

describe('payment contracts', () => {
  it('reads the legacy body fields and defaults the optional ones', () => {
    expect(
      parsePaymentInitiate({ amount: 500, email: 'payer@example.com' }),
    ).toEqual({
      amount: 500,
      email: 'payer@example.com',
      phone: null,
      name: null,
    });
  });

  it('rejects an amount the provider would reject anyway', () => {
    for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        parsePaymentInitiate({ amount, email: 'payer@example.com' }),
      ).toThrow(/payment/iu);
    }
  });

  it('reads the transaction id under its legacy query name', () => {
    expect(parsePaymentVerifyQuery({ transaction_id: '12345' })).toEqual({
      transactionId: '12345',
    });
    expect(() => parsePaymentVerifyQuery({ transactionId: '12345' })).toThrow(
      /verification/iu,
    );
  });
});
