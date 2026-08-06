import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from '../../src/common/http-exception.filter.js';
import { LoggingModule } from '../../src/common/logging.module.js';
import { RequestIdMiddleware } from '../../src/common/request-id.middleware.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { WaitlistModule } from '../../src/modules/waitlist/waitlist.module.js';
import {
  WAITLIST_REPOSITORY,
  type WaitlistRepository,
} from '../../src/modules/waitlist/waitlist.repository.js';

const entry = {
  id: 'entry-id',
  name: 'Jane Doe',
  email: 'jane@example.com',
  createdAt: new Date('2026-08-06T18:00:00.000Z'),
} as const;

const repository: WaitlistRepository = {
  findByEmail: vi.fn(),
  create: vi.fn(),
};

@Module({
  imports: [LoggingModule, WaitlistModule],
  providers: [HttpExceptionFilter],
})
class TestAppModule {}

describe('POST /api/waitlist', () => {
  let app: INestApplication;

  beforeEach(async () => {
    vi.mocked(repository.findByEmail).mockReset();
    vi.mocked(repository.create).mockReset();

    const moduleReference = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(WAITLIST_REPOSITORY)
      .useValue(repository)
      .compile();

    app = moduleReference.createNestApplication();
    const requestIdMiddleware = new RequestIdMiddleware();
    app.use(requestIdMiddleware.use.bind(requestIdMiddleware));
    app.useGlobalFilters(moduleReference.get(HttpExceptionFilter));
    await app.init();
  });

  afterEach(async () => app.close());

  it('returns the legacy 201 response and normalized values', async () => {
    vi.mocked(repository.findByEmail).mockResolvedValue({ kind: 'not-found' });
    vi.mocked(repository.create).mockResolvedValue({ kind: 'created', entry });

    const response = await request(app.getHttpServer())
      .post('/api/waitlist')
      .send({ name: '  Jane Doe  ', email: '  JANE@EXAMPLE.COM  ' })
      .expect(201);

    expect(response.body).toEqual({
      success: true,
      message: 'Joined waitlist successfully',
      data: { ...entry, createdAt: entry.createdAt.toISOString() },
    });
  });

  it('preserves validation and duplicate responses', async () => {
    await request(app.getHttpServer())
      .post('/api/waitlist')
      .send({ email: entry.email })
      .expect(400, { success: false, message: 'Name and email are required' });

    vi.mocked(repository.findByEmail).mockResolvedValue({ kind: 'found', entry });
    await request(app.getHttpServer())
      .post('/api/waitlist')
      .send({ name: entry.name, email: entry.email })
      .expect(409, {
        success: false,
        message: 'This email is already on the waitlist',
      });
  });

  it('returns the stable database-unavailable response', async () => {
    vi.mocked(repository.findByEmail).mockResolvedValue({
      kind: 'database-unavailable',
    });

    await request(app.getHttpServer())
      .post('/api/waitlist')
      .send({ name: entry.name, email: entry.email })
      .expect(503, {
        success: false,
        message: 'Waitlist is temporarily unavailable. Please try again shortly.',
      });
  });
});
