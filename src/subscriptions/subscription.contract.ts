import { z } from 'zod';

import type { JsonValue } from '../common/json/json-value';
import {
  boundedText,
  parseWithScope,
  queryInteger,
} from '../common/validation/parse';

export type SubscriptionPaymentMethod = 'paystack' | 'stripe';

export interface SubscriptionInitialize {
  readonly planId: string;
  readonly paymentMethod: SubscriptionPaymentMethod;
}

export interface SubscriptionVerifyQuery {
  readonly reference: string;
  readonly paymentMethod: SubscriptionPaymentMethod;
}

export interface AdminSubscriberQuery {
  readonly page: number;
  readonly limit: number;
  readonly status: string | null;
}

export interface SubscriptionStatusView {
  readonly subscriptionStatus: string;
  readonly subscriptionExpiry: string | null;
  readonly subscriptionPlanId: string | null;
  readonly subscriptionPlan: SubscriptionPlanView | null;
  /**
   * Legacy also selected `prideTick` and `businessTick`, neither of which is a
   * column on User. Prisma rejected the query, so the route answered 500 on
   * every call and no client ever saw a response to depend on.
   */
  readonly goldenTick: boolean;
}

export interface SubscriptionPlanView {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly currency: string;
  readonly duration: string;
  readonly features: JsonValue;
  readonly limits: JsonValue;
  readonly targetAudience: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SubscriberView {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly subscriptionStatus: string;
  readonly subscriptionExpiry: string | null;
  readonly subscriptionPlan: Readonly<{
    name: string;
    price: number;
  }> | null;
}

export interface SubscriberPage {
  readonly subscribers: readonly SubscriberView[];
  readonly pagination: Readonly<{
    total: number;
    page: number;
    pages: number;
  }>;
}

export interface PlanStat {
  readonly planId: string | null;
  readonly planName: string;
  readonly count: number;
  readonly estimatedRevenue: number;
}

export interface SubscriptionStats {
  readonly byPlan: readonly PlanStat[];
  readonly totalSubscribers: number;
  readonly totalMonthlyRevenue: number;
}

/**
 * Legacy read `paymentMethod` straight from the body and only rejected it deep
 * inside the service's switch. Rejecting it here produces the same failure with
 * a clearer message.
 */
const initializeSchema = z
  .object({
    planId: boundedText(200),
    paymentMethod: z.enum(['paystack', 'stripe']),
  })
  .strip();

const verifyQuerySchema = z
  .object({
    reference: boundedText(200),
    paymentMethod: z.enum(['paystack', 'stripe']),
  })
  .strip();

/**
 * Legacy defaulted to page 1, limit 10 and — when no status was supplied —
 * every subscriber whose status is not `inactive`. That default is preserved
 * in the service; only the page ceiling is new.
 */
const adminSubscriberQuerySchema = z
  .object({
    page: queryInteger(1, 1_000_000).default(1),
    limit: queryInteger(10, 100).default(10),
    status: boundedText(50).nullable().default(null),
  })
  .strip();

export const parseSubscriptionInitialize = (
  input: unknown,
): SubscriptionInitialize =>
  Object.freeze(parseWithScope(initializeSchema, input, 'subscription'));

export const parseSubscriptionVerifyQuery = (
  input: unknown,
): SubscriptionVerifyQuery =>
  Object.freeze(
    parseWithScope(verifyQuerySchema, input, 'payment verification'),
  );

export const parseAdminSubscriberQuery = (
  input: unknown,
): AdminSubscriberQuery =>
  Object.freeze(
    parseWithScope(adminSubscriberQuerySchema, input, 'subscriber query'),
  );
