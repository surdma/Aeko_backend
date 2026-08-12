import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import { isJsonObject, type JsonValue } from '../common/json/json-value';
import { PrismaService } from '../database/prisma/prisma.service';
import { CommunityPaymentPort } from '../providers/community-payment/community-payment.port';
import { PaystackPort } from '../providers/paystack/paystack.port';
import { StripePort } from '../providers/stripe/stripe.port';
import {
  parseCommunityPaymentInitialize,
  parseCommunityPaymentVerifyQuery,
  parseTransactionQuery,
  parseWithdrawalRequest,
  type CommunityPaymentMethod,
  type CommunityTransactionPage,
  type CommunityTransactionView,
  type WithdrawalRecord,
} from './community-payment.contract';
import {
  createCommunityTransactionPrismaClient,
  type CommunitySnapshot,
  type CommunityTransactionPrismaClient,
  type TransactionRecord,
} from './community-transaction-prisma.client';

export interface CommunityPaymentInitialization {
  readonly success: true;
  readonly authorizationUrl?: string;
  readonly accessCode?: string;
  readonly reference?: string;
  readonly clientSecret?: string | null;
  readonly paymentIntentId?: string;
}

export interface CommunityPaymentVerification {
  readonly success: boolean;
  readonly message: string;
  readonly alreadyProcessed?: boolean;
  readonly transactionId?: string;
}

export interface WithdrawalResult {
  readonly success: true;
  readonly message: string;
  readonly withdrawal: WithdrawalRecord;
  readonly availableBalance: number;
}

@Injectable()
export class CommunityPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackPort,
    private readonly stripe: StripePort,
    private readonly settlement: CommunityPaymentPort,
  ) {}

  private get transactions(): CommunityTransactionPrismaClient {
    return createCommunityTransactionPrismaClient(this.prisma.db);
  }

  async initialize(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<CommunityPaymentInitialization> {
    const input = parseCommunityPaymentInitialize(body);
    const client = this.transactions;

    const email = await client.findUserEmail(principal.userId);
    if (email === null) {
      throw new DomainError('VALIDATION_FAILED', 'User not found');
    }
    if (email === '') {
      throw new DomainError(
        'VALIDATION_FAILED',
        'User email is required for payment processing',
      );
    }

    const community = await client.findCommunity(input.communityId);
    if (community === null) {
      throw new DomainError('NOT_FOUND', 'Community not found');
    }

    const payment = paymentSettings(community.settings);
    if (payment.isPaidCommunity !== true) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'This community is not a paid community',
      );
    }

    assertMethodAvailable(payment, input.paymentMethod);
    assertAlreadySubscribed(community.members, principal.userId);

    const amount = readNumber(payment.price);
    const currency = readString(payment.currency) ?? 'USD';
    const reference = `COMM-${String(Date.now())}-${principal.userId.slice(0, 6)}`;

    const transaction = await client.create({
      userId: principal.userId,
      communityId: community.id,
      amount,
      currency,
      paymentMethod: input.paymentMethod,
      paymentReference: reference,
    });

    try {
      if (input.paymentMethod === 'paystack') {
        const initialization = await this.paystack.initialize({
          email,
          // Preserved exactly: the configured price scaled by 100.
          amountMinor: amount * 100,
          reference,
          metadata: {
            userId: principal.userId,
            communityId: community.id,
            transactionId: transaction.id,
          },
          callbackUrl: `${frontendUrl()}/payment/callback`,
        });
        return Object.freeze({
          success: true as const,
          authorizationUrl: initialization.authorizationUrl,
          accessCode: initialization.accessCode,
          reference: initialization.reference,
        });
      }

      const intent = await this.stripe.createPaymentIntent({
        amountMinor: Math.round(amount * 100),
        currency: currency.toLowerCase(),
        description: `Membership for ${community.name}`,
        metadata: {
          userId: principal.userId,
          communityId: community.id,
          transactionId: transaction.id,
        },
      });
      // Legacy stored nothing, so verification later asked Stripe to resolve
      // the COMM- prefixed reference, which is not a PaymentIntent id.
      await client.attachProviderReference(transaction.id, intent.id);
      return Object.freeze({
        success: true as const,
        clientSecret: intent.clientSecret,
        paymentIntentId: intent.id,
      });
    } catch (error: unknown) {
      await client.fail(
        transaction.id,
        error instanceof Error ? error.message : 'Initialization failed',
      );
      throw error;
    }
  }

  /** Public: the provider redirects the payer here with no session. */
  async verify(query: unknown): Promise<CommunityPaymentVerification> {
    const input = parseCommunityPaymentVerifyQuery(query);
    const client = this.transactions;

    const transaction = await client.findByReference(input.reference);
    if (transaction === null) {
      throw new DomainError('NOT_FOUND', 'Transaction not found');
    }

    if (transaction.status === 'completed') {
      return Object.freeze({
        success: true,
        message: 'Payment already verified',
        alreadyProcessed: true,
        transactionId: transaction.id,
      });
    }

    const settled = await this.settledWithProvider(
      input.paymentMethod,
      input.reference,
      transaction.metadata,
    );
    if (!settled) {
      return Object.freeze({
        success: false,
        message: 'Payment verification failed',
      });
    }

    // The settlement adapter is idempotent and grants the membership.
    await this.settlement.settle(transaction.id);
    return Object.freeze({
      success: true,
      message: 'Payment verified successfully',
      transactionId: transaction.id,
    });
  }

  private async settledWithProvider(
    method: CommunityPaymentMethod,
    reference: string,
    metadata: JsonValue,
  ): Promise<boolean> {
    if (method === 'paystack') {
      const result = await this.paystack.verify(reference);
      return result.status === 'success';
    }
    const providerReference = readProviderReference(metadata) ?? reference;
    const intent = await this.stripe.retrievePaymentIntent(providerReference);
    return intent.status === 'succeeded';
  }

  /**
   * Owner only. The balance is read and the reservation written inside one
   * serializable transaction, so two withdrawals racing each other cannot both
   * pass a check against the same available balance.
   */
  async withdraw(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<WithdrawalResult> {
    const input = parseWithdrawalRequest(body);

    return this.transactions.runSerializable(async (transaction) => {
      const community = await transaction.findCommunity(input.communityId);
      if (community === null) {
        throw new DomainError('NOT_FOUND', 'Community not found');
      }
      if (community.ownerId !== principal.userId) {
        throw new DomainError(
          'AUTHORIZATION_DENIED',
          'Only community owner can request withdrawal',
        );
      }

      const settings = isJsonObject(community.settings)
        ? community.settings
        : {};
      const payment = paymentSettings(community.settings);
      const totalEarnings = readNumber(payment.totalEarnings);
      const pendingWithdrawals = readNumber(payment.pendingWithdrawals);
      const availableBalance = totalEarnings - pendingWithdrawals;

      if (input.amount > availableBalance) {
        throw new DomainError(
          'VALIDATION_FAILED',
          `Insufficient balance for withdrawal. Available: ${String(availableBalance)}, Requested: ${String(input.amount)}, Pending: ${String(pendingWithdrawals)}`,
        );
      }

      const withdrawal: WithdrawalRecord = Object.freeze({
        amount: input.amount,
        status: 'pending',
        method: input.method,
        reference: `WDR-${String(Date.now())}-${community.id.slice(0, 6)}`,
        metadata: { ...input.details },
        processedAt: new Date().toISOString(),
      });

      const history = readArray(payment.withdrawalHistory);
      await transaction.saveSettings(community.id, {
        ...settings,
        payment: {
          ...payment,
          pendingWithdrawals: pendingWithdrawals + input.amount,
          withdrawalHistory: [...history, withdrawal],
        },
      });

      return Object.freeze({
        success: true as const,
        message: 'Withdrawal request processed',
        withdrawal,
        availableBalance: totalEarnings - (pendingWithdrawals + input.amount),
      });
    });
  }

  /** Owner only, as legacy had it. */
  async listTransactions(
    principal: AuthenticatedPrincipal,
    communityId: string,
    query: unknown,
  ): Promise<CommunityTransactionPage> {
    const { page, limit, status, startDate, endDate } =
      parseTransactionQuery(query);
    const client = this.transactions;

    const community = await client.findCommunity(communityId);
    if (community === null) {
      throw new DomainError('NOT_FOUND', 'Community not found');
    }
    if (community.ownerId !== principal.userId) {
      throw new DomainError(
        'AUTHORIZATION_DENIED',
        'Only community owner can view transactions',
      );
    }

    const filter = { communityId, status, startDate, endDate };
    const skip = (page - 1) * limit;
    const [records, total, statistics] = await Promise.all([
      client.list(filter, skip, limit),
      client.count(filter),
      client.summarise(filter),
    ]);

    return Object.freeze({
      transactions: Object.freeze(records.map(project)),
      pagination: Object.freeze({
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      }),
      statistics,
    });
  }
}

function assertMethodAvailable(
  payment: Readonly<Record<string, JsonValue>>,
  method: CommunityPaymentMethod,
): void {
  const available = readArray(payment.paymentMethods).filter(
    (entry): entry is string => typeof entry === 'string',
  );
  if (!available.includes(method)) {
    throw new DomainError(
      'VALIDATION_FAILED',
      `Payment method '${method}' is not available for this community. Available methods: ${available.length === 0 ? 'none configured' : available.join(', ')}`,
    );
  }

  if (method === 'stripe' && readString(payment.stripeAccountId) === null) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'Stripe payment method is not properly configured for this community. Missing Stripe account ID.',
    );
  }
  if (
    method === 'paystack' &&
    readString(payment.paystackSubaccount) === null
  ) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'Paystack payment method is not properly configured for this community. Missing Paystack subaccount.',
    );
  }
}

/**
 * The active-subscription check reads the JSON members array because that is
 * where the subscription term lives; the relational `CommunityMember` row has
 * no such column. Both are written at settlement.
 */
function assertAlreadySubscribed(members: JsonValue, userId: string): void {
  for (const entry of readArray(members)) {
    if (!isJsonObject(entry) || entry.user !== userId) continue;
    if (entry.status !== 'active') continue;
    const subscription = entry.subscription;
    if (!isJsonObject(subscription) || subscription.isActive !== true) continue;
    const endDate = readString(subscription.endDate);
    if (endDate === null || new Date(endDate).getTime() > Date.now()) {
      throw new DomainError(
        'CONFLICT',
        'You already have an active subscription to this community',
      );
    }
  }
}

const paymentSettings = (
  settings: JsonValue,
): Readonly<Record<string, JsonValue>> => {
  if (!isJsonObject(settings)) return {};
  const payment = settings.payment;
  return isJsonObject(payment) ? payment : {};
};

function readArray(value: JsonValue | undefined): readonly JsonValue[] {
  const entries: readonly JsonValue[] = Array.isArray(value) ? value : [];
  return entries;
}

function readNumber(value: JsonValue | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function readProviderReference(metadata: JsonValue): string | null {
  if (!isJsonObject(metadata)) return null;
  return readString(metadata.providerReference);
}

const project = (record: TransactionRecord): CommunityTransactionView =>
  Object.freeze({
    id: record.id,
    userId: record.userId,
    communityId: record.communityId,
    amount: record.amount,
    currency: record.currency,
    paymentMethod: record.paymentMethod,
    paymentReference: record.paymentReference,
    status: record.status,
    verifiedAt:
      record.verifiedAt === null ? null : record.verifiedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  });

const frontendUrl = (): string => process.env.FRONTEND_URL ?? '';

export type { CommunitySnapshot };
