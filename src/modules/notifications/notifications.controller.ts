import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Put,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard, minutes } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { LegacyApiThrottlerExceptionFilter } from '../../common/legacy-api-throttler-exception.filter.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import {
  listNotificationsQuerySchema,
  type ListNotificationsQuery,
} from './notification.schemas.js';
import type {
  NotificationRecord,
  NotificationWithSenderRecord,
} from './notifications.repository.js';
import { NotificationsQueryPipe } from './notifications-query.pipe.js';
import { NotificationsService } from './notifications.service.js';

type NotificationListResponse = Readonly<{
  notifications: readonly NotificationWithSenderRecord[];
  pagination: Readonly<{
    current: number;
    pages: number;
    total: number;
  }>;
}>;

@Controller('api/notifications')
@UseGuards(ThrottlerGuard, JwtAuthGuard)
@UseFilters(LegacyApiThrottlerExceptionFilter)
@Throttle({ default: { limit: 100, ttl: minutes(15) } })
export class NotificationsController {
  public constructor(private readonly service: NotificationsService) {}

  @Get('settings')
  public async getSettings(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    const result = await this.service.getSettings(user.id);
    if (result.kind === 'unexpected') return this.serverError();
    return result.settings;
  }

  @Put('settings')
  public async updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() settings: unknown,
  ): Promise<unknown> {
    const result = await this.service.updateSettings(user.id, settings);
    if (result.kind === 'unexpected') return this.serverError();
    return result.settings;
  }

  @Put('push-token')
  public async updatePushToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<Readonly<{ message: string }>> {
    const result = await this.service.updatePushToken(user.id, body);
    if (result.kind === 'missing-token') {
      throw new BadRequestException({ error: 'Push token is required' });
    }
    if (result.kind === 'unexpected') return this.serverError();
    return { message: 'Push token updated successfully' };
  }

  @Get()
  public async listNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query(
      new NotificationsQueryPipe(
        listNotificationsQuerySchema,
        'Invalid notification query',
      ),
    )
    query: ListNotificationsQuery,
  ): Promise<NotificationListResponse> {
    const result = await this.service.listNotifications(user.id, query);
    if (result.kind === 'unexpected') return this.serverError();

    return {
      notifications: result.page.notifications,
      pagination: {
        current: query.page,
        pages: Math.ceil(result.page.total / query.limit),
        total: result.page.total,
      },
    };
  }

  @Get('unread-count')
  public async getUnreadCount(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Readonly<{ count: number }>> {
    const result = await this.service.getUnreadCount(user.id);
    if (result.kind === 'unexpected') return this.serverError();
    return { count: result.count };
  }

  @Put('read-all')
  public async markAllRead(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Readonly<{ message: string }>> {
    const result = await this.service.markAllRead(user.id);
    if (result.kind === 'unexpected') return this.serverError();
    return { message: 'All notifications marked as read' };
  }

  @Put(':id/read')
  public async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') notificationId: string,
  ): Promise<NotificationRecord> {
    const result = await this.service.markRead(user.id, notificationId);
    if (result.kind === 'not-found') return this.notFound();
    if (result.kind === 'forbidden') return this.forbidden();
    if (result.kind === 'unexpected') return this.serverError();
    return result.notification;
  }

  @Delete(':id')
  public async deleteNotification(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') notificationId: string,
  ): Promise<Readonly<{ message: string }>> {
    const result = await this.service.deleteNotification(
      user.id,
      notificationId,
    );
    if (result.kind === 'not-found') return this.notFound();
    if (result.kind === 'forbidden') return this.forbidden();
    if (result.kind === 'unexpected') return this.serverError();
    return { message: 'Notification deleted' };
  }

  private notFound(): never {
    throw new NotFoundException({ error: 'Notification not found' });
  }

  private forbidden(): never {
    throw new ForbiddenException({ error: 'Unauthorized' });
  }

  private serverError(): never {
    throw new InternalServerErrorException({
      error: 'Internal server error',
    });
  }
}
