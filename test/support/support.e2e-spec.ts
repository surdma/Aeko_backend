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
import { AuthV0Module } from '../../src/modules/auth/auth.module.js';
import {
  AUTH_REPOSITORY,
  type AuthRepository,
} from '../../src/modules/auth/auth.repository.js';
import { SupportModule } from '../../src/modules/support/support.module.js';
import {
  SUPPORT_REPOSITORY,
  type SupportRepository,
} from '../../src/modules/support/support.repository.js';

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
  other: {
    id: 'other',
    username: 'other',
    email: 'other@example.com',
    name: 'Other',
    isAdmin: false,
    banned: false,
    twoFactorAuth: { isEnabled: false },
  },
} as const;

const ticket = {
  id: 'ticket-1',
  userId: identities.user.id,
  subject: 'Account help',
  description: 'I need help',
  category: 'account',
  priority: 'medium',
  status: 'open',
  createdAt: new Date('2026-08-06T18:00:00.000Z'),
  updatedAt: new Date('2026-08-06T18:00:00.000Z'),
} as const;

const ticketDetails = {
  ...ticket,
  messages: [],
  user: {
    id: identities.user.id,
    username: identities.user.username,
    name: identities.user.name,
    profilePicture: null,
  },
} as const;

const adminTicket = {
  ...ticket,
  user: {
    id: identities.user.id,
    username: identities.user.username,
    email: identities.user.email,
    name: identities.user.name,
    profilePicture: null,
  },
  _count: { messages: 0 },
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

const supportRepository: SupportRepository = {
  createTicket: vi.fn(),
  listUserTickets: vi.fn(),
  findTicketDetails: vi.fn(),
  findTicketById: vi.fn(),
  createMessageWithStatus: vi.fn(),
  updateTicketStatus: vi.fn(),
  listAdminTickets: vi.fn(),
  updateTicketPriority: vi.fn(),
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
    AuthV0Module,
    SupportModule,
  ],
  providers: [HttpExceptionFilter],
})
class TestAppModule {}

describe('support tickets domain', () => {
  let app: INestApplication;
  let jwt: JwtService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const moduleReference = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AUTH_REPOSITORY)
      .useValue(authRepository)
      .overrideProvider(SUPPORT_REPOSITORY)
      .useValue(supportRepository)
      .compile();

    app = moduleReference.createNestApplication();
    jwt = moduleReference.get(JwtService);
    const requestIdMiddleware = new RequestIdMiddleware();
    app.use(requestIdMiddleware.use.bind(requestIdMiddleware));
    app.useGlobalFilters(moduleReference.get(HttpExceptionFilter));
    await app.init();
  });

  afterEach(async () => app.close());

  it('preserves authentication and creates a ticket with default priority', async () => {
    await request(app.getHttpServer())
      .post('/api/support/tickets')
      .send({
        subject: ticket.subject,
        description: ticket.description,
        category: ticket.category,
      })
      .expect(401, {
        success: false,
        error: 'Unauthorized: No token provided',
      });

    vi.mocked(supportRepository.createTicket).mockResolvedValue(ticket);
    const token = await jwt.signAsync({ id: identities.user.id });

    const response = await request(app.getHttpServer())
      .post('/api/support/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        subject: ticket.subject,
        description: ticket.description,
        category: ticket.category,
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(supportRepository.createTicket).toHaveBeenCalledWith({
      userId: identities.user.id,
      subject: ticket.subject,
      description: ticket.description,
      category: ticket.category,
      priority: 'medium',
    });
  });

  it('preserves owner and administrator ticket access', async () => {
    vi.mocked(supportRepository.findTicketDetails).mockResolvedValue(
      ticketDetails,
    );
    const ownerToken = await jwt.signAsync({ id: identities.user.id });
    const otherToken = await jwt.signAsync({ id: identities.other.id });

    await request(app.getHttpServer())
      .get(`/api/support/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/support/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403, { error: 'Access denied' });
  });

  it('preserves the ordinary-user status restriction', async () => {
    vi.mocked(supportRepository.findTicketById).mockResolvedValue(ticket);
    const token = await jwt.signAsync({ id: identities.user.id });

    await request(app.getHttpServer())
      .patch(`/api/support/tickets/${ticket.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'in_progress' })
      .expect(403, { error: 'Users can only close or resolve tickets' });
  });

  it('uses the support-specific admin envelope and pagination contract', async () => {
    const userToken = await jwt.signAsync({ id: identities.user.id });
    await request(app.getHttpServer())
      .get('/api/support/admin/tickets')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403, { error: 'Access denied. Admin only.' });

    vi.mocked(supportRepository.listAdminTickets).mockResolvedValue({
      tickets: [adminTicket],
      total: 1,
    });
    const adminToken = await jwt.signAsync({ id: identities.admin.id });
    const response = await request(app.getHttpServer())
      .get('/api/support/admin/tickets?page=1&limit=20')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.pagination).toEqual({
      total: 1,
      page: 1,
      pages: 1,
      limit: 20,
    });
  });

  it('returns a stable error without disclosing persistence details', async () => {
    vi.mocked(supportRepository.listUserTickets).mockRejectedValue(
      new Error('postgresql://admin:super-secret@database.internal/aeko'),
    );
    const token = await jwt.signAsync({ id: identities.user.id });

    const response = await request(app.getHttpServer())
      .get('/api/support/tickets')
      .set('Authorization', `Bearer ${token}`)
      .expect(500, { error: 'Server error' });

    expect(JSON.stringify(response.body)).not.toContain('super-secret');
  });
});
