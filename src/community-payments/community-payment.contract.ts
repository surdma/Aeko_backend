import { z } from 'zod';

import type { JsonValue } from '../common/json/json-value';
import {
  boundedText,
  parseWithScope,
  queryInteger,
} from '../common/validation/parse';

export const PAYMENT_METHODS = ['paystack', 'stripe'] as const;
export const WITHDRAWAL_METHODS = ['bank'] as const;
export const SUBSCRIPTION_TYPES = ['one_time', 'monthly', 'yearly'] as const;
export const CURRENCIES = ['NGN', 'USD', 'EUR', 'GBP'] as const;

/** Legacy bounded every money amount to this range. */
export const MIN_AMOUNT = 0.01;
export const MAX_AMOUNT = 1_000_000;

export type CommunityPaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface CommunityPaymentInitialize {
  readonly communityId: string;
  readonly paymentMethod: CommunityPaymentMethod;
}

export interface CommunityPaymentVerifyQuery {
  readonly reference: string;
  readonly paymentMethod: CommunityPaymentMethod;
}

export interface BankWithdrawalDetails {
  readonly accountNumber: string;
  readonly bankCode: string;
  readonly accountName: string;
}

export interface WithdrawalRequest {
  readonly communityId: string;
  readonly amount: number;
  readonly method: 'bank';
  readonly details: BankWithdrawalDetails;
}

export interface TransactionQuery {
  readonly page: number;
  readonly limit: number;
  readonly status: string | null;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
}

export interface CommunityTransactionView {
  readonly id: string;
  readonly userId: string;
  readonly communityId: string | null;
  readonly amount: number;
  readonly currency: string;
  readonly paymentMethod: string;
  readonly paymentReference: string;
  readonly status: string;
  readonly verifiedAt: string | null;
  readonly createdAt: string;
}

export interface CommunityTransactionPage {
  readonly transactions: readonly CommunityTransactionView[];
  readonly pagination: Readonly<{
    total: number;
    page: number;
    pages: number;
    limit: number;
  }>;
  readonly statistics: Readonly<{
    totalAmount: number;
    completedCount: number;
  }>;
}

export interface WithdrawalRecord {
  readonly [key: string]: JsonValue;
  readonly amount: number;
  readonly status: string;
  readonly method: string;
  readonly reference: string;
  readonly processedAt: string;
}

/**
 * Legacy validated every community id with `isMongoId()`, but community ids are
 * UUIDs, so a 36-character id could never satisfy a 24-hex-character check and
 * all three community payment routes answered 400 for every real community.
 * The id is validated as the bounded string it actually is.
 */
const communityId = boundedText(64);

const money = z.number().finite().min(MIN_AMOUNT).max(MAX_AMOUNT);

const initializeSchema = z
  .object({
    communityId,
    paymentMethod: z.enum(PAYMENT_METHODS),
    // Legacy accepted an optional amount and then ignored it: the price always
    // comes from the community's own settings. It is still accepted, and still
    // ignored, so existing clients keep working.
    amount: money.optional(),
  })
  .strip()
  .transform(({ communityId: id, paymentMethod }) => ({
    communityId: id,
    paymentMethod,
  }));

const verifyQuerySchema = z
  .object({
    reference: boundedText(255),
    paymentMethod: z.enum(PAYMENT_METHODS),
  })
  .strip();

const bankDetailsSchema = z
  .object({
    accountNumber: z
      .string()
      .trim()
      .regex(/^\d{10}$/u, 'Account number must be 10 digits'),
    bankCode: z.string().trim().min(3).max(6),
    accountName: z.string().trim().min(2).max(100),
  })
  .strip();

const withdrawalSchema = z
  .object({
    communityId,
    amount: money,
    method: z.enum(WITHDRAWAL_METHODS),
    details: bankDetailsSchema,
  })
  .strip();

const isoDate = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: 'must be an ISO 8601 date',
  })
  .transform((value) => new Date(value));

const transactionQuerySchema = z
  .object({
    page: queryInteger(1, 1_000_000).default(1),
    limit: queryInteger(10, 100).default(10),
    status: z
      .enum(['pending', 'completed', 'failed', 'refunded'])
      .nullable()
      .default(null),
    startDate: isoDate.nullable().default(null),
    endDate: isoDate.nullable().default(null),
  })
  .strip();

export const parseCommunityPaymentInitialize = (
  input: unknown,
): CommunityPaymentInitialize =>
  Object.freeze(parseWithScope(initializeSchema, input, 'payment'));

export const parseCommunityPaymentVerifyQuery = (
  input: unknown,
): CommunityPaymentVerifyQuery =>
  Object.freeze(
    parseWithScope(verifyQuerySchema, input, 'payment verification'),
  );

export const parseWithdrawalRequest = (input: unknown): WithdrawalRequest =>
  Object.freeze(parseWithScope(withdrawalSchema, input, 'withdrawal'));

export const parseTransactionQuery = (input: unknown): TransactionQuery =>
  Object.freeze(
    parseWithScope(transactionQuerySchema, input, 'transaction query'),
  );
