import { describe, expect, it } from 'vitest';
import {
  auditInventory,
  extractSourceCapabilities,
  inventoryMarkdown,
  parseJsonCapabilities,
  parsePrismaSchema,
  type CapabilityInventory,
  type CapabilityItem,
} from '../../scripts/migration/inventory-capabilities.mjs';

const expectRequiredMetadata = (capability: CapabilityItem): void => {
  expect(capability).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      kind: expect.any(String),
      sourceFile: expect.any(String),
      legacyOwner: 'Express',
      risk: expect.any(String),
      targetModule: expect.any(String),
      parityCases: expect.any(Array),
      status: 'legacy-only',
      reviewVerdict: 'pending',
      cutoverState: 'express-owner',
      rollbackState: 'legacy-available',
    }),
  );
  expect(capability.id).toMatch(/^[a-z-]+:[a-f0-9]{12}$/u);
  expect(capability.parityCases.length).toBeGreaterThan(0);
};

describe('legacy capability inventory extraction', () => {
  it('extracts Express, Socket.IO, scheduled-job, and AdminJS registrations from syntax', () => {
    const capabilities = extractSourceCapabilities(
      'server.js',
      `
        import AdminJS from 'adminjs';
        import './jobs/notifications.js';
        await import('./jobs/expireSubscriptions.js');

        app.use('/api', authMiddleware, apiRouter);
        router.post('/posts/:id', authMiddleware, handler);
        socket.on('join-room', handler);
        io.to(roomId).emit('post-created', payload);
        cron.schedule('0 * * * *', job);

        const admin = new AdminJS({
          resources: [{
            resource: { model: modelMap.User, client: prisma },
            options: { actions: { banUser: { actionType: 'record' } } }
          }]
        });
      `,
    );

    expect(capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'middleware',
          evidence: expect.objectContaining({ path: '/api' }),
        }),
        expect.objectContaining({
          kind: 'http-route',
          evidence: expect.objectContaining({ method: 'POST', path: '/posts/:id' }),
        }),
        expect.objectContaining({
          kind: 'socket-event',
          evidence: expect.objectContaining({ direction: 'on', event: 'join-room' }),
        }),
        expect.objectContaining({
          kind: 'socket-event',
          evidence: expect.objectContaining({ direction: 'emit', event: 'post-created' }),
        }),
        expect.objectContaining({
          kind: 'scheduled-job',
          evidence: expect.objectContaining({
            registration: 'static-import',
            module: './jobs/notifications.js',
          }),
        }),
        expect.objectContaining({
          kind: 'scheduled-job',
          evidence: expect.objectContaining({
            registration: 'dynamic-import',
            module: './jobs/expireSubscriptions.js',
          }),
        }),
        expect.objectContaining({
          kind: 'scheduled-job',
          evidence: expect.objectContaining({
            registration: 'cron',
            trigger: '0 * * * *',
          }),
        }),
        expect.objectContaining({
          kind: 'admin-resource',
          evidence: expect.objectContaining({ itemType: 'resource', resource: 'User' }),
        }),
        expect.objectContaining({
          kind: 'admin-resource',
          evidence: expect.objectContaining({
            itemType: 'action',
            resource: 'User',
            action: 'banUser',
          }),
        }),
      ]),
    );
    capabilities.forEach(expectRequiredMetadata);
  });

  it('turns dynamically unresolved registrations into explicit unknown items', () => {
    const capabilities = extractSourceCapabilities(
      'dynamic.js',
      `
        app.use(routePrefix, middleware);
        router.get(routePath, handler);
        socket.on(eventName, handler);
        cron.schedule(scheduleExpression, job);
      `,
    );

    expect(capabilities.filter(({ kind }) => kind === 'unknown')).toHaveLength(4);
    expect(capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'unknown',
          risk: 'unknown',
          evidence: expect.objectContaining({ registrationKind: 'http-route' }),
        }),
        expect.objectContaining({
          kind: 'unknown',
          risk: 'unknown',
          evidence: expect.objectContaining({ registrationKind: 'socket-event' }),
        }),
        expect.objectContaining({
          kind: 'unknown',
          risk: 'unknown',
          evidence: expect.objectContaining({ registrationKind: 'scheduled-job' }),
        }),
      ]),
    );
    capabilities.forEach(expectRequiredMetadata);
  });

  it('extracts provider, environment-variable, and Prisma raw-query evidence without secret values', () => {
    const capabilities = extractSourceCapabilities(
      'services/paymentService.js',
      `
        import Stripe from 'stripe';
        import cloudinary from 'cloudinary';
        const apiKey = process.env.STRIPE_SECRET_KEY;
        const result = await prisma.$queryRaw\`SELECT 1\`;
      `,
    );

    expect(capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'provider',
          evidence: expect.objectContaining({ provider: 'stripe', module: 'stripe' }),
        }),
        expect.objectContaining({
          kind: 'provider',
          evidence: expect.objectContaining({
            provider: 'cloudinary',
            module: 'cloudinary',
          }),
        }),
        expect.objectContaining({
          kind: 'operation',
          evidence: {
            category: 'environment-variable',
            name: 'STRIPE_SECRET_KEY',
          },
        }),
        expect.objectContaining({
          kind: 'persistence',
          evidence: expect.objectContaining({ operation: '$queryRaw' }),
        }),
      ]),
    );
    expect(JSON.stringify(capabilities)).not.toContain('SELECT 1');
    capabilities.forEach(expectRequiredMetadata);
  });

  it('parses Prisma models and deployment JSON as structured inputs', () => {
    const prismaCapabilities = parsePrismaSchema(
      'prisma/schema.prisma',
      `
        generator client { provider = "prisma-client-js" }
        datasource db { provider = "postgresql" url = env("DATABASE_URL") }
        model User { id String @id }
        model Transaction { id String @id }
      `,
    );
    const deploymentCapabilities = parseJsonCapabilities(
      'railway.json',
      JSON.stringify({
        deploy: { startCommand: 'node server.js', healthcheckPath: '/health' },
      }),
    );

    expect(prismaCapabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'persistence',
          evidence: { asset: 'prisma-model', model: 'User' },
        }),
        expect.objectContaining({
          kind: 'persistence',
          evidence: { asset: 'prisma-model', model: 'Transaction' },
        }),
      ]),
    );
    expect(deploymentCapabilities).toEqual([
      expect.objectContaining({
        kind: 'operation',
        evidence: expect.objectContaining({
          asset: 'deployment-json',
          startCommand: 'node server.js',
          healthcheckPath: '/health',
        }),
      }),
    ]);
    [...prismaCapabilities, ...deploymentCapabilities].forEach(expectRequiredMetadata);
  });

  it('keeps identifiers stable for the same source evidence', () => {
    const source = `router.get('/health', handler);`;
    expect(
      extractSourceCapabilities('routes/health.js', source).map(({ id }) => id),
    ).toEqual(
      extractSourceCapabilities('routes/health.js', source).map(({ id }) => id),
    );
  });
});

describe('inventory audit and Markdown', () => {
  it('reports required-category coverage and blocks unresolved capabilities', () => {
    const fixture = (
      kind: CapabilityItem['kind'],
      sourceFile: string,
    ): CapabilityItem => ({
      id: `${kind}:000000000000`,
      kind,
      sourceFile,
      legacyOwner: 'Express',
      risk: kind === 'unknown' ? 'unknown' : 'medium',
      targetModule: 'migration-fixture',
      parityCases: ['fixture parity case'],
      status: 'legacy-only',
      reviewVerdict: 'pending',
      cutoverState: 'express-owner',
      rollbackState: 'legacy-available',
      evidence: kind === 'provider' ? { provider: 'stripe' } : {},
    });
    const inventory: CapabilityInventory = {
      schemaVersion: 1,
      legacyWorktree: 'C:/legacy',
      generatedAt: '2026-08-06T00:00:00.000Z',
      items: [
        fixture('middleware', 'server.js'),
        fixture('http-route', 'routes/posts.js'),
        fixture('middleware', 'middleware/auth.js'),
        fixture('socket-event', 'sockets/chat.js'),
        fixture('scheduled-job', 'jobs/nightly.js'),
        fixture('admin-resource', 'admin.js'),
        fixture('provider', 'config/provider.js'),
        fixture('provider', 'services/payments.js'),
        fixture('persistence', 'prisma/schema.prisma'),
        fixture('operation', 'railway.json'),
        fixture('unknown', 'routes/dynamic.js'),
      ],
    };

    const audit = auditInventory(inventory);
    expect(audit.missingCategories).toEqual([]);
    expect(audit.unknownCount).toBe(1);
    expect(audit.complete).toBe(false);

    const markdown = inventoryMarkdown(inventory);
    expect(markdown).toContain('| routes/** | covered |');
    expect(markdown).toContain('| provider integrations | covered |');
    expect(markdown).toContain('Completion gate: **BLOCKED**');
  });
});
