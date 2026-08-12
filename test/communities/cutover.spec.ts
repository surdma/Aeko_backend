import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { CommunitiesController } from '../../src/communities/communities.controller';
import { CommunityPaymentsController } from '../../src/community-payments/community-payments.controller';
import { CommunityProfilesController } from '../../src/community-profiles/community-profiles.controller';

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
  'communities.json',
) as Manifest;

const owners = readJson(
  'docs',
  'nestjs-migration',
  'domains',
  'communities-owners.json',
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

const SOURCES = [
  ['src', 'communities', 'communities.service.ts'],
  ['src', 'communities', 'communities.controller.ts'],
  ['src', 'community-profiles', 'community-profiles.service.ts'],
  ['src', 'community-profiles', 'community-profiles.controller.ts'],
  ['src', 'community-payments', 'community-payments.service.ts'],
  ['src', 'community-payments', 'community-payments.controller.ts'],
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
  ...routesOf(CommunitiesController),
  ...routesOf(CommunityProfilesController),
  ...routesOf(CommunityPaymentsController),
];

const LEGACY_ROUTES = [
  'POST /api/communities',
  'GET /api/communities',
  'GET /api/communities/my',
  'GET /api/communities/:id',
  'POST /api/communities/:id/join',
  'POST /api/communities/:id/leave',
  'PUT /api/communities/:id',
  'DELETE /api/communities/:id',
  'PUT /api/community-profiles/:id/profile',
  'POST /api/community-profiles/:id/upload-photo',
  'PUT /api/community-profiles/:id/settings',
  'POST /api/community-profiles/:id/follow',
  'POST /api/community-profiles/:id/unfollow',
  'POST /api/community-profiles/:id/posts',
  'GET /api/community-profiles/:id/posts',
  'POST /api/community/payment/initialize',
  'GET /api/community/payment/verify',
  'POST /api/community/payment/withdraw',
  'GET /api/community/payment/:communityId/transactions',
];

describe('communities cutover', () => {
  it('exposes exactly the nineteen legacy routes, with no additions', () => {
    expect(new Set(allRoutes)).toEqual(new Set(LEGACY_ROUTES));
    expect(allRoutes).toHaveLength(LEGACY_ROUTES.length);
  });

  it('records 23/23 closure in the domain manifest', () => {
    expect(manifest.capabilityIds).toHaveLength(23);
    expect(manifest.migration).toEqual({
      status: 'implemented',
      assigned: 23,
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

  it('registers every correction as approved, with nothing deferred', () => {
    const registered = new Map(
      corrections.map((correction) => [correction.id, correction]),
    );
    expect(manifest.corrections.length).toBeGreaterThan(0);
    for (const id of manifest.corrections) {
      expect(registered.get(id)?.status).toBe('approved');
    }
  });

  it('carries no Express-era patterns into the services', () => {
    for (const path of SOURCES) {
      const source = readCode(...path);
      expect(source).not.toContain('req.body');
      expect(source).not.toContain('req.user');
      expect(source).not.toContain('res.status');
      expect(source).not.toContain('res.json');
      expect(source).not.toMatch(/error:\s*error\.message/u);
    }
  });

  it('never names a relation that does not exist on the model', () => {
    // Four routes answered 500 on every call because they did.
    for (const path of [
      ['src', 'communities', 'community-prisma.client.ts'],
      ['src', 'community-profiles', 'community-post-prisma.client.ts'],
      ['src', 'community-payments', 'community-transaction-prisma.client.ts'],
    ]) {
      const source = readCode(...path);
      expect(source).not.toMatch(/\bmemberships\s*:/u);
      expect(source).not.toMatch(/include:\s*\{\s*user:/u);
      expect(source).not.toMatch(/include:\s*\{\s*community:/u);
    }

    const posts = readCode(
      'src',
      'community-profiles',
      'community-post-prisma.client.ts',
    );
    expect(posts).toContain('users_posts_userIdTouser');
  });

  it('never validates a community id as a mongo object id', () => {
    // Legacy did, and community ids are uuids, so three routes always 400ed.
    for (const path of SOURCES) {
      expect(readCode(...path)).not.toMatch(/isMongoId|ObjectId/u);
    }
    expect(
      readCode('src', 'community-payments', 'community-payment.contract.ts'),
    ).not.toMatch(/isMongoId|ObjectId/u);
  });

  it('settles a paid membership into the relational table as well', () => {
    // The whole point of the dual-write: every read path uses this table.
    const adapter = readCode(
      'src',
      'providers',
      'community-payment',
      'prisma-community-payment.adapter.ts',
    );
    expect(adapter).toContain('upsertRelationalMember');

    const boundary = readCode(
      'src',
      'providers',
      'community-payment',
      'community-payment-prisma.client.ts',
    );
    expect(boundary).toContain('communityMember.create');
  });

  it('carries the membership backfill in the legacy cutover', () => {
    const sql = readSource('prisma', 'data-migrations', 'legacy-cutover.sql');
    expect(sql).toContain('INSERT INTO "community_members"');
    // An existing relational row must always win over the JSON.
    expect(sql).toContain('ON CONFLICT ("communityId", "userId") DO NOTHING');
  });

  it('runs membership and follow writes under serializable isolation', () => {
    for (const path of [
      ['src', 'communities', 'community-prisma.client.ts'],
      ['src', 'community-profiles', 'community-follower-prisma.client.ts'],
      ['src', 'community-payments', 'community-transaction-prisma.client.ts'],
    ]) {
      expect(readCode(...path)).toContain("isolationLevel: 'Serializable'");
    }
  });

  it('keeps the generated prisma client out of value position', () => {
    for (const path of [
      ['src', 'communities', 'community-prisma.client.ts'],
      ['src', 'community-profiles', 'community-post-prisma.client.ts'],
      ['src', 'community-profiles', 'community-follower-prisma.client.ts'],
      ['src', 'community-payments', 'community-transaction-prisma.client.ts'],
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
