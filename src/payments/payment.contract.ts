import { z } from 'zod';

import { boundedText, parseWithScope } from '../common/validation/parse';

/**
 * The Flutterwave slice is the one legacy payment path that writes no
 * `Transaction` row, so nothing it does is ever reconciled. The shapes below
 * describe exactly what the legacy route read from the request; the behaviour
 * is preserved and documented rather than redesigned.
 */
export interface PaymentInitiate {
  readonly amount: number;
  readonly email: string;
  readonly phone: string | null;
  readonly name: string | null;
}

export interface PaymentVerifyQuery {
  readonly transactionId: string;
}

const paymentInitiateSchema = z
  .object({
    amount: z.number().finite().positive(),
    email: z.string().trim().email().max(320),
    phone: boundedText(50).nullable().default(null),
    name: boundedText(200).nullable().default(null),
  })
  .strip();

/** Legacy read the query parameter as `transaction_id`. */
const paymentVerifyQuerySchema = z
  .object({ transaction_id: boundedText(200) })
  .strip()
  .transform((value) => ({ transactionId: value.transaction_id }));

export const parsePaymentInitiate = (input: unknown): PaymentInitiate =>
  Object.freeze(parseWithScope(paymentInitiateSchema, input, 'payment'));

export const parsePaymentVerifyQuery = (input: unknown): PaymentVerifyQuery =>
  Object.freeze(
    parseWithScope(paymentVerifyQuerySchema, input, 'payment verification'),
  );
