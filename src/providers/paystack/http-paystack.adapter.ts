import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { DomainError } from '../../common/errors/domain.error';
import {
  asJsonObject,
  isJsonObject,
  toJsonValue,
  type JsonValue,
} from '../../common/json/json-value';
import {
  PaystackPort,
  type PaystackInitialization,
  type PaystackInitializeRequest,
  type PaystackTransaction,
} from './paystack.port';

const BASE_URL = 'https://api.paystack.co';

/** Legacy allowed one retry on a server-side failure and none on a 4xx. */
const MAX_ATTEMPTS = 2;

const unavailable = (message: string): DomainError =>
  new DomainError('PROVIDER_UNAVAILABLE', message);

@Injectable()
export class HttpPaystackAdapter extends PaystackPort {
  private readonly secretKey: string;

  constructor(secretKey: string = process.env.PAYSTACK_SECRET_KEY ?? '') {
    super();
    this.secretKey = secretKey;
  }

  async initialize(
    request: PaystackInitializeRequest,
  ): Promise<PaystackInitialization> {
    const body: Record<string, JsonValue> = {
      email: request.email,
      amount: request.amountMinor,
      reference: request.reference,
      metadata: request.metadata,
    };
    if (request.currency !== undefined) body.currency = request.currency;
    if (request.callbackUrl !== undefined) {
      body.callback_url = request.callbackUrl;
    }

    const data = await this.call('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const authorizationUrl = data.authorization_url;
    const accessCode = data.access_code;
    const reference = data.reference;
    if (
      typeof authorizationUrl !== 'string' ||
      typeof accessCode !== 'string'
    ) {
      throw unavailable('Paystack returned an unusable initialization.');
    }

    return Object.freeze({
      authorizationUrl,
      accessCode,
      reference: typeof reference === 'string' ? reference : request.reference,
    });
  }

  async verify(reference: string): Promise<PaystackTransaction> {
    const data = await this.call(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      { method: 'GET' },
    );

    const status = data.status;
    if (typeof status !== 'string') {
      throw unavailable('Paystack returned an unusable verification.');
    }

    const amount = data.amount;
    const currency = data.currency;
    const verifiedReference = data.reference;

    return Object.freeze({
      status,
      reference:
        typeof verifiedReference === 'string' ? verifiedReference : reference,
      amountMinor: typeof amount === 'number' ? amount : 0,
      currency: typeof currency === 'string' ? currency : '',
      metadata: isJsonObject(data.metadata) ? data.metadata : {},
    });
  }

  verifySignature(rawBody: Buffer, signature: string): boolean {
    if (this.secretKey === '') return false;
    const expected = Buffer.from(
      createHmac('sha512', this.secretKey).update(rawBody).digest('hex'),
      'utf8',
    );
    const received = Buffer.from(signature, 'utf8');
    // timingSafeEqual throws on a length mismatch, which is itself a leak-free
    // rejection: a wrong-length signature cannot be the right one.
    if (expected.length !== received.length) return false;
    return timingSafeEqual(expected, received);
  }

  /** Returns the provider's `data` object, or throws a domain error. */
  private async call(
    path: string,
    init: Readonly<{ method: string; body?: string }>,
  ): Promise<Record<string, JsonValue>> {
    if (this.secretKey === '') {
      throw unavailable('Paystack is not configured.');
    }

    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${BASE_URL}${path}`, {
          method: init.method,
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json',
          },
          ...(init.body === undefined ? {} : { body: init.body }),
        });
      } catch (error: unknown) {
        // A transport failure is retryable; a refusal from Paystack is not.
        lastError = error;
        continue;
      }

      if (response.status >= 400 && response.status < 500) {
        throw unavailable('Paystack rejected the request.');
      }
      if (!response.ok) {
        lastError = new Error(`Paystack responded ${String(response.status)}`);
        continue;
      }

      const payload = toJsonValue(await response.json());
      const envelope = asJsonObject(payload);
      if (envelope === null) {
        throw unavailable('Paystack returned an unreadable response.');
      }
      const data = asJsonObject(envelope.data);
      if (data === null) {
        throw unavailable('Paystack returned an unreadable response.');
      }
      return data;
    }

    void lastError;
    throw unavailable('Paystack is unreachable. Please try again.');
  }
}
