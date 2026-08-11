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
import { SubscriptionsController } from '../../src/subscriptions/subscriptions.controller';
import { SubscriptionsService } from '../../src/subscriptions/subscriptions.service';

const subscriber: AuthenticatedPrincipal = {
  userId: 'user-1',
  email: 'user@example.com',
  username: 'user',
  isAdmin: false,
  banned: false,
  twoFactorEnabled: true,
  twoFactorSatisfied: true,
  sessionId: 'session-1',
};

interface PlanRow {
  id: string;
  name: string;
  price: number;
  currency: string;
  duration: string;
  features: unknown;
  limits: unknown;
  targetAudience: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface UserRow {
  id: string;
  email: string | null;
  username: string;
  subscriptionPlanId: string | null;
  subscriptionStatus: string;
  subscriptionExpiry: Date | null;
  goldenTick: boolean;
}

interface TxRow {
  id: string;
  userId: string;
  planId: string | null;
  communityId: string | null;
  amount: number;
  currency: string;
  paymentMethod: string;
  paymentReference: string;
  status: string;
  metadata: Record<string, unknown> | null;
  failureReason: string | null;
  retryCount: number;
  verifiedAt: Date | null;
  updatedAt: Date;
}

const EPOCH = new Date('2026-08-01T00:00:00.000Z');

const makePlan = (overrides: Partial<PlanRow> = {}): PlanRow => ({
  id: 'plan-gold',
  name: 'Gold',
  price: 10,
  currency: 'USD',
  duration: 'monthly',
  features: ['a'],
  limits: null,
  targetAudience: null,
  isActive: true,
  createdAt: EPOCH,
  updatedAt: EPOCH,
  ...overrides,
});

const makeUser = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: 'user-1',
  email: 'user@example.com',
  username: 'user',
  subscriptionPlanId: null,
  subscriptionStatus: 'inactive',
  subscriptionExpiry: null,
  goldenTick: false,
  ...overrides,
});

class FakePaystack extends PaystackPort {
  status = 'success';
  lastInitialize: PaystackInitializeRequest | null = null;

  initialize(
    request: PaystackInitializeRequest,
  ): Promise<PaystackInitialization> {
    this.lastInitialize = request;
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
      amountMinor: 1000,
      currency: 'NGN',
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
      id: 'pi_123',
      clientSecret: 'pi_123_secret',
      status: 'requires_payment_method',
      amountMinor: request.amountMinor,
      currency: request.currency,
      metadata: request.metadata,
    });
  }

  retrievePaymentIntent(paymentIntentId: string): Promise<StripePaymentIntent> {
    this.retrievedIds.push(paymentIntentId);
    if (!paymentIntentId.startsWith('pi_')) {
      // Stripe cannot resolve our own SUB-… reference as a PaymentIntent id.
      return Promise.reject(new Error('No such payment_intent'));
    }
    return Promise.resolve({
      id: paymentIntentId,
      clientSecret: null,
      status: this.intentStatus,
      amountMinor: 1000,
      currency: 'usd',
      metadata: {},
    });
  }

  constructWebhookEvent(): StripeWebhookEvent {
    throw new Error('not used');
  }
}

interface Harness {
  readonly service: SubscriptionsService;
  readonly paystack: FakePaystack;
  readonly stripe: FakeStripe;
  readonly users: Map<string, UserRow>;
  readonly plans: Map<string, PlanRow>;
  readonly transactions: Map<string, TxRow>;
  readonly transactionOptions: unknown[];
  activations: number;
}

const createHarness = (
  options: Readonly<{
    users?: readonly UserRow[];
    plans?: readonly PlanRow[];
    transactions?: readonly TxRow[];
  }> = {},
): Harness => {
  const users = new Map((options.users ?? [makeUser()]).map((u) => [u.id, u]));
  const plans = new Map((options.plans ?? [makePlan()]).map((p) => [p.id, p]));
  const transactions = new Map(
    (options.transactions ?? []).map((t) => [t.id, t]),
  );
  const paystack = new FakePaystack();
  const stripe = new FakeStripe();

  const harness: Harness = {
    service: undefined as unknown as SubscriptionsService,
    paystack,
    stripe,
    users,
    plans,
    transactions,
    transactionOptions: [],
    activations: 0,
  };

  let queue: Promise<unknown> = Promise.resolve();

  const withPlan = (user: UserRow): unknown => ({
    ...user,
    subscriptionPlan:
      user.subscriptionPlanId === null
        ? null
        : (plans.get(user.subscriptionPlanId) ?? null),
  });

  const db = {
    user: {
      findUnique: ({ where }: { where: { id: string } }): Promise<unknown> => {
        const user = users.get(where.id);
        return Promise.resolve(user === undefined ? null : withPlan(user));
      },
      findMany: (): Promise<readonly unknown[]> =>
        Promise.resolve([...users.values()].map(withPlan)),
      count: (): Promise<number> => Promise.resolve(users.size),
      groupBy: (): Promise<readonly unknown[]> =>
        Promise.resolve([
          { subscriptionPlanId: 'plan-gold', _count: { _all: 2 } },
        ]),
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        const user = users.get(where.id);
        if (user === undefined) return Promise.reject(new Error('missing'));
        harness.activations += 1;
        const next: UserRow = {
          ...user,
          subscriptionPlanId:
            typeof data.subscriptionPlanId === 'string'
              ? data.subscriptionPlanId
              : user.subscriptionPlanId,
          subscriptionStatus:
            typeof data.subscriptionStatus === 'string'
              ? data.subscriptionStatus
              : user.subscriptionStatus,
          subscriptionExpiry:
            data.subscriptionExpiry instanceof Date
              ? data.subscriptionExpiry
              : user.subscriptionExpiry,
          goldenTick: data.goldenTick === true ? true : user.goldenTick,
        };
        users.set(next.id, next);
        return Promise.resolve(next);
      },
    },
    subscriptionPlan: {
      findUnique: ({ where }: { where: { id: string } }): Promise<unknown> =>
        Promise.resolve(plans.get(where.id) ?? null),
      findMany: (): Promise<readonly unknown[]> =>
        Promise.resolve([...plans.values()]),
    },
    transaction: {
      findUnique: ({ where }: { where: { id: string } }): Promise<unknown> =>
        Promise.resolve(transactions.get(where.id) ?? null),
      findFirst: ({
        where,
      }: {
        where: { paymentReference: string };
      }): Promise<unknown> =>
        Promise.resolve(
          [...transactions.values()].find(
            (t) => t.paymentReference === where.paymentReference,
          ) ?? null,
        ),
      create: ({
        data,
      }: {
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        const row: TxRow = {
          id: `tx-${String(transactions.size + 1)}`,
          userId: String(data.userId),
          planId: typeof data.planId === 'string' ? data.planId : null,
          communityId: null,
          amount: typeof data.amount === 'number' ? data.amount : 0,
          currency: String(data.currency),
          paymentMethod: String(data.paymentMethod),
          paymentReference: String(data.paymentReference),
          status: 'pending',
          metadata: null,
          failureReason: null,
          retryCount: 0,
          verifiedAt: null,
          updatedAt: EPOCH,
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
          failureReason:
            typeof data.failureReason === 'string'
              ? data.failureReason
              : row.failureReason,
          metadata:
            typeof data.metadata === 'object' && data.metadata !== null
              ? (data.metadata as Record<string, unknown>)
              : row.metadata,
        };
        transactions.set(next.id, next);
        return Promise.resolve(next);
      },
      updateMany: ({
        where,
        data,
      }: {
        where: { id: string; status: string };
        data: Record<string, unknown>;
      }): Promise<{ count: number }> => {
        const row = transactions.get(where.id);
        if (row === undefined || row.status !== where.status) {
          return Promise.resolve({ count: 0 });
        }
        transactions.set(row.id, {
          ...row,
          status: typeof data.status === 'string' ? data.status : row.status,
          verifiedAt: data.verifiedAt instanceof Date ? data.verifiedAt : null,
        });
        return Promise.resolve({ count: 1 });
      },
    },
    $transaction: (operation: unknown, opts: unknown): Promise<unknown> => {
      const run = queue.then(() => {
        harness.transactionOptions.push(opts);
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
    service: new SubscriptionsService(
      new PrismaService(
        db as unknown as ConstructorParameters<typeof PrismaService>[0],
      ),
      paystack,
      stripe,
    ),
  });
};

const pendingTx = (overrides: Partial<TxRow> = {}): TxRow => ({
  id: 'tx-1',
  userId: 'user-1',
  planId: 'plan-gold',
  communityId: null,
  amount: 10,
  currency: 'USD',
  paymentMethod: 'paystack',
  paymentReference: 'SUB-1',
  status: 'pending',
  metadata: null,
  failureReason: null,
  retryCount: 0,
  verifiedAt: null,
  updatedAt: EPOCH,
  ...overrides,
});

describe('subscription initialization', () => {
  it('creates a pending transaction and returns the paystack link', async () => {
    const harness = createHarness();
    const result = await harness.service.initialize(subscriber, {
      planId: 'plan-gold',
      paymentMethod: 'paystack',
    });

    expect(result.data.authorizationUrl).toBe(
      'https://checkout.paystack.com/x',
    );
    expect(harness.paystack.lastInitialize?.amountMinor).toBe(1000);
    expect([...harness.transactions.values()][0]).toMatchObject({
      status: 'pending',
      planId: 'plan-gold',
    });
  });

  it('records the stripe payment intent id against the transaction', async () => {
    const harness = createHarness();
    const result = await harness.service.initialize(subscriber, {
      planId: 'plan-gold',
      paymentMethod: 'stripe',
    });

    expect(result.data.paymentIntentId).toBe('pi_123');
    // Legacy stored nothing, so verification later asked Stripe about `SUB-…`.
    expect([...harness.transactions.values()][0]?.metadata).toEqual({
      providerReference: 'pi_123',
    });
  });

  it('refuses an unknown, inactive or already-held plan', async () => {
    await expect(
      createHarness().service.initialize(subscriber, {
        planId: 'nope',
        paymentMethod: 'paystack',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await expect(
      createHarness({
        plans: [makePlan({ isActive: false })],
      }).service.initialize(subscriber, {
        planId: 'plan-gold',
        paymentMethod: 'paystack',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const held = createHarness({
      users: [
        makeUser({
          subscriptionPlanId: 'plan-gold',
          subscriptionStatus: 'active',
          subscriptionExpiry: new Date(Date.now() + 86_400_000),
        }),
      ],
    });
    await expect(
      held.service.initialize(subscriber, {
        planId: 'plan-gold',
        paymentMethod: 'paystack',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('marks the transaction failed when the provider refuses', async () => {
    const harness = createHarness();
    harness.paystack.initialize = (): Promise<PaystackInitialization> =>
      Promise.reject(new Error('provider down'));

    await expect(
      harness.service.initialize(subscriber, {
        planId: 'plan-gold',
        paymentMethod: 'paystack',
      }),
    ).rejects.toThrow(/provider down/u);
    expect([...harness.transactions.values()][0]?.status).toBe('failed');
  });
});

describe('subscription verification', () => {
  it('activates the subscription once a paystack payment settles', async () => {
    const harness = createHarness({ transactions: [pendingTx()] });
    const result = await harness.service.verify({
      reference: 'SUB-1',
      paymentMethod: 'paystack',
    });

    expect(result.data.success).toBe(true);
    expect(harness.transactions.get('tx-1')?.status).toBe('completed');
    expect(harness.users.get('user-1')).toMatchObject({
      subscriptionStatus: 'active',
      subscriptionPlanId: 'plan-gold',
      goldenTick: true,
    });
    expect(harness.transactionOptions).toContainEqual({
      isolationLevel: 'Serializable',
    });
  });

  it('verifies stripe against the provider reference, which legacy never stored', async () => {
    const harness = createHarness({
      transactions: [
        pendingTx({
          paymentMethod: 'stripe',
          metadata: { providerReference: 'pi_123' },
        }),
      ],
    });

    const result = await harness.service.verify({
      reference: 'SUB-1',
      paymentMethod: 'stripe',
    });

    expect(harness.stripe.retrievedIds).toEqual(['pi_123']);
    expect(result.data.success).toBe(true);
    expect(harness.transactions.get('tx-1')?.status).toBe('completed');
  });

  it('reports an unsettled payment without activating anything', async () => {
    const harness = createHarness({ transactions: [pendingTx()] });
    harness.paystack.status = 'abandoned';

    const result = await harness.service.verify({
      reference: 'SUB-1',
      paymentMethod: 'paystack',
    });

    expect(result.data.success).toBe(false);
    expect(harness.transactions.get('tx-1')?.status).toBe('pending');
    expect(harness.activations).toBe(0);
  });

  it('activates exactly once when a webhook and a verification race', async () => {
    const harness = createHarness({ transactions: [pendingTx()] });
    // Legacy read the status outside the transaction that wrote it, so both
    // callers passed the guard and both extended the subscription.
    await Promise.all([
      harness.service.verify({
        reference: 'SUB-1',
        paymentMethod: 'paystack',
      }),
      harness.service.completeTransaction('tx-1'),
    ]);

    expect(harness.activations).toBe(1);
  });

  it('reports an already-verified payment without touching the row', async () => {
    const harness = createHarness({
      transactions: [pendingTx({ status: 'completed' })],
    });
    const result = await harness.service.verify({
      reference: 'SUB-1',
      paymentMethod: 'paystack',
    });

    expect(result.data).toMatchObject({
      alreadyProcessed: true,
      message: 'Payment already verified',
    });
    expect(harness.activations).toBe(0);
  });

  it('reports a missing transaction rather than acting on nothing', async () => {
    await expect(
      createHarness().service.verify({
        reference: 'nope',
        paymentMethod: 'paystack',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses to complete a transaction that is not a subscription', async () => {
    const harness = createHarness({
      transactions: [pendingTx({ planId: null, communityId: 'c1' })],
    });
    await expect(
      harness.service.completeTransaction('tx-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('subscription status and admin views', () => {
  it('reports the status without the columns that do not exist', async () => {
    const harness = createHarness({
      users: [
        makeUser({
          subscriptionPlanId: 'plan-gold',
          subscriptionStatus: 'active',
          goldenTick: true,
        }),
      ],
    });
    const result = await harness.service.status(subscriber);

    // Legacy also selected prideTick and businessTick, which are not columns
    // on User, so Prisma rejected the query and the route answered 500.
    expect(Object.keys(result.data ?? {}).sort()).toEqual([
      'goldenTick',
      'subscriptionExpiry',
      'subscriptionPlan',
      'subscriptionPlanId',
      'subscriptionStatus',
    ]);
    expect(result.data?.subscriptionPlan?.name).toBe('Gold');
  });

  it('lists subscribers with the legacy pagination envelope', async () => {
    const harness = createHarness();
    const page = await harness.service.listSubscribers({});
    expect(page.pagination).toEqual({ total: 1, page: 1, pages: 1 });
  });

  it('totals revenue per plan', async () => {
    const harness = createHarness();
    const stats = await harness.service.stats();
    expect(stats.byPlan[0]).toEqual({
      planId: 'plan-gold',
      planName: 'Gold',
      count: 2,
      estimatedRevenue: 20,
    });
    expect(stats.totalSubscribers).toBe(2);
    expect(stats.totalMonthlyRevenue).toBe(20);
  });
});

describe('subscription routes', () => {
  const reflector = new Reflector();
  const handlerOf = (method: string) => {
    const handler: unknown = Reflect.get(
      SubscriptionsController.prototype,
      method,
    );
    if (typeof handler !== 'function') {
      throw new Error(`SubscriptionsController.${method} is missing`);
    }
    return handler;
  };

  it('registers the exact five legacy routes', () => {
    expect(reflector.get<unknown>(PATH_METADATA, SubscriptionsController)).toBe(
      'api/subscription',
    );

    const routes = [
      ['listSubscribers', 'admin/all', RequestMethod.GET],
      ['stats', 'admin/stats', RequestMethod.GET],
      ['initialize', 'initialize', RequestMethod.POST],
      ['verify', 'verify', RequestMethod.GET],
      ['status', 'status', RequestMethod.GET],
    ] as const;

    for (const [name, path, method] of routes) {
      expect(reflector.get<unknown>(PATH_METADATA, handlerOf(name))).toBe(path);
      expect(reflector.get<unknown>(METHOD_METADATA, handlerOf(name))).toBe(
        method,
      );
    }
  });

  it('keeps the legacy guard stack on every route', () => {
    expect(
      reflector.get<readonly unknown[]>(
        GUARDS_METADATA,
        handlerOf('listSubscribers'),
      ),
    ).toEqual([SessionGuard, RoleGuard]);
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf('stats')),
    ).toEqual([SessionGuard, RoleGuard]);
    // Legacy required a second factor to start paying.
    expect(
      reflector.get<readonly unknown[]>(
        GUARDS_METADATA,
        handlerOf('initialize'),
      ),
    ).toEqual([SessionGuard, TwoFactorGuard]);
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf('status')),
    ).toEqual([SessionGuard]);
    // The provider callback lands here with no session.
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf('verify')),
    ).toBeUndefined();
  });
});
