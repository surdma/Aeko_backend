import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { toJsonValue, type JsonValue } from '../common/json/json-value';
import type {
  StoredJson,
  SubscriptionPlanCreate,
  SubscriptionPlanUpdate,
} from './subscription-plan.contract';

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

export interface SubscriptionPlanPrismaClient {
  list(): Promise<readonly PlanRecord[]>;
  create(data: SubscriptionPlanCreate): Promise<PlanRecord>;
  update(id: string, data: SubscriptionPlanUpdate): Promise<PlanRecord>;
}

type PlanRow = Prisma.SubscriptionPlanGetPayload<object>;

const toRecord = (row: PlanRow): PlanRecord =>
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

/** Top-level nulls are rejected by the contract, so no null token is needed. */
const jsonInput = (value: StoredJson): Prisma.InputJsonValue => value;

const asUpdate = (
  data: SubscriptionPlanUpdate,
): Prisma.SubscriptionPlanUpdateInput => ({
  ...(data.name === undefined ? {} : { name: data.name }),
  ...(data.price === undefined ? {} : { price: data.price }),
  ...(data.currency === undefined ? {} : { currency: data.currency }),
  ...(data.duration === undefined ? {} : { duration: data.duration }),
  ...(data.features === undefined
    ? {}
    : { features: jsonInput(data.features) }),
  ...(data.limits === undefined ? {} : { limits: jsonInput(data.limits) }),
  ...(data.targetAudience === undefined
    ? {}
    : { targetAudience: data.targetAudience }),
  ...(data.isActive === undefined ? {} : { isActive: data.isActive }),
});

export const createSubscriptionPlanPrismaClient = (
  db: PrismaClient,
): SubscriptionPlanPrismaClient => ({
  async list() {
    const rows = await db.subscriptionPlan.findMany({
      orderBy: { price: 'asc' },
    });
    return Object.freeze(rows.map(toRecord));
  },

  async create(data) {
    const row = await db.subscriptionPlan.create({
      data: {
        name: data.name,
        price: data.price,
        currency: data.currency,
        duration: data.duration,
        features: jsonInput(data.features),
        ...(data.limits === undefined
          ? {}
          : { limits: jsonInput(data.limits) }),
        targetAudience: data.targetAudience,
      },
    });
    return toRecord(row);
  },

  async update(id, data) {
    const row = await db.subscriptionPlan.update({
      where: { id },
      data: asUpdate(data),
    });
    return toRecord(row);
  },
});
