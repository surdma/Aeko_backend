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
import { CommunityPaymentsController } from '../../src/community-payments/community-payments.controller';
import { CommunityPaymentsService } from '../../src/community-payments/community-payments.service';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { CommunityPaymentPort } from '../../src/providers/community-payment/community-payment.port';
import type {
  PaystackInitialization,
  PaystackInitializeRequest,
  PaystackTransaction,
} from '../../src/providers/paystack/paystack.port';
import { PaystackPort } from '../../src/providers/paystack/paystack.port';
import type {
  StripeCheckoutRequest,
  StripeCheckoutSession,
  StripePaymentIntent,
  StripePaymentIntentRequest,
  StripeRetrievedSession,
  StripeWebhookEvent,
} from '../../src/providers/stripe/stripe.port';
import { StripePort } from '../../src/providers/stripe/stripe.port';

const EPOCH = new Date('2026-08-01T00:00:00.000Z');
const COMMUNITY = 'community-1';

const owner: AuthenticatedPrincipal = {
  userId: 'owner',
  email: 'owner@example.com',
  username: 'owner',
  isAdmin: false,
  banned: false,
  twoFactorEnabled: true,
  twoFactorSatisfied: true,
  sessionId: 'session-owner',
};

const buyer: AuthenticatedPrincipal = { ...owner, userId: 'buyer' };

const paidSettings = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  payment: {
    isPaidCommunity: true,
    price: 25,
    currency: 'USD',
    subscriptionType: 'monthly',
    paymentMethods: ['paystack', 'stripe'],
    paystackSubaccount: 'ACCT_1',
    stripeAccountId: 'acct_1',
    ...overrides,
  },
});

interface CommunityRow {
  id: string;
  name: string;
  ownerId: string | null;
  members: unknown;
  settings: unknown;
}

interface TxRow {
  id: string;
  userId: string;
  communityId: string | null;
  amount: number;
  currency: string;
  paymentMethod: string;
  paymentReference: string;
  status: string;
  metadata: unknown;
  verifiedAt: Date | null;
  createdAt: Date;
}

class FakePaystack extends PaystackPort {
  status = 'success';
  lastInitialize: PaystackInitializeRequest | null = null;
  failInitialize = false;

  initialize(
    request: PaystackInitializeRequest,
  ): Promise<PaystackInitialization> {
    this.lastInitialize = request;
    if (this.failInitialize) {
      return Promise.reject(new Error('provider down'));
    }
    return Promise.resolve({
      authorizationUrl: 'https://checkout.paystack.com/x',
      accessCode: 'x',
      reference: request.reference,
    });
  }

  verify(reference: string): Promise<PaystackTransaction> {
    return Promise.resolve({
      status: this.status,
      reference,
      amountMinor: 2500,
      currency: 'USD',
      metadata: {},
    });
  }

  verifySignature(): boolean {
    return true;
  }
}

class FakeStripe extends StripePort {
  intentStatus = 'succeeded';
  retrievedIds: string[] = [];

  createCheckoutSession(
    request: StripeCheckoutRequest,
  ): Promise<StripeCheckoutSession> {
    void request;
    return Promise.reject(new Error('not used'));
  }

  retrieveSession(): Promise<StripeRetrievedSession> {
    return Promise.reject(new Error('not used'));
  }

  createPaymentIntent(
    request: StripePaymentIntentRequest,
  ): Promise<StripePaymentIntent> {
    return Promise.resolve({
      id: 'pi_comm',
      clientSecret: 'pi_comm_secret',
      status: 'requires_payment_method',
      amountMinor: request.amountMinor,
      currency: request.currency,
      metadata: request.metadata,
    });
  }

  retrievePaymentIntent(id: string): Promise<StripePaymentIntent> {
    this.retrievedIds.push(id);
    if (!id.startsWith('pi_')) {
      return Promise.reject(new Error('No such payment_intent'));
    }
    return Promise.resolve({
      id,
      clientSecret: null,
      status: this.intentStatus,
      amountMinor: 2500,
      currency: 'usd',
      metadata: {},
    });
  }

  constructWebhookEvent(): StripeWebhookEvent {
    throw new Error('not used');
  }
}

class FakeSettlement extends CommunityPaymentPort {
  settled: string[] = [];

  settle(transactionId: string): Promise<void> {
    this.settled.push(transactionId);
    return Promise.resolve();
  }
}

interface Harness {
  readonly service: CommunityPaymentsService;
  readonly paystack: FakePaystack;
  readonly stripe: FakeStripe;
  readonly settlement: FakeSettlement;
  readonly communities: Map<string, CommunityRow>;
  readonly transactions: Map<string, TxRow>;
  readonly transactionOptions: unknown[];
  email: string | null;
  lastWhere: unknown;
}

const createHarness = (
  options: Readonly<{
    communities?: readonly CommunityRow[];
    transactions?: readonly TxRow[];
    email?: string | null;
  }> = {},
): Harness => {
  const communities = new Map(
    (
      options.communities ?? [
        {
          id: COMMUNITY,
          name: 'Builders',
          ownerId: 'owner',
          members: [],
          settings: paidSettings(),
        },
      ]
    ).map((row) => [row.id, row]),
  );
  const transactions = new Map(
    (options.transactions ?? []).map((row) => [row.id, row]),
  );
  const paystack = new FakePaystack();
  const stripe = new FakeStripe();
  const settlement = new FakeSettlement();

  const harness: Harness = {
    service: undefined as unknown as CommunityPaymentsService,
    paystack,
    stripe,
    settlement,
    communities,
    transactions,
    transactionOptions: [],
    email: 'email' in options ? (options.email ?? null) : 'buyer@example.com',
    lastWhere: null,
  };

  let queue: Promise<unknown> = Promise.resolve();

  const db = {
    community: {
      findUnique: ({ where }: { where: { id: string } }): Promise<unknown> =>
        Promise.resolve(communities.get(where.id) ?? null),
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        const row = communities.get(where.id);
        if (row === undefined) return Promise.reject(new Error('missing'));
        const next = { ...row, settings: data.settings ?? row.settings };
        communities.set(next.id, next);
        return Promise.resolve(next);
      },
    },
    user: {
      findUnique: (): Promise<unknown> =>
        Promise.resolve(
          harness.email === null ? null : { email: harness.email },
        ),
    },
    transaction: {
      findFirst: ({
        where,
      }: {
        where: { paymentReference: string };
      }): Promise<unknown> =>
        Promise.resolve(
          [...transactions.values()].find(
            (row) => row.paymentReference === where.paymentReference,
          ) ?? null,
        ),
      findMany: (args: { where: unknown }): Promise<readonly unknown[]> => {
        harness.lastWhere = args.where;
        return Promise.resolve([...transactions.values()]);
      },
      count: (args: { where: unknown }): Promise<number> => {
        harness.lastWhere = args.where;
        return Promise.resolve(transactions.size);
      },
      aggregate: (): Promise<{ _sum: { amount: number | null } }> =>
        Promise.resolve({
          _sum: {
            amount: [...transactions.values()].reduce(
              (sum, row) => sum + row.amount,
              0,
            ),
          },
        }),
      create: ({
        data,
      }: {
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        const row: TxRow = {
          id: `tx-${String(transactions.size + 1)}`,
          userId: String(data.userId),
          communityId:
            typeof data.communityId === 'string' ? data.communityId : null,
          amount: typeof data.amount === 'number' ? data.amount : 0,
          currency: String(data.currency),
          paymentMethod: String(data.paymentMethod),
          paymentReference: String(data.paymentReference),
          status: 'pending',
          metadata: null,
          verifiedAt: null,
          createdAt: EPOCH,
        };
        transactions.set(row.id, row);
        return Promise.resolve(row);
      },
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        const row = transactions.get(where.id);
        if (row === undefined) return Promise.reject(new Error('missing'));
        const next: TxRow = {
          ...row,
          status: typeof data.status === 'string' ? data.status : row.status,
          metadata: data.metadata ?? row.metadata,
        };
        transactions.set(next.id, next);
        return Promise.resolve(next);
      },
    },
    $transaction: (operation: unknown, opts: unknown): Promise<unknown> => {
      const run = queue.then(() => {
        if (opts !== undefined) harness.transactionOptions.push(opts);
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
    service: new CommunityPaymentsService(
      new PrismaService(
        db as unknown as ConstructorParameters<typeof PrismaService>[0],
      ),
      paystack,
      stripe,
      settlement,
    ),
  });
};

const paymentOf = (row: CommunityRow | undefined): Record<string, unknown> => {
  const settings = row?.settings;
  if (typeof settings !== 'object' || settings === null) return {};
  const payment: unknown = Reflect.get(settings, 'payment');
  return typeof payment === 'object' && payment !== null
    ? (payment as Record<string, unknown>)
    : {};
};

describe('community payment initialization', () => {
  it('charges the configured price and creates a pending transaction', async () => {
    const harness = createHarness();
    const result = await harness.service.initialize(buyer, {
      communityId: COMMUNITY,
      paymentMethod: 'paystack',
    });

    expect(result.authorizationUrl).toBe('https://checkout.paystack.com/x');
    expect(harness.paystack.lastInitialize?.amountMinor).toBe(2500);
    expect([...harness.transactions.values()][0]).toMatchObject({
      status: 'pending',
      communityId: COMMUNITY,
      amount: 25,
    });
  });

  it('records the stripe payment intent id against the transaction', async () => {
    const harness = createHarness();
    const result = await harness.service.initialize(buyer, {
      communityId: COMMUNITY,
      paymentMethod: 'stripe',
    });

    expect(result.paymentIntentId).toBe('pi_comm');
    // Legacy stored nothing, so verification asked Stripe about `COMM-…`.
    expect([...harness.transactions.values()][0]?.metadata).toEqual({
      providerReference: 'pi_comm',
    });
  });

  it('refuses a community that is not paid', async () => {
    const harness = createHarness({
      communities: [
        {
          id: COMMUNITY,
          name: 'Free',
          ownerId: 'owner',
          members: [],
          settings: {},
        },
      ],
    });
    await expect(
      harness.service.initialize(buyer, {
        communityId: COMMUNITY,
        paymentMethod: 'paystack',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses a method the community does not offer or has not configured', async () => {
    const unoffered = createHarness({
      communities: [
        {
          id: COMMUNITY,
          name: 'Builders',
          ownerId: 'owner',
          members: [],
          settings: paidSettings({ paymentMethods: ['paystack'] }),
        },
      ],
    });
    await expect(
      unoffered.service.initialize(buyer, {
        communityId: COMMUNITY,
        paymentMethod: 'stripe',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const unconfigured = createHarness({
      communities: [
        {
          id: COMMUNITY,
          name: 'Builders',
          ownerId: 'owner',
          members: [],
          settings: paidSettings({ stripeAccountId: undefined }),
        },
      ],
    });
    await expect(
      unconfigured.service.initialize(buyer, {
        communityId: COMMUNITY,
        paymentMethod: 'stripe',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses a buyer who already holds an active subscription', async () => {
    const harness = createHarness({
      communities: [
        {
          id: COMMUNITY,
          name: 'Builders',
          ownerId: 'owner',
          members: [
            {
              user: 'buyer',
              status: 'active',
              subscription: {
                isActive: true,
                endDate: new Date(Date.now() + 86_400_000).toISOString(),
              },
            },
          ],
          settings: paidSettings(),
        },
      ],
    });
    await expect(
      harness.service.initialize(buyer, {
        communityId: COMMUNITY,
        paymentMethod: 'paystack',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('allows a repurchase once the previous term has expired', async () => {
    const harness = createHarness({
      communities: [
        {
          id: COMMUNITY,
          name: 'Builders',
          ownerId: 'owner',
          members: [
            {
              user: 'buyer',
              status: 'active',
              subscription: {
                isActive: true,
                endDate: new Date(Date.now() - 86_400_000).toISOString(),
              },
            },
          ],
          settings: paidSettings(),
        },
      ],
    });
    await expect(
      harness.service.initialize(buyer, {
        communityId: COMMUNITY,
        paymentMethod: 'paystack',
      }),
    ).resolves.toMatchObject({ success: true });
  });

  it('marks the transaction failed when the provider refuses', async () => {
    const harness = createHarness();
    harness.paystack.failInitialize = true;

    await expect(
      harness.service.initialize(buyer, {
        communityId: COMMUNITY,
        paymentMethod: 'paystack',
      }),
    ).rejects.toThrow(/provider down/u);
    expect([...harness.transactions.values()][0]?.status).toBe('failed');
  });

  it('reports a missing user or community', async () => {
    await expect(
      createHarness({ email: null }).service.initialize(buyer, {
        communityId: COMMUNITY,
        paymentMethod: 'paystack',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await expect(
      createHarness({ communities: [] }).service.initialize(buyer, {
        communityId: COMMUNITY,
        paymentMethod: 'paystack',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

const pendingTx = (overrides: Partial<TxRow> = {}): TxRow => ({
  id: 'tx-1',
  userId: 'buyer',
  communityId: COMMUNITY,
  amount: 25,
  currency: 'USD',
  paymentMethod: 'paystack',
  paymentReference: 'COMM-1',
  status: 'pending',
  metadata: null,
  verifiedAt: null,
  createdAt: EPOCH,
  ...overrides,
});

describe('community payment verification', () => {
  it('settles through the shared adapter once the payment lands', async () => {
    const harness = createHarness({ transactions: [pendingTx()] });
    const result = await harness.service.verify({
      reference: 'COMM-1',
      paymentMethod: 'paystack',
    });

    expect(result.success).toBe(true);
    expect(harness.settlement.settled).toEqual(['tx-1']);
  });

  it('verifies stripe against the stored provider reference', async () => {
    const harness = createHarness({
      transactions: [
        pendingTx({
          paymentMethod: 'stripe',
          metadata: { providerReference: 'pi_comm' },
        }),
      ],
    });

    await harness.service.verify({
      reference: 'COMM-1',
      paymentMethod: 'stripe',
    });
    expect(harness.stripe.retrievedIds).toEqual(['pi_comm']);
    expect(harness.settlement.settled).toEqual(['tx-1']);
  });

  it('settles nothing when the payment has not landed', async () => {
    const harness = createHarness({ transactions: [pendingTx()] });
    harness.paystack.status = 'abandoned';

    const result = await harness.service.verify({
      reference: 'COMM-1',
      paymentMethod: 'paystack',
    });
    expect(result.success).toBe(false);
    expect(harness.settlement.settled).toEqual([]);
  });

  it('reports an already-verified payment without settling again', async () => {
    const harness = createHarness({
      transactions: [pendingTx({ status: 'completed' })],
    });
    await expect(
      harness.service.verify({
        reference: 'COMM-1',
        paymentMethod: 'paystack',
      }),
    ).resolves.toMatchObject({ alreadyProcessed: true });
    expect(harness.settlement.settled).toEqual([]);
  });

  it('reports a missing transaction', async () => {
    await expect(
      createHarness().service.verify({
        reference: 'nope',
        paymentMethod: 'paystack',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('community withdrawal', () => {
  const details = {
    accountNumber: '0123456789',
    bankCode: '058',
    accountName: 'Ada Lovelace',
  };

  const earning = (
    totalEarnings: number,
    pendingWithdrawals = 0,
  ): CommunityRow => ({
    id: COMMUNITY,
    name: 'Builders',
    ownerId: 'owner',
    members: [],
    settings: paidSettings({ totalEarnings, pendingWithdrawals }),
  });

  it('reserves the amount against the available balance', async () => {
    const harness = createHarness({ communities: [earning(100)] });
    const result = await harness.service.withdraw(owner, {
      communityId: COMMUNITY,
      amount: 40,
      method: 'bank',
      details,
    });

    expect(result.availableBalance).toBe(60);
    expect(paymentOf(harness.communities.get(COMMUNITY))).toMatchObject({
      pendingWithdrawals: 40,
      totalEarnings: 100,
    });
    expect(harness.transactionOptions).toContainEqual({
      isolationLevel: 'Serializable',
    });
  });

  it('counts an existing reservation against the balance', async () => {
    const harness = createHarness({ communities: [earning(100, 80)] });
    await expect(
      harness.service.withdraw(owner, {
        communityId: COMMUNITY,
        amount: 40,
        method: 'bank',
        details,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('does not let two racing withdrawals overdraw the balance', async () => {
    const harness = createHarness({ communities: [earning(100)] });
    // Legacy read the balance outside the write that reserves against it.
    const results = await Promise.allSettled([
      harness.service.withdraw(owner, {
        communityId: COMMUNITY,
        amount: 60,
        method: 'bank',
        details,
      }),
      harness.service.withdraw(owner, {
        communityId: COMMUNITY,
        amount: 60,
        method: 'bank',
        details,
      }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(paymentOf(harness.communities.get(COMMUNITY))).toMatchObject({
      pendingWithdrawals: 60,
    });
  });

  it('appends to the withdrawal history', async () => {
    const harness = createHarness({ communities: [earning(100)] });
    await harness.service.withdraw(owner, {
      communityId: COMMUNITY,
      amount: 10,
      method: 'bank',
      details,
    });

    const history = paymentOf(
      harness.communities.get(COMMUNITY),
    ).withdrawalHistory;
    expect(Array.isArray(history) ? history : []).toHaveLength(1);
  });

  it('admits only the owner', async () => {
    const harness = createHarness({ communities: [earning(100)] });
    await expect(
      harness.service.withdraw(buyer, {
        communityId: COMMUNITY,
        amount: 10,
        method: 'bank',
        details,
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });
});

describe('community transactions', () => {
  it('pages and summarises for the owner', async () => {
    const harness = createHarness({
      transactions: [pendingTx({ status: 'completed' })],
    });
    const page = await harness.service.listTransactions(owner, COMMUNITY, {});

    expect(page.pagination).toEqual({
      total: 1,
      page: 1,
      pages: 1,
      limit: 10,
    });
    expect(page.statistics.completedCount).toBe(1);
  });

  it('applies the status and date filters', async () => {
    const harness = createHarness({ transactions: [pendingTx()] });
    await harness.service.listTransactions(owner, COMMUNITY, {
      status: 'completed',
      startDate: '2026-01-01',
    });

    expect(harness.lastWhere).toMatchObject({
      communityId: COMMUNITY,
      status: 'completed',
    });
  });

  it('admits only the owner', async () => {
    const harness = createHarness();
    await expect(
      harness.service.listTransactions(buyer, COMMUNITY, {}),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });
});

describe('community payment routes', () => {
  const reflector = new Reflector();
  const handlerOf = (name: string) => {
    const handler: unknown = Reflect.get(
      CommunityPaymentsController.prototype,
      name,
    );
    if (typeof handler !== 'function') {
      throw new Error(`CommunityPaymentsController.${name} is missing`);
    }
    return handler;
  };

  it('registers the exact four legacy routes', () => {
    expect(
      reflector.get<unknown>(PATH_METADATA, CommunityPaymentsController),
    ).toBe('api/community/payment');

    const routes = [
      ['initialize', 'initialize', RequestMethod.POST],
      ['verify', 'verify', RequestMethod.GET],
      ['withdraw', 'withdraw', RequestMethod.POST],
      ['listTransactions', ':communityId/transactions', RequestMethod.GET],
    ] as const;

    for (const [name, path, method] of routes) {
      expect(reflector.get<unknown>(PATH_METADATA, handlerOf(name))).toBe(path);
      expect(reflector.get<unknown>(METHOD_METADATA, handlerOf(name))).toBe(
        method,
      );
    }
  });

  it('keeps the legacy guard stack, including the second factor on withdraw', () => {
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf('withdraw')),
    ).toEqual([SessionGuard, TwoFactorGuard]);
    for (const name of ['initialize', 'listTransactions']) {
      expect(
        reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf(name)),
      ).toEqual([SessionGuard]);
    }
    // The provider callback lands here with no session.
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf('verify')),
    ).toBeUndefined();
  });
});
