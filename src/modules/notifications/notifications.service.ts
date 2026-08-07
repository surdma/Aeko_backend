import { Inject, Injectable } from '@nestjs/common';
import { SanitizedLogger } from '../../common/sanitized-logger.js';
import { NotificationEventsService } from './notification-events.service.js';
import type {
  NotificationRecord,
  NotificationsRepository,
} from './notifications.repository.js';
import { NOTIFICATIONS_REPOSITORY } from './notifications.repository.js';
import type {
  NotificationMessageResult,
  NotificationMutationResult,
  NotificationPageResult,
  NotificationSettingsResult,
  UnreadCountResult,
  UpdatePushTokenResult,
} from './notifications.results.js';
import { DEFAULT_NOTIFICATION_SETTINGS } from './notification-settings.js';
import type { ListNotificationsQuery } from './notification.schemas.js';

@Injectable()
export class NotificationsService {
  public constructor(
    @Inject(NOTIFICATIONS_REPOSITORY)
    private readonly repository: NotificationsRepository,
    private readonly events: NotificationEventsService,
    private readonly logger: SanitizedLogger,
  ) {}

  public async getSettings(userId: string): Promise<NotificationSettingsResult> {
    try {
      const state = await this.repository.findUserSettings(userId);
      if (state === null) {
        return this.unexpectedSettings(
          'load notification settings',
          new Error('Authenticated user no longer exists'),
        );
      }

      return {
        kind: 'success',
        settings: state.notificationSettings || DEFAULT_NOTIFICATION_SETTINGS,
      };
    } catch (error: unknown) {
      return this.unexpectedSettings('load notification settings', error);
    }
  }

  public async updateSettings(
    userId: string,
    settings: unknown,
  ): Promise<NotificationSettingsResult> {
    try {
      const stored = await this.repository.updateUserSettings(userId, settings);
      this.events.publish(userId, 'settings.updated', { settings: stored });
      return { kind: 'success', settings: stored };
    } catch (error: unknown) {
      return this.unexpectedSettings('update notification settings', error);
    }
  }

  public async updatePushToken(
    userId: string,
    body: unknown,
  ): Promise<UpdatePushTokenResult> {
    const property = this.readPushToken(body);
    if (property.kind === 'unreadable') {
      this.logger.error('Failed to read push token request body');
      return { kind: 'unexpected' };
    }

    if (!property.value) return { kind: 'missing-token' };

    if (typeof property.value !== 'string') {
      this.logger.error('Failed to update push token', {
        error: new TypeError('Push token must be a string'),
      });
      return { kind: 'unexpected' };
    }

    try {
      await this.repository.updatePushToken(userId, property.value);
      return { kind: 'success' };
    } catch (error: unknown) {
      this.logger.error('Failed to update push token', { error });
      return { kind: 'unexpected' };
    }
  }

  public async listNotifications(
    userId: string,
    query: ListNotificationsQuery,
  ): Promise<NotificationPageResult> {
    if (query.type !== undefined && typeof query.type !== 'string') {
      this.logger.error('Failed to list notifications', {
        error: new TypeError('Notification type filter must be a string'),
      });
      return { kind: 'unexpected' };
    }

    try {
      return {
        kind: 'success',
        page: await this.repository.listNotifications({
          userId,
          page: query.page,
          limit: query.limit,
          ...(query.type === undefined ? {} : { type: query.type }),
        }),
      };
    } catch (error: unknown) {
      this.logger.error('Failed to list notifications', { error });
      return { kind: 'unexpected' };
    }
  }

  public async getUnreadCount(userId: string): Promise<UnreadCountResult> {
    try {
      return {
        kind: 'success',
        count: await this.repository.countUnread(userId),
      };
    } catch (error: unknown) {
      this.logger.error('Failed to count unread notifications', { error });
      return { kind: 'unexpected' };
    }
  }

  public async markRead(
    userId: string,
    notificationId: string,
  ): Promise<NotificationMutationResult> {
    try {
      const notification = await this.repository.findById(notificationId);
      if (notification === null) return { kind: 'not-found' };
      if (notification.recipientId !== userId) return { kind: 'forbidden' };

      const updated = await this.repository.markRead(notificationId);
      this.events.publish(userId, 'notification.read', {
        notificationId: updated.id,
        read: updated.read,
      });
      await this.publishUnreadCount(userId);
      return { kind: 'success', notification: updated };
    } catch (error: unknown) {
      this.logger.error('Failed to mark notification as read', { error });
      return { kind: 'unexpected' };
    }
  }

  public async markAllRead(userId: string): Promise<NotificationMessageResult> {
    try {
      await this.repository.markAllRead(userId);
      this.events.publish(userId, 'notification.read-all', {});
      this.events.publish(userId, 'unread-count.changed', { count: 0 });
      return { kind: 'success' };
    } catch (error: unknown) {
      this.logger.error('Failed to mark all notifications as read', { error });
      return { kind: 'unexpected' };
    }
  }

  public async deleteNotification(
    userId: string,
    notificationId: string,
  ): Promise<NotificationMessageResult> {
    try {
      const notification = await this.repository.findById(notificationId);
      if (notification === null) return { kind: 'not-found' };
      if (notification.recipientId !== userId) return { kind: 'forbidden' };

      await this.repository.deleteById(notificationId);
      this.events.publish(userId, 'notification.deleted', { notificationId });
      await this.publishUnreadCount(userId);
      return { kind: 'success' };
    } catch (error: unknown) {
      this.logger.error('Failed to delete notification', { error });
      return { kind: 'unexpected' };
    }
  }

  public publishCreated(notification: NotificationRecord): void {
    this.events.publish(notification.recipientId, 'notification.created', {
      notification,
    });
  }

  private async publishUnreadCount(userId: string): Promise<void> {
    try {
      this.events.publish(userId, 'unread-count.changed', {
        count: await this.repository.countUnread(userId),
      });
    } catch (error: unknown) {
      this.logger.warn('Failed to publish unread notification count', { error });
    }
  }

  private readPushToken(
    body: unknown,
  ):
    | { readonly kind: 'readable'; readonly value: unknown }
    | { readonly kind: 'unreadable' } {
    if (body === null || body === undefined) return { kind: 'unreadable' };

    if (typeof body === 'object' || typeof body === 'function') {
      return {
        kind: 'readable',
        value: Reflect.get(body, 'pushToken'),
      };
    }

    return { kind: 'readable', value: undefined };
  }

  private unexpectedSettings(
    operation: string,
    error: unknown,
  ): { readonly kind: 'unexpected' } {
    this.logger.error(`Failed to ${operation}`, { error });
    return { kind: 'unexpected' };
  }
}
