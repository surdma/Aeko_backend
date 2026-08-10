import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { CommentsController } from '../../src/comments/comments.controller';
import { ExploreController } from '../../src/explore/explore.controller';
import { NotificationsController } from '../../src/notifications/notifications.controller';
import { PostsController } from '../../src/posts/posts.controller';
import { ReportsController } from '../../src/reports/reports.controller';
import { StatusController } from '../../src/status/status.controller';

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
  'content-social.json',
) as Manifest;

const corrections = readJson(
  'docs',
  'nestjs-migration',
  'corrections.json',
) as readonly Correction[];

const readSource = (...path: readonly string[]): string =>
  readFileSync(join(ROOT, ...path), 'utf8');

const SOURCES = [
  ['src', 'posts', 'posts.service.ts'],
  ['src', 'posts', 'posts.controller.ts'],
  ['src', 'comments', 'comments.service.ts'],
  ['src', 'status', 'status.service.ts'],
  ['src', 'explore', 'explore.service.ts'],
  ['src', 'notifications', 'notifications.service.ts'],
  ['src', 'reports', 'reports.service.ts'],
];

/**
 * Routes this domain adds beyond the legacy inventory. Both are realtime
 * delivery concerns; neither replaces a legacy capability.
 */
const ADDITIONS = [
  'GET /api/notifications/stream',
  'GET /api/notifications/realtime-health',
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
  ...routesOf(PostsController),
  ...routesOf(CommentsController),
  ...routesOf(StatusController),
  ...routesOf(ExploreController),
  ...routesOf(NotificationsController),
  ...routesOf(ReportsController),
];

const LEGACY_ROUTES = [
  // posts (23)
  'POST /api/posts/create',
  'GET /api/posts/feed',
  'GET /api/posts/search',
  'GET /api/posts/mixed',
  'GET /api/posts/videos',
  'GET /api/posts/user/bookmarks',
  'GET /api/posts/user/liked',
  'GET /api/posts/user/:userId',
  'GET /api/posts/:postId/reposts',
  'GET /api/posts/:postId',
  'POST /api/posts/:postId/like',
  'POST /api/posts/:postId/bookmark',
  'POST /api/posts/:postId/view',
  'POST /api/posts/:postId/not-interested',
  'POST /api/posts/:postId/share-to-status',
  'POST /api/posts/:postId/promote',
  'POST /api/posts/repost/:postId',
  'PUT /api/posts/:postId',
  'PUT /api/posts/:postId/privacy',
  'DELETE /api/posts/:id',
  // comments (5)
  'POST /api/comments/reply/:commentId',
  'POST /api/comments/like/:commentId',
  'GET /api/comments/replies/:commentId',
  'POST /api/comments/:postId',
  'GET /api/comments/:postId',
  // status (5)
  'POST /api/status',
  'GET /api/status',
  'DELETE /api/status/:id',
  'POST /api/status/:id/react',
  'POST /api/status/:id/reshare',
  // explore (1)
  'GET /api/explore',
  // notifications (8)
  'GET /api/notifications/settings',
  'PUT /api/notifications/settings',
  'PUT /api/notifications/push-token',
  'GET /api/notifications/unread-count',
  'PUT /api/notifications/read-all',
  'GET /api/notifications',
  'PUT /api/notifications/:id/read',
  'DELETE /api/notifications/:id',
  // reports (4)
  'POST /api/reports',
  'GET /api/reports',
  'POST /api/reports/:userId/warn',
  'POST /api/reports/:userId/ban',
];

describe('content-social cutover', () => {
  it('exposes every legacy route plus only the documented additions', () => {
    expect(new Set(allRoutes)).toEqual(
      new Set([...LEGACY_ROUTES, ...ADDITIONS]),
    );
  });

  it('registers no route twice', () => {
    expect(allRoutes).toHaveLength(new Set(allRoutes).size);
  });

  /**
   * Three chain-owned routes are deliberately absent: anchor, mint-as-nft, and
   * verify depend on the `chain` domain's providers and land with it.
   */
  it('records the deferred chain routes as still outstanding', () => {
    const deferred = [
      'POST /api/posts/:postId/anchor',
      'POST /api/posts/:postId/mint-as-nft',
      'GET /api/posts/:postId/verify',
    ];
    for (const route of deferred) {
      expect(allRoutes).not.toContain(route);
    }
    expect(
      manifest.capabilityIds.filter((id) => id.includes('/anchor')),
    ).toHaveLength(1);
  });

  it('records closure honestly in the domain manifest', () => {
    expect(manifest.capabilityIds).toHaveLength(52);
    expect(manifest.migration).toEqual({
      status: 'implemented-except-chain',
      assigned: 49,
      missing: 3,
      duplicate: 0,
      unresolved: 0,
    });
  });

  it('registers every content-social correction as approved', () => {
    const registered = new Map(
      corrections.map((correction) => [correction.id, correction]),
    );
    expect(manifest.corrections.length).toBeGreaterThan(0);
    for (const id of manifest.corrections) {
      expect(registered.get(id)?.status).toBe('approved');
    }
  });

  it('keeps no Express-era patterns in any migrated service', () => {
    for (const path of SOURCES) {
      const source = readSource(...path);
      expect(source).not.toContain('req.body');
      expect(source).not.toContain('req.user');
      expect(source).not.toContain('res.status');
      // Raw exception messages must not reach a response.
      expect(source).not.toMatch(/error:\s*error\.message/u);
    }
  });
});
