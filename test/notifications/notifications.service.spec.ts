import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SanitizedLogger } from '../../src/common/sanitized-logger.js';
import { NotificationEventsService } from '../../src/modules/notifications/notification-events.service.js';
import type {
  NotificationRecord,
  NotificationsRepository,
} from '../../src/modules/notifications/notifications.repository.js';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../src/modules/notifications/notification-settings.js';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js';

const notification: NotificationRecord = {
  id: 'notification-1',
  recipientId: 'user-1',
  senderId: 'sender-1',
  type: 'LIKE',
  title: null,
  message: null,
  entityId: 'post-1',
  entityType: 'POST',
  read: false,
  metadata: null,
  createdAt: new Date('2026-08-06T18:00:00.000Z'),
  updatedAt: new Date('2026-08-06T18:00:00.000Z'),
};

const repository: NotificationsRepository = {
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

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    const logger = new SanitizedLogger();
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    service = new NotificationsService(
      repository,
      new NotificationEventsService(),
      logger,
    );
  });

  it('returns the exact legacy defaults when settings are falsy', async () => {
    vi.mocked(repository.findUserSettings).mockResolvedValue({
      notificationSettings: null,
    });

    await expect(service.getSettings('user-1')).resolves.toEqual({
      kind: 'success',
      settings: DEFAULT_NOTIFICATION_SETTINGS,
    });
  });

  it('returns stored notification settings without reshaping them', async () => {
    const settings = { global: { pauseAll: true }, custom: ['email'] };
    vi.mocked(repository.findUserSettings).mockResolvedValue({
      notificationSettings: settings,
    });

    await expect(service.getSettings('user-1')).resolves.toEqual({
      kind: 'success',
      settings,
    });
  });

  it('preserves push-token truthiness and persistence behavior', async () => {
    await expect(service.updatePushToken('user-1', {})).resolves.toEqual({
      kind: 'missing-token',
    });
    await expect(
      service.updatePushToken('user-1', { pushToken: 123 }),
    ).resolves.toEqual({ kind: 'unexpected' });

    vi.mocked(repository.updatePushToken).mockResolvedValue();
    await expect(
      service.updatePushToken('user-1', { pushToken: 'device-token' }),
    ).resolves.toEqual({ kind: 'success' });
    expect(repository.updatePushToken).toHaveBeenCalledWith(
      'user-1',
      'device-token',
    );
  });

  it('passes exact pagination and optional type filters to persistence', async () => {
    vi.mocked(repository.listNotifications).mockResolvedValue({
      notifications: [],
      total: 0,
    });

    await service.listNotifications('user-1', {
      page: 2,
      limit: 5,
      type: 'MENTION',
    });

    expect(repository.listNotifications).toHaveBeenCalledWith({
      userId: 'user-1',
      page: 2,
      limit: 5,
      type: 'MENTION',
    });
  });

  it('preserves notification ownership checks', async () => {
    vi.mocked(repository.findById).mockResolvedValue(notification);

    await expect(
      service.markRead('different-user', notification.id),
    ).resolves.toEqual({ kind: 'forbidden' });

    vi.mocked(repository.findById).mockResolvedValue(null);
    await expect(
      service.deleteNotification('user-1', notification.id),
    ).resolves.toEqual({ kind: 'not-found' });
  });

  it('returns the updated notification for the owner', async () => {
    vi.mocked(repository.findById).mockResolvedValue(notification);
    vi.mocked(repository.markRead).mockResolvedValue({
      ...notification,
      read: true,
    });
    vi.mocked(repository.countUnread).mockResolvedValue(0);

    await expect(
      service.markRead(notification.recipientId, notification.id),
    ).resolves.toEqual({
      kind: 'success',
      notification: { ...notification, read: true },
    });
  });

  it('converts repository failures into safe unexpected results', async () => {
    vi.mocked(repository.countUnread).mockRejectedValue(
      new Error('postgresql://admin:secret@database.internal/aeko'),
    );

    await expect(service.getUnreadCount('user-1')).resolves.toEqual({
      kind: 'unexpected',
    });
  });
});
