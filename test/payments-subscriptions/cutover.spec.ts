import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { CoinsController } from '../../src/coins/coins.controller';
import { PaymentsController } from '../../src/payments/payments.controller';
import { SubscriptionPlansController } from '../../src/subscription-plans/subscription-plans.controller';
import { SubscriptionsController } from '../../src/subscriptions/subscriptions.controller';
import { WebhooksController } from '../../src/webhooks/webhooks.controller';

const ROOT = join(__dirname, '..', '..');

interface Migration {
  readonly status: string;
  readonly assigned: number;
  readonly missing: number;
  readonly duplicate: number;
  readonly unresolved: number;
}

interface Manifest {
  readonly capabilityIds: readonly string[];
  readonly corrections: readonly string[];
  readonly migration?: Migration;
}

interface Correction {
  readonly id: string;
  readonly status: string;
}

const readJson = (...path: readonly string[]): unknown =>
  JSON.parse(readFileSync(join(ROOT, ...path), 'utf8')) as unknown;

const manifest = readJson(
  'docs',
  'nestjs-migration',
  'domains',
  'payments-subscriptions.json',
) as Manifest;

const owners = readJson(
  'docs',
  'nestjs-migration',
  'domains',
  'payments-subscriptions-owners.json',
) as Readonly<Record<string, readonly string[]>>;

const corrections = readJson(
  'docs',
  'nestjs-migration',
  'corrections.json',
) as readonly Correction[];

const readSource = (...path: readonly string[]): string =>
  readFileSync(join(ROOT, ...path), 'utf8');

/** Comments describe the legacy defects, so patterns are matched on code. */
const readCode = (...path: readonly string[]): string =>
  readSource(...path)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/.*$/gmu, '');

const SERVICES = [
  ['src', 'coins', 'coins.service.ts'],
  ['src', 'payments', 'payments.service.ts'],
  ['src', 'subscriptions', 'subscriptions.service.ts'],
  ['src', 'subscription-plans', 'subscription-plans.service.ts'],
  ['src', 'webhooks', 'webhooks.service.ts'],
];

const CONTROLLERS = [
  ['src', 'coins', 'coins.controller.ts'],
  ['src', 'payments', 'payments.controller.ts'],
  ['src', 'subscriptions', 'subscriptions.controller.ts'],
  ['src', 'subscription-plans', 'subscription-plans.controller.ts'],
  ['src', 'webhooks', 'webhooks.controller.ts'],
];

const reflector = new Reflector();

const routesOf = (controller: { readonly prototype: object }): string[] => {
  const root: unknown = Reflect.getMetadata(PATH_METADATA, controller);
  const prefix = typeof root === 'string' && root !== '/' ? root : '';
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const handler: unknown = Reflect.get(controller.prototype, name);
      if (typeof handler !== 'function') return [];
      const path = reflector.get<unknown>(PATH_METADATA, handler);
      const method = reflector.get<unknown>(METHOD_METADATA, handler);
      if (typeof path !== 'string') return [];
      const verb =
        method === RequestMethod.POST
          ? 'POST'
          : method === RequestMethod.PUT
            ? 'PUT'
            : method === RequestMethod.PATCH
              ? 'PATCH'
              : method === RequestMethod.DELETE
                ? 'DELETE'
                : 'GET';
      const segments = [prefix, path === '/' ? '' : path].filter(
        (segment) => segment !== '',
      );
      return [`${verb} /${segments.join('/')}`];
    });
};

const allRoutes = [
  ...routesOf(CoinsController),
  ...routesOf(PaymentsController),
  ...routesOf(SubscriptionsController),
  ...routesOf(SubscriptionPlansController),
  ...routesOf(WebhooksController),
];

const LEGACY_ROUTES = [
  'GET /api/coins/packages',
  'GET /api/coins/balance',
  'GET /api/coins/history',
  'POST /api/coins/purchase',
  'GET /api/coins/purchase/verify',
  'POST /api/coins/purchase/verify-stripe',
  'POST /api/payments/pay',
  'GET /api/payments/verify',
  'GET /api/subscription/admin/all',
  'GET /api/subscription/admin/stats',
  'POST /api/subscription/initialize',
  'GET /api/subscription/verify',
  'GET /api/subscription/status',
  'GET /api/subscription-plans',
  'POST /api/subscription-plans',
  'PUT /api/subscription-plans/:id',
  'DELETE /api/subscription-plans/:id',
  'POST /api/webhooks/paystack',
  'POST /api/webhooks/stripe',
];

describe('payments and subscriptions cutover', () => {
  it('exposes exactly the nineteen legacy routes, with no additions', () => {
    expect(new Set(allRoutes)).toEqual(new Set(LEGACY_ROUTES));
    expect(allRoutes).toHaveLength(LEGACY_ROUTES.length);
  });

  it('records 30/30 closure in the domain manifest', () => {
    expect(manifest.capabilityIds).toHaveLength(30);
    expect(manifest.migration).toEqual({
      status: 'implemented',
      assigned: 30,
      missing: 0,
      duplicate: 0,
      unresolved: 0,
    });
  });

  it('assigns every capability to an owning module', () => {
    expect(Object.keys(owners).sort()).toEqual(
      [...manifest.capabilityIds].sort(),
    );
    for (const module of Object.values(owners)) {
      expect(module.length).toBeGreaterThan(0);
    }
  });

  it('registers every correction, and carries the open one openly', () => {
    const registered = new Map(
      corrections.map((correction) => [correction.id, correction]),
    );
    expect(manifest.corrections.length).toBeGreaterThan(0);
    for (const id of manifest.corrections) {
      expect(registered.get(id)?.status).toMatch(
        /^(approved|pending-schema|pending-domain)$/u,
      );
    }
    // Community settlement is not closed; it must stay visible as pending.
    expect(
      registered.get('correction:community-payment-settlement-deferred')
        ?.status,
    ).toBe('pending-domain');
  });

  it('carries no Express-era patterns into the services', () => {
    for (const path of [...SERVICES, ...CONTROLLERS]) {
      const source = readCode(...path);
      expect(source).not.toContain('req.body');
      expect(source).not.toContain('req.user');
      expect(source).not.toContain('res.status');
      expect(source).not.toContain('res.json');
      expect(source).not.toMatch(/error:\s*error\.message/u);
    }
  });

  it('never reads a price, coin count or balance from a request', () => {
    const coins = readCode('src', 'coins', 'coins.service.ts');
    // Every amount comes from the frozen catalogue, never from the caller.
    expect(coins).not.toMatch(/body\.(price|coins|amount|coinBalance)/u);
    expect(coins).toContain('getCoinPackageById');
  });

  it('credits and completions run inside a serializable transaction', () => {
    expect(readCode('src', 'coins', 'coins.service.ts')).toContain(
      'runSerializable',
    );
    expect(
      readCode('src', 'subscriptions', 'subscriptions.service.ts'),
    ).toContain('runSerializable');
    for (const path of [
      ['src', 'coins', 'coin-prisma.client.ts'],
      ['src', 'subscriptions', 'subscription-prisma.client.ts'],
    ]) {
      expect(readCode(...path)).toContain("isolationLevel: 'Serializable'");
    }
  });

  it('never compares a webhook signature with a plain equality', () => {
    const adapter = readCode(
      'src',
      'providers',
      'paystack',
      'http-paystack.adapter.ts',
    );
    expect(adapter).toContain('timingSafeEqual');
    expect(adapter).not.toMatch(/hash\s*!==\s*signature/u);
  });

  it('keeps the generated prisma client out of value position', () => {
    // A value import pulls a module using import.meta into the CommonJS test
    // transform and fails at load.
    for (const path of [
      ['src', 'coins', 'coin-prisma.client.ts'],
      ['src', 'subscriptions', 'subscription-prisma.client.ts'],
      ['src', 'subscription-plans', 'subscription-plan-prisma.client.ts'],
      ['src', 'webhooks', 'webhook-prisma.client.ts'],
    ]) {
      const source = readSource(...path);
      expect(source).toMatch(
        /import type \{[^}]*\} from '\.\.\/generated\/prisma\/client'/u,
      );
      expect(source).not.toMatch(
        /^import \{[^}]*\} from '\.\.\/generated\/prisma\/client'/mu,
      );
    }
  });
});
