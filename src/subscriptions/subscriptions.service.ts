import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import { PrismaService } from '../database/prisma/prisma.service';
import { PaystackPort } from '../providers/paystack/paystack.port';
import { StripePort } from '../providers/stripe/stripe.port';
import {
  parseAdminSubscriberQuery,
  parseSubscriptionInitialize,
  parseSubscriptionVerifyQuery,
  type SubscriberPage,
  type SubscriptionPaymentMethod,
  type SubscriptionPlanView,
  type SubscriptionStats,
  type SubscriptionStatusView,
} from './subscription.contract';
import {
  createSubscriptionPrismaClient,
  type PlanRecord,
  type SubscriptionPrismaClient,
} from './subscription-prisma.client';

export interface SubscriptionInitialization {
  readonly success: true;
  readonly authorizationUrl?: string;
  readonly accessCode?: string;
  readonly reference?: string;
  readonly clientSecret?: string | null;
  readonly paymentIntentId?: string;
}

export interface SubscriptionVerification {
  readonly success: boolean;
  readonly message: string;
  readonly alreadyProcessed?: boolean;
  readonly transactionId?: string;
  readonly verifiedAt?: string;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackPort,
    private readonly stripe: StripePort,
  ) {}

  private get subscriptions(): SubscriptionPrismaClient {
    return createSubscriptionPrismaClient(this.prisma.db);
  }

  async initialize(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<{
    readonly success: true;
    readonly data: SubscriptionInitialization;
  }> {
    const input = parseSubscriptionInitialize(body);
    const client = this.subscriptions;

    const user = await client.findUser(principal.userId);
    if (user === null) {
      throw new DomainError('VALIDATION_FAILED', 'User not found');
    }
    if (user.email === null || user.email === '') {
      throw new DomainError(
        'VALIDATION_FAILED',
        'User email is required for payment processing',
      );
    }

    const plan = await client.findPlan(input.planId);
    if (plan === null) {
      throw new DomainError('VALIDATION_FAILED', 'Subscription plan not found');
    }
    if (!plan.isActive) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'This subscription plan is currently inactive',
      );
    }
    if (
      user.subscriptionPlanId === plan.id &&
      user.subscriptionStatus === 'active' &&
      user.subscriptionExpiry !== null &&
      user.subscriptionExpiry.getTime() > Date.now()
    ) {
      throw new DomainError(
        'CONFLICT',
        'You are already subscribed to this plan',
      );
    }

    const reference = `SUB-${String(Date.now())}-${principal.userId.slice(0, 6)}`;
    const transaction = await client.createTransaction({
      userId: principal.userId,
      planId: plan.id,
      amount: plan.price,
      currency: plan.currency,
      paymentMethod: input.paymentMethod,
      paymentReference: reference,
    });

    try {
      const data =
        input.paymentMethod === 'paystack'
          ? await this.initializePaystack(user.email, plan, reference, {
              userId: principal.userId,
              planId: plan.id,
              transactionId: transaction.id,
            })
          : await this.initializeStripe(plan, transaction.id, {
              userId: principal.userId,
              planId: plan.id,
              transactionId: transaction.id,
            });
      return Object.freeze({ success: true as const, data });
    } catch (error: unknown) {
      await client.failTransaction(
        transaction.id,
        error instanceof Error ? error.message : 'Initialization failed',
      );
      throw error;
    }
  }

  private async initializePaystack(
    email: string,
    plan: PlanRecord,
    reference: string,
    metadata: Readonly<Record<string, string>>,
  ): Promise<SubscriptionInitialization> {
    const initialization = await this.paystack.initialize({
      email,
      // Preserved exactly: the plan price scaled by 100.
      amountMinor: plan.price * 100,
      reference,
      metadata: { ...metadata, type: 'subscription' },
      callbackUrl: `${frontendUrl()}/subscription/callback`,
    });
    return Object.freeze({
      success: true as const,
      authorizationUrl: initialization.authorizationUrl,
      accessCode: initialization.accessCode,
      reference: initialization.reference,
    });
  }

  /**
   * Legacy never stored the PaymentIntent id, then verified by calling
   * `paymentIntents.retrieve` with the `SUB-…` reference, which Stripe cannot
   * resolve. Stripe subscription verification therefore failed every time. The
   * provider's own reference is now recorded against the transaction.
   */
  private async initializeStripe(
    plan: PlanRecord,
    transactionId: string,
    metadata: Readonly<Record<string, string>>,
  ): Promise<SubscriptionInitialization> {
    const intent = await this.stripe.createPaymentIntent({
      amountMinor: Math.round(plan.price * 100),
      currency: plan.currency.toLowerCase(),
      description: `Subscription to ${plan.name}`,
      metadata: { ...metadata, type: 'subscription' },
    });
    await this.subscriptions.attachProviderReference(transactionId, intent.id);
    return Object.freeze({
      success: true as const,
      clientSecret: intent.clientSecret,
      paymentIntentId: intent.id,
    });
  }

  /** Public: the provider redirects the payer here with no session. */
  async verify(query: unknown): Promise<{
    readonly success: true;
    readonly data: SubscriptionVerification;
  }> {
    const input = parseSubscriptionVerifyQuery(query);
    const client = this.subscriptions;

    const transaction = await client.findTransactionByReference(
      input.reference,
    );
    if (transaction === null) {
      throw new DomainError('NOT_FOUND', 'Transaction not found');
    }

    if (transaction.status === 'completed') {
      return Object.freeze({
        success: true as const,
        data: Object.freeze({
          success: true,
          message: 'Payment already verified',
          alreadyProcessed: true,
          transactionId: transaction.id,
          verifiedAt: transaction.updatedAt.toISOString(),
        }),
      });
    }

    const settled = await this.settledWithProvider(
      input.paymentMethod,
      input.reference,
      transaction.metadata,
    );
    if (!settled.success) {
      return Object.freeze({ success: true as const, data: settled });
    }

    await this.completeTransaction(transaction.id);
    return Object.freeze({ success: true as const, data: settled });
  }

  private async settledWithProvider(
    method: SubscriptionPaymentMethod,
    reference: string,
    metadata: unknown,
  ): Promise<SubscriptionVerification> {
    if (method === 'paystack') {
      const result = await this.paystack.verify(reference);
      return result.status === 'success'
        ? Object.freeze({
            success: true,
            message: 'Payment verified successfully',
          })
        : Object.freeze({
            success: false,
            message: 'Payment verification failed',
          });
    }

    // Stripe is asked about its own reference, not ours.
    const providerReference = readProviderReference(metadata) ?? reference;
    const intent = await this.stripe.retrievePaymentIntent(providerReference);
    return intent.status === 'succeeded'
      ? Object.freeze({
          success: true,
          message: 'Payment verified successfully',
        })
      : Object.freeze({
          success: false,
          message: `Payment status: ${intent.status}`,
        });
  }

  /**
   * Shared by the verification route and both webhooks. The claim and the
   * subscription change happen together, so a webhook and a verification
   * racing each other extend the subscription exactly once.
   */
  async completeTransaction(
    transactionId: string,
  ): Promise<{ readonly success: true; readonly message?: string }> {
    return this.subscriptions.runSerializable(async (transaction) => {
      const record = await transaction.findTransaction(transactionId);
      if (record === null) {
        throw new DomainError('NOT_FOUND', 'Transaction not found');
      }
      if (record.planId === null) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'That transaction is not a subscription payment.',
        );
      }

      const claimed = await transaction.claimTransaction(record.id);
      if (!claimed) {
        return Object.freeze({
          success: true as const,
          message: 'Transaction already processed',
        });
      }

      const plan = await transaction.findPlan(record.planId);
      if (plan === null) {
        throw new DomainError('NOT_FOUND', 'Subscription plan not found');
      }

      await transaction.activateSubscription(
        record.userId,
        plan.id,
        expiryFor(plan.duration),
      );
      return Object.freeze({ success: true as const });
    });
  }

  async status(principal: AuthenticatedPrincipal): Promise<{
    readonly success: true;
    readonly data: SubscriptionStatusView | null;
  }> {
    const user = await this.subscriptions.findUser(principal.userId);
    if (user === null) {
      return Object.freeze({ success: true as const, data: null });
    }
    return Object.freeze({
      success: true as const,
      data: Object.freeze({
        subscriptionStatus: user.subscriptionStatus,
        subscriptionExpiry:
          user.subscriptionExpiry === null
            ? null
            : user.subscriptionExpiry.toISOString(),
        subscriptionPlanId: user.subscriptionPlanId,
        subscriptionPlan:
          user.subscriptionPlan === null
            ? null
            : projectPlan(user.subscriptionPlan),
        goldenTick: user.goldenTick,
      }),
    });
  }

  async listSubscribers(query: unknown): Promise<SubscriberPage> {
    const { page, limit, status } = parseAdminSubscriberQuery(query);
    const client = this.subscriptions;
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      client.listSubscribers(status, skip, limit),
      client.countSubscribers(status),
    ]);

    return Object.freeze({
      subscribers: Object.freeze(
        rows.map((row) =>
          Object.freeze({
            id: row.id,
            username: row.username,
            email: row.email ?? '',
            subscriptionStatus: row.subscriptionStatus,
            subscriptionExpiry:
              row.subscriptionExpiry === null
                ? null
                : row.subscriptionExpiry.toISOString(),
            subscriptionPlan: row.subscriptionPlan,
          }),
        ),
      ),
      pagination: Object.freeze({
        total,
        page,
        pages: Math.ceil(total / limit),
      }),
    });
  }

  async stats(): Promise<SubscriptionStats> {
    const client = this.subscriptions;
    const [counts, plans] = await Promise.all([
      client.countActiveByPlan(),
      client.listPlans(),
    ]);
    const byId = new Map(plans.map((plan) => [plan.id, plan]));

    const byPlan = counts.map((entry) => {
      const plan = entry.planId === null ? undefined : byId.get(entry.planId);
      const price = plan?.price ?? 0;
      return Object.freeze({
        planId: entry.planId,
        planName: plan?.name ?? 'Unknown',
        count: entry.count,
        estimatedRevenue: price * entry.count,
      });
    });

    return Object.freeze({
      byPlan: Object.freeze(byPlan),
      totalSubscribers: byPlan.reduce((sum, entry) => sum + entry.count, 0),
      totalMonthlyRevenue: byPlan.reduce(
        (sum, entry) => sum + entry.estimatedRevenue,
        0,
      ),
    });
  }
}

/**
 * Preserved exactly: the new term runs from now, so renewing early forfeits
 * whatever was left. Extending instead would change billing outcomes, which is
 * a business decision rather than a migration one.
 */
const expiryFor = (duration: string): Date => {
  const expiry = new Date();
  if (duration === 'yearly') {
    expiry.setFullYear(expiry.getFullYear() + 1);
  } else {
    expiry.setMonth(expiry.getMonth() + 1);
  }
  return expiry;
};

const projectPlan = (plan: PlanRecord): SubscriptionPlanView =>
  Object.freeze({
    id: plan.id,
    name: plan.name,
    price: plan.price,
    currency: plan.currency,
    duration: plan.duration,
    features: plan.features,
    limits: plan.limits,
    targetAudience: plan.targetAudience,
    isActive: plan.isActive,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  });

function readProviderReference(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const reference: unknown = Reflect.get(metadata, 'providerReference');
  return typeof reference === 'string' ? reference : null;
}

const frontendUrl = (): string => process.env.FRONTEND_URL ?? '';
