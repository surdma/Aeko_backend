import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { WaitlistEntry } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from '../../src/common/http-exception.filter.js';
import { LoggingModule } from '../../src/common/logging.module.js';
import { RequestIdMiddleware } from '../../src/common/request-id.middleware.js';
import { WaitlistModule } from '../../src/waitlist/waitlist.module.js';
import {
  WAITLIST_REPOSITORY,
  type WaitlistRepository,
} from '../../src/waitlist/waitlist.repository.js';

const entry: WaitlistEntry = {
  id: 'waitlist-entry-id',
  name: 'Jane Doe',
  email: 'jane@example.com',
  createdAt: new Date('2026-08-06T18:00:00.000Z'),
};

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
      .overrideProvider(WAITLIST_REPOSITORY)
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

  it('returns the legacy 201 response and normalized persistence values', async () => {
    vi.mocked(repository.findByEmail).mockResolvedValue(null);
    vi.mocked(repository.create).mockResolvedValue(entry);

    const response = await request(app.getHttpServer())
      .post('/api/waitlist')
      .send({
        name: '  Jane Doe  ',
        email: '  JANE@EXAMPLE.COM  ',
      })
      .expect(201);

    expect(response.body).toEqual({
      success: true,
      message: 'Joined waitlist successfully',
      data: {
        ...entry,
        createdAt: entry.createdAt.toISOString(),
      },
    });
    expect(repository.create).toHaveBeenCalledWith({
      name: 'Jane Doe',
      email: 'jane@example.com',
    });
  });

  it('preserves the missing-fields validation envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/waitlist')
      .send({ email: 'jane@example.com' })
      .expect(400);

    expect(response.body).toEqual({
      success: false,
      message: 'Name and email are required',
    });
    expect(repository.findByEmail).not.toHaveBeenCalled();
  });

  it('preserves duplicate-email behavior', async () => {
    vi.mocked(repository.findByEmail).mockResolvedValue(entry);

    const response = await request(app.getHttpServer())
      .post('/api/waitlist')
      .send({ name: entry.name, email: entry.email })
      .expect(409);

    expect(response.body).toEqual({
      success: false,
      message: 'This email is already on the waitlist',
    });
  });

  it('returns the stable database-unavailable response', async () => {
    vi.mocked(repository.findByEmail).mockRejectedValue(
      new Error("Can't reach database server at database.internal"),
    );

    const response = await request(app.getHttpServer())
      .post('/api/waitlist')
      .send({ name: entry.name, email: entry.email })
      .expect(503);

    expect(response.body).toEqual({
      success: false,
      message: 'Waitlist is temporarily unavailable. Please try again shortly.',
    });
  });

  it('removes the legacy raw-error leak while preserving status and message', async () => {
    vi.mocked(repository.findByEmail).mockRejectedValue(
      new Error('postgresql://admin:super-secret@database.internal/aeko'),
    );

    const response = await request(app.getHttpServer())
      .post('/api/waitlist')
      .send({ name: entry.name, email: entry.email })
      .expect(500);

    expect(response.body).toEqual({
      success: false,
      message: 'Error joining waitlist',
    });
    expect(JSON.stringify(response.body)).not.toContain('super-secret');
  });
});
