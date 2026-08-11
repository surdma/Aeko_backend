import { createHmac } from 'node:crypto';

import { HttpFlutterwaveAdapter } from '../../src/providers/flutterwave/http-flutterwave.adapter';
import { HttpPaystackAdapter } from '../../src/providers/paystack/http-paystack.adapter';

const SECRET = 'sk_test_secret';

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string | null;
  readonly authorization: string | null;
}

interface Stub {
  readonly calls: Call[];
  restore(): void;
}

const jsonResponse = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Replaces global fetch with a scripted queue of responses. */
const stubFetch = (
  responses: readonly (Response | Error)[],
): Stub & { queue: (Response | Error)[] } => {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  const queue = [...responses];

  globalThis.fetch = (input: unknown, init?: unknown): Promise<Response> => {
    const request =
      typeof init === 'object' && init !== null
        ? (init as Record<string, unknown>)
        : {};
    const headers =
      typeof request.headers === 'object' && request.headers !== null
        ? (request.headers as Record<string, unknown>)
        : {};
    const authorization = headers.Authorization;
    calls.push({
      url: String(input),
      method: typeof request.method === 'string' ? request.method : 'GET',
      body: typeof request.body === 'string' ? request.body : null,
      authorization: typeof authorization === 'string' ? authorization : null,
    });

    const next = queue.shift();
    if (next === undefined) throw new Error('no scripted response left');
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  };

  return {
    calls,
    queue,
    restore: () => {
      globalThis.fetch = original;
    },
  };
};

describe('paystack signature verification', () => {
  const adapter = new HttpPaystackAdapter(SECRET);
  const body = Buffer.from('{"event":"charge.success"}', 'utf8');
  const valid = createHmac('sha512', SECRET).update(body).digest('hex');

  it('accepts a signature over the exact raw bytes', () => {
    expect(adapter.verifySignature(body, valid)).toBe(true);
  });

  it('rejects a signature computed over re-serialised JSON', () => {
    const reserialised = Buffer.from(
      JSON.stringify(JSON.parse(body.toString('utf8'))),
      'utf8',
    );
    const other = createHmac('sha512', SECRET)
      .update(Buffer.from('{"event":"charge.failed"}', 'utf8'))
      .digest('hex');
    expect(adapter.verifySignature(reserialised, other)).toBe(false);
  });

  it('rejects a wrong, empty or wrong-length signature without throwing', () => {
    expect(adapter.verifySignature(body, '')).toBe(false);
    expect(adapter.verifySignature(body, 'deadbeef')).toBe(false);
    expect(adapter.verifySignature(body, valid.slice(0, -1) + '0')).toBe(false);
  });

  it('refuses every signature when no key is configured', () => {
    expect(new HttpPaystackAdapter('').verifySignature(body, valid)).toBe(
      false,
    );
  });
});

describe('paystack http adapter', () => {
  it('reports the provider unavailable when no key is configured', async () => {
    await expect(
      new HttpPaystackAdapter('').verify('ref'),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('initializes with the amount in minor units and returns the link', async () => {
    const stub = stubFetch([
      jsonResponse(200, {
        status: true,
        data: {
          authorization_url: 'https://checkout.paystack.com/abc',
          access_code: 'abc',
          reference: 'COINS_1',
        },
      }),
    ]);
    try {
      const result = await new HttpPaystackAdapter(SECRET).initialize({
        email: 'payer@example.com',
        amountMinor: 9900,
        currency: 'NGN',
        reference: 'COINS_1',
        metadata: { userId: 'u1' },
      });

      expect(result).toEqual({
        authorizationUrl: 'https://checkout.paystack.com/abc',
        accessCode: 'abc',
        reference: 'COINS_1',
      });
      expect(stub.calls[0]?.authorization).toBe(`Bearer ${SECRET}`);
      expect(JSON.parse(stub.calls[0]?.body ?? '{}')).toMatchObject({
        amount: 9900,
        currency: 'NGN',
      });
    } finally {
      stub.restore();
    }
  });

  it('reads the status, amount and currency a caller must check', async () => {
    const stub = stubFetch([
      jsonResponse(200, {
        status: true,
        data: {
          status: 'success',
          reference: 'COINS_1',
          amount: 9900,
          currency: 'NGN',
          metadata: { userId: 'u1', packageId: 'coins_100' },
        },
      }),
    ]);
    try {
      await expect(
        new HttpPaystackAdapter(SECRET).verify('COINS_1'),
      ).resolves.toEqual({
        status: 'success',
        reference: 'COINS_1',
        amountMinor: 9900,
        currency: 'NGN',
        metadata: { userId: 'u1', packageId: 'coins_100' },
      });
    } finally {
      stub.restore();
    }
  });

  it('retries a transport failure but never a refusal', async () => {
    const retried = stubFetch([
      new Error('ECONNRESET'),
      jsonResponse(200, { status: true, data: { status: 'success' } }),
    ]);
    try {
      await expect(
        new HttpPaystackAdapter(SECRET).verify('ref'),
      ).resolves.toMatchObject({ status: 'success' });
      expect(retried.calls).toHaveLength(2);
    } finally {
      retried.restore();
    }

    const refused = stubFetch([jsonResponse(404, { status: false })]);
    try {
      await expect(
        new HttpPaystackAdapter(SECRET).verify('ref'),
      ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
      expect(refused.calls).toHaveLength(1);
    } finally {
      refused.restore();
    }
  });
});

describe('flutterwave http adapter', () => {
  it('reproduces the legacy unconfigured message', async () => {
    await expect(
      new HttpFlutterwaveAdapter('').verify('1'),
    ).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Payment service not configured',
    });
  });

  it('reads the transaction state from data.status, not the envelope', async () => {
    const stub = stubFetch([
      // Legacy compared the envelope's `status` to 'successful'. It is
      // 'success' for every answered call, so the check never passed.
      jsonResponse(200, {
        status: 'success',
        message: 'Transaction fetched',
        data: { id: 1, status: 'successful', amount: 500 },
      }),
    ]);
    try {
      const result = await new HttpFlutterwaveAdapter(SECRET).verify('1');
      expect(result.transactionStatus).toBe('successful');
      expect(result.raw).toMatchObject({ status: 'success' });
    } finally {
      stub.restore();
    }
  });

  it('reports a pending transaction as itself rather than as success', async () => {
    const stub = stubFetch([
      jsonResponse(200, {
        status: 'success',
        data: { id: 1, status: 'pending' },
      }),
    ]);
    try {
      await expect(
        new HttpFlutterwaveAdapter(SECRET).verify('1'),
      ).resolves.toMatchObject({ transactionStatus: 'pending' });
    } finally {
      stub.restore();
    }
  });

  it('hands the initiation payload back unchanged', async () => {
    const payload = {
      status: 'success',
      data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/abc' },
    };
    const stub = stubFetch([jsonResponse(200, payload)]);
    try {
      const result = await new HttpFlutterwaveAdapter(SECRET).initiate({
        txRef: 'tx-1',
        amount: 500,
        currency: 'NGN',
        redirectUrl: 'https://your-site.com/payment-success',
        paymentOptions: 'card, banktransfer, ussd',
        customer: { email: 'a@b.c', phonenumber: null, name: null },
      });
      expect(result).toEqual(payload);
      expect(stub.calls[0]?.url).toBe(
        'https://api.flutterwave.com/v3/payments',
      );
    } finally {
      stub.restore();
    }
  });
});
