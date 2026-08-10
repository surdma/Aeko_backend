import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import { isJsonObject, toJsonValue } from '../common/json/json-value';
import { PrismaService } from '../database/prisma/prisma.service';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  parseNotificationSettings,
  parsePushToken,
  type NotificationEvent,
  type NotificationListQuery,
  type NotificationPage,
  type NotificationSettings,
  type NotificationView,
} from './notification.contract';
import {
  createNotificationPrismaClient,
  type NotificationPrismaClient,
  type NotificationRecord,
} from './notification-prisma.client';
import {
  NotificationBusPort,
  type NotificationSubscription,
} from './notification-bus.port';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: NotificationBusPort,
  ) {}

  private get notifications(): NotificationPrismaClient {
    return createNotificationPrismaClient(this.prisma.db);
  }

  async list(
    principal: AuthenticatedPrincipal,
    query: NotificationListQuery,
  ): Promise<NotificationPage> {
    const filter = {
      recipientId: principal.userId,
      type: query.type,
      unreadOnly: query.unreadOnly,
    };
    const [records, total] = await Promise.all([
      this.notifications.findMany({
        ...filter,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.notifications.count(filter),
    ]);
    return Object.freeze({
      notifications: Object.freeze(records.map(projectNotification)),
      pagination: Object.freeze({
        current: query.page,
        pages: Math.ceil(total / query.limit),
        total,
      }),
    });
  }

  async unreadCount(
    principal: AuthenticatedPrincipal,
  ): Promise<{ readonly count: number }> {
    return Object.freeze({
      count: await this.notifications.countUnread(principal.userId),
    });
  }

  async markRead(
    principal: AuthenticatedPrincipal,
    id: string,
  ): Promise<NotificationView> {
    await this.requireOwned(principal, id);
    return projectNotification(await this.notifications.markRead(id));
  }

  async markAllRead(
    principal: AuthenticatedPrincipal,
  ): Promise<{ readonly message: string }> {
    await this.notifications.markAllRead(principal.userId);
    return Object.freeze({ message: 'All notifications marked as read' });
  }

  async remove(
    principal: AuthenticatedPrincipal,
    id: string,
  ): Promise<{ readonly message: string }> {
    await this.requireOwned(principal, id);
    await this.notifications.delete(id);
    return Object.freeze({ message: 'Notification deleted' });
  }

  async settings(
    principal: AuthenticatedPrincipal,
  ): Promise<NotificationSettings> {
    const stored = await this.notifications.readSettings(principal.userId);
    // Legacy returned the documented defaults when nothing was saved.
    if (!isJsonObject(stored)) return DEFAULT_NOTIFICATION_SETTINGS;
    return parseNotificationSettings(stored);
  }

  async updateSettings(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<NotificationSettings> {
    const settings = parseNotificationSettings(body);
    await this.notifications.writeSettings(
      principal.userId,
      toJsonValue(settings),
    );
    return settings;
  }

  async registerPushToken(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<{ readonly message: string }> {
    const { pushToken } = parsePushToken(body);
    // The token is a delivery secret: it is stored, never echoed or logged.
    await this.notifications.writePushToken(principal.userId, pushToken);
    return Object.freeze({ message: 'Push token updated successfully' });
  }

  /**
   * Realtime delivery. Subscribes only to the caller's own channel, so a
   * subscriber cannot observe another recipient even if the broker were to
   * deliver a foreign message.
   */
  async subscribe(
    principal: AuthenticatedPrincipal,
  ): Promise<NotificationSubscription> {
    if (!this.bus.enabled) {
      throw new DomainError(
        'PROVIDER_UNAVAILABLE',
        'Realtime notifications are not available.',
      );
    }
    return this.bus.subscribe(principal.userId);
  }

  private async requireOwned(
    principal: AuthenticatedPrincipal,
    id: string,
  ): Promise<NotificationRecord> {
    const record = await this.notifications.findById(id);
    if (record === null) {
      throw new DomainError('NOT_FOUND', 'Notification not found.');
    }
    if (record.recipientId !== principal.userId) {
      throw new DomainError(
        'AUTHORIZATION_DENIED',
        'You do not have access to this notification.',
      );
    }
    return record;
  }
}

export const projectNotification = (
  record: NotificationRecord,
): NotificationView =>
  Object.freeze({
    id: record.id,
    type: record.type,
    title: record.title,
    message: record.message,
    entityId: record.entityId,
    entityType: record.entityType,
    read: record.read,
    metadata: record.metadata,
    sender: record.sender,
    createdAt: record.createdAt.toISOString(),
  });

export const toNotificationEvent = (
  record: NotificationRecord,
): NotificationEvent =>
  Object.freeze({
    ...projectNotification(record),
    recipientId: record.recipientId,
  });
