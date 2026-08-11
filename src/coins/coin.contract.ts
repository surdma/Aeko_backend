import { z } from 'zod';

import {
  boundedText,
  parseWithScope,
  queryInteger,
} from '../common/validation/parse';

/**
 * The catalogue is a fixed server-side price list, copied verbatim from the
 * legacy `config/giftCatalog.js`. Prices are never taken from the request, so
 * a client cannot choose what it pays.
 *
 * `pricePaise` is charged to Paystack as kobo. The field name and the currency
 * disagree, which is a pricing decision rather than a migration one, so it is
 * preserved exactly as it was.
 */
export interface CoinPackage {
  readonly id: string;
  readonly coins: number;
  readonly priceUSD: number;
  readonly pricePaise: number;
  readonly label: string;
  readonly bonus?: number;
}

export const COIN_PACKAGES: readonly CoinPackage[] = Object.freeze([
  Object.freeze({
    id: 'coins_100',
    coins: 100,
    priceUSD: 0.99,
    pricePaise: 99,
    label: '100 Coins',
  }),
  Object.freeze({
    id: 'coins_500',
    coins: 500,
    priceUSD: 4.99,
    pricePaise: 499,
    label: '500 Coins',
  }),
  Object.freeze({
    id: 'coins_1200',
    coins: 1200,
    priceUSD: 9.99,
    pricePaise: 999,
    label: '1,200 Coins',
    bonus: 200,
  }),
  Object.freeze({
    id: 'coins_2500',
    coins: 2500,
    priceUSD: 19.99,
    pricePaise: 1999,
    label: '2,500 Coins',
    bonus: 500,
  }),
  Object.freeze({
    id: 'coins_6500',
    coins: 6500,
    priceUSD: 49.99,
    pricePaise: 4999,
    label: '6,500 Coins',
    bonus: 1500,
  }),
]);

export const getCoinPackageById = (id: string): CoinPackage | null =>
  COIN_PACKAGES.find((entry) => entry.id === id) ?? null;

export type CoinPaymentMethod = 'paystack' | 'stripe';

export interface CoinPurchase {
  readonly packageId: string;
  readonly paymentMethod: CoinPaymentMethod;
}

export interface CoinHistoryQuery {
  readonly page: number;
  readonly limit: number;
  readonly type: string | null;
}

export interface PaystackVerifyQuery {
  readonly reference: string;
}

export interface StripeVerifyRequest {
  readonly sessionId: string;
}

export interface CoinTransactionView {
  readonly id: string;
  readonly userId: string;
  readonly type: string;
  readonly amount: number;
  readonly balanceAfter: number;
  readonly description: string | null;
  readonly metadata: unknown;
  readonly createdAt: string;
}

export interface CoinHistoryPage {
  readonly transactions: readonly CoinTransactionView[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

/** Legacy defaulted to paystack when the field was absent. */
const coinPurchaseSchema = z
  .object({
    packageId: boundedText(100),
    paymentMethod: z.enum(['paystack', 'stripe']).default('paystack'),
  })
  .strip();

/**
 * Legacy applied `parseInt(limit)` with no ceiling, so a single request could
 * ask for the whole table. The ceiling is new; the default of 20 is not.
 */
const coinHistoryQuerySchema = z
  .object({
    page: queryInteger(1, 1_000_000).default(1),
    limit: queryInteger(20, 100).default(20),
    type: boundedText(50).nullable().default(null),
  })
  .strip();

const paystackVerifyQuerySchema = z
  .object({ reference: boundedText(200) })
  .strip();

const stripeVerifySchema = z.object({ sessionId: boundedText(200) }).strip();

export const parseCoinPurchase = (input: unknown): CoinPurchase =>
  Object.freeze(parseWithScope(coinPurchaseSchema, input, 'coin purchase'));

export const parseCoinHistoryQuery = (input: unknown): CoinHistoryQuery =>
  Object.freeze(parseWithScope(coinHistoryQuerySchema, input, 'coin history'));

export const parsePaystackVerifyQuery = (input: unknown): PaystackVerifyQuery =>
  Object.freeze(
    parseWithScope(paystackVerifyQuerySchema, input, 'payment verification'),
  );

export const parseStripeVerifyRequest = (input: unknown): StripeVerifyRequest =>
  Object.freeze(
    parseWithScope(stripeVerifySchema, input, 'payment verification'),
  );
