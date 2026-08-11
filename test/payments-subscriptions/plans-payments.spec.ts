import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { RoleGuard } from '../../src/auth/guards/role/role.guard';
import { SessionGuard } from '../../src/auth/guards/session/session.guard';
import { TwoFactorGuard } from '../../src/auth/guards/two-factor/two-factor.guard';
import type { JsonValue } from '../../src/common/json/json-value';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { PaymentsController } from '../../src/payments/payments.controller';
import { PaymentsService } from '../../src/payments/payments.service';
import type {
  FlutterwaveInitiateRequest,
  FlutterwaveVerification,
} from '../../src/providers/flutterwave/flutterwave.port';
import { FlutterwavePort } from '../../src/providers/flutterwave/flutterwave.port';
import { SubscriptionPlansController } from '../../src/subscription-plans/subscription-plans.controller';
import { SubscriptionPlansService } from '../../src/subscription-plans/subscription-plans.service';

const EPOCH = new Date('2026-08-01T00:00:00.000Z');

interface PlanRow {
  id: string;
  name: string;
  price: number;
  currency: string;
  duration: string;
  features: unknown;
  limits: unknown;
  targetAudience: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const makePlan = (overrides: Partial<PlanRow> = {}): PlanRow => ({
  id: 'plan-1',
  name: 'Gold',
  price: 10,
  currency: 'USD',
  duration: 'monthly',
  features: ['a'],
  limits: null,
  targetAudience: null,
  isActive: true,
  createdAt: EPOCH,
  updatedAt: EPOCH,
  ...overrides,
});

class MissingRecord extends Error {
  readonly code = 'P2025';
}

interface PlanHarness {
  readonly service: SubscriptionPlansService;
  readonly rows: Map<string, PlanRow>;
  lastCreateData: Record<string, unknown> | null;
  lastUpdateData: Record<string, unknown> | null;
  lastOrderBy: unknown;
}

const createPlanHarness = (rows: readonly PlanRow[] = []): PlanHarness => {
  const store = new Map(rows.map((row) => [row.id, row]));
  const harness: PlanHarness = {
    service: undefined as unknown as SubscriptionPlansService,
    rows: store,
    lastCreateData: null,
    lastUpdateData: null,
    lastOrderBy: null,
  };

  const db = {
    subscriptionPlan: {
      findMany: (args: { orderBy: unknown }): Promise<readonly unknown[]> => {
        harness.lastOrderBy = args.orderBy;
        return Promise.resolve([...store.values()]);
      },
      create: ({
        data,
      }: {
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        harness.lastCreateData = data;
        const row = makePlan({
          id: `plan-${String(store.size + 1)}`,
          name: String(data.name),
          price: typeof data.price === 'number' ? data.price : 0,
          currency: String(data.currency),
          duration: String(data.duration),
          features: data.features,
          limits: data.limits ?? null,
          targetAudience:
            typeof data.targetAudience === 'string'
              ? data.targetAudience
              : null,
        });
        store.set(row.id, row);
        return Promise.resolve(row);
      },
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        harness.lastUpdateData = data;
        const row = store.get(where.id);
        if (row === undefined) return Promise.reject(new MissingRecord());
        const next: PlanRow = {
          ...row,
          name: typeof data.name === 'string' ? data.name : row.name,
          price: typeof data.price === 'number' ? data.price : row.price,
          isActive:
            typeof data.isActive === 'boolean' ? data.isActive : row.isActive,
        };
        store.set(next.id, next);
        return Promise.resolve(next);
      },
    },
  };

  return Object.assign(harness, {
    service: new SubscriptionPlansService(
      new PrismaService(
        db as unknown as ConstructorParameters<typeof PrismaService>[0],
      ),
    ),
  });
};

class FakeFlutterwave extends FlutterwavePort {
  transactionStatus: string | null = 'successful';
  raw: JsonValue = { status: 'success', data: { id: 1, status: 'successful' } };
  lastInitiate: FlutterwaveInitiateRequest | null = null;

  initiate(request: FlutterwaveInitiateRequest): Promise<JsonValue> {
    this.lastInitiate = request;
    return Promise.resolve({
      status: 'success',
      data: { link: 'https://checkout.flutterwave.com/x' },
    });
  }

  verify(): Promise<FlutterwaveVerification> {
    return Promise.resolve({
      transactionStatus: this.transactionStatus,
      raw: this.raw,
    });
  }
}

describe('subscription plans', () => {
  it('lists plans cheapest first, as legacy did', async () => {
    const harness = createPlanHarness([makePlan()]);
    const result = await harness.service.list();
    expect(harness.lastOrderBy).toEqual({ price: 'asc' });
    expect(result.data[0]?.name).toBe('Gold');
  });

  it('creates a plan with the legacy column defaults', async () => {
    const harness = createPlanHarness();
    const result = await harness.service.create({
      name: 'Silver',
      price: 4.99,
      features: ['x'],
    });

    expect(harness.lastCreateData).toMatchObject({
      currency: 'USD',
      duration: 'monthly',
      targetAudience: null,
    });
    expect(result.data.name).toBe('Silver');
  });

  it('updates only the columns the request names', async () => {
    const harness = createPlanHarness([makePlan()]);
    await harness.service.update('plan-1', { price: 19.99 });
    expect(harness.lastUpdateData).toEqual({ price: 19.99 });
  });

  it('refuses the mass assignment legacy passed to prisma', async () => {
    const harness = createPlanHarness([makePlan()]);
    await expect(
      harness.service.update('plan-1', { id: 'somewhere-else' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(harness.lastUpdateData).toBeNull();
  });

  it('deactivates rather than deleting, keeping payment history', async () => {
    const harness = createPlanHarness([makePlan()]);
    const result = await harness.service.deactivate('plan-1');

    expect(result.message).toBe('Plan deactivated successfully');
    expect(harness.rows.get('plan-1')?.isActive).toBe(false);
    expect(harness.lastUpdateData).toEqual({ isActive: false });
  });

  it('reports a missing plan rather than leaking the prisma error', async () => {
    const harness = createPlanHarness();
    await expect(
      harness.service.update('ghost', { price: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(harness.service.deactivate('ghost')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('flutterwave payments', () => {
  it('sends the legacy payload, including the placeholder redirect', async () => {
    const provider = new FakeFlutterwave();
    const service = new PaymentsService(provider);

    await service.initiate({ amount: 500, email: 'payer@example.com' });

    expect(provider.lastInitiate).toMatchObject({
      amount: 500,
      currency: 'NGN',
      redirectUrl: 'https://your-site.com/payment-success',
      paymentOptions: 'card, banktransfer, ussd',
      customer: { email: 'payer@example.com', phonenumber: null, name: null },
    });
  });

  it('reports success when the transaction actually settled', async () => {
    const service = new PaymentsService(new FakeFlutterwave());
    await expect(
      service.verify({ transaction_id: '1' }),
    ).resolves.toMatchObject({ message: 'Payment successful' });
  });

  it('refuses a transaction that has not settled', async () => {
    const provider = new FakeFlutterwave();
    provider.transactionStatus = 'pending';
    await expect(
      new PaymentsService(provider).verify({ transaction_id: '1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('plan and payment routes', () => {
  const reflector = new Reflector();
  const handlerOf = (
    controller: { readonly prototype: object },
    name: string,
  ) => {
    const handler: unknown = Reflect.get(controller.prototype, name);
    if (typeof handler !== 'function') {
      throw new Error(`${name} is missing`);
    }
    return handler;
  };

  it('registers the four plan routes with the legacy guards', () => {
    expect(
      reflector.get<unknown>(PATH_METADATA, SubscriptionPlansController),
    ).toBe('api/subscription-plans');

    const routes = [
      ['list', '/', RequestMethod.GET],
      ['create', '/', RequestMethod.POST],
      ['update', ':id', RequestMethod.PUT],
      ['deactivate', ':id', RequestMethod.DELETE],
    ] as const;

    for (const [name, path, method] of routes) {
      const handler = handlerOf(SubscriptionPlansController, name);
      expect(reflector.get<unknown>(PATH_METADATA, handler)).toBe(path);
      expect(reflector.get<unknown>(METHOD_METADATA, handler)).toBe(method);
    }

    for (const name of ['create', 'update', 'deactivate']) {
      expect(
        reflector.get<readonly unknown[]>(
          GUARDS_METADATA,
          handlerOf(SubscriptionPlansController, name),
        ),
      ).toEqual([SessionGuard, RoleGuard]);
    }
    expect(
      reflector.get<readonly unknown[]>(
        GUARDS_METADATA,
        handlerOf(SubscriptionPlansController, 'list'),
      ),
    ).toBeUndefined();
  });

  it('keeps the second factor on the payment initiation', () => {
    expect(reflector.get<unknown>(PATH_METADATA, PaymentsController)).toBe(
      'api/payments',
    );
    expect(
      reflector.get<readonly unknown[]>(
        GUARDS_METADATA,
        handlerOf(PaymentsController, 'initiate'),
      ),
    ).toEqual([SessionGuard, TwoFactorGuard]);
    expect(
      reflector.get<readonly unknown[]>(
        GUARDS_METADATA,
        handlerOf(PaymentsController, 'verify'),
      ),
    ).toEqual([SessionGuard]);
  });
});
