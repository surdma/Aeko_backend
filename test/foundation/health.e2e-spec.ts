import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from '../../src/common/http-exception.filter.js';
import { RequestIdMiddleware } from '../../src/common/request-id.middleware.js';
import { SanitizedLogger } from '../../src/common/sanitized-logger.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { HealthModule } from '../../src/modules/health/health.module.js';

const verifyConnection = vi.fn<() => Promise<void>>();

@Module({
  imports: [HealthModule],
  providers: [SanitizedLogger, HttpExceptionFilter],
})
class TestAppModule {}

describe('health endpoints', () => {
  let app: INestApplication;

  beforeEach(async () => {
    verifyConnection.mockReset();
    const moduleReference = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ verifyConnection })
      .compile();

    app = moduleReference.createNestApplication();
    const requestIdMiddleware = new RequestIdMiddleware();
    app.use(requestIdMiddleware.use.bind(requestIdMiddleware));
    app.useGlobalFilters(moduleReference.get(HttpExceptionFilter));
    await app.init();
  });

  afterEach(async () => app.close());

  it('reports process liveness without querying PostgreSQL', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'foundation-live-test')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('foundation-live-test');
    expect(response.body.status).toBe('ok');
    expect(verifyConnection).not.toHaveBeenCalled();
  });

  it('reports readiness after PostgreSQL responds', async () => {
    verifyConnection.mockResolvedValue(undefined);
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(response.body.status).toBe('ready');
    expect(verifyConnection).toHaveBeenCalledOnce();
  });

  it('returns a stable redacted 503 envelope when PostgreSQL is unavailable', async () => {
    verifyConnection.mockRejectedValue(
      new Error('postgresql://admin:super-secret@database.internal/aeko'),
    );

    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .set('x-request-id', 'foundation-ready-test')
      .expect(503);

    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'The database is not ready',
        details: null,
        requestId: 'foundation-ready-test',
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('super-secret');
  });
});
