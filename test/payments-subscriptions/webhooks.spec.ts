import { createHmac } from 'node:crypto';

import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { DomainError } from '../../src/common/errors/domain.error';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { CommunityPaymentPort } from '../../src/providers/community-payment/community-payment.port';
import { UnavailableCommunityPaymentAdapter } from '../../src/providers/community-payment/unavailable-community-payment.adapter';
import { HttpPaystackAdapter } from '../../src/providers/paystack/http-paystack.adapter';
import type {
  StripeCheckoutRequest,
  StripeCheckoutSession,
  StripePaymentIntent,
  StripePaymentIntentRequest,
  StripeRetrievedSession,
  StripeWebhookEvent,
} from '../../src/providers/stripe/stripe.port';
import { StripePort } from '../../src/providers/stripe/stripe.port';
import { SubscriptionsService } from '../../src/subscriptions/subscriptions.service';
import { WebhooksController } from '../../src/webhooks/webhooks.controller';
import { WebhooksService } from '../../src/webhooks/webhooks.service';

const SECRET = 'sk_paystack_secret';

const sign = (body: Buffer): string =>
  createHmac('sha512', SECRET).update(body).digest('hex');

const paystackEvent = (event: string, data: unknown): Buffer =>
  Buffer.from(JSON.stringify({ event, data }), 'utf8');

class FakeStripe extends StripePort {
  event: StripeWebhookEvent = {
    type: 'payment_intent.succeeded',
    metadata: { transactionId: 'tx-sub' },
    raw: {},
  };
  verified = 0;

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
    void request;
    return Promise.reject(new Error('not used'));
  }

  retrievePaymentIntent(): Promise<StripePaymentIntent> {
    return Promise.reject(new Error('not used'));
  }

  constructWebhookEvent(
    rawBody: Buffer,
    signature: string,
  ): StripeWebhookEvent {
    this.verified += 1;
    if (signature !== 'good') {
      throw new DomainError(
        'VALIDATION_FAILED',
        'The webhook signature could not be verified.',
      );
    }
    void rawBody;
    return this.event;
  }
}

interface TxRow {
  id: string;
  planId: string | null;
  communityId: string | null;
  paymentReference: string;
}

interface Harness {
  readonly service: WebhooksService;
  readonly stripe: FakeStripe;
  readonly completed: string[];
  readonly settled: string[];
}

const createHarness = (
  rows: readonly TxRow[] = [
    {
      id: 'tx-sub',
      planId: 'plan-1',
      communityId: null,
      paymentReference: 'r1',
    },
    {
      id: 'tx-community',
      planId: null,
      communityId: 'c1',
      paymentReference: 'r2',
    },
    {
      id: 'tx-orphan',
      planId: null,
      communityId: null,
      paymentReference: 'r3',
    },
  ],
  options: Readonly<{ communityAdapter?: CommunityPaymentPort }> = {},
): Harness => {
  const store = new Map(rows.map((row) => [row.id, row]));
  const completed: string[] = [];
  const settled: string[] = [];
  const stripe = new FakeStripe();

  const db = {
    transaction: {
      findUnique: ({ where }: { where: { id: string } }): Promise<unknown> =>
        Promise.resolve(store.get(where.id) ?? null),
      findFirst: ({
        where,
      }: {
        where: { paymentReference: string };
      }): Promise<unknown> =>
        Promise.resolve(
          [...store.values()].find(
            (row) => row.paymentReference === where.paymentReference,
          ) ?? null,
        ),
    },
  };

  const subscriptions = {
    completeTransaction: (id: string): Promise<{ success: true }> => {
      completed.push(id);
      return Promise.resolve({ success: true as const });
    },
  } as unknown as SubscriptionsService;

  const community =
    options.communityAdapter ??
    ({
      settle: (id: string): Promise<void> => {
        settled.push(id);
        return Promise.resolve();
      },
    } satisfies CommunityPaymentPort);

  return {
    service: new WebhooksService(
      new PrismaService(
        db as unknown as ConstructorParameters<typeof PrismaService>[0],
      ),
      new HttpPaystackAdapter(SECRET),
      stripe,
      subscriptions,
      community,
    ),
    stripe,
    completed,
    settled,
  };
};

describe('paystack webhook', () => {
  it('settles a subscription named in the event metadata', async () => {
    const harness = createHarness();
    const body = paystackEvent('charge.success', {
      reference: 'r1',
      metadata: { transactionId: 'tx-sub' },
    });

    await expect(
      harness.service.handlePaystack(body, sign(body)),
    ).resolves.toEqual({ handled: true });
    expect(harness.completed).toEqual(['tx-sub']);
  });

  it('falls back to the payment reference when metadata carries no id', async () => {
    const harness = createHarness();
    const body = paystackEvent('charge.success', { reference: 'r1' });

    await expect(
      harness.service.handlePaystack(body, sign(body)),
    ).resolves.toEqual({ handled: true });
    expect(harness.completed).toEqual(['tx-sub']);
  });

  it('rejects a forged, absent or wrong-length signature', async () => {
    const harness = createHarness();
    const body = paystackEvent('charge.success', { reference: 'r1' });

    for (const signature of [undefined, '', 'deadbeef', sign(body).slice(1)]) {
      await expect(
        harness.service.handlePaystack(body, signature),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(harness.completed).toEqual([]);
  });

  it('rejects a signature computed over re-serialised JSON', async () => {
    const harness = createHarness();
    const body = paystackEvent('charge.success', { reference: 'r1' });
    // Signing the parsed-and-restringified payload gives a different digest;
    // this is why the raw bytes must reach the verifier.
    const reserialised = Buffer.from(
      JSON.stringify(JSON.parse(body.toString('utf8')), null, 2),
      'utf8',
    );

    await expect(
      harness.service.handlePaystack(body, sign(reserialised)),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('acknowledges an event it does not act on', async () => {
    const harness = createHarness();
    for (const body of [
      paystackEvent('charge.failed', { reference: 'r1' }),
      paystackEvent('charge.success', { reference: 'unknown' }),
      paystackEvent('charge.success', {}),
    ]) {
      await expect(
        harness.service.handlePaystack(body, sign(body)),
      ).resolves.toEqual({ handled: false });
    }
    expect(harness.completed).toEqual([]);
  });

  it('rejects a body that is not the JSON the signature covers', async () => {
    const harness = createHarness();
    const body = Buffer.from('not json', 'utf8');
    await expect(
      harness.service.handlePaystack(body, sign(body)),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('routes a community payment to the community settlement', async () => {
    const harness = createHarness();
    const body = paystackEvent('charge.success', {
      metadata: { transactionId: 'tx-community' },
    });

    await expect(
      harness.service.handlePaystack(body, sign(body)),
    ).resolves.toEqual({ handled: true });
    expect(harness.settled).toEqual(['tx-community']);
    expect(harness.completed).toEqual([]);
  });

  it('asks the provider to retry while community settlement is unavailable', async () => {
    const harness = createHarness(undefined, {
      communityAdapter: new UnavailableCommunityPaymentAdapter(),
    });
    const body = paystackEvent('charge.success', {
      metadata: { transactionId: 'tx-community' },
    });

    // A retryable failure keeps the event queued rather than dropping a
    // payment the communities domain has not landed to settle yet.
    await expect(
      harness.service.handlePaystack(body, sign(body)),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('acknowledges a transaction that is neither kind', async () => {
    const harness = createHarness();
    const body = paystackEvent('charge.success', {
      metadata: { transactionId: 'tx-orphan' },
    });
    await expect(
      harness.service.handlePaystack(body, sign(body)),
    ).resolves.toEqual({ handled: false });
  });
});

describe('stripe webhook', () => {
  it('settles a subscription on a succeeded payment intent', async () => {
    const harness = createHarness();
    await expect(
      harness.service.handleStripe(Buffer.from('{}', 'utf8'), 'good'),
    ).resolves.toEqual({ handled: true });
    expect(harness.completed).toEqual(['tx-sub']);
  });

  it('settles on a completed checkout session too', async () => {
    const harness = createHarness();
    harness.stripe.event = {
      type: 'checkout.session.completed',
      metadata: { transactionId: 'tx-sub' },
      raw: {},
    };
    await expect(
      harness.service.handleStripe(Buffer.from('{}', 'utf8'), 'good'),
    ).resolves.toEqual({ handled: true });
  });

  it('rejects a forged or absent signature', async () => {
    const harness = createHarness();
    await expect(
      harness.service.handleStripe(Buffer.from('{}', 'utf8'), 'bad'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      harness.service.handleStripe(Buffer.from('{}', 'utf8'), undefined),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('acknowledges an event carrying no transaction metadata', async () => {
    const harness = createHarness();
    // Legacy read `.metadata.transactionId` unguarded, so this threw and
    // answered 500, making Stripe retry a request that could never succeed.
    harness.stripe.event = {
      type: 'payment_intent.succeeded',
      metadata: {},
      raw: {},
    };
    await expect(
      harness.service.handleStripe(Buffer.from('{}', 'utf8'), 'good'),
    ).resolves.toEqual({ handled: false });
    expect(harness.completed).toEqual([]);
  });

  it('ignores an event type it does not act on', async () => {
    const harness = createHarness();
    harness.stripe.event = {
      type: 'payment_intent.payment_failed',
      metadata: { transactionId: 'tx-sub' },
      raw: {},
    };
    await expect(
      harness.service.handleStripe(Buffer.from('{}', 'utf8'), 'good'),
    ).resolves.toEqual({ handled: false });
    expect(harness.completed).toEqual([]);
  });
});

describe('webhook routes', () => {
  const reflector = new Reflector();
  const handlerOf = (name: string) => {
    const handler: unknown = Reflect.get(WebhooksController.prototype, name);
    if (typeof handler !== 'function') {
      throw new Error(`WebhooksController.${name} is missing`);
    }
    return handler;
  };

  it('registers the two legacy routes with no session guard', () => {
    expect(reflector.get<unknown>(PATH_METADATA, WebhooksController)).toBe(
      'api/webhooks',
    );

    for (const [name, path] of [
      ['paystack', 'paystack'],
      ['stripe', 'stripe'],
    ] as const) {
      expect(reflector.get<unknown>(PATH_METADATA, handlerOf(name))).toBe(path);
      expect(reflector.get<unknown>(METHOD_METADATA, handlerOf(name))).toBe(
        RequestMethod.POST,
      );
      // Authenticated by provider signature, not by session.
      expect(
        reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf(name)),
      ).toBeUndefined();
    }
  });
});
