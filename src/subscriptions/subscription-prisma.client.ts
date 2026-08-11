import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { DomainError } from '../common/errors/domain.error';
import { toJsonValue, type JsonValue } from '../common/json/json-value';

export interface TransactionRecord {
  readonly id: string;
  readonly userId: string;
  readonly planId: string | null;
  readonly communityId: string | null;
  readonly amount: number;
  readonly currency: string;
  readonly paymentMethod: string;
  readonly paymentReference: string;
  readonly status: string;
  readonly metadata: JsonValue;
  readonly failureReason: string | null;
  readonly retryCount: number;
  readonly verifiedAt: Date | null;
  readonly updatedAt: Date;
}

export interface PlanRecord {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly currency: string;
  readonly duration: string;
  readonly features: JsonValue;
  readonly limits: JsonValue;
  readonly targetAudience: string | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UserSubscriptionRecord {
  readonly id: string;
  readonly email: string | null;
  readonly subscriptionPlanId: string | null;
  readonly subscriptionStatus: string;
  readonly subscriptionExpiry: Date | null;
  readonly goldenTick: boolean;
  readonly subscriptionPlan: PlanRecord | null;
}

export interface SubscriberRecord {
  readonly id: string;
  readonly username: string;
  readonly email: string | null;
  readonly subscriptionStatus: string;
  readonly subscriptionExpiry: Date | null;
  readonly subscriptionPlan: Readonly<{ name: string; price: number }> | null;
}

export interface PlanCount {
  readonly planId: string | null;
  readonly count: number;
}

export interface SubscriptionTransactionClient {
  findTransaction(id: string): Promise<TransactionRecord | null>;
  findPlan(id: string): Promise<PlanRecord | null>;
  /**
   * Moves a not-yet-completed transaction to `completed` and answers whether
   * this call is the one that moved it. The conditional update is the
   * idempotency gate: legacy read the status outside the transaction that
   * wrote it, so a webhook and a verification racing each other both proceeded.
   *
   * The gate is `not completed` rather than `pending` on purpose. Initialising
   * marks a transaction `failed` whenever the provider call throws, but the
   * payer may still go on to pay — a Paystack page that opened before the
   * error, a response we failed to read. Gating on `pending` would take the
   * money and grant nothing, which is exactly the case legacy got right by
   * short-circuiting only on `completed`.
   */
  claimTransaction(id: string): Promise<boolean>;
  activateSubscription(
    userId: string,
    planId: string,
    expiry: Date,
  ): Promise<void>;
}

export const SERIALIZABLE_ATTEMPTS = 3;

export interface SubscriptionPrismaClient {
  findUser(userId: string): Promise<UserSubscriptionRecord | null>;
  findPlan(planId: string): Promise<PlanRecord | null>;
  findTransactionByReference(
    reference: string,
  ): Promise<TransactionRecord | null>;
  createTransaction(data: {
    readonly userId: string;
    readonly planId: string;
    readonly amount: number;
    readonly currency: string;
    readonly paymentMethod: string;
    readonly paymentReference: string;
  }): Promise<TransactionRecord>;
  /** Records the provider's own reference so verification can find it later. */
  attachProviderReference(id: string, reference: string): Promise<void>;
  failTransaction(id: string, reason: string): Promise<void>;
  listSubscribers(
    status: string | null,
    skip: number,
    take: number,
  ): Promise<readonly SubscriberRecord[]>;
  countSubscribers(status: string | null): Promise<number>;
  countActiveByPlan(): Promise<readonly PlanCount[]>;
  listPlans(): Promise<readonly PlanRecord[]>;
  runSerializable<T>(
    operation: (transaction: SubscriptionTransactionClient) => Promise<T>,
  ): Promise<T>;
}

const WRITE_CONFLICT_CODE = 'P2034';

const isWriteConflict = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  Reflect.get(error, 'code') === WRITE_CONFLICT_CODE;

const planSelect = {
  id: true,
  name: true,
  price: true,
  currency: true,
  duration: true,
  features: true,
  limits: true,
  targetAudience: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SubscriptionPlanSelect;

type PlanRow = Prisma.SubscriptionPlanGetPayload<{ select: typeof planSelect }>;
type TransactionRow = Prisma.TransactionGetPayload<object>;

const toPlan = (row: PlanRow): PlanRecord =>
  Object.freeze({
    id: row.id,
    name: row.name,
    price: row.price,
    currency: row.currency,
    duration: row.duration,
    features: toJsonValue(row.features),
    limits: toJsonValue(row.limits),
    targetAudience: row.targetAudience,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

const toTransaction = (row: TransactionRow): TransactionRecord =>
  Object.freeze({
    id: row.id,
    userId: row.userId,
    planId: row.planId,
    communityId: row.communityId,
    amount: row.amount,
    currency: row.currency,
    paymentMethod: row.paymentMethod,
    paymentReference: row.paymentReference,
    status: row.status,
    metadata: toJsonValue(row.metadata),
    failureReason: row.failureReason,
    retryCount: row.retryCount,
    verifiedAt: row.verifiedAt,
    updatedAt: row.updatedAt,
  });

/** Legacy showed every subscriber who is not `inactive` when unfiltered. */
const subscriberWhere = (status: string | null): Prisma.UserWhereInput =>
  status === null
    ? { subscriptionStatus: { not: 'inactive' } }
    : { subscriptionStatus: status };

const transactionOps = (
  transaction: Prisma.TransactionClient,
): SubscriptionTransactionClient => ({
  async findTransaction(id) {
    const row = await transaction.transaction.findUnique({ where: { id } });
    return row === null ? null : toTransaction(row);
  },

  async findPlan(id) {
    const row = await transaction.subscriptionPlan.findUnique({
      where: { id },
      select: planSelect,
    });
    return row === null ? null : toPlan(row);
  },

  async claimTransaction(id) {
    const claimed = await transaction.transaction.updateMany({
      where: { id, status: { not: 'completed' } },
      data: { status: 'completed', verifiedAt: new Date() },
    });
    return claimed.count === 1;
  },

  async activateSubscription(userId, planId, expiry) {
    await transaction.user.update({
      where: { id: userId },
      data: {
        subscriptionPlanId: planId,
        subscriptionStatus: 'active',
        subscriptionExpiry: expiry,
        // Legacy granted the golden tick with every paid plan.
        goldenTick: true,
      },
    });
  },
});

export const createSubscriptionPrismaClient = (
  db: PrismaClient,
): SubscriptionPrismaClient => ({
  async findUser(userId) {
    const row = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        subscriptionPlanId: true,
        subscriptionStatus: true,
        subscriptionExpiry: true,
        goldenTick: true,
        subscriptionPlan: { select: planSelect },
      },
    });
    if (row === null) return null;
    return Object.freeze({
      id: row.id,
      email: row.email,
      subscriptionPlanId: row.subscriptionPlanId,
      subscriptionStatus: row.subscriptionStatus,
      subscriptionExpiry: row.subscriptionExpiry,
      goldenTick: row.goldenTick,
      subscriptionPlan:
        row.subscriptionPlan === null ? null : toPlan(row.subscriptionPlan),
    });
  },

  async findPlan(planId) {
    const row = await db.subscriptionPlan.findUnique({
      where: { id: planId },
      select: planSelect,
    });
    return row === null ? null : toPlan(row);
  },

  async findTransactionByReference(reference) {
    const row = await db.transaction.findFirst({
      where: { paymentReference: reference },
    });
    return row === null ? null : toTransaction(row);
  },

  async createTransaction(data) {
    const row = await db.transaction.create({
      data: {
        userId: data.userId,
        planId: data.planId,
        amount: data.amount,
        currency: data.currency,
        paymentMethod: data.paymentMethod,
        paymentReference: data.paymentReference,
        status: 'pending',
      },
    });
    return toTransaction(row);
  },

  async attachProviderReference(id, reference) {
    await db.transaction.update({
      where: { id },
      data: { metadata: { providerReference: reference } },
    });
  },

  async failTransaction(id, reason) {
    await db.transaction.update({
      where: { id },
      data: { status: 'failed', failureReason: reason },
    });
  },

  async listSubscribers(status, skip, take) {
    const rows = await db.user.findMany({
      where: subscriberWhere(status),
      select: {
        id: true,
        username: true,
        email: true,
        subscriptionStatus: true,
        subscriptionExpiry: true,
        subscriptionPlan: { select: { name: true, price: true } },
      },
      skip,
      take,
      orderBy: { subscriptionExpiry: 'desc' },
    });
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          id: row.id,
          username: row.username,
          email: row.email,
          subscriptionStatus: row.subscriptionStatus,
          subscriptionExpiry: row.subscriptionExpiry,
          subscriptionPlan:
            row.subscriptionPlan === null
              ? null
              : Object.freeze({
                  name: row.subscriptionPlan.name,
                  price: row.subscriptionPlan.price,
                }),
        }),
      ),
    );
  },

  async countSubscribers(status) {
    return db.user.count({ where: subscriberWhere(status) });
  },

  async countActiveByPlan() {
    const rows = await db.user.groupBy({
      by: ['subscriptionPlanId'],
      where: { subscriptionStatus: 'active' },
      _count: { _all: true },
    });
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          planId: row.subscriptionPlanId,
          count: row._count._all,
        }),
      ),
    );
  },

  async listPlans() {
    const rows = await db.subscriptionPlan.findMany({ select: planSelect });
    return Object.freeze(rows.map(toPlan));
  },

  async runSerializable<T>(
    operation: (transaction: SubscriptionTransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await db.$transaction(
          async (transaction) => operation(transactionOps(transaction)),
          { isolationLevel: 'Serializable' },
        );
      } catch (error: unknown) {
        if (!isWriteConflict(error)) throw error;
      }
    }
    throw new DomainError(
      'CONFLICT',
      'That payment is still being processed. Please try again.',
    );
  },
});
