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
import { NotificationsModule } from '../../src/modules/notifications/notifications.module.js';
import {
  NOTIFICATIONS_REPOSITORY,
  type NotificationWithSenderRecord,
  type NotificationsRepository,
} from '../../src/modules/notifications/notifications.repository.js';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../src/modules/notifications/notification-settings.js';

const identities = {
  user: {
    id: 'user-1',
    username: 'user',
    email: 'user@example.com',
    name: 'User',
    isAdmin: false,
    banned: false,
    twoFactorAuth: { isEnabled: false },
  },
  other: {
    id: 'user-2',
    username: 'other',
    email: 'other@example.com',
    name: 'Other',
    isAdmin: false,
    banned: false,
    twoFactorAuth: { isEnabled: false },
  },
} as const;

const notification: NotificationWithSenderRecord = {
  id: 'notification-1',
  recipientId: identities.user.id,
  senderId: identities.other.id,
  type: 'LIKE',
  title: 'New like',
  message: 'Other liked your post',
  entityId: 'post-1',
  entityType: 'POST',
  read: false,
  metadata: null,
  createdAt: new Date('2026-08-06T18:00:00.000Z'),
  updatedAt: new Date('2026-08-06T18:00:00.000Z'),
  sender: {
    id: identities.other.id,
    username: identities.other.username,
    name: identities.other.name,
    profilePicture: null,
    blueTick: false,
  },
};

const authRepository: AuthRepository = {
  findIdentityById: vi.fn(async (userId: string) => {
    if (userId === identities.user.id) return identities.user;
    if (userId === identities.other.id) return identities.other;
    return null;
  }),
  findTwoFactorState: vi.fn(async (userId: string) => {
    if (userId === identities.user.id) return identities.user.twoFactorAuth;
    if (userId === identities.other.id) return identities.other.twoFactorAuth;
    return null;
  }),
  updateTwoFactorState: vi.fn(),
  recordTwoFactorUse: vi.fn(),
};

const notificationsRepository: NotificationsRepository = {
  findUserSettings: vi.fn(),
  updateUserSettings: vi.fn(),
  updatePushToken: vi.fn(),
  listNotifications: vi.fn(),
  countUnread: vi.fn(),
  findById: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  deleteById: vi.fn(),
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
    NotificationsModule,
  ],
  providers: [HttpExceptionFilter],
})
class TestAppModule {}

describe('notifications domain', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let userToken: string;
  let otherToken: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    const moduleReference = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AUTH_REPOSITORY)
      .useValue(authRepository)
      .overrideProvider(NOTIFICATIONS_REPOSITORY)
      .useValue(notificationsRepository)
      .compile();

    app = moduleReference.createNestApplication();
    jwt = moduleReference.get(JwtService);
    userToken = await jwt.signAsync({ id: identities.user.id });
    otherToken = await jwt.signAsync({ userId: identities.other.id });

    const requestIdMiddleware = new RequestIdMiddleware();
    app.use(requestIdMiddleware.use.bind(requestIdMiddleware));
    app.useGlobalFilters(moduleReference.get(HttpExceptionFilter));
    await app.init();
  });

  afterEach(async () => app.close());

  it('requires authentication and returns exact default settings', async () => {
    await request(app.getHttpServer()).get('/api/notifications/settings').expect(
      401,
      {
        success: false,
        error: 'Unauthorized: No token provided',
      },
    );

    vi.mocked(notificationsRepository.findUserSettings).mockResolvedValue({
      notificationSettings: null,
    });

    await request(app.getHttpServer())
      .get('/api/notifications/settings')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200, DEFAULT_NOTIFICATION_SETTINGS);
  });

  it('updates settings and returns the raw stored JSON', async () => {
    const settings = {
      global: { pauseAll: true },
      interactions: { likes: false },
    };
    vi.mocked(notificationsRepository.updateUserSettings).mockResolvedValue(
      settings,
    );

    await request(app.getHttpServer())
      .put('/api/notifications/settings')
      .set('Authorization', `Bearer ${userToken}`)
      .send(settings)
      .expect(200, settings);

    expect(notificationsRepository.updateUserSettings).toHaveBeenCalledWith(
      identities.user.id,
      settings,
    );
  });

  it('preserves push-token validation and success responses', async () => {
    await request(app.getHttpServer())
      .put('/api/notifications/push-token')
      .set('Authorization', `Bearer ${userToken}`)
      .send({})
      .expect(400, { error: 'Push token is required' });

    vi.mocked(notificationsRepository.updatePushToken).mockResolvedValue();
    await request(app.getHttpServer())
      .put('/api/notifications/push-token')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ pushToken: 'device-token' })
      .expect(200, { message: 'Push token updated successfully' });
  });

  it('lists notifications with the legacy sender projection and pagination', async () => {
    vi.mocked(notificationsRepository.listNotifications).mockResolvedValue({
      notifications: [notification],
      total: 21,
    });

    const response = await request(app.getHttpServer())
      .get('/api/notifications?page=2&limit=20&type=LIKE')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(response.body.pagination).toEqual({
      current: 2,
      pages: 2,
      total: 21,
    });
    expect(response.body.notifications[0].sender).toEqual(notification.sender);
  });

  it('enforces ownership when marking a notification as read', async () => {
    vi.mocked(notificationsRepository.findById).mockResolvedValue(notification);

    await request(app.getHttpServer())
      .put(`/api/notifications/${notification.id}/read`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403, { error: 'Unauthorized' });

    vi.mocked(notificationsRepository.markRead).mockResolvedValue({
      ...notification,
      read: true,
    });
    await request(app.getHttpServer())
      .put(`/api/notifications/${notification.id}/read`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
  });

  it('marks all as read and deletes only owned notifications', async () => {
    vi.mocked(notificationsRepository.markAllRead).mockResolvedValue();
    await request(app.getHttpServer())
      .put('/api/notifications/read-all')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200, { message: 'All notifications marked as read' });

    vi.mocked(notificationsRepository.findById).mockResolvedValue(notification);
    vi.mocked(notificationsRepository.deleteById).mockResolvedValue();
    await request(app.getHttpServer())
      .delete(`/api/notifications/${notification.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200, { message: 'Notification deleted' });
  });

  it('returns the stable internal error without disclosing persistence details', async () => {
    vi.mocked(notificationsRepository.countUnread).mockRejectedValue(
      new Error('postgresql://admin:super-secret@database.internal/aeko'),
    );

    const response = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(500, { error: 'Internal server error' });

    expect(JSON.stringify(response.body)).not.toContain('super-secret');
  });
});
