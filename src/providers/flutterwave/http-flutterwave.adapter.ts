import { Injectable } from '@nestjs/common';

import { DomainError } from '../../common/errors/domain.error';
import {
  asJsonObject,
  toJsonValue,
  type JsonValue,
} from '../../common/json/json-value';
import {
  FlutterwavePort,
  type FlutterwaveInitiateRequest,
  type FlutterwaveVerification,
} from './flutterwave.port';

const BASE_URL = 'https://api.flutterwave.com/v3';

const unavailable = (message: string): DomainError =>
  new DomainError('PROVIDER_UNAVAILABLE', message);

/**
 * Calls the same two v3 endpoints `flutterwave-node-v3` wraps, and returns the
 * provider payload unchanged so the response body a client sees is the one it
 * saw before.
 */
@Injectable()
export class HttpFlutterwaveAdapter extends FlutterwavePort {
  private readonly secretKey: string;

  constructor(secretKey: string = process.env.FLUTTERWAVE_SECRET_KEY ?? '') {
    super();
    this.secretKey = secretKey;
  }

  async initiate(request: FlutterwaveInitiateRequest): Promise<JsonValue> {
    return this.call('/payments', {
      method: 'POST',
      body: JSON.stringify({
        tx_ref: request.txRef,
        amount: request.amount,
        currency: request.currency,
        redirect_url: request.redirectUrl,
        payment_options: request.paymentOptions,
        customer: {
          email: request.customer.email,
          phonenumber: request.customer.phonenumber,
          name: request.customer.name,
        },
      }),
    });
  }

  async verify(transactionId: string): Promise<FlutterwaveVerification> {
    const payload = await this.call(
      `/transactions/${encodeURIComponent(transactionId)}/verify`,
      { method: 'GET' },
    );

    // The transaction state lives at `data.status`. Legacy read the envelope's
    // `status`, which is `success` for any answered call.
    const envelope = asJsonObject(payload);
    const data = envelope === null ? null : asJsonObject(envelope.data);
    const status = data === null ? null : data.status;

    return Object.freeze({
      transactionStatus: typeof status === 'string' ? status : null,
      raw: payload,
    });
  }

  private async call(
    path: string,
    init: Readonly<{ method: string; body?: string }>,
  ): Promise<JsonValue> {
    if (this.secretKey === '') {
      throw unavailable('Payment service not configured');
    }

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
    } catch {
      throw unavailable('Flutterwave is unreachable. Please try again.');
    }

    let payload: JsonValue;
    try {
      payload = toJsonValue(await response.json());
    } catch {
      throw unavailable('Flutterwave returned an unreadable response.');
    }

    if (!response.ok) {
      throw unavailable('Flutterwave rejected the request.');
    }
    return payload;
  }
}
