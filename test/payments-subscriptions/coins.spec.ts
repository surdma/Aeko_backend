import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { SessionGuard } from '../../src/auth/guards/session/session.guard';
import {
  getCoinPackageById,
  type CoinPackage,
} from '../../src/coins/coin.contract';
import { CoinsController } from '../../src/coins/coins.controller';
import { CoinsService } from '../../src/coins/coins.service';
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

const requirePackage = (id: string): CoinPackage => {
  const found = getCoinPackageById(id);
  if (found === null) throw new Error(`${id} must exist`);
  return found;
};

const PACKAGE = requirePackage('coins_100');

const buyer: AuthenticatedPrincipal = {
  userId: 'buyer',
  email: 'buyer@example.com',
  username: 'buyer',
  isAdmin: false,
  banned: false,
  twoFactorEnabled: false,
  twoFactorSatisfied: false,
  sessionId: 'session-buyer',
};

interface LedgerRow {
  id: string;
  userId: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

class FakePaystack extends PaystackPort {
  transaction: PaystackTransaction = {
    status: 'success',
    reference: 'COINS_1',
    amountMinor: PACKAGE.pricePaise * 100,
    currency: 'NGN',
    metadata: { userId: 'buyer', packageId: PACKAGE.id },
  };
  lastInitialize: PaystackInitializeRequest | null = null;

  initialize(
    request: PaystackInitializeRequest,
  ): Promise<PaystackInitialization> {
    this.lastInitialize = request;
    return Promise.resolve({
      authorizationUrl: 'https://checkout.paystack.com/abc',
      accessCode: 'abc',
      reference: request.reference,
    });
  }

  verify(): Promise<PaystackTransaction> {
    return Promise.resolve(this.transaction);
  }

  verifySignature(): boolean {
    return true;
  }
}

class FakeStripe extends StripePort {
  session: StripeRetrievedSession = {
    id: 'cs_1',
    paymentStatus: 'paid',
    amountTotalMinor: Math.round(PACKAGE.priceUSD * 100),
    currency: 'usd',
    metadata: {
      userId: 'buyer',
      packageId: PACKAGE.id,
      reference: 'COINS_STRIPE_1',
    },
  };
  lastCheckout: StripeCheckoutRequest | null = null;

  createCheckoutSession(
    request: StripeCheckoutRequest,
  ): Promise<StripeCheckoutSession> {
    this.lastCheckout = request;
    return Promise.resolve({ id: 'cs_1', url: 'https://stripe.test/cs_1' });
  }

  retrieveSession(): Promise<StripeRetrievedSession> {
    return Promise.resolve(this.session);
  }

  createPaymentIntent(
    request: StripePaymentIntentRequest,
  ): Promise<StripePaymentIntent> {
    void request;
    return Promise.reject(new Error('not used'));
  }

  retrievePaymentIntent(): Promise<StripePaymentIntent> {
    return Promise.reject(new Error('not used'));
  }

  constructWebhookEvent(): StripeWebhookEvent {
    throw new Error('not used');
  }
}

interface Harness {
  readonly service: CoinsService;
  readonly paystack: FakePaystack;
  readonly stripe: FakeStripe;
  readonly ledger: LedgerRow[];
  balance: number;
  transactionOptions: unknown[];
}

const createHarness = (
  options: Readonly<{ balance?: number; userExists?: boolean }> = {},
): Harness => {
  const paystack = new FakePaystack();
  const stripe = new FakeStripe();
  const ledger: LedgerRow[] = [];
  const userExists = options.userExists ?? true;

  const harness: Harness = {
    service: undefined as unknown as CoinsService,
    paystack,
    stripe,
    ledger,
    balance: options.balance ?? 0,
    transactionOptions: [],
  };

  let queue: Promise<unknown> = Promise.resolve();

  const db = {
    user: {
      findUnique: (): Promise<unknown> =>
        Promise.resolve(
          userExists
            ? { coinBalance: harness.balance, email: buyer.email }
            : null,
        ),
      update: ({
        data,
      }: {
        data: { coinBalance: { increment: number } };
      }): Promise<unknown> => {
        harness.balance += data.coinBalance.increment;
        return Promise.resolve({ coinBalance: harness.balance });
      },
    },
    coinTransaction: {
      findFirst: ({
        where,
      }: {
        where: { metadata: { path: string[]; equals: string } };
      }): Promise<unknown> => {
        const reference = where.metadata.equals;
        return Promise.resolve(
          ledger.find((row) => row.metadata.reference === reference) ?? null,
        );
      },
      findMany: (): Promise<readonly unknown[]> => Promise.resolve(ledger),
      count: (): Promise<number> => Promise.resolve(ledger.length),
      create: ({
        data,
      }: {
        data: Omit<LedgerRow, 'id' | 'createdAt'>;
      }): Promise<unknown> => {
        const row: LedgerRow = {
          ...data,
          id: `ct-${String(ledger.length + 1)}`,
          createdAt: new Date('2026-08-11T00:00:00.000Z'),
        };
        ledger.push(row);
        return Promise.resolve(row);
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
    service: new CoinsService(
      new PrismaService(
        db as unknown as ConstructorParameters<typeof PrismaService>[0],
      ),
      paystack,
      stripe,
    ),
  });
};

describe('coin balance and history', () => {
  it('reports the balance', async () => {
    const harness = createHarness({ balance: 250 });
    await expect(harness.service.balance(buyer)).resolves.toEqual({
      success: true,
      data: { coinBalance: 250 },
    });
  });

  it('reports a missing user rather than answering 500', async () => {
    const harness = createHarness({ userExists: false });
    await expect(harness.service.balance(buyer)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('pages the ledger with the legacy envelope', async () => {
    const harness = createHarness({});
    const result = await harness.service.history(buyer, { page: '1' });
    expect(result.data).toMatchObject({ total: 0, page: 1, limit: 20 });
  });
});

describe('coin purchase initialization', () => {
  it('charges the catalogue price, never a price from the request', async () => {
    const harness = createHarness({});
    const result = await harness.service.purchase(buyer, {
      packageId: PACKAGE.id,
      pricePaise: 1,
      coins: 999_999,
    });

    expect(harness.paystack.lastInitialize?.amountMinor).toBe(
      PACKAGE.pricePaise * 100,
    );
    expect(harness.paystack.lastInitialize?.currency).toBe('NGN');
    expect(result.data.package).toEqual(PACKAGE);
    expect(result.data.reference.startsWith('COINS_')).toBe(true);
  });

  it('opens a stripe checkout for the stripe method', async () => {
    const harness = createHarness({});
    const result = await harness.service.purchase(buyer, {
      packageId: PACKAGE.id,
      paymentMethod: 'stripe',
    });

    expect(harness.stripe.lastCheckout?.amountMinor).toBe(
      Math.round(PACKAGE.priceUSD * 100),
    );
    expect(result.data.sessionId).toBe('cs_1');
    expect(result.data.url).toBe('https://stripe.test/cs_1');
  });

  it('rejects an unknown package', async () => {
    const harness = createHarness({});
    await expect(
      harness.service.purchase(buyer, { packageId: 'coins_free' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('coin credit', () => {
  it('credits once and reports the new balance', async () => {
    const harness = createHarness({ balance: 40 });
    const result = await harness.service.verifyPaystack({
      reference: 'COINS_1',
    });

    expect(result).toEqual({
      success: true,
      message: 'Coins credited successfully',
      data: { coins: PACKAGE.coins, coinBalance: 40 + PACKAGE.coins },
    });
    expect(harness.ledger).toHaveLength(1);
    expect(harness.transactionOptions).toContainEqual({
      isolationLevel: 'Serializable',
    });
  });

  it('never credits the same reference twice, even concurrently', async () => {
    const harness = createHarness({ balance: 0 });
    // Legacy checked for a duplicate outside the transaction, so two callbacks
    // arriving together both passed the check and both credited.
    await Promise.all([
      harness.service.verifyPaystack({ reference: 'COINS_1' }),
      harness.service.verifyPaystack({ reference: 'COINS_1' }),
    ]);

    expect(harness.ledger).toHaveLength(1);
    expect(harness.balance).toBe(PACKAGE.coins);
  });

  it('replays an already-processed reference without moving the balance', async () => {
    const harness = createHarness({ balance: 0 });
    await harness.service.verifyPaystack({ reference: 'COINS_1' });
    const replay = await harness.service.verifyPaystack({
      reference: 'COINS_1',
    });

    expect(replay).toEqual({
      success: true,
      message: 'Already processed',
      data: { coinBalance: PACKAGE.coins },
    });
    expect(harness.balance).toBe(PACKAGE.coins);
  });

  it('reports the live balance on replay, not the one from credit time', async () => {
    const harness = createHarness({ balance: 0 });
    await harness.service.verifyPaystack({ reference: 'COINS_1' });

    // The buyer spends after the credit landed; the ledger row still records
    // the balance as it stood then, which is no longer what they hold.
    harness.balance -= 30;

    await expect(
      harness.service.verifyPaystack({ reference: 'COINS_1' }),
    ).resolves.toEqual({
      success: true,
      message: 'Already processed',
      data: { coinBalance: PACKAGE.coins - 30 },
    });
  });

  it('adds to the stored balance rather than to one read earlier', async () => {
    const harness = createHarness({ balance: 100 });
    harness.paystack.transaction = {
      ...harness.paystack.transaction,
      reference: 'COINS_A',
      metadata: { userId: 'buyer', packageId: PACKAGE.id },
    };
    await harness.service.verifyPaystack({ reference: 'COINS_A' });

    harness.paystack.transaction = {
      ...harness.paystack.transaction,
      reference: 'COINS_B',
    };
    await harness.service.verifyPaystack({ reference: 'COINS_B' });

    // Two credits of the same package must both land.
    expect(harness.balance).toBe(100 + PACKAGE.coins * 2);
    expect(harness.ledger.map((row) => row.balanceAfter)).toEqual([
      100 + PACKAGE.coins,
      100 + PACKAGE.coins * 2,
    ]);
  });

  it('refuses to credit a payment that did not settle', async () => {
    const harness = createHarness({});
    harness.paystack.transaction = {
      ...harness.paystack.transaction,
      status: 'abandoned',
    };
    await expect(
      harness.service.verifyPaystack({ reference: 'COINS_1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(harness.ledger).toHaveLength(0);
  });

  it('refuses to credit when the amount paid is short', async () => {
    const harness = createHarness({});
    // Legacy credited on the provider status alone and never compared amounts.
    harness.paystack.transaction = {
      ...harness.paystack.transaction,
      amountMinor: 1,
    };
    await expect(
      harness.service.verifyPaystack({ reference: 'COINS_1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(harness.ledger).toHaveLength(0);
    expect(harness.balance).toBe(0);
  });

  it('refuses to credit when the currency does not match', async () => {
    const harness = createHarness({});
    harness.paystack.transaction = {
      ...harness.paystack.transaction,
      currency: 'GHS',
    };
    await expect(
      harness.service.verifyPaystack({ reference: 'COINS_1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses metadata that names no package or no user', async () => {
    const harness = createHarness({});
    for (const metadata of [
      {},
      { userId: 'buyer' },
      { packageId: PACKAGE.id },
      { userId: 'buyer', packageId: 'coins_free' },
    ]) {
      harness.paystack.transaction = {
        ...harness.paystack.transaction,
        metadata,
      };
      await expect(
        harness.service.verifyPaystack({ reference: 'COINS_1' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(harness.ledger).toHaveLength(0);
  });

  it('credits a paid stripe session and refuses an unpaid one', async () => {
    const harness = createHarness({ balance: 0 });
    await expect(
      harness.service.verifyStripe({ sessionId: 'cs_1' }),
    ).resolves.toMatchObject({ message: 'Coins credited successfully' });

    harness.stripe.session = {
      ...harness.stripe.session,
      paymentStatus: 'unpaid',
    };
    await expect(
      harness.service.verifyStripe({ sessionId: 'cs_1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(harness.ledger).toHaveLength(1);
  });

  it('refuses a stripe session whose total is short', async () => {
    const harness = createHarness({});
    harness.stripe.session = {
      ...harness.stripe.session,
      amountTotalMinor: 1,
    };
    await expect(
      harness.service.verifyStripe({ sessionId: 'cs_1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('coin routes', () => {
  const reflector = new Reflector();
  const handlerOf = (method: string) => {
    const handler: unknown = Reflect.get(CoinsController.prototype, method);
    if (typeof handler !== 'function') {
      throw new Error(`CoinsController.${method} is missing`);
    }
    return handler;
  };

  it('registers the exact six legacy routes', () => {
    expect(reflector.get<unknown>(PATH_METADATA, CoinsController)).toBe(
      'api/coins',
    );

    const routes = [
      ['packages', 'packages', RequestMethod.GET],
      ['balance', 'balance', RequestMethod.GET],
      ['history', 'history', RequestMethod.GET],
      ['purchase', 'purchase', RequestMethod.POST],
      ['verifyPaystack', 'purchase/verify', RequestMethod.GET],
      ['verifyStripe', 'purchase/verify-stripe', RequestMethod.POST],
    ] as const;

    for (const [name, path, method] of routes) {
      expect(reflector.get<unknown>(PATH_METADATA, handlerOf(name))).toBe(path);
      expect(reflector.get<unknown>(METHOD_METADATA, handlerOf(name))).toBe(
        method,
      );
    }
  });

  it('guards exactly what legacy guarded, no more and no less', () => {
    for (const name of ['balance', 'history', 'purchase', 'verifyStripe']) {
      expect(
        reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf(name)),
      ).toEqual([SessionGuard]);
    }
    // The catalogue and the Paystack callback were public, and must stay so:
    // the provider redirects the payer to the callback with no session.
    for (const name of ['packages', 'verifyPaystack']) {
      expect(
        reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf(name)),
      ).toBeUndefined();
    }
  });
});
