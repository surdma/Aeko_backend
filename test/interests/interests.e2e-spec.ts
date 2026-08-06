import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Interest } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from '../../src/common/http-exception.filter.js';
import { LoggingModule } from '../../src/common/logging.module.js';
import { RequestIdMiddleware } from '../../src/common/request-id.middleware.js';
import { InterestsModule } from '../../src/interests/interests.module.js';
import {
  INTERESTS_REPOSITORY,
  type InterestsRepository,
} from '../../src/interests/interests.repository.js';

const activeInterest: Interest = {
  id: 'interest-id',
  name: 'blockchain',
  displayName: 'Blockchain',
  description: 'Distributed systems and digital assets',
  icon: 'blocks',
  isActive: true,
  createdAt: new Date('2026-08-06T18:00:00.000Z'),
  updatedAt: new Date('2026-08-06T18:00:00.000Z'),
};

const repository: InterestsRepository = {
  listActive: vi.fn(),
};

@Module({
  imports: [LoggingModule, InterestsModule],
  providers: [HttpExceptionFilter],
})
class TestAppModule {}

describe('GET /api/interests', () => {
  let app: INestApplication;

  beforeEach(async () => {
    vi.mocked(repository.listActive).mockReset();

    const moduleReference = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(INTERESTS_REPOSITORY)
      .useValue(repository)
      .compile();

    app = moduleReference.createNestApplication();
    const requestIdMiddleware = new RequestIdMiddleware();
    app.use(requestIdMiddleware.use.bind(requestIdMiddleware));
    app.useGlobalFilters(moduleReference.get(HttpExceptionFilter));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('preserves the legacy success envelope and complete interest rows', async () => {
    vi.mocked(repository.listActive).mockResolvedValue([activeInterest]);

    const response = await request(app.getHttpServer())
      .get('/api/interests')
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: [
        {
          ...activeInterest,
          createdAt: activeInterest.createdAt.toISOString(),
          updatedAt: activeInterest.updatedAt.toISOString(),
        },
      ],
    });
  });

  it('preserves the public 500 message without exposing the raw error', async () => {
    vi.mocked(repository.listActive).mockRejectedValue(
      new Error('postgresql://admin:super-secret@database.internal/aeko'),
    );

    const response = await request(app.getHttpServer())
      .get('/api/interests')
      .expect(500);

    expect(response.body).toEqual({
      success: false,
      message: 'Error fetching interests',
    });
    expect(JSON.stringify(response.body)).not.toContain('super-secret');
  });
});
