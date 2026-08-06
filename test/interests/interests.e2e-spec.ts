import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from '../../src/common/http-exception.filter.js';
import { LoggingModule } from '../../src/common/logging.module.js';
import { RequestIdMiddleware } from '../../src/common/request-id.middleware.js';
import { AppConfigurationModule } from '../../src/config/configuration.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { AuthModule } from '../../src/modules/auth/auth.module.js';
import {
  AUTH_REPOSITORY,
  type AuthRepository,
} from '../../src/modules/auth/auth.repository.js';
import { InterestsModule } from '../../src/modules/interests/interests.module.js';
import {
  INTERESTS_REPOSITORY,
  type InterestsRepository,
} from '../../src/modules/interests/interests.repository.js';

const interest = {
  id: 'interest-1',
  name: 'technology',
  displayName: 'Technology',
  description: '',
  icon: '',
  isActive: true,
  createdAt: new Date('2026-08-06T18:00:00.000Z'),
  updatedAt: new Date('2026-08-06T18:00:00.000Z'),
} as const;

const identities = {
  admin: {
    id: 'admin',
    username: 'admin',
    email: 'admin@example.com',
    name: 'Admin',
    isAdmin: true,
    banned: false,
    twoFactorAuth: { isEnabled: false },
  },
  user: {
    id: 'user',
    username: 'user',
    email: 'user@example.com',
    name: 'User',
    isAdmin: false,
    banned: false,
    twoFactorAuth: { isEnabled: false },
  },
} as const;

const authRepository: AuthRepository = {
  findIdentityById: vi.fn(async (userId) =>
    identities[userId as keyof typeof identities] ?? null,
  ),
  findTwoFactorState: vi.fn(async (userId) =>
    identities[userId as keyof typeof identities]?.twoFactorAuth ?? null,
  ),
  updateTwoFactorState: vi.fn(),
  recordTwoFactorUse: vi.fn(),
};

const interestsRepository: InterestsRepository = {
  listActive: vi.fn(),
  listActiveByIds: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findUserState: vi.fn(),
  updateUserInterestIds: vi.fn(),
};

const testEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/aeko_test',
  JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
  TWO_FACTOR_SECRET_KEY: 'test-two-factor-secret-key-32chars',
} as const;

@Module({
  imports: [
    AppConfigurationModule.forRoot(testEnvironment),
    LoggingModule,
    AuthModule,
    InterestsModule,
  ],
  providers: [HttpExceptionFilter],
})
class TestAppModule {}

describe('interests domain', () => {
  let app: INestApplication;
  let jwt: JwtService;

  beforeEach(async () => {
    vi.mocked(interestsRepository.listActive).mockReset();
    vi.mocked(interestsRepository.listActiveByIds).mockReset();
    vi.mocked(interestsRepository.findById).mockReset();
    vi.mocked(interestsRepository.create).mockReset();
    vi.mocked(interestsRepository.update).mockReset();
    vi.mocked(interestsRepository.delete).mockReset();
    vi.mocked(interestsRepository.findUserState).mockReset();
    vi.mocked(interestsRepository.updateUserInterestIds).mockReset();

    const moduleReference = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AUTH_REPOSITORY)
      .useValue(authRepository)
      .overrideProvider(INTERESTS_REPOSITORY)
      .useValue(interestsRepository)
      .compile();

    app = moduleReference.createNestApplication();
    jwt = moduleReference.get(JwtService);
    const requestIdMiddleware = new RequestIdMiddleware();
    app.use(requestIdMiddleware.use.bind(requestIdMiddleware));
    app.useGlobalFilters(moduleReference.get(HttpExceptionFilter));
    await app.init();
  });

  afterEach(async () => app.close());

  it('lists active interests without authentication', async () => {
    vi.mocked(interestsRepository.listActive).mockResolvedValue([interest]);

    const response = await request(app.getHttpServer())
      .get('/api/interests')
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: [
        {
          ...interest,
          createdAt: interest.createdAt.toISOString(),
          updatedAt: interest.updatedAt.toISOString(),
        },
      ],
    });
  });

  it('preserves authentication and admin authorization responses', async () => {
    await request(app.getHttpServer())
      .post('/api/interests')
      .send({ name: 'technology', displayName: 'Technology' })
      .expect(401, {
        success: false,
        error: 'Unauthorized: No token provided',
      });

    const userToken = await jwt.signAsync({ id: identities.user.id });
    await request(app.getHttpServer())
      .post('/api/interests')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'technology', displayName: 'Technology' })
      .expect(403, {
        success: false,
        message: 'Access denied. Admin privileges required.',
      });
  });

  it('creates an interest for an authenticated admin', async () => {
    vi.mocked(interestsRepository.create).mockResolvedValue({
      kind: 'created',
      interest,
    });
    const adminToken = await jwt.signAsync({ id: identities.admin.id });

    const response = await request(app.getHttpServer())
      .post('/api/interests')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'TECHNOLOGY', displayName: 'Technology' })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(interestsRepository.create).toHaveBeenCalledWith({
      name: 'technology',
      displayName: 'Technology',
      description: '',
      icon: '',
    });
  });

  it('loads user interests with the legacy envelope', async () => {
    vi.mocked(interestsRepository.findUserState).mockResolvedValue({
      interestIds: [interest.id],
      profileCompletion: {},
    });
    vi.mocked(interestsRepository.listActiveByIds).mockResolvedValue([interest]);
    const userToken = await jwt.signAsync({ userId: identities.user.id });

    const response = await request(app.getHttpServer())
      .get('/api/user/interests')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
  });

  it('does not expose repository errors', async () => {
    vi.mocked(interestsRepository.listActive).mockRejectedValue(
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
