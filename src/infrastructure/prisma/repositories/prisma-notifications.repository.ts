import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  NotificationListFilter,
  NotificationPage,
  NotificationRecord,
  NotificationsRepository,
  UserNotificationSettingsRecord,
} from '../../../modules/notifications/notifications.repository.js';
import { PrismaService } from '../prisma.service.js';

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  if (value === null) {
    throw new TypeError('Notification settings cannot be null');
  }

  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError('Notification settings must be JSON serializable');
  }

  return JSON.parse(serialized) as Prisma.InputJsonValue;
}

@Injectable()
export class PrismaNotificationsRepository implements NotificationsRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public async findUserSettings(
    userId: string,
  ): Promise<UserNotificationSettingsRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationSettings: true },
    });

    return user === null
      ? null
      : { notificationSettings: user.notificationSettings };
  }

  public async updateUserSettings(
    userId: string,
    settings: unknown,
  ): Promise<unknown> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data:
        settings === undefined
          ? {}
          : { notificationSettings: toJsonInput(settings) },
      select: { notificationSettings: true },
    });

    return user.notificationSettings;
  }

  public async updatePushToken(
    userId: string,
    pushToken: string,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pushToken },
    });
  }

  public async listNotifications(
    filter: NotificationListFilter,
  ): Promise<NotificationPage> {
    const where: Prisma.NotificationWhereInput = {
      recipientId: filter.userId,
      ...(filter.type === undefined ? {} : { type: filter.type }),
    };
    const skip = (filter.page - 1) * filter.limit;

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              name: true,
              profilePicture: true,
              blueTick: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: filter.limit,
        skip,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { notifications, total };
  }

  public countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        recipientId: userId,
        read: false,
      },
    });
  }

  public findById(id: string): Promise<NotificationRecord | null> {
    return this.prisma.notification.findUnique({ where: { id } });
  }

  public markRead(id: string): Promise<NotificationRecord> {
    return this.prisma.notification.update({
      where: { id },
      data: { read: true },
    });
  }

  public async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        recipientId: userId,
        read: false,
      },
      data: { read: true },
    });
  }

  public async deleteById(id: string): Promise<void> {
    await this.prisma.notification.delete({ where: { id } });
  }
}
