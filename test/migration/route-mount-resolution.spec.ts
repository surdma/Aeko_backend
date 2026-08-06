import { describe, expect, it } from 'vitest';
import { extractSourceCapabilities } from '../../scripts/migration/inventory-legacy.mjs';
import {
  extractRouterMounts,
  resolveMountedCapabilities,
} from '../../scripts/migration/inventory-resolved.mjs';

describe('legacy router mount resolution', () => {
  it('combines server mount prefixes with router paths and middleware order', () => {
    const mounts = extractRouterMounts(
      'server.js',
      `
        import postRoutes from './routes/postRoutes.js';
        app.use('/api/posts', apiRateLimit, blockingMiddleware.checkPostInteraction(), postRoutes);
      `,
    );
    const registrations = extractSourceCapabilities(
      'routes/postRoutes.js',
      `
        router.get('/', listPosts);
        router.post('/:postId/like', auth, likePost);
      `,
    );

    const resolved = resolveMountedCapabilities(registrations, mounts);

    expect(resolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'http-route',
          evidence: expect.objectContaining({
            method: 'GET',
            path: '/api/posts',
            routerPath: '/',
            mountPrefix: '/api/posts',
            mountStatus: 'mounted',
            mountMiddleware: JSON.stringify([
              'apiRateLimit',
              'blockingMiddleware.checkPostInteraction()',
            ]),
          }),
        }),
        expect.objectContaining({
          kind: 'http-route',
          evidence: expect.objectContaining({
            method: 'POST',
            path: '/api/posts/:postId/like',
            routerPath: '/:postId/like',
          }),
        }),
      ]),
    );
  });

  it('keeps unmounted route registrations explicit and blocking', () => {
    const registrations = extractSourceCapabilities(
      'routes/postTransferRoutes.js',
      `router.post('/transfer', handler);`,
    );

    const [unmounted] = resolveMountedCapabilities(registrations, []);

    expect(unmounted).toEqual(
      expect.objectContaining({
        kind: 'unknown',
        risk: 'unknown',
        targetModule: 'unassigned',
        evidence: expect.objectContaining({
          registrationKind: 'http-route',
          routerPath: '/transfer',
          detail: 'unmounted-router-registration',
          mountStatus: 'unmounted',
        }),
      }),
    );
  });

  it('supports a router mounted at the application root', () => {
    const mounts = extractRouterMounts(
      'server.js',
      `
        import rootRoutes from './routes/rootRoutes.js';
        app.use(rootRoutes);
      `,
    );
    const registrations = extractSourceCapabilities(
      'routes/rootRoutes.js',
      `router.get('/health', handler);`,
    );

    const [resolved] = resolveMountedCapabilities(registrations, mounts);
    expect(resolved?.evidence.path).toBe('/health');
  });
});
