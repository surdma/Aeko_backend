import { Injectable } from '@nestjs/common';

import { DomainError } from '../common/errors/domain.error';
import { PrismaService } from '../database/prisma/prisma.service';
import type { SubscriptionPlanView } from '../subscriptions/subscription.contract';
import {
  parseSubscriptionPlanCreate,
  parseSubscriptionPlanUpdate,
} from './subscription-plan.contract';
import {
  createSubscriptionPlanPrismaClient,
  type PlanRecord,
  type SubscriptionPlanPrismaClient,
} from './subscription-plan-prisma.client';

const RECORD_NOT_FOUND = 'P2025';

const isMissingRecord = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  Reflect.get(error, 'code') === RECORD_NOT_FOUND;

@Injectable()
export class SubscriptionPlansService {
  constructor(private readonly prisma: PrismaService) {}

  private get plans(): SubscriptionPlanPrismaClient {
    return createSubscriptionPlanPrismaClient(this.prisma.db);
  }

  /** Public, as legacy had it: the plans are a price list. */
  async list(): Promise<{
    readonly success: true;
    readonly data: readonly SubscriptionPlanView[];
  }> {
    const records = await this.plans.list();
    return Object.freeze({
      success: true as const,
      data: Object.freeze(records.map(project)),
    });
  }

  async create(body: unknown): Promise<{
    readonly success: true;
    readonly data: SubscriptionPlanView;
  }> {
    const input = parseSubscriptionPlanCreate(body);
    const record = await this.plans.create(input);
    return Object.freeze({ success: true as const, data: project(record) });
  }

  async update(
    planId: string,
    body: unknown,
  ): Promise<{ readonly success: true; readonly data: SubscriptionPlanView }> {
    const input = parseSubscriptionPlanUpdate(body);
    try {
      const record = await this.plans.update(planId, input);
      return Object.freeze({ success: true as const, data: project(record) });
    } catch (error: unknown) {
      // Legacy answered 500 with the raw Prisma message for a missing plan.
      if (isMissingRecord(error)) throw notFound();
      throw error;
    }
  }

  /** Legacy deactivated rather than deleting, to keep payment history intact. */
  async deactivate(planId: string): Promise<{
    readonly success: true;
    readonly message: string;
    readonly data: SubscriptionPlanView;
  }> {
    try {
      const record = await this.plans.update(planId, { isActive: false });
      return Object.freeze({
        success: true as const,
        message: 'Plan deactivated successfully',
        data: project(record),
      });
    } catch (error: unknown) {
      if (isMissingRecord(error)) throw notFound();
      throw error;
    }
  }
}

const project = (record: PlanRecord): SubscriptionPlanView =>
  Object.freeze({
    id: record.id,
    name: record.name,
    price: record.price,
    currency: record.currency,
    duration: record.duration,
    features: record.features,
    limits: record.limits,
    targetAudience: record.targetAudience,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });

function notFound(): DomainError {
  return new DomainError('NOT_FOUND', 'Subscription plan not found.');
}
