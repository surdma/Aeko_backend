import { Injectable } from '@nestjs/common';

import { DomainError } from '../common/errors/domain.error';
import type { JsonValue } from '../common/json/json-value';
import { FlutterwavePort } from '../providers/flutterwave/flutterwave.port';
import {
  parsePaymentInitiate,
  parsePaymentVerifyQuery,
} from './payment.contract';

/**
 * The Flutterwave slice, preserved as it was found.
 *
 * It writes no `Transaction` row, so nothing it takes is ever reconciled
 * against the ledger, and the redirect target is the placeholder the legacy
 * code shipped with. Both are behaviour a client can observe, so both are kept;
 * see the domain compatibility document for what that means operationally.
 */
const REDIRECT_URL = 'https://your-site.com/payment-success';
const PAYMENT_OPTIONS = 'card, banktransfer, ussd';
const CURRENCY = 'NGN';
const SETTLED = 'successful';

@Injectable()
export class PaymentsService {
  constructor(private readonly flutterwave: FlutterwavePort) {}

  async initiate(body: unknown): Promise<JsonValue> {
    const input = parsePaymentInitiate(body);
    return this.flutterwave.initiate({
      txRef: `tx-${String(Date.now())}`,
      amount: input.amount,
      currency: CURRENCY,
      redirectUrl: REDIRECT_URL,
      paymentOptions: PAYMENT_OPTIONS,
      customer: {
        email: input.email,
        phonenumber: input.phone,
        name: input.name,
      },
    });
  }

  async verify(query: unknown): Promise<{
    readonly message: string;
    readonly data: JsonValue;
  }> {
    const { transactionId } = parsePaymentVerifyQuery(query);
    const verification = await this.flutterwave.verify(transactionId);

    // Legacy compared the response envelope's `status` to 'successful'. The
    // envelope says 'success' for any answered call, so this never matched and
    // the route always reported a failure.
    if (verification.transactionStatus !== SETTLED) {
      throw new DomainError('VALIDATION_FAILED', 'Payment verification failed');
    }

    return Object.freeze({
      message: 'Payment successful',
      data: verification.raw,
    });
  }
}
